/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog('ALL');
    ns.ui.openTail();
    ns.ui.resizeTail(600, 430)

    // =============== 配置中心 ===============
    const CONFIG = {
        FILES: {
            GROW: 'grow.script',
            WEAK: 'weak.script',
            HACK: 'hack.script'
        },
        THRESHOLDS: {
            MIN_RAM: 8,         // 最小可用RAM
            SECURITY_BUFFER: 5, // 安全等级缓冲
            MONEY_RATIO: 0.8,   // 最低资金比例
            HACK_PERCENT: 0.7   // 最大窃取比例
        },
        EXCLUDE_SERVERS: ['home'], // 排除的服务器
        CYCLE_CHARS: ['', '▄', '█', '▀', '█'], // 状态指示符
        COLORS: {
            SUCCESS: '\x1b[32m',  // 绿色 - 成功状态
            WARNING: '\x1b[33m',  // 黄色 - 警告状态
            ERROR: '\x1b[31m',    // 红色 - 错误状态
            INFO: '\x1b[36m',     // 青色 - 信息状态
            MONEY: '\x1b[35m',    // 紫色 - 资金相关
            SECURITY: '\x1b[34m', // 蓝色 - 安全等级
            RESET: '\x1b[0m'      // 重置颜色
        }
    };

    // 写入脚本文件
    ns.write(CONFIG.FILES.GROW, 'grow(args[0]);', 'w');
    ns.write(CONFIG.FILES.WEAK, 'weaken(args[0]);', 'w');
    ns.write(CONFIG.FILES.HACK, 'hack(args[0]);', 'w');

    // =============== 服务器状态缓存 ===============
    class ServerCache {
        static cache = new Map();
        static expiration = new Map();
        static CACHE_TTL = 5000; // 5秒缓存有效期

        static get(ns, server, property) {
            const key = `${server}|${property}`;
            if (!this.isValid(key)) {
                this.update(ns, server, property);
            }
            return this.cache.get(key);
        }

        static update(ns, server, property) {
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
            }

            this.cache.set(key, value);
            this.expiration.set(key, Date.now() + this.CACHE_TTL);
            return value;
        }

        static batchUpdate(ns, server) {
            const properties = ['maxMoney', 'money', 'maxRam', 'usedRam', 'security'];
            properties.forEach(prop => this.update(ns, server, prop));
        }

        static isValid(key) {
            return this.cache.has(key) &&
                this.expiration.has(key) &&
                this.expiration.get(key) > Date.now();
        }

        static clearExpired() {
            const now = Date.now();
            for (const [key, expire] of this.expiration) {
                if (expire <= now) {
                    this.cache.delete(key);
                    this.expiration.delete(key);
                }
            }
        }
    }

    // =============== 资源管理器 ===============
    class ResourceManager {
        static availableExes = [];
        static scriptRamCache = new Map();
        static scriptRamExpiration = new Map();
        static CACHE_TTL = 10000; // 10秒缓存有效期

        static async scanExes(ns) {
            this.availableExes = [];
            const exeList = ['brutessh', 'ftpcrack', 'relaysmtp', 'sqlinject', 'httpworm'];
            for (const exe of exeList) {
                if (ns.fileExists(`${exe}.exe`)) this.availableExes.push(exe);
            }
        }

        static getScriptRam(ns, script, host) {
            const key = `${host}|${script}`;
            if (!this.isValid(key)) {
                this.updateCache(ns, script, host);
            }
            return this.scriptRamCache.get(key);
        }

        static updateCache(ns, script, host) {
            const key = `${host}|${script}`;
            const ram = ns.getScriptRam(script, host);
            this.scriptRamCache.set(key, ram);
            this.scriptRamExpiration.set(key, Date.now() + this.CACHE_TTL);
        }

        static isValid(key) {
            return this.scriptRamCache.has(key) &&
                this.scriptRamExpiration.has(key) &&
                this.scriptRamExpiration.get(key) > Date.now();
        }

        static clearExpired() {
            const now = Date.now();
            for (const [key, expire] of this.scriptRamExpiration) {
                if (expire <= now) {
                    this.scriptRamCache.delete(key);
                    this.scriptRamExpiration.delete(key);
                }
            }
        }
    }

    // =============== 目标调度器 ===============
    class TargetScheduler {
        static targets = [];
        static hosts = [];
        static currentIndex = 0;

        static addTarget(server) {
            // 优化后的目标权重计算（综合考虑资金、安全、成长和黑客因素）
            const maxMoney = ServerCache.get(ns, server, 'maxMoney');
            const minSecurity = ServerCache.get(ns, server, 'minSecurity');
            const currentSecurity = ServerCache.get(ns, server, 'security');
            const hackLevel = ServerCache.get(ns, server, 'hackLevel');
            const ports = ServerCache.get(ns, server, 'ports');

            // 基础权重：资金/安全等级
            let weight = maxMoney / minSecurity;

            // 安全系数：当前安全等级与最小安全等级的差距
            const securityFactor = 1 - (currentSecurity - minSecurity) / 100;
            weight *= securityFactor;

            // 黑客难度系数：玩家等级与服务器需求的比值
            const hackDifficulty = ns.getHackingLevel() / hackLevel;
            weight *= Math.min(hackDifficulty, 1.5); // 最高给予1.5倍加成

            // 端口惩罚系数：每多一个需要破解的端口减少10%权重
            const portPenalty = Math.pow(0.9, ports);
            weight *= portPenalty;

            // 成长时间系数：成长时间越短越好
            const growTime = ns.getGrowTime(server);
            const growTimeFactor = 1 / Math.log1p(growTime / 1000);
            weight *= growTimeFactor;

            // 黑客时间系数：黑客时间越短越好
            const hackTime = ns.getHackTime(server);
            const hackTimeFactor = 1 / Math.log1p(hackTime / 1000);
            weight *= hackTimeFactor;
            this.targets.push({ server, weight });
            this.targets.sort((a, b) => b.weight - a.weight);
        }

        static addHost(server) {
            const ram = ServerCache.get(ns, server, 'maxRam');
            this.hosts.push({ server, ram });
            this.hosts.sort((a, b) => b.ram - a.ram);
        }

        static getNextTarget() {
            if (this.currentIndex >= this.targets.length) {
                this.currentIndex = 0;
            }
            return this.targets[this.currentIndex++].server;
        }
    }

    // =============== 核心功能 ===============
    const canHack = (server) => {
        const ports = ServerCache.get(ns, server, 'ports');
        const hackLevel = ServerCache.get(ns, server, 'hackLevel');
        return ports <= ResourceManager.availableExes.length &&
            hackLevel <= ns.getHackingLevel();
    };

    const prepareServer = (server) => {
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
    };

    const scanNetwork = async () => {
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

                    // 准备服务器并添加目标
                    if (prepareServer(neighbor)) {
                        ServerCache.batchUpdate(ns, neighbor);
                        ns.scp(Object.values(CONFIG.FILES), neighbor, 'home');

                        if (ServerCache.get(ns, neighbor, 'maxMoney') > 0 &&
                            ServerCache.get(ns, neighbor, 'minSecurity') < 100 &&
                            canHack(neighbor)) {
                            TargetScheduler.addTarget(neighbor);
                        }
                    }
                }
            }
        }
    };

    const executeAttack = async (host, target) => {
        const freeRam = ServerCache.get(ns, host, 'maxRam') -
            ServerCache.get(ns, host, 'usedRam');

        // 安全等级过高 -> 削弱
        const currentSecurity = ServerCache.get(ns, target, 'security');
        const minSecurity = ServerCache.get(ns, target, 'minSecurity');

        if (currentSecurity > minSecurity + CONFIG.THRESHOLDS.SECURITY_BUFFER) {
            const script = CONFIG.FILES.WEAK;
            const ramCost = ResourceManager.getScriptRam(ns, script, host);
            if (ramCost <= 0) {
                ns.print(`ERROR: Script ${script} not found on ${host} or RAM cost is zero.`);
                return null;
            }
            const threads = Math.floor(freeRam / ramCost);
            if (threads > 0) {
                ns.exec(script, host, threads, target);
                return 'W';
            }
            return null;
        }

        // 资金不足 -> 增长
        const currentMoney = ServerCache.get(ns, target, 'money');
        const maxMoney = ServerCache.get(ns, target, 'maxMoney');

        if (currentMoney < maxMoney * CONFIG.THRESHOLDS.MONEY_RATIO) {
            const script = CONFIG.FILES.GROW;
            const ramCost = ResourceManager.getScriptRam(ns, script, host);
            if (ramCost <= 0) {
                ns.print(`ERROR: Script ${script} not found on ${host} or RAM cost is zero.`);
                return null;
            }
            const threads = Math.floor(freeRam / ramCost);
            if (threads > 0) {
                ns.exec(script, host, threads, target);
                return 'G';
            }
            return null;
        }

        // 执行攻击
        const script = CONFIG.FILES.HACK;
        const ramCost = ResourceManager.getScriptRam(ns, script, host);
        if (ramCost <= 0) {
            ns.print(`ERROR: Script ${script} not found on ${host} or RAM cost is zero.`);
            return null;
        }
        const maxThreads = Math.floor(freeRam / ramCost);
        let threads = maxThreads;

        // 计算安全线程数
        const hackPercent = ns.hackAnalyze(target);
        while (hackPercent * threads > CONFIG.THRESHOLDS.HACK_PERCENT && threads > 1) {
            threads--;
        }

        if (threads > 0) {
            ns.exec(script, host, threads, target);
            return 'H';
        }

        return null;
    };

    // =============== 监控面板 ===============
    const updateDashboard = (cycleIndex, actions) => {
        ns.clearLog();
        const totalMoney = TargetScheduler.targets.reduce((sum, t) =>
            sum + ServerCache.get(ns, t.server, 'money'), 0);
        const totalMaxMoney = TargetScheduler.targets.reduce((sum, t) =>
            sum + ServerCache.get(ns, t.server, 'maxMoney'), 0);

        ns.print('╔══════════════════════════════════════════════════════════╗');
        ns.print(`║ 状态: ${CONFIG.COLORS.INFO}${CONFIG.CYCLE_CHARS[cycleIndex]}${CONFIG.COLORS.RESET} ` +
            `目标: ${TargetScheduler.targets.length.toString().padEnd(3)} ` +
            `主机: ${TargetScheduler.hosts.length.toString().padEnd(3)}`.padEnd(39) + '║');
        ns.print('╠══════════════════════════════════════════════════════════╣');
        const moneyRatio = totalMoney / totalMaxMoney;
        const progressBar = '█'.repeat(Math.floor(moneyRatio * 20)) + '░'.repeat(20 - Math.floor(moneyRatio * 20));
        ns.print(`║ 总资金: [${CONFIG.COLORS.MONEY}${progressBar}${CONFIG.COLORS.RESET}] ` +
            `${CONFIG.COLORS.MONEY}${ns.formatPercent(moneyRatio, 1)}${CONFIG.COLORS.RESET}`.padEnd(36) + '║');
        ns.print('╠════──────────────────────────────┬────────────┬──────────╣');
        ns.print('║ 目标名称                      状态 │ 当前资金    │ 最大资金   ║');
        ns.print('╠════──────────────────────────────┼────────────┼──────────╣');

        // 显示前8个目标
        for (let i = 0; i < Math.min(8, TargetScheduler.targets.length); i++) {
            const target = TargetScheduler.targets[i].server;
            const money = ServerCache.get(ns, target, 'money');
            const maxMoney = ServerCache.get(ns, target, 'maxMoney');
            const action = actions[target] || ' ';
            const security = ServerCache.get(ns, target, 'security');
            const minSecurity = ServerCache.get(ns, target, 'minSecurity');

            ns.print(`║ ${getActionColor(action)}${action}${CONFIG.COLORS.RESET} ${target.padEnd(20)}` +
                `${CONFIG.COLORS.SECURITY}${security.toFixed(1).padStart(4)}${CONFIG.COLORS.RESET}/${CONFIG.COLORS.SECURITY}${minSecurity.toFixed(1).padEnd(5)}${CONFIG.COLORS.RESET} ` +
                `│ ${CONFIG.COLORS.MONEY}${'█'.repeat(Math.floor(money / maxMoney * 10))}${CONFIG.COLORS.RESET}${'░'.repeat(10 - Math.floor(money / maxMoney * 10))} ` +
                `│ ${CONFIG.COLORS.MONEY}${ns.formatPercent(money / maxMoney, 1).padStart(8)}${CONFIG.COLORS.RESET} ║`);
        }

        ns.print('╚══════════════════════════════════════════════════════════╝');

    };

    // 获取动作对应颜色
    const getActionColor = (action) => {
        switch (action) {
            case 'W': return CONFIG.COLORS.WARNING;
            case 'G': return CONFIG.COLORS.SUCCESS;
            case 'H': return CONFIG.COLORS.ERROR;
            default: return CONFIG.COLORS.RESET;
        }
    };

    // =============== 主循环 ===============
    let cycleIndex = 0;
    const actions = {};

    // 初始化模块
    await ResourceManager.scanExes(ns);

    while (true) {
        cycleIndex = (cycleIndex % 4) + 1;

        // 扫描网络
        await scanNetwork();

        // 执行攻击
        for (const host of TargetScheduler.hosts) {
            const target = TargetScheduler.getNextTarget();
            actions[target] = await executeAttack(host.server, target);
        }

        // 更新监控面板
        updateDashboard(cycleIndex, actions);

        // 缓存过期处理
        ServerCache.clearExpired();
        ResourceManager.clearExpired();
        await ns.sleep(1000);
    }
}
