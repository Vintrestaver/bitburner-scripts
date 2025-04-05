/** @param {NS} ns */
export async function main(ns) {
    // ======================
    // 配置系统 (使用Bitburner支持的ANSI颜色)
    // ======================
    const CONFIG = {
        UI: {
            width: 500,
            height: 700,
            refreshRate: 1000,
            theme: {
                primary: "\u001b[34m",      // 蓝色
                secondary: "\u001b[36m",    // 青色
                success: "\u001b[32m",      // 绿色
                warning: "\u001b[33m",      // 黄色
                danger: "\u001b[31m",       // 红色
                reset: "\u001b[0m",         // 重置
                bgPrimary: "\u001b[44m",    // 蓝色背景
                bgWarning: "\u001b[43m",    // 黄色背景
                bgDanger: "\u001b[41m"      // 红色背景
            }
        },
        SCRIPTS: {
            autohack: {
                path: 'me/autohack.js',
                minHackingLevel: 8000,
                ram: 1.7
            },
            stock: {
                path: 'me/stock.js',
                minFunds: 1e9
            },
        },
        HASH_VALUE: 1e6 / 4,  // 4哈希 = 1百万
        ERROR: {
            MAX_RETRIES: 3,    // 最大重试次数
            COOLDOWN: 5000     // 错误冷却时间(ms)
        }
    };

    // 错误类型枚举
    const ErrorType = {
        CRITICAL: 0,    // 需要立即停止脚本
        FUNCTIONAL: 1,  // 功能部分失效
        TRANSIENT: 2,   // 临时性错误
        WARNING: 3      // 不影响主要功能
    };

    // ======================
    // 工具函数 (增强防御性检查)
    // ======================
    const format = {
        money: amount => {
            if (amount === undefined || amount === null || isNaN(amount)) {
                return `${CONFIG.UI.theme.danger}N/A${CONFIG.UI.theme.reset}`;
            }
            const isNegative = amount < 0;
            const absAmount = Math.abs(amount);
            let formatted;

            if (absAmount >= 1e12) formatted = `$${ns.formatNumber(absAmount / 1e12, 2)}t`;
            else if (absAmount >= 1e9) formatted = `$${ns.formatNumber(absAmount / 1e9, 2)}b`;
            else if (absAmount >= 1e6) formatted = `$${ns.formatNumber(absAmount / 1e6, 2)}m`;
            else formatted = `$${ns.formatNumber(absAmount, 2)}`;

            return isNegative ?
                `${CONFIG.UI.theme.danger}-${formatted}${CONFIG.UI.theme.reset}` :
                `${CONFIG.UI.theme.success}${formatted}${CONFIG.UI.theme.reset}`;
        },
        number: num => {
            if (num === undefined || num === null || isNaN(num)) {
                return `${CONFIG.UI.theme.danger}N/A${CONFIG.UI.theme.reset}`;
            }
            return ns.formatNumber(num, 2);
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

    // 注册脚本退出时的清理函数
    const cleanup = () => {
        try {
            ns.print("正在关闭所有目标脚本...");
            const hostname = ns.getHostname();
            const scriptsToKill = [
                CONFIG.SCRIPTS.autohack.path,
                CONFIG.SCRIPTS.stock.path
            ];

            scriptsToKill.forEach(script => {
                try {
                    if (ns.scriptRunning(script, hostname)) {
                        ns.scriptKill(script, hostname);
                    }
                } catch (e) {
                    ns.print(`无法关闭脚本 ${script}: ${String(e).substring(0, 100)}`);
                }
            });

            ns.print("清理完成");
        } catch (e) {
            ns.print(`清理过程中发生错误: ${String(e).substring(0, 100)}`);
        }
    };

    // 设置退出时的清理函数
    ns.atExit(cleanup);

    // ======================
    // 状态管理系统
    // ======================
    const state = {
        player: {
            hacking: 0,
            money: 0,
            incomeRate: 0,
            incomeSamples: []
        },
        stock: {
            hasAccess: false,
            has4SData: false
        },
        scripts: {
            autohack: { running: false, ramUsage: 0, threads: 0, retries: 0, lastError: null },
            stock: { running: false, retries: 0, lastError: null }
        },
        performance: {
            cycleTime: 0,
            avgCycleTime: 0,
            samples: []
        },
        errors: [],
        errorStats: {
            total: 0,
            lastErrorTime: 0,
            errorRate: 0
        },
        system: {
            healthy: true,
            degraded: false,
            lastRecovery: 0
        }
    };

    /**
     * 记录错误并处理错误抑制和恢复
     * @param {string} context 错误发生的上下文
     * @param {Error} error 错误对象
     * @param {number} severity 错误严重级别
     * @param {boolean} recoverable 是否可恢复
     */
    const recordError = (context, error, severity = ErrorType.FUNCTIONAL, recoverable = true) => {
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
        state.errorStats.total++;
        if (state.errorStats.lastErrorTime > 0) {
            const timeSinceLastError = now - state.errorStats.lastErrorTime;
            state.errorStats.errorRate = 60000 / Math.max(1000, timeSinceLastError); // 每分钟错误率
        }
        state.errorStats.lastErrorTime = now;

        // 如果是严重错误，标记系统为不健康
        if (severity === ErrorType.CRITICAL) {
            state.system.healthy = false;
        } else if (severity === ErrorType.FUNCTIONAL) {
            state.system.degraded = true;
        }

        // 添加到错误列表
        state.errors.unshift(errorEntry);
        if (state.errors.length > 5) state.errors.pop();

        // 如果错误率过高，考虑进入安全模式
        if (state.errorStats.errorRate > 10) { // 每分钟超过10个错误
            state.system.healthy = false;
            state.system.degraded = true;
            errorEntry.message = "[高错误率] " + errorEntry.message;
            errorEntry.severity = ErrorType.CRITICAL;
        }

        return errorEntry;
    };

    /**
     * 尝试恢复系统状态
     */
    const attemptRecovery = async () => {
        const now = Date.now();

        // 防止过于频繁的恢复尝试
        if (now - state.system.lastRecovery < 30000) {
            return false;
        }

        state.system.lastRecovery = now;
        ns.print("尝试系统恢复...");

        try {
            // 1. 清理所有可能冲突的脚本
            cleanup();

            // 2. 重置关键状态
            state.scripts.autohack.running = false;
            state.scripts.stock.running = false;

            // 3. 重新初始化数据收集
            await updatePlayerData(true);
            await updateStockData(true);

            // 4. 重置错误计数器
            state.scripts.autohack.retries = 0;
            state.scripts.stock.retries = 0;

            state.system.healthy = true;
            state.system.degraded = false;
            ns.print("系统恢复成功");
            return true;
        } catch (e) {
            recordError("系统恢复失败", e, ErrorType.CRITICAL, false);
            return false;
        }
    };

    // ======================
    // 数据采集模块 (使用ns.getHackingLevel())
    // ======================
    const updatePlayerData = async (force = false) => {
        if (!state.system.healthy && !force) return false;

        try {
            // 使用ns.getHackingLevel()获取黑客等级
            state.player.hacking = ns.getHackingLevel();

            // 计算收入率 (每5秒采样)
            const player = ns.getPlayer();
            state.player.incomeSamples.push(player.money || 0);
            if (state.player.incomeSamples.length > 10) {
                state.player.incomeSamples.shift();
            }
            if (state.player.incomeSamples.length > 1) {
                const timeWindow = state.player.incomeSamples.length * CONFIG.UI.refreshRate / 1000;
                const incomeChange = state.player.incomeSamples[state.player.incomeSamples.length - 1] -
                    state.player.incomeSamples[0];
                state.player.incomeRate = incomeChange / timeWindow || 0;
            }

            state.player.money = player.money || 0;
            return true;
        } catch (e) {
            recordError("更新玩家数据失败", e, ErrorType.FUNCTIONAL);
            return false;
        }
    };


    const updateStockData = async (force = false) => {
        if (!state.system.healthy && !force) return false;

        try {
            // 仅检查股票API访问权限
            state.stock.hasAccess = ns.stock.hasTIXAPIAccess();
            state.stock.has4SData = ns.stock.has4SDataTIXAPI();
            return true;
        } catch (e) {
            recordError("更新股票数据失败", e, ErrorType.FUNCTIONAL);
            return false;
        }
    };

    // ======================
    // 脚本管理模块 (使用state.player.hacking)
    // ======================
    const manageScripts = async () => {
        if (!state.system.healthy) return false;

        try {
            // 管理自动黑客 - 使用state.player.hacking(来自ns.getHackingLevel())
            const shouldRunAutohack = state.player.hacking < CONFIG.SCRIPTS.autohack.minHackingLevel;
            if (shouldRunAutohack !== state.scripts.autohack.running) {
                try {
                    if (shouldRunAutohack) {
                        const pid = await ns.run(CONFIG.SCRIPTS.autohack.path);
                        state.scripts.autohack.running = pid !== 0;
                        if (state.scripts.autohack.running) {
                            state.scripts.autohack.retries = 0;
                            state.scripts.autohack.lastError = null;
                        } else {
                            throw new Error("无法启动autohack脚本");
                        }
                    } else {
                        ns.scriptKill(CONFIG.SCRIPTS.autohack.path, ns.getHostname());
                        state.scripts.autohack.running = false;
                    }
                } catch (e) {
                    state.scripts.autohack.retries++;
                    state.scripts.autohack.lastError = e;

                    if (state.scripts.autohack.retries >= CONFIG.ERROR.MAX_RETRIES) {
                        recordError("autohack脚本管理失败，达到最大重试次数", e, ErrorType.FUNCTIONAL);
                        state.system.degraded = true;
                    } else {
                        recordError(`autohack脚本管理失败，将重试(${state.scripts.autohack.retries}/${CONFIG.ERROR.MAX_RETRIES})`, e, ErrorType.TRANSIENT);
                    }
                }
            }

            // 更新自动黑客资源使用
            if (state.scripts.autohack.running) {
                try {
                    const proc = ns.ps().find(p => p.filename === CONFIG.SCRIPTS.autohack.path);
                    if (proc) {
                        state.scripts.autohack.ramUsage = CONFIG.SCRIPTS.autohack.ram * (proc.threads || 0);
                        state.scripts.autohack.threads = proc.threads || 0;
                    } else {
                        state.scripts.autohack.running = false;
                        throw new Error("autohack脚本意外终止");
                    }
                } catch (e) {
                    recordError("更新autohack脚本状态失败", e, ErrorType.WARNING);
                }
            }

            // 管理股票脚本 - 修改为永久运行，仅检查启动条件
            const shouldRunStock = state.stock.hasAccess &&
                state.stock.has4SData &&
                (state.player.money || 0) >= CONFIG.SCRIPTS.stock.minFunds;
            if (shouldRunStock && !state.scripts.stock.running) {
                try {
                    const pid = await ns.run(CONFIG.SCRIPTS.stock.path);
                    state.scripts.stock.running = pid !== 0;
                    if (state.scripts.stock.running) {
                        state.scripts.stock.retries = 0;
                        state.scripts.stock.lastError = null;
                    } else {
                        throw new Error("无法启动stock脚本");
                    }
                } catch (e) {
                    state.scripts.stock.retries++;
                    state.scripts.stock.lastError = e;

                    if (state.scripts.stock.retries >= CONFIG.ERROR.MAX_RETRIES) {
                        recordError("stock脚本管理失败，达到最大重试次数", e, ErrorType.FUNCTIONAL);
                    } else {
                        recordError(`stock脚本管理失败，将重试(${state.scripts.stock.retries}/${CONFIG.ERROR.MAX_RETRIES})`, e, ErrorType.TRANSIENT);
                    }
                }
            }

            return true;
        } catch (e) {
            recordError("脚本管理失败", e, ErrorType.CRITICAL);
            return false;
        }
    };

    // ======================
    // 界面渲染模块
    // ======================
    const renderDashboard = () => {
        try {
            const c = CONFIG.UI.theme;
            let output = [];

            // 1. 标题栏 (显示系统健康状态)
            const titleColor = !state.system.healthy ? c.bgDanger :
                state.system.degraded ? c.bgWarning : c.bgPrimary;
            const statusText = !state.system.healthy ? "CRITICAL" :
                state.system.degraded ? "DEGRADED" : "NORMAL";
            output.push(`${titleColor}${c.secondary}=== BITBURNER 监控系统 [${statusText}] ===${c.reset}`);

            // 2. 玩家状态
            output.push(`${c.primary}◆ 玩家状态${c.reset}`);
            output.push(`等级: ${format.number(state.player.hacking)} ${format.progress(state.player.hacking, CONFIG.SCRIPTS.autohack.minHackingLevel)}`);
            output.push(`资金: ${format.money(state.player.money)} (${format.money(state.player.incomeRate)}/s)`);

            // 3. 股票状态 (简化显示)
            output.push(`\n${c.primary}◆ 股票市场${c.reset}`);
            output.push(`访问权限: ${state.stock.hasAccess ? c.success + "已获得" : c.danger + "未获得"}`);
            output.push(`4S数据: ${state.stock.has4SData ? c.success + "已解锁" : c.warning + "未解锁"}`);

            // 5. 脚本状态 (显示重试次数和最后错误)
            output.push(`\n${c.primary}◆ 脚本控制${c.reset}`);
            const scriptStatus = (running, color, status, retries) =>
                `${running ? color + status : c.danger + "已停止"}${c.reset}${retries > 0 ? ` [重试:${format.number(retries)}]` : ''}`;

            output.push(`自动黑客: ${scriptStatus(state.scripts.autohack.running, c.success,
                `运行中 (${format.number(state.scripts.autohack.threads)}线程)`, state.scripts.autohack.retries)}`);

            output.push(`股票脚本: ${state.scripts.stock.running ? scriptStatus(true, c.success, "运行中", state.scripts.stock.retries) :
                state.stock.hasAccess && state.stock.has4SData ? scriptStatus(false, c.warning, "待机", state.scripts.stock.retries) :
                    scriptStatus(false, c.danger, "无访问", state.scripts.stock.retries)}`);


            // 6. 错误信息 (显示更详细的错误信息)
            if (state.errors.length > 0) {
                output.push(`\n${c.bgDanger}${c.secondary}◆ 最近错误(共${state.errorStats.total}次, 频率: ${format.number(state.errorStats.errorRate)} / 分钟)${c.reset} `);
                state.errors.slice(0, 2).forEach(err => {
                    const severityText = ["CRIT", "FUNC", "TRANS", "WARN"][err.severity] || "UNKN";
                    output.push(`${err.time} [${severityText}${err.recoverable ? '' : '*'}]: ${err.context} `);
                    output.push(`  ${c.danger}${err.message}${c.reset} `);
                    if (err.stack) {
                        output.push(`  ${c.danger}${err.stack.split('\n')[0]}${c.reset} `);
                    }
                });

                if (state.errorStats.total > 2) {
                    output.push(`  ${c.danger}...还有${state.errorStats.total - 2}个错误未显示${c.reset} `);
                }
            }

            // 7. 性能信息
            output.push(`\n${c.secondary} 周期: ${format.number(state.performance.cycleTime)} ms(平均 ${format.number(state.performance.avgCycleTime)}ms)${c.reset} `);

            // 8. 系统状态建议
            if (!state.system.healthy) {
                output.push(`\n${c.bgDanger}${c.secondary}◆ 系统严重错误! 建议重启脚本${c.reset} `);
            } else if (state.system.degraded) {
                output.push(`\n${c.bgWarning}${c.secondary}◆ 系统部分功能降级${c.reset} `);
            }

            ns.clearLog();
            output.forEach(line => ns.print(line));
            return true;
        } catch (e) {
            ns.print(`${CONFIG.UI.theme.danger} 渲染错误: ${String(e).substring(0, 150)}${CONFIG.UI.theme.reset} `);
            return false;
        }
    };

    // ======================
    // 主程序
    // ======================
    ns.disableLog('ALL');
    ns.clearLog();
    ns.ui.openTail();
    ns.ui.resizeTail(CONFIG.UI.width, CONFIG.UI.height);

    // 初始健康检查
    try {
        await updatePlayerData(true);
        await updateStockData(true);
    } catch (e) {
        recordError("初始健康检查失败", e, ErrorType.CRITICAL);
        ns.print(`${CONFIG.UI.theme.danger} 初始健康检查失败，脚本无法继续运行${CONFIG.UI.theme.reset} `);
        ns.print(`${CONFIG.UI.theme.danger} 错误详情: ${String(e).substring(0, 150)}${CONFIG.UI.theme.reset} `);
        return;
    }

    while (true) {
        const cycleStart = Date.now();

        try {
            // 如果系统不健康，尝试恢复
            if (!state.system.healthy) {
                const recovered = await attemptRecovery();
                if (!recovered) {
                    await ns.sleep(CONFIG.UI.refreshRate);
                    continue;
                }
            }

            // 数据更新
            const playerUpdated = await updatePlayerData();
            const stockUpdated = await updateStockData();

            // 如果关键数据更新失败，标记系统为降级
            if (!playerUpdated) {
                state.system.degraded = true;
            }

            // 脚本管理
            const scriptsManaged = await manageScripts();
            if (!scriptsManaged) {
                state.system.degraded = true;
            }

            // 性能记录
            state.performance.cycleTime = Date.now() - cycleStart;
            state.performance.samples.push(state.performance.cycleTime);
            if (state.performance.samples.length > 10) {
                state.performance.samples.shift();
            }
            state.performance.avgCycleTime = state.performance.samples.reduce((a, b) => a + b, 0) / state.performance.samples.length;

            // 渲染界面
            const rendered = renderDashboard();
            if (!rendered) {
                state.system.degraded = true;
            }

            // 如果系统降级但关键功能仍工作，尝试自动恢复
            if (state.system.degraded && playerUpdated &&
                Date.now() - state.system.lastRecovery > 60000) {
                await attemptRecovery();
            }
        } catch (e) {
            recordError("主循环错误", e, ErrorType.CRITICAL);

            // 如果连续发生严重错误，考虑停止脚本
            const criticalErrors = state.errors.filter(err => err.severity === ErrorType.CRITICAL).length;
            if (criticalErrors >= 3) {
                ns.print(`${CONFIG.UI.theme.bgDanger}${CONFIG.UI.theme.secondary} 检测到多个严重错误，脚本将停止运行${CONFIG.UI.theme.reset} `);
                break;
            }
        } finally {
            await ns.sleep(CONFIG.UI.refreshRate);
        }
    }
}
