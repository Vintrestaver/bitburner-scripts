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

const SLEEP_TIME = 10000;

const autoTasks = {};

/** @param {NS} ns **/
export async function main(ns) {
  const gang = ns.gang;

  function getStatsSum(member) {
    const info = gang.getMemberInformation(member);
    return info.str + info.def + info.dex + info.agi;
  }

  function maxEnemyPower(myGang) {
    const others = ns.gang.getOtherGangInformation();
    let maxPower = 0;
    for (const name of Object.keys(others)) {
      if (name === myGang.faction) continue;
      maxPower = Math.max(maxPower, others[name].power);
    }
    return maxPower;
  }

  function setAutoTask(member, task) {
    const info = gang.getMemberInformation(member);
    const lastTask = info.task;
    if (lastTask !== TASK_NULL && autoTasks.hasOwnProperty(member) && autoTasks[member] !== lastTask) {
      autoTasks[member] = TASK_MANUAL;
      return;
    }
    autoTasks[member] = task;
    if (lastTask !== task) {
      gang.setMemberTask(member, task);
    }
  }

  let defaultTask = null;
  if (ns.args[0] && gang.getTaskNames().includes(ns.args[0])) {
    defaultTask = ns.args[0];
  }

  while (true) {
    while (gang.canRecruitMember()) {
      gang.recruitMember('member' + Math.random().toString().slice(2, 5));
    }

    let bestStats = STATS_MIN / STATS_THRESHOLD;
    const members = gang.getMemberNames();
    const info = gang.getGangInformation();

    for (const member of members) {
      const r = gang.getAscensionResult(member);
      if (!r) continue;
      const mpl = r.agi * r.def * r.dex * r.str;
      if (mpl > ASCEND_ON_MPL) {
        gang.ascendMember(member);
        ns.tprint(`Member ${member} ascended!`);
      }
    }

    const allEquip = gang.getEquipmentNames();
    let money = ns.getServerMoneyAvailable('home');
    for (const equip of allEquip) {
      const cost = gang.getEquipmentCost(equip);
      const amount = money / cost;
      if (amount < EQUIP_AFFORD_COEFF) continue;
      for (const member of members) {
        const info = gang.getMemberInformation(member);
        if (info.upgrades.includes(equip) || info.augmentations.includes(equip)) continue;
        if (gang.purchaseEquipment(member, equip)) {
          money -= cost;
        }
      }
    }

    for (const member of members) {
      const sum = getStatsSum(member);
      if (sum > bestStats) bestStats = sum;
    }

    const powerfulEnough = info.power >= maxEnemyPower(info) * WARFARE_THRESHOLD;
    gang.setTerritoryWarfare(powerfulEnough);

    let task = defaultTask;
    if (!defaultTask) {
      if (members.length < MEMBERS_MAX) {
        task = (members.length < MEMBERS_MIN) ? TASK_NOOB : TASK_RESPECT;
      } else {
        if (info.respect < RESPECT_MIN) {
          task = TASK_RESPECT;
        } else if (!powerfulEnough) {
          task = TASK_WARFARE;
        } else {
          task = TASK_MONEY;
        }
      }
    }

    for (const member of members) {
      const sum = getStatsSum(member);
      if (sum < STATS_HARD_MIN || (members.length >= MEMBERS_MIN && sum < bestStats * STATS_THRESHOLD)) {
        setAutoTask(member, TASK_TRAIN);
        continue;
      }
      if (info.wantedLevel > 2 && info.wantedPenalty < WANTED_PENALTY_THRESHOLD) {
        setAutoTask(member, TASK_VIGI);
        continue;
      }
      setAutoTask(member, Math.random() < TRAIN_CHANCE ? TASK_TRAIN : task);
    }

    await ns.sleep(SLEEP_TIME);
  }
}