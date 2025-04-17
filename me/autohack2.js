/** @param {NS} ns */
export async function main(ns) {
    // ===================== 配置部分 ===================== 
    ns.disableLog("ALL");   // 禁用所有日志以保持控制台整洁
    ns.ui.openTail();       // 打开脚本日志窗口方便查看运行状态
    ns.ui.setTailTitle(`AutoHack v1.0 [${ns.getScriptName()}]`);
    ns.ui.resizeTail(600, 350);

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
        THREAD_STRATEGY: "BALANCED", // 线程分配策略: BALANCED/MAX_HACK/MAX_GROW/MAX_WEAKEN
        HACK_RATIO: 0.5,           // 入侵时获取金钱的比例
        SECURITY_THRESHOLD: 5,     // 安全等级阈值(超过最小值多少时需要削弱)
        MONEY_THRESHOLD: 0.9,      // 金钱比例阈值(低于最大值多少时需要增长)
        MIN_SECURITY_LEVEL: 2,     // 最低安全等级(低于此值不再削弱)
        MAX_RETRIES: 3,            // 最大重试次数
        RETRY_DELAY: 5000,         // 重试延迟(毫秒)
        SCAN_INTERVAL: 5000,       // 服务器扫描间隔(毫秒)
        ACTION_INTERVAL: 1000,     // 攻击行动间隔(毫秒)
        MAX_TARGETS: 65,           // 同时攻击的最大目标数 
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
         * 显示运行状态仪表盘
         * @param {Array} targets - 当前攻击目标数组
         */
        showDashboard(targets) {
            const now = Date.now();
            const runtime = this.ns.tFormat(now - this.stats.startTime);
            const ramUsed = this.ns.getServerUsedRam(this.config.HOME_SERVER);
            const ramMax = this.ns.getServerMaxRam(this.config.HOME_SERVER);
            const ramPercent = this.ns.formatPercent(ramUsed / ramMax, 1);

            // 清屏并显示标题
            this.ns.clearLog();
            this.ns.print("=".repeat(60));
            this.ns.print(`🛠️ AutoHack 仪表盘 | 运行时间: ${runtime}`);
            this.ns.print(`📊 资源: ${this.ns.formatRam(ramUsed)}/${this.ns.formatRam(ramMax)} (${ramPercent})`);
            this.ns.print(`💰 总收入: ${this.ns.formatNumber(this.stats.totalMoney).padEnd(8)}`);
            this.ns.print(`⚡ 操作统计: 入侵 ${this.ns.formatNumber(this.stats.totalHacks).padEnd(8)} | 增长 ${this.ns.formatNumber(this.stats.totalGrows).padEnd(8)} | 削弱 ${this.ns.formatNumber(this.stats.totalWeakens).padEnd(8)}`);
            this.ns.print("=".repeat(60));

            // 显示目标状态
            if (targets && targets.length > 0) {
                this.ns.print(`🎯 当前目标 (${targets.length}个):`);
                const maxTargets = Math.min(5, targets.length);
                for (let i = 0; i < maxTargets; i++) {
                    const target = targets[i];
                    const money = this.ns.getServerMoneyAvailable(target.hostname);
                    const maxMoney = target.maxMoney;
                    const security = this.ns.getServerSecurityLevel(target.hostname);
                    const minSecurity = this.ns.getServerMinSecurityLevel(target.hostname);

                    this.ns.print(
                        `${i + 1}.`.padStart(3) + `${target.hostname.padEnd(20)} ` +
                        `💰:${this.ns.formatPercent(money / maxMoney, 1).padStart(4, '_')} ` +
                        `🔒:${security.toFixed(1)}/${minSecurity.toFixed(1)}`.padEnd(13) +
                        `⭐:${this.ns.formatNumber(target.score)}`
                    );
                }
            }
            this.ns.print("=".repeat(60));
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
            if (!this.scriptRamCache[script]) {
                this.scriptRamCache[script] = this.ns.getScriptRam(script);
            }
            return this.scriptRamCache[script];
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
            try {
                const server = target.hostname;
                const money = this.ns.getServerMoneyAvailable(server);
                const maxMoney = target.maxMoney;
                const security = this.ns.getServerSecurityLevel(server);
                const minSecurity = this.ns.getServerMinSecurityLevel(server);

                // 复制脚本到目标服务器
                await this.copyScriptsToServer(server);

                // 根据策略计算线程分配
                let weakenThreads, growThreads, hackThreads;
                const totalThreads = this.calculateThreads(this.config.SCRIPTS.HACK, server);

                switch (this.config.THREAD_STRATEGY) {
                    case "MAX_HACK":
                        hackThreads = Math.floor(totalThreads * 0.7);
                        weakenThreads = Math.floor(totalThreads * 0.2);
                        growThreads = Math.floor(totalThreads * 0.1);
                        break;
                    case "MAX_GROW":
                        growThreads = Math.floor(totalThreads * 0.7);
                        weakenThreads = Math.floor(totalThreads * 0.2);
                        hackThreads = Math.floor(totalThreads * 0.1);
                        break;
                    case "MAX_WEAKEN":
                        weakenThreads = Math.floor(totalThreads * 0.7);
                        growThreads = Math.floor(totalThreads * 0.2);
                        hackThreads = Math.floor(totalThreads * 0.1);
                        break;
                    default: // BALANCED
                        weakenThreads = Math.floor(totalThreads * 0.4);
                        growThreads = Math.floor(totalThreads * 0.3);
                        hackThreads = Math.floor(totalThreads * 0.3);
                }

                // 动态调整线程数确保不超过可用RAM
                const availableRam = this.ns.getServerMaxRam(this.config.HOME_SERVER) -
                    this.ns.getServerUsedRam(this.config.HOME_SERVER) -
                    this.config.RESERVE_RAM;

                // 计算实际可用的线程数
                const weakenRam = this.getScriptRam(this.config.SCRIPTS.WEAKEN) * weakenThreads;
                const growRam = this.getScriptRam(this.config.SCRIPTS.GROW) * growThreads;
                const hackRam = this.getScriptRam(this.config.SCRIPTS.HACK) * hackThreads;

                // 如果总RAM不足，按比例缩减线程
                if (weakenRam + growRam + hackRam > availableRam) {
                    const ratio = availableRam / (weakenRam + growRam + hackRam);
                    weakenThreads = Math.max(1, Math.floor(weakenThreads * ratio));
                    growThreads = Math.max(1, Math.floor(growThreads * ratio));
                    hackThreads = Math.max(1, Math.floor(hackThreads * ratio));
                }

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
        async run() {
            if (!await this.initialize()) return;

            this.ns.print("🚀  自动化攻击系统启动");

            // 将脚本复制到所有可访问服务器
            const servers = await this.scanServers();
            for (const server of servers) {
                if (server !== this.config.HOME_SERVER) {
                    await this.copyScriptsToServer(server);
                }
            }
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
