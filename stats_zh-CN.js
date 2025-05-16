import {
    log, disableLogs, instanceCount, getConfiguration, getNsDataThroughFile, getActiveSourceFiles,
    getStocksValue, formatNumberShort, formatMoney, formatRam, getFilePath
} from './helpers.js'

const argsSchema = [
    ['show-peoplekilled', false],
    ['hide-stocks', false],
    ['hide-RAM-utilization', false],
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
    if (!options || (await instanceCount(ns)) > 1) return; // 防止启动多个实例，即使参数不同。

    const dictSourceFiles = await getActiveSourceFiles(ns, false); // 查找用户已解锁的源文件
    let resetInfo = await getNsDataThroughFile(ns, 'ns.getResetInfo()');
    const bitNode = resetInfo.currentNode;
    disableLogs(ns, ['sleep']);

    // 全局变量需要在启动时重置。否则，它们可能会在例如 flumes 和新 BN 中保留并返回过时的结果
    playerInBladeburner = false;
    nodeMap = {};
    doc = eval('document');
    hook0 = doc.getElementById('overview-extra-hook-0');
    hook1 = doc.getElementById('overview-extra-hook-1');

    // 在脚本退出时清理
    ns.atExit(() => hook1.innerHTML = hook0.innerHTML = "")

    addCSS(doc);

    prepareHudElements(await getHudData(ns, bitNode, dictSourceFiles, options))

    // 主统计更新循环
    while (true) {
        try {
            const hudData = await getHudData(ns, bitNode, dictSourceFiles, options)

            // 使用上面收集的信息更新 HUD 元素
            for (const [header, show, formattedValue, toolTip] of hudData) {
                // 通过在每个值左侧添加一个非换行空格来确保值不会紧贴在标题旁边。
                const paddedValue = formattedValue == null ? null : ' ' + formattedValue?.trim();
                updateHudElement(header, show, paddedValue, toolTip)
            }
        } catch (err) {
            // 可能会因为动态使用内存而偶尔内存不足
            log(ns, `警告: stats.js 在主循环中捕获（并抑制）了一个意外错误。更新跳过:\n` +
                (typeof err === 'string' ? err : err.message || JSON.stringify(err)), false, 'warning');
        }
        await ns.sleep(1000);
    }
}

/** 创建我们将添加自定义 HUD 数据的新 UI 元素。
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

/** 创建我们将添加自定义 HUD 数据的新 UI 元素。
 * @param {string} header - 出现在自定义 HUD 行第一列的统计名称
 * @param {boolean} visible - 指示当前 HUD 行是否应显示（true）或隐藏（false）
 * @param {string} value - 显示在自定义 HUD 行第二列的值
 * @param {string} toolTip - 当用户将光标悬停在此 HUD 行上时显示的工具提示。 */
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
 * @param {number} bitNode 用户当前所在的 bitnode
 * @param {{[k: number]: number}} dictSourceFiles 用户已解锁的源文件
 * @param {(string | boolean)[][]} options 此脚本的运行配置。
 * @typedef {string} header - 出现在自定义 HUD 行第一列的统计名称
 * @typedef {boolean} show - 指示当前 HUD 行是否应显示（true）或隐藏（false）
 * @typedef {string} formattedValue - 显示在自定义 HUD 行第二列的值
 * @typedef {string} toolTip - 当用户将光标悬停在此 HUD 行上时显示的工具提示。
 * @typedef {[header, show, formattedValue, toolTip]} HudRowConfig 显示在 HUD 中的自定义行的配置
 * @returns {Promise<HudRowConfig[]>} **/
