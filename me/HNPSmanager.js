/** 
 * 综合型网络管理系统 - CyberManager v3.3.1
 * @param {NS} ns 
 */
export async function main(ns) {
    // ====================== 配置 ======================
    const CONFIG = {
        RESERVE_FILE: "reserve.txt",
        MAX_SERVERS: 25,
        SERVER_PREFIX: "daemon",
        UPDATE_INTERVAL: 3000,
        HASH_THRESHOLD: 0.95,
        DEBUG_MODE: false,
        UI_WIDTH: 36,
        MIN_RAM: 8,
        HACKNET_PRIORITY: ["RAM", "Core", "Level"],
        VALID_HACKNET_TYPES: ["RAM", "Core", "Level", "Cache"]
    };

    // ====================== 颜色配置 ======================
    const COLORS = {
        system: '\x1b[38;5;51m',
        hack: '\x1b[38;5;196m',
        progress: '\x1b[38;5;46m',
        reset: '\x1b[0m',
        warning: '\x1b[38;5;226m',
        success: '\x1b[38;5;82m',
        info: '\x1b[38;5;39m',
        debug: '\x1b[38;5;242m',
        border: '\x1b[38;5;240m',
        highlight: '\x1b[38;5;214m'
    };

    // ====================== 系统管理器 ======================
    class SystemManager {
        constructor(ns) {
            this.ns = ns;
            this.reserve = Number(this.ns.read(CONFIG.RESERVE_FILE)) || 0;
            this.lastUpdate = 0;
            this.loopCount = 0;
            this.stats = {
                hacknetNodes: 0,
                serversPurchased: 0,
                serversUpgraded: 0,
                hashCacheUpgrades: 0,
                totalSpent: 0
            };
        }

        // ========== 对齐工具 ==========
        alignText(text, width, align = 'left', padChar = ' ') {
            const visibleLength = text.replace(/\x1b\[[0-9;]*m/g, '').length;
            const padding = Math.max(0, width - visibleLength);
            switch(align) {
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
            return `${COLORS.border}║${COLORS.highlight}${this.alignText(` ${text} `, CONFIG.UI_WIDTH - 2, 'center')}${COLORS.border}║`;
        }

        createValueLine(left, right) {
            const halfWidth = Math.floor((CONFIG.UI_WIDTH - 2) / 2);
            return `${COLORS.border}║${COLORS.system} ${this.alignText(left, halfWidth)} ${this.alignText(right, halfWidth)} ${COLORS.border}║`;
        }

        // ========== 日志系统 ==========
        log(level, message) {
            const timestamp = new Date().toLocaleTimeString();
            const colorMap = {
                'INFO': COLORS.info,
                'WARN': COLORS.warning,
                'ERROR': COLORS.hack,
                'SUCCESS': COLORS.success,
                'DEBUG': COLORS.debug,
                'SYSTEM': COLORS.system,
                'ACTION': COLORS.highlight
            };
            
            if (level === 'DEBUG' && !CONFIG.DEBUG_MODE) return;
            
            const levelText = this.alignText(`[${level}]`, 7);
            this.ns.tprint(`${COLORS.border}[${timestamp}] ${colorMap[level] || COLORS.system}${levelText} ${message}${COLORS.reset}`);
        }

        // ========== 资金管理 ==========
        get money() { return this.ns.getPlayer().money; }
        
        canAfford(cost, divisor=1) { 
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
                
                // 购买新节点
                if (nodeCount === 0 || (nodeCount < 10 && this.canAfford(this.ns.hacknet.getPurchaseNodeCost(), 10))) {
                    const cost = this.ns.hacknet.getPurchaseNodeCost();
                    if (this.canAfford(cost)) {
                        const index = this.ns.hacknet.purchaseNode();
                        if (index !== -1) {
                            this.stats.hacknetNodes++;
                            this.recordExpense(cost);
                            this.log('ACTION', `购买节点 #${index} 花费: $${this.ns.formatNumber(cost)}`);
                        }
                    }
                }

                // 修正的节点升级策略
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
                    
                    // 过滤无效的升级类型
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

                    for (const {type, cost, func} of upgrades) {
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
                this.log('ERROR', `Hacknet错误: ${e.stack || e}`);
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
            switch(type) {
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

                // 购买新服务器
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

                // 升级服务器
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
                this.log('ERROR', `服务器错误: ${e.stack || e}`);
            }
        }

        getBestRamSize() {
            let ram = CONFIG.MIN_RAM;
            while (ram <= 2**20 && this.canAfford(this.ns.getPurchasedServerCost(ram*2), 10)) {
                ram *= 2;
            }
            return ram;
        }

        // ========== 界面渲染 ==========
        renderUI() {
            try {
                this.ns.clearLog();
                
                // UI框架
                this.ns.print(`${COLORS.border}╔${'═'.repeat(CONFIG.UI_WIDTH)}╗`);
                this.ns.print(this.createBoxLine('CyberManager v3.3.1'));
                
                // 资金状态
                this.ns.print(`${COLORS.border}╠${'═'.repeat(CONFIG.UI_WIDTH)}╣`);
                this.ns.print(this.createBoxLine('资金状态'));
                this.ns.print(this.createValueLine(
                    `可用: $${this.ns.formatNumber(this.money - this.reserve)}`,
                    `保留: $${this.ns.formatNumber(this.reserve)}`
                ));
                
                // Hacknet状态
                this.ns.print(`${COLORS.border}╠${'═'.repeat(CONFIG.UI_WIDTH)}╣`);
                this.ns.print(this.createBoxLine('Hacknet节点'));
                const nodes = this.ns.hacknet.numNodes();
                const hashes = this.ns.hacknet.numHashes();
                const hashCap = Math.max(1, this.ns.hacknet.hashCapacity());
                this.ns.print(this.createValueLine(
                    `节点数: ${nodes}`,
                    `哈希: ${(hashes / hashCap * 100).toFixed(1)}%`
                ));
                
                // 服务器状态
                this.ns.print(`${COLORS.border}╠${'═'.repeat(CONFIG.UI_WIDTH)}╣`);
                this.ns.print(this.createBoxLine('服务器集群'));
                const servers = this.ns.getPurchasedServers();
                this.ns.print(this.createValueLine(
                    `数量: ${servers.length}/${CONFIG.MAX_SERVERS}`,
                    `最佳RAM: ${this.ns.formatRam(this.getBestRamSize())}`
                ));
                
                // 统计信息
                this.ns.print(`${COLORS.border}╠${'═'.repeat(CONFIG.UI_WIDTH)}╣`);
                this.ns.print(this.createBoxLine('系统统计'));
                this.ns.print(this.createValueLine(
                    `节点购买: ${this.stats.hacknetNodes}`,
                    `缓存升级: ${this.stats.hashCacheUpgrades}`
                ));
                this.ns.print(this.createValueLine(
                    `新购服务器: ${this.stats.serversPurchased}`,
                    `升级次数: ${this.stats.serversUpgraded}`
                ));
                this.ns.print(this.createValueLine(
                    `总支出: $${this.ns.formatNumber(this.stats.totalSpent)}`,
                    ""
                ));
                
                // 调试信息
                if (CONFIG.DEBUG_MODE) {
                    this.ns.print(`${COLORS.border}╠${'═'.repeat(CONFIG.UI_WIDTH)}╣`);
                    this.ns.print(this.createBoxLine('调试信息'));
                    this.ns.print(this.createValueLine(
                        `循环次数: ${this.loopCount}`,
                        `内存占用: ${this.ns.formatRam(this.ns.getServer().ramUsed)}`
                    ));
                }
                
                this.ns.print(`${COLORS.border}╚${'═'.repeat(CONFIG.UI_WIDTH)}╝${COLORS.reset}`);
            } catch (e) {
                this.log('ERROR', `UI错误: ${e.stack || e}`);
            }
        }
    }

    // ====================== 主循环 ======================
    const manager = new SystemManager(ns);
     ns.atExit(() => ns.ui.closeTail());
    ns.disableLog('ALL');
    ns.ui.openTail();
    manager.log('SYSTEM', '系统初始化完成');
    manager.log('INFO', `保留资金: $${manager.ns.formatNumber(manager.reserve)}`);
  
    while (true) {
        const startTime = Date.now();
        manager.loopCount++;
        
        await manager.manageHacknet();
        await manager.manageServers();
        manager.renderUI();
        
        const loopTime = Date.now() - startTime;
        if (loopTime > CONFIG.UPDATE_INTERVAL * 1.2) {
            manager.log('WARN', `循环耗时 ${loopTime}ms (预期: ${CONFIG.UPDATE_INTERVAL}ms)`);
        }
        
        await ns.sleep(CONFIG.UPDATE_INTERVAL);
    }
}
