/** @param {NS} ns**/
export async function main(ns) {
    ns.atExit(() => ns.ui.closeTail());
    ns.disableLog('ALL');
    ns.ui.setTailTitle(`AutoHack v3.0 [${ns.getScriptName()}]`);
    ns.ui.openTail();
    const [W, H] = ns.ui.windowSize();
    ns.ui.moveTail(W * 0.6, H * 0);

    // ANSI 颜色配置 (Bitburner支持)
    const COLORS = {
        reset: '\x1b[0m',       // 重置颜色
        border: '\x1b[38;5;240m', // 灰色边框
        header: '\x1b[33m',     // 黄色表头
        progress: '\x1b[36m',   // 青色进度条
        progressBg: '\x1b[38;5;240m', // 灰色背景
        funds: '\x1b[32m',      // 绿色资金
        security: '\x1b[38;5;208m', // 橙色安全
        securityBg: '\x1b[38;5;240m', // 灰色背景
        success: '\x1b[32m',    // 绿色成功
        warning: '\x1b[33m',    // 黄色警告
        danger: '\x1b[31m',     // 红色危险
        info: '\x1b[35m',       // 蓝色信息
        exeReady: '\x1b[32m',   // 绿色已安装
        exeMissing: '\x1b[31m'  // 红色未安装
    };

    // 脚本文件配置
    const FILES = ['grow.script', 'weak.script', 'hack.script']; // 三种操作脚本
    let EXCLUDE = []; // 排除的服务器列表
    const CYCLE = ['▁▂▃▄▅▆▇█'];
    let currentCycleIndex = 0;
    let currentAnimationType = 0;
    const ANIMATION_CYCLE = 100; // 每100次循环切换一次动画类型
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

    let servers = [],
        hosts = [[Math.max(ns.getServerMaxRam('home') - 50, 0), 'home']],
        targets = [],
        exes = [],
        tarIndex = 0,
        loop = false,
        hType = 0,
        act = {};
    const sortDesc = arr => arr ? arr.sort((a, b) => b[0] - a[0]) : [];
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
            this.statsCache = {};
            this.lastUpdated = {};
        }

        // 批量获取服务器信息
        batchGetServers(hosts) {
            const now = Date.now();
            const results = {};

            // 先从缓存获取有效数据
            hosts.forEach(host => {
                if (this.cache[host] && now - (this.lastUpdated[host] || 0) < 5000) {
                    results[host] = this.cache[host];
                }
            });

            // 获取需要更新的服务器
            const toUpdate = hosts.filter(host => !results[host]);
            toUpdate.forEach(host => {
                this.cache[host] = this.ns.getServer(host);
                this.lastUpdated[host] = now;
                results[host] = this.cache[host];
            });

            return results;
        }

        // 常用统计信息的快捷访问方法
        getMaxMoney(host) { // 获取最大资金
            return this._getCachedStat(host, 'maxMoney', () => this.ns.getServerMaxMoney(host));
        }
        getMoneyAvailable(host) { // 获取可用资金
            return this._getCachedStat(host, 'moneyAvailable', () => this.ns.getServerMoneyAvailable(host));
        }
        getMaxRam(host) {   // 获取最大RAM  
            return this._getCachedStat(host, 'maxRam', () => this.ns.getServerMaxRam(host));
        }
        getUsedRam(host) {  // 获取已用RAM
            return this._getCachedStat(host, 'usedRam', () => this.ns.getServerUsedRam(host));
        }
        getPortsRequired(host) {    // 获取所需端口数
            return this._getCachedStat(host, 'portsRequired', () => this.ns.getServerNumPortsRequired(host));
        }
        getRequiredHackingLevel(host) { // 获取所需破解等级
            return this._getCachedStat(host, 'requiredHackingLevel', () => this.ns.getServerRequiredHackingLevel(host));
        }
        getSecurityLevel(host) {      // 获取安全等级
            return this._getCachedStat(host, 'securityLevel', () => this.ns.getServerSecurityLevel(host));
        }
        getMinSecurityLevel(host) { // 获取最小安全等级
            return this._getCachedStat(host, 'minSecurityLevel', () => this.ns.getServerMinSecurityLevel(host));
        }

        // 获取完整服务器对象
        getServer(host) {
            if (!this.cache[host]) {
                this.cache[host] = this.ns.getServer(host);
                this.lastUpdated[host] = Date.now();
            }
            return this.cache[host];
        }

        // 内部缓存方法
        _getCachedStat(host, statName, getter) {
            const now = Date.now();
            if (!this.statsCache[host] ||
                !this.statsCache[host][statName] ||
                now - (this.lastUpdated[host] || 0) > 3000) {

                if (!this.statsCache[host]) this.statsCache[host] = {};
                this.statsCache[host][statName] = getter();
                this.lastUpdated[host] = now;
            }
            return this.statsCache[host][statName];
        }

        // 清理缓存
        clearCache() {
            this.cache = {};
            this.statsCache = {};
            this.lastUpdated = {};
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
        setLevel: (lvl) => LOG_SETTINGS.level = lvl, // 设置日志级别
        setTabWidth: (width) => LOG_SETTINGS.tabWidth = Math.max(1, width) // 设置制表符宽度
    };

    // 预计算表格边框模板
    const BORDER_TEMPLATES = (() => {
        const colWidths = {
            cycle: 3 * LOG_SETTINGS.tabWidth,
            target: 17 * LOG_SETTINGS.tabWidth,
            security: 10 * LOG_SETTINGS.tabWidth,
            progress: 20 * LOG_SETTINGS.tabWidth
        };

        const topBorder = `╔${'═'.repeat(colWidths.cycle)}╦${'═'.repeat(colWidths.target)}╦${'═'.repeat(colWidths.security)}╦${'═'.repeat(colWidths.progress)}╗`;
        const header = `║ ${' '.repeat(colWidths.cycle - 2)} ║ ${'TARGETS'.padStart(colWidths.target / 2 + 3).padEnd(colWidths.target - 2)} ║ ${'SECURITY'.padStart(colWidths.security / 2).padEnd(colWidths.security - 2)} ║ ${'PROGRESS & FUNDS'.padStart(colWidths.progress / 2 + 4).padEnd(colWidths.progress - 2)} ║`;
        const divider = `╠${'═'.repeat(colWidths.cycle)}╬${'═'.repeat(colWidths.target)}╬${'═'.repeat(colWidths.security)}╬${'═'.repeat(colWidths.progress)}╣`;

        return { topBorder, header, divider, colWidths };
    })();

    function generateLog(level = 2) {
        if (level > LOG_SETTINGS.level) return;
        if (cycles % ANIMATION_CYCLE === 0) {
            currentAnimationType = (currentAnimationType + 1) % CYCLE.length;
        }
        currentCycleIndex = (currentCycleIndex + 1) % CYCLE[currentAnimationType].length;
        ns.clearLog();

        // 使用预计算的模板
        ns.print(BORDER_TEMPLATES.topBorder);
        const cycleChar = CYCLE[currentAnimationType][currentCycleIndex];
        ns.print(`║ ${cycleChar.toString().padEnd(BORDER_TEMPLATES.colWidths.cycle - 2)} ║ ${'TARGETS'.padStart(BORDER_TEMPLATES.colWidths.target / 2 + 3).padEnd(BORDER_TEMPLATES.colWidths.target - 2)} ║ ${'SECURITY'.padStart(BORDER_TEMPLATES.colWidths.security / 2).padEnd(BORDER_TEMPLATES.colWidths.security - 2)} ║ ${'PROGRESS & FUNDS'.padStart(BORDER_TEMPLATES.colWidths.progress / 2 + 4).padEnd(BORDER_TEMPLATES.colWidths.progress - 2)} ║`);
        ns.print(BORDER_TEMPLATES.divider);

        const topTargets = targets.slice(0, targets.length);
        topTargets.slice(0, 20).forEach(t => {
            const maxMoney = serverInfo.getMaxMoney(t[1]);
            const currentMoney = serverInfo.getMoneyAvailable(t[1]);
            const ratio = currentMoney / maxMoney || 0;

            const filled = Math.floor(ratio * 10);
            const progressBar =
                COLORS.progress + '█'.repeat(filled) +
                COLORS.progressBg + '░'.repeat(10 - filled) +
                COLORS.reset;

            const funds = COLORS.funds + '$' + ns.formatNumber(currentMoney, 1).padEnd(6) + COLORS.reset || '_'.repeat(6);

            const sec = 1 - serverInfo.getMinSecurityLevel(t[1]) / serverInfo.getSecurityLevel(t[1]) || 0;
            const filled1 = Math.floor(sec * 8);
            const progressBar1 =
                COLORS.security + '■'.repeat(filled1) +
                COLORS.securityBg + '□'.repeat(8 - filled1) +
                COLORS.reset;

            ns.print(`║ ${(act[t[1]] || ' ').padEnd(BORDER_TEMPLATES.colWidths.cycle - 2)} ║ ${truncate(t[1]).padEnd(BORDER_TEMPLATES.colWidths.target - 2)} ║ ${progressBar1.padEnd(BORDER_TEMPLATES.colWidths.security - 2)} ║ ${progressBar} ${funds.padEnd(BORDER_TEMPLATES.colWidths.progress - 13)} ║`);
        });

        // 绘制表格底部
        ns.print(`╠${'═'.repeat(BORDER_TEMPLATES.colWidths.cycle)}╩${'═'.repeat(BORDER_TEMPLATES.colWidths.target)}╩${'═'.repeat(BORDER_TEMPLATES.colWidths.security)}╩${'═'.repeat(BORDER_TEMPLATES.colWidths.progress)}╣`);

        const exeStatus = HACK_COMMANDS.map(cmd =>
            (exes.includes(cmd) ? COLORS.exeReady : COLORS.exeMissing) +
            (exes.includes(cmd) ? '■' : '□') +
            COLORS.reset
        ).join('');

        const hostStats = [
            COLORS.info + 'HN:' + ns.hacknet.numNodes() + COLORS.reset,
            COLORS.info + 'SV:' + ns.getPurchasedServers().length + COLORS.reset,
            COLORS.info + 'UP:' + hosts.filter(h => h[1] !== 'home').length + COLORS.reset,
            COLORS.info + 'TG:' + targets.length + COLORS.reset
        ].join(' | ');

        ns.print(`║ EXE:${exeStatus} ${hostStats.padEnd(BORDER_TEMPLATES.colWidths.cycle + BORDER_TEMPLATES.colWidths.target + BORDER_TEMPLATES.colWidths.security + BORDER_TEMPLATES.colWidths.progress + 28)}║`);
        ns.print(`╚${'═'.repeat(BORDER_TEMPLATES.colWidths.cycle + BORDER_TEMPLATES.colWidths.target + BORDER_TEMPLATES.colWidths.security + BORDER_TEMPLATES.colWidths.progress + 3)}╝`);
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
    async function scanNetwork(host, current, depth = 0, maxDepth = 10, visited = new Set()) {
        if (depth > maxDepth || visited.has(current)) return;
        visited.add(current);

        try {
            const scanned = ns.scan(current);
            const validServers = scanned.filter(server =>
                server !== host && !EXCLUDE.includes(server)
            );

            // 批量获取服务器信息
            const serverData = serverInfo.batchGetServers(validServers);

            for (const server of validServers) {
                try {
                    const isPurchased = ns.getPurchasedServers().includes(server);
                    const serverObj = serverData[server];

                    if (!isPurchased && serverObj.numOpenPortsRequired <= exes.length) {
                        // 批量执行破解命令
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

                    // 筛选有效目标服务器
                    if (serverObj.moneyMax > 0 &&
                        serverObj.requiredHackingSkill <= ns.getHackingLevel() &&
                        serverObj.minDifficulty < 100) {
                        const moneyCurrent = serverInfo.getMoneyAvailable(server);
                        const securityCurrent = serverInfo.getSecurityLevel(server);
                        const playerHackLevel = ns.getHackingLevel();

                        // 综合评分公式
                        const score =
                            (moneyCurrent / serverObj.moneyMax * serverObj.moneyMax) * 0.6 +  // 当前资金潜力
                            (1 / (securityCurrent - serverObj.minDifficulty + 1)) * 0.3 +     // 安全系数
                            (1 / (serverObj.requiredHackingSkill - playerHackLevel + 10)) * 0.1;  // 等级匹配度

                        targets.push([score, server]);
                    }

                    // 收集可用主机
                    if (serverObj.maxRam > 4 && !EXCLUDE.includes(server)) {
                        hosts.push([serverObj.maxRam, server]);
                    }
                    // 复制脚本到目标服务器
                    servers.push(server);
                    try {
                        ns.scp(FILES, server, 'home');
                    } catch (e) {
                        handleError(`文件复制失败: ${e}`);
                    }

                    // 递归扫描
                    await scanNetwork(current, server, depth + 1, maxDepth, visited);
                } catch (e) {
                    handleError(`服务器${server}处理失败: ${e}`);
                }
            }

            // 排序目标服务器和主机
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
        // 使用ServerManager缓存脚本RAM
        const scriptRam = serverInfo._getCachedStat('global', 'hackScriptRam',
            () => ns.getScriptRam(FILES[2]));
        if (scriptRam <= 0) return 0;

        // 边界检查
        if (freeRam <= 0) return 0;

        // 计算最大可能线程数
        const maxThreads = Math.max(0, Math.floor(freeRam / scriptRam));

        // 缓存hack分析结果
        const hackPerThread = serverInfo._getCachedStat(target, 'hackPerThread',
            () => ns.hackAnalyze(target));
        if (hackPerThread <= 0) return 0;

        // 优化百分比计算逻辑
        const desiredPercentage = 0.7;
        const maxSafeThreads = Math.min(
            Math.floor(desiredPercentage / hackPerThread),
            100 // 添加上限防止无限循环
        );

        // 返回安全线程数
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
        // 使用缓存获取脚本RAM
        const growRam = serverInfo._getCachedStat('global', 'growScriptRam',
            () => ns.getScriptRam(FILES[0]));
        const weakenRam = serverInfo._getCachedStat('global', 'weakScriptRam',
            () => ns.getScriptRam(FILES[1]));

        let remainingRam = freeRam;
        let growThreads = 0;

        // 获取并缓存资金和安全性数据
        const moneyData = {
            current: serverInfo.getMoneyAvailable(target),
            max: serverInfo.getMaxMoney(target)
        };
        const securityData = {
            current: serverInfo.getSecurityLevel(target),
            min: serverInfo.getMinSecurityLevel(target)
        };

        // 优化资金增长计算
        if (moneyData.current < moneyData.max * 0.8 && moneyData.current > 0) {
            const cachedGrowth = serverInfo._getCachedStat(target, 'growthFactor',
                () => ns.growthAnalyze(target, (moneyData.max * 0.8) / moneyData.current, cores));

            growThreads = Math.min(
                Math.ceil(cachedGrowth),
                Math.floor(freeRam * 0.7 / growRam)
            );
            remainingRam -= growThreads * growRam;
        }

        // 优化安全削弱计算
        let weakenThreads = 0;
        const securityDiff = securityData.current - securityData.min;
        if (securityDiff > 0) {
            weakenThreads = Math.min(
                Math.ceil(securityDiff / (0.05 * cores)),
                Math.floor(remainingRam / weakenRam)
            );
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
        // 批量获取主机信息
        const hostData = serverInfo.batchGetServers(hosts.map(h => h[1]));

        for (const [ram, host] of hosts) {
            if (host === 'home') continue;

            if (tarIndex >= targets.length) {
                tarIndex = 0;
                loop = true;
            }

            const target = targets[tarIndex][1];
            const hostObj = hostData[host];
            const freeRam = hostObj.maxRam - hostObj.ramUsed;
            const cores = hostObj.cpuCores || 1;

            // 获取目标服务器状态
            const targetMoney = serverInfo.getMoneyAvailable(target);
            const maxMoney = serverInfo.getMaxMoney(target);
            const securityLevel = serverInfo.getSecurityLevel(target);
            const minSecurity = serverInfo.getMinSecurityLevel(target);

            if (targetMoney < maxMoney * 0.8) {
                hType = 0;
            } else if (securityLevel > minSecurity + 5 || loop) {
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

            if (!loop) act[target] = [
                `${COLORS.success}G${COLORS.reset}`,
                `${COLORS.warning}W${COLORS.reset}`,
                `${COLORS.info}H${COLORS.reset}`
            ][hType];
            tarIndex++;
        }
    });

    // 主循环控制变量
    let cycles = 0; // 循环计数器
    let lastTargetCount = 0;
    let sleepTime = 1000; // 初始sleep时间

    /**
     * 主执行循环
     * 每轮循环执行:
     * 1. 定期清理缓存(每20次循环)
     * 2. 更新可执行工具列表
     * 3. 扫描网络并收集目标
     * 4. 分配资源进行攻击
     * 5. 生成状态日志
     * 6. 错误处理和恢复
     */
    while (true) {
        // 减少缓存清理频率
        if (cycles++ % 20 === 0) {
            serverInfo.clearCache();
        }

        // 只重置必要的变量
        targets = [];
        hosts = [[Math.max(serverInfo.getMaxRam('home') - 50, 0), 'home']];
        tarIndex = 0;
        loop = false;

        // 缓存排除列表
        if (cycles === 1) {
            EXCLUDE = [...Array.from(
                { length: ns.hacknet.numNodes() },
                (_, i) => ns.hacknet.getNodeStats(i).name
            )];
        }

        try {
            await updateExes();
            await scanNetwork('', 'home');
            await allocateResourcesImproved();
            generateLog();
        } catch (e) {
            handleError(`主循环错误: ${e}`);
            sleepTime = 5000; // 错误时延长等待
        }

        ns.ui.resizeTail(570, Math.min((targets.length * 24) + 180, 20 * 24 + 180));
        await ns.sleep(sleepTime);
    }
}
