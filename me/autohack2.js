/** @param {NS} ns */
export async function main(ns) {
    // ===================== 配置部分 ===================== 
    ns.disableLog("ALL");   // 禁用所有日志 
    ns.enableLog("exec");   // 只保留执行日志 
    ns.ui.openTail();       // 打开脚本日志窗口 

    // 常量配置 
    const CONFIG = {
        HOME_SERVER: "home",
        SCRIPTS: {
            HACK: "autoHack.js",
            GROW: "autoGrow.js",
            WEAKEN: "autoWeaken.js"
        },
        HACK_RATIO: 0.5,
        SECURITY_THRESHOLD: 5,     // 安全等级阈值 
        MONEY_THRESHOLD: 0.9,      // 金钱比例阈值 
        MIN_SECURITY_LEVEL: 2,
        MAX_RETRIES: 3,
        RETRY_DELAY: 5000,
        SCAN_INTERVAL: 5000,      // 扫描间隔(ms)
        ACTION_INTERVAL: 1000,     // 行动间隔(ms)
        MAX_TARGETS: 100,            // 同时攻击的最大目标数 
        RESERVE_RAM: 32            // 保留的RAM(GB)
    };

    // ===================== 配套脚本定义 ===================== 
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
    class BotManager {
        constructor(ns, config) {
            this.ns = ns;
            this.config = config;
            this.serverCache = [];
            this.targetCache = [];
            this.lastScanTime = 0;
            this.lastTargetUpdateTime = 0;
            this.scriptRamCache = {};
        }

        // 初始化脚本 
        async initialize() {
            try {
                for (const [name, content] of Object.entries(SCRIPTS_CONTENT)) {
                    if (!this.ns.fileExists(name)) {
                        await this.ns.write(name, content, "w");
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

        // 获取脚本RAM使用量（带缓存）
        getScriptRam(script) {
            if (!this.scriptRamCache[script]) {
                this.scriptRamCache[script] = this.ns.getScriptRam(script);
            }
            return this.scriptRamCache[script];
        }

        // 扫描服务器（带缓存）
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

        // 获取可攻击目标（带缓存）
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

        // 检查是否可以入侵服务器 
        canNuke(server) {
            const ports = this.ns.getServerNumPortsRequired(server);
            let openPorts = 0;

            ["BruteSSH.exe", "FTPCrack.exe", "relaySMTP.exe", "HTTPWorm.exe", "SQLInject.exe"]
                .forEach(tool => this.ns.fileExists(tool) && openPorts++);

            return openPorts >= ports;
        }

        // 入侵服务器 
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

        // 计算可用线程数（考虑保留RAM）
        calculateThreads(script, server) {
            const ramAvailable = Math.max(0,
                this.ns.getServerMaxRam(this.config.HOME_SERVER) -
                this.ns.getServerUsedRam(this.config.HOME_SERVER) -
                this.config.RESERVE_RAM);

            const ramPerThread = this.getScriptRam(script);

            return ramPerThread > 0 ? Math.max(1, Math.floor(ramAvailable / ramPerThread)) : 0;
        }

        // 获取当前运行的脚本数量 
        getRunningScripts(script, target) {
            return this.ns.ps(this.config.HOME_SERVER)
                .filter(proc => proc.filename === script && proc.args[0] === target)
                .reduce((sum, proc) => sum + proc.threads, 0);
        }

        // 执行攻击策略 
        async attackTarget(target) {
            try {
                const server = target.hostname;
                const money = this.ns.getServerMoneyAvailable(server);
                const maxMoney = target.maxMoney;
                const security = this.ns.getServerSecurityLevel(server);
                const minSecurity = this.ns.getServerMinSecurityLevel(server);

                // 计算可用线程（考虑已有运行的脚本）
                const weakenThreads = Math.max(1, this.calculateThreads(this.config.SCRIPTS.WEAKEN, server) -
                    this.getRunningScripts(this.config.SCRIPTS.WEAKEN, server));

                const growThreads = Math.max(1, this.calculateThreads(this.config.SCRIPTS.GROW, server) -
                    this.getRunningScripts(this.config.SCRIPTS.GROW, server));

                const hackThreads = Math.max(1, this.calculateThreads(this.config.SCRIPTS.HACK, server) -
                    this.getRunningScripts(this.config.SCRIPTS.HACK, server));

                // 优先削弱 
                if (security > minSecurity + this.config.SECURITY_THRESHOLD && weakenThreads > 0) {
                    this.ns.exec(this.config.SCRIPTS.WEAKEN, this.config.HOME_SERVER, weakenThreads, server);
                    this.ns.print(`⚡  削弱 ${server} (${this.ns.formatNumber(weakenThreads)} 线程)`);
                    return;
                }

                // 其次增长 
                if (money < maxMoney * this.config.MONEY_THRESHOLD && growThreads > 0) {
                    this.ns.exec(this.config.SCRIPTS.GROW, this.config.HOME_SERVER, growThreads, server);
                    this.ns.print(`📈  增长 ${server} (${this.ns.formatNumber(growThreads)} 线程)`);
                    return;
                }

                // 最后入侵 
                if (hackThreads > 0) {
                    this.ns.exec(this.config.SCRIPTS.HACK, this.config.HOME_SERVER, hackThreads, server);
                    this.ns.print(`💰  入侵 ${server} (${this.ns.formatNumber(hackThreads)} 线程)`);
                }
            } catch (error) {
                this.ns.print(`×  攻击失败: ${target.hostname}  - ${error}`);
            }
        }

        // 主循环 
        async run() {
            if (!await this.initialize()) return;

            this.ns.print("🚀  自动化攻击系统启动");
            while (true) {
                try {
                    const targets = await this.getTargets();

                    if (targets.length === 0) {
                        this.ns.print("⏳  无有效目标，等待扫描...");
                        await this.ns.sleep(this.config.SCAN_INTERVAL);
                        continue;
                    }

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
    const botManager = new BotManager(ns, CONFIG);
    await botManager.run();
}