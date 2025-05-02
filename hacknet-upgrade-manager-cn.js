import { getConfiguration, disableLogs, formatDuration, formatMoney, } from './helpers.js'

let haveHacknetServers = true; // 缓存标志，用于检测是否有hacknet服务器
const argsSchema = [
    ['max-payoff-time', '1h'], // 控制升级hacknets的时间范围。可以是秒数，或分钟/小时的表达式（如'123m', '4h'）
    ['time', null], // max-payoff-time的别名
    ['c', false], // 设置为true以持续运行，否则只运行一次
    ['continuous', false],
    ['interval', 1000], // 持续运行时购买升级的速率
    ['max-spend', Number.MAX_VALUE], // 升级的最大花费
    ['toast', false], // 设置为true以显示购买提示
    ['reserve', null], // 保留的现金（如果未指定，默认为reserve.txt中的内容）

];

export function autocomplete(data, _) {
    data.flags(argsSchema);
    return [];
}

/** @param {NS} ns **/
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    if (!options) return; // 无效选项，或运行在--help模式
    const continuous = options.c || options.continuous;
    const interval = options.interval;
    let maxSpend = options["max-spend"];
    let maxPayoffTime = options['time'] || options['max-payoff-time'];
    // 一些字符串解析以更用户友好
    if (maxPayoffTime && String(maxPayoffTime).endsWith("m"))
        maxPayoffTime = Number.parseFloat(maxPayoffTime.replace("m", "")) * 60
    else if (maxPayoffTime && String(maxPayoffTime).endsWith("h"))
        maxPayoffTime = Number.parseFloat(maxPayoffTime.replace("h", "")) * 3600
    else
        maxPayoffTime = Number.parseFloat(maxPayoffTime);
    disableLogs(ns, ['sleep', 'getServerUsedRam', 'getServerMoneyAvailable']);
    setStatus(ns, `启动hacknet-upgrade-manager，购买回报时间限制为${formatDuration(maxPayoffTime * 1000)}，` +
        (maxSpend == Number.MAX_VALUE ? '无花费限制' : `花费限制为${formatMoney(maxSpend)}`) +
        `。当前节点数：${ns.hacknet.numNodes()}...`);
    do {
        try {
            const moneySpent = upgradeHacknet(ns, maxSpend, maxPayoffTime, options);
            // 使用此方法，我们无法确定没有hacknet服务器，直到我们购买了一个
            if (haveHacknetServers && ns.hacknet.numNodes() > 0 && ns.hacknet.hashCapacity() == 0)
                haveHacknetServers = false;
            if (maxSpend && moneySpent === false) {
                setStatus(ns, `达到花费限制。退出...`);
                break; // 技巧，但当我们购买了当前配置下的所有内容时，我们返回一个非数字（false）
            }
            maxSpend -= moneySpent;
        }
        catch (err) {
            setStatus(ns, `警告：hacknet-upgrade-manager.js 在主循环中捕获（并抑制）了一个意外错误：\n` +
                (typeof err === 'string' ? err : err.message || JSON.stringify(err)), false, 'warning');
        }
        if (continuous) await ns.sleep(interval);
    } while (continuous);
}

let lastUpgradeLog = "";
function setStatus(ns, logMessage) {
    if (logMessage != lastUpgradeLog) ns.print(lastUpgradeLog = logMessage);
}

