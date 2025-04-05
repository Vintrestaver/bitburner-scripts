/** @param {NS} ns */
export async function main(ns) {
    // 初始化设置
    ns.disableLog('ALL');
    const WINDOW_SIZE = { width: 100, height: 40 };
    ns.ui.resizeTail(WINDOW_SIZE.width, WINDOW_SIZE.height);
    ns.ui.openTail();

    // 退出处理
    ns.atExit(() => {
        ns.ui.closeTail();
        [SCRIPT1, SCRIPT2, SCRIPT3].forEach(script => {
            if (ns.isRunning(script, HOST)) ns.scriptKill(script, HOST);
        });
    });

    // 常量定义
    const SCRIPT1 = 'me/stock.js';
    const SCRIPT2 = 'me/autohack.js';
    const SCRIPT3 = 'me/HNPSmanager.js';
    const MONITOR_INTERVAL = 1000;
    const HOST = ns.getHostname();
    const HASH_TO_CASH_RATIO = 4; // 4哈希 = $1e6

    // 颜色配置
    const COLORS = {
        reset: "\u001b[0m",
        red: "\u001b[31m",
        green: "\u001b[32m",
        yellow: "\u001b[33m",
        blue: "\u001b[34m",
        cyan: "\u001b[36m",
        white: "\u001b[37m",
        bgBlue: "\u001b[44m",
        bgRed: "\u001b[41m",
        bgGreen: "\u001b[42m",
        bgYellow: "\u001b[43m"
    };

    // 状态数据
    let dashboardData = {
        lastUpdate: 0,
        hackingLevel: 0,
        money: 0,
        hnpsStats: {
            nodes: 0,
            totalProduction: 0, // 以美元计算
            totalSpent: 0,
            roi: 0,
            breakEvenTime: 0,
            currentRate: 0 // 美元/秒
        },
        errors: [],
        scripts: {
            autohack: { running: false, memUsage: 0 },
            stock: { running: false, profit: 0 },
            hnps: { running: false }
        },
        performance: {
            lastCycleTime: 0,
            cycleTimeAvg: 0
        }
    };

    //=======================
    // 工具函数
    //=======================

    const formatBreakEvenTime = (hours) => {
        if (hours === Infinity) return "∞";
        if (hours > 24 * 365) return `${(hours / (24 * 365)).toFixed(1)}年`;
        if (hours > 24 * 30) return `${(hours / (24 * 30)).toFixed(1)}月`;
        if (hours > 168) return `${(hours / 168).toFixed(1)}周`;
        if (hours > 24) return `${(hours / 24).toFixed(1)}天`;
        if (hours >= 1) return `${hours.toFixed(1)}小时`;
        if (hours >= 1 / 60) return `${(hours * 60).toFixed(0)}分钟`;
        return `${(hours * 3600).toFixed(0)}秒`;
    };

    const renderProgressBar = (value, max, width = 20) => {
        const progress = Math.min(1, Math.max(0, value / max));
        const filled = Math.floor(progress * width);
        const empty = width - filled;
        return '[' + '█'.repeat(filled) + ' '.repeat(empty) + ']';
    };

    const scriptExists = (script) => ns.fileExists(script, HOST);

    const safeRun = async (script, threads = 1) => {
        try {
            return scriptExists(script) ? ns.run(script, threads) !== 0 : false;
        } catch (e) {
            recordError(`启动失败: ${script}`, e);
            return false;
        }
    };

    const recordError = (msg, error = null) => {
        dashboardData.errors.unshift({
            time: new Date().toLocaleTimeString(),
            message: msg,
            detail: error?.toString() || ''
        });
        if (dashboardData.errors.length > 5) dashboardData.errors.pop();
    };

    //=======================
    // HNPS 经济分析 (使用4哈希=1e6金钱的转换)
    //=======================

    const isHNPSProfitable = () => {
        try {
            let totalProduction = 0;
            let totalSpent = 0;
            const nodes = ns.hacknet.numNodes();
            let currentRate = 0;

            for (let i = 0; i < nodes; i++) {
                const node = ns.hacknet.getNodeStats(i);
                // 应用4哈希=1e6金钱的转换
                const nodeProduction = (node.totalProduction / HASH_TO_CASH_RATIO) * 1e6;
                const nodeCurrentRate = (node.production / HASH_TO_CASH_RATIO) * 1e6;

                totalProduction += nodeProduction;
                currentRate += nodeCurrentRate;

                // 计算节点购买成本
                totalSpent += ns.hacknet.getPurchaseNodeCost(i);

                // 计算历史升级成本
                const nodeData = ns.hacknet.getNodeStats(i);
                if (nodeData.level > 1) {
                    for (let l = 1; l < nodeData.level; l++) {
                        totalSpent += ns.hacknet.getLevelUpgradeCost(i, 1);
                    }
                }
                if (nodeData.ram > 1) {
                    for (let r = 1; r < nodeData.ram; r *= 2) {
                        totalSpent += ns.hacknet.getRamUpgradeCost(i, 1);
                    }
                }
                if (nodeData.cores > 1) {
                    for (let c = 1; c < nodeData.cores; c++) {
                        totalSpent += ns.hacknet.getCoreUpgradeCost(i, 1);
                    }
                }
            }

            const roi = totalProduction / Math.max(1, totalSpent);
            const breakEvenTime = currentRate > 0 ? (totalSpent - totalProduction) / currentRate / 3600 : Infinity;

            dashboardData.hnpsStats = {
                nodes,
                totalProduction,
                totalSpent,
                roi,
                breakEvenTime,
                currentRate
            };

            // 动态收益判断标准
            const minAcceptableROI = nodes > 10 ? 1.5 : 1.2;
            return roi > minAcceptableROI || breakEvenTime < 12;
        } catch (e) {
            recordError('HNPS收益计算失败', e);
            return false;
        }
    };

    //=======================
    // 脚本管理
    //=======================

    const manageAutohack = async () => {
        try {
            const shouldRun = ns.getHackingLevel() < 8000;
            if (shouldRun && !dashboardData.scripts.autohack.running) {
                if (await safeRun(SCRIPT2)) {
                    dashboardData.scripts.autohack.running = true;
                }
            } else if (!shouldRun && dashboardData.scripts.autohack.running) {
                ns.scriptKill(SCRIPT2, HOST);
                dashboardData.scripts.autohack.running = false;
            }

            // 更新内存使用情况 - 修正版本
            if (dashboardData.scripts.autohack.running) {
                const scriptRam = ns.getScriptRam(SCRIPT2);
                const scriptInfo = ns.ps(HOST).find(script => script.filename === SCRIPT2);
                dashboardData.scripts.autohack.memUsage = scriptRam * (scriptInfo?.threads || 1);
            }
        } catch (e) {
            recordError('自动黑客管理失败', e);
        }
    };

    const manageStock = async () => {
        try {
            const hasTIX = ns.stock.has4SDataTIXAPI?.() ?? false;
            if (hasTIX && !dashboardData.scripts.stock.running) {
                if (await safeRun(SCRIPT1)) {
                    dashboardData.scripts.stock.running = true;
                }
            } else if (!hasTIX && dashboardData.scripts.stock.running) {
                ns.scriptKill(SCRIPT1, HOST);
                dashboardData.scripts.stock.running = false;
            }

            // 更新股票利润
            if (dashboardData.scripts.stock.running) {
                const portfolio = ns.stock.getPortfolio();
                dashboardData.scripts.stock.profit = portfolio.reduce((sum, pos) => sum + pos.profit, 0);
            }
        } catch (e) {
            recordError('股票管理失败', e);
        }
    };

    const manageHNPS = async () => {
        try {
            const shouldRun = isHNPSProfitable();
            if (shouldRun && !dashboardData.scripts.hnps.running) {
                if (await safeRun(SCRIPT3)) {
                    dashboardData.scripts.hnps.running = true;
                }
            } else if (!shouldRun && dashboardData.scripts.hnps.running) {
                ns.scriptKill(SCRIPT3, HOST);
                dashboardData.scripts.hnps.running = false;
            }
        } catch (e) {
            recordError('HNPS管理失败', e);
        }
    };

    //=======================
    // 数据更新
    //=======================

    const updateDashboardData = async () => {
        const cycleStart = Date.now();
        try {
            const now = Date.now();
            if (now - dashboardData.lastUpdate < 1000) return;

            dashboardData.hackingLevel = ns.getHackingLevel();
            dashboardData.money = ns.getPlayer().money;

            // 更新脚本状态
            dashboardData.scripts.autohack.running = ns.isRunning(SCRIPT2, HOST);
            dashboardData.scripts.stock.running = ns.isRunning(SCRIPT1, HOST);
            dashboardData.scripts.hnps.running = ns.isRunning(SCRIPT3, HOST);

            dashboardData.lastUpdate = now;
        } catch (e) {
            recordError('数据更新失败', e);
        } finally {
            // 计算性能指标
            const cycleTime = Date.now() - cycleStart;
            dashboardData.performance.lastCycleTime = cycleTime;
            dashboardData.performance.cycleTimeAvg =
                (dashboardData.performance.cycleTimeAvg * 9 + cycleTime) / 10;
        }
    };

    //=======================
    // 仪表盘渲染
    //=======================

    const renderDashboard = () => {
        try {
            const { green, red, yellow, cyan, blue, white, bgBlue, bgRed, bgGreen, bgYellow, reset } = COLORS;
            let output = '';

            // 顶部标题栏
            output += `${bgBlue}${white}=== BITBURNER 系统监控 ===${reset}\n\n`;

            // 基础信息部分
            output += `${blue}🕒 时间:${reset} ${cyan}${new Date().toLocaleTimeString()}${reset} | `;
            output += `${blue}⚡ 性能:${reset} ${dashboardData.performance.lastCycleTime}ms (avg: ${dashboardData.performance.cycleTimeAvg.toFixed(1)}ms)\n`;

            output += `${blue}💻 黑客等级:${reset} ${cyan}Lv.${dashboardData.hackingLevel}${reset} `;
            output += renderProgressBar(dashboardData.hackingLevel, 8000);
            output += `\n`;

            output += `${blue}💰 资金:${reset} ${cyan}$${ns.formatNumber(dashboardData.money, 2)}${reset}\n\n`;

            // HNPS经济数据 (显示转换后的美元值)
            output += `${bgBlue}${white}=== HNPS 经济分析 ===${reset}\n`;
            output += `${blue}🌐 节点数量:${reset} ${cyan}${dashboardData.hnpsStats.nodes}${reset}\n`;
            output += `${blue}📈 当前收益:${reset} ${cyan}$${ns.formatNumber(dashboardData.hnpsStats.currentRate, 2)}/秒${reset}\n`;
            output += `${blue}💵 总收益:${reset} ${cyan}$${ns.formatNumber(dashboardData.hnpsStats.totalProduction, 2)}${reset}\n`;
            output += `${blue}💸 总投资:${reset} ${cyan}$${ns.formatNumber(dashboardData.hnpsStats.totalSpent, 2)}${reset}\n`;

            const roiColor = dashboardData.hnpsStats.roi >= 1.5 ? green :
                dashboardData.hnpsStats.roi >= 1.2 ? yellow : red;
            output += `${blue}🔄 ROI:${reset} ${roiColor}${dashboardData.hnpsStats.roi.toFixed(2)}x${reset} | `;

            const betColor = dashboardData.hnpsStats.breakEvenTime < 6 ? green :
                dashboardData.hnpsStats.breakEvenTime < 12 ? yellow : red;
            output += `${blue}回本时间:${reset} ${betColor}${formatBreakEvenTime(dashboardData.hnpsStats.breakEvenTime)}${reset}\n\n`;

            // 脚本状态部分
            output += `${bgBlue}${white}=== 脚本状态 ===${reset}\n`;

            // 自动黑客状态
            const autohackStatus = dashboardData.scripts.autohack.running ?
                `${green}运行中 (${ns.formatRam(dashboardData.scripts.autohack.memUsage)})` :
                `${red}已停止`;
            output += `${blue}🤖 自动黑客:${reset} ${autohackStatus}${reset}\n`;

            // 股票状态
            const stockStatus = dashboardData.scripts.stock.running ?
                `${green}运行中 ($${ns.formatNumber(dashboardData.scripts.stock.profit, 2)})` :
                `${red}已停止`;
            output += `${blue}📈 股票交易:${reset} ${stockStatus}${reset}\n`;

            // HNPS状态
            const hnpsStatus = dashboardData.scripts.hnps.running ?
                (dashboardData.hnpsStats.roi >= 1.2 ? `${green}运行中` : `${yellow}运行中(低收益)`) :
                `${red}已停止`;
            output += `${blue}⚙ HNPS管理:${reset} ${hnpsStatus}${reset}\n\n`;

            // 错误显示
            if (dashboardData.errors.length > 0) {
                output += `${bgRed}${white}=== 最近错误 (${dashboardData.errors.length}) ===${reset}\n`;
                dashboardData.errors.slice(0, 3).forEach(err => {
                    output += `${red}${err.time} ${err.message}${reset}\n`;
                    if (err.detail) output += `    ${yellow}${err.detail}${reset}\n`;
                });
            }

            ns.clearLog();
            ns.print(output);
        } catch (e) {
            ns.print(`${red}仪表盘渲染错误: ${e}${reset}`);
        }
    };

    //=======================
    // 主循环
    //=======================

    while (true) {
        try {
            await updateDashboardData();
            await Promise.all([
                manageAutohack(),
                manageStock(),
                manageHNPS()
            ]);
            renderDashboard();
            await ns.sleep(MONITOR_INTERVAL);
        } catch (e) {
            recordError('主循环错误', e);
            await ns.sleep(5000);
        }
    }
}

