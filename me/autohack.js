/** @param {NS} ns**/
/** @param {NS} ns**/
export async function main(ns) {
    ns.atExit(() => ns.ui.closeTail());
    ns.disableLog('ALL');
    ns.ui.setTailTitle(`AutoHack v2.6 [${ns.getScriptName()}]`); // 更新版本号
    ns.ui.openTail();
    const [W, H] = ns.ui.windowSize()


    const FILES = ['grow.script', 'weak.script', 'hack.script'];
    let EXCLUDE = [];
    const CYCLE = [0, "▁", '▂', '▃', '▄', '▅', '▆', '▇', '█'];
    const HACK_COMMANDS = ['brutessh', 'ftpcrack', 'relaysmtp', 'httpworm', 'sqlinject'];

    try {
        await Promise.all([
            ns.write(FILES[0], 'grow(args[0])', 'w'),
            ns.write(FILES[1], 'weaken(args[0])', 'w'),
            ns.write(FILES[2], 'hack(args[0])', 'w')
        ]);
    } catch (e) {
        handleError(`文件写入失败: ${e}`);
        return; // 关键文件创建失败，终止脚本
    }
    let servers, hosts, targets, exes, tarIndex, loop, hType, act;
    const sortDesc = arr => arr.sort((a, b) => b[0] - a[0]);
    const truncate = s => s.length > 14 ? s.substring(0, 14) + '...' : s;

    const serverInfo = {
        MM: s => ns.getServerMaxMoney(s),
        MA: s => ns.getServerMoneyAvailable(s),
        MR: s => ns.getServerMaxRam(s),
        UR: s => ns.getServerUsedRam(s),
        NPR: s => ns.getServerNumPortsRequired(s),
        RHL: s => ns.getServerRequiredHackingLevel(s),
        SL: s => ns.getServerSecurityLevel(s),
        MSL: s => ns.getServerMinSecurityLevel(s)
    };

    async function updateExes() {
        exes = HACK_COMMANDS.filter(cmd => ns.fileExists(`${cmd}.exe`));
    }

    function generateLog() {
        if (CYCLE[0] >= 8) CYCLE[0] = 0;
        CYCLE[0]++;
        ns.clearLog();

        ns.print('╔═══╦═══════════════════╦══════════╦════════════════════╗');
        ns.print(`║ ${CYCLE[CYCLE[0]]} ║      TARGETS      ║ SECURITY ║  PROGRESS & FUNDS  ║`);
        ns.print('╠═══╬═══════════════════╬══════════╬════════════════════╣');

        const topTargets = targets.slice(0, targets.length);
        topTargets.slice(0, 20).forEach(t => {
            const maxMoney = serverInfo.MM(t[1]);
            const currentMoney = serverInfo.MA(t[1]);
            const ratio = currentMoney / maxMoney || 0;

            const filled = Math.floor(ratio * 10);
            const progressBar = '█'.repeat(filled) + '░'.repeat(10 - filled);

            const funds = `$${ns.formatNumber(currentMoney, 1).padEnd(6)}` || '_'.repeat(6);
            const sec = 1 - serverInfo.MSL(t[1]) / serverInfo.SL(t[1]) || 0;
            const filled1 = Math.floor(sec * 8);
            const progressBar1 = '■'.repeat(filled1) + '□'.repeat(8 - filled1);

            ns.print(`║ ${(act[t[1]] || ' ')} ║ ${truncate(t[1]).padEnd(17)} ║ ${progressBar1} ║ ${progressBar} ${funds} ║`);
        });

        ns.print('╠═══╩═══════════════════╩══════════╩════════════════════╣');

        const exeStatus = HACK_COMMANDS.map(cmd =>
            exes.includes(cmd) ? '■' : '□'
        ).join('');

        const hostStats = [
            `HN:${ns.hacknet.numNodes()}`,
            `SV:${ns.getPurchasedServers().length}`,
            `UP:${hosts.filter(h => h[1] !== 'home').length}`,
            `TG:${targets.length}`
        ].join('  ');

        ns.print(`║ EXE:${exeStatus}  ${hostStats.padEnd(43)}║`);
        ns.print('╚═══════════════════════════════════════════════════════╝');
    }

    /**
     * 扫描网络并处理服务器
     * @param {string} host 父服务器名
     * @param {string} current 当前服务器名
     * 递归扫描所有可访问服务器，执行破解和入侵操作
     */
    async function scanNetwork(host, current) {
        try {
            for (const server of ns.scan(current)) {
                if (host === server || EXCLUDE.includes(server)) continue;

                try {
                    const isPurchased = ns.getPurchasedServers().includes(server);
                    if (!isPurchased && serverInfo.NPR(server) <= exes.length) {
                        HACK_COMMANDS.filter(cmd => exes.includes(cmd)).forEach(cmd => {
                            try {
                                ns[cmd](server);
                            } catch (e) {
                                handleError(`${cmd}执行失败: ${e}`);
                            }
                        });
                        try {
                            ns.nuke(server);
                        } catch (e) {
                            handleError(`nuke执行失败: ${e}`);
                        }
                    }

                    if (serverInfo.MM(server) > 0 &&
                        serverInfo.RHL(server) <= ns.getHackingLevel() &&
                        serverInfo.MSL(server) < 100) {
                        targets.push([Math.floor(serverInfo.MM(server) / serverInfo.MSL(server)), server]);
                    }

                    if (serverInfo.MR(server) > 4 && !EXCLUDE.includes(server)) {
                        hosts.push([serverInfo.MR(server), server]);
                    }

                    servers.push(server);
                    try {
                        ns.scp(FILES, server, 'home');
                    } catch (e) {
                        handleError(`文件复制失败: ${e}`);
                    }
                    await scanNetwork(current, server);
                } catch (e) {
                    handleError(`服务器${server}处理失败: ${e}`);
                }
            }
            targets = sortDesc(targets);
            hosts = sortDesc(hosts);
        } catch (e) {
            handleError(`网络扫描失败: ${e}`);
            throw e; // 重新抛出异常让上层处理
        }
    }


    /**
     * 计算hack脚本的最佳线程数
     * @param {string} target 目标服务器
     * @param {number} freeRam 可用RAM
     * @param {number} _cores CPU核心数(未使用)
     * @returns {number} 推荐线程数
     */
    function calculateHackThreads(target, freeRam, _cores) {
        const scriptRam = ns.getScriptRam(FILES[2]);
        const maxThreads = Math.floor(freeRam / scriptRam);
        const hackPerThread = ns.hackAnalyze(target);
        if (hackPerThread <= 0) return 0;

        const desiredPercentage = 0.7;
        const maxSafeThreads = Math.floor(desiredPercentage / hackPerThread);
        return Math.min(maxThreads, maxSafeThreads);
    }

    /**
     * 计算weaken脚本的最佳线程数
     * @param {string} target 目标服务器
     * @param {number} freeRam 可用RAM
     * @param {number} cores CPU核心数
     * @returns {number} 推荐线程数
     */
    function calculateWeakenThreads(target, freeRam, cores) {
        const scriptRam = ns.getScriptRam(FILES[1]);
        const securityDiff = serverInfo.SL(target) - serverInfo.MSL(target);
        const threadsNeeded = Math.ceil(securityDiff / (0.05 * cores));
        const possibleThreads = Math.floor(freeRam / scriptRam);
        return Math.min(threadsNeeded, possibleThreads);
    }

    /**
     * 计算grow和weaken脚本的最佳线程数组合
     * @param {string} target 目标服务器
     * @param {number} freeRam 可用RAM
     * @param {number} cores CPU核心数
     * @returns {number[]} [grow线程数, weaken线程数]
     */
    function calculateGWThreads(target, freeRam, cores) {
        const growRam = ns.getScriptRam(FILES[0]);
        const weakenRam = ns.getScriptRam(FILES[1]);
        let remainingRam = freeRam;

        let growThreads = 0;
        const currentMoney = serverInfo.MA(target);
        const maxMoney = serverInfo.MM(target);
        if (currentMoney < maxMoney * 0.8 && currentMoney > 0) {
            const growFactor = (maxMoney * 0.8) / currentMoney;
            growThreads = Math.ceil(ns.growthAnalyze(target, growFactor, cores));
            growThreads = Math.min(growThreads, Math.floor(remainingRam * 0.7 / growRam));
            remainingRam -= growThreads * growRam;
        }

        let weakenThreads = 0;
        const securityDiff = serverInfo.SL(target) - serverInfo.MSL(target);
        if (securityDiff > 0) {
            weakenThreads = Math.ceil(securityDiff / (0.05 * cores));
            weakenThreads = Math.min(weakenThreads, Math.floor(remainingRam / weakenRam));
        }

        return [growThreads, weakenThreads];
    }

    /**
     * 检查服务器是否有足够RAM运行脚本
     * @param {string} host 服务器名
     * @param {string} script 脚本名
     * @param {number} threads 线程数
     * @returns {boolean} 是否有足够资源
     */
    function hasEnoughResources(host, script, threads) {
        const scriptRam = ns.getScriptRam(script);
        const freeRam = serverInfo.MR(host) - serverInfo.UR(host);
        return freeRam >= scriptRam * threads;
    }

    /**
     * 处理并显示错误信息
     * @param {string} error 错误信息
     * 在日志中打印错误并显示toast通知
     */
    function handleError(error) {
        ns.print(`⚠️ 严重错误: ${error}`);
        ns.toast(`⚠️ 自动黑客脚本错误: ${error}`, 'error', 2000);
    }

    /**
     * 改进的资源分配函数
     * 根据目标服务器状态自动分配hack/grow/weaken脚本
     * 1. 检查目标服务器资金状态
     * 2. 检查目标服务器安全等级
     * 3. 根据可用RAM计算最优线程数
     * 4. 执行相应操作
     */
    async function allocateResourcesImproved() {
        for (const [_, host] of hosts) {
            if (host === 'home') continue;

            if (tarIndex >= targets.length) {
                tarIndex = 0;
                loop = true;
            }

            const target = targets[tarIndex][1];
            const freeRam = serverInfo.MR(host) - serverInfo.UR(host);
            const server = ns.getServer(host);
            const cores = server.cpuCores || 1;

            if (serverInfo.MA(target) < serverInfo.MM(target) * 0.8) {
                hType = 0;
            } else if (serverInfo.SL(target) > serverInfo.MSL(target) + 5 || loop) {
                hType = 1;
                const weakenThreads = calculateWeakenThreads(target, freeRam, cores);
                if (weakenThreads > 0 && hasEnoughResources(host, FILES[1], weakenThreads)) {
                    ns.exec(FILES[1], host, weakenThreads, target);
                }
            } else {
                hType = 2;
                const isHacking = hosts.some(([_, h]) => h !== host && ns.isRunning(FILES[2], h, target));
                if (!isHacking && !ns.scriptRunning(FILES[2], host)) {
                    if (freeRam < 2) ns.killall(host);
                    const hackThreads = calculateHackThreads(target, freeRam, cores);
                    if (hackThreads > 0 && hasEnoughResources(host, FILES[2], hackThreads)) {
                        ns.exec(FILES[2], host, hackThreads, target);
                    }
                }
            }

            if ((hType === 0 || hType === 2) && freeRam > 3.9) {
                const [growThreads, weakenThreads] = calculateGWThreads(target, freeRam, cores);
                if (growThreads > 0 && hasEnoughResources(host, FILES[0], growThreads)) {
                    ns.exec(FILES[0], host, growThreads, target);
                }
                if (weakenThreads > 0 && hasEnoughResources(host, FILES[1], weakenThreads)) {
                    ns.exec(FILES[1], host, weakenThreads, target);
                }
            }

            if (!loop) act[target] = ['G', 'W', 'H'][hType];
            tarIndex++;
        }
    }

    while (true) {
        ns.ui.moveTail(W * 0.6, 0);
        servers = [];
        targets = [];
        hosts = [[Math.max(serverInfo.MR('home') - 50, 0), 'home']];
        exes = [];
        tarIndex = 0;
        loop = false;
        act = {};
        EXCLUDE = [...Array.from(
            { length: ns.hacknet.numNodes() },
            (_, i) => ns.hacknet.getNodeStats(i).name
        )];

        try {
            await updateExes();
            await scanNetwork('', 'home');
            await allocateResourcesImproved();
            generateLog();
        } catch (e) {
            handleError(`主循环错误: ${e}`);
            // 添加错误恢复等待
            await ns.sleep(5000);
        }
        ns.ui.resizeTail(570, Math.min((targets.length * 24) + 180, 20 * 24 + 180));
        await ns.sleep(1000);
    }
}
