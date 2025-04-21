/** @param {NS} ns */
export async function main(ns) {
    // ===================== 配置部分 ===================== 
    ns.disableLog("ALL");   // 禁用所有日志以保持控制台整洁
    ns.ui.openTail();       // 打开脚本日志窗口方便查看运行状态
    ns.atExit(() => ns.ui.closeTail());
    ns.ui.setTailTitle(`🗡AutoHack v2.0 [${ns.getScriptName()}]`);
    ns.ui.resizeTail(600, 800);

    // 常量配置 - 控制脚本行为的各种参数
    const CONFIG = {
        // 主服务器名称
        HOME_SERVER: "home",  // 主服务器名称
        SCRIPTS: {            // 使用的脚本文件名配置
            HACK: "autoHack.js",   // 入侵脚本
            GROW: "autoGrow.js",   // 增长脚本  
            WEAKEN: "autoWeaken.js" // 削弱脚本
        },
        LOG_LEVEL: "INFO",    // 日志级别: DEBUG/INFO/WARN/ERROR
        THREAD_STRATEGY: "DYNAMIC_AI", // 线程策略: DYNAMIC_AI/ADAPTIVE/BALANCED
        HACK_RATIO: 0.5,           // 入侵基础比例
        LEARNING_RATE: 0.01,       // 学习率
        DECAY_FACTOR: 0.95,        // 收益衰减因子
        COLORS: {                  // 颜色配置 - 使用语义化名称和分组
            DASHBOARD: {           // 仪表盘颜色组
                TITLE: "\u001b[38;5;45m",     // 亮青色 - 标题/主信息
                BORDER: "\u001b[38;5;240m",   // 深灰色 - 边框/分隔线
                STATS: "\u001b[38;5;220m",    // 亮黄色 - 统计数据/数值
                WARNING: "\u001b[38;5;196m",  // 亮红色 - 警告/错误信息
                SUCCESS: "\u001b[38;5;46m",   // 亮绿色 - 成功/完成状态
                NORMAL: "\u001b[38;5;255m",   // 亮白色 - 普通文本
                HIGHLIGHT: "\u001b[1;38;5;226m", // 亮黄加粗 - 强调文本
                SECONDARY: "\u001b[38;5;244m" // 中灰色 - 次要信息
            },
            TARGETS: {             // 目标服务器颜色组
                HIGH_VALUE: "\u001b[38;5;129m",   // 亮紫色 - 高价值目标(评分>1M)
                MEDIUM_VALUE: "\u001b[38;5;33m",  // 亮蓝色 - 中等价值(100K<评分≤1M)
                LOW_VALUE: "\u001b[38;5;87m",     // 亮青色 - 低价值目标(评分≤100K)
                DEFAULT: "\u001b[38;5;255m",      // 亮白色 - 默认目标颜色
                SPECIAL: "\u001b[38;5;208m"       // 橙色 - 特殊目标
            },
            ACTIONS: {             // 新增: 操作类型颜色组
                HACK: "\u001b[31m",        // 红色 - 入侵操作
                GROW: "\u001b[32m",        // 绿色 - 增长操作  
                WEAKEN: "\u001b[33m",      // 黄色 - 削弱操作
                INFO: "\u001b[36m"         // 青色 - 信息性操作
            }
        },
        SECURITY_THRESHOLD: 5,     // 安全等级阈值(超过最小值多少时需要削弱)
        MONEY_THRESHOLD: 0.9,      // 金钱比例阈值(低于最大值多少时需要增长)
        MIN_SECURITY_LEVEL: 2,     // 最低安全等级(低于此值不再削弱)
        MAX_RETRIES: 3,            // 最大重试次数
        RETRY_DELAY: 5000,         // 重试延迟(毫秒)
        SCAN_INTERVAL: 1000,       // 服务器扫描间隔(毫秒)
        ACTION_INTERVAL: 1000,     // 攻击行动间隔(毫秒)
        MAX_TARGETS: 63,           // 同时攻击的最大目标数 
        RESERVE_RAM: 16            // 为系统保留的RAM(GB)
    };

    // ===================== 配套脚本定义 ===================== 
    // 定义三个基本攻击脚本的内容，如果不存在会自动创建
    const SCRIPTS_CONTENT = {
        [CONFIG.SCRIPTS.HACK]: `/** @param {NS} ns */
        export async function main(ns) {
            await ns.hack(ns.args[0]);  
        }`,

        [CONFIG.SCRIPTS.GROW]: `/** @param {NS} ns */
        export async function main(ns) {
            await ns.grow(ns.args[0]);  
        }`,

        [CONFIG.SCRIPTS.WEAKEN]: `/** @param {NS} ns */
        export async function main(ns) {
            await ns.weaken(ns.args[0]);  
        }`
    };

    // ===================== 核心功能 ===================== 
    /**
     * 自动化攻击管理类 - 负责扫描服务器、选择目标、执行攻击策略
     * 包含完整的攻击逻辑和状态管理
     */
    class BotManager {
        /** 
         * 构造函数
         * @param {NS} ns - Bitburner API 命名空间
         * @param {Object} config - 配置对象
         */
        constructor(ns, config) {
            this.ns = ns;
            this.config = config;
            this.serverCache = [];
            this.targetCache = [];
            this.lastScanTime = 0;
            this.lastTargetUpdateTime = 0;
            this.scriptRamCache = {};
            this.stats = {
                totalHacks: 0,
                totalGrows: 0,
                totalWeakens: 0,
                totalMoney: 0,
                startTime: Date.now()
            };
        }

        /**
         * 根据日志级别打印消息
         * @param {string} level - 日志级别
         * @param {string} message - 日志消息
         */
        log(level, message) {
            const levels = ["DEBUG", "INFO", "WARN", "ERROR"];
            if (levels.indexOf(level) >= levels.indexOf(this.config.LOG_LEVEL)) {
                this.ns.print(`${level}: ${message}`);
            }
        }

        /**
         * 获取服务器实时状态
         * @param {string} server 服务器名称
         * @param {number} minSecurity 最低安全等级
         * @returns {Object} 包含moneyRatio和securityDiff的对象
         */
        getServerStatus(server, minSecurity) {
            return {
                moneyRatio: this.ns.getServerMoneyAvailable(server) / this.ns.getServerMaxMoney(server),
                securityDiff: this.ns.getServerSecurityLevel(server) - minSecurity
            };
        }

        /**
         * 计算动态线程总数
         * @param {string} server 目标服务器
         * @returns {number} 可用总线程数
         */
        calculateDynamicThreads(server) {
            const availableRam = Math.max(0,
                this.ns.getServerMaxRam(this.config.HOME_SERVER) -
                this.ns.getServerUsedRam(this.config.HOME_SERVER) -
                this.config.RESERVE_RAM);

            // 获取三种脚本的实际RAM使用量
            const hackRam = this.getScriptRam(this.config.SCRIPTS.HACK);
            const growRam = this.getScriptRam(this.config.SCRIPTS.GROW);
            const weakenRam = this.getScriptRam(this.config.SCRIPTS.WEAKEN);

            // 计算最小公倍数RAM，确保线程分配更精确
            const lcmRam = Math.max(hackRam, growRam, weakenRam);

            // 基于最耗RAM的脚本计算最大线程数
            return Math.max(1, Math.floor(availableRam / lcmRam));
        }

        /**
         * 计算Q值（动作价值）
         * @param {string} server 目标服务器
         * @param {number} moneyRatio 当前资金比例
         * @param {number} securityDiff 安全等级差异
         * @returns {Object} 各动作的权重值
         */
        calculateQValues(server, moneyRatio, securityDiff) {
            // 基础Q值 - 考虑服务器难度系数
            const serverDifficulty = this.ns.getServerRequiredHackingLevel(server) / 
                                   this.ns.getHackingLevel();
            const difficultyFactor = Math.min(1, 1 / (1 + serverDifficulty));

            let qValues = {
                weaken: 0.4 + (securityDiff / 10) * difficultyFactor,
                grow: 0.3 + ((1 - moneyRatio) / 3) * difficultyFactor,
                hack: 0.3 + (moneyRatio / 3) * difficultyFactor
            };

            // 应用学习率
            const learningRate = this.config.LEARNING_RATE;
            qValues.weaken *= 1 + learningRate * (securityDiff > 0 ? 1 : -1);
            qValues.grow *= 1 + learningRate * (moneyRatio < 0.9 ? 1 : -1);
            qValues.hack *= 1 + learningRate * (moneyRatio > 0.5 ? 1 : -1);

            // 标准化
            const total = qValues.weaken + qValues.grow + qValues.hack;
            qValues.weaken /= total;
            qValues.grow /= total;
            qValues.hack /= total;

            return qValues;
        }

        /**
         * 应用线程分配策略
         * @param {number} totalThreads 总线程数
         * @param {number} weakenWeight 削弱权重
         * @param {number} growWeight 增长权重 
         * @param {number} hackWeight 入侵权重
         * @returns {Object} 各动作线程数
         */
        applyThreadAllocation(totalThreads, weakenWeight, growWeight, hackWeight) {
            return {
                weakenThreads: Math.max(1, Math.floor(totalThreads * weakenWeight)),
                growThreads: Math.max(1, Math.floor(totalThreads * growWeight)),
                hackThreads: Math.max(1, Math.floor(totalThreads * hackWeight))
            };
        }

        /**
         * 获取所有服务器的资源统计信息
         * @returns {Object} 包含服务器资源统计的对象
         */
        async getServerStats() {
            const servers = await this.scanServers();
            const stats = {
                totalServers: 0,
                totalRam: 0,
                usedRam: 0,
                hackedServers: 0,
                hackableServers: 0
            };

            // 获取所有hacknet节点名称
            const EXCLUDE = [...Array.from(
                { length: this.ns.hacknet.numNodes() },
                (_, i) => this.ns.hacknet.getNodeStats(i).name
            )];
            EXCLUDE.push(this.config.HOME_SERVER); // 添加home服务器到排除列表

            for (const server of servers) {
                // 跳过排除列表中的服务器
                if (EXCLUDE.includes(server)) continue;

                stats.totalServers++;
                stats.totalRam += this.ns.getServerMaxRam(server);
                stats.usedRam += this.ns.getServerUsedRam(server);

                if (this.ns.hasRootAccess(server)) {
                    stats.hackedServers++;
                    if (this.ns.getServerMaxMoney(server) > 0) {
                        stats.hackableServers++;
                    }
                }
            }
            return stats;
        }

        /**
         * 显示运行状态仪表盘
         * @param {Array} targets - 当前攻击目标数组
         */
        async showDashboard(targets) {
            const now = Date.now();
            const runtime = this.ns.tFormat(now - this.stats.startTime);
            const ramUsed = this.ns.getServerUsedRam(this.config.HOME_SERVER);
            const ramMax = this.ns.getServerMaxRam(this.config.HOME_SERVER);
            const ramPercent = this.ns.formatPercent(ramUsed / ramMax, 1);
            const serverStats = await this.getServerStats();

            // 清屏并显示标题
            this.ns.clearLog();
            this.ns.print(`${this.config.COLORS.DASHBOARD.BORDER}${"=".repeat(60)}`);
            this.ns.print(`${this.config.COLORS.DASHBOARD.TITLE}🛠️ AutoHack 仪表盘 | 运行时间: ${runtime}`);
            this.ns.print(`${this.config.COLORS.DASHBOARD.STATS}📊 资源: ${this.ns.formatRam(ramUsed)}/${this.ns.formatRam(ramMax)} (${ramPercent})`);
            this.ns.print(`${this.config.COLORS.DASHBOARD.STATS}💰 总收入: ${this.ns.formatNumber(this.stats.totalMoney).padEnd(8)}`);
            this.ns.print(`${this.config.COLORS.DASHBOARD.STATS}⚡ 操作统计: 入侵 ${this.ns.formatNumber(this.stats.totalHacks).padEnd(8)} | 增长 ${this.ns.formatNumber(this.stats.totalGrows).padEnd(8)} | 削弱 ${this.ns.formatNumber(this.stats.totalWeakens).padEnd(8)}`);
            this.ns.print(`${this.config.COLORS.DASHBOARD.BORDER}${"=".repeat(60)}`);
            this.ns.print(`${this.config.COLORS.DASHBOARD.STATS}🌐 服务器统计: 总数 ${serverStats.totalServers} | 已入侵 ${serverStats.hackedServers} | 可攻击 ${serverStats.hackableServers}`);
            this.ns.print(`${this.config.COLORS.DASHBOARD.STATS}💾 总RAM: ${this.ns.formatRam(serverStats.totalRam)} | 已用 ${this.ns.formatRam(serverStats.usedRam)} | 可用 ${this.ns.formatRam(serverStats.totalRam - serverStats.usedRam)}`);
            this.ns.print(`${this.config.COLORS.DASHBOARD.BORDER}${"=".repeat(60)}`);

            // 显示目标状态
            if (targets && targets.length > 0) {
                this.ns.print(`🎯 当前目标 (${targets.length}个):`);
                const maxTargets = Math.min(20, targets.length);
                for (let i = 0; i < maxTargets; i++) {
                    const target = targets[i];
                    const money = this.ns.getServerMoneyAvailable(target.hostname);
                    const maxMoney = target.maxMoney;
                    const security = this.ns.getServerSecurityLevel(target.hostname);
                    const minSecurity = this.ns.getServerMinSecurityLevel(target.hostname);

                    // 根据目标价值选择颜色
                    const targetColor = target.score > 1000000 ? this.config.COLORS.TARGETS.HIGH_VALUE :
                        target.score > 100000 ? this.config.COLORS.TARGETS.MEDIUM_VALUE :
                            this.config.COLORS.TARGETS.LOW_VALUE;

                    this.ns.print(
                        `${targetColor}` +
                        `${i + 1}.`.padStart(3) + `${target.hostname.padEnd(20)} ` +
                        `💰:${this.ns.formatPercent(money / maxMoney, 1).padStart(5, '_')} ` +
                        `🔒:${security.toFixed(1)}/${minSecurity.toFixed(1)}`.padEnd(13) +
                        `⭐:${this.ns.formatNumber(target.score)}` +
                        `${this.config.COLORS.DASHBOARD.NORMAL}`
                    );
                }
            }
            this.ns.print(`${this.config.COLORS.DASHBOARD.BORDER}${"=".repeat(60)}`);
        }

        /**
         * 初始化必要的攻击脚本
         * @returns {Promise<boolean>} 是否初始化成功
         */
        async initialize() {
            try {
                for (const [name, content] of Object.entries(SCRIPTS_CONTENT)) {
                    if (!this.ns.fileExists(name)) {
                        this.ns.write(name, content, "w");
                        this.ns.print(`✓  已创建脚本: ${name}`);
                    }
                }
                this.ns.print(" 初始化完成");
                return true;
            } catch (error) {
                this.ns.print(`×  初始化失败: ${error}`);
                return false;
            }
        }

        /**
         * 获取脚本RAM使用量（带缓存功能）
         * @param {string} script - 脚本文件名
         * @returns {number} 脚本占用的RAM(GB)
         */
        getScriptRam(script) {
            // 添加缓存过期机制，防止长期运行后内存泄漏
            const CACHE_TTL = 60000; // 1分钟缓存
            const now = Date.now();

            if (!this.scriptRamCache[script] ||
                (now - (this.scriptRamCache[script].timestamp || 0)) > CACHE_TTL) {
                this.scriptRamCache[script] = {
                    value: this.ns.getScriptRam(script),
                    timestamp: now
                };
            }
            return this.scriptRamCache[script].value;
        }

        /**
         * 扫描所有可访问的服务器（带缓存功能）
         * @param {boolean} forceUpdate - 是否强制更新缓存
         * @returns {Promise<Array>} 服务器名称数组
         */
        async scanServers(forceUpdate = false) {
            const now = Date.now();
            if (!forceUpdate && now - this.lastScanTime < this.config.SCAN_INTERVAL && this.serverCache.length > 0) {
                return this.serverCache;
            }

            let retries = 0;
            while (retries < this.config.MAX_RETRIES) {
                try {
                    const servers = new Set([this.config.HOME_SERVER]);
                    const toScan = [this.config.HOME_SERVER];

                    while (toScan.length > 0) {
                        const hostname = toScan.pop();
                        for (const server of this.ns.scan(hostname)) {
                            if (!servers.has(server)) {
                                servers.add(server);
                                toScan.push(server);
                            }
                        }
                    }

                    this.serverCache = Array.from(servers);
                    this.lastScanTime = now;
                    return this.serverCache;
                } catch (error) {
                    retries++;
                    this.ns.print(`×  扫描失败 (${retries}/${this.config.MAX_RETRIES}):  ${error}`);
                    if (retries < this.config.MAX_RETRIES) {
                        await this.ns.sleep(this.config.RETRY_DELAY);
                    }
                }
            }
            throw new Error(`服务器扫描失败，已达最大重试次数`);
        }

        /**
         * 获取可攻击的目标服务器列表（带缓存功能）
         * @param {boolean} forceUpdate - 是否强制更新缓存
         * @returns {Promise<Array>} 目标服务器数组，按价值排序
         */
        async getTargets(forceUpdate = false) {
            const now = Date.now();
            if (!forceUpdate && now - this.lastTargetUpdateTime < this.config.SCAN_INTERVAL && this.targetCache.length > 0) {
                return this.targetCache;
            }

            try {
                const servers = await this.scanServers();
                const targets = [];

                for (const server of servers) {
                    if (server === this.config.HOME_SERVER) continue;

                    try {
                        if (!this.ns.hasRootAccess(server) && this.canNuke(server)) {
                            await this.nukeServer(server);
                        }

                        if (this.ns.hasRootAccess(server) &&
                            this.ns.getServerMaxMoney(server) > 0 &&
                            this.ns.getServerRequiredHackingLevel(server) <= this.ns.getHackingLevel()) {

                            // 计算目标价值评分 
                            const maxMoney = this.ns.getServerMaxMoney(server);
                            const hackTime = this.ns.getHackTime(server);
                            const score = maxMoney / hackTime;

                            targets.push({
                                hostname: server,
                                maxMoney: maxMoney,
                                score: score
                            });
                        }
                    } catch (error) {
                        this.ns.print(`!  处理服务器 ${server} 出错: ${error}`);
                    }
                }

                // 按评分排序 
                targets.sort((a, b) => b.score - a.score);
                this.targetCache = targets;
                this.lastTargetUpdateTime = now;

                return targets;
            } catch (error) {
                this.ns.print(`×  获取目标失败: ${error}`);
                return [];
            }
        }

        /**
         * 检查是否可以使用现有工具入侵服务器
         * @param {string} server - 服务器名称
         * @returns {boolean} 是否可以入侵
         */
        canNuke(server) {
            const ports = this.ns.getServerNumPortsRequired(server);
            let openPorts = 0;

            ["BruteSSH.exe", "FTPCrack.exe", "relaySMTP.exe", "HTTPWorm.exe", "SQLInject.exe"]
                .forEach(tool => this.ns.fileExists(tool) && openPorts++);

            return openPorts >= ports;
        }

        /**
         * 尝试入侵目标服务器
         * @param {string} server - 服务器名称
         * @returns {Promise<boolean>} 是否入侵成功
         */
        async nukeServer(server) {
            let retries = 0;
            while (retries < this.config.MAX_RETRIES) {
                try {
                    if (this.ns.fileExists("BruteSSH.exe")) this.ns.brutessh(server);
                    if (this.ns.fileExists("FTPCrack.exe")) this.ns.ftpcrack(server);
                    if (this.ns.fileExists("relaySMTP.exe")) this.ns.relaysmtp(server);
                    if (this.ns.fileExists("HTTPWorm.exe")) this.ns.httpworm(server);
                    if (this.ns.fileExists("SQLInject.exe")) this.ns.sqlinject(server);

                    this.ns.nuke(server);
                    this.ns.print(`✓  已入侵: ${server}`);
                    return true;
                } catch (error) {
                    retries++;
                    this.ns.print(`×  入侵失败 (${retries}/${this.config.MAX_RETRIES}):  ${server}`);
                    await this.ns.sleep(this.config.RETRY_DELAY);
                }
            }
            return false;
        }

        /**
         * 计算可用的线程数（考虑保留RAM和已有运行脚本）
         * @param {string} script - 脚本文件名
         * @param {string} server - 目标服务器名称
         * @returns {number} 可用线程数
         */
        calculateThreads(script, server) {
            const ramAvailable = Math.max(0,
                this.ns.getServerMaxRam(this.config.HOME_SERVER) -
                this.ns.getServerUsedRam(this.config.HOME_SERVER) -
                this.config.RESERVE_RAM);

            const ramPerThread = this.getScriptRam(script);

            return ramPerThread > 0 ? Math.max(1, Math.floor(ramAvailable / ramPerThread)) : 0;
        }

        /**
         * 将攻击脚本复制到目标服务器
         * @param {string} server - 目标服务器名称
         * @returns {Promise<boolean>} 是否复制成功
         */
        async copyScriptsToServer(server) {
            try {
                if (!this.ns.hasRootAccess(server)) return false;

                // 确保服务器有足够空间
                const scripts = Object.keys(SCRIPTS_CONTENT);
                const totalSize = scripts.reduce((sum, script) =>
                    sum + this.ns.getScriptRam(script), 0);

                if (this.ns.getServerMaxRam(server) < totalSize) return false;

                // 复制脚本
                for (const script of scripts) {
                    if (!this.ns.fileExists(script, server)) {
                        await this.ns.scp(script, server, this.config.HOME_SERVER);
                    }
                }
                return true;
            } catch (error) {
                this.ns.print(`×  复制脚本到 ${server} 失败: ${error}`);
                return false;
            }
        }

        /**
         * 在目标服务器上运行脚本
         * @param {string} script - 脚本文件名
         * @param {string} targetServer - 目标服务器名称
         * @param {number} threads - 线程数
         * @param {string} hostname - 主机名参数
         * @returns {Promise<boolean>} 是否执行成功
         */
        async runScriptOnServer(script, targetServer, threads, hostname) {
            try {
                const pid = this.ns.exec(script, targetServer, threads, hostname);
                return pid !== 0;
            } catch (error) {
                this.log("ERROR", `在 ${targetServer} 上运行 ${script} 失败: ${error}`);
                return false;
            }
        }

        /**
         * 对单个目标执行攻击策略
         * 根据目标状态自动选择最优攻击方式（削弱/增长/入侵）
         * @param {Object} target - 目标服务器对象
         */
        async attackTarget(target) {
            const MAX_ATTACK_TIME = 30000; // 30秒超时
            const startTime = Date.now();
            
            try {
                const server = target.hostname;
                
                // 检查是否超时
                if (Date.now() - startTime > MAX_ATTACK_TIME) {
                    this.log("WARN", `攻击 ${server} 超时，跳过`);
                    return;
                }
                const money = this.ns.getServerMoneyAvailable(server);
                const maxMoney = target.maxMoney;
                const security = this.ns.getServerSecurityLevel(server);
                const minSecurity = this.ns.getServerMinSecurityLevel(server);

                // 复制脚本到目标服务器
                await this.copyScriptsToServer(server);

                // 强化学习动态线程分配
                const { moneyRatio, securityDiff } = this.getServerStatus(server, minSecurity);
                const totalThreads = this.calculateDynamicThreads(server);
                const qValues = this.calculateQValues(server, moneyRatio, securityDiff);

                // 基于Q-Learning的权重分配
                let weakenWeight = qValues.weaken;
                let growWeight = qValues.grow * (1 - moneyRatio);
                let hackWeight = qValues.hack * moneyRatio;

                // 标准化权重
                const totalWeight = weakenWeight + growWeight + hackWeight;
                weakenWeight /= totalWeight;
                growWeight /= totalWeight;
                hackWeight /= totalWeight;

                // 应用动态线程分配
                let weakenThreads, growThreads, hackThreads;
                ({ weakenThreads, growThreads, hackThreads } =
                    this.applyThreadAllocation(totalThreads, weakenWeight, growWeight, hackWeight));

                // 精确RAM利用率计算
                const availableRam = this.ns.getServerMaxRam(this.config.HOME_SERVER) -
                    this.ns.getServerUsedRam(this.config.HOME_SERVER) -
                    this.config.RESERVE_RAM;

                // 计算每种操作需要的RAM和时间
                const weakenRam = this.getScriptRam(this.config.SCRIPTS.WEAKEN);
                const growRam = this.getScriptRam(this.config.SCRIPTS.GROW);
                const hackRam = this.getScriptRam(this.config.SCRIPTS.HACK);

                const weakenTime = this.ns.getWeakenTime(server);
                const growTime = this.ns.getGrowTime(server);
                const hackTime = this.ns.getHackTime(server);

                // 计算最优线程组合
                let bestScore = 0;
                let bestCombo = { w: 0, g: 0, h: 0 };

                // 尝试不同线程组合(限制在合理范围内)
                for (let w = 1; w <= Math.min(weakenThreads, 20); w++) {
                    for (let g = 1; g <= Math.min(growThreads, 20); g++) {
                        for (let h = 1; h <= Math.min(hackThreads, 20); h++) {
                            const totalRam = w * weakenRam + g * growRam + h * hackRam;
                            if (totalRam > availableRam) continue;

                            // 评分公式：考虑安全等级、金钱和效率
                            const securityImpact = w * 0.05;
                            const moneyImpact = g * (maxMoney - money) / maxMoney;
                            const hackImpact = h * this.ns.hackAnalyze(server) * money;

                            // 时间权重(更快的操作得分更高)
                            const timeWeight = 1 / (weakenTime + growTime + hackTime);

                            const score = (securityImpact + moneyImpact + hackImpact) * timeWeight;

                            if (score > bestScore) {
                                bestScore = score;
                                bestCombo = { w, g, h };
                            }
                        }
                    }
                }

                weakenThreads = bestCombo.w;
                growThreads = bestCombo.g;
                hackThreads = bestCombo.h;

                // 尝试在目标服务器上运行脚本
                if (weakenThreads > 0) {
                    await this.runScriptOnServer(this.config.SCRIPTS.WEAKEN, server, weakenThreads, server);
                }
                if (growThreads > 0) {
                    await this.runScriptOnServer(this.config.SCRIPTS.GROW, server, growThreads, server);
                }
                if (hackThreads > 0) {
                    await this.runScriptOnServer(this.config.SCRIPTS.HACK, server, hackThreads, server);
                }

                // 优先削弱 
                if (security > minSecurity + this.config.SECURITY_THRESHOLD && weakenThreads > 0) {
                    this.ns.exec(this.config.SCRIPTS.WEAKEN, this.config.HOME_SERVER, weakenThreads, server);
                    this.stats.totalWeakens += weakenThreads;
                    return;
                }

                // 其次增长 
                if (money < maxMoney * this.config.MONEY_THRESHOLD && growThreads > 0) {
                    this.ns.exec(this.config.SCRIPTS.GROW, this.config.HOME_SERVER, growThreads, server);
                    this.stats.totalGrows += growThreads;
                    return;
                }

                // 最后入侵 
                if (hackThreads > 0) {
                    try {
                        const moneyStolen = this.ns.hackAnalyze(server) * hackThreads * money;
                        this.stats.totalMoney += moneyStolen;
                        this.stats.totalHacks += hackThreads;

                        // 检查可用RAM
                        const scriptRam = this.getScriptRam(this.config.SCRIPTS.HACK);
                        const availableRam = this.ns.getServerMaxRam(this.config.HOME_SERVER) -
                            this.ns.getServerUsedRam(this.config.HOME_SERVER) -
                            this.config.RESERVE_RAM;

                        // 动态调整线程数
                        const maxPossibleThreads = Math.floor(availableRam / scriptRam);
                        const actualThreads = Math.min(hackThreads, maxPossibleThreads);

                        if (actualThreads > 0) {
                            const pid = this.ns.exec(this.config.SCRIPTS.HACK, this.config.HOME_SERVER, actualThreads, server);
                            if (pid === 0) {
                                throw new Error("执行失败，可能RAM不足");
                            }
                        } else {
                            this.log("WARN", `RAM不足，跳过入侵 ${server}`);
                        }
                    } catch (error) {
                        this.log("ERROR", `入侵失败: ${server} - ${error}`);
                        await this.ns.sleep(this.config.RETRY_DELAY);
                    }
                }
            } catch (error) {
                this.ns.print(`×  攻击失败: ${target.hostname}  - ${error}`);
            }
        }


        /**
         * 主循环 - 持续扫描目标并执行攻击
         */
        async copyScriptsToAllServers() {
            if (!await this.initialize()) return false;

            this.ns.print("🚀  开始复制脚本到所有服务器");

            const servers = await this.scanServers();
            // 获取所有hacknet节点名称
            const EXCLUDE = [...Array.from(
                { length: this.ns.hacknet.numNodes() },
                (_, i) => this.ns.hacknet.getNodeStats(i).name
            )];
            EXCLUDE.push(this.config.HOME_SERVER); // 添加home服务器到排除列表

            let success = true;
            for (const server of servers) {
                // 跳过排除列表中的服务器
                if (EXCLUDE.includes(server)) continue;

                if (!await this.copyScriptsToServer(server)) {
                    success = false;
                    this.ns.print(`×  复制到 ${server} 失败`);
                } else {
                    this.ns.print(`✓  成功复制到 ${server}`);
                }
            }
            return success;
        }

        async run() {
            if (!await this.initialize()) return;

            this.ns.print("🚀  自动化攻击系统启动");
            await this.copyScriptsToAllServers();
            while (true) {
                try {
                    const targets = await this.getTargets();

                    if (targets.length === 0) {
                        this.ns.print("⏳  无有效目标，等待扫描...");
                        await this.ns.sleep(this.config.SCAN_INTERVAL);
                        continue;
                    }

                    // 显示仪表盘
                    this.showDashboard(targets);

                    // 攻击前几个最有价值的目标 
                    const maxTargets = Math.min(this.config.MAX_TARGETS, targets.length);
                    for (let i = 0; i < maxTargets; i++) {
                        await this.attackTarget(targets[i]);
                    }

                    await this.ns.sleep(this.config.ACTION_INTERVAL);
                } catch (error) {
                    this.ns.print(`⚠️  主循环错误: ${error}`);
                    await this.ns.sleep(this.config.RETRY_DELAY);
                }
            }
        }
    }

    // ===================== 执行入口 ===================== 
    // 创建管理器实例并启动主循环
    const botManager = new BotManager(ns, CONFIG);
    await botManager.run();
}
