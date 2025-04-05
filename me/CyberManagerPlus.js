/** 
 * 增强型综合网络管理系统 - CyberManager Plus v1.0
 * 合并自 HNPSmanager.js 和 manger.js
 * @param {NS} ns 
 */
export async function main(ns) {
    // ====================== 综合配置 ======================
    const CONFIG = {
        // 来自HNPSmanager.js
        RESERVE_FILE: "reserve.txt",
        MAX_SERVERS: 25,
        SERVER_PREFIX: "daemon",
        UPDATE_INTERVAL: 3000,
        HASH_THRESHOLD: 0.95,
        DEBUG_MODE: false,
        UI_WIDTH: 36,
        MIN_RAM: 8,
        HACKNET_PRIORITY: ["RAM", "Core", "Level"],
        VALID_HACKNET_TYPES: ["RAM", "Core", "Level", "Cache"],

        // 来自manger.js
        SCRIPTS: {
            autohack: {
                path: 'me/autohack.js',
                minHackingLevel: 8000,
                ram: 1.7
            },
            stock: {
                path: 'me/stock.js',
            }
        },
        HASH_VALUE: 1e6 / 4,  // 4哈希 = 1百万
        ERROR: {
            MAX_RETRIES: 3,    // 最大重试次数
            COOLDOWN: 5000     // 错误冷却时间(ms)
        }
    };

    // ====================== 错误类型枚举 ======================
    const ErrorType = {
        CRITICAL: 0,    // 需要立即停止脚本
        FUNCTIONAL: 1,  // 功能部分失效
        TRANSIENT: 2,   // 临时性错误
        WARNING: 3      // 不影响主要功能
    };

    // ====================== 系统管理器 ======================
    class SystemManager {
        /** @param {NS} ns */
        constructor(ns) {
            this.ns = ns;
            this.reserve = Number(this.ns.read(CONFIG.RESERVE_FILE)) || 0;
            this.lastUpdate = 0;
            this.loopCount = 0;

            // 来自HNPSmanager.js的统计
            this.stats = {
                hacknetNodes: 0,
                serversPurchased: 0,
                serversUpgraded: 0,
                hashCacheUpgrades: 0,
                totalSpent: 0,
                totalIncome: 0,
                lastIncomeCheck: Date.now(),
                lastHashes: this.ns.hacknet.numHashes()
            };

            this.state = {
                player: {
                    hacking: this.ns.getHackingLevel(),
                    money: this.ns.getPlayer().money
                },
                stock: {
                    has4SData: ns.stock.has4SDataTIXAPI()
                },
                scripts: {
                    autohack: { running: false },
                    stock: { running: false }
                },
                errors: [],
                system: {
                    healthy: true
                }
            };
        }

        // ========== 工具函数 ==========
        // 来自HNPSmanager.js
        alignText(text, width, align = 'left', padChar = ' ') {
            const visibleLength = text.replace(/\x1b\[[0-9;]*m/g, '').length;
            const padding = Math.max(0, width - visibleLength);
            switch (align) {
                case 'left': return text + padChar.repeat(padding);
                case 'right': return padChar.repeat(padding) + text;
                case 'center':
                    const left = Math.floor(padding / 2);
                    const right = padding - left;
                    return padChar.repeat(left) + text + padChar.repeat(right);
                default: return text;
            }
        }

        createBoxLine(text) {
            const border = '─'.repeat(CONFIG.UI_WIDTH - 2);
            return `┌${border}┐\n` +
                `│${this.alignText(` ${text} `, CONFIG.UI_WIDTH - 2, 'center')}│\n` +
                `└${border}┘`;
        }

        createValueLine(left, right) {
            const halfWidth = Math.floor(CONFIG.UI_WIDTH / 2);
            return `${this.alignText(left, halfWidth)} ${this.alignText(right, halfWidth)}`;
        }

        // 来自manger.js的格式化工具
        format = {
            money: amount => {
                if (amount === undefined || amount === null || isNaN(amount)) {
                    return "N/A";
                }
                const isNegative = amount < 0;
                const absAmount = Math.abs(amount);
                let formatted;

                if (absAmount >= 1e12) formatted = `$${this.ns.formatNumber(absAmount / 1e12, 2)}t`;
                else if (absAmount >= 1e9) formatted = `$${this.ns.formatNumber(absAmount / 1e9, 2)}b`;
                else if (absAmount >= 1e6) formatted = `$${this.ns.formatNumber(absAmount / 1e6, 2)}m`;
                else formatted = `$${this.ns.formatNumber(absAmount, 2)}`;

                return isNegative ? `-${formatted}` : formatted;
            },
            number: num => {
                if (num === undefined || num === null || isNaN(num)) {
                    return "N/A";
                }
                return this.ns.formatNumber(num, 2);
            },
            time: seconds => {
                if (seconds === undefined || seconds === null || isNaN(seconds)) return "N/A";
                if (seconds === Infinity) return "∞";
                const days = Math.floor(seconds / 86400);
                const hours = Math.floor((seconds % 86400) / 3600);
                const mins = Math.floor((seconds % 3600) / 60);
                return `${days > 0 ? days + "d " : ""}${hours > 0 ? hours + "h " : ""}${mins}m`;
            },
            progress: (value, max, width = 20) => {
                if (value === undefined || max === undefined || isNaN(value) || isNaN(max)) {
                    return `[${' '.repeat(width)}]`;
                }
                const ratio = Math.min(1, Math.max(0, value / max));
                return `[${'█'.repeat(Math.floor(ratio * width))}${' '.repeat(width - Math.floor(ratio * width))}]`;
            }
        };

        // ========== 日志系统 ==========
        log(level, message) {
            const timestamp = new Date().toLocaleTimeString();
            if (level === 'DEBUG' && !CONFIG.DEBUG_MODE) return;

            const levelText = this.alignText(`[${level}]`, 7);
            this.ns.tprint(`[${timestamp}] ${levelText} ${message}`);
        }

        // ========== 错误处理 ==========
        recordError(context, error, severity = ErrorType.FUNCTIONAL, recoverable = true) {
            const now = Date.now();
            const errorEntry = {
                time: new Date().toLocaleTimeString(),
                timestamp: now,
                context,
                message: String(error).substring(0, 200),
                stack: error.stack ? String(error.stack).substring(0, 300) : undefined,
                severity,
                recoverable
            };

            // 更新错误统计
            this.state.errorStats.total++;
            if (this.state.errorStats.lastErrorTime > 0) {
                const timeSinceLastError = now - this.state.errorStats.lastErrorTime;
                this.state.errorStats.errorRate = 60000 / Math.max(1000, timeSinceLastError);
            }
            this.state.errorStats.lastErrorTime = now;

            // 添加到错误列表
            this.state.errors.unshift(errorEntry);
            if (this.state.errors.length > 5) this.state.errors.pop();

            return errorEntry;
        }

        attemptRecovery() {
            const now = Date.now();
            if (now - this.state.system.lastRecovery < 30000) {
                return false;
            }

            this.state.system.lastRecovery = now;
            this.log('SYSTEM', '尝试系统恢复...');

            try {
                this.state.scripts.autohack.running = false;
                this.state.scripts.stock.running = false;
                this.state.scripts.autohack.retries = 0;
                this.state.scripts.stock.retries = 0;

                this.state.system.healthy = true;
                this.state.system.degraded = false;
                this.log('SUCCESS', '系统恢复成功');
                return true;
            } catch (e) {
                this.recordError("系统恢复失败", e, ErrorType.CRITICAL, false);
                return false;
            }
        }

        // ========== 资金管理 ==========
        get money() { return this.ns.getPlayer().money; }

        updateIncomeStats() {
            const now = Date.now();
            const timeDiff = (now - this.stats.lastIncomeCheck) / 1000;

            const currentHashes = this.ns.hacknet.numHashes();
            const hashDiff = Math.max(0, currentHashes - this.stats.lastHashes);
            const hacknetIncome = (hashDiff / 4) * 1e6;

            const scriptIncome = (this.ns.getScriptIncome()[0] || 0) * timeDiff;

            const income = hacknetIncome + scriptIncome;
            if (!isNaN(income)) {
                this.stats.totalIncome += income;
            }
            this.stats.lastIncomeCheck = now;
            this.stats.lastHashes = currentHashes;
        }

        getROI() {
            if (this.stats.totalSpent === 0) return Infinity;
            return this.ns.formatPercent(this.stats.totalIncome / this.stats.totalSpent, 1);
        }

        canAfford(cost, divisor = 1) {
            const available = Math.max(0, this.money - this.reserve);
            return cost <= (available / Math.max(1, divisor));
        }

        recordExpense(amount) {
            this.stats.totalSpent += amount;
        }

        // ========== Hacknet管理 ==========        
        async manageHacknet() {
            try {
                const nodeCount = this.ns.hacknet.numNodes();
                const hashCapacity = this.ns.hacknet.hashCapacity() || 1;
                const numHashes = this.ns.hacknet.numHashes();

                if (nodeCount === 0 || (nodeCount < 10 && this.canAfford(this.ns.hacknet.getPurchaseNodeCost(), 10))) {
                    const cost = this.ns.hacknet.getPurchaseNodeCost();
                    if (this.canAfford(cost) && this.stats.totalIncome > this.stats.totalSpent) {
                        const index = this.ns.hacknet.purchaseNode();
                        if (index !== -1) {
                            this.stats.hacknetNodes++;
                            this.recordExpense(cost);
                            this.log('ACTION', `购买节点 #${index} 花费: $${this.ns.formatNumber(cost)} 收入/支出:${this.ns.formatPercent(this.stats.totalIncome / this.stats.totalSpent, 1)}`);
                        }
                    }
                }

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
                    const needCache = (numHashes / hashCapacity) >= CONFIG.HASH_THRESHOLD;
                    const validTypes = CONFIG.HACKNET_PRIORITY.filter(type =>
                        CONFIG.VALID_HACKNET_TYPES.includes(type)
                    );

                    const upgrades = validTypes.map(type => ({
                        type,
                        cost: upgradeHandlers[type].getCost(i),
                        func: () => upgradeHandlers[type].upgrade(i)
                    }));

                    if (needCache && upgradeHandlers.Cache) {
                        upgrades.push({
                            type: "Cache",
                            cost: upgradeHandlers.Cache.getCost(i),
                            func: () => upgradeHandlers.Cache.upgrade(i)
                        });
                    }

                    for (const { type, cost, func } of upgrades) {
                        if (this.canAfford(cost, 20)) {
                            const before = this.getNodeStats(i);
                            func();
                            const after = this.getNodeStats(i);

                            if (JSON.stringify(before) !== JSON.stringify(after)) {
                                this.recordExpense(cost);
                                if (type === "Cache") this.stats.hashCacheUpgrades++;
                                this.log('INFO', `升级 #${i} ${type}: ${this.formatUpgrade(before, after, type)}`);
                            }
                        }
                    }
                }
            } catch (e) {
                this.recordError("Hacknet管理错误", e, ErrorType.FUNCTIONAL);
            }
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

        formatUpgrade(before, after, type) {
            switch (type) {
                case "RAM": return `${before.ram}GB → ${after.ram}GB`;
                case "Core": return `${before.cores}核 → ${after.cores}核`;
                case "Level": return `Lv.${before.level} → Lv.${after.level}`;
                case "Cache": return `${before.cache} → ${after.cache}`;
                default: return "";
            }
        }

        // ========== 服务器管理 ==========
        async manageServers() {
            try {
                const bestRam = this.getBestRamSize();
                const servers = this.ns.getPurchasedServers();

                if (servers.length < CONFIG.MAX_SERVERS && bestRam >= CONFIG.MIN_RAM) {
                    const cost = this.ns.getPurchasedServerCost(bestRam);
                    if (this.canAfford(cost)) {
                        const hostname = this.ns.purchaseServer(CONFIG.SERVER_PREFIX, bestRam);
                        if (hostname) {
                            this.stats.serversPurchased++;
                            this.recordExpense(cost);
                            this.log('ACTION', `新购 ${hostname} (${this.ns.formatRam(bestRam)}) 花费: $${this.ns.formatNumber(cost)}`);
                        }
                    }
                }

                for (const hostname of servers) {
                    const currentRam = this.ns.getServerMaxRam(hostname);
                    if (currentRam < bestRam) {
                        const cost = this.ns.getPurchasedServerCost(bestRam);
                        if (this.canAfford(cost)) {
                            this.ns.killall(hostname);
                            if (this.ns.deleteServer(hostname)) {
                                const newHost = this.ns.purchaseServer(CONFIG.SERVER_PREFIX, bestRam);
                                if (newHost) {
                                    this.stats.serversUpgraded++;
                                    this.recordExpense(cost);
                                    this.log('INFO', `升级 ${hostname} → ${newHost} (${this.ns.formatRam(currentRam)}→${this.ns.formatRam(bestRam)})`);
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                this.recordError("服务器管理错误", e, ErrorType.FUNCTIONAL);
            }
        }

        getBestRamSize() {
            let ram = CONFIG.MIN_RAM;
            while (ram <= 2 ** 20 && this.canAfford(this.ns.getPurchasedServerCost(ram * 2), 10)) {
                ram *= 2;
            }
            return ram;
        }

        // ========== 脚本管理 ==========
        async manageScripts() {
            if (!this.state.system.healthy) return false;

            try {
                // 更新玩家数据
                this.state.player.hacking = this.ns.getHackingLevel();
                this.state.player.money = this.ns.getPlayer().money;

                // 管理自动黑客脚本
                const shouldRunAutohack = this.state.player.hacking < CONFIG.SCRIPTS.autohack.minHackingLevel;
                if (shouldRunAutohack !== this.state.scripts.autohack.running) {
                    try {
                        if (shouldRunAutohack) {
                            const pid = await this.ns.run(CONFIG.SCRIPTS.autohack.path);
                            this.state.scripts.autohack.running = pid !== 0;
                            if (this.state.scripts.autohack.running) {
                                this.state.scripts.autohack.retries = 0;
                                this.state.scripts.autohack.lastError = null;
                            }
                        } else {
                            this.ns.scriptKill(CONFIG.SCRIPTS.autohack.path, this.ns.getHostname());
                            this.state.scripts.autohack.running = false;
                        }
                    } catch (e) {
                        this.state.scripts.autohack.retries++;
                        this.state.scripts.autohack.lastError = e;
                        this.recordError("自动黑客脚本管理错误", e,
                            this.state.scripts.autohack.retries >= CONFIG.ERROR.MAX_RETRIES ?
                                ErrorType.FUNCTIONAL : ErrorType.TRANSIENT);
                    }
                }

                // 管理股票脚本(条件满足后永久运行)
                if (!this.state.scripts.stock.running) {
                    const shouldRunStock = this.state.stock.has4SData;
                    if (shouldRunStock) {
                        try {
                            const pid = await this.ns.run(CONFIG.SCRIPTS.stock.path);
                            this.state.scripts.stock.running = pid !== 0;
                            if (this.state.scripts.stock.running) {
                                this.state.scripts.stock.retries = 0;
                                this.state.scripts.stock.lastError = null;
                            }
                        } catch (e) {
                            this.state.scripts.stock.retries++;
                            this.state.scripts.stock.lastError = e;
                            this.recordError("股票脚本管理错误", e,
                                this.state.scripts.stock.retries >= CONFIG.ERROR.MAX_RETRIES ?
                                    ErrorType.FUNCTIONAL : ErrorType.TRANSIENT);
                        }
                    }
                }

                return true;
            } catch (e) {
                this.recordError("脚本管理严重错误", e, ErrorType.CRITICAL);
                return false;
            }
        }

        // ========== 界面渲染 ==========
        renderUI() {
            try {
                this.ns.clearLog();

                // UI框架 - 顶部状态栏
                const divider = '━'.repeat(CONFIG.UI_WIDTH - 2);
                this.ns.print(`┌${divider}┐`);

                const statusColor = !this.state.system.healthy ? "\x1b[31m" :
                    this.state.system.degraded ? "\x1b[33m" : "\x1b[32m";
                const statusMsg = !this.state.system.healthy ? "● CRITICAL" :
                    this.state.system.degraded ? "⚠ DEGRADED" : "✔ NORMAL";

                this.ns.print(`│${statusColor} ${'CyberManager Plus v1.0'.padEnd(CONFIG.UI_WIDTH - 11)} ` +
                    `[${statusMsg}]\x1b[0m │`);
                this.ns.print(`└${divider}┘`);

                // 资金状态 - 带图标和分隔线
                this.ns.print(this.createBoxLine('💰 资金状态'));
                const moneyDiv = '─'.repeat(CONFIG.UI_WIDTH);
                this.ns.print(moneyDiv);
                const availableMoney = this.money - this.reserve;
                const moneyColor = availableMoney > 1e9 ? "\x1b[32m" : "\x1b[33m";
                this.ns.print(this.createValueLine(
                    `可用: ${moneyColor}${this.format.money(availableMoney)}\x1b[0m`,
                    `保留: ${this.format.money(this.reserve)}`
                ));
                this.ns.print(this.createValueLine(
                    `收入率: ${this.format.money(this.state.player.incomeRate)}/s`,
                    `总资产: ${moneyColor}${this.format.money(availableMoney + this.reserve)}\x1b[0m`
                ));

                // Hacknet状态 - 增强显示
                this.ns.print(this.createBoxLine('⚙️ Hacknet节点'));
                const nodes = this.ns.hacknet.numNodes();
                const hashes = this.ns.hacknet.numHashes();
                const hashCap = Math.max(1, this.ns.hacknet.hashCapacity());
                const hashPercent = (hashes / hashCap * 100).toFixed(1);
                const hashColor = hashes / hashCap > 0.9 ? "\x1b[31m" :
                    hashes / hashCap > 0.7 ? "\x1b[33m" : "\x1b[32m";
                this.ns.print(this.createValueLine(
                    `节点: ${nodes}`,
                    `哈希: ${hashColor}${hashPercent}%\x1b[0m`
                ));
                this.ns.print(this.createValueLine(
                    `缓存: ${this.ns.formatNumber(hashes)}/${this.ns.formatNumber(hashCap)}`,
                    `效率: ${this.format.progress(hashes, hashCap)}`
                ));

                // 服务器状态 - 紧凑布局
                this.ns.print(this.createBoxLine('🖥️ 服务器集群'));
                const servers = this.ns.getPurchasedServers();
                const ramColor = this.getBestRamSize() >= 2 ** 20 ? "\x1b[32m" : "\x1b[33m";
                this.ns.print(this.createValueLine(
                    `数量: ${servers.length}/${CONFIG.MAX_SERVERS}`,
                    `最佳RAM: ${ramColor}${this.ns.formatRam(this.getBestRamSize())}\x1b[0m`
                ));

                // 脚本状态 - 添加运行状态颜色
                this.ns.print(this.createBoxLine('📜 脚本状态'));
                const autohackColor = this.state.scripts.autohack.running ? "\x1b[32m" : "\x1b[31m";
                const stockColor = this.state.scripts.stock.running ? "\x1b[32m" : "\x1b[31m";
                this.ns.print(this.createValueLine(
                    `自动黑客: ${autohackColor}${this.state.scripts.autohack.running ? '运行中' : '已停止'}\x1b[0m`,
                    `股票脚本: ${stockColor}${this.state.scripts.stock.running ? '运行中' : '已停止'}\x1b[0m`
                ));

                // 统计信息 - 紧凑布局
                this.ns.print(this.createBoxLine('📊 系统统计'));
                this.ns.print(this.createValueLine(
                    `节点: ${this.stats.hacknetNodes}`,
                    `缓存升级: ${this.stats.hashCacheUpgrades}`
                ));
                this.ns.print(this.createValueLine(
                    `新购服务器: ${this.stats.serversPurchased}`,
                    `升级次数: ${this.stats.serversUpgraded}`
                ));
                const roiColor = this.getROI() > 1 ? "\x1b[32m" : "\x1b[31m";
                this.ns.print(this.createValueLine(
                    `支出: $${this.ns.formatNumber(this.stats.totalSpent)}`,
                    `收入: $${this.ns.formatNumber(this.stats.totalIncome)}`
                ));
                this.ns.print(this.createValueLine(
                    `ROI: ${roiColor}${this.getROI()}\x1b[0m`,
                    `循环: ${this.loopCount}`
                ));

                // 错误信息 - 增强显示
                if (this.state.errors.length > 0) {
                    this.ns.print(this.createBoxLine('⚠️ 最近错误'));
                    const lastError = this.state.errors[0];
                    const severityColor = lastError.severity === 0 ? "\x1b[31m" :
                        lastError.severity === 1 ? "\x1b[33m" : "\x1b[36m";
                    const severityText = ["严重", "功能", "临时", "警告"][lastError.severity] || "未知";
                    this.ns.print(this.createValueLine(
                        `${severityColor}${lastError.time} [${severityText}]\x1b[0m`,
                        `${lastError.context.substring(0, 18)}...`
                    ));
                }

            } catch (e) {
                this.recordError("UI渲染错误", e, ErrorType.WARNING);
            }
        }
    }

    // ====================== 主循环 ======================
    const manager = new SystemManager(ns);
    ns.atExit(() => {
        ns.scriptKill(CONFIG.SCRIPTS.autohack.path, ns.getHostname());
        ns.scriptKill(CONFIG.SCRIPTS.stock.path, ns.getHostname());
    });
    ns.disableLog('ALL');
    ns.ui.openTail();
    manager.log('SYSTEM', '系统初始化完成');
    manager.log('INFO', `保留资金: $${manager.ns.formatNumber(manager.reserve)}`);

    while (true) {
        const startTime = Date.now();
        manager.loopCount++;

        await manager.manageHacknet();
        await manager.manageServers();
        await manager.manageScripts();
        manager.updateIncomeStats();
        manager.renderUI();

        const loopTime = Date.now() - startTime;
        if (loopTime > CONFIG.UPDATE_INTERVAL * 1.2) {
            manager.log('WARN', `循环耗时 ${loopTime}ms (预期: ${CONFIG.UPDATE_INTERVAL}ms)`);
        }

        await ns.sleep(CONFIG.UPDATE_INTERVAL);
    }
}
// ====================== 结束 ======================
