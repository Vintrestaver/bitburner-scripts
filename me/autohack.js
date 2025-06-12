/** @param {NS} ns **/
export async function main(ns) {
    try {
        ns.disableLog('ALL');
        ns.ui.openTail();
        const [winX, winy] = ns.ui.windowSize();
        ns.ui.moveTail(winX - 550, 0);
        ns.ui.resizeTail(550, winy);

        // =============== 配置中心 ===============
        const CONFIG = {
            FILES: {
                GROW: 'grow.script',
                WEAK: 'weak.script',
                HACK: 'hack.script'
            },
            THRESHOLDS: {
                MIN_RAM: 8,
                SECURITY_BUFFER: 0.95,
                MONEY_RATIO: 0.8,
                HACK_PERCENT: 0.5
            },
            EXCLUDE_SERVERS: ['home'],
            CYCLE_CHARS: ['', '▄', '█', '▀', '█'],
            COLORS: {
                SUCCESS: '\x1b[32m',
                WARNING: '\x1b[33m',
                ERROR: '\x1b[31m',
                INFO: '\x1b[36m',
                MONEY: '\x1b[35m',
                SECURITY: '\x1b[33m',
                RESET: '\x1b[0m',
                EFFICIENCY: '\x1b[33m'
            }
        };

        // 只写入缺失的脚本文件（添加错误处理）
        const createScript = (filename, content) => {
            try {
                if (!ns.fileExists(filename)) {
                    ns.write(filename, content, 'w');
                    ns.toast(`${CONFIG.COLORS.SUCCESS}创建脚本: ${filename}${CONFIG.COLORS.RESET}`, "success");
                }
            } catch (e) {
                ns.toast(`创建脚本错误 ${filename}: ${e}`, "error");
            }
        };

        createScript(CONFIG.FILES.GROW, 'grow(args[0]);');
        createScript(CONFIG.FILES.WEAK, 'weaken(args[0]);');
        createScript(CONFIG.FILES.HACK, 'hack(args[0]);');

        // =============== 服务器状态缓存 ===============
        class ServerCache {
            static cache = new Map();
            static expiration = new Map();
            static CACHE_TTL = 1000; // 5秒缓存时间

            static get(ns, server, property) {
                try {
                    const key = `${server}|${property}`;
                    if (!this.isValid(key)) {
                        this.update(ns, server, property);
                    }
                    return this.cache.get(key);
                } catch (e) {
                    ns.tprint(`${CONFIG.COLORS.ERROR}缓存错误 ${server}.${property}: ${e}${CONFIG.COLORS.RESET}`);
                    return 0;
                }
            }
            /** @param {NS} ns **/
            static update(ns, server, property) {
                try {
                    const key = `${server}|${property}`;
                    let value;

                    switch (property) {
                        case 'maxMoney': value = ns.getServerMaxMoney(server); break;
                        case 'money': value = ns.getServerMoneyAvailable(server); break;
                        case 'maxRam': value = ns.getServerMaxRam(server); break;
                        case 'usedRam': value = ns.getServerUsedRam(server); break;
                        case 'ports': value = ns.getServerNumPortsRequired(server); break;
                        case 'hackLevel': value = ns.getServerRequiredHackingLevel(server); break;
                        case 'security': value = ns.getServerSecurityLevel(server); break;
                        case 'minSecurity': value = ns.getServerMinSecurityLevel(server); break;
                        case 'growTime': value = ns.getGrowTime(server); break;
                        case 'hackTime': value = ns.getHackTime(server); break;
                    }

                    this.cache.set(key, value);
                    this.expiration.set(key, Date.now() + this.CACHE_TTL);
                    return value;
                } catch (e) {
                    ns.tprint(`${CONFIG.COLORS.ERROR}缓存更新错误 ${server}.${property}: ${e}${CONFIG.COLORS.RESET}`);
                    return 0;
                }
            }

            static batchUpdate(ns, server) {
                try {
                    // 优化后的核心参数列表 移除非必要参数
                    const properties = ['maxMoney', 'money', 'maxRam', 'usedRam', 'security', 'growTime', 'hackTime', 'minSecurity'];
                    properties.forEach(prop => ServerCache.update(ns, server, prop));
                } catch (e) {
                    ns.tprint(`${CONFIG.COLORS.ERROR}批量缓存更新错误 ${server}: ${e}${CONFIG.COLORS.RESET}`);
                }
            }

            static isValid(key) {
                return this.cache.has(key) &&
                    this.expiration.has(key) &&
                    this.expiration.get(key) > Date.now();
            }

            static clearExpired() {
                try {
                    const now = Date.now();
                    for (const [key, expire] of this.expiration) {
                        if (expire <= now) {
                            this.cache.delete(key);
                            this.expiration.delete(key);
                        }
                    }
                } catch (e) {
                    ns.tprint(`${CONFIG.COLORS.ERROR}缓存清理错误: ${e}${CONFIG.COLORS.RESET}`);
                }
            }
        }

        // =============== 资源管理器 ===============
        class ResourceManager {
            static availableExes = [];
            static scriptRamCache = new Map();
            static scriptRamExpiration = new Map();
            static CACHE_TTL = 1000; // 5秒缓存时间

            static async scanExes(ns) {
                try {
                    this.availableExes = [];
                    const exeList = ['brutessh', 'ftpcrack', 'relaysmtp', 'sqlinject', 'httpworm'];
                    for (const exe of exeList) {
                        if (ns.fileExists(`${exe}.exe`)) this.availableExes.push(exe);
                    }
                } catch (e) {
                    ns.tprint(`${CONFIG.COLORS.ERROR}扫描EXE错误: ${e}${CONFIG.COLORS.RESET}`);
                }
            }

            static getScriptRam(ns, script, host) {
                try {
                    const key = `${host}|${script}`;
                    if (!this.isValid(key)) {
                        this.updateCache(ns, script, host);
                    }
                    return this.scriptRamCache.get(key) || 0;
                } catch (e) {
                    ns.tprint(`${CONFIG.COLORS.ERROR}获取脚本RAM错误 ${script}@${host}: ${e}${CONFIG.COLORS.RESET}`);
                    return 0;
                }
            }

            static updateCache(ns, script, host) {
                try {
                    const key = `${host}|${script}`;
                    const ram = ns.getScriptRam(script, host);
                    this.scriptRamCache.set(key, ram);
                    this.scriptRamExpiration.set(key, Date.now() + this.CACHE_TTL);
                } catch (e) {
                    ns.tprint(`${CONFIG.COLORS.ERROR}更新脚本RAM缓存错误 ${script}@${host}: ${e}${CONFIG.COLORS.RESET}`);
                }
            }

            static isValid(key) {
                return this.scriptRamCache.has(key) &&
                    this.scriptRamExpiration.has(key) &&
                    this.scriptRamExpiration.get(key) > Date.now();
            }

            static clearExpired() {
                try {
                    const now = Date.now();
                    for (const [key, expire] of this.scriptRamExpiration) {
                        if (expire <= now) {
                            this.scriptRamCache.delete(key);
                            this.scriptRamExpiration.delete(key);
                        }
                    }
                } catch (e) {
                    ns.tprint(`${CONFIG.COLORS.ERROR}资源管理器清理错误: ${e}${CONFIG.COLORS.RESET}`);
                }
            }
        }

        // =============== 目标调度器 ===============
        class TargetScheduler {
            static targets = [];
            static hosts = [];
            static currentIndex = 0;

            static addTarget(server) {
                try {
                    // 优化权重计算
                    const money = ServerCache.get(ns, server, 'money');
                    const maxMoney = ServerCache.get(ns, server, 'maxMoney');
                    const minSecurity = ServerCache.get(ns, server, 'minSecurity');
                    const currentSecurity = ServerCache.get(ns, server, 'security');
                    const hackLevel = ServerCache.get(ns, server, 'hackLevel');
                    const growTime = ServerCache.get(ns, server, 'growTime');
                    const hackTime = ServerCache.get(ns, server, 'hackTime');

                    // 基础权重
                    let weight = money;

                    // 安全系数
                    const securityFactor = Math.max(0.1, (minSecurity / currentSecurity));
                    weight *= securityFactor;

                    // 黑客难度系数
                    const hackDifficulty = Math.min(1.5, ns.getHackingLevel() / hackLevel);
                    weight *= hackDifficulty;

                    // 优化时间效率计算
                    weight /= (Math.log1p(growTime) + Math.log1p(hackTime)) * 0.8;

                    this.targets.push({ server, weight });
                } catch (e) {
                    ns.tprint(`${CONFIG.COLORS.ERROR}添加目标错误 ${server}: ${e}${CONFIG.COLORS.RESET}`);
                }
            }

            static addHost(server) {
                try {
                    const ram = ServerCache.get(ns, server, 'maxRam');
                    this.hosts.push({ server, ram });
                } catch (e) {
                    ns.tprint(`${CONFIG.COLORS.ERROR}添加主机错误 ${server}: ${e}${CONFIG.COLORS.RESET}`);
                }
            }

            static sortTargets() {
                try {
                    this.targets.sort((a, b) => b.weight - a.weight);
                } catch (e) {
                    ns.tprint(`${CONFIG.COLORS.ERROR}目标排序错误: ${e}${CONFIG.COLORS.RESET}`);
                }
            }

            static sortHosts() {
                try {
                    this.hosts.sort((a, b) => b.ram - a.ram);
                } catch (e) {
                    ns.tprint(`${CONFIG.COLORS.ERROR}主机排序错误: ${e}${CONFIG.COLORS.RESET}`);
                }
            }

            static getNextTarget() {
                try {
                    if (this.targets.length === 0) return null;

                    if (this.currentIndex >= this.targets.length) {
                        this.currentIndex = 0;
                    }
                    return this.targets[this.currentIndex++].server;
                } catch (e) {
                    ns.tprint(`${CONFIG.COLORS.ERROR}获取目标错误: ${e}${CONFIG.COLORS.RESET}`);
                    return null;
                }
            }
        }

        // =============== 核心功能 ===============
        const canHack = (server) => {
            try {
                // 完全移除ports检查
                const hackLevel = ServerCache.get(ns, server, 'hackLevel');
                return hackLevel <= ns.getHackingLevel();
            } catch (e) {
                ns.tprint(`${CONFIG.COLORS.ERROR}检查可入侵错误 ${server}: ${e}${CONFIG.COLORS.RESET}`);
                return false;
            }
        };

        const prepareServer = (server) => {
            try {
                if (ns.hasRootAccess(server)) return true;

                for (const exe of ResourceManager.availableExes) {
                    try { ns[exe](server); } catch { }
                }

                try {
                    ns.nuke(server);
                    return true;
                } catch {
                    return false;
                }
            } catch (e) {
                ns.tprint(`${CONFIG.COLORS.ERROR}准备服务器错误 ${server}: ${e}${CONFIG.COLORS.RESET}`);
                return false;
            }
        };

        const scanNetwork = async () => {
            try {
                const queue = ['home'];
                const visited = new Set(['home']);

                TargetScheduler.hosts = [];
                TargetScheduler.targets = [];

                while (queue.length > 0) {
                    const current = queue.shift();
                    ServerCache.batchUpdate(ns, current);

                    // 添加主机
                    if (ServerCache.get(ns, current, 'maxRam') > CONFIG.THRESHOLDS.MIN_RAM &&
                        !CONFIG.EXCLUDE_SERVERS.includes(current)) {
                        TargetScheduler.addHost(current);
                    }

                    // 扫描邻居
                    const neighbors = ns.scan(current);
                    for (const neighbor of neighbors) {
                        if (!visited.has(neighbor)) {
                            visited.add(neighbor);
                            queue.push(neighbor);

                            // 准备服务器
                            if (prepareServer(neighbor)) {
                                ServerCache.batchUpdate(ns, neighbor);

                                // 只复制缺失的脚本
                                const filesToCopy = Object.values(CONFIG.FILES).filter(f =>
                                    !ns.fileExists(f, neighbor)
                                );

                                if (filesToCopy.length > 0) {
                                    try {
                                        ns.scp(filesToCopy, neighbor, 'home');
                                    } catch (e) {
                                        ns.tprint(`${CONFIG.COLORS.ERROR}复制脚本到${neighbor}错误: ${e}${CONFIG.COLORS.RESET}`);
                                    }
                                }

                                // 添加目标
                                if (ServerCache.get(ns, neighbor, 'maxMoney') > 0 &&
                                    ServerCache.get(ns, neighbor, 'minSecurity') < 100 &&
                                    canHack(neighbor)) {
                                    TargetScheduler.addTarget(neighbor);
                                }
                            }
                        }
                    }
                }

                // 排序目标列表
                TargetScheduler.sortTargets();
                TargetScheduler.sortHosts();

                ns.print(`网络扫描完成: ${visited.size}服务器, ${TargetScheduler.targets.length}目标`);
            } catch (e) {
                ns.tprint(`${CONFIG.COLORS.ERROR}网络扫描错误: ${e}${CONFIG.COLORS.RESET}`);
            }
        };

        const executeAttack = (host, target) => {
            try {
                // 实时获取RAM状态
                const maxRam = ns.getServerMaxRam(host);
                const usedRam = ns.getServerUsedRam(host);
                const freeRam = maxRam - usedRam;

                // 安全等级过高 -> 削弱
                const currentSecurity = ServerCache.get(ns, target, 'security');
                const minSecurity = ServerCache.get(ns, target, 'minSecurity');

                if (minSecurity / currentSecurity < CONFIG.THRESHOLDS.SECURITY_BUFFER) {
                    return executeScript(CONFIG.FILES.WEAK, host, freeRam, target, 'W');
                }

                // 资金不足 -> 增长
                const currentMoney = ServerCache.get(ns, target, 'money');
                const maxMoney = ServerCache.get(ns, target, 'maxMoney');

                if (currentMoney < maxMoney * CONFIG.THRESHOLDS.MONEY_RATIO) {
                    return executeScript(CONFIG.FILES.GROW, host, freeRam, target, 'G');
                }

                // 执行攻击
                return executeScript(CONFIG.FILES.HACK, host, freeRam, target, 'H');
            } catch (e) {
                ns.tprint(`${CONFIG.COLORS.ERROR}执行攻击错误 ${host} -> ${target}: ${e}${CONFIG.COLORS.RESET}`);
                return { actionType: null, earnings: 0 };
            }
        };

        const executeScript = (script, host, freeRam, target, actionType) => {
            try {
                const ramCost = ResourceManager.getScriptRam(ns, script, host);
                if (ramCost <= 0 || ramCost > freeRam) {
                    return { actionType: null, earnings: 0 };
                }

                let threads = Math.floor(freeRam / ramCost);
                if (threads < 1) return { actionType: null, earnings: 0 };

                // 攻击线程限制
                let earnings = 0;
                if (script === CONFIG.FILES.HACK) {
                    const hackPercent = ns.hackAnalyze(target);
                    const maxThreads = Math.floor(CONFIG.THRESHOLDS.HACK_PERCENT / hackPercent);
                    threads = Math.min(threads, maxThreads);
                    if (threads < 1) return { actionType: null, earnings: 0 };

                    // 计算预期收益
                    const currentMoney = ServerCache.get(ns, target, 'money');
                    earnings = hackPercent * threads * currentMoney;
                }

                const pid = ns.exec(script, host, threads, target);
                return pid ? { actionType, earnings } : { actionType: null, earnings: 0 };
            } catch (e) {
                ns.tprint(`${CONFIG.COLORS.ERROR}执行脚本错误 ${script}@${host}: ${e}${CONFIG.COLORS.RESET}`);
                return { actionType: null, earnings: 0 };
            }
        };

        // =============== 监控面板 ===============
        const updateDashboard = (cycleIndex, actions, totalEarnings, avgEfficiency) => {
            try {
                ns.clearLog();

                // 计算总资金（添加错误处理）
                let totalMoney = 0;
                let totalMaxMoney = 0;
                try {
                    totalMoney = TargetScheduler.targets.reduce((sum, t) =>
                        sum + ServerCache.get(ns, t.server, 'money'), 0);
                    totalMaxMoney = TargetScheduler.targets.reduce((sum, t) =>
                        sum + ServerCache.get(ns, t.server, 'maxMoney'), 0);
                } catch (e) {
                    ns.tprint(`${CONFIG.COLORS.ERROR}资金计算错误: ${e}${CONFIG.COLORS.RESET}`);
                }

                ns.print('╔══════════════════════════════════════════════════════╗');
                ns.print(`║ 状态: ${CONFIG.COLORS.INFO}${CONFIG.CYCLE_CHARS[cycleIndex]}${CONFIG.COLORS.RESET} ` +
                    `目标: ${TargetScheduler.targets.length.toString().padEnd(3)} ` +
                    `主机: ${TargetScheduler.hosts.length.toString().padEnd(3)}`.padEnd(35) + '║');
                ns.print('╠══════════════════════════════════════════════════════╣');

                // 添加进度条容错
                const moneyRatio = totalMaxMoney > 0 ? totalMoney / totalMaxMoney : 0;
                const progressBars = Math.min(20, Math.floor(moneyRatio * 20));
                const progressBar = '█'.repeat(progressBars) + '░'.repeat(20 - progressBars);

                ns.print(`║ 总资金: [${CONFIG.COLORS.MONEY}${progressBar}${CONFIG.COLORS.RESET}] ` +
                    `${CONFIG.COLORS.MONEY}${ns.formatPercent(moneyRatio, 1)}${CONFIG.COLORS.RESET}`.padEnd(32) + '║');

                ns.print('╟──────────────────────────────┬────────────┬──────────╢');
                ns.print('║   Target            Security │   Funds    │   Max    ║');

                // 显示前7个目标（添加错误处理）
                const displayCount = Math.min(100, TargetScheduler.targets.length);
                for (let i = 0; i < displayCount; i++) {
                    try {
                        const target = TargetScheduler.targets[i].server;
                        const money = ServerCache.get(ns, target, 'money');
                        const maxMoney = ServerCache.get(ns, target, 'maxMoney');
                        const action = actions[target]?.actionType || ' ';
                        const security = ServerCache.get(ns, target, 'security');
                        const minSecurity = ServerCache.get(ns, target, 'minSecurity');
                        const securityRatio = minSecurity / security;
                        const moneyRatio = maxMoney > 0 ? Math.min(1, money / maxMoney) : 0;

                        // 使用更精确的进度条计算
                        const fundsBars = Math.min(10, Math.floor(moneyRatio * 10));
                        const progress = '█'.repeat(fundsBars) + '░'.repeat(10 - fundsBars);

                        ns.print(`║ ${getActionColor(action)}${action}${CONFIG.COLORS.RESET} ${target.padEnd(20)}` +
                            `${CONFIG.COLORS.SECURITY}${ns.formatPercent(securityRatio, 1).padStart(6)}${CONFIG.COLORS.RESET} ` +
                            `│ ${CONFIG.COLORS.MONEY}${progress}${CONFIG.COLORS.RESET} ` +
                            `│ ${CONFIG.COLORS.MONEY}$${ns.formatNumber(maxMoney, 1).padEnd(7)}${CONFIG.COLORS.RESET} ║`);
                    } catch (e) {
                        ns.print(`${CONFIG.COLORS.ERROR}目标显示错误: ${e}${CONFIG.COLORS.RESET}`);
                    }
                }

                // 显示错误计数
                if (errorCount > 0) {
                    ns.print(`║ ${CONFIG.COLORS.ERROR}最近错误: ${lastError}${CONFIG.COLORS.RESET} ║`);
                }

                ns.print('╚══════════════════════════════════════════════════════╝');
            } catch (e) {
                ns.tprint(`${CONFIG.COLORS.ERROR}面板更新错误: ${e}${CONFIG.COLORS.RESET}`);
            }
        };

        const getActionColor = (action) => {
            switch (action) {
                case 'W': return CONFIG.COLORS.WARNING;
                case 'G': return CONFIG.COLORS.SUCCESS;
                case 'H': return CONFIG.COLORS.ERROR;
                default: return CONFIG.COLORS.INFO;
            }
        };

        // =============== 主循环 ===============
        let cycleIndex = 0;
        let totalEarnings = 0;
        let efficiencyHistory = [];
        const HISTORY_LENGTH = 10;
        const actionsMap = {};
        let errorCount = 0;
        let lastError = "";

        // 初始化资源管理器
        await ResourceManager.scanExes(ns);
        await scanNetwork();  // 初始扫描

        while (true) {
            try {
                cycleIndex = (cycleIndex % 4) + 1;
                totalEarnings = 0; // 重置每周期收益

                await scanNetwork();

                // 执行攻击（添加空目标检查）
                if (TargetScheduler.targets.length > 0) {
                    for (const host of TargetScheduler.hosts) {
                        const target = TargetScheduler.getNextTarget();
                        if (target) {
                            const result = executeAttack(host.server, target);
                            if (result.actionType) {
                                actionsMap[target] = result;
                                totalEarnings += result.earnings;
                            }
                        }
                    }
                } else {
                    ns.tprint(`${CONFIG.COLORS.WARNING}警告: 没有可用目标! 等待扫描...${CONFIG.COLORS.RESET}`);
                }

                // 记录效率历史
                efficiencyHistory.push(totalEarnings);
                if (efficiencyHistory.length > HISTORY_LENGTH) {
                    efficiencyHistory.shift();
                }

                // 计算平均效率
                const avgEfficiency = efficiencyHistory.length > 0 ?
                    efficiencyHistory.reduce((a, b) => a + b, 0) / efficiencyHistory.length : 0;

                // 更新监控面板
                updateDashboard(cycleIndex, actionsMap, totalEarnings, avgEfficiency);

                // 缓存过期处理
                ServerCache.clearExpired(ns);
                ResourceManager.clearExpired(ns);

                // 降低CPU消耗
                await ns.asleep(1000);
            } catch (e) {
                errorCount++;
                lastError = e.toString();
                ns.tprint(`${CONFIG.COLORS.ERROR}主循环错误 (#${errorCount}): ${e}${CONFIG.COLORS.RESET}`);
                await ns.asleep(5000); // 错误后等待更长时间
            }
        }
    } catch (e) {
        ns.tprint(`\x1b[31m致命错误: ${e}\x1b[0m`);
        ns.exit();
    }
}
