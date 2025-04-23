import {
    log, disableLogs, instanceCount, getConfiguration, getNsDataThroughFile, getActiveSourceFiles,
    getStocksValue, formatNumberShort, formatMoney, formatRam, getFilePath
} from './helpers.js'

const argsSchema = [
    ['show-peoplekilled', false], // 显示杀人数量
    ['hide-stocks', false], // 隐藏股票信息
    ['hide-RAM-utilization', false], // 隐藏RAM使用率
];

export function autocomplete(data, args) {
    data.flags(argsSchema);
    return [];
}

let doc, hook0, hook1;
let playerInBladeburner = false, nodeMap = {}

/** @param {NS} ns **/
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    if (!options || (await instanceCount(ns)) > 1) return; // 防止此脚本的多个实例被启动，即使使用不同的参数

    const dictSourceFiles = await getActiveSourceFiles(ns, false); // 检查用户已解锁的源文件
    let resetInfo = await getNsDataThroughFile(ns, 'ns.getResetInfo()');
    const bitNode = resetInfo.currentNode;
    disableLogs(ns, ['sleep']);

    // 全局变量需要在启动时重置。否则，它们可能在重置和新BN后保持旧值
    playerInBladeburner = false;
    nodeMap = {};
    doc = eval('document');
    hook0 = doc.getElementById('overview-extra-hook-0');
    hook1 = doc.getElementById('overview-extra-hook-1');

    // 在脚本退出时清理
    ns.atExit(() => hook1.innerHTML = hook0.innerHTML = "")

    addCSS(doc);

    prepareHudElements(await getHudData(ns, bitNode, dictSourceFiles, options))

    // 主状态更新循环
    while (true) {
        try {
            const hudData = await getHudData(ns, bitNode, dictSourceFiles, options)

            // 用上面收集的信息更新HUD元素
            for (const [header, show, formattedValue, toolTip] of hudData) {
                // 确保值永远不会紧贴在标题上，在每个值的左侧添加一个不换行空格
                const paddedValue = formattedValue == null ? null : ' ' + formattedValue?.trim();
                updateHudElement(header, show, paddedValue, toolTip)
            }
        } catch (err) {
            // 由于我们动态使用RAM，可能会不时耗尽
            log(ns, `警告: stats.js 在主循环中捕获（并抑制）了意外错误。更新已跳过:\n` +
                (typeof err === 'string' ? err : err.message || JSON.stringify(err)), false, 'warning');
        }
        await ns.sleep(1000);
    }
}

/** 创建新的UI元素，我们将在其中添加自定义HUD数据 
 * @param {HudRowConfig[]} hudData */
function prepareHudElements(hudData) {
    const newline = (id, txt, toolTip = "") => {
        const p = doc.createElement("p");
        p.className = "tooltip hidden";
        const text = doc.createElement("span");
        text.textContent = txt;
        p.appendChild(text);
        const tooltip = doc.createElement("span");
        p.appendChild(tooltip);
        tooltip.textContent = toolTip;
        tooltip.className = "tooltiptext";
        nodeMap[id] = [text, tooltip, p]
        return p;
    }

    for (const [header, _, value, toolTip] of hudData) {
        const id = makeID(header)
        hook0.appendChild(newline(id + "-title", header.padEnd(9, " "), toolTip))
        hook1.appendChild(newline(id + "-value", value, toolTip))
    }
}

function makeID(header) {
    return header.replace(" ", "") ?? "empty-header"
}

/** 创建新的UI元素，我们将在其中添加自定义HUD数据
 * @param {string} header - 显示在自定义HUD行第一列的统计名称
 * @param {boolean} visible - 指示当前HUD行是否应该显示(true)或隐藏(false)
 * @param {string} value - 显示在自定义HUD行第二列的值
 * @param {string} toolTip - 当用户将鼠标悬停在此HUD行上时显示的工具提示 */
