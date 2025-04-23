import {
    log, getConfiguration, instanceCount, getNsDataThroughFile, getActiveSourceFiles, runCommand, tryGetBitNodeMultipliers,
    formatMoney, formatNumberShort, formatDuration
} from './helpers.js'

// 全局配置
const updateInterval = 200; // 我们可以通过比帮派状态更频繁地更新来提高时间把控(帮派状态每2秒更新一次,领地每20秒更新一次)
const wantedPenaltyThreshold = 0.0001; // 不要让通缉惩罚变得比这个更糟
const offStatCostPenalty = 50; // 不贡献于我们主要属性的装备会受到这个倍数的感知成本惩罚
const defaultMaxSpendPerTickTransientEquipment = 0.002; // 如果没有指定 --equipment-budget，每次更新最多花费这个百分比的非保留现金在临时升级(装备)上
const defaultMaxSpendPerTickPermanentEquipment = 0.2; // 如果没有指定 --augmentation-budget，每次更新最多花费这个百分比的非保留现金在永久成员升级上

// 领地相关变量 
const gangsByPower = ["Speakers for the Dead", "The Dark Army", "The Syndicate", "Tetrads", "Slum Snakes", /* 黑客帮派规模不会太大 */ "The Black Hand", /* "NiteSec" 尝试过了，不好玩 */]
const territoryEngageThreshold = 0.60; // 在与其他帮派交战前，最低平均胜率要求(针对有领地的帮派)
let territoryTickDetected = false;
let territoryTickTime = 20000; // 预计领地更新前的毫秒数。处理离线时间时可能会变化
let territoryTickWaitPadding = 200; // 在我们认为领地将要更新之前提前这么多毫秒开始等待，以防提前更新(如果出现误判会自动增加)
let consecutiveTerritoryDetections = 0; // 用于在情况恢复正常时减少等待时间
let territoryNextTick = null; // 下一次领地更新的时间
let isReadyForNextTerritoryTick = false;
let warfareFinished = false;
let lastTerritoryPower = 0;
let lastOtherGangInfo = null;
let lastLoopTime = null;

// 犯罪活动相关变量
const crimes = ["抢劫路人", "贩毒", "威胁平民", "诈骗", "持枪抢劫", "非法武器交易", "威胁勒索", "人口贩卖", "恐怖主义",
    "勒索软件", "网络钓鱼", "身份盗窃", "DDoS攻击", "植入病毒", "欺诈和伪造", "洗钱", "网络恐怖主义"];
let pctTraining = 0.20;
let multGangSoftcap = 0.0;
let allTaskNames = (/**@returns{string[]}*/() => undefined)();
let allTaskStats = (/**@returns{{[taskName: string]: GangTaskStats;}}*/() => undefined)();
let assignedTasks = (/**@returns{{[gangMemberName: string]: string;}}*/() => ({}))(); // 每个成员会独立尝试提升他们执行的犯罪等级，直到他们效率降低或开始产生通缉等级
let lastMemberReset = {}; // 记录每个成员上次提升的时间

// 全局状态
let resetInfo = (/**@returns{ResetInfo}*/() => undefined)(); // 当前位面的信息
let ownedSourceFiles;
let myGangFaction = "";
let isHackGang = false;
let is4sBought = false;
let strWantedReduction;
let requiredRep = 0;
let myGangMembers = (/**@returns{string[]}*/() => [])();
let equipments = (/**@returns{{name: string;type: string;cost: number;stats: EquipmentStats;}[]};*/() => [])();
let importantStats = [];

let options;
const argsSchema = [
    ['training-percentage', 0.05], // 花费这个百分比的时间随机训练帮派成员而不是进行犯罪
    ['no-training', false], // 除非所有其他任务都没有收益或成员最近提升过(--min-training-ticks)，否则不训练
    ['no-auto-ascending', false], // 不自动提升成员
    ['ascend-multi-threshold', 1.05], // 如果主要属性倍数增加超过这个数值时提升第12名成员
    ['ascend-multi-threshold-spacing', 0.05], // 成员之间的提升倍数间隔这个数值，以确保他们以不同的速度提升
    // 注意：基于上述两个默认值，一旦你有12名成员，他们会在倍数[1.6, 1.55, 1.50, ..., 1.1, 1.05]时提升
    ['min-training-ticks', 10], // 提升或招募后需要这么多次更新的训练时间来重建属性
    ['reserve', null], // 在确定支出预算前保留这么多现金(如果未指定则默认使用reserve.txt的内容)
    ['augmentations-budget', null], // 每次更新在永久成员升级上花费的非保留现金百分比(如果未指定，使用defaultMaxSpendPerTickPermanentEquipment)
    ['equipment-budget', null], // 每次更新在永久成员升级上花费的非保留现金百分比(如果未指定，使用defaultMaxSpendPerTickTransientEquipment)
    ['money-focus', false], // 始终优化帮派犯罪以获得最大金钱收益。否则会平衡考虑
    ['reputation-focus', false], // 始终优化帮派犯罪以获得最大声望收益。否则会平衡考虑
];

export function autocomplete(data, _) {
    data.flags(argsSchema);
    return [];
}

/** @param {NS} ns **/
export async function main(ns) {
    const runOptions = getConfiguration(ns, argsSchema);
    if (!runOptions || await instanceCount(ns) > 1) return; // 防止启动多个此脚本的实例，即使有不同的参数
    options = runOptions; // 只有在确定这是唯一运行的实例时才设置全局“options”
    ownedSourceFiles = await getActiveSourceFiles(ns);
    const sf2Level = ownedSourceFiles[2] || 0;
    if (sf2Level == 0)
        return log(ns, "错误：你还没有解锁帮派。脚本不应运行...");

    await initialize(ns);
    log(ns, "开始主循环...");
    while (true) {
        try { await mainLoop(ns); }
        catch (err) {
            log(ns, `警告：gangs.js 在主循环中捕获(并抑制)了一个意外错误:\n` +
                (typeof err === 'string' ? err : err.message || JSON.stringify(err)), false, 'warning');
        }
        await ns.sleep(updateInterval);
    }
}

