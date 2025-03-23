/** @param {NS} ns**/
/** @param {NS} ns**/
export async function main(ns) {
    ns.disableLog('ALL');
    ns.ui.setTailTitle(`AutoHack v2.6 [${ns.getScriptName()}]`); // 更新版本号
    ns.ui.openTail();
    const [W, H] = ns.ui.windowSize()


    // 增加颜色配置
    const COLORS = {
        reset: '\x1b[0m',
        bullish: '\x1b[38;5;46m',      // 亮绿色
        bearish: '\x1b[38;5;196m',     // 亮红色
        profit: '\x1b[38;5;47m',       // 渐变绿色
        loss: '\x1b[38;5;160m',        // 渐变红色  
        warning: '\x1b[38;5;226m',     // 黄色
        info: '\x1b[38;5;51m',         // 青色
        highlight: '\x1b[38;5;213m',   // 粉紫色
        header: '\x1b[48;5;236m',      // 深灰色背景
        rsiLow: '\x1b[38;5;46m',       // RSI <30
        rsiMid: '\x1b[38;5;226m',      // RSI 30-70
        rsiHigh: '\x1b[38;5;196m'      // RSI >70
    };
    const FILES = ['grow.script', 'weak.script', 'hack.script'];
    let EXCLUDE = [];
    const CYCLE = [0, "▁", '▂', '▃', '▄', '▅', '▆', '▇', '█'];
    const HACK_COMMANDS = ['brutessh', 'ftpcrack', 'relaysmtp', 'httpworm', 'sqlinject'];

    await Promise.all([
        ns.write(FILES[0], 'grow(args[0])', 'w'),
        ns.write(FILES[1], 'weaken(args[0])', 'w'),
        ns.write(FILES[2], 'hack(args[0])', 'w')
    ]);
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

            const funds = `${COLORS.info}$${ns.formatNumber(currentMoney, 1).padEnd(6)}${COLORS.reset}` || '_'.repeat(6);
            // const security = serverInfo.SL(t[1]).toFixed(1).padStart(5);
            // const minSecurity = serverInfo.MSL(t[1]).toFixed(1).padEnd(5);
            const sec = 1 - serverInfo.MSL(t[1]) / serverInfo.SL(t[1]) || 0;
            const filled1 = Math.floor(sec * 8);
            const col = sec > 0.66 ? COLORS.rsiHigh : sec > 0.33 ? COLORS.rsiMid : ''
            const progressBar1 = `${col}` + '■'.repeat(filled1) + '□'.repeat(8 - filled1) + `${COLORS.reset}`;

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

    async function scanNetwork(host, current) {
        for (const server of ns.scan(current)) {
            if (host === server || EXCLUDE.includes(server)) continue;

            const isPurchased = ns.getPurchasedServers().includes(server);
            if (!isPurchased && serverInfo.NPR(server) <= exes.length) {
                HACK_COMMANDS.filter(cmd => exes.includes(cmd)).forEach(cmd => ns[cmd](server));
                ns.nuke(server);
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
            ns.scp(FILES, server, 'home');
            await scanNetwork(current, server);
        }
        targets = sortDesc(targets);
        hosts = sortDesc(hosts);
    }


    function calculateHackThreads(target, freeRam, _cores) {
        const scriptRam = ns.getScriptRam(FILES[2]);
        const maxThreads = Math.floor(freeRam / scriptRam);
        const hackPerThread = ns.hackAnalyze(target);
        if (hackPerThread <= 0) return 0;

        const desiredPercentage = 0.7;
        const maxSafeThreads = Math.floor(desiredPercentage / hackPerThread);
        return Math.min(maxThreads, maxSafeThreads);
    }

    function calculateWeakenThreads(target, freeRam, cores) {
        const scriptRam = ns.getScriptRam(FILES[1]);
        const securityDiff = serverInfo.SL(target) - serverInfo.MSL(target);
        const threadsNeeded = Math.ceil(securityDiff / (0.05 * cores));
        const possibleThreads = Math.floor(freeRam / scriptRam);
        return Math.min(threadsNeeded, possibleThreads);
    }

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

    // 新增函数：检查是否有足够的资源运行脚本
    function hasEnoughResources(host, script, threads) {
        const scriptRam = ns.getScriptRam(script);
        const freeRam = serverInfo.MR(host) - serverInfo.UR(host);
        return freeRam >= scriptRam * threads;
    }

    function handleError(error) { ns.print(`\x1b[38;5;196m⚠️ 错误: ${error}\x1b[0m`); }

    // 修改 allocateResources 函数，增加资源检查
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

            if (!loop) act[target] = [`G`, `${COLORS.highlight}W${COLORS.reset}`, `${COLORS.info}H${COLORS.reset}`][hType];
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
            await allocateResourcesImproved(); // 使用改进后的资源分配函数
            generateLog();
        } catch (e) {
            handleError(e);
        }
        ns.ui.resizeTail(570, Math.min((targets.length * 24) + 180, 20 * 24 + 180));
        await ns.sleep(1000);
    }
}

