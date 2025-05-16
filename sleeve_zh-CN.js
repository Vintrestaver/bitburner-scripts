import { log, getConfiguration, instanceCount, disableLogs, getActiveSourceFiles, getNsDataThroughFile, runCommand, formatMoney, formatDuration } from './helpers.js'

const argsSchema = [
    ['min-shock-recovery', 97], // 在尝试训练或犯罪之前的最小休克恢复值（设置为100以禁用，0以完全恢复）
    ['shock-recovery', 0.05], // 设置为0到1之间的数字，以将该比例的时间用于定期休克恢复（直到休克为0）
    ['crime', null], // 如果指定，袖子将仅执行此犯罪，无论统计数据如何
    ['homicide-chance-threshold', 0.5], // 当袖子的成功几率超过此比例时，袖子将自动开始杀人
    ['disable-gang-homicide-priority', false], // 默认情况下，袖子会进行杀人以获取Karma，直到我们加入帮派。设置此标志以禁用此优先级。
    ['aug-budget', 0.1], // 每刻花费当前现金的这么多用于增强（默认值较高，因为这些增强在BN的剩余时间内是永久的）
    ['buy-cooldown', 60 * 1000], // 在购买更多袖子增强之前必须等待这么多毫秒
    ['min-aug-batch', 20], // 在触发之前必须能够负担至少这么多增强（或者如果购买所有剩余的增强，则更少）
    ['reserve', null], // 在确定支出预算之前保留这么多现金（如果未指定，则默认为reserve.txt的内容）
    ['disable-follow-player', false], // 设置为true以禁用让袖子0为与玩家相同的派系/公司工作以提高声望获取率
    ['disable-training', false], // 设置为true以禁用袖子在健身房锻炼（花费金钱）
    ['train-to-strength', 105], // 袖子将去健身房直到达到这么多的力量
    ['train-to-defense', 105], // 袖子将去健身房直到达到这么多的防御
    ['train-to-dexterity', 70], // 袖子将去健身房直到达到这么多的敏捷
    ['train-to-agility', 70], // 袖子将去健身房直到达到这么多的灵活
    ['study-to-hacking', 25], // 袖子将去大学直到达到这么多的黑客技能
    ['study-to-charisma', 25], // 袖子将去大学直到达到这么多的魅力
    ['training-reserve', null], // 默认为全局reserve.txt。可以设置为负数以允许负债。如果金钱低于此金额，袖子将不会训练。
    ['training-cap-seconds', 2 * 60 * 60 /* 2小时 */], // 从bitnode开始后的时间，在此之后我们将不再尝试将袖子训练到其目标“train-to”设置
    ['disable-spending-hashes-for-gym-upgrades', false], // 设置为true以禁用在训练袖子时花费哈希值进行健身房升级。
    ['disable-spending-hashes-for-study-upgrades', false], // 设置为true以禁用在智能提升袖子时花费哈希值进行学习升级。
    ['enable-bladeburner-team-building', false], // 设置为true以让一个袖子支持主袖子，另一个进行招募。否则，他们只会做更多的“渗透合成人”
    ['disable-bladeburner', false], // 设置为true以禁用袖子在健身房锻炼（花费金钱）
    ['failed-bladeburner-contract-cooldown', 30 * 60 * 1000], // 默认30分钟：在失败刀锋燃烧者合同后等待的时间，然后我们再次尝试
];

const interval = 1000; // 经常更新（刻）以检查袖子并重新计算其理想任务
const rerollTime = 61000; // 我们为每个袖子的随机休克恢复机会重新滚动的时间
const statusUpdateInterval = 10 * 60 * 1000; // 即使任务没有更改，也经常记录袖子状态
const trainingReserveFile = '/Temp/sleeves-training-reserve.txt';
const works = ['security', 'field', 'hacking']; // 当进行派系工作时，我们优先考虑体力工作，因为袖子往往具有最高的这些统计数据
const trainStats = ['str', 'def', 'dex', 'agi'];
const trainSmarts = ['hacking', 'charisma'];
const sleeveBbContractNames = ["Tracking", "Bounty Hunter", "Retirement"];
const minBbContracts = 2; // 在袖子尝试合同之前，应该有这么多的合同剩余
const minBbProbability = 0.99; // 玩家机会应该这么高，袖子才会尝试合同
const waitForContractCooldown = 60 * 1000; // 1分钟 - 当合同数量或概率过低时的冷却时间