async function getHudData(ns, bitNode, dictSourceFiles, options) {
    const hudData = (/**@returns {HudRowConfig[]}*/() => [])();

    // 显示我们当前所在的 bitNode
    {
        const val = ["BitNode", true, `${bitNode}.${1 + (dictSourceFiles[bitNode] || 0)}`,
            `检测为当前 bitnode (${bitNode}) 中您当前拥有的 SF 等级 (${dictSourceFiles[bitNode] || 0}) 加一。`]
        hudData.push(val)
    }

    // 显示哈希值
    {
        const val1 = ["哈希值"];
        const val2 = ["——"]; // 当哈希值被清算时的空白行占位符
        if (9 in dictSourceFiles || 9 == bitNode) { // 如果您无法访问 hacknet 服务器，则此部分不相关
            const hashes = await getNsDataThroughFile(ns, '[ns.hacknet.numHashes(), ns.hacknet.hashCapacity()]', '/Temp/hash-stats.txt')
            if (hashes[1] > 0) {
                val1.push(true, `${formatNumberShort(hashes[0], 3, 1)}/${formatNumberShort(hashes[1], 3, 1)}`,
                    `当前哈希值 ${hashes[0].toLocaleString('en')} / 当前哈希容量 ${hashes[1].toLocaleString('en')}`)
                // 检测并通知 HUD 我们是否正在清算哈希值（尽可能快地出售它们）
                const spendHashesScript = getFilePath('spend-hacknet-hashes.js');
                const liquidatingHashes = await getNsDataThroughFile(ns,
                    `ns.ps('home').filter(p => p.filename == ns.args[0] && (p.args.includes('--liquidate') || p.args.includes('-l')))`,
                    '/Temp/hash-liquidation-scripts.txt', [spendHashesScript]);
                if (liquidatingHashes.length > 0)
                    val2.push(true, "清算中", `您有一个脚本正在尽可能快地出售哈希值 ` +
                        `(PID ${liquidatingHashes[0].pid}: ${spendHashesScript} ${liquidatingHashes[0].args.join(' ')})`);
            }
        }
        if (val1.length < 2) val1.push(false);
        if (val2.length < 2) val2.push(false);
        hudData.push(val1, val2)
    }

    {
        const val = ["股票"]
        // 显示股票（仅当 stockmaster.js 尚未执行相同操作时）
        if (!options['hide-stocks'] && !doc.getElementById("stock-display-1")) {
            const stkPortfolio = await getStocksValue(ns);
            // 如果我们没有持有任何股票，也不要显示股票部分
            if (stkPortfolio > 0) val.push(true, formatMoney(stkPortfolio))
            else val.push(false)
        } else val.push(false)
        hudData.push(val)
    }

    // 显示所有脚本的总瞬时收入和每秒经验值（由游戏直接提供）
    const totalScriptInc = await getNsDataThroughFile(ns, 'ns.getTotalScriptIncome()');
    const totalScriptExp = await getNsDataThroughFile(ns, 'ns.getTotalScriptExpGain()');
    hudData.push(["脚本收入", true, formatMoney(totalScriptInc[0], 3, 2) + '/秒', "所有服务器上运行的所有脚本的总'瞬时'每秒收入。"]);
    hudData.push(["脚本经验", true, formatNumberShort(totalScriptExp, 3, 2) + '/秒', "所有服务器上运行的所有脚本的总'瞬时'每秒黑客经验值。"]);

    // 显示保留资金
    {
        const val = ["保留资金"]
        const reserve = Number(ns.read("reserve.txt") || 0);
        if (reserve > 0) {
            val.push(true, formatNumberShort(reserve, 3, 2), "大多数脚本将保留这么多资金不花费。使用 `run reserve.js 0` 移除。");
        } else val.push(false)
        hudData.push(val)
    }

    // 需要用于帮派和业力
    const gangInfo = await getGangInfo(ns);

    // 显示帮派收入和领地
    {
        const val1 = ["帮派收入"]
        const val2 = ["领地"]
        // 帮派收入仅在帮派解锁后相关
        if ((2 in dictSourceFiles || 2 == bitNode) && gangInfo) {
            // 添加帮派收入
            val1.push(true, formatMoney(gangInfo.moneyGainRate * 5, 3, 2) + '/秒',
                `帮派 (${gangInfo.faction}) 在执行任务时的每秒收入。` +
                `\n收入: ${formatMoney(gangInfo.moneyGainRate * 5)}/秒 (${formatMoney(gangInfo.moneyGainRate)}/tick)` +
                `  尊重: ${formatNumberShort(gangInfo.respect)} (${formatNumberShort(gangInfo.respectGainRate)}/tick)` +
                `\n注意: 如果您看到 0，您的帮派可能暂时全部设置为训练或领地战争。`);
            // 添加帮派领地
            val2.push(true, formatNumberShort(gangInfo.territory * 100, 4, 2) + "%",
                `您的帮派目前在领地战争中的表现。从 14.29% 开始\n` +
                `帮派: ${gangInfo.faction} ${gangInfo.isHacking ? "(黑客)" : "(战斗)"}  ` +
                `力量: ${gangInfo.power.toLocaleString('en')}  冲突 ${gangInfo.territoryWarfareEngaged ? "启用" : "禁用"} ` +
                `(${(gangInfo.territoryClashChance * 100).toFixed(0)}% 几率)`);
        } else {
            val1.push(false)
            val2.push(false)
        }
        hudData.push(val1, val2)
    }

    // 如果我们还没有加入帮派，显示业力
    {
        const val = ["业力"]
        const karma = ns.heart.break();
        // 如果他们还没有开始犯罪，不要剧透业力
        if (karma <= -9
            // 如果在帮派中，您知道自己有大量的负面业力。节省一些空间
            && !gangInfo) {
            let karmaShown = formatNumberShort(karma, 3, 2);
            if (2 in dictSourceFiles && 2 != bitNode && !gangInfo) karmaShown += '/54k'; // 在 BN2 之外显示解锁帮派所需的业力
            val.push(true, karmaShown, "完成 BN2 后，您在其他 BN 中需要 -54,000 业力才能开始一个帮派。您还需要少量业力才能加入某些派系。最多的是 -90 以加入 'The Syndicate'");
        } else val.push(false)
        hudData.push(val)
    }

    // 如果显式启用，显示击杀数
    {
        const val = ["击杀数"]
        if (options['show-peoplekilled']) {
            const playerInfo = await getNsDataThroughFile(ns, 'ns.getPlayer()');
            const numPeopleKilled = playerInfo.numPeopleKilled;
            val.push(true, formatSixSigfigs(numPeopleKilled), "成功谋杀的计数。注意: 您最多需要 30 次击杀才能加入 'Speakers for the Dead'");
        } else val.push(false)
        hudData.push(val)
    }

    // 显示 Bladeburner 等级和技能点
    {
        const val1 = ["BB 等级"]
        const val2 = ["BB 技能点"]
        // Bladeburner API 已解锁
        if ((7 in dictSourceFiles || 7 == bitNode)
            // 检查我们是否在 bladeburner 中。一旦我们发现我们在，就不必再次检查。
            && (playerInBladeburner = playerInBladeburner || await getNsDataThroughFile(ns, 'ns.bladeburner.inBladeburner()'))) {
            const bbRank = await getNsDataThroughFile(ns, 'ns.bladeburner.getRank()');
            const bbSP = await getNsDataThroughFile(ns, 'ns.bladeburner.getSkillPoints()');
            val1.push(true, formatSixSigfigs(bbRank), "您当前的 bladeburner 等级");
            val2.push(true, formatSixSigfigs(bbSP), "您当前未使用的 bladeburner 技能点");
        } else {
            val1.push(false)
            val2.push(false)
        }
        hudData.push(val1, val2)
    }

    // 显示各种服务器 / RAM 使用统计
    {
        const val1 = ["服务器"]
        const val2 = ["家用 RAM"]
        const val3 = ["所有 RAM"]
        if (!options['hide-RAM-utilization']) {
            const servers = await getAllServersInfo(ns);
            const hnServers = servers.filter(s => s.hostname.startsWith("hacknet-server-") || s.hostname.startsWith("hacknet-node-"));
            const nRooted = servers.filter(s => s.hasAdminRights).length;
            const nPurchased = servers.filter(s => s.hostname != "home" && s.purchasedByPlayer).length; // "home" 由游戏计为已购买
            // 添加服务器计数。
            val1.push(true, `${servers.length}/${nRooted}/${nPurchased}`, `网络上的服务器数量 (${servers.length}) / ` +
                `已 root 的数量 (${nRooted}) / 已购买的数量 ` + (hnServers.length > 0 ?
                    `(${nPurchased - hnServers.length} 服务器 + ${hnServers.length} hacknet 服务器)` : `(${nPurchased})`));
            const home = servers.find(s => s.hostname == "home");
            // 添加家用 RAM 和使用率
            val2.push(true, `${formatRam(home.maxRam)} ${(100 * home.ramUsed / home.maxRam).toFixed(1)}%`,
                `显示总家用 RAM（和当前使用率 %）\n详细信息: ${home.cpuCores} 核心并使用 ` +
                `${formatRam(home.ramUsed, true)} 的 ${formatRam(home.maxRam, true)} (${formatRam(home.maxRam - home.ramUsed, true)} 可用)`);
            // 如果用户有任何脚本在 hacknet 服务器上运行，假设他们希望将其包含在“总可用 RAM”统计中
            const includeHacknet = hnServers.some(s => s.ramUsed > 0);
            const fileredServers = servers.filter(s => s.hasAdminRights && !hnServers.includes(s));
            const [sMax, sUsed] = fileredServers.reduce(([tMax, tUsed], s) => [tMax + s.maxRam, tUsed + s.ramUsed], [0, 0]);
            const [hMax, hUsed] = hnServers.reduce(([tMax, tUsed], s) => [tMax + s.maxRam, tUsed + s.ramUsed], [0, 0]);
            const [tMax, tUsed] = [sMax + hMax, sUsed + hUsed];
            let statText = includeHacknet ?
                `${formatRam(tMax)} ${(100 * tUsed / tMax).toFixed(1)}%` :
                `${formatRam(sMax)} ${(100 * sUsed / sMax).toFixed(1)}%`;
            let toolTip = `显示网络上所有已 root 主机的总 RAM 和使用率` + (9 in dictSourceFiles || 9 == bitNode ?
                (includeHacknet ? "\n(包括 hacknet 服务器，因为您有脚本在其上运行)" : " (不包括 hacknet 服务器)") : "") +
                `\n使用 ${formatRam(tUsed, true)} 的 ${formatRam(tMax, true)} (${formatRam(tMax - tUsed, true)} 可用) 在所有服务器上`;
            if (hMax > 0) toolTip +=
                `\n使用 ${formatRam(sUsed, true)} 的 ${formatRam(sMax, true)} (${formatRam(sMax - sUsed, true)} 可用) 不包括 hacknet` +
                `\n使用 ${formatRam(hUsed, true)} 的 ${formatRam(hMax, true)} (${formatRam(hMax - hUsed, true)} 可用) 在 hacknet 服务器上`;
            // 添加总网络 RAM 和使用率
            val3.push(true, statText, toolTip);
        } else {
            val1.push(false)
            val2.push(false)
            val3.push(false)
        }
        hudData.push(val1, val2, val3)
    }

    // 显示当前共享力量
    {
        const val = ["共享力量"]
        const sharePower = await getNsDataThroughFile(ns, 'ns.getSharePower()');
        // Bitburner 错误: 在我们停止共享后，有时会留下微量的共享力量
        if (sharePower > 1.0001) {
            val.push(true, formatNumberShort(sharePower, 3, 2),
                "使用 RAM 来提升在为派系工作时的派系声望获取率（在 ~1.65 时逐渐减少） " +
                "\n使用 `daemon.js` 的 `--no-share` 标志来禁用。");
        } else val.push(false)
        hudData.push(val)
    }

    return hudData
}