function updateHudElement(header, visible, value, toolTip) {
    const id = makeID(header),
        valId = id + "-value",
        titleId = id + "-title",
        maybeUpdate = (id, index, value) => {
            if (nodeMap[id][index].textContent != value)
                nodeMap[id][index].textContent = value
        }

    if (visible) {
        maybeUpdate(valId, 0, value)
        maybeUpdate(valId, 1, toolTip)
        maybeUpdate(titleId, 1, toolTip)
        nodeMap[titleId][2].classList.remove("hidden")
        nodeMap[valId][2].classList.remove("hidden")
    } else {
        nodeMap[titleId][2].classList.add("hidden")
        nodeMap[valId][2].classList.add("hidden")
    }
}

/** @param {NS} ns
 * @param {number} bitNode 用户当前所在的bitnode
 * @param {{[k: number]: number}} dictSourceFiles 用户已解锁的源文件
 * @param {(string | boolean)[][]} options 此脚本的运行配置
 * @typedef {string} header - 显示在自定义HUD行第一列的统计名称
 * @typedef {boolean} show - 指示当前HUD行是否应该显示(true)或隐藏(false)
 * @typedef {string} formattedValue - 显示在自定义HUD行第二列的值
 * @typedef {string} toolTip - 当用户将鼠标悬停在此HUD行上时显示的工具提示
 * @typedef {[header, show, formattedValue, toolTip]} HudRowConfig HUD中显示的自定义行的配置
 * @returns {Promise<HudRowConfig[]>} **/
