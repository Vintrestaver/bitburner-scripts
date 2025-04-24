import { getConfiguration, disableLogs, formatMoney as importedFormatMoney, formatDuration, scanAllServers } from './helpers.js'

const argsSchema = [
    ['all', false], // 设为 true 以显示所有服务器的信息，而不仅仅是当前黑客等级可达的服务器
    ['silent', false], // 设为 true 以禁用向终端输出最佳服务器信息
    ['at-hack-level', 0], // 模拟玩家达到指定黑客等级时的预期收益。0 表示使用玩家当前的黑客等级
    ['hack-percent', -1], // 计算黑客攻击服务器特定百分比资金时的收益。-1 表示根据当前可用 RAM 估算黑客百分比，上限为 98%
    ['include-hacknet-ram', false], // 是否在计算当前可用 RAM 时包含黑客网络服务器的 RAM
    ['disable-formulas-api', false], // 即使公式 API 可用也禁用它（用于调试当公式不可用时的后备逻辑）
];

export function autocomplete(data, args) {
    data.flags(argsSchema);
    return [];
}

/** @param {NS} ns **/
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    if (!options) return; // 无效的选项，或在 --help 模式下运行
    disableLogs(ns, ["scan", "sleep"]);

    let serverNames = [""]; // 为 IDE 提供类型提示
    serverNames = scanAllServers(ns);

    var weaken_ram = 1.75;
    var grow_ram = 1.75;
    var hack_ram = 1.7;

    var hack_percent = options['hack-percent'] / 100;
    var use_est_hack_percent = false;
    if (options['hack-percent'] == -1) {
        use_est_hack_percent = true;
    } else {
        hack_percent = options['hack-percent'] / 100;
        if (hack_percent <= 0 || hack_percent >= 1) {
            ns.tprint("黑客百分比超出范围 (0-100)");
            return;
        }
    }

    var player = ns.getPlayer();
    //ns.print(JSON.stringify(player));

    if (options['at-hack-level']) player.skills.hacking = options['at-hack-level'];
    let servers = serverNames.map(ns.getServer);
    // 计算所有服务器上我们可用的总 RAM（例如用于运行黑客脚本）
    var ram_total = servers.reduce(function (total, server) {
        if (!server.hasAdminRights || (server.hostname.startsWith('hacknet') && !options['include-hacknet-ram'])) return total;
        return total + server.maxRam;
    }, 0);

    // 重写导入的 formatMoney 以处理小于 0.01 的金额：
    let formatMoney = (amt) => amt > 0.01 ? importedFormatMoney(amt) : '$' + amt.toPrecision(3);

    /** 帮助函数：在特定黑客等级下计算服务器收益/经验率
     * @param {Server} server
     * @param {Player} player */
    function getRatesAtHackLevel(server, player, hackLevel) {
        let theoreticalGainRate, cappedGainRate, expRate;
        let useFormulas = !options['disable-formulas-api'];
        if (useFormulas) {
            // 暂时将玩家对象的黑客等级更改为请求的等级
            const real_player_hack_skill = player.skills.hacking;
            player.skills.hacking = hackLevel;
            // 假设我们在攻击目标之前已将服务器弱化到最低安全性并使其资金达到最大
            server.hackDifficulty = server.minDifficulty;
            server.moneyAvailable = server.moneyMax;
            try {
                // 计算每个工具的成本（ram*秒）
                const weakenCost = weaken_ram * ns.formulas.hacking.weakenTime(server, player);
                const growCost = grow_ram * ns.formulas.hacking.growTime(server, player) + weakenCost * 0.004 / 0.05;
                const hackCost = hack_ram * ns.formulas.hacking.hackTime(server, player) + weakenCost * 0.002 / 0.05;

                // 计算增长和黑客收益率
                const growGain = Math.log(ns.formulas.hacking.growPercent(server, 1, player, 1));
                const hackGain = ns.formulas.hacking.hackPercent(server, player);
                // 如果黑客收益低于此最小值（BN12 等级很高？）我们必须将其强制设为某个最小值以避免 NAN 结果
                const minHackGain = 1e-10;
                if (hackGain <= minHackGain)
                    ns.print(`警告：hackGain 为 ${hackGain.toPrecision(3)}。将其强制设为最小值 ${minHackGain}（${server.hostname}）`);
                server.estHackPercent = Math.max(minHackGain, Math.min(0.98,
                    Math.min(ram_total * hackGain / hackCost, 1 - 1 / Math.exp(ram_total * growGain / growCost)))); // TODO: 我认为这些可能偏离了 2 倍
                if (use_est_hack_percent) hack_percent = server.estHackPercent;
                const grows_per_cycle = -Math.log(1 - hack_percent) / growGain;
                const hacks_per_cycle = hack_percent / hackGain;
                const hackProfit = server.moneyMax * hack_percent * ns.formulas.hacking.hackChance(server, player);
                // 计算相对货币收益
                theoreticalGainRate = hackProfit / (growCost * grows_per_cycle + hackCost * hacks_per_cycle) * 1000 /* 将每毫秒速率转换为每秒 */;
                expRate = ns.formulas.hacking.hackExp(server, player) * (1 + 0.002 / 0.05) / (hackCost) * 1000;
                // 收入的实际上限基于你的黑客脚本。对于我的黑客脚本，这大约是每秒 20%，根据需要调整
                // 不知道为什么我们要除以 ram_total - 基本上确保随着我们可用的 RAM 变大，排序顺序仅仅变成"按服务器最大资金"
                cappedGainRate = Math.min(theoreticalGainRate, hackProfit / ram_total);
                ns.print(`在黑客等级 ${hackLevel} 且窃取 ${(hack_percent * 100).toPrecision(3)}% 时：` +
                    `理论值 ${formatMoney(theoreticalGainRate)}，限制：${formatMoney(hackProfit / ram_total)}，经验：${expRate.toPrecision(3)}，` +
                    `黑客成功率：${(ns.formulas.hacking.hackChance(server, player) * 100).toPrecision(3)}%（${server.hostname}）`);
            }
            catch { // 公式 API 不可用？
                useFormulas = false;
            } finally {
                player.skills.hacking = real_player_hack_skill; // 如果我们临时更改了黑客技能，恢复真实的黑客技能
            }
        }
        // 当公式 API 被禁用或不可用时的解决方案
        if (!useFormulas) {
            // 退而求其次，返回纯基于当前黑客时间的"收益率"（即忽略所需的增长/弱化线程相关的 RAM）
            let timeToHack = ns.getWeakenTime(server.hostname) / 4.0;
            // 实际上，批处理脚本在精心计时的间隔内运行（例如，批次之间的间隔不少于 200 毫秒）。
            // 因此，对于很小的弱化时间，我们使用基于更现实的每秒黑客次数的"上限"收益率。
            let cappedTimeToHack = Math.max(timeToHack, 200)
            // 服务器根据服务器的基础难度计算经验收益。要获得速率，我们将其除以弱化时间
            let relativeExpGain = 3 + server.minDifficulty * 0.3; // 忽略黑客经验增益倍数，因为它们对所有服务器的影响都一样
            server.estHackPercent = 1; // 我们下面的简单计算基于每个服务器 100% 的资金。
            [theoreticalGainRate, cappedGainRate, expRate] = [server.moneyMax / timeToHack, server.moneyMax / cappedTimeToHack, relativeExpGain / timeToHack];
            ns.print(`没有 formulas.exe，基于最大资金 ${formatMoney(server.moneyMax)} 和黑客时间 ${formatDuration(timeToHack)}（上限为 ${formatDuration(cappedTimeToHack)}）：` +
                `理论值 ${formatMoney(theoreticalGainRate)}，限制：${formatMoney(cappedGainRate)}，经验：${expRate.toPrecision(3)}（${server.hostname}）`);
        }
        return [theoreticalGainRate, cappedGainRate, expRate];
    }

    ns.print(`全部？${options['all']} 玩家黑客等级：${player.skills.hacking} RAM总量：${ram_total}`);
    //ns.print(`\n` + servers.map(s => `${s.hostname} 已购买：${s.purchasedByPlayer} 最大资金：${s.moneyMax} 管理员权限：${s.hasAdminRights} 黑客等级要求：${s.requiredHackingSkill}`).join('\n'));

    // 筛选出我们要报告的服务器列表
    servers = servers.filter(server => !server.purchasedByPlayer && (server.moneyMax || 0) > 0 &&
        (options['all'] || server.hasAdminRights && server.requiredHackingSkill <= player.skills.hacking));

    // 首先处理在我们黑客等级范围内的服务器
    const unlocked_servers = servers.filter(s => s.requiredHackingSkill <= player.skills.hacking)
        .map(function (server) {
            [server.theoreticalGainRate, server.gainRate, server.expRate] = getRatesAtHackLevel(server, player, player.skills.hacking);
            return server;
        });
    // 最佳服务器的收益率将用于按比例计算尚未解锁的服务器的相对收益（如果它们在此等级解锁）
    const best_unlocked_server = unlocked_servers.sort((a, b) => b.gainRate - a.gainRate)[0];
    ns.print("最佳已解锁服务器：", best_unlocked_server.hostname, "，每 RAM-秒收益", formatMoney(best_unlocked_server.gainRate));
    // 计算锁定服务器的收益率（按比例折算回玩家当前的黑客等级）
    const locked_servers = servers.filter(s => s.requiredHackingSkill > player.skills.hacking).sort((a, b) => a.requiredHackingSkill - b.requiredHackingSkill)
        .map(function (server) {
            // 我们需要伪造黑客技能以获取该服务器首次解锁时的数据，但为了保持比较的公平性，
            // 我们需要根据当前最佳服务器现在的收益与其在那个黑客等级时的收益之比来缩减收益。
            const [bestUnlockedScaledGainRate, _, bestUnlockedScaledExpRate] = getRatesAtHackLevel(best_unlocked_server, player, server.requiredHackingSkill);
            const gainRateScaleFactor = bestUnlockedScaledGainRate ? best_unlocked_server.theoreticalGainRate / bestUnlockedScaledGainRate : 1;
            const expRateScaleFactor = bestUnlockedScaledExpRate ? best_unlocked_server.expRate / bestUnlockedScaledExpRate : 1;
            const [theoreticalGainRate, cappedGainRate, expRate] = getRatesAtHackLevel(server, player, server.requiredHackingSkill);
            // 应用缩放因子，以及与上面相同的上限
            server.theoreticalGainRate = theoreticalGainRate * gainRateScaleFactor;
            server.expRate = expRate * expRateScaleFactor;
            server.gainRate = Math.min(server.theoreticalGainRate, cappedGainRate);
            ns.print(`${server.hostname}：理论收益按 ${gainRateScaleFactor.toPrecision(3)} 缩放至 ${formatMoney(server.theoreticalGainRate)} ` +
                `（上限为 ${formatMoney(cappedGainRate)}），经验按 ${expRateScaleFactor.toPrecision(3)} 缩放至 ${server.expRate.toPrecision(3)}`);
            return server;
        }) || [];
    // 合并列表，排序，并显示摘要
    const server_eval = unlocked_servers.concat(locked_servers);
    const best_server = server_eval.sort((a, b) => b.gainRate - a.gainRate)[0];
    if (!options['silent'])
        ns.tprint("最佳服务器：", best_server.hostname, "，每 RAM-秒收益", formatMoney(best_server.gainRate));

    // 按黑客资金收益从高到低打印所有服务器
    let order = 1;
    let serverListByGain = `在黑客等级 ${player.skills.hacking} 时按黑客资金收益从高到低排序的服务器：`;
    for (const server of server_eval)
        serverListByGain += `\n ${order++} ${server.hostname}，每 RAM-秒收益 ${formatMoney(server.gainRate)}，窃取 ` +
            `${(server.estHackPercent * 100).toPrecision(3)}%（在黑客等级 ${server.requiredHackingSkill} 解锁）`;
    ns.print(serverListByGain);

    // 按经验重新排序服务器，按黑客经验获取率从高到低排序
    var best_exp_server = server_eval.sort(function (a, b) {
        return b.expRate - a.expRate;
    })[0];
    if (!options['silent'])
        ns.tprint("最佳经验服务器：", best_exp_server.hostname, "，每 RAM-秒经验", best_exp_server.expRate);
    order = 1;
    let serverListByExp = `在黑客等级 ${player.skills.hacking} 时按黑客经验从高到低排序的服务器：`;
    for (let i = 0; i < Math.min(5, server_eval.length); i++)
        serverListByExp += `\n ${order++} ${server_eval[i].hostname}，每 RAM-秒经验 ${server_eval[i].expRate.toPrecision(3)}`;
    ns.print(serverListByExp);

    ns.write('/Temp/analyze-hack.txt', JSON.stringify(server_eval.map(s => ({
        hostname: s.hostname,
        gainRate: s.gainRate,
        expRate: s.expRate
    }))), "w");
    // 下面是黑客网络服务器的统计信息 - 取消注释需要 4 GB RAM
    /*
    var hacknet_nodes = [...(function* () {
        var n = ns.hacknet.numNodes();
        for (var i = 0; i < n; i++) {
            var server = ns.hacknet.getNodeStats(i);
            server.gainRate = 1000000 / 4 * server.production / server.ram;
            yield server;
        }
    })()];
    var best_hacknet_node = hacknet_nodes.sort(function (a, b) {
        return b.gainRate - a.gainRate;
    })[0];
    if (best_hacknet_node) ns.tprint("最佳黑客网络节点：", best_hacknet_node.name, "，每 RAM-秒收益 $", best_hacknet_node.gainRate);
    */
}