/** @param {number} value
 *  @returns {string} 将数字格式化为最多 6 位有效数字的字符串，但不超过指定的小数位数。 */
function formatSixSigfigs(value, minDecimalPlaces = 0, maxDecimalPlaces = 0) {
    return value >= 1E7 ? formatNumberShort(value, 6, 3) :
        value.toLocaleString(undefined, { minimumFractionDigits: minDecimalPlaces, maximumFractionDigits: maxDecimalPlaces });
}

/** @param {NS} ns
 *  @returns {Promise<GangGenInfo|boolean>} 帮派信息，如果我们在帮派中，否则为 False */
async function getGangInfo(ns) {
    return await getNsDataThroughFile(ns, 'ns.gang.inGang() ? ns.gang.getGangInformation() : false', '/Temp/gang-stats.txt')
}

/** @param {NS} ns
 * @returns {Promise<Server[]>} **/
async function getAllServersInfo(ns) {
    const serverNames = await getNsDataThroughFile(ns, 'scanAllServers(ns)');
    return await getNsDataThroughFile(ns, 'ns.args.map(ns.getServer)', '/Temp/getServers.txt', serverNames);
}

/** 注入控制自定义 HUD 元素显示的 CSS。 */
function addCSS(doc) {
    let priorCss = doc.getElementById("statsCSS");
    if (priorCss) priorCss.parentNode.removeChild(priorCss); // 移除旧的 CSS 以便于调整上面的 css
    // 希望此逻辑仍然有效，用于检测哪个元素是 HUD 可拖动窗口
    const hudParent = doc.getElementsByClassName(`MuiCollapse-root`)[0].parentElement;
    if (hudParent) hudParent.style.zIndex = 1E4; // 尾部窗口从 1500 左右开始，这应该使 HUD 保持在它们之上
    doc.head.insertAdjacentHTML('beforeend', css(hudParent ? eval('window').getComputedStyle(hudParent) : null));
}
const css = (rootStyle) => `<style id="statsCSS">
    .MuiTooltip-popper { z-index: 10001 } /* 不幸的是，它不由其所有者父级化，因此必须与 MuiCollapse-root 的父级一起更新 */
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