/** @param {NS} ns
 * 一次性设置操作 **/
async function initialize(ns) {
    ns.disableLog('ALL');
    pctTraining = options['no-training'] ? 0 : options['training-percentage'];

    let loggedWaiting = false;
    is4sBought = false;
    resetInfo = await getNsDataThroughFile(ns, 'ns.getResetInfo()');
    const bitNode = resetInfo.currentNode;
    let haveJoinedAGang = false;
    while (!haveJoinedAGang) {
        try {
            haveJoinedAGang = await getNsDataThroughFile(ns, 'ns.gang.inGang()');
            if (haveJoinedAGang) break;
            if (!loggedWaiting) {
                log(ns, `等待加入帮派。帮派一旦可用，将创建最高派系帮派...`);
                loggedWaiting = true;
            }
            if (bitNode == 2 || ns.heart.break() <= -54000)
                await runCommand(ns, `ns.args.forEach(g => ns.gang.createGang(g))`, '/Temp/gang-createGang.js', gangsByPower);
        }
        catch (err) {
            log(ns, `警告：gangs.js 在等待加入帮派时捕获(并抑制)了一个意外错误:\n` +
                (typeof err === 'string' ? err : err.message || JSON.stringify(err)), false, 'warning');
        }
        await ns.sleep(1000);
    }
    const playerData = await getNsDataThroughFile(ns, 'ns.getPlayer()');
    log(ns, "收集帮派信息...");
    const myGangInfo = await getNsDataThroughFile(ns, 'ns.gang.getGangInformation()');
    myGangFaction = myGangInfo.faction;
    if (loggedWaiting)
        log(ns, `成功：创建了帮派 ${myGangFaction} (在位面重置后 ${formatDuration(Date.now() - resetInfo.lastNodeReset)} 时)`, true, 'success');
    isHackGang = myGangInfo.isHacking;
    strWantedReduction = isHackGang ? "Ethical Hacking" : "Vigilante Justice";
    importantStats = isHackGang ? ["hack"] : ["str", "def", "dex", "agi"];
    territoryNextTick = lastTerritoryPower = lastOtherGangInfo = null;
    territoryTickDetected = isReadyForNextTerritoryTick = warfareFinished = false;
    territoryTickWaitPadding = updateInterval;

    // 如果可能，确定我们需要多少声望才能获得最昂贵的未拥有的增强
    const sf4Level = ownedSourceFiles[4] || 0;
    requiredRep = 2.5e6;
    if (sf4Level == 0)
        log(ns, `信息：需要SF4才能获取帮派增强信息。默认假设需要约250万声望。`);
    else {
        try {
            if (sf4Level < 3)
                log(ns, `警告：此脚本使用了奇点函数，在你拥有SF4.3之前它们非常昂贵。` +
                    `除非你有大量的临时脚本可用RAM，否则你可能会遇到运行时错误。`);
            const augmentationNames = await getNsDataThroughFile(ns, `ns.singularity.getAugmentationsFromFaction(ns.args[0])`, null, [myGangFaction]);
            const ownedAugmentations = await getNsDataThroughFile(ns, `ns.singularity.getOwnedAugmentations(true)`, '/Temp/player-augs-purchased.txt');
            const dictAugRepReqs = await getDict(ns, augmentationNames, 'singularity.getAugmentationRepReq', '/Temp/aug-repreqs.txt');
            // 由于一个bug，帮派似乎提供了“The Red Pill”，即使它不可用(在BN2之外)，所以忽略这个
            requiredRep = augmentationNames.filter(aug => !ownedAugmentations.includes(aug) && aug != "The Red Pill").reduce((max, aug) => Math.max(max, dictAugRepReqs[aug]), -1);
            log(ns, `最高增强声望成本为 ${formatNumberShort(requiredRep)}`);
        } catch {
            log(ns, `警告：尽管拥有SF4.${sf4Level}，获取增强信息失败。这可能是由于你没有足够的RAM来启动临时脚本。` +
                `继续默认假设需要约250万声望。`);
        }
    }

    // 初始化装备信息
    // 这是以一种极其复杂的方式完成的，以便我们可以在保留类型信息的同时规避RAM
    const equipmentNames = await (/**@returns{Promise<string[]>}*/() =>
        getNsDataThroughFile(ns, 'ns.gang.getEquipmentNames()'))();
    const dictEquipmentTypes = await (/**@returns{Promise<{[gangMember: string]: string;}>}*/() =>
        getGangInfoDict(ns, equipmentNames, 'getEquipmentType'))();
    const dictEquipmentCosts = await (/**@returns{Promise<{[gangMember: string]: number;}>}*/() =>
        getGangInfoDict(ns, equipmentNames, 'getEquipmentCost'))();
    const dictEquipmentStats = await (/**@returns{Promise<{[gangMember: string]: EquipmentStats;}>}*/() =>
        getGangInfoDict(ns, equipmentNames, 'getEquipmentStats'))();
    equipments = equipmentNames.map((equipmentName) => ({
        name: equipmentName,
        type: dictEquipmentTypes[equipmentName],
        cost: dictEquipmentCosts[equipmentName],
        stats: dictEquipmentStats[equipmentName],
    })).sort((a, b) => a.cost - b.cost);
    //log(ns, JSON.stringify(equipments));
    // 初始化帮派成员和犯罪信息
    allTaskNames = await getNsDataThroughFile(ns, 'ns.gang.getTaskNames()')
    allTaskStats = await getGangInfoDict(ns, allTaskNames, 'getTaskStats');
    multGangSoftcap = (await tryGetBitNodeMultipliers(ns)).GangSoftcap;
    myGangMembers = await getNsDataThroughFile(ns, 'ns.gang.getMemberNames()');
    const dictMembers = await (/**@returns{Promise<{[gangMember: string]: GangMemberInfo;}>}*/() =>
        getGangInfoDict(ns, myGangMembers, 'getMemberInformation'))();
    for (const member of Object.values(dictMembers)) // 初始化每个成员的当前活动
        assignedTasks[member.name] = (member.task && member.task !== "Unassigned") ? member.task : ("Train " + (isHackGang ? "Hacking" : "Combat"));
    while (myGangMembers.length < 3) await doRecruitMember(ns); // 我们应该能够立即招募我们的前三名成员(免费)
    // 执行所有通常在领地更新(每20秒)时执行的更新/操作一次，然后再开始主循环
    lastLoopTime = Date.now()
    await onTerritoryTick(ns, myGangInfo);
    lastTerritoryPower = myGangInfo.power;
}

