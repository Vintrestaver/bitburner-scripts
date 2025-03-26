/** @param {NS} ns */
export async function main(ns) {
    // 禁用所有日志输出
    ns.disableLog('ALL');
    // 打开一个尾部窗口
    ns.ui.openTail();
    // 设置尾部窗口的标题
    ns.ui.setTailTitle(`服务器管理 [${ns.getScriptName()}]`)
    // 获取当前窗口的尺寸
    const [W, H] = ns.ui.windowSize();


    // 系统配置参数
    const CONFIG = {
        // 资金管理配置
        RESERVE_FILE: "reserve.txt", // 储备金存储文件（自动从可用资金中扣除）
        HASH_CAPACITY_THRESHOLD: 0.98, // Hacknet节点哈希容量使用率阈值（达到该值触发缓存升级）

        // 服务器配置
        SERVER_PREFIX: 'daemon', // 采购服务器的命名前缀
        MAX_SERVERS: 25, // 最大可购买服务器数量（游戏限制）
        BASE_RAM: 8, // 新服务器的基准内存大小（GB）
        USAGE_THRESHOLD: 0.8, // 服务器内存使用率阈值（超过该值触发扩容）

        // 资金分配策略
        ALLOCATION: {
            HACKNET: 0.4, // Hacknet节点初始投资比例
            SERVERS: 0.6, // 服务器采购初始投资比例
            ADJUST_STEP: 0.05, // 动态调整步长（每次ROI比较后的调整幅度）
            MIN_ALLOCATION: 0.1 // 最低保证分配比例（防止完全停止某类投资）
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

    /**
     * 资金分配管理器 - 动态调整Hacknet节点和服务器采购之间的资金分配
     * 基于最近3次投资回报率(ROI)动态调整分配比例，优先投资回报率高的方向
     */
    class BudgetManager {
        // 刷新资金分配策略
        async refresh() {
            const reserve = Number(ns.read(CONFIG.RESERVE_FILE)) || 0; // 读取储备金
            const total = ns.getPlayer().money - reserve; // 计算可用资金

            // 计算最近3次的平均投资回报率（使用滑动窗口平均算法）
            const avgHacknetROI = state.hacknetROI.slice(-3).reduce((a, b) => a + b, 0) / 3 || 1;
            const avgServerROI = state.serverROI.slice(-3).reduce((a, b) => a + b, 0) / 3 || 1;

            // 动态调整算法：比较两类投资的ROI，自动调整分配比例

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

    /**
     * Hacknet节点管理器 - 自动化Hacknet节点的采购和升级
     * 支持四种升级类型，按投资回报率(ROI)自动选择最优升级
     * 升级优先级：缓存 > 核心 > 等级 > RAM
     */
    class HacknetManager {
        constructor() {
            // 定义可升级类型及其成本/收益计算方式
            this.upgradeTypes = [
                {
                    name: 'Level',      // 节点等级
                    cost: i => ns.hacknet.getLevelUpgradeCost(i),
                    action: i => ns.hacknet.upgradeLevel(i),
                    roi: i => (ns.hacknet.getNodeStats(i).production * 0.1) / ns.hacknet.getLevelUpgradeCost(i) // 每$产生的$/sec
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
                    ns.print(`[HACKNET] 新节点购入 花费：${fmt.money(cost)} 剩余预算：${fmt.money(budget.hacknet)}`);
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
                    if (cost < budget.hacknet * 0.2) {
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

    /**
     * 服务器管理器 - 自动化服务器的采购和扩容
     * 实现自动扩容算法：根据当前服务器平均内存使用率动态调整目标RAM大小
     * 扩容策略：当平均使用率>80%时，RAM大小翻倍，直到达到资金承受能力上限
     */
    class ServerManager {
        // 计算最优RAM大小（使用指数退避算法）
        calculateOptimalRAM(servers) {
            // 计算所有服务器的平均内存使用率
            const usageRatios = servers.map(hostname => {
                const used = ns.getServerUsedRam(hostname);
                const max = ns.getServerMaxRam(hostname);
                return max === 0 ? 0 : used / max;
            });
            const avgUsage = usageRatios.reduce((a, b) => a + b, 0) / servers.length;

            let targetRam = CONFIG.BASE_RAM; // 从基础RAM开始

            // 自动扩容逻辑：当平均使用率超过阈值且资金允许时，RAM翻倍
            while (
                targetRam <= 2 ** 20 && // 不超过1PB (2^20 = 1048576GB)
                avgUsage > CONFIG.USAGE_THRESHOLD && // 当前使用率超过阈值
                ns.getPurchasedServerCost(targetRam * 2) < (ns.getPlayer().money * 0.5) // 新RAM成本不超过可用资金的50%
            ) {
                targetRam *= 2; // 指数级扩容
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

    // 主控制循环（每1-5秒执行一次）
    const budgetManager = new BudgetManager();
    const hacknetManager = new HacknetManager();
    const serverManager = new ServerManager();

    while (true) {
        // 界面布局调整
        ns.ui.resizeTail(250, 200); // 固定尾部窗口尺寸为200x150
        ns.ui.moveTail(W - 250, H - 200) // 定位到窗口右下角
        try {
            ns.clearLog();
            const budget = await budgetManager.refresh();

            ns.print(` 可用资金: ${fmt.money(budget.remaining)}`);
            ns.print(` 分配比例: \n     Hacknet ${fmt.percent(CONFIG.ALLOCATION.HACKNET)} \n     Servers ${fmt.percent(CONFIG.ALLOCATION.SERVERS)}`);
            ns.print(` 动态调整: ${fmt.percent(CONFIG.ALLOCATION.ADJUST_STEP)} 步长`);

            await hacknetManager.manage(budget);
            await serverManager.manage(budget);
            ns.print(` 最后操作: ${new Date().toLocaleTimeString()}`);

            ns.print(` 错误计数: ${state.errorCount}`);

            const sleepTime = state.errorCount > CONFIG.MAX_ERROR_COUNT ? 5000 : 1000;
            await ns.sleep(sleepTime);

        } catch (error) {
            ns.print(`[CRITICAL] 主循环错误: ${error}`);
            await ns.sleep(5000);
        }
    }
}
