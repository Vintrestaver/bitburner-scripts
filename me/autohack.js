/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog('ALL');
    ns.ui.openTail();
    const [winX] = ns.ui.windowSize();
    ns.ui.moveTail(winX * 0.55, 0);
    ns.ui.resizeTail(550, 420);

    // =============== 配置中心 ===============
    const CONFIG = {
        FILES: {
            GROW: 'grow.script',
            WEAK: 'weak.script',
            HACK: 'hack.script'
        },
        THRESHOLDS: {
            MIN_RAM: 8,
            SECURITY_BUFFER: 5,
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
            SECURITY: '\x1b[34m',
            RESET: '\x1b[0m'
        }
    };

    // 只写入缺失的脚本文件
    if (!ns.fileExists(CONFIG.FILES.GROW))
        ns.write(CONFIG.FILES.GROW, 'grow(args[0]);', 'w');
    if (!ns.fileExists(CONFIG.FILES.WEAK))
        ns.write(CONFIG.FILES.WEAK, 'weaken(args[0]);', 'w');
    if (!ns.fileExists(CONFIG.FILES.HACK))
        ns.write(CONFIG.FILES.HACK, 'hack(args[0]);', 'w');

    // =============== 服务器状态缓存 ===============
    class ServerCache {
        static cache = new Map();
        static expiration = new Map();
        static CACHE_TTL = 0;

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
                case 'growTime': value = ns.getGrowTime(server); break;
                case 'hackTime': value = ns.getHackTime(server); break;
            }

            this.cache.set(key, value);
            this.expiration.set(key, Date.now() + this.CACHE_TTL);
            return value;
        }

        static batchUpdate(ns, server) {
            const properties = ['maxMoney', 'money', 'maxRam', 'usedRam', 'security', 'growTime', 'hackTime'];
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
        static CACHE_TTL = 0; // 延长缓存时间

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
            // 优化权重计算
            const maxMoney = ServerCache.get(ns, server, 'maxMoney');
            const minSecurity = ServerCache.get(ns, server, 'minSecurity');
            const currentSecurity = ServerCache.get(ns, server, 'security');
            const hackLevel = ServerCache.get(ns, server, 'hackLevel');
            const ports = ServerCache.get(ns, server, 'ports');
            const growTime = ServerCache.get(ns, server, 'growTime');
            const hackTime = ServerCache.get(ns, server, 'hackTime');

            // 基础权重
            let weight = maxMoney / minSecurity;

            // 安全系数
            const securityFactor = Math.max(0.1, 1 - (currentSecurity - minSecurity) / 100);
            weight *= securityFactor;

            // 黑客难度系数
            const hackDifficulty = Math.min(1.5, ns.getHackingLevel() / hackLevel);
            weight *= hackDifficulty;

            // 端口惩罚
            weight *= Math.pow(0.9, ports);

            // 时间效率
            weight /= Math.log1p(growTime + hackTime);

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

                    // 准备服务器
                    if (prepareServer(neighbor)) {
                        ServerCache.batchUpdate(ns, neighbor);

                        // 只复制缺失的脚本
                        const filesToCopy = Object.values(CONFIG.FILES).filter(f =>
                            !ns.fileExists(f, neighbor)
                        );
                        if (filesToCopy.length > 0) {
                            ns.scp(filesToCopy, neighbor, 'home');
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
    };

    const executeAttack = (host, target) => {
        // 实时获取RAM状态
        const maxRam = ns.getServerMaxRam(host);
        const usedRam = ns.getServerUsedRam(host);
        const freeRam = maxRam - usedRam;

        // 安全等级过高 -> 削弱
        const currentSecurity = ServerCache.get(ns, target, 'security');
        const minSecurity = ServerCache.get(ns, target, 'minSecurity');

        if (currentSecurity > minSecurity + CONFIG.THRESHOLDS.SECURITY_BUFFER) {
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
    };

    const executeScript = (script, host, freeRam, target, actionType) => {
        const ramCost = ResourceManager.getScriptRam(ns, script, host);
        if (ramCost <= 0) {
            ns.print(`ERROR: Script ${script} not found on ${host}`);
            return null;
        }

        let threads = Math.floor(freeRam / ramCost);
        if (threads < 1) return null;

        // 攻击线程限制
        if (script === CONFIG.FILES.HACK) {
            const hackPercent = ns.hackAnalyze(target);
            while (hackPercent * threads > CONFIG.THRESHOLDS.HACK_PERCENT && threads > 1) {
                threads--;
            }
            if (threads < 1) return null;
        }

        const pid = ns.exec(script, host, threads, target);
        return pid ? actionType : null;
    };

    // =============== 监控面板 ===============
    const updateDashboard = (cycleIndex, actions) => {
        ns.clearLog();
        const totalMoney = TargetScheduler.targets.reduce((sum, t) =>
            sum + ServerCache.get(ns, t.server, 'money'), 0);
        const totalMaxMoney = TargetScheduler.targets.reduce((sum, t) =>
            sum + ServerCache.get(ns, t.server, 'maxMoney'), 0);

        ns.print('╔══════════════════════════════════════════════════════╗');
        ns.print(`║ 状态: ${CONFIG.COLORS.INFO}${CONFIG.CYCLE_CHARS[cycleIndex]}${CONFIG.COLORS.RESET} ` +
            `目标: ${TargetScheduler.targets.length.toString().padEnd(3)} ` +
            `主机: ${TargetScheduler.hosts.length.toString().padEnd(3)}`.padEnd(35) + '║');
        ns.print('╠══════════════════════════════════════════════════════╣');
        const moneyRatio = totalMoney / totalMaxMoney;
        const progressBar = '█'.repeat(Math.floor(moneyRatio * 20)) + '░'.repeat(20 - Math.floor(moneyRatio * 20));
        ns.print(`║ 总资金: [${CONFIG.COLORS.MONEY}${progressBar}${CONFIG.COLORS.RESET}] ` +
            `${CONFIG.COLORS.MONEY}${ns.formatPercent(moneyRatio, 1)}${CONFIG.COLORS.RESET}`.padEnd(32) + '║');
        ns.print('╟──────────────────────────────┬────────────┬──────────╢');
        ns.print('║   Target            Security │   Funds    │   Max    ║');

        // 显示前8个目标
        for (let i = 0; i < Math.min(8, TargetScheduler.targets.length); i++) {
            const target = TargetScheduler.targets[i].server;
            const money = ServerCache.get(ns, target, 'money');
            const maxMoney = ServerCache.get(ns, target, 'maxMoney');
            const action = actions[target] || ' ';
            const security = ServerCache.get(ns, target, 'security');
            const minSecurity = ServerCache.get(ns, target, 'minSecurity');
            const securityRatio = minSecurity / security;

            ns.print(`║ ${getActionColor(action)}${action}${CONFIG.COLORS.RESET} ${target.padEnd(20)}` +
                `${CONFIG.COLORS.SECURITY}${ns.formatPercent(securityRatio, 1).padStart(6)}${CONFIG.COLORS.RESET} ` +
                `│ ${CONFIG.COLORS.MONEY}${'█'.repeat(Math.floor(money / maxMoney * 10))}${CONFIG.COLORS.RESET}${'░'.repeat(10 - Math.floor(money / maxMoney * 10))} ` +
                `│ ${CONFIG.COLORS.MONEY}$${ns.formatNumber(maxMoney, 2).padEnd(7)}${CONFIG.COLORS.RESET} ║`);
        }

        ns.print('╚══════════════════════════════════════════════════════╝');
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
    const actions = {};

    // 初始化资源管理器
    await ResourceManager.scanExes(ns);

    while (true) {
        cycleIndex = (cycleIndex % 4) + 1;

        // 扫描网络（每秒扫描性能开销大，改为每5秒扫描）
        if (cycleIndex === 1) await scanNetwork();

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

        // 降低CPU消耗
        await ns.asleep(1000);
    }
}