/** @param {NS} ns
 * 每个`interval`执行一次 **/
async function mainLoop(ns) {
    // 更新帮派信息(特别是监控帮派力量以查看领地何时更新)
    const myGangInfo = await getNsDataThroughFile(ns, 'ns.gang.getGangInformation()');
    const thisLoopStart = Date.now();
    if (!territoryTickDetected) { // 通过观察其他帮派的领地力量更新来检测第一次领地更新
        const otherGangInfo = await getNsDataThroughFile(ns, 'ns.gang.getOtherGangInformation()'); // 返回 { [gangName]: { "power": Number, "territory": Number } } 的字典
        if (lastOtherGangInfo != null && JSON.stringify(otherGangInfo) != JSON.stringify(lastOtherGangInfo)) {
            territoryNextTick = lastLoopTime + territoryTickTime;
            territoryTickDetected = true;
            log(ns, `信息：其他帮派力量更新了(在过去的 ${formatDuration(thisLoopStart - lastLoopTime)} 内的某个时间)。` +
                `将在 ${formatDuration(territoryNextTick - thisLoopStart - territoryTickWaitPadding)} 后开始等待下一次更新`, false);
        } else if (lastOtherGangInfo == null)
            log(ns, `信息：等待检测领地更新。(等待其他帮派的力量更新。) 将每 ${formatDuration(updateInterval)} 检查一次...`);
        lastOtherGangInfo = otherGangInfo;
    }
    // 如果领地即将更新，快速 - 让所有人进行“领地战争”! 一旦我们达到100%的领地，就不需要继续让成员进行战争了
    if (!warfareFinished && !isReadyForNextTerritoryTick && (thisLoopStart + updateInterval + territoryTickWaitPadding >= territoryNextTick)) { // 提前1秒开始以确保安全
        isReadyForNextTerritoryTick = true;
        await updateMemberActivities(ns, null, "Territory Warfare", myGangInfo);
    }
    // 检测领地力量是否在上一次更新中更新了(或者如果我们没有力量，假设它已经更新了，我们只是还没有产生力量)
    if ((isReadyForNextTerritoryTick && myGangInfo.power != lastTerritoryPower) || (thisLoopStart > territoryNextTick + 5000 /* 最多再等待5秒，以防时间不对 */)) {
        await onTerritoryTick(ns, myGangInfo); // 只在每次领地更新时执行一次的大多数操作
        isReadyForNextTerritoryTick = false;
        lastTerritoryPower = myGangInfo.power;
    } else if (isReadyForNextTerritoryTick)
        log(ns, `信息：等待领地更新。(等待帮派力量从 ${formatNumberShort(lastTerritoryPower)} 变化。预计时间：${formatDuration(territoryNextTick - thisLoopStart)}`);
    lastLoopTime = thisLoopStart; // 由于周期性延迟，我们必须跟踪上次检查的时间，不能假设是`updateInterval`之前
}

/** @param {NS} ns
 * 只在每次领地更新时执行一次的大多数操作 **/
async function onTerritoryTick(ns, myGangInfo) {
    territoryNextTick = lastLoopTime + territoryTickTime / (ns.gang.getBonusTime() > 0 ? 5 : 1); // 重置下一次更新的时间
    if (lastTerritoryPower != myGangInfo.power || lastTerritoryPower == null) {
        log(ns, `领地力量从 ${formatNumberShort(lastTerritoryPower)} 更新为 ${formatNumberShort(myGangInfo.power)}.`)
        consecutiveTerritoryDetections++;
        if (consecutiveTerritoryDetections > 5 && territoryTickWaitPadding > updateInterval)
            territoryTickWaitPadding = Math.max(updateInterval, territoryTickWaitPadding - updateInterval);
    } else if (!warfareFinished) {
        log(ns, `警告：力量状态未更新，假设我们失去了领地更新的跟踪`, false,
            consecutiveTerritoryDetections == 0 ? 'warning' : null); // 只有在连续两次(或更多)发生这种情况时才弹出警告
        consecutiveTerritoryDetections = 0;
        territoryTickWaitPadding = Math.min(2000, territoryTickWaitPadding + updateInterval); // 提前开始等待以应对观察到的延迟
        territoryNextTick -= updateInterval; // 提前准备下一次更新，以防我们只是稍微落后于更新
        territoryTickDetected = false;
        lastOtherGangInfo = null;
    }

    // 更新帮派成员，以防有人在冲突中死亡
    myGangMembers = await getNsDataThroughFile(ns, 'ns.gang.getMemberNames()');
    const canRecruit = await getNsDataThroughFile(ns, 'ns.gang.canRecruitMember()');
    if (canRecruit)
        await doRecruitMember(ns) // 如果可用，招募新成员
    const dictMembers = await getGangInfoDict(ns, myGangMembers, 'getMemberInformation');
    if (!options['no-auto-ascending']) await tryAscendMembers(ns); // 如果我们认为是个好时机，提升成员
    await tryUpgradeMembers(ns, dictMembers); // 如果可能，升级成员
    await enableOrDisableWarfare(ns, myGangInfo); // 更新我们是否应该参与帮派战争
    // 有可能我们在接下来的更新中进行训练而不是工作。如果训练，我们主要训练我们的主要属性，并有小概率训练不太重要的属性
    const task = Math.random() >= pctTraining ? null : "Train " + (Math.random() < 0.1 ? "Charisma" : Math.random() < (isHackGang ? 0.1 : 0.9) ? "Combat" : "Hacking")
    await updateMemberActivities(ns, dictMembers, task); // 设置每个人的下一个活动
    if (!task) await optimizeGangCrime(ns, await waitForGameUpdate(ns, myGangInfo));  // 最后，通过微优化个别成员的犯罪来看看我们是否可以提高声望增益率
}

