/** @param {NS} ns**/
export async function main(ns) {
    ns.disableLog('ALL');
    ns.ui.setTailTitle('AutoHack v2.1');
    ns.ui.openTail();
    ns.ui.resizeTail(570, 420);
    ns.ui.moveTail(1000, 0);

    const FILES = ['grow.script', 'weak.script', 'hack.script'];
    let EXCLUDE = [];
    const CYCLE = [0, "▁", '▂', '▃', '▄', '▅', '▆', '▇', '█'];
    const HACK_COMMANDS = ['brutessh', 'ftpcrack', 'relaysmtp', 'httpworm', 'sqlinject'];
    const KEEP_MONEY = ns.fileExists('reserve.txt') ? Number(ns.read('reserve.txt')) : 0;
    const HAVE_MONEY = ns.getServerMoneyAvailable('home');

    await Promise.all([
        ns.write(FILES[0], 'grow(args[0])', 'w'),
        ns.write(FILES[1], 'weaken(args[0])', 'w'),
        ns.write(FILES[2], 'hack(args[0])', 'w')
    ]);
    let servers, hosts, targets, exes, tarIndex, loop, hType, act;
    const checkFunds = (cost, divisor) => cost < (HAVE_MONEY / divisor);
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

        ns.print('╔═══╦═══════════════════╦═══════════╦════════════════════╗');
        ns.print(`║ ${CYCLE[CYCLE[0]]} ║      TARGETS      ║ SECURITY  ║  PROGRESS & FUNDS  ║`);
        ns.print('╠═══╬═══════════════════╬═══════════╬════════════════════╣');

        const topTargets = targets.slice(0, 10);
        topTargets.forEach(t => {
            const maxMoney = serverInfo.MM(t[1]);
            const currentMoney = serverInfo.MA(t[1]);
            const ratio = currentMoney / maxMoney || 0;

            const filled = Math.floor(ratio * 10);
            const progressBar = '█'.repeat(filled) + '░'.repeat(10 - filled);

            const funds = `$${ns.formatNumber(currentMoney, 1)}`.padEnd(7);
            const security = serverInfo.SL(t[1]).toFixed(1).padStart(5);
            const minSecurity = serverInfo.MSL(t[1]).toFixed(1).padEnd(5);

            ns.print(`║ ${(act[t[1]] || ' ')} ║ ${truncate(t[1]).padEnd(17)} ║${security}/${minSecurity}║ ${progressBar} ${funds} ║`);
        });

        ns.print('╠═══╩═══════════════════╩═══════════╩════════════════════╣');

        const exeStatus = HACK_COMMANDS.map(cmd =>
            exes.includes(cmd) ? '■' : '□'
        ).join('');

        const hostStats = [
            `HN:${ns.hacknet.numNodes()}`,
            `SV:${ns.getPurchasedServers().length}`,
            `UP:${hosts.filter(h => h[1] !== 'home').length}`,
            `TG:${targets.length}`
        ].join('  ');

        ns.print(`║ EXE:${exeStatus}  ${hostStats.padEnd(44)}║`);
        ns.print('╚════════════════════════════════════════════════════════╝');
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

    async function allocateResources() {
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
                if (freeRam > 4) {
                    const threads = calculateWeakenThreads(ns, target, freeRam, cores);
                    if (threads > 0) ns.exec(FILES[1], host, threads, target);
                }
            } else {
                hType = 2;
                const isHacking = hosts.some(([_, h]) => h !== host && ns.isRunning(FILES[2], h, target));
                if (!isHacking && !ns.scriptRunning(FILES[2], host)) {
                    if (freeRam < 2) ns.killall(host);
                    const threads = calculateHackThreads(ns, target, freeRam, cores);
                    if (threads > 0) ns.exec(FILES[2], host, threads, target);
                }
            }

            if ((hType === 0 || hType === 2) && freeRam > 3.9) {
                const [growThreads, weakenThreads] = calculateGWThreads(ns, target, freeRam, cores);
                if (growThreads > 0) ns.exec(FILES[0], host, growThreads, target);
                if (weakenThreads > 0) ns.exec(FILES[1], host, weakenThreads, target);
            }

            if (!loop) act[target] = ['G', 'W', 'H'][hType];
            tarIndex++;
        }
    }

    function calculateHackThreads(ns, target, freeRam, cores) {
        const scriptRam = ns.getScriptRam(FILES[2]);
        const maxThreads = Math.floor(freeRam / scriptRam);
        const hackPerThread = ns.hackAnalyze(target);
        if (hackPerThread <= 0) return 0;

        const desiredPercentage = 0.7;
        const maxSafeThreads = Math.floor(desiredPercentage / hackPerThread);
        return Math.min(maxThreads, maxSafeThreads);
    }

    function calculateWeakenThreads(ns, target, freeRam, cores) {
        const scriptRam = ns.getScriptRam(FILES[1]);
        const securityDiff = serverInfo.SL(target) - serverInfo.MSL(target);
        const threadsNeeded = Math.ceil(securityDiff / (0.05 * cores));
        const possibleThreads = Math.floor(freeRam / scriptRam);
        return Math.min(threadsNeeded, possibleThreads);
    }

    function calculateGWThreads(ns, target, freeRam, cores) {
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

    async function manageHacknet() {
        if (checkFunds(ns.hacknet.getPurchaseNodeCost(), 50)) ns.hacknet.purchaseNode();
        for (let i = 0; i < ns.hacknet.numNodes(); i++) {
            ['Level', 'Ram', 'Core'].forEach(prop => {
                const cost = ns.hacknet[`get${prop}UpgradeCost`](i);
                if (checkFunds(cost, 50)) ns.hacknet[`upgrade${prop}`](i);
            });
        }
    }

    async function manageServers() {
        let A = []
        for (let i = 0; i < 20; i++)  A.push(2 ** i);
        const maxRam = A.findLast(ram => checkFunds(ns.getPurchasedServerCost(ram), 50));
        if (ns.getPurchasedServers().length < 25 && maxRam) {
            ns.purchaseServer('daemon', maxRam);
        }
        ns.getPurchasedServers().reverse().forEach(server => {
            if (serverInfo.MR(server) < maxRam && checkFunds(ns.getPurchasedServerCost(maxRam), 50)) {
                ns.killall(server);
                ns.deleteServer(server);
                ns.purchaseServer('daemon', maxRam);
            }
        });
    }

    while (true) {
        servers = [];
        targets = [];
        hosts = [[Math.max(serverInfo.MR('home') - 50, 0), 'home']];
        exes = [];
        tarIndex = 0;
        loop = false;
        act = {};
        EXCLUDE = [...Array.from({ length: ns.hacknet.numNodes() }, (_, i) => ns.hacknet.getNodeStats(i).name)];

        if (HAVE_MONEY > KEEP_MONEY) {
            await manageHacknet();
            await manageServers();
        }

        await updateExes();
        await scanNetwork('', 'home');
        await allocateResources();

        generateLog();
        await ns.sleep(1000);
    }
}
