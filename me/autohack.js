/** @param {NS} ns**/
export async function main(ns) {
    ns.atExit(() => ns.ui.closeTail());
    ns.disableLog('ALL');
    ns.ui.setTailTitle(`AutoHack v2.8 [${ns.getScriptName()}]`);
    ns.ui.openTail();
    const [W, H] = ns.ui.windowSize();
    ns.ui.moveTail(W * 0.6, H * 0);
    // 脚本文件配置
    const FILES = ['grow.script', 'weak.script', 'hack.script']; // 三种操作脚本
    let EXCLUDE = []; // 排除的服务器列表
    const CYCLE = [0, "▁", '▂', '▃', '▄', '▅', '▆', '▇', '█']; // 进度条动画帧
    const HACK_COMMANDS = ['brutessh', 'ftpcrack', 'relaysmtp', 'httpworm', 'sqlinject']; // 破解工具列表

    try {
        await Promise.all([
            ns.write(FILES[0], 'grow(args[0])', 'w'),
            ns.write(FILES[1], 'weaken(args[0])', 'w'),
            ns.write(FILES[2], 'hack(args[0])', 'w')
        ]);
    } catch (e) {
        handleError(`文件写入失败: ${e}`);
        return;
    }

    let servers, hosts, targets, exes, tarIndex, loop, hType, act;
    const sortDesc = arr => arr.sort((a, b) => b[0] - a[0]);
    const truncate = s => s.length > 12 ? s.substring(0, 12) + '...' : s;

    /**
     * 服务器信息管理类
     * 封装服务器相关操作并提供缓存功能
     * 避免重复调用游戏API提高性能
     */
    class ServerManager {
        constructor(ns) {
            this.ns = ns;
            this.cache = {};
        }

        getMaxMoney(host) { return this.ns.getServerMaxMoney(host); }
        getMoneyAvailable(host) { return this.ns.getServerMoneyAvailable(host); }
        getMaxRam(host) { return this.ns.getServerMaxRam(host); }
        getUsedRam(host) { return this.ns.getServerUsedRam(host); }
        getPortsRequired(host) { return this.ns.getServerNumPortsRequired(host); }
        getRequiredHackingLevel(host) { return this.ns.getServerRequiredHackingLevel(host); }
        getSecurityLevel(host) { return this.ns.getServerSecurityLevel(host); }
        getMinSecurityLevel(host) { return this.ns.getServerMinSecurityLevel(host); }

        getServer(host) {
            if (!this.cache[host]) {
                this.cache[host] = this.ns.getServer(host);
            }
            return this.cache[host];
        }

        clearCache() {
            this.cache = {};
        }
    }

    const serverInfo = new ServerManager(ns);

    async function updateExes() {
        exes = HACK_COMMANDS.filter(cmd => ns.fileExists(`${cmd}.exe`));
    }

    // 日志显示设置
    const LOG_SETTINGS = {
        level: 3,                    // 日志级别 1-ERROR, 2-INFO, 3-DEBUG
        tabWidth: 1,                 // 制表符宽度(字符数)
        setLevel: (lvl) => LOG_SETTINGS.level = lvl,
        setTabWidth: (width) => LOG_SETTINGS.tabWidth = Math.max(1, width)
    };

    function generateLog(level = 2) {
        if (level > LOG_SETTINGS.level) return;
        if (CYCLE[0] >= 8) CYCLE[0] = 0;
        CYCLE[0]++;
        ns.clearLog();

        // 动态计算表格列宽
        const colWidths = {
            cycle: 3 * LOG_SETTINGS.tabWidth,
            target: 17 * LOG_SETTINGS.tabWidth,
            security: 10 * LOG_SETTINGS.tabWidth,
            progress: 20 * LOG_SETTINGS.tabWidth
        };

        // 绘制表格顶部
        ns.print(`╔${'═'.repeat(colWidths.cycle)}╦${'═'.repeat(colWidths.target)}╦${'═'.repeat(colWidths.security)}╦${'═'.repeat(colWidths.progress)}╗`);
        ns.print(`║ ${CYCLE[CYCLE[0]].toString().padEnd(colWidths.cycle - 2)} ║ ${'TARGETS'.padStart(colWidths.target / 2 + 3).padEnd(colWidths.target - 2)} ║ ${'SECURITY'.padStart(colWidths.security / 2).padEnd(colWidths.security - 2)} ║ ${'PROGRESS & FUNDS'.padStart(colWidths.progress / 2 + 4).padEnd(colWidths.progress - 2)} ║`);
        ns.print(`╠${'═'.repeat(colWidths.cycle)}╬${'═'.repeat(colWidths.target)}╬${'═'.repeat(colWidths.security)}╬${'═'.repeat(colWidths.progress)}╣`);

        const topTargets = targets.slice(0, targets.length);
        topTargets.slice(0, 100).forEach(t => {
            const maxMoney = serverInfo.getMaxMoney(t[1]);
            const currentMoney = serverInfo.getMoneyAvailable(t[1]);
            const ratio = currentMoney / maxMoney || 0;

            const filled = Math.floor(ratio * 10);
            const progressBar = '█'.repeat(filled) + '░'.repeat(10 - filled);

            const funds = `$${ns.formatNumber(currentMoney, 1).padEnd(6)}` || '_'.repeat(6);
            const sec = 1 - serverInfo.getMinSecurityLevel(t[1]) / serverInfo.getSecurityLevel(t[1]) || 0;
            const filled1 = Math.floor(sec * 8);
            const progressBar1 = '■'.repeat(filled1) + '□'.repeat(8 - filled1);

            ns.print(`║ ${(act[t[1]] || ' ').padEnd(colWidths.cycle - 2)} ║ ${truncate(t[1]).padEnd(colWidths.target - 2)} ║ ${progressBar1.padEnd(colWidths.security - 2)} ║ ${progressBar} ${funds.padEnd(colWidths.progress - 13)} ║`);
        });

        // 绘制表格底部
        ns.print(`╠${'═'.repeat(colWidths.cycle)}╩${'═'.repeat(colWidths.target)}╩${'═'.repeat(colWidths.security)}╩${'═'.repeat(colWidths.progress)}╣`);

        const exeStatus = HACK_COMMANDS.map(cmd =>
            exes.includes(cmd) ? '■' : '□'
        ).join('');

        const hostStats = [
            `HN:${ns.hacknet.numNodes()}`,
            `SV:${ns.getPurchasedServers().length}`,
            `UP:${hosts.filter(h => h[1] !== 'home').length}`,
            `TG:${targets.length}`
        ].join('  ');

        ns.print(`║ EXE:${exeStatus} ${hostStats.padEnd(colWidths.cycle + colWidths.target + colWidths.security + colWidths.progress - 8)}║`);
        ns.print(`╚${'═'.repeat(colWidths.cycle + colWidths.target + colWidths.security + colWidths.progress + 3)}╝`);
    }

    /**
     * 递归扫描网络并处理服务器
     * @param {string} host 父服务器名(用于避免重复扫描)
     * @param {string} current 当前扫描的服务器
     * @param {number} depth 当前递归深度
     * @param {number} maxDepth 最大递归深度(防止无限递归)
     * 功能:
     * 1. 破解并入侵可访问的服务器
     * 2. 收集有效目标服务器
     * 3. 收集可用主机资源
     */
    async function scanNetwork(host, current, depth = 0, maxDepth = 10) {
        if (depth > maxDepth) return;
        try {
            for (const server of ns.scan(current)) {
                if (host === server || EXCLUDE.includes(server)) continue;

                try {
                    const isPurchased = ns.getPurchasedServers().includes(server);
                    if (!isPurchased && serverInfo.getPortsRequired(server) <= exes.length) {
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

                    if (serverInfo.getMaxMoney(server) > 0 &&
                        serverInfo.getRequiredHackingLevel(server) <= ns.getHackingLevel() &&
                        serverInfo.getMinSecurityLevel(server) < 100) {
                        targets.push([Math.floor(serverInfo.getMaxMoney(server) / serverInfo.getMinSecurityLevel(server)), server]);
                    }

                    if (serverInfo.getMaxRam(server) > 4 && !EXCLUDE.includes(server)) {
                        hosts.push([serverInfo.getMaxRam(server), server]);
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
            throw e;
        }
    }

    /**
     * 计算hack脚本的最佳线程数
     * @param {string} target 目标服务器名
     * @param {number} freeRam 可用RAM(GB)
     * @param {number} _cores CPU核心数(未使用)
     * @returns {number} 推荐线程数
     * 算法:
     * 1. 基于可用RAM计算最大可能线程数
     * 2. 基于安全百分比(70%)计算安全线程数
     * 3. 返回两者中较小值
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

    function calculateWeakenThreads(target, freeRam, cores) {
        const scriptRam = ns.getScriptRam(FILES[1]);
        const securityDiff = serverInfo.getSecurityLevel(target) - serverInfo.getMinSecurityLevel(target);
        const threadsNeeded = Math.ceil(securityDiff / (0.05 * cores));
        const possibleThreads = Math.floor(freeRam / scriptRam);
        return Math.min(threadsNeeded, possibleThreads);
    }

    function calculateGWThreads(target, freeRam, cores) {
        const growRam = ns.getScriptRam(FILES[0]);
        const weakenRam = ns.getScriptRam(FILES[1]);
        let remainingRam = freeRam;

        let growThreads = 0;
        const currentMoney = serverInfo.getMoneyAvailable(target);
        const maxMoney = serverInfo.getMaxMoney(target);
        if (currentMoney < maxMoney * 0.8 && currentMoney > 0) {
            const growFactor = (maxMoney * 0.8) / currentMoney;
            growThreads = Math.ceil(ns.growthAnalyze(target, growFactor, cores));
            growThreads = Math.min(growThreads, Math.floor(remainingRam * 0.7 / growRam));
            remainingRam -= growThreads * growRam;
        }

        let weakenThreads = 0;
        const securityDiff = serverInfo.getSecurityLevel(target) - serverInfo.getMinSecurityLevel(target);
        if (securityDiff > 0) {
            weakenThreads = Math.ceil(securityDiff / (0.05 * cores));
            weakenThreads = Math.min(weakenThreads, Math.floor(remainingRam / weakenRam));
        }

        return [growThreads, weakenThreads];
    }

    function hasEnoughResources(host, script, threads) {
        const scriptRam = ns.getScriptRam(script);
        const freeRam = serverInfo.getMaxRam(host) - serverInfo.getUsedRam(host);
        return freeRam >= scriptRam * threads;
    }

    /**
     * 错误处理函数
     * @param {string} error 错误信息
     * 功能:
     * 1. 在日志中打印错误信息
     * 2. 显示toast通知
     * 3. 使用统一格式便于识别
     */
    function handleError(error) {
        ns.print(`⚠️ 严重错误: ${error}`);
        ns.toast(`⚠️ 自动黑客脚本错误: ${error}`, 'error', 2000);
    }

    /**
     * 性能监控包装函数
     * @param {NS} ns 游戏API对象
     * @param {string} label 性能标签
     * @param {Function} fn 被监控的函数
     * @returns {Function} 包装后的函数
     * 功能:
     * 1. 记录函数执行时间
     * 2. 输出性能日志
     * 3. 不影响原函数逻辑
     */
    function withTiming(ns, label, fn) {
        return async function (...args) {
            const start = Date.now();
            try {
                return await fn.apply(this, args);
            } finally {
                ns.print(`[PERF] ${label} took ${Date.now() - start}ms`);
            }
        };
    }

    /**
     * 改进的资源分配函数(带性能监控)
     * 根据目标服务器状态自动分配hack/grow/weaken脚本
     * 逻辑流程:
     * 1. 检查目标服务器资金状态
     * 2. 检查目标服务器安全等级
     * 3. 根据可用RAM计算最优线程数
     * 4. 执行相应操作
     */
    const allocateResourcesImproved = withTiming(ns, '资源分配', async function () {
        for (const [_, host] of hosts) {
            if (host === 'home') continue;

            if (tarIndex >= targets.length) {
                tarIndex = 0;
                loop = true;
            }

            const target = targets[tarIndex][1];
            const freeRam = serverInfo.getMaxRam(host) - serverInfo.getUsedRam(host);
            const server = ns.getServer(host);
            const cores = server.cpuCores || 1;

            if (serverInfo.getMoneyAvailable(target) < serverInfo.getMaxMoney(target) * 0.8) {
                hType = 0;
            } else if (serverInfo.getSecurityLevel(target) > serverInfo.getMinSecurityLevel(target) + 5 || loop) {
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
    });

    // 主循环控制变量
    let cycles = 0; // 循环计数器，用于定期清理缓存

    /**
     * 主执行循环
     * 每轮循环执行:
     * 1. 定期清理缓存(每10次循环)
     * 2. 更新可执行工具列表
     * 3. 扫描网络并收集目标
     * 4. 分配资源进行攻击
     * 5. 生成状态日志
     * 6. 错误处理和恢复
     */
    while (true) {
        if (cycles++ % 10 === 0) {
            serverInfo.clearCache();
        }

        servers = [];
        targets = [];
        hosts = [[Math.max(serverInfo.getMaxRam('home') - 50, 0), 'home']];
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
            await ns.sleep(5000);
        }
        ns.ui.resizeTail(570, Math.min((targets.length * 24) + 180, 20 * 24 + 180));
        await ns.sleep(100);
    }
}
