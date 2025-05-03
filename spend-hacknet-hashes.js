import { log as log_helper, getConfiguration, disableLogs, formatMoney, formatDuration, formatNumberShort, getErrorInfo } from './helpers.js'

const sellForMoney = 'Sell for Money';

const argsSchema = [
    ['l', false], // 一旦能负担任何 --spend-on 购买项就立即花费哈希。否则，仅在接近容量时花费。
    ['liquidate', false], // 上述标志的长格式
    ['interval', 50], // (毫秒) 程序唤醒花费哈希的时间间隔
    ['spend-on', [sellForMoney]], // 一个或多个花费哈希的动作。
    ['spend-on-server', null], // 要增强的服务器，用于需要服务器参数的花费选项：'降低最小安全' 和 '增加最大金钱'
    ['no-capacity-upgrades', false], // 默认情况下，如果我们无法负担任何购买，我们将尝试升级 hacknet 节点容量。设置为 true 以禁用此功能。
    ['reserve', null], // 当考虑购买容量升级时，要保留的玩家金钱量（默认为 home 上 reserve.txt 中的金额）
    ['ignore-reserve-if-upgrade-cost-less-than-pct', 0.01], // 如果容量升级成本低于玩家金钱的此比例，则忽略当前全局保留并进行购买的技巧
    ['reserve-buffer', 1], // 为避免浪费哈希，如果在下一次 tick 时接近最大容量，则花费哈希。
    ['max-purchases-per-loop', 10000], // 当我们生产哈希的速度快于花费速度时，这可以防止事情被挂起
];

const basicSpendOptions = ['Sell for Money', 'Generate Coding Contract', 'Improve Studying', 'Improve Gym Training',
    'Sell for Corporation Funds', 'Exchange for Corporation Research', 'Exchange for Bladeburner Rank', 'Exchange for Bladeburner SP'];
const parameterizedSpendOptions = ['Reduce Minimum Security', 'Increase Maximum Money'];
const purchaseOptions = basicSpendOptions.concat(parameterizedSpendOptions);
const minTimeBetweenToasts = 5000; // 毫秒。如果我们开始大量购买，限制 toast 通知的频率。

export function autocomplete(data, args) {
    data.flags(argsSchema);
    const lastFlag = args.length > 1 ? args[args.length - 2] : null;
    if (lastFlag == "--spend-on") // 提供几个自动完成选项以方便这些带有空格的参数
        return purchaseOptions.map(f => f.replaceAll(" ", "_"))
            .concat(purchaseOptions.map(f => `'${f}'`));
    return [];
}

