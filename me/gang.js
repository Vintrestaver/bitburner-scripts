/** @param {NS} ns **/
export async function main(ns) {
  ns.disableLog('ALL');
  ns.ui.setTailTitle('Gang Manager v3.4');
  ns.ui.openTail();
  ns.ui.resizeTail(660, 515);
  ns.ui.moveTail(1000, 100);

  // 常量配置中心
  const CONSTANTS = {
    TASKS: {
      TRAIN: "Train Combat",
      VIGI: "Vigilante Justice",
      NOOB: String.fromCharCode(77) + "ug People",
      RESPECT: String.fromCharCode(84) + "errorism",
      MONEY: "Human " + String.fromCharCode(84) + "rafficking",
      WARFARE: "Territory Warfare",
      NULL: "Unassigned",
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
      WARFARE: 2,
      MEMBERS: { MIN: 6, MAX: 12 }
    },
    UI: {
      SLEEP_TIME: 1000,
      CYCLE: ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'],
      WANTED_MAX_LEVEL: 10,
      EQUIP_SLOTS: 23
    }
  };

  const gang = ns.gang;
  const state = {
    cycleIndex: 0,
    autoTasks: {},
    lastAscend: Date.now() - 120000
  };

  // 界面渲染模块
  class DashboardRenderer {
    static generate(ns, info, members, cycleIndex) {
      ns.clearLog();
      this.#renderHeader(ns, info, cycleIndex);
      this.#renderMemberTable(ns, members);
      this.#renderFooter(ns, info, members);
    }

    static #renderHeader(ns, info, cycleIndex) {
      const cycleSymbol = CONSTANTS.UI.CYCLE[cycleIndex % CONSTANTS.UI.CYCLE.length];
      ns.print('╔══════════════════════════════════════════════════════════════════╗');
      ns.print([
        `║ ${cycleSymbol} ${info.faction.padEnd(16)}`,
        `Respect: $${ns.formatNumber(info.respect, 1).padEnd(7)}`,
        `Power: ${ns.formatNumber(info.power, 1).padEnd(16)} ║`
      ].join(' │ '));
      ns.print('╠═════════╦═══════════════════╦══════════╦═════════════════════════╣');
      ns.print('║ Member  ║        Task       ║  Stats   ║        Equipment        ║');
      ns.print('╠═════════╬═══════════════════╬══════════╬═════════════════════════╣');
    }

    static #renderMemberTable(ns, members) {
      members.slice(0, CONSTANTS.THRESHOLDS.MEMBERS.MAX).forEach(member => {
        const info = gang.getMemberInformation(member);
        const statsSum = info.str + info.def + info.dex + info.agi;
        const task = this.#formatTaskName(info.task);
        const equipment = this.#generateEquipmentSlots(info);

        ns.print(`║ ${member.substring(0, 7).padEnd(7)} ║ ${task}  ║ ` +
          `${ns.formatNumber(statsSum, 1).padStart(8)} ║ ${equipment.padEnd(23)} ║`);
      });
    }

    static #renderFooter(ns, info, members) {
      ns.print('╠═════════╩═══════════════════╩══════════╩═════════════════════════╣');
      const wantedLevel = Math.min(CONSTANTS.UI.WANTED_MAX_LEVEL, Math.floor(info.wantedLevel));
      const warfareStatus = info.territoryWarfareEngaged ? '■ WARFARE' : '□ PEACE ';
      const wantedBar = '◆'.repeat(wantedLevel) + '◇'.repeat(CONSTANTS.UI.WANTED_MAX_LEVEL - wantedLevel);

      ns.print([
        `║ ${warfareStatus.padEnd(9)}`,
        `Wanted: [${wantedBar}]`,
        `Members: ${members.length}/${CONSTANTS.THRESHOLDS.MEMBERS.MAX}`.padEnd(14),
        `Clash: ${ns.formatPercent(info.territoryClashChance, 1).padEnd(5)} ║`
      ].join(' │ '));
      ns.print('╚══════════════════════════════════════════════════════════════════╝');
    }

    static #formatTaskName(task) {
      return task.length > 16 ? `${task.substring(0, 13)}...` : task.padEnd(16);
    }

    static #generateEquipmentSlots(memberInfo) {
      const slots = Array(CONSTANTS.UI.EQUIP_SLOTS).fill('□');
      memberInfo.upgrades.concat(memberInfo.augmentations)
        .forEach((_, i) => i < CONSTANTS.UI.EQUIP_SLOTS && (slots[i] = '■'));
      return slots.join('');
    }
  }

  // 业务逻辑模块
  class GangManager {
    static recruitMembers() {
      let recruitCount = 0;
      while (gang.canRecruitMember()) {
        gang.recruitMember(`Thug ${++recruitCount + gang.getMemberNames().length}`);
      }
    }

    static purchaseEquipment() {
      const allEquip = gang.getEquipmentNames();
      const money = ns.getServerMoneyAvailable('home');

      allEquip.forEach(equip => {
        const cost = gang.getEquipmentCost(equip);
        if (money / cost < CONSTANTS.THRESHOLDS.EQUIP_AFFORD_COEFF) return;

        gang.getMemberNames().forEach(member => {
          const info = gang.getMemberInformation(member);
          if (!info.upgrades.includes(equip)) {
            gang.purchaseEquipment(member, equip);
          }
        });
      });
    }

    static handleAscensions() {
      if (Date.now() - state.lastAscend < 120000) return;

      const members = gang.getMemberNames();
      let hasAscended = false;

      members.forEach(member => {
        const result = gang.getAscensionResult(member);
        if (!result) return;

        const mult = Math.pow(
          result.str * result.def * result.dex * result.agi,
          0.25
        );

        if (mult > CONSTANTS.THRESHOLDS.ASCEND_ON_MPL &&
          mult >= CONSTANTS.THRESHOLDS.MIN_ASCEND_MULT) {
          if (gang.ascendMember(member)) {
            ns.toast(`Ascended ${member} (${mult.toFixed(2)}x)`, 'success');
            hasAscended = true;
          }
        }
      });

      if (hasAscended) {
        state.lastAscend = Date.now();
        this.assignTasks(true);
      }
    }

    static assignTasks(forceReset = false) {
      const info = gang.getGangInformation();
      const members = gang.getMemberNames();
      const statsSum = members.map(m => this.#getStatsSum(m));
      const bestStats = Math.max(...statsSum);
      const enemyPower = Math.max(...Object.values(gang.getOtherGangInformation()).map(g => g.power));
      const shouldWarfare = info.power >= enemyPower * CONSTANTS.THRESHOLDS.WARFARE;

      gang.setTerritoryWarfare(shouldWarfare);

      members.forEach(member => {
        if (forceReset) state.autoTasks[member] = null;
        const currentStats = this.#getStatsSum(member);
        const shouldTrain = currentStats < CONSTANTS.THRESHOLDS.STATS_HARD_MIN ||
          currentStats < bestStats * CONSTANTS.THRESHOLDS.STATS_THRESHOLD;
        const shouldVigilante = info.wantedPenalty < CONSTANTS.THRESHOLDS.WANTED_PENALTY;

        this.#setMemberTask(member,
          shouldTrain ? CONSTANTS.TASKS.TRAIN :
            shouldVigilante ? CONSTANTS.TASKS.VIGI :
              this.#getDefaultTask(info, members.length, shouldWarfare)
        );
      });
    }

    static #getStatsSum(member) {
      const info = gang.getMemberInformation(member);
      return info.str + info.def + info.dex + info.agi;
    }

    static #getDefaultTask(info, memberCount, shouldWarfare) {
      if (memberCount < CONSTANTS.THRESHOLDS.MEMBERS.MIN) return CONSTANTS.TASKS.NOOB;
      if (info.respect < CONSTANTS.THRESHOLDS.RESPECT_MIN) return CONSTANTS.TASKS.RESPECT;
      return shouldWarfare ? CONSTANTS.TASKS.WARFARE : CONSTANTS.TASKS.MONEY;
    }

    static #setMemberTask(member, task) {
      const currentTask = gang.getMemberInformation(member).task;
      if (state.autoTasks[member] && currentTask !== CONSTANTS.TASKS.NULL &&
        state.autoTasks[member] !== currentTask) {
        state.autoTasks[member] = CONSTANTS.TASKS.MANUAL;
        return;
      }
      state.autoTasks[member] = task;
      gang.setMemberTask(member, task);
    }
  }

  // 主循环
  while (true) {
    GangManager.recruitMembers();
    GangManager.purchaseEquipment();
    GangManager.handleAscensions();
    GangManager.assignTasks();

    DashboardRenderer.generate(
      ns,
      gang.getGangInformation(),
      gang.getMemberNames(),
      state.cycleIndex++
    );

    await ns.sleep(CONSTANTS.UI.SLEEP_TIME);
  }
}