let cachedCrimeStats, workByFaction; // 犯罪统计数据和哪些派系支持哪些工作的缓存
let task, lastStatusUpdateTime, lastPurchaseTime, lastPurchaseStatusUpdate, availableAugs, cacheExpiry,
    shockChance, lastRerollTime, bladeburnerCooldown, lastSleeveHp, lastSleeveShock; // 每个袖子的状态
let numSleeves, ownedSourceFiles, playerInGang, playerInBladeburner, bladeburnerCityChaos, bladeburnerContractChances, bladeburnerContractCounts, followPlayerSleeve;
let options;

export function autocomplete(data, _) {
    data.flags(argsSchema);
    return [];
}

/** @param {NS} ns **/
export async function main(ns) {
    const runOptions = getConfiguration(ns, argsSchema);
    if (!runOptions || await instanceCount(ns) > 1) return; // 防止启动此脚本的多个实例，即使使用不同的参数。
    options = runOptions; // 在确定这是唯一运行的实例之前，我们不设置全局“options”
    disableLogs(ns, ['getServerMoneyAvailable']);
    // 确保全局状态已重置（例如，在进入新的bitnode之后）
    task = [], lastStatusUpdateTime = [], lastPurchaseTime = [], lastPurchaseStatusUpdate = [], availableAugs = [],
        cacheExpiry = [], shockChance = [], lastRerollTime = [], bladeburnerCooldown = [], lastSleeveHp = [], lastSleeveShock = [];
    workByFaction = {}, cachedCrimeStats = {};
    playerInGang = playerInBladeburner = false;
    // 确保我们可以访问袖子
    ownedSourceFiles = await getActiveSourceFiles(ns);
    if (!(10 in ownedSourceFiles))
        return ns.tprint("警告：在完成BN10之前，您无法运行sleeve.js。");
    // 启动主循环
    while (true) {
        try { await mainLoop(ns); }
        catch (err) {
            log(ns, `警告：sleeve.js捕获（并抑制）了主循环中的意外错误：\n` +
                (err?.stack || '') + (typeof err === 'string' ? err : err.message || JSON.stringify(err)), false, 'warning');
        }
        await ns.sleep(interval);
    }
}

/** @param {NS} ns
 * 为袖子购买增强 */
async function manageSleeveAugs(ns, i, budget) {
    // 检索并缓存可用的袖子增强集（暂时缓存，但不是永久缓存，以防规则更改）
    if (availableAugs[i] == null || Date.now() > cacheExpiry[i]) {
        cacheExpiry[i] = Date.now() + 60000;
        availableAugs[i] = (await getNsDataThroughFile(ns, `ns.sleeve.getSleevePurchasableAugs(ns.args[0])`,  // { name, cost }的列表
            null, [i])).sort((a, b) => a.cost - b.cost);
    }
    if (availableAugs[i].length == 0) return 0;

    const cooldownLeft = Math.max(0, options['buy-cooldown'] - (Date.now() - (lastPurchaseTime[i] || 0)));
    const [batchCount, batchCost] = availableAugs[i].reduce(([n, c], aug) => c + aug.cost <= budget ? [n + 1, c + aug.cost] : [n, c], [0, 0]);
    const purchaseUpdate = `袖子 ${i} 可以负担 ${batchCount.toFixed(0).padStart(2)}/${availableAugs[i].length.toFixed(0).padEnd(2)} 剩余的增强 ` +
        `(花费 ${formatMoney(batchCost)} of ${formatMoney(availableAugs[i].reduce((t, aug) => t + aug.cost, 0))})。`;
    if (lastPurchaseStatusUpdate[i] != purchaseUpdate)
        log(ns, `信息：预算为 ${formatMoney(budget)}，${(lastPurchaseStatusUpdate[i] = purchaseUpdate)} ` +
            `(最小批次大小：${options['min-aug-batch']}, 冷却时间：${formatDuration(cooldownLeft)})`);
    if (cooldownLeft == 0 && batchCount > 0 && ((batchCount >= availableAugs[i].length - 1) || batchCount >= options['min-aug-batch'])) { // 如果最后一个增强太贵，不要要求它
        let strAction = `为袖子 ${i} 购买 ${batchCount}/${availableAugs[i].length} 增强，总成本为 ${formatMoney(batchCost)}`;
        let toPurchase = availableAugs[i].splice(0, batchCount);
        if (await getNsDataThroughFile(ns, `ns.args.slice(1).reduce((s, aug) => s && ns.sleeve.purchaseSleeveAug(ns.args[0], aug), true)`,
            '/Temp/sleeve-purchase.txt', [i, ...toPurchase.map(a => a.name)])) {
            log(ns, `成功：${strAction}`, true, 'success');
            [lastSleeveHp[i], lastSleeveShock[i]] = [undefined, undefined]; // 安装增强后，袖子状态重置，因此忘记保存的健康信息
        } else log(ns, `错误：未能 ${strAction}`, true, 'error');
        lastPurchaseTime[i] = Date.now();
        return batchCost; // 即使我们认为失败了，也返回预测的成本，以便如果购买成功，我们不会超出预算
    }
    return 0;
}

