/** @param {NS} ns */
export async function main(ns) {
    // 禁用所有日志输出
    ns.disableLog('ALL');
    // 打开一个尾部窗口
    ns.ui.openTail();
    // 设置尾部窗口的标题
    ns.ui.setTailTitle(`服务器管理 [${ns.getScriptName()}]`)
    // 调整尾部窗口的大小
    ns.ui.resizeTail(200, 150);
    // 获取当前窗口的尺寸
    const [W, H] = ns.ui.windowSize();
    // 移动尾部窗口到指定位置
    ns.ui.moveTail(W - 200, H - 160)

    // 配置常量
    const CONFIG = {
        RESERVE_FILE: "reserve.txt", // 保留资金的文件名
        HASH_CAPACITY_THRESHOLD: 0.98, // Hash容量阈值
        SERVER_PREFIX: 'daemon', // 服务器名称前缀
        MAX_SERVERS: 25, // 最大服务器数量
        BASE_RAM: 8, // 基础RAM大小
        USAGE_THRESHOLD: 0.8, // 使用率阈值
        ALLOCATION: {
            HACKNET: 0.4, // Hacknet分配比例
            SERVERS: 0.6, // 服务器分配比例
            ADJUST_STEP: 0.05, // 调整步长
            MIN_ALLOCATION: 0.1 // 最小分配比例
        },
        RETRY_DELAY: 1000, // 重试延迟时间
        MAX_ERROR_COUNT: 5 // 最大错误计数
    };

    // 状态跟踪器
    const state = {
        hacknetROI: [], // Hacknet投资回报率
        serverROI: [], // 服务器投资回报率
        errorCount: 0, // 错误计数
        lastCycleTime: Date.now() // 上次循环时间
    };

    // 工具函数
    const fmt = {
        ram: v => ns.formatRam(v, 0), // 格式化RAM显示
        percent: v => ns.formatPercent(v, 2), // 格式化百分比显示
        money: v => ns.formatNumber(v, 2) // 格式化货币显示
    };

    // 增强型安全执行器
    const safeExecute = async (operation, context = '', retries = 3) => {
        try {
            const result = await operation();
            state.errorCount = Math.max(state.errorCount - 1, 0);
            return result;
        } catch (error) {
            if (retries > 0) {
                await ns.sleep(CONFIG.RETRY_DELAY);
                return safeExecute(operation, context, retries - 1);
            }
            ns.print(`[ERROR] ${context}: ${error}`.padEnd(45));
            state.errorCount++;
            return null;
        }
    };

    // 资金分配管理器
    class BudgetManager {
        async refresh() {
            const reserve = Number(ns.read(CONFIG.RESERVE_FILE)) || 0;
            const total = ns.getPlayer().money - reserve;

            // 动态调整分配比例
            const avgHacknetROI = state.hacknetROI.slice(-3).reduce((a, b) => a + b, 0) / 3 || 1;
            const avgServerROI = state.serverROI.slice(-3).reduce((a, b) => a + b, 0) / 3 || 1;

            if (avgHacknetROI > avgServerROI) {
                CONFIG.ALLOCATION.HACKNET = Math.min(
                    CONFIG.ALLOCATION.HACKNET + CONFIG.ALLOCATION.ADJUST_STEP,
                    0.7
                );
                CONFIG.ALLOCATION.SERVERS = Math.max(
                    CONFIG.ALLOCATION.SERVERS - CONFIG.ALLOCATION.ADJUST_STEP,
                    CONFIG.ALLOCATION.MIN_ALLOCATION
                );
            } else {
                CONFIG.ALLOCATION.SERVERS = Math.min(
                    CONFIG.ALLOCATION.SERVERS + CONFIG.ALLOCATION.ADJUST_STEP,
                    0.7
                );
                CONFIG.ALLOCATION.HACKNET = Math.max(
                    CONFIG.ALLOCATION.HACKNET - CONFIG.ALLOCATION.ADJUST_STEP,
                    CONFIG.ALLOCATION.MIN_ALLOCATION
                );
            }

            return {
                hacknet: Math.floor(total * CONFIG.ALLOCATION.HACKNET),
                servers: Math.floor(total * CONFIG.ALLOCATION.SERVERS),
                remaining: total
            };
        }
    }

    // Hacknet节点管理器
    class HacknetManager {
        constructor() {
            this.upgradeTypes = [
                {
                    name: 'Level',
                    cost: i => ns.hacknet.getLevelUpgradeCost(i),
                    action: i => ns.hacknet.upgradeLevel(i),
                    roi: i => (ns.hacknet.getNodeStats(i).production * 0.1) / ns.hacknet.getLevelUpgradeCost(i)
                },
                {
                    name: 'RAM',
                    cost: i => ns.hacknet.getRamUpgradeCost(i),
                    action: i => ns.hacknet.upgradeRam(i),
                    roi: i => (ns.hacknet.getNodeStats(i).production * 0.05) / ns.hacknet.getRamUpgradeCost(i)
                },
                {
                    name: 'Core',
                    cost: i => ns.hacknet.getCoreUpgradeCost(i),
                    action: i => ns.hacknet.upgradeCore(i),
                    roi: i => (ns.hacknet.getNodeStats(i).production * 0.15) / ns.hacknet.getCoreUpgradeCost(i)
                },
                {
                    name: 'Cache',
                    cost: i => ns.hacknet.getCacheUpgradeCost(i),
                    action: i => ns.hacknet.upgradeCache(i),
                    roi: i => {
                        const stats = ns.hacknet.getNodeStats(i);
                        return (stats.hashCapacity - stats.ramUsed) / ns.hacknet.getCacheUpgradeCost(i);
                    }
                }
            ];
        }

        async manage(budget) {
            // 购买新节点
            await safeExecute(async () => {
                const cost = ns.hacknet.getPurchaseNodeCost();
                if (cost < budget.hacknet) {
                    ns.hacknet.purchaseNode();
                    budget.hacknet -= cost;
                }
            }, 'Purchase Hacknet Node');

            // 升级现有节点
            const numNodes = ns.hacknet.numNodes();
            for (let i = 0; i < numNodes; i++) {
                const upgrades = this.upgradeTypes
                    .map(t => ({
                        type: t.name,
                        cost: t.cost(i),
                        action: t.action,
                        roi: t.roi(i)
                    }))
                    .filter(u => u.cost > 0)
                    .sort((a, b) => b.roi - a.roi);

                for (const { type, cost, action } of upgrades) {
                    if (cost < budget.hacknet) {
                        const success = await safeExecute(
                            async () => {
                                action(i);
                                budget.hacknet -= cost;
                                state.hacknetROI.push((ns.hacknet.getNodeStats(i).production * 0.1) / cost);
                                return true;
                            },
                            `Upgrade ${type} on node ${i}`
                        );
                        if (success) break;
                    }
                }
            }
        }
    }

    // 服务器管理器
    class ServerManager {
        calculateOptimalRAM(servers) {
            const usageRatios = servers.map(hostname => {
                const used = ns.getServerUsedRam(hostname);
                const max = ns.getServerMaxRam(hostname);
                return max === 0 ? 0 : used / max;
            });

            const avgUsage = usageRatios.reduce((a, b) => a + b, 0) / servers.length;
            let targetRam = CONFIG.BASE_RAM;

            while (
                targetRam <= 2 ** 20 &&
                avgUsage > CONFIG.USAGE_THRESHOLD &&
                ns.getPurchasedServerCost(targetRam * 2) < (ns.getPlayer().money * 0.5)
            ) {
                targetRam *= 2;
            }

            return targetRam;
        }

        async manage(budget) {
            const servers = ns.getPurchasedServers();
            const targetRam = this.calculateOptimalRAM(servers);

            // 购买新服务器
            if (servers.length < CONFIG.MAX_SERVERS) {
                await safeExecute(async () => {
                    const cost = ns.getPurchasedServerCost(targetRam);
                    if (cost < budget.servers) {
                        const hostname = ns.purchaseServer(CONFIG.SERVER_PREFIX, targetRam);
                        if (hostname) {
                            budget.servers -= cost;
                            state.serverROI.push((targetRam * 0.1) / cost);
                        }
                    }
                }, 'Purchase New Server');
            }

            // 升级现有服务器
            for (const hostname of servers) {
                await safeExecute(async () => {
                    const currentRam = ns.getServerMaxRam(hostname);
                    if (currentRam >= targetRam) return;

                    const cost = ns.getPurchasedServerCost(targetRam);
                    if (cost < budget.servers) {
                        ns.killall(hostname);
                        ns.deleteServer(hostname);
                        const newHost = ns.purchaseServer(CONFIG.SERVER_PREFIX, targetRam);
                        if (newHost) {
                            budget.servers -= cost;
                            state.serverROI.push(((targetRam - currentRam) * 0.1) / cost);
                        }
                    }
                }, `Upgrade Server ${hostname}`);
            }
        }
    }

    // 主循环
    const budgetManager = new BudgetManager();
    const hacknetManager = new HacknetManager();
    const serverManager = new ServerManager();

    while (true) {
        try {
            ns.clearLog();
            const budget = await budgetManager.refresh();

            ns.print(` 可用资金: ${fmt.money(budget.remaining)}`);
            ns.print(` 分配比例: \n     Hacknet ${fmt.percent(CONFIG.ALLOCATION.HACKNET)} \n     Servers ${fmt.percent(CONFIG.ALLOCATION.SERVERS)}`);

            await hacknetManager.manage(budget);
            await serverManager.manage(budget);

            ns.print(` 错误计数: ${state.errorCount}`);

            const sleepTime = state.errorCount > CONFIG.MAX_ERROR_COUNT ? 5000 : 1000;
            await ns.sleep(sleepTime);

        } catch (error) {
            ns.print(`[CRITICAL] 主循环错误: ${error}`);
            await ns.sleep(5000);         
        }
    }
}
