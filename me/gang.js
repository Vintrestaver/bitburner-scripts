/** @param {NS} ns **/
export async function main(ns) {
  ns.disableLog('ALL');
  ns.ui.setTailTitle('Gang Manager v3.2');
  ns.ui.openTail();
  ns.ui.resizeTail(660, 515);
  ns.ui.moveTail(1000, 100);

  const TASK_TRAIN = "Train Combat";
  const TASK_VIGI = "Vigilante Justice";
  const TASK_NOOB = String.fromCharCode(77) + "ug People";
  const TASK_RESPECT = String.fromCharCode(84) + "errorism";
  const TASK_MONEY = "Human " + String.fromCharCode(84) + "rafficking";
  const TASK_WARFARE = "Territory Warfare";
  const TASK_NULL = "Unassigned";
  const TASK_MANUAL = "Manual/NotReallyTaskName";
  const ASCEND_ON_MPL = 10;
  const EQUIP_AFFORD_COEFF = 100;
  const STATS_THRESHOLD = 0.7;
  const STATS_MIN = 4000;
  const STATS_HARD_MIN = 200;
  const TRAIN_CHANCE = 0.2;
  const RESPECT_MIN = 2e+6;
  const WANTED_PENALTY_THRESHOLD = 0.99;
  const WARFARE_THRESHOLD = 2;
  const MEMBERS_MIN = 6;
  const MEMBERS_MAX = 12;
  const SLEEP_TIME = 1000;  // 调整为1秒刷新
  const CYCLE = [0, "▁", '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  const gang = ns.gang;
  const autoTasks = {};

  // 日志生成函数
  function generateDashboard(info, members) {
    if (CYCLE[0] >= 8) CYCLE[0] = 0;
    CYCLE[0]++;
    ns.clearLog();

    // 顶部状态栏
    ns.print('╔══════════════════════════════════════════════════════════════════╗');
    ns.print([`║ ${CYCLE[CYCLE[0]]} ${info.faction.padEnd(16)}`,
    `Respect: $${ns.formatNumber(info.respect, 1).padEnd(7)}`,
    `Power: ${ns.formatNumber(info.power, 1).padEnd(16)} ║`].join(' │ '));
    ns.print('╠═════════╦═══════════════════╦══════════╦═════════════════════════╣');
    ns.print('║ Member  ║        Task       ║  Stats   ║        Equipment        ║');
    ns.print('╠═════════╬═══════════════════╬══════════╬═════════════════════════╣');

    // 成员列表（最多显示10个）
    members.slice(0, 12).forEach(member => {
      const m = gang.getMemberInformation(member);
      const stats = m.str + m.def + m.dex + m.agi;
      const task = (m.task.length > 16 ? m.task.substring(0, 13) + '...' : m.task).padEnd(16);
      const equipSlots = Array(23).fill('□');
      m.upgrades.concat(m.augmentations).forEach((_, i) => i < 23 && (equipSlots[i] = '■'));

      ns.print(`║ ${member.substring(0, 6).padEnd(7)} ║ ${task}  ║ ${ns.formatNumber(stats, 1).padStart(8)} ║ ${equipSlots.join('').padEnd(23)} ║`);
    });

    // 底部统计栏
    ns.print('╠═════════╩═══════════════════╩══════════╩═════════════════════════╣');
    const wantedLevel = Math.min(10, Math.floor(info.wantedLevel));
    const warfareStatus = info.territoryWarfareEngaged ? '■ WARFARE' : '□ PEACE ';
    const wantedBar = '◆'.repeat(wantedLevel) + '◇'.repeat(10 - wantedLevel);
    ns.print([
      `║ ${warfareStatus.padEnd(9)}`,
      `Wanted: [${wantedBar}]`,
      `Members: ${members.length}/${MEMBERS_MAX}`.padEnd(14),
      `Clash: ${ns.formatPercent(info.territoryClashChance, 1).padEnd(5)} ║`
    ].join(' │ '));
    ns.print('╚══════════════════════════════════════════════════════════════════╝');
  }

  // 原有功能逻辑
  function getStatsSum(member) {
    const info = gang.getMemberInformation(member);
    return info.str + info.def + info.dex + info.agi;
  }

  function maxEnemyPower() {
    const others = ns.gang.getOtherGangInformation();
    return Math.max(...Object.values(others).map(g => g.power));
  }

  function setAutoTask(member, task) {
    const info = gang.getMemberInformation(member);
    if (autoTasks[member] && info.task !== TASK_NULL && autoTasks[member] !== info.task) {
      autoTasks[member] = TASK_MANUAL;
      return;
    }
    autoTasks[member] = task;
    gang.setMemberTask(member, task);
  }

  // 主循环
  while (true) {
    // 成员管理
    let i = 0
    while (gang.canRecruitMember()) {
      gang.recruitMember(`Thug ${++i}`);
    }

    // 装备购买
    const allEquip = gang.getEquipmentNames();
    let money = ns.getServerMoneyAvailable('home');
    for (const equip of allEquip) {
      const cost = gang.getEquipmentCost(equip);
      if (money / cost < EQUIP_AFFORD_COEFF) continue;

      gang.getMemberNames().forEach(member => {
        const info = gang.getMemberInformation(member);
        if (!info.upgrades.includes(equip) && gang.purchaseEquipment(member, equip)) {
          money -= cost;
        }
      });
    }

    // 任务分配
    const info = gang.getGangInformation();
    const members = gang.getMemberNames();
    const bestStats = Math.max(...members.map(getStatsSum));
    const powerfulEnough = info.power >= maxEnemyPower() * WARFARE_THRESHOLD;

    gang.setTerritoryWarfare(powerfulEnough);
    let defaultTask = members.length < MEMBERS_MIN ? TASK_NOOB :
      info.respect < RESPECT_MIN ? TASK_RESPECT :
        powerfulEnough ? TASK_MONEY : TASK_WARFARE;

    members.forEach(member => {
      const sum = getStatsSum(member);
      if (sum < STATS_HARD_MIN || sum < bestStats * STATS_THRESHOLD) {
        setAutoTask(member, TASK_TRAIN);
      } else if (info.wantedPenalty < WANTED_PENALTY_THRESHOLD) {
        setAutoTask(member, TASK_VIGI);
      } else {
        setAutoTask(member, Math.random() < TRAIN_CHANCE ? TASK_TRAIN : defaultTask);
      }
    });

    // 显示日志
    generateDashboard(info, members);
    await ns.sleep(SLEEP_TIME);
  }
}