/** @param {NS} ns
 * @returns {Promise<Player>} ns.getPlayer()的结果 */
async function getPlayerInfo(ns) {
    return await getNsDataThroughFile(ns, `ns.getPlayer()`);
}

/** @param {NS} ns
 * @returns {Promise<Task>} */
async function getCurrentWorkInfo(ns) {
    return (await getNsDataThroughFile(ns, 'ns.singularity.getCurrentWork()')) ?? {};
}

/** @param {NS} ns
 * @param {number} numSleeves
 * @returns {Promise<SleevePerson[]>} */
async function getAllSleeves(ns, numSleeves) {
    return await getNsDataThroughFile(ns, `ns.args.map(i => ns.sleeve.getSleeve(i))`,
        `/Temp/sleeve-getSleeve-all.txt`, [...Array(numSleeves).keys()]);
}

/** @param {NS} ns
 * 主循环，收集数据，检查所有袖子并管理它们。 */
async function mainLoop(ns) {
    // 更新信息
    numSleeves = await getNsDataThroughFile(ns, `ns.sleeve.getNumSleeves()`);
    const playerInfo = await getPlayerInfo(ns);
    // 如果我们尚未检测到我们在刀锋燃烧者中，现在执行（除非禁用）
    if (!options['disable-bladeburner'] && !playerInBladeburner)
        playerInBladeburner = await getNsDataThroughFile(ns, 'ns.bladeburner.inBladeburner()');
    const playerWorkInfo = await getCurrentWorkInfo(ns);
    if (!playerInGang) playerInGang = !(2 in ownedSourceFiles) ? false : await getNsDataThroughFile(ns, 'ns.gang.inGang()');
    let globalReserve = Number(ns.read("reserve.txt") || 0);
    let budget = (playerInfo.money - (options['reserve'] || globalReserve)) * options['aug-budget'];
    // 估计袖子在下一个时间间隔内的训练成本，看看（忽略收入）我们是否会低于我们的储备。
    const costByNextLoop = interval / 1000 * task.filter(t => t.startsWith("train")).length * 12000; // TODO: 训练成本/秒似乎是一个错误。应该是这个的1/5（$2400/秒）
    // 获取当前bitnode中的时间（以限制我们训练袖子的时间）
    const timeInBitnode = Date.now() - (await getNsDataThroughFile(ns, 'ns.getResetInfo()')).lastNodeReset
    let canTrain = !options['disable-training'] &&
        // 为了避免在倍数被削弱时永远训练，如果我们在bitnode中的时间超过一定时间，停止训练
        (options['training-cap-seconds'] * 1000 > timeInBitnode) &&
        // 如果我们没有钱，不要训练（除非玩家允许训练负债）
        (playerInfo.money - costByNextLoop) > (options['training-reserve'] ||
            (promptedForTrainingBudget ? ns.read(trainingReserveFile) : undefined) || globalReserve);
    // 如果任何袖子在健身房训练，看看我们是否可以购买健身房升级来帮助他们
    if (canTrain && task.some(t => t?.startsWith("train")) && !options['disable-spending-hashes-for-gym-upgrades'])
        if (await getNsDataThroughFile(ns, 'ns.hacknet.spendHashes("Improve Gym Training")', '/Temp/spend-hashes-on-gym.txt'))
            log(ns, `成功：购买了“Improve Gym Training”以加速袖子训练。`, false, 'success');
    if (canTrain && task.some(t => t?.startsWith("study")) && !options['disable-spending-hashes-for-study-upgrades'])
        if (await getNsDataThroughFile(ns, 'ns.hacknet.spendHashes("Improve Studying")', '/Temp/spend-hashes-on-study.txt'))
            log(ns, `成功：购买了“Improve Studying”以加速袖子学习。`, false, 'success');
    if (playerInBladeburner && (7 in ownedSourceFiles)) {
        const bladeburnerCity = await getNsDataThroughFile(ns, `ns.bladeburner.getCity()`);
        bladeburnerCityChaos = await getNsDataThroughFile(ns, `ns.bladeburner.getCityChaos(ns.args[0])`, null, [bladeburnerCity]);
        bladeburnerContractChances = await getNsDataThroughFile(ns,
            // 目前没有办法获取袖子的机会，所以暂时假设它与玩家机会相同。（编辑：这是一个糟糕的假设）
            'Object.fromEntries(ns.args.map(c => [c, ns.bladeburner.getActionEstimatedSuccessChance("Contracts", c)[0]]))',
            '/Temp/sleeve-bladeburner-success-chances.txt', sleeveBbContractNames);
        bladeburnerContractCounts = await getNsDataThroughFile(ns,
            'Object.fromEntries(ns.args.map(c => [c, ns.bladeburner.getActionCountRemaining("Contracts", c)]))',
            '/Temp/sleeve-bladeburner-contract-counts.txt', sleeveBbContractNames);
    } else
        bladeburnerCityChaos = 0, bladeburnerContractChances = {}, bladeburnerContractCounts = {};

    // 更新所有袖子信息并循环所有袖子以进行一些单独的检查和任务分配
    let sleeveInfo = await getAllSleeves(ns, numSleeves);

    // 如果未禁用，将“跟随玩家”的袖子设置为第一个休克为0的袖子
    followPlayerSleeve = options['disable-follow-player'] ? -1 : undefined;
    for (let i = 0; i < numSleeves; i++) // 下面的黑客：优先处理进行刀锋燃烧者合同的袖子，不要让它们跟随玩家
        if (sleeveInfo[i].shock == 0 && (i < i || i > 3 || !playerInBladeburner))
            followPlayerSleeve ??= i; // 如果之前已分配，则跳过分配
    followPlayerSleeve ??= 0; // 如果所有袖子都有休克，使用第一个袖子

    for (let i = 0; i < numSleeves; i++) {
        let sleeve = sleeveInfo[i]; // 为了方便，将所有袖子统计/信息合并到一个对象中
        // 管理袖子增强（如果可用）
        if (sleeve.shock == 0) // 在休克为0之前，没有可用的增强
            budget -= await manageSleeveAugs(ns, i, budget);

        // 决定我们认为袖子在接下来的短时间内应该做什么
        let [designatedTask, command, args, statusUpdate] =
            await pickSleeveTask(ns, playerInfo, playerWorkInfo, i, sleeve, canTrain);

        // 在挑选袖子任务后，记录袖子在上一个循环结束时的健康状况，以便检测失败
        [lastSleeveHp[i], lastSleeveShock[i]] = [sleeve.hp.current, sleeve.shock];

        // 如果袖子的新任务与它们已经在做的不同，则设置袖子的新任务。
        let assignSuccess = undefined;
        if (task[i] != designatedTask)
            assignSuccess = await setSleeveTask(ns, i, designatedTask, command, args);

        // 对于某些任务，记录定期状态更新。
        if (statusUpdate && (assignSuccess === true || (
            assignSuccess === undefined && (Date.now() - (lastStatusUpdateTime[i] ?? 0)) > statusUpdateInterval))) {
            log(ns, `信息：袖子 ${i} 正在 ${assignSuccess === undefined ? '(仍然) ' : ''}${statusUpdate} `);
            lastStatusUpdateTime[i] = Date.now();
        }
    }
}