/** @param {NS} ns
 * @param {{[gangMember: string]: GangMemberInfo;}} dictMemberInfo
 * @param {string} forceTask
 * @param {GangGenInfo} myGangInfo
 * 整合逻辑，告诉成员该做什么 **/
async function updateMemberActivities(ns, dictMemberInfo = null, forceTask = null, myGangInfo = null) {
    const dictMembers = dictMemberInfo || (await getGangInfoDict(ns, myGangMembers, 'getMemberInformation'));
    const workOrders = [];
    const maxMemberDefense = Math.max(...Object.values(dictMembers).map(m => m.def));
    for (const member of Object.values(dictMembers)) { // 设置每个成员的期望活动
        let task = forceTask ? forceTask : assignedTasks[member.name];
        if (forceTask == "Territory Warfare" && myGangInfo.territoryClashChance > 0 && (member.def < 100 || member.def < Math.min(10000, maxMemberDefense * 0.1)))
            task = assignedTasks[member.name]; // Hack: 让低防御成员免于参与战争，因为他们更容易死亡
        if (member.task != task) workOrders.push({ name: member.name, task }); // 只有在这不是他们当前任务时才进行API调用
    }
    if (workOrders.length == 0) return;
    // 使用规避RAM的脚本批量设置活动
    if (await getNsDataThroughFile(ns, `JSON.parse(ns.args[0]).reduce((success, m) => success && ns.gang.setMemberTask(m.name, m.task), true)`,
        '/Temp/gang-set-member-tasks.txt', [JSON.stringify(workOrders)]))
        log(ns, `信息：分配了 ${workOrders.length}/${Object.keys(dictMembers).length} 名帮派成员任务 (${workOrders.map(o => o.task).filter((v, i, self) => self.indexOf(v) === i).join(", ")})`)
    else
        log(ns, `错误：未能设置一个或多个成员的任务：` + JSON.stringify(workOrders), false, 'error');
}

/** @param {NS} ns
 * @param {GangGenInfo} myGangInfo
 * 逻辑分配任务以最大化声望增益率而不会让通缉等级失控 **/