async function getHudData(ns, bitNode, dictSourceFiles, options) {
    const hudData = (/**@returns {HudRowConfig[]}*/() => [])();

    // 显示我们当前所在的bitNode
    {
        const val = ["BitNode", true, `${bitNode}.${1 + (dictSourceFiles[bitNode] || 0)}`,
            `检测到为当前bitnode(${bitNode})中拥有的SF等级(${dictSourceFiles[bitNode] || 0})加1。`]
        hudData.push(val)
    }

    // 显示哈希值
    {
        const val1 = ["哈希"];
        const val2 = [" "]; // 当哈希被清算时的空行占位符
        if (9 in dictSourceFiles || 9 == bitNode) { // 如果没有访问hacknet服务器的权限，此部分不相关
            const hashes = await getNsDataThroughFile(ns, '[ns.hacknet.numHashes(), ns.hacknet.hashCapacity()]', '/Temp/hash-stats.txt')
            if (hashes[1] > 0) {
                val1.push(true, `${formatNumberShort(hashes[0], 3, 1)}/${formatNumberShort(hashes[1], 3, 1)}`,
                    `当前哈希值 ${hashes[0].toLocaleString('en')} / 哈希容量 ${hashes[1].toLocaleString('en')}`)
                // 检测并通知HUD是否正在清算哈希（尽可能快地出售）
                const spendHashesScript = getFilePath('spend-hacknet-hashes.js');
                const liquidatingHashes = await getNsDataThroughFile(ns,
                    `ns.ps('home').filter(p => p.filename == ns.args[0] && (p.args.includes('--liquidate') || p.args.includes('-l')))`,
                    '/Temp/hash-liquidation-scripts.txt', [spendHashesScript]);
                if (liquidatingHashes.length > 0)
                    val2.push(true, "正在清算", `你有一个正在尽可能快地出售哈希的脚本在运行 ` +
                        `(PID ${liquidatingHashes[0].pid}: ${spendHashesScript} ${liquidatingHashes[0].args.join(' ')})`);
            }
        }
        if (val1.length < 2) val1.push(false);
        if (val2.length < 2) val2.push(false);
        hudData.push(val1, val2)
    }

    // 显示股票（仅当stockmaster.js没有显示时）
    {
        const val = ["股票"]
        if (!options['hide-stocks'] && !doc.getElementById("stock-display-1")) {
            const stkPortfolio = await getStocksValue(ns);
            // 如果我们没有持有任何股票，也不显示此部分
            if (stkPortfolio > 0) val.push(true, formatMoney(stkPortfolio))
            else val.push(false)
        } else val.push(false)
        hudData.push(val)
    }

    // 显示总即时脚本收入和每秒经验值（由游戏直接提供的值）
    const totalScriptInc = await getNsDataThroughFile(ns, 'ns.getTotalScriptIncome()');
    const totalScriptExp = await getNsDataThroughFile(ns, 'ns.getTotalScriptExpGain()');
    hudData.push(["脚本收入", true, formatMoney(totalScriptInc[0], 3, 2) + '/秒', "所有服务器上运行的所有脚本每秒产生的总'即时'收入。"]);
    hudData.push(["脚本经验", true, formatNumberShort(totalScriptExp, 3, 2) + '/秒', "所有服务器上运行的所有脚本每秒获得的总'即时'黑客经验。"]);

    // 显示保留资金
    {
        const val = ["保留资金"]
        const reserve = Number(ns.read("reserve.txt") || 0);
        if (reserve > 0) {
            val.push(true, formatNumberShort(reserve, 3, 2), "大多数脚本都会保留这么多资金不使用。使用`run reserve.js 0`可以移除");
        } else val.push(false)
        hudData.push(val)
    }

    // 需要帮派和业力信息
    const gangInfo = await getGangInfo(ns);

    // 显示帮派收入和领地
    {
        const val1 = ["帮派收入"]
        const val2 = ["领地"]
        // 帮派收入只在解锁帮派后才相关
        if ((2 in dictSourceFiles || 2 == bitNode) && gangInfo) {
            // 添加帮派收入
            val1.push(true, formatMoney(gangInfo.moneyGainRate * 5, 3, 2) + '/秒',
                `帮派(${gangInfo.faction})执行任务时的每秒收入。` +
                `\n收入：${formatMoney(gangInfo.moneyGainRate * 5)}/秒 (${formatMoney(gangInfo.moneyGainRate)}/tick)` +
                `  声望：${formatNumberShort(gangInfo.respect)} (${formatNumberShort(gangInfo.respectGainRate)}/tick)` +
                `\n注意：如果你看到0，你的帮派可能暂时都在训练或参与领地战。`);
            // 添加帮派领地
            val2.push(true, formatNumberShort(gangInfo.territory * 100, 4, 2) + "%",
                `你的帮派在领地战争中的当前表现。从14.29%开始\n` +
                `帮派：${gangInfo.faction} ${gangInfo.isHacking ? "(黑客)" : "(战斗)"}  ` +
                `力量：${gangInfo.power.toLocaleString('en')}  冲突${gangInfo.territoryWarfareEngaged ? "已启用" : "已禁用"} ` +
                `(${(gangInfo.territoryClashChance * 100).toFixed(0)}%机率)`);
        } else {
            val1.push(false)
            val2.push(false)
        }
        hudData.push(val1, val2)
    }

    // 如果还没有加入帮派就显示业力
    {
        const val = ["业力"]
        const karma = ns.heart.break();
        // 如果他们还没有开始犯罪，就不要剧透业力
        if (karma <= -9
            // 如果在帮派中，你知道你有很多负业力。节省一些空间
            && !gangInfo) {
            let karmaShown = formatNumberShort(karma, 3, 2);
            if (2 in dictSourceFiles && 2 != bitNode && !gangInfo) karmaShown += '/54k'; // 在BN2之外显示解锁帮派所需的业力
            val.push(true, karmaShown, "完成BN2后，你需要在其他BN中获得-54,000业力才能开始帮派。你还需要一点业力来加入一些派系。最多需要-90才能加入'The Syndicate'");
        } else val.push(false)
        hudData.push(val)
    }

    // 如果明确启用则显示杀人数量
    {
        const val = ["杀人数"]
        if (options['show-peoplekilled']) {
            const playerInfo = await getNsDataThroughFile(ns, 'ns.getPlayer()');
            const numPeopleKilled = playerInfo.numPeopleKilled;
            val.push(true, formatSixSigFigs(numPeopleKilled), "成功杀人次数。注意：你最多需要30次杀人才能加入'Speakers for the Dead'");
        } else val.push(false)
        hudData.push(val)
    }

    // 显示刀锋战士等级和技能点
    {
        const val1 = ["刀锋等级"]
        const val2 = ["刀锋技能点"]
        // 刀锋战士API已解锁
        if ((7 in dictSourceFiles || 7 == bitNode)
            // 检查我们是否在刀锋战士部门。一旦发现我们在，就不用再检查了
            && (playerInBladeburner = playerInBladeburner || await getNsDataThroughFile(ns, 'ns.bladeburner.inBladeburner()'))) {
            const bbRank = await getNsDataThroughFile(ns, 'ns.bladeburner.getRank()');
            const bbSP = await getNsDataThroughFile(ns, 'ns.bladeburner.getSkillPoints()');
            val1.push(true, formatSixSigFigs(bbRank), "你当前的刀锋战士等级");
            val2.push(true, formatSixSigFigs(bbSP), "你当前未使用的刀锋战士技能点");
        } else {
            val1.push(false)
            val2.push(false)
        }
        hudData.push(val1, val2)
    }

    // 显示各种服务器/RAM使用率统计
    {
        const val1 = ["服务器"]
        const val2 = ["主机RAM"]
        const val3 = ["总RAM"]
        if (!options['hide-RAM-utilization']) {
            const servers = await getAllServersInfo(ns);
            const hnServers = servers.filter(s => s.hostname.startsWith("hacknet-server-") || s.hostname.startsWith("hacknet-node-"));
            const nRooted = servers.filter(s => s.hasAdminRights).length;
            const nPurchased = servers.filter(s => s.hostname != "home" && s.purchasedByPlayer).length; // "home"被游戏计为已购买
            // 添加服务器数量
            val1.push(true, `${servers.length}/${nRooted}/${nPurchased}`, `网络上的服务器总数(${servers.length}) / ` +
                `已获取root权限数(${nRooted}) / 已购买数量` + (hnServers.length > 0 ?
                    `(${nPurchased - hnServers.length}台服务器 + ${hnServers.length}台hacknet服务器)` : `(${nPurchased})`));
            const home = servers.find(s => s.hostname == "home");
            // 添加主机RAM和使用率
            val2.push(true, `${formatRam(home.maxRam)} ${(100 * home.ramUsed / home.maxRam).toFixed(1)}%`,
                `显示主机总RAM(和当前使用率%)\n详情：${home.cpuCores}核心，正在使用` +
                `${formatRam(home.ramUsed, true)}，共${formatRam(home.maxRam, true)} (剩余${formatRam(home.maxRam - home.ramUsed, true)})`);
            // 如果用户在hacknet服务器上运行任何脚本，假设他们想将其包含在主要的"总可用RAM"统计中
            const includeHacknet = hnServers.some(s => s.ramUsed > 0);
            const fileredServers = servers.filter(s => s.hasAdminRights && !hnServers.includes(s));
            const [sMax, sUsed] = fileredServers.reduce(([tMax, tUsed], s) => [tMax + s.maxRam, tUsed + s.ramUsed], [0, 0]);
            const [hMax, hUsed] = hnServers.reduce(([tMax, tUsed], s) => [tMax + s.maxRam, tUsed + s.ramUsed], [0, 0]);
            const [tMax, tUsed] = [sMax + hMax, sUsed + hUsed];
            let statText = includeHacknet ?
                `${formatRam(tMax)} ${(100 * tUsed / tMax).toFixed(1)}%` :
                `${formatRam(sMax)} ${(100 * sUsed / sMax).toFixed(1)}%`;
            let toolTip = `显示网络上所有已获取root权限主机的RAM总和和使用率` + (9 in dictSourceFiles || 9 == bitNode ?
                (includeHacknet ? "\n(包括hacknet服务器，因为你在上面运行了脚本)" : " (不包括hacknet服务器)") : "") +
                `\n在所有服务器上使用了${formatRam(tUsed, true)}，共${formatRam(tMax, true)} (剩余${formatRam(tMax - tUsed, true)})`;
            if (hMax > 0) toolTip +=
                `\n不包括hacknet时使用了${formatRam(sUsed, true)}，共${formatRam(sMax, true)} (剩余${formatRam(sMax - sUsed, true)})` +
                `\nHacknet服务器使用了${formatRam(hUsed, true)}，共${formatRam(hMax, true)} (剩余${formatRam(hMax - hUsed, true)})`;
            // 添加网络总RAM和使用率
            val3.push(true, statText, toolTip);
        } else {
            val1.push(false)
            val2.push(false)
            val3.push(false)
        }
        hudData.push(val1, val2, val3)
    }

    // 显示当前共享能力
    {
        const val = ["共享能力"]
        const sharePower = await getNsDataThroughFile(ns, 'ns.getSharePower()');
        // Bitburner bug：在我们停止共享后，有时会留下微量的共享能力
        if (sharePower > 1.0001) {
            val.push(true, formatNumberShort(sharePower, 3, 2),
                "使用RAM来提升为派系工作时的声望获取率（在~1.65时趋于平缓）" +
                "\n使用`--no-share`参数运行`daemon.js`可以禁用此功能。");
        } else val.push(false)
        hudData.push(val)
    }

    return hudData
}