/** 为袖子挑选最佳任务，并返回分配和提供该任务状态更新的信息。
 * @param {NS} ns
 * @param {Player} playerInfo
 * @param {{ type: "COMPANY"|"FACTION"|"CLASS"|"CRIME", cyclesWorked: number, crimeType: string, classType: string, location: string, companyName: string, factionName: string, factionWorkType: string }} playerWorkInfo
 * @param {SleevePerson} sleeve
 * @returns {Promise<[string, string, any[], string]>} 任务名称、命令、参数和状态消息的4元组 */
async function pickSleeveTask(ns, playerInfo, playerWorkInfo, i, sleeve, canTrain) {
    // 在第一次循环时初始化袖子字典
    if (lastSleeveHp[i] === undefined) lastSleeveHp[i] = sleeve.hp.current;
    if (lastSleeveShock[i] === undefined) lastSleeveShock[i] = sleeve.shock;
    // 如果尚未在每个袖子上最大化内存，则必须同步
    if (sleeve.sync < 100)
        return ["synchronize", `ns.sleeve.setToSynchronize(ns.args[0])`, [i], `同步中... ${sleeve.sync.toFixed(2)}%`];
    // 如果超过--min-shock-recovery阈值，选择休克恢复
    if (sleeve.shock > options['min-shock-recovery'])
        return shockRecoveryTask(sleeve, i, `休克超过 ${options['min-shock-recovery'].toFixed(0)}% (--min-shock-recovery)`);
    // 为了在有用和更快恢复休克之间进行时间平衡 - 袖子有随机机会被置于休克恢复。为了避免频繁中断需要一段时间才能完成的任务，只每隔一段时间重新滚动一次。
    if (sleeve.shock > 0 && options['shock-recovery'] > 0) {
        if (Date.now() - (lastRerollTime[i] || 0) < rerollTime) {
            shockChance[i] = Math.random();
            lastRerollTime[i] = Date.now();
        }
        if (shockChance[i] < options['shock-recovery'])
            return shockRecoveryTask(sleeve, i, `每分钟有 ${(options['shock-recovery'] * 100).toFixed(1)}% 的机会 (--shock-recovery) 选择此任务，直到完全恢复。`);
    }
    // 如果我们的袖子体力统计数据未达到我们的要求，则进行训练
    if (canTrain) {
        const univClasses = {
            "hacking": ns.enums.UniversityClassType.algorithms,
            "charisma": ns.enums.UniversityClassType.leadership
        };
        let untrainedStats = trainStats.filter(stat => sleeve.skills[stat] < options[`train-to-${stat}`]);
        let untrainedSmarts = trainSmarts.filter(smart => sleeve.skills[smart] < options[`study-to-${smart}`]);

        // 优先进行体力训练
        if (untrainedStats.length > 0) {
            if (playerInfo.money < 5E6 && !promptedForTrainingBudget)
                await promptForTrainingBudget(ns); // 如果我们从未检查过，看看我们是否可以训练负债。
            if (sleeve.city != ns.enums.CityName.Sector12) {
                log(ns, `将袖子 ${i} 从 ${sleeve.city} 移动到 Sector-12，以便他们可以在 Powerhouse Gym 学习。`);
                await getNsDataThroughFile(ns, 'ns.sleeve.travel(ns.args[0], ns.args[1])', null, [i, ns.enums.CityName.Sector12]);
            }
            var trainStat = untrainedStats.reduce((min, s) => sleeve.skills[s] < sleeve.skills[min] ? s : min, untrainedStats[0]);
            var gym = ns.enums.LocationName.Sector12PowerhouseGym;
            return [`训练 ${trainStat} (${gym})`, `ns.sleeve.setToGymWorkout(ns.args[0], ns.args[1], ns.args[2})`, [i, gym, trainStat],
            /*   */ `训练 ${trainStat}... ${sleeve.skills[trainStat]}/${(options[`train-to-${trainStat}`])}`];
            // 如果我们足够强壮，转而学习以提高心理统计数据
        } else if (untrainedSmarts.length > 0) {
            if (playerInfo.money < 5E6 && !promptedForTrainingBudget)
                await promptForTrainingBudget(ns); // 检查我们是否可以训练负债
            if (sleeve.city != ns.enums.CityName.Volhaven) {
                log(ns, `将袖子 ${i} 从 ${sleeve.city} 移动到 Volhaven，以便他们可以在 ZB Institute 学习。`);
                await getNsDataThroughFile(ns, 'ns.sleeve.travel(ns.args[0], ns.args[1])', null, [i, ns.enums.CityName.Volhaven]);
            }
            var trainSmart = untrainedSmarts.reduce((min, s) => sleeve.skills[s] < sleeve.skills[min] ? s : min, untrainedSmarts[0]);
            var univ = ns.enums.LocationName.VolhavenZBInstituteOfTechnology;
            var course = univClasses[trainSmart];
            return [`学习 ${trainSmart} (${univ})`, `ns.sleeve.setToUniversityCourse(ns.args[0], ns.args[1], ns.args[2})`, [i, univ, course],
            /*   */ `学习 ${trainSmart}... ${sleeve.skills[trainSmart]}/${(options[`study-to-${trainSmart}`])}`];
        }
    }
    // 如果玩家当前正在为派系或公司声望工作，袖子可以帮助他（注意：只有一个袖子可以为派系工作）
    if (i == followPlayerSleeve && playerWorkInfo.type == "FACTION") {
        // TODO: 我们应该能够从work-for-factions.js中借用逻辑，让更多袖子为有用的派系/公司工作
        // 我们将循环工作类型，直到找到支持的类型。TODO: 自动确定最有成效的派系工作。
        const faction = playerWorkInfo.factionName;
        const work = works[workByFaction[faction] || 0];
        return [`为派系 '${faction}' 工作 (${work})`, `ns.sleeve.setToFactionWork(ns.args[0], ns.args[1], ns.args[2})`, [i, faction, work],
        /*   */ `通过做 ${work} 工作帮助获得派系 ${faction} 的声望。`];
    } // 如果玩家当前正在为大型公司工作，同上
    if (i == followPlayerSleeve && playerWorkInfo.type == "COMPANY") {
        const companyName = playerWorkInfo.companyName;
        return [`为公司 '${companyName}' 工作`, `ns.sleeve.setToCompanyWork(ns.args[0], ns.args[1})`, [i, companyName],
        /*   */ `帮助获得公司 ${companyName} 的声望。`];
    }
    // 如果帮派可用，优先进行杀人，直到我们获得解锁所需的-54K karma
    if (!playerInGang && !options['disable-gang-homicide-priority'] && (2 in ownedSourceFiles) && ns.heart.break() > -54000)
        return await crimeTask(ns, 'homicide', i, sleeve, '我们想要帮派karma'); // 忽略机会 - 即使失败的杀人也会比其他犯罪生成更多的Karma
    // 如果玩家在刀锋燃烧者中，并且已经用Karma解锁了帮派，生成合同和操作
    if (playerInBladeburner) {
        // 黑客：在不关注刀锋燃烧器中发生的情况的情况下，通过袖子索引预先分配各种任务
        const bbTasks = [
            // 注意：袖子0可能仍用于派系工作（除非设置了--disable-follow-player），因此不要为它们分配“独特”任务
            /*0*/options['enable-bladeburner-team-building'] ? ["支持主袖子"] : ["渗透合成人"],
            // 注意：每种合同类型只能由一个袖子同时执行（类似于为派系工作）
            /*1*/["接受合同", "Retirement"], /*2*/["接受合同", "Bounty Hunter"], /*3*/["接受合同", "Tracking"],
            // 其他刀锋燃烧者工作可以重复，但处理各种可能是有用的。下面会发生覆盖
            /*4*/["渗透合成人"], /*5*/["外交"], /*6*/["现场分析"],
            /*7*/options['enable-bladeburner-team-building'] ? ["招募"] : ["渗透合成人"]
        ];
        let [action, contractName] = bbTasks[i];
        const contractChance = bladeburnerContractChances[contractName] ?? 1;
        const contractCount = bladeburnerContractCounts[contractName] ?? Infinity;
        const onCooldown = () => Date.now() <= bladeburnerCooldown[i]; // 检查我们是否在冷却中的函数
        // 检测袖子最近是否失败了任务。如果是，在再次尝试之前将它们置于“冷却”状态
        if (sleeve.hp.current < lastSleeveHp[i] || sleeve.shock > lastSleeveShock[i]) {
            bladeburnerCooldown[i] = Date.now() + options['failed-bladeburner-contract-cooldown'];
            log(ns, `袖子 ${i} 似乎最近失败了其指定的刀锋燃烧者任务 '${action} - ${contractName}' ` +
                `(HP ${lastSleeveHp[i].toFixed(1)} -> ${sleeve.hp.current.toFixed(1)}, ` +
                `休克: ${lastSleeveShock[i].toFixed(2)} -> ${sleeve.shock.toFixed(2)}). ` +
                `将在 ${formatDuration(options['failed-bladeburner-contract-cooldown'])} 后再次尝试`);
        } // 如果合同成功机会似乎太低，或者剩余的合同不足，较小的冷却时间
        else if (!onCooldown() && (contractChance <= minBbProbability || contractCount < minBbContracts)) {
            bladeburnerCooldown[i] = Date.now() + waitForContractCooldown;
            log(ns, `延迟袖子 ${i} 指定的刀锋燃烧者任务 '${action} - ${contractName}' - ` +
                (contractCount < minBbContracts ? `合同数量不足 (${contractCount} < ${minBbContracts})` :
                    `玩家机会太低 (${(contractChance * 100).toFixed(2)}% < ${(minBbProbability * 100)}%). `) +
                `将在 ${formatDuration(waitForContractCooldown)} 后再次尝试`);
        }
        // 随着当前城市混乱逐渐恶化，分配越来越多的袖子进行外交以帮助控制它
        if (bladeburnerCityChaos > (10 - i) * 10) // 后面的袖子首先被分配，袖子0在100混乱时最后。
            [action, contractName] = ["外交"];
        // 如果袖子在冷却中，不要执行其指定的刀锋燃烧者任务
        else if (onCooldown()) { // 当任务失败后处于冷却中时，如果适用，恢复休克，否则添加合同
            if (sleeve.shock > 0) return shockRecoveryTask(sleeve, i, `刀锋燃烧者任务在冷却中`);
            [action, contractName] = ["渗透合成人"]; // 回退到一些长期有用的东西
        }
        return [`刀锋燃烧者 ${action} ${contractName || ''}`.trimEnd(),
        /*   */ `ns.sleeve.setToBladeburnerAction(ns.args[0], ns.args[1], ns.args[2})`, [i, action, contractName ?? ''],
        /*   */ `在刀锋燃烧者中做 ${action}${contractName ? ` - ${contractName}` : ''}。`];
    }
    // 如果没有更有成效的事情可做（上面）并且仍然有休克，优先恢复
    if (sleeve.shock > 0)
        return shockRecoveryTask(sleeve, i, `似乎没有更好的事情可做`);
    // 最后，为Karma犯罪。根据成功机会选择最佳犯罪
    var crime = options.crime || (await calculateCrimeChance(ns, sleeve, "Homicide")) >= options['homicide-chance-threshold'] ? 'Homicide' : 'Mug';
    return await crimeTask(ns, crime, i, sleeve, `似乎没有更好的事情可做`);
}