async function optimizeGangCrime(ns, myGangInfo) {
    const dictMembers = await getGangInfoDict(ns, myGangMembers, 'getMemberInformation');
    // 容忍我们的通缉等级增加，只要声望增加的速度快几个数量级，并且我们目前的惩罚不超过-0.01%
    let currentWantedPenalty = getWantedPenalty(myGangInfo) - 1;
    // 注意，直到我们有~200声望，恢复通缉惩罚的最佳方法是专注于获得声望，而不是做义警工作
    let wantedGainTolerance = currentWantedPenalty < -1.1 * wantedPenaltyThreshold && myGangInfo.wantedLevel >= (1.1 + myGangInfo.respect / 1000) &&
        myGangInfo.respect > 200 ? -0.01 * myGangInfo.wantedLevel /* 恢复通缉惩罚 */ :
        currentWantedPenalty < -0.9 * wantedPenaltyThreshold && myGangInfo.wantedLevel >= (1.1 + myGangInfo.respect / 10000) ? 0 /* 维持 */ :
            Math.max(myGangInfo.respectGainRate / 1000, myGangInfo.wantedLevel / 10) /* 允许通缉等级以可控的速度增加 */;
    const playerData = await getNsDataThroughFile(ns, 'ns.getPlayer()');
    // 找出我们需要多少声望，没有SF4，我们根据当前帮派声望估算帮派派系声望
    let factionRep = -1;
    if (ownedSourceFiles[4] > 0) {
        try { factionRep = await getNsDataThroughFile(ns, `ns.singularity.getFactionRep(ns.args[0])`, null, [myGangFaction]); }
        catch { log(ns, '信息：错误已抑制。回退到估算当前帮派派系声望。'); }
    }
    if (factionRep == -1) // 根据声望估算当前帮派声望。游戏每75声望给1声望。这是一个低估，因为它没有考虑到在提升/招募/死亡时花费/失去的声望
        factionRep = myGangInfo.respect / 75;
    const optStat = options['reputation-focus'] ? "respect" : options['money-focus'] ? "money" :
        // 如果未指定，根据已获得的声望/金钱自动更改焦点
        factionRep > requiredRep ? "money" : (playerData.money > 1E11 || myGangInfo.respect) < 9000 ? "respect" : "both money and respect";
    // 预先计算每个帮派成员在每个任务上的表现
    const memberTaskRates = Object.fromEntries(Object.values(dictMembers).map(m => [m.name, allTaskNames.map(taskName => ({
        name: taskName,
        respect: computeRepGains(myGangInfo, taskName, m),
        money: calculateMoneyGains(myGangInfo, taskName, m),
        wanted: computeWantedGains(myGangInfo, taskName, m),
    })).filter(task => task.wanted <= 0 || task.money > 0 || task.respect > 0)])); // 完全删除没有收益但会产生通缉等级的任务
    // 按最佳增益率排序任务
    if (optStat == "both money and respect") {
        Object.values(memberTaskRates).flat().forEach(v => v[optStat] = v.money / 1000 + v.respect); // Hack: 支持在尝试平衡金钱和声望时的“优化总计”属性
        Object.values(memberTaskRates).forEach((tasks, idx) => tasks.sort((a, b) => idx % 2 == 0 ? b.respect - a.respect : b.money - a.money)); // Hack: 偶数成员优先声望，奇数成员优先金钱
    } else {
        Object.values(memberTaskRates).forEach(tasks => tasks.sort((a, b) => b[optStat] - a[optStat]));
    }
    //ns.print(memberTaskRates);

    // 运行“算法”
    const start = Date.now(); // 计时算法
    let bestTaskAssignments = null, bestWanted = 0;
    let bestTotalGain = myGangInfo.wantedLevelGainRate > wantedGainTolerance ? 0 : // 忘记我们过去的成就，我们现在的通缉等级增加太快了
        optStat == "respect" ? myGangInfo.respectGainRate : myGangInfo.moneyGainRate; // 必须比当前的增益率更好，如果它在我们的通缉阈值内
    for (let shuffle = 0; shuffle < 100; shuffle++) { // 通过以不同的顺序贪婪地优化帮派成员，我们可以发现更优化的结果。尝试几次
        let proposedTasks = {}, totalWanted = 0, totalGain = 0;
        shuffleArray(myGangMembers.slice()).forEach((member, index) => {
            const taskRates = memberTaskRates[member];
            // “贪婪”地一次优化一个成员，但当我们接近列表末尾时，我们不能再期望未来的成员能弥补通缉增加
            const sustainableTasks = (index < myGangMembers.length - 2) ? taskRates : taskRates.filter(c => (totalWanted + c.wanted) <= wantedGainTolerance);
            // 找到最佳增益的犯罪(如果我们不能为任何任务产生价值，那么我们应该只训练)
            const bestTask = taskRates[0][optStat] == 0 || (Date.now() - (lastMemberReset[member] || 0) < options['min-training-ticks'] * territoryTickTime) ?
                taskRates.find(t => t.name === ("Train " + (isHackGang ? "Hacking" : "Combat"))) :
                (totalWanted > wantedGainTolerance || sustainableTasks.length == 0) ? taskRates.find(t => t.name === strWantedReduction) : sustainableTasks[0];
            [proposedTasks[member], totalWanted, totalGain] = [bestTask, totalWanted + bestTask.wanted, totalGain + bestTask[optStat]];
        });
        // 在上述尝试优化之后，如果我们超过了我们的通缉增益阈值，则降低产生通缉最多的任务，直到在我们的限制内
        let infiniteLoop = 9999;
        while (totalWanted > wantedGainTolerance && Object.values(proposedTasks).some(t => t.name !== strWantedReduction)) {
            const mostWanted = Object.keys(proposedTasks).reduce((t, c) => proposedTasks[c].name !== strWantedReduction && (t == null || proposedTasks[t].wanted < proposedTasks[c].wanted) ? c : t, null);
            const nextBestTask = memberTaskRates[mostWanted].filter(c => c.wanted < proposedTasks[mostWanted].wanted)[0] ?? memberTaskRates[mostWanted].find(t => t.name === strWantedReduction);
            [proposedTasks[mostWanted], totalWanted, totalGain] = [nextBestTask, totalWanted + nextBestTask.wanted - proposedTasks[mostWanted].wanted, totalGain + nextBestTask[optStat] - proposedTasks[mostWanted][optStat]];
            if (infiniteLoop-- <= 0) throw "无限循环!";
        }
        //log(ns, `最佳任务分配:. 通缉: ${totalWanted.toPrecision(3)}, 增益: ${formatNumberShort(totalGain)}`);
        // 仅当这是我们为我们试图优化的值看到的最佳增益结果，或我们最接近满足我们的通缉容忍度时，才保存新的任务分配
        if (totalWanted <= wantedGainTolerance && totalGain > bestTotalGain || totalWanted > wantedGainTolerance && totalWanted < bestWanted)
            [bestTaskAssignments, bestTotalGain, bestWanted] = [proposedTasks, totalGain, totalWanted];
    }
    const elapsed = Date.now() - start;
    // 确定是否需要进行任何更改
    if (bestTaskAssignments != null && myGangMembers.some(m => assignedTasks[m] !== bestTaskAssignments[m].name)) {
        myGangMembers.forEach(m => assignedTasks[m] = bestTaskAssignments[m].name); // 更新所有成员的工作命令
        const oldGangInfo = myGangInfo;
        await updateMemberActivities(ns, dictMembers);
        const [optWanted, optRespect, optMoney] = myGangMembers.map(m => assignedTasks[m]).reduce(([w, r, m], t) => [w + t.wanted, r + t.respect, m + t.money], [0, 0, 0]);
        if (optWanted != oldGangInfo.wantedLevelGainRate || optRespect != oldGangInfo.respectGainRate || optMoney != oldGangInfo.moneyGainRate)
            myGangInfo = await waitForGameUpdate(ns, oldGangInfo);
        log(ns, `成功：优化帮派成员犯罪以获得 ${optStat}，通缉增益容忍度为 ${wantedGainTolerance.toPrecision(2)} (${elapsed} 毫秒)。` +
            `通缉: ${oldGangInfo.wantedLevelGainRate.toPrecision(3)} -> ${myGangInfo.wantedLevelGainRate.toPrecision(3)}, ` +
            `声望: ${formatNumberShort(oldGangInfo.respectGainRate)} -> ${formatNumberShort(myGangInfo.respectGainRate)}, 金钱: ${formatMoney(oldGangInfo.moneyGainRate)} -> ${formatMoney(myGangInfo.moneyGainRate)}`);
        // 检查我们的计算(我们从游戏源代码中偷来的)是否大致正确
        if ((Math.abs(myGangInfo.wantedLevelGainRate - optWanted) / optWanted > 0.01) || (Math.abs(myGangInfo.respectGainRate - optRespect) / optRespect > 0.01) || (Math.abs(myGangInfo.moneyGainRate - optMoney) / optMoney > 0.01))
            log(ns, `警告：计算的新速率将是 声望:${formatNumberShort(optRespect)} 通缉: ${optWanted.toPrecision(3)} 金钱: ${formatMoney(optMoney)}` +
                `但它们是 声望:${formatNumberShort(myGangInfo.respectGainRate)} 通缉: ${myGangInfo.wantedLevelGainRate.toPrecision(3)} 金钱: ${formatMoney(myGangInfo.moneyGainRate)}`, false, 'warning');
    } else
        log(ns, `信息：确定所有 ${myGangMembers.length} 名帮派成员的分配已经是最佳的 ${optStat}，通缉增益容忍度为 ${wantedGainTolerance.toPrecision(2)} (${elapsed} 毫秒)。`);
    // 故障保护：如果我们不知何故超出了并且正在生成通缉等级，开始随机分配成员进行义警工作以修复它
    if (myGangInfo.wantedLevelGainRate > wantedGainTolerance) await fixWantedGainRate(ns, myGangInfo, wantedGainTolerance);
}