/** @param {NS} ns
 * 执行指令以连续花费 hacknet 哈希。
 * 注意：此脚本旨在支持多个具有不同参数的并发实例运行。**/
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    if (!options) return; // 无效选项，或以 --help 模式运行。
    const liquidate = options.l || options.liquidate;
    const interval = options.interval;
    const toBuy = options['spend-on'].map(s => s.replaceAll("_", " "));
    const spendOnServer = options['spend-on-server']?.replaceAll("_", " ") ?? undefined;
    const maxPurchasesPerLoop = options['max-purchases-per-loop'];
    // 验证参数
    if (toBuy.length == 0)
        return log(ns, "错误：你必须通过 --spend-on 参数指定至少一项花费哈希的内容。", true, 'error');
    const unrecognized = toBuy.filter(p => !purchaseOptions.includes(p));
    if (unrecognized.length > 0)
        return log(ns, `错误：一个或多个 --spend-on 参数未被识别：${unrecognized.join(", ")}`, true, 'error');
    // 如果我们的唯一任务是在接近哈希容量时兑换金钱，则以“低优先级”模式运行
    const lowPriority = !liquidate && toBuy.length == 1 && toBuy[0] == sellForMoney;

    disableLogs(ns, ['sleep', 'getServerMoneyAvailable']);
    ns.print(`启动 spend-hacknet-hashes.js... 将每隔 ${formatDuration(interval)} 检查一次`);
    ns.print(liquidate ? `-l --liquidate 模式激活！将尽快花费所有哈希。` :
        `保存哈希，仅在接近容量时花费哈希以避免浪费。`);

    // 设置一个帮助函数来记录日志，但在短时间内进行多次购买时限制 toast 通知的频率
    let lastToast = 0; // 上次生成关于成功购买的 toast 通知的时间
    function log(ns, message, printToTerminal, toastStyle, maxLength) {
        if (toastStyle != undefined) {
            const shouldToast = Date.now() - lastToast > minTimeBetweenToasts;
            if (shouldToast)
                lastToast = Date.now();
            else
                toastStyle = undefined;
        }
        log_helper(ns, message, printToTerminal, toastStyle, maxLength);
    }


    let lastHashBalance = -1; // 上次唤醒时的哈希余额。如果未更改，我们迅速返回睡眠（游戏尚未 tick）
    let notifiedMaxCapacity = false; // 表示我们已达到最大哈希容量的标志，以避免重复记录此事实。
    // 函数确定我们想要持续购买的所有升级中最便宜的升级
    const getMinCost = spendActions => Math.min(...spendActions.map(p => ns.hacknet.hashCost(p)));
    // 帮助函数格式化日志消息中的哈希
    const formatHashes = (hashes) => formatNumberShort(hashes, 6, 3);
    while (true) {
        await ns.sleep(interval);
        if (lowPriority && ns.hacknet.numHashes() > 0) // 低优先级模式意味着任何竞争脚本应首先获得花费哈希的机会。
            await ns.sleep(interval); // 额外等待一个间隔，以给竞争脚本 a首先花费的机会。
        try {
            let capacity = ns.hacknet.hashCapacity() || 0;
            let currentHashes = ns.hacknet.numHashes();
            // 如果游戏尚未 tick（给我们更多的哈希）自从上次循环以来，返回睡眠。
            if (lastHashBalance != capacity && lastHashBalance == currentHashes) continue;
            //log(ns, `信息：唤醒，上次哈希余额已从 ${lastHashBalance} 更改为 ${currentHashes}`);
            // 计算所有 hacknet 节点的总收入率。当接近容量时，我们必须比这更快地花费。
            const nodes = ns.hacknet.numNodes();
            if (nodes == 0) {
                log(ns, '警告：Hacknet 为空，尚无哈希可花费...');
                continue; // 在至少购买一个节点之前，无事可做。
            } else if (capacity == 0)
                return log(ns, '信息：你拥有的是 hacknet 节点，而不是 hacknet 服务器，因此花费哈希不适用。');
            // 帮助函数获取所有节点的总哈希生产
            let globalProduction = Array.from({ length: nodes }, (_, i) => ns.hacknet.getNodeStats(i))
                .reduce((total, node) => total + node.production, 0);
            const hashesEarnedNextTick = globalProduction * interval / 1000 + options['reserve-buffer']; // 如果我们离容量这么近，开始花费
            let purchasesThisLoop = 0;
            // 将花费哈希循环定义为本地函数，因为可能需要调用它两次。
            const fnSpendHashes = async (purchases, spendAllHashes) => {
                const startingHashes = ns.hacknet.numHashes() || 0;
                capacity = ns.hacknet.hashCapacity() || 0;
                // 如果指示，花费我们可以花费的每一个哈希，否则，只花费在下一次 tick 时会被浪费的哈希。
                let maxHashSpend = () => ns.hacknet.numHashes() - (spendAllHashes ? 0 : Math.max(0, capacity - hashesEarnedNextTick));
                let lastPurchaseSucceeded = true; // 如果任何购买失败，则退出 while 循环的额外机制
                // 在循环中进行购买，直到达到每次循环的购买限制，或者我们已经花费了足够的哈希以避免在下一次 tick 时被浪费
                while (lastPurchaseSucceeded && purchasesThisLoop < maxPurchasesPerLoop && getMinCost(purchases) <= maxHashSpend()) {
                    lastPurchaseSucceeded = false; // 如果我们没有进入下面的 for 循环，则避免循环的安全机制
                    // 循环所有请求的购买并尝试购买每一项一次（TODO：提前计算我们可以购买多少并批量购买）
                    for (const spendAction of purchases) {
                        const cost = ns.hacknet.hashCost(spendAction); // 进行此购买的成本
                        const budget = maxHashSpend();
                        if (cost > budget) continue; // 如果成本超过我们剩余的预算，跳过此购买
                        const quantity = spendAction == sellForMoney ? Math.floor(budget / cost) : 1; // 我们可以轻松批量购买金钱，因为成本不会扩大。
                        const totalCost = cost * quantity;
                        lastPurchaseSucceeded = ns.hacknet.spendHashes(spendAction, parameterizedSpendOptions.includes(spendAction) ? spendOnServer : undefined, quantity);
                        if (!lastPurchaseSucceeded) { // 注意：即使我们有足够的哈希，如果另一个脚本首先花费它们，我们也可能失败
                            log(ns, `警告：花费 ${quantity}x '${spendAction}' 的哈希失败。成本为：${formatHashes(totalCost)} 的 ${formatHashes(budget)} ` +
                                `预算哈希。拥有：${formatHashes(ns.hacknet.numHashes())} 的 ${formatHashes(capacity)} (容量) 哈希。`);
                            break; // 退出 for 循环（也应该退出 while 循环，因为 lastPurchaseSucceeded == false）
                        }
                        purchasesThisLoop++;
                        if (purchasesThisLoop < 10) { // 如果我们购买了超过 10 件东西，甚至不要记录每一件，这会减慢我们的速度
                            log(ns, `成功：${purchasesThisLoop == 1 ? '' : `(${purchasesThisLoop}) `}花费了 ${formatHashes(totalCost)} 哈希在 ` +
                                `${quantity}x '${spendAction}' 上。下一次升级将花费 ${formatHashes(ns.hacknet.hashCost(spendAction))}。`, false, 'success');
                        }
                        if (purchasesThisLoop % 100 == 0)
                            await ns.sleep(1); // 如果我们一次进行多次购买，定期向游戏短暂让步。
                    }
                }
                if (purchasesThisLoop > 10)
                    log(ns, `成功：本次循环进行了 ${purchasesThisLoop} 次购买（但静默日志以加快速度）`);
                if (ns.hacknet.numHashes() < startingHashes)
                    log(ns, `信息：总结：花费了 ${formatHashes(startingHashes - ns.hacknet.numHashes())} 哈希在 ${purchasesThisLoop} 次购买上 ` +
                        (spendAllHashes ? '' : `以避免达到容量 (${formatHashes(capacity)}) `) + `同时每秒赚取 ${formatHashes(globalProduction)} 哈希。`);
            };
            // 正常花费哈希在任何/所有用户指定的购买上
            await fnSpendHashes(toBuy, liquidate);
            currentHashes = lastHashBalance = ns.hacknet.numHashes();

            // 确定是否应尝试升级我们的 hacknet 容量
            const remaining = capacity - currentHashes;
            let capacityMessage;
            if (getMinCost(toBuy) > capacity - options['reserve-buffer'])
                capacityMessage = `我们的哈希容量为 ${formatHashes(capacity)}，但我们希望购买的最便宜的升级 ` +
                    `花费 ${formatHashes(getMinCost(toBuy))} 哈希。在购买更多升级之前需要容量升级 (${toBuy.join(", ")})`;
            else if (hashesEarnedNextTick > capacity)
                capacityMessage = `我们赚取哈希的速度快于花费的速度 (${formatHashes(globalProduction)} 哈希/秒 > 容量：${formatHashes(capacity)}).`;
            else if (remaining < hashesEarnedNextTick)
                capacityMessage = `按照指示花费哈希后，我们仍然处于或接近我们的哈希容量 (${formatHashes(capacity)})。 ` +
                    `我们目前拥有 ${formatHashes(currentHashes)} 哈希。这意味着我们离容量还有 ${formatHashes(remaining)} 哈希 ` +
                    `但我们只希望保留 ${formatHashes(hashesEarnedNextTick)} 哈希 (赚取 ${formatHashes(globalProduction)} 哈希/秒).`;
            else
                continue; // 当前哈希容量足够，返回睡眠

            // 如果由于配置原因不允许我们购买容量升级（或无法负担），
            // 我们可能需要通过 toast 通知警告玩家，以便他们可以干预。
            // 除非我们接近容量限制并有浪费哈希的风险，否则不要创建 toast 通知。
            const warnToast = remaining < hashesEarnedNextTick ? 'warning' : undefined;
            if (options['no-capacity-upgrades']) { // 如果由于配置原因不允许我们购买容量升级，警告用户以便他们可以干预
                log(ns, `警告：升级你的 hacknet 缓存！spend-hacknet-hashes.js --no-capacity-upgrades 已设置， ` +
                    `因此我们无法增加我们的哈希容量。${capacityMessage}`, false, warnToast);
            } else { // 否则，尝试升级 hacknet 容量，以便我们可以为更多升级存钱
                if (!notifiedMaxCapacity) // 记录我们想要增加哈希容量（除非我们之前已经看到我们已经达到最大容量）
                    log(ns, `信息：${capacityMessage}`);
                let lowestLevel = Number.MAX_SAFE_INTEGER, lowestIndex = null;
                for (let i = 0; i < nodes; i++)
                    if (ns.hacknet.getNodeStats(i).hashCapacity < lowestLevel)
                        lowestIndex = i, lowestLevel = ns.hacknet.getNodeStats(i).hashCapacity;
                const nextCacheUpgradeCost = lowestIndex == null ? Number.POSITIVE_INFINITY : ns.hacknet.getCacheUpgradeCost(lowestIndex, 1);
                const nextNodeCost = ns.hacknet.getPurchaseNodeCost();
                const reservedMoney = options['reserve'] ?? Number(ns.read("reserve.txt") || 0);
                const playerMoney = ns.getServerMoneyAvailable('home');
                const spendableMoney = Math.max(0, playerMoney - reservedMoney,
                    // 技巧：由于管理全局保留很棘手。我们倾向于总是希望购买便宜的升级
                    playerMoney * options['ignore-reserve-if-upgrade-cost-less-than-pct']);
                // 如果购买新的 hacknet 节点比升级现有节点的缓存更便宜，则这样做
                if (nextNodeCost < nextCacheUpgradeCost && nextNodeCost < spendableMoney) {
                    if (ns.hacknet.purchaseNode())
                        log(ns, `成功：spend-hacknet-hashes.js 花费了 ${formatMoney(nextNodeCost)} 购买了新的 hacknet 节点 ${nodes + 1} ` +
                            `以增加哈希容量并负担更多购买 (${toBuy.join(", ")}). (你可以使用 --no-capacity-upgrades 禁用此功能)`, false, 'success');
                    else
                        log(ns, `警告：spend-hacknet-hashes.js 尝试花费 ${formatMoney(nextNodeCost)} 购买 hacknet 节点 ${nodes + 1}，`
                            `但由于未知原因购买失败（尽管似乎有 ${formatMoney(spendableMoney)} 可以花费，扣除保留金。)`, false, 'warning');
                } // 否则，尝试升级现有哈希节点的缓存级别
                else if (lowestIndex !== null && nextCacheUpgradeCost < spendableMoney) {
                    if (ns.hacknet.upgradeCache(lowestIndex, 1))
                        log(ns, `成功：spend-hacknet-hashes.js 花费了 ${formatMoney(nextCacheUpgradeCost)} 升级了 hacknet 节点 ${lowestIndex} 的哈希容量 ` +
                            `以负担更多购买 (${toBuy.join(", ")}). (你可以使用 --no-capacity-upgrades 禁用此功能)`, false, 'success');
                    else
                        log(ns, `警告：spend-hacknet-hashes.js 尝试花费 ${formatMoney(nextCacheUpgradeCost)} 升级 hacknet 节点 ${lowestIndex} 的哈希容量，`
                            `但由于未知原因购买失败（尽管似乎有 ${formatMoney(spendableMoney)} 可以花费，扣除保留金。)`, false, 'warning');
                } else if (nodes > 0) {
                    // 准备关于我们无法升级哈希容量的消息
                    let message = `无法升级哈希容量（当前最大 ${formatHashes(capacity)} 哈希）。 `;
                    const nextCheapestCacheIncreaseCost = Math.min(nextCacheUpgradeCost, nextNodeCost);
                    const nextCheapestCacheIncrease = nextNodeCost < nextCacheUpgradeCost ? `购买 hacknet 节点 ${nodes + 1}` : `升级 hacknet 节点 ${lowestIndex} 的哈希容量`;
                    if (!Number.isFinite(nextCheapestCacheIncreaseCost))
                        message += `哈希容量已达到最大值，且 hacknet 服务器限制已达到。`;
                    else
                        message += ` 我们无法负担增加我们的哈希容量（${formatMoney(nextCheapestCacheIncreaseCost)} 以 ${nextCheapestCacheIncrease}）。` +
                            (playerMoney < nextCheapestCacheIncreaseCost ? '' : // 如果成本超过所有玩家金钱，则不要提及预算
                                `在我们的预算 ${formatMoney(spendableMoney)}` + (reservedMoney > 0 ? ` (在尊重 ${formatMoney(reservedMoney)} 的保留金之后)。` : '.'));
                    // 在消息中包括我们试图花费哈希的信息
                    const nextPurchaseCost = getMinCost(toBuy);
                    if (nextPurchaseCost > capacity)
                        message += ` 我们当前的哈希容量不足以购买任何所需的升级 (${toBuy.join(", ")})。 ` +
                            `下一次最便宜的购买花费 ${formatHashes(nextPurchaseCost)} 哈希。`;
                    // 如果我们没有升级的预算，toast 警告以便用户决定是否值得手动干预
                    if (Number.isFinite(nextCheapestCacheIncreaseCost)) {
                        if (playerMoney > nextCheapestCacheIncreaseCost)
                            message += ' 如果你认为值得，可以手动购买此升级（尽管有保留金/预算）。'
                        log(ns, `警告：spend-hacknet-hashes.js ${message}`, false, warnToast);

                    } else if (nextPurchaseCost > capacity) // 如果我们无法负担任何东西，并且已经达到最大哈希容量，我们不妨关闭。
                        return log(ns, `成功：我们已经完成了所有购买。${message}`); // 关闭，因为我们永远无法购买更多东西。
                    else if (!notifiedMaxCapacity) { // 第一次发现我们达到最大哈希容量（无限成本）时通知用户
                        log(ns, `信息：spend-hacknet-hashes.js ${message}`, true, 'info'); // 仅在第一次发生时通知用户。
                        notifiedMaxCapacity = true; // 设置标志以避免重复通知
                    }
                }
            }
            // 如果由于上述任何原因，我们无法升级容量，使用这些参数再次调用 'SpendHashes'
            // 只会将足够的哈希兑换为金钱，以确保它们在下一次 tick 之前不会被浪费。
            purchasesThisLoop = 0;
            await fnSpendHashes([sellForMoney], false);
            currentHashes = lastHashBalance = ns.hacknet.numHashes();
        }
        catch (err) {
            log(ns, `警告：spend-hacknet-hashes.js 在主循环中捕获（并抑制）了一个意外错误：\n` +
                getErrorInfo(err), false, 'warning');
        }
    }
}