/** 帮助准备休克恢复任务
 * @param {SleevePerson} sleeve */
function shockRecoveryTask(sleeve, i, reason) {
    return [`从休克中恢复`, `ns.sleeve.setToShockRecovery(ns.args[0})`, [i],
    /*   */ `从休克中恢复 (${sleeve.shock.toFixed(2)}%) 因为 ${reason}...`];
}

/** 帮助准备犯罪任务
 * @param {NS} ns
 * @param {SleevePerson} sleeve
 * @returns {Promise<[string, string, any[], string]>} 任务名称、命令、参数和状态消息的4元组 */
async function crimeTask(ns, crime, i, sleeve, reason) {
    const successChance = await calculateCrimeChance(ns, sleeve, crime);
    return [`犯罪 ${crime}`, `ns.sleeve.setToCommitCrime(ns.args[0], ns.args[1})`, [i, crime],
    /*   */ `犯罪 ${crime} 成功机会 ${(successChance * 100).toFixed(2)}% 因为 ${reason}` +
    /*   */ (options.crime || crime == "Homicide" ? '' : // 如果自动犯罪，用户可能想知道我们离切换到杀人有多近
    /*   */     ` (注意：杀人机会将是 ${((await calculateCrimeChance(ns, sleeve, "Homicide")) * 100).toFixed(2)}%)`)];
}