/** @param {NS} ns
 * 逻辑在我们生成通缉等级时降低犯罪等级 **/
async function fixWantedGainRate(ns, myGangInfo, wantedGainTolerance = 0) {
    // TODO: 偷实际的通缉等级计算并战略性地选择可以弥补差距的成员，同时失去最少的声望/秒
    let lastWantedLevelGainRate = myGangInfo.wantedLevelGainRate;
    log(ns, `警告：生成通缉等级 (${lastWantedLevelGainRate.toPrecision(3)}/秒 > ${wantedGainTolerance.toPrecision(3)}/秒)，暂时分配随机成员进行义警工作...`, false, 'warning');
    for (const member of shuffleArray(myGangMembers.slice())) {
        if (!crimes.includes(assignedTasks[member])) continue; // 这个成员没有犯罪，所以他们不贡献通缉
        assignedTasks[member] = strWantedReduction;
        await updateMemberActivities(ns);
        const wantedLevelGainRate = (myGangInfo = await waitForGameUpdate(ns, myGangInfo)).wantedLevelGainRate;
        if (wantedLevelGainRate < wantedGainTolerance) return;
        if (lastWantedLevelGainRate == wantedLevelGainRate)
            log(ns, `警告：尝试将 ${member} 的犯罪回滚到 ${assignedTasks[member]} 导致通缉等级增益率没有变化 ` +
                `(${lastWantedLevelGainRate.toPrecision(3)})`, false, 'warning');
    }
}

/** @param {NS} ns
 * 如果可用，招募新成员 **/
async function doRecruitMember(ns) {
    let i = 0, newMemberName;
    do { newMemberName = `Thug ${++i}`; } while (myGangMembers.includes(newMemberName) || myGangMembers.includes(newMemberName + " Understudy"));
    if (i < myGangMembers.length) newMemberName += " Understudy"; // 向已故成员致敬
    if (await getNsDataThroughFile(ns, `ns.gang.canRecruitMember() && ns.gang.recruitMember(ns.args[0])`, '/Temp/gang-recruit-member.txt', [newMemberName])) {
        myGangMembers.push(newMemberName);
        assignedTasks[newMemberName] = "Train " + (isHackGang ? "Hacking" : "Combat");
        lastMemberReset[newMemberName] = Date.now();
        log(ns, `成功：招募了新帮派成员 "${newMemberName}"!`, false, 'success');
    } else {
        log(ns, `错误：未能招募新帮派成员 "${newMemberName}"!`, false, 'error');
    }
}

/** @param {NS} ns
 * 检查是否有任何成员被认为值得提升以增加属性倍数 **/
async function tryAscendMembers(ns) {
    const dictAscensionResults = await getGangInfoDict(ns, myGangMembers, 'getAscensionResult');
    for (let i = 0; i < myGangMembers.length; i++) {
        const member = myGangMembers[i];
        // 前几个成员被赋予最大的阈值，这样早期当他们是我们唯一的成员时，他们更稳定
        const ascMultiThreshold = options['ascend-multi-threshold'] + (11 - i) * options['ascend-multi-threshold-spacing'];
        const ascResult = dictAscensionResults[member];
        if (!ascResult || !importantStats.some(stat => ascResult[stat] >= ascMultiThreshold))
            continue;
        if (undefined !== (await getNsDataThroughFile(ns, `ns.gang.ascendMember(ns.args[0])`, null, [member]))) {
            log(ns, `成功：提升成员 ${member} 以增加倍数 ${importantStats.map(s => `${s} -> ${ascResult[s].toFixed(2)}x`).join(", ")}`, false, 'success');
            lastMemberReset[member] = Date.now();
        }
        else
            log(ns, `错误：尝试提升成员 ${member} 失败。去调查一下!`, false, 'error');
    }
}

/** @param {NS} ns
 * @param {{[gangMember: string]: GangMemberInfo;}} dictMembers
 * 如果我们有预算，升级任何缺失的装备/增强 **/