// 将购买最有效的hacknet升级，只要它能在接下来的{payoffTimeSeconds}秒内回本。
/** @param {NS} ns **/
export function upgradeHacknet(ns, maxSpend, maxPayoffTimeSeconds = 3600 /* 3600 秒 == 1 小时 */, options) {
    const currentHacknetMult = ns.getPlayer().mults.hacknet_node_money;
    // 获取最低的缓存级别，在达到相同缓存级别之前，我们不考虑升级高于此级别的服务器的缓存级别
    const minCacheLevel = [...Array(ns.hacknet.numNodes()).keys()].reduce((min, i) => Math.min(min, ns.hacknet.getNodeStats(i).cache), Number.MAX_VALUE);
    // 注意：Formulas API 有一个hashGainRate，应该与这些计算一致，但这种方式即使没有formulas API也可用
    const upgrades = [{ name: "none", cost: 0 }, {
        name: "level", upgrade: ns.hacknet.upgradeLevel, cost: i => ns.hacknet.getLevelUpgradeCost(i, 1), nextValue: nodeStats => nodeStats.level + 1,
        addedProduction: nodeStats => nodeStats.production * ((nodeStats.level + 1) / nodeStats.level - 1)
    }, {
        name: "ram", upgrade: ns.hacknet.upgradeRam, cost: i => ns.hacknet.getRamUpgradeCost(i, 1), nextValue: nodeStats => nodeStats.ram * 2,
        addedProduction: nodeStats => nodeStats.production * 0.07
    }, {
        name: "cores", upgrade: ns.hacknet.upgradeCore, cost: i => ns.hacknet.getCoreUpgradeCost(i, 1), nextValue: nodeStats => nodeStats.cores + 1,
        addedProduction: nodeStats => nodeStats.production * ((nodeStats.cores + 5) / (nodeStats.cores + 4) - 1)
    }, {
        name: "cache", upgrade: ns.hacknet.upgradeCache, cost: i => ns.hacknet.getCacheUpgradeCost(i, 1), nextValue: nodeStats => nodeStats.cache + 1,
        addedProduction: nodeStats => nodeStats.cache > minCacheLevel || !haveHacknetServers ? 0 : nodeStats.production * 0.01 / nodeStats.cache // 注意：实际上不增加产量，但对我们有"价值"，所以我们可以购买更多东西
    }];
    // 找到我们可以对现有节点进行的最佳升级
    let nodeToUpgrade = -1;
    let bestUpgrade;
    let bestUpgradePayoff = 0; // 每美元花费的哈希/秒。越大越好。
    let cost = 0;
    let upgradedValue = 0;
    let worstNodeProduction = Number.MAX_VALUE; // 用于计算新购买节点的可能产量
    for (var i = 0; i < ns.hacknet.numNodes(); i++) {
        let nodeStats = ns.hacknet.getNodeStats(i);
        if (haveHacknetServers) { // 当hacknet服务器运行脚本时，nodeStats.production滞后于当前ram使用率应有的值。获取"原始"速率
            try { nodeStats.production = ns.formulas.hacknetServers.hashGainRate(nodeStats.level, 0, nodeStats.ram, nodeStats.cores, currentHacknetMult); }
            catch { /* 如果我们还没有formulas API，我们无法考虑这一点，只能回退到使用节点报告的生产率 */ }
        }
        worstNodeProduction = Math.min(worstNodeProduction, nodeStats.production);
        for (let up = 1; up < upgrades.length; up++) {
            let currentUpgradeCost = upgrades[up].cost(i);
            let payoff = upgrades[up].addedProduction(nodeStats) / currentUpgradeCost; // 每美元花费的生产率（哈希/秒）
            if (payoff > bestUpgradePayoff) {
                nodeToUpgrade = i;
                bestUpgrade = upgrades[up];
                bestUpgradePayoff = payoff;
                cost = currentUpgradeCost;
                upgradedValue = upgrades[up].nextValue(nodeStats);
            }
        }
    }
    // 将其与添加新节点的成本进行比较。这是一门不精确的科学。我们正在支付解锁购买所有其他节点相同升级的能力 - 所有这些升级都被认为是值得的。不知道达到相同生产率所需的总花费，
    // "最乐观"的情况是将所有这些生产的"价格"视为仅为此服务器的成本，但这**非常**乐观。
    // 实际上，新hacknodes的成本增长得足够快，这应该接近真实情况（服务器成本 >> 升级成本的总和）
    let newNodeCost = ns.hacknet.getPurchaseNodeCost();
    let newNodePayoff = ns.hacknet.numNodes() == ns.hacknet.maxNumNodes() ? 0 : worstNodeProduction / newNodeCost;
    let shouldBuyNewNode = newNodePayoff > bestUpgradePayoff;
    if (newNodePayoff == 0 && bestUpgradePayoff == 0) {
        setStatus(ns, `所有升级都没有价值（在此BN中是否禁用了hashNet收入？）`);
        return false; // 只要maxSpend不变，我们将永远不会再购买升级
    }
    // 如果指定，只购买在{payoffTimeSeconds}内能回本的升级。
    const hashDollarValue = haveHacknetServers ? 2.5e5 : 1; // 每哈希/秒的美元价值（0.25m美元每生产率）。
    let payoffTimeSeconds = 1 / (hashDollarValue * (shouldBuyNewNode ? newNodePayoff : bestUpgradePayoff));
    if (shouldBuyNewNode) cost = newNodeCost;

    // 准备有关下一次升级的信息。无论我们最终是否购买，我们都会显示此信息。
    let strPurchase = (shouldBuyNewNode ? `新节点 "hacknet-node-${ns.hacknet.numNodes()}"` :
        `hacknet-node-${nodeToUpgrade} ${bestUpgrade.name} ${upgradedValue}`) + `，花费 ${formatMoney(cost)}`;
    let strPayoff = `生产 ${((shouldBuyNewNode ? newNodePayoff : bestUpgradePayoff) * cost).toPrecision(3)} 回报时间：${formatDuration(1000 * payoffTimeSeconds)}`
    if (cost > maxSpend) {
        setStatus(ns, `下一次最佳购买将是 ${strPurchase}，但成本超过了花费限制（${formatMoney(maxSpend)}）`);
        return false; // 关闭。只要maxSpend不变，我们将永远不会再购买升级
    }
    if (payoffTimeSeconds > maxPayoffTimeSeconds) {
        setStatus(ns, `下一次最佳购买将是 ${strPurchase}，但 ${strPayoff} 比限制（${formatDuration(1000 * maxPayoffTimeSeconds)}）更差`);
        return false; // 关闭。只要maxPayoffTimeSeconds不变，我们将永远不会再购买升级
    }
    const reserve = (options['reserve'] != null ? options['reserve'] : Number(ns.read("reserve.txt") || 0));
    const playerMoney = ns.getPlayer().money;
    if (cost > playerMoney - reserve) {
        setStatus(ns, `下一次最佳购买将是 ${strPurchase}，但成本超过了我们` +
            `当前可用资金` + (reserve == 0 ? '。' : `（在保留 ${formatMoney(reserve)} 之后）。`));
        return 0; //
    }
    let success = shouldBuyNewNode ? ns.hacknet.purchaseNode() !== -1 : bestUpgrade.upgrade(nodeToUpgrade, 1);
    if (success && options.toast) ns.toast(`购买了 ${strPurchase}`, 'success');
    setStatus(ns, success ? `购买了 ${strPurchase}，${strPayoff}` : `资金不足，无法购买下一次最佳升级：${strPurchase}`);
    return success ? cost : 0;
}