/** 将袖子设置为其指定的任务，并为派系工作添加一些额外的错误处理逻辑。
 * @param {NS} ns
 * @param {number} i - 袖子编号
 * @param {string} designatedTask - 描述指定任务的字符串
 * @param {string} command - 启动此工作的动态命令
 * @param {any[]} args - 动态命令消耗的参数
 * */
async function setSleeveTask(ns, i, designatedTask, command, args) {
    let strAction = `将袖子 ${i} 设置为 ${designatedTask}`;
    try { // 分配任务可能会抛出错误，而不是简单地返回false。我们必须抑制这一点
        if (await getNsDataThroughFile(ns, command, `/Temp/sleeve-${command.slice(10, command.indexOf("("))}.txt`, args)) {
            task[i] = designatedTask;
            log(ns, `成功：${strAction}`);
            return true;
        }
    } catch { }
    // 如果分配任务失败...
    lastRerollTime[i] = 0;
    // 如果为派系工作，可能当前工作不受支持，所以尝试下一个。
    if (designatedTask.startsWith('work for faction')) {
        const faction = args[1]; // 黑客：不明显，但在这种情况下，第二个参数将是派系名称。
        let nextWorkIndex = (workByFaction[faction] || 0) + 1;
        if (nextWorkIndex >= works.length) {
            log(ns, `警告：未能 ${strAction}。${works.length} 种工作类型似乎都不受支持。将循环并再次尝试。`, true, 'warning');
            nextWorkIndex = 0;
        } else
            log(ns, `信息：未能 ${strAction} - 工作类型可能不受支持。尝试下一个工作类型 (${works[nextWorkIndex]})`);
        workByFaction[faction] = nextWorkIndex;
    } else if (designatedTask.startsWith('Bladeburner')) { // 刀锋燃烧者操作可能没有操作了
        bladeburnerCooldown[i] = Date.now(); // 在此任务再次分配之前将有一个冷却时间。
    } else
        log(ns, `错误：未能 ${strAction}`, true, 'error');
    return false;
}

