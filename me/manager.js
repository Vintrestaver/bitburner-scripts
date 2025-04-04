/** @param {NS} ns */
export async function main(ns) {
    // 初始化日志设置
    ns.disableLog('ALL');
    ns.ui.openTail();
    
    // 退出时关闭所有脚本和窗口
    ns.atExit(() => {
        ns.ui.closeTail();
        // 关闭所有管理的脚本
        [SCRIPT1, SCRIPT2, SCRIPT3].forEach(script => {
            if (ns.isRunning(script, HOST)) {
                ns.scriptKill(script, HOST);
            }
        });
    });

    // 常量定义
    const SCRIPT1 = 'me/stock.js';     // 股票交易脚本路径
    const SCRIPT2 = 'me/autohack.js';  // 自动黑客脚本路径
    const SCRIPT3 = 'me/HNPSmanager.js'; // Hacknet节点管理脚本路径
    const MONITOR_INTERVAL = 1000;     // 监控刷新间隔（毫秒）
    const HOST = ns.getHostname();     // 当前主机名

    // ANSI 颜色代码配置
    const COLORS = {
        reset: "\u001b[0m",
        red: "\u001b[31m",
        green: "\u001b[32m",
        yellow: "\u001b[33m",
        blue: "\u001b[34m",
        cyan: "\u001b[36m",
        bgBlue: "\u001b[44m",
        bgRed: "\u001b[41m"
    };

    // 全局状态缓存对象
    let dashboardData = {
        lastUpdate: 0,       // 最后更新时间戳
        hackingLevel: 0,     // 当前黑客等级
        money: 0,            // 当前资金总额
        hnpsNodes: 0,        // Hacknet节点数量
        errors: [],          // 错误日志队列
        scripts: {           // 子脚本状态
            autohack: { running: false, memUsage: 0 },  // 自动黑客状态
            stock: { running: false, profit: 0 },       // 股票交易状态
            hnps: { running: false, cost: 0 }           // HNPS管理状态
        }
    };

    //=======================
    // 核心功能函数
    //=======================

    /**
     * 检查脚本是否存在
     * @param {string} script 脚本路径
     * @returns {boolean} 是否存在
     */
    const scriptExists = (script) => {
        try {
            return ns.fileExists(script, HOST);
        } catch (e) {
            recordError(`检查脚本存在时出错 (${script})`, e);
            return false;
        }
    };

    /**
     * 检查脚本运行状态
     * @param {string} script 脚本路径
     * @returns {boolean} 是否正在运行
     */
    const isScriptRunning = (script) => {
        try {
            return ns.isRunning(script, HOST);
        } catch (e) {
            recordError(`检查进程状态时出错 (${script})`, e);
            return false;
        }
    };

    /**
     * 安全启动脚本（带错误处理）
     * @param {string} script 脚本路径 
     * @param {number} [threads=1] 线程数
     * @returns {Promise<boolean>} 是否启动成功
     */
    const safeRun = async (script, threads = 1) => {
        try {
            if (!scriptExists(script)) {
                recordError(`脚本不存在: ${script}`);
                return false;
            }
            const pid = ns.run(script, threads);
            if (pid === 0) {
                recordError(`启动失败: ${script}`);
                return false;
            }
            return true;
        } catch (e) {
            recordError(`运行脚本失败 (${script})`, e);
            return false;
        }
    };

    // HNPS决策逻辑
    const shouldRunHNPS = () => {
        try {
            // 获取当前资金总额
            const money = ns.getPlayer().money;

            // 检查购买新节点条件：
            // 1. 当前节点数小于最大节点数
            // 2. 节点成本小于资金的10%
            if (ns.hacknet.numNodes() < ns.hacknet.maxNumNodes()) {
                const nodeCost = ns.hacknet.getPurchaseNodeCost();
                if (nodeCost < money * 0.1) return true;
            }

            // 遍历所有现有节点检查升级条件
            for (let i = 0; i < ns.hacknet.numNodes(); i++) {
                try {
                    // 计算三种升级方式的成本：
                    // 1. 等级升级 2. RAM升级 3. 核心升级
                    const costs = [
                        ns.hacknet.getLevelUpgradeCost(i, 1),
                        ns.hacknet.getRamUpgradeCost(i, 1),
                        ns.hacknet.getCoreUpgradeCost(i, 1)
                    ];
                    // 任意一种升级成本小于资金的5%则返回true
                    if (costs.some(c => c < money * 0.05)) return true;
                } catch (e) {
                    recordError(`节点 ${i} 升级检查失败`, e);
                    continue; // 单个节点检查失败不影响其他节点
                }
            }
            return false; // 所有条件都不满足
        } catch (e) {
            recordError('HNPS决策函数失败', e);
            return false; // 出错时保守返回false
        }
    };

    //=======================
    // 仪表盘功能
    //=======================

    // 记录错误到缓存队列
    const recordError = (msg, error = null) => {
        const entry = {
            time: new Date().toLocaleTimeString(), // 错误发生时间
            message: msg,                         // 错误描述
            detail: error ? error.toString() : '' // 错误详情
        };
        dashboardData.errors.unshift(entry); // 新错误添加到队列开头
        if (dashboardData.errors.length > 5) {
            dashboardData.errors.pop(); // 保持最多5条错误记录
        }
    };

    // 更新仪表盘数据（限流：每秒最多一次）
    const updateDashboardData = async () => {
        try {
            const now = Date.now();
            if (now - dashboardData.lastUpdate < 1000) return; // 限流检查

            // 基础数据更新
            dashboardData.hackingLevel = ns.getHackingLevel();
            dashboardData.money = ns.getPlayer().money;
            dashboardData.hnpsNodes = ns.hacknet.numNodes();

            // 检查各脚本运行状态
            dashboardData.scripts.autohack.running = isScriptRunning(SCRIPT2);
            dashboardData.scripts.stock.running = isScriptRunning(SCRIPT1);
            dashboardData.scripts.hnps.running = isScriptRunning(SCRIPT3);

            // 只有运行中的脚本才更新内存用量
            if (dashboardData.scripts.autohack.running) {
                dashboardData.scripts.autohack.memUsage = ns.getScriptRam(SCRIPT2);
            }

            dashboardData.lastUpdate = now; // 记录本次更新时间
        } catch (e) {
            recordError('仪表盘数据更新失败', e);
        }
    };

    // 绘制仪表盘
    const renderDashboard = () => {
        try {
            const { green, red, yellow, cyan, bgBlue, reset } = COLORS;
            let output = `${bgBlue}=== 系统监控面板 ===${reset}\n`;

            // 基础信息
            output += `🕒 ${cyan}${new Date().toLocaleTimeString()}${reset} | `;
            output += `💻 黑客等级: ${cyan}${ns.formatNumber(dashboardData.hackingLevel, 1)}${reset} | `;
            output += `💰 资金: ${cyan}$${ns.formatNumber(dashboardData.money, 2)}${reset}\n`;
            output += `🌐 HNPS节点: ${cyan}${dashboardData.hnpsNodes}${reset}\n`;

            // 脚本状态
            output += `\n${bgBlue}=== 脚本控制 ===${reset}\n`;
            output += `🤖 ${dashboardData.scripts.autohack.running ?
                `${green}▶ 自动黑客${reset} (${ns.formatRam(dashboardData.scripts.autohack.memUsage)})` :
                `${red}■ 自动黑客${reset}`} | `;
            output += `📈 ${dashboardData.scripts.stock.running ?
                `${green}▶ 股票交易${reset}` :
                `${red}■ 股票交易${reset}`} | `;
            output += `⚙ ${dashboardData.scripts.hnps.running ?
                `${green}▶ HNPS管理${reset}` :
                `${red}■ HNPS管理${reset}`}\n`;

            // 系统建议
            output += `\n${bgBlue}=== 操作建议 ===${reset}\n`;
            if (dashboardData.hackingLevel < 8000) {
                output += `${yellow}▶ 继续自动黑客 (${8000 - dashboardData.hackingLevel}级达标)${reset}\n`;
            } else {
                output += `${green}✔ 黑客等级已达标${reset}\n`;
            }

            if (shouldRunHNPS()) {
                output += `${yellow}▶ 进行HNPS升级${reset}\n`;
            } else {
                output += `${green}✔ HNPS配置已优化${reset}\n`;
            }

            // 错误显示
            if (dashboardData.errors.length > 0) {
                output += `\n${COLORS.bgRed}=== 最近错误 ===${reset}\n`;
                dashboardData.errors.forEach(err => {
                    output += `${red}${err.time} ${err.message}${reset}\n`;
                });
            }

            ns.clearLog();
            ns.print(output);
        } catch (e) {
            ns.print(`${COLORS.red}⚠ 仪表盘渲染失败: ${e}${COLORS.reset}`);
        }
    };

    //=======================
    // 主控制逻辑
    //=======================

    /**
     * 自动黑客管理策略
     * - 黑客等级低于8000时保持运行
     * - 达标后自动停止脚本
     */
    const manageAutohack = async () => {
        try {
            const shouldRun = ns.getHackingLevel() < 8000;
            if (shouldRun) {
                if (!dashboardData.scripts.autohack.running) {
                    await safeRun(SCRIPT2);
                }
            } else {
                if (dashboardData.scripts.autohack.running) {
                    ns.scriptKill(SCRIPT2, HOST);
                }
            }
        } catch (e) {
            recordError('自动黑客管理失败', e);
        }
    };

    /**
     * 股票脚本管理策略
     * - 仅在拥有4S数据API时启动
     * - 只管理启动不处理停止
     */
    const manageStock = async () => {
        try {
            let hasTIX = false;
            try {
                hasTIX = ns.stock.has4SDataTIXAPI();
            } catch (e) {
                recordError('TIX API检查失败', e);
            }

            if (hasTIX) {
                if (!dashboardData.scripts.stock.running) {
                    await safeRun(SCRIPT1);
                }
            }
        } catch (e) {
            recordError('股票管理失败', e);
        }
    };

    // HNPS管理
    const manageHNPS = async () => {
        try {
            const shouldRun = shouldRunHNPS();
            if (shouldRun) {
                if (!dashboardData.scripts.hnps.running) {
                    await safeRun(SCRIPT3);
                }
            } else {
                if (dashboardData.scripts.hnps.running) {
                    ns.scriptKill(SCRIPT3, HOST);
                }
            }
        } catch (e) {
            recordError('HNPS管理失败', e);
        }
    };

    //=======================
    // 主循环
    //=======================
    while (true) {
        try {
            // 更新监控数据（每秒限制）
            await updateDashboardData();

            // 并行执行管理策略
            await Promise.all([
                manageAutohack(),
                manageStock(),
                manageHNPS()
            ]);

            // 渲染控制台界面
            renderDashboard();

            // 等待下一个监控周期
            await ns.sleep(MONITOR_INTERVAL);
        } catch (e) {
            // 主循环崩溃保护
            recordError('主循环崩溃', e);
            await ns.sleep(5000); 
        }
    }
}