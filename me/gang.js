/**
 * Bitburner 帮派管理系统 v5.5
 * 优化版本 - 提升性能并增强功能
 * @param {NS} ns
 **/
export async function main(ns) {
    // ===================== 核心配置 =====================
    const CONFIG = {
        TASKS: {
            TRAIN: "Train Combat",
            VIGI: "Vigilante Justice",
            NOOB: "Mug People",
            RESPECT: "Terrorism",
            MONEY: "Human Trafficking",
            WARFARE: "Territory Warfare",
            MANUAL: "Manual/NotReallyTaskName"
        },
        THRESHOLDS: {
            ASCEND_ON_MPL: 10, // 达到10级升阶
            MIN_ASCEND_MULT: 1.15, // 最小升阶倍率
            EQUIP_AFFORD_COEFF: 100, // 装备购买预算系数
            STATS_THRESHOLD: 0.7, // 70% 统计阈值
            STATS_HARD_MIN: 200, // 200 强统计阈值
            TRAIN_CHANCE: 0.2, // 20% 训练概率
            RESPECT_MIN: 2e6, // 200万 声望阈值
            WANTED_PENALTY: 0.99, // 99% 通缉惩罚
            WARFARE_RATIO: 2, // 2:1 战争比例
            MEMBERS: { MIN: 6, MAX: 12 }, // 6-12 成员数量
            CACHE_DURATION: 1000, // 缓存持续时间(ms)
            ERROR_RETRY_DELAY: 5000, // 错误重试延迟(ms)
            MAX_RETRIES: 3 // 最大重试次数
        },
        UI: {
            SLEEP_TIME: 1000,
            CYCLE: ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'],
            WANTED_MAX_LEVEL: 10, // 通缉等级上限
            EQUIP_SLOTS: 23, // 装备栏位数量
            WINDOW: { W: 700, H: 700 } // 窗口大小
        }
    };

    // ===================== 增强版缓存系统 =====================
    class Cache {
        static data = new Map();
        static timestamps = new Map();
        static dependencies = new Map();
        static cacheDurations = {
            gangInfo: 10000,      // 10秒
            members: 30000,       // 30秒
            memberDetails: 30000, // 30秒
            equipment: 3600000,   // 1小时
            metrics: 5000,        // 5秒
            default: 1000         // 1秒
        };

        static get(key) {
            const timestamp = this.timestamps.get(key);
            const duration = this.cacheDurations[key] || this.cacheDurations.default;
            if (timestamp && Date.now() - timestamp < duration) {
                PerformanceMonitor.trackCacheHit();
                return this.data.get(key);
            }
            PerformanceMonitor.trackCacheMiss();
            return null;
        }

        static set(key, value, deps = []) {
            this.data.set(key, value);
            this.timestamps.set(key, Date.now());
            this.dependencies.set(key, deps);
        }

        static invalidate(key) {
            this.data.delete(key);
            this.timestamps.delete(key);
            this.dependencies.delete(key);
        }

        static clear() {
            this.data.clear();
            this.timestamps.clear();
            this.dependencies.clear();
        }

        static async getWithRetry(key, fetchFn, retries = CONFIG.THRESHOLDS.MAX_RETRIES) {
            let value = this.get(key);
            if (value !== null) return value;

            for (let i = 0; i < retries; i++) {
                try {
                    value = fetchFn();
                    // 对成员列表进行特殊处理
                    if (key === 'members' && value) {
                        // 确保返回的是数组
                        value = Array.isArray(value) ? value : Object.values(value);
                        if (!Array.isArray(value)) {
                            throw new Error(`成员列表格式错误: ${typeof value}`);
                        }
                    }
                    this.set(key, value);
                    return value;
                } catch (e) {
                    if (i === retries - 1) throw e;
                    await new Promise(resolve => setTimeout(resolve, CONFIG.THRESHOLDS.ERROR_RETRY_DELAY));
                }
            }
            return null;
        }
    }

    // ===================== 统计跟踪系统 =====================
    class StatsTracker {
        static history = new Map();
        static lastUpdate = Date.now();
        /** @param {NS} ns */
        static recordMemberStats(ns, member) {
            const info = ns.gang.getMemberInformation(member);
            const stats = {
                str: info.str,
                def: info.def,
                dex: info.dex,
                agi: info.agi,
                task: info.task,
                time: Date.now()
            };

            if (!this.history.has(member)) {
                this.history.set(member, []);
            }
            this.history.get(member).push(stats);

            // 保留最近100条记录
            if (this.history.get(member).length > 100) {
                this.history.get(member).shift();
            }
        }

        static getGrowthRate(member) {
            const records = this.history.get(member) || [];
            if (records.length < 2) return null;

            const first = records[0];
            const last = records[records.length - 1];
            const duration = (last.time - first.time) / 3600000; // 小时

            return {
                str: (last.str - first.str) / duration,
                def: (last.def - first.def) / duration,
                dex: (last.dex - first.dex) / duration,
                agi: (last.agi - first.agi) / duration
            };
        }
        /** @param {NS} ns */
        static analyzeEquipment(ns) {
            const equipmentList = ns.gang.getEquipmentNames();
            const members = ns.gang.getMemberNames();
            const results = [];

            for (const equip of equipmentList) {
                const cost = ns.gang.getEquipmentCost(equip);
                if (cost <= 0) continue;

                // 计算平均属性增益
                let totalGain = 0;
                let sampleCount = 0;

                for (const member of members) {
                    const before = ns.gang.getMemberInformation(member);
                    if (before.upgrades.includes(equip) || before.augmentations.includes(equip)) {
                        continue;
                    }

                    // 模拟购买装备
                    ns.gang.purchaseEquipment(member, equip);
                    const after = ns.gang.getMemberInformation(member);
                    ns.gang.purchaseEquipment(member, equip); // 撤销购买

                    const gain = (after.str - before.str) +
                        (after.def - before.def) +
                        (after.dex - before.dex) +
                        (after.agi - before.agi);

                    totalGain += gain;
                    sampleCount++;
                }

                if (sampleCount > 0) {
                    const avgGain = totalGain / sampleCount;
                    results.push({
                        name: equip,
                        cost,
                        value: avgGain / cost,
                        gain: avgGain
                    });
                }
            }

            return results.sort((a, b) => b.value - a.value);
        }
        /** @param {NS} ns */
        static getTaskEfficiency(ns) {
            const efficiency = new Map();
            const members = ns.gang.getMemberNames();

            // 分析每个成员的任务历史
            for (const member of members) {
                const records = this.history.get(member) || [];
                if (records.length < 2) continue;

                // 按任务类型分组
                const taskGroups = new Map();
                for (let i = 1; i < records.length; i++) {
                    const prev = records[i - 1];
                    const curr = records[i];
                    const task = prev.task;

                    if (!taskGroups.has(task)) {
                        taskGroups.set(task, {
                            count: 0,
                            strGain: 0,
                            defGain: 0,
                            dexGain: 0,
                            agiGain: 0,
                            duration: 0
                        });
                    }

                    const group = taskGroups.get(task);
                    group.count++;
                    group.strGain += curr.str - prev.str;
                    group.defGain += curr.def - prev.def;
                    group.dexGain += curr.dex - prev.dex;
                    group.agiGain += curr.agi - prev.agi;
                    group.duration += curr.time - prev.time;
                }

                // 计算每个任务类型的平均效率
                for (const [task, data] of taskGroups) {
                    const hours = data.duration / 3600000;
                    const avgGain = (data.strGain + data.defGain + data.dexGain + data.agiGain) / 4;

                    if (!efficiency.has(task)) {
                        efficiency.set(task, {
                            totalGain: 0,
                            totalHours: 0,
                            memberCount: 0
                        });
                    }

                    const taskEff = efficiency.get(task);
                    taskEff.totalGain += avgGain;
                    taskEff.totalHours += hours;
                    taskEff.memberCount++;
                }
            }

            // 计算总体任务效率
            const result = [];
            for (const [task, data] of efficiency) {
                result.push({
                    task,
                    efficiency: data.totalGain / data.totalHours,
                    popularity: data.memberCount / members.length
                });
            }

            return result.sort((a, b) => b.efficiency - a.efficiency);
        }
    }

    // ===================== 增强版性能监控系统 =====================
    class PerformanceMonitor {
        static metrics = {
            apiCalls: 0,
            cacheHits: 0,
            cacheMisses: 0,
            errors: 0,
            lastReset: Date.now(),
            apiCallTimestamps: [],
            warningCount: 0
        };

        static RATE_LIMITS = {
            MAX_API_CALLS_PER_SECOND: 20,
            WARNING_THRESHOLD: 5
        };

        static trackApiCall() {
            this.metrics.apiCalls++;
        }

        static trackCacheHit() {
            this.metrics.cacheHits++;
        }

        static trackCacheMiss() {
            this.metrics.cacheMisses++;
        }

        static trackError() {
            this.metrics.errors++;
        }

        static getStats() {
            const now = Date.now();
            const duration = (now - this.metrics.lastReset) / 1000;
            return {
                apiCallsPerSecond: this.metrics.apiCalls / duration,
                cacheHitRate: this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses),
                errorRate: this.metrics.errors / duration
            };
        }

        static reset() {
            this.metrics = {
                apiCalls: 0,
                cacheHits: 0,
                cacheMisses: 0,
                errors: 0,
                lastReset: Date.now()
            };
        }
    }

    // ===================== 类定义 =====================
    class GangOperations {
        /** 自动招募成员 */
        /** @param {NS} ns */
        static recruitMembers(ns) {
            try {
                const memberCount = ns.gang.getMemberNames().length;
                if (memberCount >= CONFIG.THRESHOLDS.MEMBERS.MAX) return;

                while (ns.gang.canRecruitMember()) {
                    const newMember = `Thug ${memberCount + 1}`;
                    ns.gang.recruitMember(newMember);
                    ns.print(`✅ 新成员加入: ${newMember}`);
                    Cache.clear(); // 清除缓存
                }
            } catch (e) {
                throw new Error(`招募失败: ${e}`);
            }
        }

        /** 智能装备采购 */
        /** @param {NS} ns */
        static purchaseEquipment(ns) {
            try {
                const budget = ns.getServerMoneyAvailable('home');
                const equipmentList = ns.gang.getEquipmentNames();
                const members = ns.gang.getMemberNames();

                // 批量处理装备购买
                const purchaseQueue = [];
                equipmentList.forEach(equip => {
                    const cost = ns.gang.getEquipmentCost(equip);
                    if (budget < cost) return;

                    members.forEach(member => {
                        const info = ns.gang.getMemberInformation(member);
                        if (!info.upgrades.includes(equip) && !info.augmentations.includes(equip)) {
                            purchaseQueue.push({ member, equip, cost });
                        }
                    });
                });

                // 按成本排序并执行购买
                purchaseQueue.sort((a, b) => a.cost - b.cost);
                purchaseQueue.forEach(({ member, equip }) => {
                    ns.gang.purchaseEquipment(member, equip);
                    ns.print(`🛍️ 装备更新: ${member} ← ${equip}`);
                });

                if (purchaseQueue.length > 0) Cache.clear();
            } catch (e) {
                throw new Error(`装备采购失败: ${e}`);
            }
        }

        /** 成员晋升处理 */
        /** @param {NS} ns */
        static handleAscensions(ns, STATE) {
            try {
                if (Date.now() - STATE.lastAscend < 120000) return;
                let ascended = false;

                const members = ns.gang.getMemberNames();
                const ascensionResults = members.map(member => ({
                    member,
                    result: ns.gang.getAscensionResult(member)
                })).filter(({ result }) => result);

                ascensionResults.forEach(({ member, result }) => {
                    const mult = Math.pow(result.str * result.def * result.dex * result.agi, 0.25);
                    if (mult > CONFIG.THRESHOLDS.ASCEND_ON_MPL &&
                        mult >= CONFIG.THRESHOLDS.MIN_ASCEND_MULT) {
                        ns.gang.ascendMember(member);
                        ns.toast(`🚀 晋升成功: ${member} (${mult.toFixed(2)}x)`, 'success');
                        ascended = true;
                    }
                });

                if (ascended) {
                    STATE.lastAscend = Date.now();
                    Cache.clear();
                    this.assignTasks(ns, STATE, true);
                }
            } catch (e) {
                throw new Error(`晋升处理失败: ${e}`);
            }
        }

        /** 动态任务分配 */
        /** @param {NS} ns */
        static assignTasks(ns, STATE, forceReset = false) {
            try {
                const gangInfo = Cache.getWithRetry('gangInfo', () => {
                    PerformanceMonitor.trackApiCall();
                    return ns.gang.getGangInformation();
                });

                let members = Cache.getWithRetry('members', () => {
                    PerformanceMonitor.trackApiCall();
                    const result = ns.gang.getMemberNames();
                    // 确保返回的是数组
                    return Array.isArray(result) ? result : Object.values(result);
                });

                // 确保 members 是数组
                if (!members) {
                    throw new Error('获取成员列表失败：返回值为空');
                }

                if (!Array.isArray(members)) {
                    members = Object.values(members);
                    if (!Array.isArray(members)) {
                        throw new Error(`获取成员列表失败：无法转换为数组 (${typeof members})`);
                    }
                }

                const enemyPower = Cache.getWithRetry('enemyPower', () => {
                    PerformanceMonitor.trackApiCall();
                    return Math.max(...Object.values(ns.gang.getOtherGangInformation()).map(g => g.power));
                });

                const shouldWarfare = gangInfo.power >= enemyPower * CONFIG.THRESHOLDS.WARFARE_RATIO;
                ns.gang.setTerritoryWarfare(shouldWarfare);

                // 批量更新任务
                const taskUpdates = members.map(member => {
                    if (forceReset) STATE.autoTasks.set(member, null);
                    const currentTask = Cache.getWithRetry(`task_${member}`, () => {
                        PerformanceMonitor.trackApiCall();
                        return ns.gang.getMemberInformation(member).task;
                    });

                    if (STATE.autoTasks.get(member) === CONFIG.TASKS.MANUAL &&
                        currentTask !== CONFIG.TASKS.NULL) return null;

                    const newTask = this.#determineOptimalTask(ns, member, gangInfo, shouldWarfare);
                    return { member, newTask };
                }).filter(update => update !== null);

                // 执行任务更新
                taskUpdates.forEach(({ member, newTask }) => {
                    ns.gang.setMemberTask(member, newTask);
                    STATE.autoTasks.set(member, newTask);
                    Cache.invalidate(`task_${member}`);
                });

                if (taskUpdates.length > 0) Cache.clear();
            } catch (e) {
                PerformanceMonitor.trackError();
                throw new Error(`任务分配失败: ${e}`);
            }
        }

        /** 最优任务决策 */
        /** @param {NS} ns */
        static #determineOptimalTask(ns, member, gangInfo, shouldWarfare) {
            const memberInfo = ns.gang.getMemberInformation(member);
            
            // 使用加权统计计算（战斗属性权重更高）
            const stats = (memberInfo.str * 1.2) + (memberInfo.def * 1.1) + 
                        memberInfo.dex + memberInfo.agi;
            
            // 动态计算统计阈值（基于帮派发展阶段）
            const isEarlyGame = gangInfo.respect < 1e6;
            const hardMin = isEarlyGame ? CONFIG.THRESHOLDS.STATS_HARD_MIN : 
                Math.max(CONFIG.THRESHOLDS.STATS_HARD_MIN, gangInfo.respect / 1e5);
            
            // 获取成员成长率数据
            const growthRate = StatsTracker.getGrowthRate(member) || { str: 0, def: 0, dex: 0, agi: 0 };
            const avgGrowth = (growthRate.str + growthRate.def + growthRate.dex + growthRate.agi) / 4;

            // 训练条件优化（考虑成长率和晋升潜力）
            const shouldTrain = stats < hardMin || 
                (avgGrowth < 0.5 && stats < CONFIG.THRESHOLDS.STATS_HARD_MIN * 2) ||
                (ns.gang.getAscensionResult(member)?.mult ?? 1) > 1.2;

            if (shouldTrain) {
                return Math.random() < CONFIG.THRESHOLDS.TRAIN_CHANCE ? 
                    CONFIG.TASKS.TRAIN : this.#getAlternativeTrainingTask(ns, memberInfo);
            }

            // 动态调整治安需求（基于帮派规模）
            const wantedThreshold = CONFIG.THRESHOLDS.WANTED_PENALTY * 
                (1 - 0.05 * Math.min(10, ns.gang.getMemberNames().length));
            
            if (gangInfo.wantedPenalty < wantedThreshold) {
                return this.#getOptimalCrimeTask(ns, memberInfo);
            }

            // 战争阶段优化（考虑装备水平）
            const hasCombatGear = memberInfo.upgrades.some(e => e.includes('Weapon') || e.includes('Armor'));
            const warfareReady = hasCombatGear && memberInfo.str > 500;
            
            // 最终任务决策树
            return ns.gang.getMemberNames().length < CONFIG.THRESHOLDS.MEMBERS.MIN ? CONFIG.TASKS.NOOB :
                gangInfo.respect < CONFIG.THRESHOLDS.RESPECT_MIN ? this.#getRespectTask(ns, memberInfo) :
                    (shouldWarfare && warfareReady) ? CONFIG.TASKS.WARFARE : 
                    this.#getMoneyTask(ns, memberInfo);
        }

        // 新增辅助方法
        static #getAlternativeTrainingTask(ns, memberInfo) {
            const stats = [memberInfo.str, memberInfo.def, memberInfo.dex, memberInfo.agi];
            const minStatIndex = stats.indexOf(Math.min(...stats));
            return ['Train Combat', 'Train Strength', 'Train Defense', 'Train Dexterity', 'Train Agility'][minStatIndex];
        }

        static #getOptimalCrimeTask(ns, memberInfo) {
            const crimes = ['Vigilante Justice', 'Traffick Illegal Arms', 'Money Laundering'];
            const successRates = crimes.map(c => ns.gang.getTaskStats(c).difficulty);
            return crimes[successRates.indexOf(Math.min(...successRates))];
        }

        static #getRespectTask(ns, memberInfo) {
            return memberInfo.str > 1000 ? 'Terrorism' : 'Armed Robbery';
        }

        static #getMoneyTask(ns, memberInfo) {
            const moneyTasks = ['Human Trafficking', 'Deal Drugs', 'Grand Theft Auto'];
            return moneyTasks.reduce((a, b) => 
                ns.gang.getTaskStats(a).money > ns.gang.getTaskStats(b).money ? a : b
            );
        }
    }

    class Dashboard {
        /** 渲染主界面 */
        /** @param {NS} ns */
        static render(ns, gangInfo, members, cycle) {
            try {
                if (!gangInfo || !members) {
                    ns.print('警告: 帮派数据不完整，跳过渲染');
                    return;
                }

                ns.clearLog();
                this.#renderHeader(ns, gangInfo, cycle);
                this.#renderMembers(ns, members);
                this.#renderFooter(ns, gangInfo, members);
                this.#renderMetrics(ns);
            } catch (e) {
                throw new Error(`界面渲染失败: ${e}`);
            }
        }

        /** 头部信息 */
        /** @param {NS} ns */
        static #renderHeader(ns, info, cycle) {
            if (!info || !info.faction) {
                ns.print('╔═════════════════════════════════════════════════════════════════╗');
                ns.print('║ ! 无法获取帮派信息                                              ║');
                ns.print('╠═════════╦══════════════════╦══════════╦═════════════════════════╣');
                ns.print('║ Member  ║      Task        ║  Stats   ║      Equipment          ║');
                ns.print('╠═════════╬══════════════════╬══════════╬═════════════════════════╣');
                return;
            }

            const cycleSymbol = CONFIG.UI.CYCLE[cycle % CONFIG.UI.CYCLE.length];
            const factionName = info.faction ? info.faction.toString() : '未知帮派';
            const respectValue = info.respect ? ns.formatNumber(info.respect, 1) : '0';
            const powerValue = info.power ? ns.formatNumber(info.power, 1) : '0';
            const territory = info.territory ? ns.formatPercent(info.territory, 1) : '0%';

            // 添加帮派发展阶段指示器
            const gameStage = info.respect < 1e6 ? '初期' : 
                           info.respect < 1e7 ? '中期' : '后期';

            ns.print('╔═════════════════════════════════════════════════════════════════╗');
            ns.print(`║ ${cycleSymbol} ${factionName.padEnd(12)} [${gameStage}] ` +
                `Respect: ${respectValue.padEnd(8)} ` +
                `Power: ${powerValue.padEnd(8)} ` +
                `领土: ${territory.padEnd(6)} ║`);
            ns.print('╠═════════╦══════════════════╦══════════╦═════════════════════════╣');
            ns.print('║ Member  ║      Task        ║  Stats   ║      Equipment          ║');
            ns.print('╠═════════╬══════════════════╬══════════╬═════════════════════════╣');
        }

        /** 成员列表 */
        /** @param {NS} ns */
        static #renderMembers(ns, members) {
            if (!Array.isArray(members) || members.length === 0) {
                ns.print('║ 无成员数据                                                     ║');
                return;
            }

            members.slice(0, CONFIG.THRESHOLDS.MEMBERS.MAX).forEach(member => {
                try {
                    if (!member) {
                        ns.print('║ 无效成员数据                                                   ║');
                        return;
                    }

                    const info = ns.gang.getMemberInformation(member);
                    if (!info) {
                        ns.print(`║ ${this.#truncate(member, 7).padEnd(7)} ║ 无法获取数据               ║ -------- ║ ----------------------- ║`);
                        return;
                    }

                    const stats = info.str + info.def + info.dex + info.agi;
                    const taskName = info.task ? info.task.toString() : '无任务';
                    const task = taskName.length > 16 ? `${taskName.substr(0, 13)}...` : taskName.padEnd(16);
                    const statsFormatted = ns.formatNumber(stats, 1);

                    // 检查 info.upgrades 和 info.augmentations 是否存在
                    const upgradesCount = info.upgrades && Array.isArray(info.upgrades) ? info.upgrades.length : 0;
                    const augmentationsCount = info.augmentations && Array.isArray(info.augmentations) ? info.augmentations.length : 0;

                    const equipmentSlots = Array(CONFIG.UI.EQUIP_SLOTS)
                        .fill()
                        .map((_, i) => i < upgradesCount + augmentationsCount ? '■' : '□')
                        .join('');

                    ns.print(`║ ${this.#truncate(member, 7).padEnd(7)} ║ ${task} ║ ` +
                        `${statsFormatted.padStart(8)} ║ ${equipmentSlots.padEnd(23)} ║`);
                } catch (e) {
                    ns.print(`║ Error: ${e.message.substring(0, 60).padEnd(60)} ║`);
                }
            });
        }

        /** 底部状态栏 */
        /** @param {NS} ns */
        static #renderFooter(ns, info, members) {
            ns.print('╠═════════╩══════════════════╩══════════╩═════════════════════════╣');

            if (!info) {
                ns.print('║ 无法获取帮派信息                                                ║');
                ns.print('╠═════════════════════════════════════════════════════════════════╣');
                return;
            }

            const wantedLevel = Math.min(CONFIG.UI.WANTED_MAX_LEVEL, Math.floor(info.wantedLevel || 0));
            const warfareStatus = info.territoryWarfareEngaged ? '■ WARFARE' : '□ PEACE  ';
            const wantedBar = '◆'.repeat(wantedLevel) + '◇'.repeat(CONFIG.UI.WANTED_MAX_LEVEL - wantedLevel);
            const memberCount = Array.isArray(members) ? members.length : 0;

            ns.print(`║ ${warfareStatus} │ Wanted: [${wantedBar}] │ ` +
                `Members: ${memberCount}/${CONFIG.THRESHOLDS.MEMBERS.MAX} │ ` +
                `Clash: ${ns.formatPercent(info.territoryClashChance || 0, 0).padEnd(4)} ║`);
            ns.print('╠═════════════════════════════════════════════════════════════════╣');
        }

        /** 性能指标 */
        /** @param {NS} ns */
        static #renderMetrics(ns) {
            const metrics = Cache.get('metrics') || {
                totalRespect: 0,
                combatEfficiency: 0,
                equipmentCoverage: 0,
                peakWantedLevel: 0,
                lastUpdate: Date.now()
            };

            const totalRespect = metrics.totalRespect ? ns.formatNumber(metrics.totalRespect, 1) : '0';
            const combatEfficiency = metrics.combatEfficiency ? ns.formatNumber(metrics.combatEfficiency, 1) : '0';
            const equipmentCoverage = metrics.equipmentCoverage ? ns.formatPercent(metrics.equipmentCoverage, 1) : '0%';
            const peakWantedLevel = metrics.peakWantedLevel ? metrics.peakWantedLevel.toFixed(1) : '0.0';

            ns.print(`║ Res:${totalRespect.padEnd(7)} | ` +
                `Com:${combatEfficiency.padEnd(7)} | ` +
                `Equ:${equipmentCoverage.padEnd(6)} | ` +
                `Wan:${ns.formatNumber(peakWantedLevel, 1).padEnd(6)}             ║`);

            // 显示装备分析
            this.#renderEquipmentAnalysis(ns);

            // 显示任务效率分析
            this.#renderTaskEfficiency(ns);

            ns.print('╚═════════════════════════════════════════════════════════════════╝');
        }

        /** 装备分析 */
        /** @param {NS} ns */
        static #renderEquipmentAnalysis(ns) {
            try {
                const equipment = StatsTracker.analyzeEquipment(ns);
                if (!equipment || equipment.length === 0) return;

                // 只显示前3个性价比最高的装备
                const topEquip = equipment.slice(0, 3);

                ns.print('╠═════════════════════════════════════════════════════════════════╣');
                ns.print('║ 装备性价比分析:                                                  ║');

                topEquip.forEach(item => {
                    const val = ns.formatNumber(item.value, 3).padStart(6);
                    const cost = ns.formatNumber(item.cost, 1).padStart(8);
                    ns.print(`║ ${item.name.padEnd(22)} 性价比: ${val} | 成本: ${cost}$ ║`);
                });
            } catch (e) {
                ns.print(`║ 装备分析失败: ${e.message.substring(0, 50)} ║`);
            }
        }

        /** 任务效率分析 */
        /** @param {NS} ns */
        static #renderTaskEfficiency(ns) {
            try {
                const efficiency = StatsTracker.getTaskEfficiency(ns);
                if (!efficiency || efficiency.length === 0) return;

                // 只显示前3个最高效的任务
                const topTasks = efficiency.slice(0, 3);

                ns.print('╠═════════════════════════════════════════════════════════════════╣');
                ns.print('║ 任务效率分析:                                                     ║');

                topTasks.forEach(task => {
                    const eff = ns.formatNumber(task.efficiency, 2).padStart(7);
                    const pop = ns.formatPercent(task.popularity, 0).padStart(4);
                    ns.print(`║ ${task.task.padEnd(22)} 效率: ${eff}/h | 使用率: ${pop}             ║`);
                });
            } catch (e) {
                ns.print(`║ 任务效率分析失败: ${e.message.substring(0, 50)} ║`);
            }
        }

        /** 字符串截断 */
        static #truncate(str, len) {
            if (!str) return ''.padEnd(len);
            return str.length > len ? str.substring(0, len - 1) + '…' : str;
        }
    }

    // ===================== 状态管理 =====================
    const STATE = {
        cycle: 0,
        autoTasks: new Map(),
        lastAscend: Date.now() - 120000,
        lastEquipmentAnalysis: Date.now() - 3600000, // 上次装备分析时间
        metrics: {
            totalRespect: 0,
            combatEfficiency: 0,
            equipmentCoverage: 0,
            peakWantedLevel: 0
        }
    };

    // ===================== 初始化流程 =====================
    /** @param {NS} ns */
    const initialize = (ns) => {
        ns.atExit(() => ns.ui.closeTail());
        ns.disableLog('ALL');
        ns.ui.setTailTitle(`GangManager v5.5 [${ns.getScriptName()}]`);
        ns.ui.openTail();
        ns.ui.moveTail(1000, 100);

        // 检查帮派系统是否初始化
        if (!ns.gang.inGang()) {
            ns.print('错误: 尚未加入帮派，请先加入一个帮派');
            ns.toast('错误: 尚未加入帮派', 'error');
            exit();
        }

        // 初始化成员状态
        const members = ns.gang.getMemberNames();
        if (!Array.isArray(members) || members.length === 0) {
            ns.print('警告: 未获取到帮派成员，可能是帮派刚刚创建');
        }

        members.forEach(name => {
            STATE.autoTasks.set(name, null);
        });

        // 获取初始帮派信息
        try {
            const gangInfo = ns.gang.getGangInformation();
            STATE.metrics.peakWantedLevel = gangInfo.wantedLevel;
            ns.print(`✅ 成功初始化帮派: ${gangInfo.faction}`);
        } catch (e) {
            ns.print(`⚠️ 帮派信息获取失败: ${e.message}`);
        }
    };

    // ===================== 错误处理 =====================
    const handleError = (ns, error) => {
        ns.print(`\x1b[38;5;196m⚠️ CRITICAL ERROR: ${error.message}\x1b[0m`);
        ns.toast(`系统故障: ${error.message}`, 'error', 5000);
    };

    // ===================== 主循环 =====================
    initialize(ns);

    // 等待一点时间让帮派系统完全初始化
    await ns.sleep(1000);

    while (true) {
        ns.ui.resizeTail(CONFIG.UI.WINDOW.W, CONFIG.UI.WINDOW.H)
        try {
            // 确保在帮派中
            if (!ns.gang.inGang()) {
                throw new Error('未加入帮派');
            }

            // 直接通过API获取数据，不使用缓存
            let gangInfo, members;

            try {
                gangInfo = ns.gang.getGangInformation();
                PerformanceMonitor.trackApiCall();
                // 添加成功获取信息的日志
                ns.print(`DEBUG: 成功获取帮派信息: ${gangInfo.faction}`);
                Cache.set('gangInfo', gangInfo);
            } catch (e) {
                ns.print(`⚠️ 获取帮派信息失败: ${e.message}`);
                gangInfo = Cache.get('gangInfo');
            }

            try {
                const rawMembers = ns.gang.getMemberNames();
                PerformanceMonitor.trackApiCall();
                // 确保返回的是数组
                members = Array.isArray(rawMembers) ? rawMembers :
                    (rawMembers ? Object.values(rawMembers) : []);

                if (members.length > 0) {
                    ns.print(`DEBUG: 成功获取成员列表: ${members.length}人`);
                } else {
                    ns.print(`⚠️ 成员列表为空`);
                }
                Cache.set('members', members);
            } catch (e) {
                ns.print(`⚠️ 获取成员列表失败: ${e.message}`);
                members = Cache.get('members') || [];
            }

            // 确保得到数组
            members = Array.isArray(members) ? members : [];

            // 记录成员统计数据
            members.forEach(member => {
                try {
                    StatsTracker.recordMemberStats(ns, member);
                } catch (e) {
                    ns.print(`⚠️ 记录成员统计失败: ${member} - ${e.message}`);
                }
            });

            // 更新缓存指标
            let metrics;
            try {
                metrics = {
                    totalRespect: gangInfo ? gangInfo.respect : 0,
                    peakWantedLevel: gangInfo ? Math.max(STATE.metrics.peakWantedLevel, gangInfo.wantedLevel) : 0,
                    combatEfficiency: members.length > 0 ? members.reduce((sum, m) => {
                        try {
                            const info = ns.gang.getMemberInformation(m);
                            return sum + info.str + info.def + info.dex + info.agi;
                        } catch (e) {
                            return sum;
                        }
                    }, 0) / members.length : 0,
                    equipmentCoverage: members.length > 0 ? members.reduce((sum, m) => {
                        try {
                            const info = ns.gang.getMemberInformation(m);
                            return sum + (info.upgrades.length + info.augmentations.length) / CONFIG.UI.EQUIP_SLOTS;
                        } catch (e) {
                            return sum;
                        }
                    }, 0) / members.length : 0,
                    performance: PerformanceMonitor.getStats(),
                    lastUpdate: Date.now()
                };
                Cache.set('metrics', metrics);
            } catch (e) {
                ns.print(`⚠️ 更新指标失败: ${e.message}`);
                metrics = Cache.get('metrics') || {
                    totalRespect: 0,
                    peakWantedLevel: 0,
                    combatEfficiency: 0,
                    equipmentCoverage: 0,
                    performance: { apiCallsPerSecond: 0, cacheHitRate: 0, errorRate: 0 },
                    lastUpdate: Date.now()
                };
            }

            // 执行核心操作
            if (gangInfo && members.length > 0) {
                try {
                    GangOperations.recruitMembers(ns);
                    GangOperations.purchaseEquipment(ns);
                    GangOperations.handleAscensions(ns, STATE);
                    GangOperations.assignTasks(ns, STATE);
                } catch (e) {
                    ns.print(`⚠️ 帮派操作失败: ${e.message}`);
                }
            } else {
                ns.print('⚠️ 跳过帮派操作：数据不完整');
            }

            // 渲染界面
            Dashboard.render(ns, gangInfo, members, STATE.cycle++);

            // 每小时重置性能指标
            if (Date.now() - PerformanceMonitor.metrics.lastReset > 3600000) {
                PerformanceMonitor.reset();
            }

        } catch (e) {
            handleError(ns, e);
            PerformanceMonitor.trackError();
            // 发生错误时等待一段时间再继续
            await ns.sleep(CONFIG.THRESHOLDS.ERROR_RETRY_DELAY);
        }
        await ns.gang.nextUpdate();
    }
}