/** @param {number} value
 *  @returns {string} 将数字格式化为最多6位有效数字的字符串，但小数位数不超过指定值。 */
function formatSixSigFigs(value, minDecimalPlaces = 0, maxDecimalPlaces = 0) {
    return value >= 1E7 ? formatNumberShort(value, 6, 3) :
        value.toLocaleString(undefined, { minimumFractionDigits: minDecimalPlaces, maximumFractionDigits: maxDecimalPlaces });
}

/** @param {NS} ns
 *  @returns {Promise<GangGenInfo|boolean>} 如果我们在帮派中，返回帮派信息，否则返回False */
async function getGangInfo(ns) {
    return await getNsDataThroughFile(ns, 'ns.gang.inGang() ? ns.gang.getGangInformation() : false', '/Temp/gang-stats.txt')
}

/** @param {NS} ns
 * @returns {Promise<Server[]>} **/
async function getAllServersInfo(ns) {
    const serverNames = await getNsDataThroughFile(ns, 'scanAllServers(ns)');
    return await getNsDataThroughFile(ns, 'ns.args.map(ns.getServer)', '/Temp/getServers.txt', serverNames);
}

/** 注入控制自定义HUD元素显示方式的CSS */
function addCSS(doc) {
    let priorCss = doc.getElementById("statsCSS");
    if (priorCss) priorCss.parentNode.removeChild(priorCss); // 删除旧的CSS以便于调整上面的CSS
    // 希望此逻辑仍然有效，用于检测哪个元素是HUD可拖动窗口
    const hudParent = doc.getElementsByClassName(`MuiCollapse-root`)[0].parentElement;
    if (hudParent) hudParent.style.zIndex = 1E4; // Tail窗口从大约1500开始，这应该使HUD位于它们之上
    doc.head.insertAdjacentHTML('beforeend', css(hudParent ? eval('window').getComputedStyle(hudParent) : null));
}
const css = (rootStyle) => `<style id="statsCSS">
    .MuiTooltip-popper { z-index: 10001 } /* 可惜不是由其所有者父级控制的，所以必须随MuiCollapse-root的父级更新 */
    .tooltip  { margin: 0; position: relative; }
    .tooltip.hidden { display: none; }
    .tooltip:hover .tooltiptext { visibility: visible; opacity: 0.85; }
    .tooltip .tooltiptext {
        visibility: hidden; position: absolute; z-index: 1;
        right: 20px; top: 19px; padding: 2px 10px;
        text-align: right; white-space: pre;
        border-radius: 6px; border: ${rootStyle?.border || "inherit"};
        background-color: ${rootStyle?.backgroundColor || "#900C"};
    }
</style>`;
