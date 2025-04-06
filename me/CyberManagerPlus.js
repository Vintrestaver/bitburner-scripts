/** 
 * 增强型综合网络管理系统 - CyberManager Plus v1.2
 * 完整修复版
 * @param {NS} ns 
 */
export async function main(ns) {
    // ====================== 常量定义 ======================
    const ErrorType = {
        CRITICAL: 0,
        FUNCTIONAL: 1,
        TRANSIENT: 2,
        WARNING: 3
    };

    // ====================== 系统配置 ======================
    const CONFIG = {
        RESERVE_FILE: "reserve.txt",
        MAX_SERVERS: 25,
        SERVER_PREFIX: "daemon",
        UPDATE_INTERVAL: 3000,
        HASH_THRESHOLD: 0.95,
        DEBUG_MODE: false,
        UI_WIDTH: 60,
        MIN_RAM: 8,
        HACKNET_PRIORITY: ["RAM", "Core", "Level", "Cache"],
        VALID_HACKNET_TYPES: ["RAM", "Core", "Level", "Cache"],

        SCRIPTS: {
            autohack: {
                path: 'me/autohack.js',
                minHackingLevel: 8000,
                ram: 15.35
            },
            stock: {
                path: 'me/stock.js',
                ram: 57.25
            }
        },
        HASH_VALUE: 1e6 / 4,
        ERROR: {
            MAX_RETRIES: 3,
            COOLDOWN: 5000
        }
    };

    // ====================== 系统管理器 ======================
    class SystemManager {
        constructor(ns) {
            this.ns = ns;
            this.reserve = Number(this.ns.read(CONFIG.RESERVE_FILE)) || 0;
            this.loopCount = 0;
            this.startTime = Date.now();

            // 初始化统计
            this.stats = {
                hacknetNodes: this.ns.hacknet.numNodes(),
                serversPurchased: this.ns.getPurchasedServers().length,
                serversUpgraded: 0,
                hashCacheUpgrades: 0,
                totalSpent: 0,
                totalIncome: 0,
                lastIncomeCheck: Date.now(),
                lastHashes: this.ns.hacknet.numHashes()
            };

            // 初始化状态
            this.state = {
                player: {
                    hacking: this.ns.getHackingLevel(),
                    money: this.ns.getPlayer().money,
                    incomeRate: 0
                },
                stock: {
                    has4SData: ns.stock.has4SDataTIXAPI()
                },
                scripts: {
                    autohack: { running: false, pid: 0, start: 0 },
                    stock: { running: false, pid: 0, start: 0 }
                },
                errors: [],
                system: {
                    healthy: true,
                    degraded: false,
                    lastRecovery: 0
                },
                errorStats: {
                    total: 0,
                    lastErrorTime: 0,
                    errorRate: 0
                }
            };

            // 验证配置
            CONFIG.HACKNET_PRIORITY = CONFIG.HACKNET_PRIORITY.filter(type =>
                CONFIG.VALID_HACKNET_TYPES.includes(type)
            );
        }

        // ========== 格式化工具 ==========
        format = {
            money: amount => {
                if (isNaN(amount)) return "N/A";
                return `$${ns.formatNumber(amount, 2)}`;
            },
            time: seconds => {
                if (seconds === Infinity) return "∞";
                const d = Math.floor(seconds / 86400);
                const h = Math.floor((seconds % 86400) / 3600);
                const m = Math.floor((seconds % 3600) / 60);
                return `${d > 0 ? d + "d " : ""}${h > 0 ? h + "h " : ""}${m}m`;
            },
            progress: (value, max, width = 10) => {
                const ratio = Math.min(1, Math.max(0, value / max));
                const filled = Math.floor(ratio * width);
                return `[${'█'.repeat(filled)}${' '.repeat(width - filled)}]`;
            },
            ram: gb => {
                return `${ns.formatRam(gb, 1).padStart(7, '_')}`;
            }
        };

        // ========== 核心管理功能 ==========
        async manageHacknet() {
            try {
                const nodeCount = this.ns.hacknet.numNodes();

                // 购买新节点
                if (nodeCount < this.ns.hacknet.maxNumNodes() &&
                    this.canAfford(this.ns.hacknet.getPurchaseNodeCost())) {
                    const index = this.ns.hacknet.purchaseNode();
                    if (index !== -1) {
                        this.stats.hacknetNodes++;
                        this.recordExpense(this.ns.hacknet.getPurchaseNodeCost());
                    }
                }

                // 升级节点
                const upgradeHandlers = {
                    RAM: {
                        getCost: (i) => this.ns.hacknet.getRamUpgradeCost(i, 1),
                        upgrade: (i) => this.ns.hacknet.upgradeRam(i, 1)
                    },
                    Core: {
                        getCost: (i) => this.ns.hacknet.getCoreUpgradeCost(i, 1),
                        upgrade: (i) => this.ns.hacknet.upgradeCore(i, 1)
                    },
                    Level: {
                        getCost: (i) => this.ns.hacknet.getLevelUpgradeCost(i, 1),
                        upgrade: (i) => this.ns.hacknet.upgradeLevel(i, 1)
                    },
                    Cache: {
                        getCost: (i) => this.ns.hacknet.getCacheUpgradeCost(i),
                        upgrade: (i) => this.ns.hacknet.upgradeCache(i)
                    }
                };

                for (let i = 0; i < nodeCount; i++) {
                    for (const type of CONFIG.HACKNET_PRIORITY) {
                        const handler = upgradeHandlers[type];
                        if (!handler) continue;

                        const cost = handler.getCost(i);
                        if (this.canAfford(cost)) {
                            const before = this.getNodeStats(i);
                            handler.upgrade(i);
                            const after = this.getNodeStats(i);

                            if (JSON.stringify(before) !== JSON.stringify(after)) {
                                this.recordExpense(cost);
                                if (type === "Cache") this.stats.hashCacheUpgrades++;
                            }
                        }
                    }
                }
            } catch (e) {
                this.recordError("Hacknet管理错误", e, ErrorType.FUNCTIONAL);
            }
        }

        async manageServers() {
            try {
                const servers = this.ns.getPurchasedServers();
                const bestRam = this.getBestRamSize();

                // 购买新服务器
                if (servers.length < CONFIG.MAX_SERVERS &&
                    bestRam >= CONFIG.MIN_RAM &&
                    this.canAfford(this.ns.getPurchasedServerCost(bestRam))) {

                    const hostname = this.ns.purchaseServer(
                        CONFIG.SERVER_PREFIX + servers.length,
                        bestRam
                    );

                    if (hostname) {
                        this.stats.serversPurchased++;
                        this.recordExpense(this.ns.getPurchasedServerCost(bestRam));
                    }
                }

                // 升级现有服务器
                for (const hostname of servers) {
                    const currentRam = this.ns.getServerMaxRam(hostname);
                    if (currentRam < bestRam &&
                        this.canAfford(this.ns.getPurchasedServerCost(bestRam))) {

                        this.ns.killall(hostname);
                        if (this.ns.deleteServer(hostname)) {
                            const newHost = this.ns.purchaseServer(
                                hostname.replace(/\d+$/, '') || CONFIG.SERVER_PREFIX,
                                bestRam
                            );

                            if (newHost) {
                                this.stats.serversUpgraded++;
                                this.recordExpense(this.ns.getPurchasedServerCost(bestRam));
                            }
                        }
                    }
                }
            } catch (e) {
                this.recordError("服务器管理错误", e, ErrorType.FUNCTIONAL);
            }
        }

        async manageScripts() {
            try {
                // 更新玩家状态
                this.state.player.hacking = this.ns.getHackingLevel();
                this.state.player.money = this.ns.getPlayer().money;

                // 管理自动黑客脚本
                const shouldRunAutohack = this.state.player.hacking < CONFIG.SCRIPTS.autohack.minHackingLevel;
                if (shouldRunAutohack !== this.state.scripts.autohack.running) {
                    if (shouldRunAutohack) {
                        const pid = this.ns.run(CONFIG.SCRIPTS.autohack.path);
                        if (pid) {
                            this.state.scripts.autohack = {
                                running: true,
                                pid,
                                start: Date.now()
                            };
                        }
                    } else {
                        this.ns.kill(this.state.scripts.autohack.pid);
                        this.state.scripts.autohack.running = false;
                    }
                }

                // 管理股票脚本
                if (this.state.stock.has4SData && !this.state.scripts.stock.running) {
                    const pid = this.ns.run(CONFIG.SCRIPTS.stock.path);
                    if (pid) {
                        this.state.scripts.stock = {
                            running: true,
                            pid,
                            start: Date.now()
                        };
                    }
                }
            } catch (e) {
                this.recordError("脚本管理错误", e, ErrorType.FUNCTIONAL);
            }
        }

        // ========== 辅助方法 ==========
        get money() { return this.ns.getPlayer().money; }

        getBestRamSize() {
            let ram = CONFIG.MIN_RAM;
            while (ram <= 2 ** 20 && this.canAfford(this.ns.getPurchasedServerCost(ram * 2), 10)) {
                ram *= 2;
            }
            return ram;
        }

        canAfford(cost, divisor = 1) {
            const available = Math.max(0, this.money - this.reserve);
            return cost <= (available / Math.max(1, divisor));
        }

        recordExpense(amount) {
            this.stats.totalSpent += amount;
        }

        getNodeStats(index) {
            const stats = this.ns.hacknet.getNodeStats(index);
            return {
                level: stats.level,
                ram: stats.ram,
                cores: stats.cores,
                cache: stats.cache || 0
            };
        }

        getROI() {
            return this.stats.totalSpent > 0 ?
                (this.stats.totalIncome / this.stats.totalSpent).toFixed(2) + "x" : "-";
        }

        recordError(context, error, severity = ErrorType.FUNCTIONAL) {
            const errorEntry = {
                time: new Date().toLocaleTimeString(),
                timestamp: Date.now(),
                context,
                message: String(error).slice(0, 100),
                severity
            };

            this.state.errors.unshift(errorEntry);
            if (this.state.errors.length > 3) this.state.errors.pop();
            this.state.errorStats.total++;
            this.state.errorStats.lastErrorTime = Date.now();
        }

        // ========== 用户界面 ==========
        renderUI() {
            try {
                this.ns.clearLog();
                const ui = [];

                // 系统状态头
                const statusColor = !this.state.system.healthy ? "\x1b[38;5;196m" :
                    this.state.system.degraded ? "\x1b[38;5;220m" : "\x1b[38;5;46m";
                ui.push(`\x1b[38;5;21m${'≡'.repeat(CONFIG.UI_WIDTH)}\x1b[0m`);
                ui.push(`${statusColor}▶ CyberManager \x1b[38;5;33mv1.2\x1b[0m | ` +
                    `循环: \x1b[1m${this.loopCount}\x1b[0m | 运行: ${this.format.time((Date.now() - this.startTime) / 1000)}`);

                // 资金面板
                const moneyPanel = [
                    `\x1b[38;5;51m● 资金\x1b[0m 可用:\x1b[3${this.money > 1e9 ? 2 : 3}m${this.format.money(this.money)}\x1b[0m`,
                    `保留:\x1b[38;5;214m${this.format.money(this.reserve)}\x1b[0m`,
                    `ROI:${this.getROI().includes('-') ? '\x1b[31m' : '\x1b[32m'}${this.getROI()}\x1b[0m`
                ];
                ui.push(moneyPanel.join(' | '));

                // Hacknet面板
                const hashPercent = this.ns.hacknet.numHashes() / Math.max(1, this.ns.hacknet.hashCapacity());
                ui.push([
                    `\x1b[38;5;93m● Hacknet\x1b[0m 节点:${this.stats.hacknetNodes}`,
                    `缓存:${this.format.progress(hashPercent, 1, 12)}`,
                    `效率:${(hashPercent * 100).toFixed(1)}%`
                ].join(' | '));

                // 服务器面板
                const servers = this.ns.getPurchasedServers();
                const ramLevel = Math.log2(this.getBestRamSize());
                ui.push([
                    `\x1b[38;5;208m● 服务器\x1b[0m 数量:${servers.length}/${CONFIG.MAX_SERVERS}`,
                    `RAM等级:\x1b[38;5;${ramLevel > 10 ? 46 : ramLevel > 5 ? 226 : 196}m${ramLevel}\x1b[0m`,
                    `最大:${this.format.ram(this.getBestRamSize())}`
                ].join(' | '));

                // 脚本面板
                const scriptStatus = [];
                const addScriptStatus = (name, data) => {
                    const color = data.running ? 46 : 196;
                    const runtime = data.running ? this.format.time((Date.now() - data.start) / 1000) : '停止';
                    scriptStatus.push(`\x1b[38;5;${color}m${name}\x1b[0m:${runtime}`);
                };
                addScriptStatus('自动黑客', this.state.scripts.autohack);
                addScriptStatus('股票交易', this.state.scripts.stock);
                ui.push(`\x1b[38;5;99m● 脚本\x1b[0m ${scriptStatus.join(' | ')}`);

                // 错误信息
                if (this.state.errors.length > 0) {
                    const lastError = this.state.errors[0];
                    const color = [196, 208, 220, 226][lastError.severity];
                    ui.push(`\x1b[38;5;${color}m⚠ ${lastError.context}: ${lastError.message}\x1b[0m`);
                }

                // 底部状态栏
                const health = this.state.system.healthy ? 46 : this.state.system.degraded ? 226 : 196;
                ui.push(`\x1b[48;5;17m\x1b[38;5;${health}m${'■'.repeat(CONFIG.UI_WIDTH)}\x1b[0m`);

                this.ns.print(ui.join('\n'));
            } catch (e) {
                this.recordError("UI渲染错误", e, ErrorType.WARNING);
            }
        }
    }

    // ====================== 主程序 ======================
    const manager = new SystemManager(ns);
    ns.disableLog('ALL');
    ns.ui.openTail();
    ns.atExit(() => {
        ns.scriptKill(CONFIG.SCRIPTS.autohack.path, ns.getHostname());
        ns.scriptKill(CONFIG.SCRIPTS.stock.path, ns.getHostname());
    });

    while (true) {
        manager.loopCount++;

        // 更新收入统计
        const now = Date.now();
        const timeDiff = (now - manager.stats.lastIncomeCheck) / 1000;
        const currentHashes = ns.hacknet.numHashes();
        const hashIncome = ((currentHashes - manager.stats.lastHashes) / 4) * 1e6;
        const scriptIncome = ns.getScriptIncome()[0] * timeDiff;
        manager.stats.totalIncome += hashIncome + scriptIncome;
        manager.stats.lastIncomeCheck = now;
        manager.stats.lastHashes = currentHashes;

        // 执行管理任务
        await manager.manageHacknet();
        await manager.manageServers();
        await manager.manageScripts();
        manager.renderUI();

        await ns.sleep(CONFIG.UPDATE_INTERVAL);
    }
}