async function tryUpgradeMembers(ns, dictMembers) {
    // 更新装备成本以考虑折扣
    const dictEquipmentCosts = await getGangInfoDict(ns, equipments.map(e => e.name), 'getEquipmentCost');
    equipments.forEach(e => e.cost = dictEquipmentCosts[e.name])
    // 升级成员，每次更新花费不超过x%的钱(并尊重全局保留)
    const purchaseOrder = [];
    const playerData = await getNsDataThroughFile(ns, 'ns.getPlayer()');
    const homeMoney = playerData.money - (options['reserve'] != null ? options['reserve'] : Number(ns.read("reserve.txt") || 0));
    const maxBudget = 0.99; // 注意：为了避免舍入问题和微支出竞争条件，每次更新最多允许预算99%的钱
    let budget = Math.min(maxBudget, (options['equipment-budget'] || defaultMaxSpendPerTickTransientEquipment)) * homeMoney;
    let augBudget = Math.min(maxBudget, (options['augmentations-budget'] || defaultMaxSpendPerTickPermanentEquipment)) * homeMoney;
    // Hack: 在某些情况下，默认增强预算减少1/100(待办事项：添加更多，例如当位面倍数使帮派收入严重受限时)
    if (!is4sBought)
        is4sBought = await getNsDataThroughFile(ns, 'ns.stock.has4SDataTIXAPI()');
    if (!is4sBought || resetInfo.currentNode === 8) {
        budget /= 100;
        augBudget /= 100;
    }
    // 找出在我们的预算内可以购买的未完成装备
    for (const equip of equipments) {
        if (augBudget <= 0) break;
        for (const member of Object.values(dictMembers)) { // 在考虑下一个最昂贵的装备之前，为每个成员获取此装备
            if (augBudget <= 0) break;
            // Hack: 增加不贡献于我们主要属性的装备的“成本”，以便我们只有在有充足现金时才购买它们
            let percievedCost = equip.cost * (Object.keys(equip.stats).some(stat => importantStats.some(i => stat.includes(i))) ? 1 : offStatCostPenalty);
            if (percievedCost > augBudget) continue;
            if (equip.type != "Augmentation" && percievedCost > budget) continue;
            if (!member.upgrades.includes(equip.name) && !member.augmentations.includes(equip.name)) {
                purchaseOrder.push({ member: member.name, type: equip.type, equipmentName: equip.name, cost: equip.cost });
                budget -= equip.cost;
                augBudget -= equip.cost;
            }
        }
    }
    await doUpgradePurchases(ns, purchaseOrder);
}

/** @param {NS} ns
 * 生成一个临时任务来升级成员 **/
async function doUpgradePurchases(ns, purchaseOrder) {
    if (purchaseOrder.length == 0) return;
    const totalCost = purchaseOrder.reduce((t, e) => t + e.cost, 0);
    const getOrderSummary = (items) => items.map(o => `${o.member} ${o.type}: "${o.equipmentName}"`).join(", ");
    const orderOutcomes = await getNsDataThroughFile(ns, `JSON.parse(ns.args[0]).map(o => ns.gang.purchaseEquipment(o.member, o.equipmentName))`,
        '/Temp/gang-upgrade-members.txt', [JSON.stringify(purchaseOrder)]);
    const succeeded = [], failed = [];
    for (let i = 0; i < orderOutcomes.length; i++)
        (orderOutcomes[i] ? succeeded : failed).push(purchaseOrder[i]);
    if (succeeded.length == purchaseOrder.length)
        log(ns, `成功：购买了 ${purchaseOrder.length} 个帮派成员升级，总计 ${formatMoney(totalCost)}:\n${getOrderSummary(succeeded)}`, false, 'success');
    else
        log(ns, `警告：未能购买总计 ${formatMoney(totalCost)} 的一个或多个帮派升级(资金不足?)。` +
            `\n  失败: ${getOrderSummary(failed)}\n  成功: ${getOrderSummary(succeeded)}`, false, 'error');
}

let sequentialMisfires = 0;

/** 帮助等待游戏更新状态(通常每2秒一个周期)
 * @param {NS} ns
 * @param {GangGenInfo} oldGangInfo
 * @returns {Promise<GangGenInfo>} **/
async function waitForGameUpdate(ns, oldGangInfo) {
    if (!myGangMembers.some(member => !assignedTasks[member].includes("Train")))
        return oldGangInfo; // 如果所有成员都在训练，帮派信息永远不会改变，所以不要等待更新
    const maxWaitTime = 2500;
    const waitInterval = 100;
    const start = Date.now()
    while (Date.now() < start + maxWaitTime) {
        var latestGangInfo = await getNsDataThroughFile(ns, 'ns.gang.getGangInformation()');
        if (JSON.stringify(latestGangInfo) != JSON.stringify(oldGangInfo)) {
            sequentialMisfires = 0;
            return latestGangInfo;
        }
        await ns.sleep(Math.min(waitInterval, start + maxWaitTime - Date.now()));
    }
    sequentialMisfires++;
    log(ns, `警告：等待旧帮派信息更新时超过最大等待时间 ${maxWaitTime}。\n${JSON.stringify(oldGangInfo)}\n===\n${JSON.stringify(latestGangInfo)}`,
        false, sequentialMisfires < 2 ? null : 'warning'); // 只有在连续两次(或更多)发生这种情况时才弹出警告
    territoryTickDetected = false;
    return latestGangInfo;
}

/** 检查我们是否应该根据我们的帮派力量和其他帮派的力量参与战争
 * @param {NS} ns
 * @param {GangGenInfo} myGangInfo **/