let promptedForTrainingBudget = false;
/** @param {NS} ns
 * 当我们在训练袖子时有可能负债时。
 * 包含一些花哨的逻辑，以生成一个外部脚本，提示用户并等待答案。 */
async function promptForTrainingBudget(ns) {
    if (promptedForTrainingBudget) return;
    promptedForTrainingBudget = true;
    await ns.write(trainingReserveFile, '', "w");
    if (options['training-reserve'] === null && !options['disable-training'])
        await runCommand(ns, `let ans = await ns.prompt("您是否希望袖子在训练时让您负债？"); \n` +
            `await ns.write("${trainingReserveFile}", ans ? '-1E100' : '0', "w")`, '/Temp/sleeves-training-reserve-prompt.js');
}

/** @param {NS} ns
 * @param {SleevePerson} sleeve
 * 计算袖子成功杀人的机会。 */
async function calculateCrimeChance(ns, sleeve, crimeName) {
    // 如果不在缓存中，检索此犯罪的统计数据
    const crimeStats = cachedCrimeStats[crimeName] ?? (cachedCrimeStats[crimeName] = (4 in ownedSourceFiles ?
        await getNsDataThroughFile(ns, `ns.singularity.getCrimeStats(ns.args[0])`, null, [crimeName]) :
        // 黑客：为了支持没有SF4的玩家，硬编码当前版本的值
        crimeName == "Homicide" ? { difficulty: 1, strength_success_weight: 2, defense_success_weight: 2, dexterity_success_weight: 0.5, agility_success_weight: 0.5 } :
            crimeName == "Mug" ? { difficulty: 0.2, strength_success_weight: 1.5, defense_success_weight: 0.5, dexterity_success_weight: 1.5, agility_success_weight: 0.5, } :
                undefined));
    let chance =
        (crimeStats.hacking_success_weight || 0) * sleeve.skills.hacking +
        (crimeStats.strength_success_weight || 0) * sleeve.skills.strength +
        (crimeStats.defense_success_weight || 0) * sleeve.skills.defense +
        (crimeStats.dexterity_success_weight || 0) * sleeve.skills.dexterity +
        (crimeStats.agility_success_weight || 0) * sleeve.skills.agility +
        (crimeStats.charisma_success_weight || 0) * sleeve.skills.charisma;
    chance /= 975;
    chance /= crimeStats.difficulty;
    return Math.min(chance, 1);
}
