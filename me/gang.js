/**
 * Bitburner 帮派管理系统 v5.1
 * 优化版本 - 提升性能并增强功能
 * @param {NS} ns
 **/
export async function main(ns) {
  // ===================== 核心配置 =====================
  const CONFIG = {
    TASKS: {
      TRAIN: "Train Combat",
      VIGI: "Vigilante Justice",
      NOOB: String.fromCharCode(77) + "ug People",
      RESPECT: String.fromCharCode(84) + "errorism",
      MONEY: "Human " + String.fromCharCode(84) + "rafficking",
      WARFARE: "Territory Warfare",
      MANUAL: "Manual/NotReallyTaskName"
    },
    THRESHOLDS: {
      ASCEND_ON_MPL: 10,
      MIN_ASCEND_MULT: 1.15,
      EQUIP_AFFORD_COEFF: 100,
      STATS_THRESHOLD: 0.7,
      STATS_HARD_MIN: 200,
      TRAIN_CHANCE: 0.2,
      RESPECT_MIN: 2e6,
      WANTED_PENALTY: 0.99,
      WARFARE_RATIO: 2,
      MEMBERS: { MIN: 6, MAX: 12 },
      CACHE_DURATION: 1000 // 缓存持续时间(ms)
    },
    UI: {
      SLEEP_TIME: 1000,
      CYCLE: ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'],
      WANTED_MAX_LEVEL: 10,
      EQUIP_SLOTS: 23,
      WINDOW: { W: 660, H: 515 }
    }
  };

  // ===================== 缓存系统 =====================
  class Cache {
    static data = new Map();
    static timestamps = new Map();

    static get(key) {
      const timestamp = this.timestamps.get(key);
      if (timestamp && Date.now() - timestamp < CONFIG.THRESHOLDS.CACHE_DURATION) {
        return this.data.get(key);
      }
      return null;
    }

    static set(key, value) {
      this.data.set(key, value);
      this.timestamps.set(key, Date.now());
    }

    static clear() {
      this.data.clear();
      this.timestamps.clear();
    }
  }

  // ===================== 类定义 =====================
  class GangOperations {
    /** 自动招募成员 */
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
    static assignTasks(ns, STATE, forceReset = false) {
      try {
        const gangInfo = ns.gang.getGangInformation();
        const members = ns.gang.getMemberNames();
        const enemyPower = Math.max(...Object.values(ns.gang.getOtherGangInformation()).map(g => g.power));
        const shouldWarfare = gangInfo.power >= enemyPower * CONFIG.THRESHOLDS.WARFARE_RATIO;

        ns.gang.setTerritoryWarfare(shouldWarfare);

        // 批量更新任务
        const taskUpdates = members.map(member => {
          if (forceReset) STATE.autoTasks.set(member, null);
          const currentTask = ns.gang.getMemberInformation(member).task;

          if (STATE.autoTasks.get(member) === CONFIG.TASKS.MANUAL &&
            currentTask !== CONFIG.TASKS.NULL) return null;

          const newTask = this.#determineOptimalTask(ns, member, gangInfo, shouldWarfare);
          return { member, newTask };
        }).filter(update => update !== null);

        // 执行任务更新
        taskUpdates.forEach(({ member, newTask }) => {
          ns.gang.setMemberTask(member, newTask);
          STATE.autoTasks.set(member, newTask);
        });

        if (taskUpdates.length > 0) Cache.clear();
      } catch (e) {
        throw new Error(`任务分配失败: ${e}`);
      }
    }

    /** 最优任务决策 */
    static #determineOptimalTask(ns, member, gangInfo, shouldWarfare) {
      const memberInfo = ns.gang.getMemberInformation(member);
      const stats = memberInfo.str + memberInfo.def + memberInfo.dex + memberInfo.agi;
      const maxStats = Math.max(...ns.gang.getMemberNames().map(m => {
        const info = ns.gang.getMemberInformation(m);
        return info.str + info.def + info.dex + info.agi;
      }));

      if (stats < CONFIG.THRESHOLDS.STATS_HARD_MIN ||
        stats < maxStats * CONFIG.THRESHOLDS.STATS_THRESHOLD) {
        return CONFIG.TASKS.TRAIN;
      }

      if (gangInfo.wantedPenalty < CONFIG.THRESHOLDS.WANTED_PENALTY) {
        return CONFIG.TASKS.VIGI;
      }

      return ns.gang.getMemberNames().length < CONFIG.THRESHOLDS.MEMBERS.MIN ? CONFIG.TASKS.NOOB :
        gangInfo.respect < CONFIG.THRESHOLDS.RESPECT_MIN ? CONFIG.TASKS.RESPECT :
          shouldWarfare ? CONFIG.TASKS.WARFARE : CONFIG.TASKS.MONEY;
    }
  }

  class Dashboard {
    /** 渲染主界面 */
    static render(ns, gangInfo, members, cycle) {
      try {
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
    static #renderHeader(ns, info, cycle) {
      const cycleSymbol = CONFIG.UI.CYCLE[cycle % CONFIG.UI.CYCLE.length];
      ns.print('╔═════════════════════════════════════════════════════════════════╗');
      ns.print(`║ ${cycleSymbol} ${info.faction.padEnd(14)} ` +
        `Respect: ${ns.formatNumber(info.respect, 1).padEnd(9)} ` +
        `Power: ${ns.formatNumber(info.power, 1).padEnd(20)} ║`);
      ns.print('╠═════════╦══════════════════╦══════════╦═════════════════════════╣');
      ns.print('║ Member  ║      Task        ║  Stats   ║      Equipment          ║');
      ns.print('╠═════════╬══════════════════╬══════════╬═════════════════════════╣');
    }

    /** 成员列表 */
    static #renderMembers(ns, members) {
      members.slice(0, CONFIG.THRESHOLDS.MEMBERS.MAX).forEach(member => {
        const info = ns.gang.getMemberInformation(member);
        const stats = info.str + info.def + info.dex + info.agi;
        const task = info.task.length > 16 ? `${info.task.substr(0, 13)}...` : info.task.padEnd(16);
        const equipmentSlots = Array(CONFIG.UI.EQUIP_SLOTS)
          .fill()
          .map((_, i) => i < info.upgrades.length + info.augmentations.length ? '■' : '□')
          .join('');

        ns.print(`║ ${this.#truncate(member, 7).padEnd(7)} ║ ${task} ║ ` +
          `${ns.formatNumber(stats, 1).padStart(8)} ║ ${equipmentSlots.padEnd(23)} ║`);
      });
    }

    /** 底部状态栏 */
    static #renderFooter(ns, info, members) {
      ns.print('╠═════════╩══════════════════╩══════════╩═════════════════════════╣');
      const wantedLevel = Math.min(CONFIG.UI.WANTED_MAX_LEVEL, Math.floor(info.wantedLevel));
      const warfareStatus = info.territoryWarfareEngaged ? '■ WARFARE' : '□ PEACE ';
      const wantedBar = '◆'.repeat(wantedLevel) + '◇'.repeat(CONFIG.UI.WANTED_MAX_LEVEL - wantedLevel);

      ns.print(`║ ${warfareStatus} │ Wanted: [${wantedBar}] │ ` +
        `Members: ${members.length}/${CONFIG.THRESHOLDS.MEMBERS.MAX} │ ` +
        `Clash: ${ns.formatPercent(info.territoryClashChance, 0).padEnd(5)} ║`);
      ns.print('╠═════════════════════════════════════════════════════════════════╣');
    }

    /** 性能指标 */
    static #renderMetrics(ns) {
      const metrics = Cache.get('metrics') || {
        totalRespect: 0,
        combatEfficiency: 0,
        equipmentCoverage: 0,
        peakWantedLevel: 0,
        lastUpdate: Date.now()
      };

      ns.print(`║ Respect: ${ns.formatNumber(metrics.totalRespect, 1)} | ` +
        `Combat: ${ns.formatNumber(metrics.combatEfficiency, 1)} | ` +
        `Equipment: ${ns.formatPercent(metrics.equipmentCoverage, 1)} | ` +
        `Peak Wanted: ${metrics.peakWantedLevel.toFixed(1)} ║`);
      ns.print('╚═════════════════════════════════════════════════════════════════╝');
    }

    /** 字符串截断 */
    static #truncate(str, len) {
      return str.length > len ? str.substring(0, len - 1) + '…' : str;
    }
  }

  // ===================== 状态管理 =====================
  const STATE = {
    cycle: 0,
    autoTasks: new Map(),
    lastAscend: Date.now() - 120000,
    metrics: {
      totalRespect: 0,
      combatEfficiency: 0,
      equipmentCoverage: 0,
      peakWantedLevel: 0
    }
  };

  // ===================== 初始化流程 =====================
  const initialize = (ns) => {
    ns.disableLog('ALL');
    ns.ui.setTailTitle(`GangManager v5.1 [${ns.getScriptName()}]`);
    ns.ui.openTail();
    ns.ui.moveTail(1000, 100);

    // 初始化成员状态
    ns.gang.getMemberNames().forEach(name => {
      STATE.autoTasks.set(name, null);
    });
    STATE.metrics.peakWantedLevel = ns.gang.getGangInformation().wantedLevel;
  };

  // ===================== 错误处理 =====================
  const handleError = (ns, error) => {
    ns.print(`\x1b[38;5;196m⚠️ CRITICAL ERROR: ${error.message}\x1b[0m`);
    ns.toast(`系统故障: ${error.message}`, 'error', 5000);
  };

  // ===================== 主循环 =====================
  initialize(ns);

  while (true) {
    try {
      // 更新指标
      const gangInfo = ns.gang.getGangInformation();
      const members = ns.gang.getMemberNames();
      const A = members.slice(0, CONFIG.THRESHOLDS.MEMBERS.MAX).length;
      ns.ui.resizeTail(CONFIG.UI.WINDOW.W, (A + 8) * 25.7);

      // 更新缓存指标
      const metrics = {
        totalRespect: gangInfo.respect,
        peakWantedLevel: Math.max(STATE.metrics.peakWantedLevel, gangInfo.wantedLevel),
        combatEfficiency: members.reduce((sum, m) => {
          const info = ns.gang.getMemberInformation(m);
          return sum + info.str + info.def + info.dex + info.agi;
        }, 0) / members.length,
        equipmentCoverage: members.reduce((sum, m) => {
          const info = ns.gang.getMemberInformation(m);
          return sum + (info.upgrades.length + info.augmentations.length) / CONFIG.UI.EQUIP_SLOTS;
        }, 0) / members.length,
        lastUpdate: Date.now()
      };
      Cache.set('metrics', metrics);

      // 执行核心操作
      GangOperations.recruitMembers(ns);
      GangOperations.purchaseEquipment(ns);
      GangOperations.handleAscensions(ns, STATE);
      GangOperations.assignTasks(ns, STATE);

      // 渲染界面
      Dashboard.render(ns, gangInfo, members, STATE.cycle++);

    } catch (e) {
      handleError(ns, e);
    }
    await ns.gang.nextUpdate();
  }
}