async function enableOrDisableWarfare(ns, myGangInfo) {
    warfareFinished = Math.round(myGangInfo.territory * 2 ** 20) / 2 ** 20 /* 处理API不精确性 */ >= 1;
    if (warfareFinished && !myGangInfo.territoryWarfareEngaged) return; // 一旦我们达到100%，就不需要参与战争
    const otherGangs = await getNsDataThroughFile(ns, 'ns.gang.getOtherGangInformation()'); // 返回 { [gangName]: { "power": Number, "territory": Number } } 的字典
    let lowestWinChance = 1, totalWinChance = 0, totalActiveGangs = 0;
    let lowestWinChanceGang = "";
    for (const otherGang in otherGangs) {
        if (otherGangs[otherGang].territory == 0 || otherGang == myGangFaction) continue; // *新* 不用担心与领地为0的帮派战斗
        const winChance = myGangInfo.power / (myGangInfo.power + otherGangs[otherGang].power)
        if (winChance <= lowestWinChance) lowestWinChanceGang = otherGang;
        totalActiveGangs++, totalWinChance += winChance, lowestWinChance = Math.min(lowestWinChance, winChance);
    }
    // 只有当我们有超过<territoryEngageThreshold>%的胜率时才开启领地战争
    const averageWinChance = totalWinChance / totalActiveGangs;
    const shouldEngage = !warfareFinished && territoryEngageThreshold <= averageWinChance;
    if (shouldEngage != myGangInfo.territoryWarfareEngaged) {
        log(ns, (warfareFinished ? '成功' : '信息') + `：切换参与领地战争为 ${shouldEngage}。我们的力量：${formatNumberShort(myGangInfo.power)}。` +
            (!warfareFinished ? `最低胜率为 ${(100 * lowestWinChance).toFixed(2)}% 与 ${lowestWinChanceGang} (力量 ${formatNumberShort(otherGangs[lowestWinChanceGang]?.power)}). ` +
                `平均胜率 ${(100 * averageWinChance).toFixed(2)}% 在 ${totalActiveGangs} 个活跃帮派中。` :
                '我们已经摧毁了所有其他帮派并获得了100%的领地'), false, warfareFinished ? 'info' : 'success');
        await runCommand(ns, `ns.gang.setTerritoryWarfare(ns.args[0])`, null, [shouldEngage]);
    }
}

// 规避RAM的助手，用于获取每个列表项的帮派信息
const getGangInfoDict = /**@returns{Promise<{[gangMember: string]: any;}>}*/async (ns, elements, gangFunction) => await getDict(ns, elements, `gang.${gangFunction}`, `/Temp/gang-${gangFunction}.txt`);
const getDict = /**@returns{Promise<{[key: string]: any;}>}*/ async (ns, elements, nsFunction, fileName) => await getNsDataThroughFile(ns, `Object.fromEntries(ns.args.map(o => [o, ns.${nsFunction}(o)]))`, fileName, elements);

/** 帮派计算公式来自 https://github.com/bitburner-official/bitburner-src/blob/dev/src/Gang/GangMember.ts **/
/** @param {GangTaskStats} task
 * @param {GangMemberInfo} memberInfo **/
function getStatWeight(task, memberInfo) {
    return (task.hackWeight / 100) * memberInfo["hack"] + // 需要引用以避免支付ns.hack的RAM -_-
        (task.strWeight / 100) * memberInfo.str +
        (task.defWeight / 100) * memberInfo.def +
        (task.dexWeight / 100) * memberInfo.dex +
        (task.agiWeight / 100) * memberInfo.agi +
        (task.chaWeight / 100) * memberInfo.cha;
}

let getWantedPenalty = myGangInfo => myGangInfo.respect / (myGangInfo.respect + myGangInfo.wantedLevel);
let getTerritoryPenalty = myGangInfo => (0.2 * myGangInfo.territory + 0.8) * multGangSoftcap;

/** @param {GangGenInfo} myGangInfo
 * @param {string} currentTask
 * @param {GangMemberInfo} memberInfo **/
function computeRepGains(myGangInfo, currentTask, memberInfo) {
    const task = allTaskStats[currentTask];
    const statWeight = getStatWeight(task, memberInfo) - 4 * task.difficulty;
    if (task.baseRespect === 0 || statWeight <= 0) return 0;
    const territoryMult = Math.max(0.005, Math.pow(myGangInfo.territory * 100, task.territory.respect) / 100);
    if (isNaN(territoryMult) || territoryMult <= 0) return 0;
    const respectMult = getWantedPenalty(myGangInfo);
    const territoryPenalty = getTerritoryPenalty(myGangInfo);
    //console.log(`statWeight: ${statWeight} task.difficulty: ${task.difficulty} territoryMult: ${territoryMult} territoryPenalty: ${territoryPenalty} myGangInfo.respect ${myGangInfo.respect} myGangInfo.wanted ${myGangInfo.wanted} respectMult: ${respectMult}`);
    return Math.pow(11 * task.baseRespect * statWeight * territoryMult * respectMult, territoryPenalty);
}

/** @param {GangGenInfo} myGangInfo
 * @param {string} currentTask
 * @param {GangMemberInfo} memberInfo **/
function computeWantedGains(myGangInfo, currentTask, memberInfo) {
    const task = allTaskStats[currentTask];
    const statWeight = getStatWeight(task, memberInfo) - 3.5 * task.difficulty;
    if (task.baseWanted === 0 || statWeight <= 0) return 0;
    const territoryMult = Math.max(0.005, Math.pow(myGangInfo.territory * 100, task.territory.wanted) / 100);
    if (isNaN(territoryMult) || territoryMult <= 0) return 0;
    return (task.baseWanted < 0) ? 0.4 * task.baseWanted * statWeight * territoryMult :
        Math.min(100, (7 * task.baseWanted) / Math.pow(3 * statWeight * territoryMult, 0.8));
}

/** @param {GangGenInfo} myGangInfo
 * @param {string} currentTask
 * @param {GangMemberInfo} memberInfo **/
function calculateMoneyGains(myGangInfo, currentTask, memberInfo) {
    const task = allTaskStats[currentTask];
    const statWeight = getStatWeight(task, memberInfo) - 3.2 * task.difficulty;
    if (task.baseMoney === 0 || statWeight <= 0) return 0;
    const territoryMult = Math.max(0.005, Math.pow(myGangInfo.territory * 100, task.territory.money) / 100);
    if (isNaN(territoryMult) || territoryMult <= 0) return 0;
    const respectMult = getWantedPenalty(myGangInfo);
    const territoryPenalty = getTerritoryPenalty(myGangInfo);
    return Math.pow(5 * task.baseMoney * statWeight * territoryMult * respectMult, territoryPenalty);
}

/** 帮助我们通过随机顺序降低帮派成员犯罪等级来避免陷入循环 */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}
