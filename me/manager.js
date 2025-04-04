/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL'); // 禁用所有默认日志
    ns.tail(); // 打开独立窗口
    ns.atExit(() => ns.closeTail());

    // 常量定义
    const SCRIPT1 = 'me/stock.js';
    const SCRIPT2 = 'me/autohack.js';
    const SCRIPT3 = 'me/HNPSmanager.js';
    const MONITOR_INTERVAL = 1000;
    const HOST = ns.getHostname();

    // ANSI 颜色代码
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

    // 状态缓存
    let dashboardData = {
        lastUpdate: 0,
        hackingLevel: 0,
        money: 0,
        hnpsNodes: 0,
        errors: [],
        scripts: {
            autohack: { running: false, memUsage: 0 },
            stock: { running: false, profit: 0 },
            hnps: { running: false, cost: 0 }
        }
    };

    //=======================
    // 核心功能函数
    //=======================

    // 检查脚本是否存在
    const scriptExists = (script) => {
        try {
            return ns.fileExists(script, HOST);
        } catch (e) {
            recordError(`检查脚本存在时出错 (${script})`, e);
            return false;
        }
    };

    // 检查脚本运行状态
    const isScriptRunning = (script) => {
        try {
            return ns.isRunning(script, HOST);
        } catch (e) {
            recordError(`检查进程状态时出错 (${script})`, e);
            return false;
        }
    };

    // 安全启动脚本
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
            const money = ns.getPlayer().money;

            // 检查购买新节点
            if (ns.hacknet.numNodes() < ns.hacknet.maxNumNodes()) {
                const nodeCost = ns.hacknet.getPurchaseNodeCost();
                if (nodeCost < money * 0.1) return true;
            }

            // 检查节点升级
            for (let i = 0; i < ns.hacknet.numNodes(); i++) {
                try {
                    const costs = [
                        ns.hacknet.getLevelUpgradeCost(i, 1),
                        ns.hacknet.getRamUpgradeCost(i, 1),
                        ns.hacknet.getCoreUpgradeCost(i, 1)
                    ];
                    if (costs.some(c => c < money * 0.05)) return true;
                } catch (e) {
                    recordError(`节点 ${i} 升级检查失败`, e);
                    continue;
                }
            }
            return false;
        } catch (e) {
            recordError('HNPS决策函数失败', e);
            return false;
        }
    };

    //=======================
    // 仪表盘功能
    //=======================

    // 记录错误
    const recordError = (msg, error = null) => {
        const entry = {
            time: new Date().toLocaleTimeString(),
            message: msg,
            detail: error ? error.toString() : ''
        };
        dashboardData.errors.unshift(entry); // 添加到开头
        if (dashboardData.errors.length > 5) {
            dashboardData.errors.pop(); // 保持最多5条错误
        }
    };

    // 更新仪表盘数据
    const updateDashboardData = async () => {
        try {
            const now = Date.now();
            if (now - dashboardData.lastUpdate < 1000) return;

            dashboardData.hackingLevel = ns.getHackingLevel();
            dashboardData.money = ns.getPlayer().money;
            dashboardData.hnpsNodes = ns.hacknet.numNodes();

            // 脚本状态检查
            dashboardData.scripts.autohack.running = isScriptRunning(SCRIPT2);
            dashboardData.scripts.stock.running = isScriptRunning(SCRIPT1);
            dashboardData.scripts.hnps.running = isScriptRunning(SCRIPT3);

            // 内存用量检查
            if (dashboardData.scripts.autohack.running) {
                dashboardData.scripts.autohack.memUsage = ns.getScriptRam(SCRIPT2);
            }

            dashboardData.lastUpdate = now;
        } catch (e) {
            recordError('仪表盘数据更新失败', e);
        }
    };

    // 绘制仪表盘
    const renderDashboard = () => {
        try {
            const { green, red, yellow, cyan, blue, bgBlue, reset } = COLORS;
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

    // 自动黑客管理
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

    // 股票脚本管理
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
            // 更新数据
            await updateDashboardData();

            // 执行管理逻辑
            await manageAutohack();
            await manageStock();
            await manageHNPS();

            // 渲染界面
            renderDashboard();

            await ns.sleep(MONITOR_INTERVAL);
        } catch (e) {
            recordError('主循环崩溃', e);
            await ns.sleep(5000); // 防止错误循环
        }
    }
}