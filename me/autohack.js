/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog('ALL');
    ns.tail();

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
        CYCLE_CHARS: ['', '▄', '█', '▀', '█'] // 状态指示符
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
            
            switch(property) {
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
            // 计算目标权重 = 最大资金 / 最小安全等级
            const weight = ServerCache.get(ns, server, 'maxMoney') / 
                          ServerCache.get(ns, server, 'minSecurity');
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
            try { ns[exe](server); } catch {}
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
        ns.print('╔═══════════════════════════════════════╗');
        ns.print(`║ 状态: ${CONFIG.CYCLE_CHARS[cycleIndex]} 目标数: ${TargetScheduler.targets.length} 主机数: ${TargetScheduler.hosts.length} ║`);
        ns.print('╠═══════════════════════════════════════╣');
        
        // 显示前5个目标
        for (let i = 0; i < Math.min(5, TargetScheduler.targets.length); i++) {
            const target = TargetScheduler.targets[i].server;
            const money = ServerCache.get(ns, target, 'money');
            const maxMoney = ServerCache.get(ns, target, 'maxMoney');
            const ratio = money / maxMoney;
            
            ns.print(`║ ${actions[target] || ' '} ${target.padEnd(15)} ` +
                     `${ns.formatPercent(ratio, 1).padStart(6)} ${ns.formatNumber(money).padStart(12)}/${
                     ns.formatNumber(maxMoney)} ║`);
        }
        
        ns.print('╚═══════════════════════════════════════╝');
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
