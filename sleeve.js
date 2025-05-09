import { log, getConfiguration, instanceCount, disableLogs, getActiveSourceFiles, getNsDataThroughFile, runCommand, formatMoney, formatDuration } from './helpers.js'

const argsSchema = [
    ['min-shock-recovery', 97], // 在尝试训练或犯罪前的最小休克恢复值（设为100禁用，0表示完全恢复）
    ['shock-recovery', 0.05], // 设置0-1之间的数值，将相应比例时间用于定期休克恢复（直到休克值为0）
    ['crime', null], // 如果指定，分身将只进行此犯罪类型，无论属性如何
    ['homicide-chance-threshold', 0.5], // 当分身犯罪成功率超过此阈值时自动开始凶杀
    ['disable-gang-homicide-priority', false], // 默认分身会进行凶杀获取业力直到加入帮派，设置此标志禁用该优先级
    ['aug-budget', 0.1], // 每周期花费当前现金的比例用于增强件（默认较高，因为这些是永久的）
    ['buy-cooldown', 60 * 1000], // 购买更多增强件前必须等待的毫秒数
    ['min-aug-batch', 20], // 触发购买前至少能负担的增强件数量（或剩余全部可购买时更少数量）
    ['reserve', null], // 在确定预算前保留的现金（未指定时默认为reserve.txt内容）
    ['disable-follow-player', false], // 设为true禁用0号分身跟随玩家提升派系/公司声望获取率
    ['disable-training', false], // 设为true禁用分身在健身房训练（需要花钱）
    ['train-to-strength', 105], // 分身将训练力量直到达到此值
    ['train-to-defense', 105], // 分身将训练防御直到达到此值
    ['train-to-dexterity', 70], // 分身将训练敏捷直到达到此值
    ['train-to-agility', 70], // 分身将训练灵巧直到达到此值
    ['study-to-hacking', 25], // 分身将学习黑客技能直到达到此值
    ['study-to-charisma', 25], // 分身将学习魅力技能直到达到此值
    ['training-reserve', null], // 默认为全局reserve.txt。可设为负数允许负债。当资金低于此值时分身不训练
    ['training-cap-seconds', 2 * 60 * 60 /* 2小时 */], // 比特节点开始后经过此时间将不再尝试训练分身到目标属性
    ['disable-spending-hashes-for-gym-upgrades', false], // 设为true禁用花费哈希升级健身房训练效率
    ['disable-spending-hashes-for-study-upgrades', false], // 设为true禁用花费哈希升级学习效率
    ['enable-bladeburner-team-building', false], // 设为true让一个分身支持主分身，另一个进行招募。否则只进行"渗透合成体"
    ['disable-bladeburner', false], // 设为true禁用分身在刀锋燃烧者活动
    ['failed-bladeburner-contract-cooldown', 30 * 60 * 1000], // 默认30分钟：合同失败后重试前的等待时间
];

const interval = 1000; // 检查分身状态和重新计算理想任务的间隔（毫秒）
const rerollTime = 61000; // 每个分身随机进入休克恢复状态的间隔时间
const statusUpdateInterval = 10 * 60 * 1000; // 即使任务未变也定期记录状态的时间间隔
const trainingReserveFile = '/Temp/sleeves-training-reserve.txt';
const works = ['security', 'field', 'hacking']; // 进行派系工作时优先体力工作（分身通常这些属性更高）
const trainStats = ['strength', 'defense', 'dexterity', 'agility'];
const trainSmarts = ['hacking', 'charisma'];
const sleeveBbContractNames = ["Tracking", "Bounty Hunter", "Retirement"];
const minBbContracts = 2; // 剩余合同数低于此值时分身不再尝试
const minBbProbability = 0.99; // 玩家成功率需高于此值分身才尝试合同
const waitForContractCooldown = 60 * 1000; // 当合同数或概率过低时的冷却时间（1分钟）

let cachedCrimeStats, workByFaction; // 犯罪统计缓存和派系支持的工作类型
let task, lastStatusUpdateTime, lastPurchaseTime, lastPurchaseStatusUpdate, availableAugs, cacheExpiry,
    shockChance, lastRerollTime, bladeburnerCooldown, lastSleeveHp, lastSleeveShock; // 每个分身的状态
let numSleeves, ownedSourceFiles, playerInGang, playerInBladeburner, bladeburnerCityChaos, bladeburnerContractChances, bladeburnerContractCounts, followPlayerSleeve;
let options;

export function autocomplete(data, _) {
    data.flags(argsSchema);
    return [];
}

/** @param {NS} ns **/
export async function main(ns) {
    const runOptions = getConfiguration(ns, argsSchema);
    if (!runOptions || await instanceCount(ns) > 1) return; // 防止多个实例运行
    options = runOptions; // 确保全局options唯一
    disableLogs(ns, ['getServerMoneyAvailable']);
    // 重置全局状态（例如进入新比特节点后）
    task = [], lastStatusUpdateTime = [], lastPurchaseTime = [], lastPurchaseStatusUpdate = [], availableAugs = [],
        cacheExpiry = [], shockChance = [], lastRerollTime = [], bladeburnerCooldown = [], lastSleeveHp = [], lastSleeveShock = [];
    workByFaction = {}, cachedCrimeStats = {};
    playerInGang = playerInBladeburner = false;
    // 确保有分身访问权限
    ownedSourceFiles = await getActiveSourceFiles(ns);
    if (!(10 in ownedSourceFiles))
        return ns.tprint("警告：完成BN10前无法运行sleeve.js");
    // 主循环开始
    while (true) {
        try { await mainLoop(ns); }
        catch (err) {
            log(ns, `警告：sleeve.js在主循环捕获意外错误：\n` +
                (err?.stack || '') + (typeof err === 'string' ? err : err.message || JSON.stringify(err)), false, 'warning');
        }
        await ns.sleep(interval);
    }
}

/** 购买分身增强件 */
async function manageSleeveAugs(ns, i, budget) {
    if (availableAugs[i] == null || Date.now() > cacheExpiry[i]) {
        cacheExpiry[i] = Date.now() + 60000;
        availableAugs[i] = (await getNsDataThroughFile(ns, `ns.sleeve.getSleevePurchasableAugs(ns.args[0])`,  
            null, [i])).sort((a, b) => a.cost - b.cost);
    }
    if (availableAugs[i].length == 0) return 0;

    const cooldownLeft = Math.max(0, options['buy-cooldown'] - (Date.now() - (lastPurchaseTime[i] || 0)));
    const [batchCount, batchCost] = availableAugs[i].reduce(([n, c], aug) => c + aug.cost <= budget ? [n + 1, c + aug.cost] : [n, c], [0, 0]);
    const purchaseUpdate = `分身${i}可购买${batchCount.toFixed(0).padStart(2)}/${availableAugs[i].length.toFixed(0).padEnd(2)}个增强件 ` +
        `(花费${formatMoney(batchCost)}，总需${formatMoney(availableAugs[i].reduce((t, aug) => t + aug.cost, 0))})`;
    if (lastPurchaseStatusUpdate[i] != purchaseUpdate)
        log(ns, `信息：预算${formatMoney(budget)}，${(lastPurchaseStatusUpdate[i] = purchaseUpdate)} ` +
            `(最小批量：${options['min-aug-batch']}，冷却：${formatDuration(cooldownLeft)})`);
    if (cooldownLeft == 0 && batchCount > 0 && ((batchCount >= availableAugs[i].length - 1) || batchCount >= options['min-aug-batch'])) {
        let strAction = `为分身${i}购买${batchCount}/${availableAugs[i].length}个增强件，总花费${formatMoney(batchCost)}`;
        let toPurchase = availableAugs[i].splice(0, batchCount);
        if (await getNsDataThroughFile(ns, `ns.args.slice(1).reduce((s, aug) => s && ns.sleeve.purchaseSleeveAug(ns.args[0], aug), true)`,
            '/Temp/sleeve-purchase.txt', [i, ...toPurchase.map(a => a.name)])) {
            log(ns, `成功：${strAction}`, true, 'success');
            [lastSleeveHp[i], lastSleeveShock[i]] = [undefined, undefined];
        } else log(ns, `错误：${strAction}失败`, true, 'error');
        lastPurchaseTime[i] = Date.now();
        return batchCost;
    }
    return 0;
}

/** 获取玩家信息 */
async function getPlayerInfo(ns) {
    return await getNsDataThroughFile(ns, `ns.getPlayer()`);
}

/** 获取当前工作信息 */
async function getCurrentWorkInfo(ns) {
    return (await getNsDataThroughFile(ns, 'ns.singularity.getCurrentWork()')) ?? {};
}

/** 获取所有分身信息 */
async function getAllSleeves(ns, numSleeves) {
    return await getNsDataThroughFile(ns, `ns.args.map(i => ns.sleeve.getSleeve(i))`,
        `/Temp/sleeve-getSleeve-all.txt`, [...Array(numSleeves).keys()]);
}

/** 主循环：收集数据、检查并管理所有分身 */
async function mainLoop(ns) {
    numSleeves = await getNsDataThroughFile(ns, `ns.sleeve.getNumSleeves()`);
    const playerInfo = await getPlayerInfo(ns);
    if (!options['disable-bladeburner'] && !playerInBladeburner)
        playerInBladeburner = await getNsDataThroughFile(ns, 'ns.bladeburner.inBladeburner()');
    const playerWorkInfo = await getCurrentWorkInfo(ns);
    if (!playerInGang) playerInGang = !(2 in ownedSourceFiles) ? false : await getNsDataThroughFile(ns, 'ns.gang.inGang()');
    let globalReserve = Number(ns.read("reserve.txt") || 0);
    let budget = (playerInfo.money - (options['reserve'] || globalReserve)) * options['aug-budget'];
    const costByNextLoop = interval / 1000 * task.filter(t => t.startsWith("train")).length * 12000;
    const timeInBitnode = Date.now() - (await getNsDataThroughFile(ns, 'ns.getResetInfo()')).lastNodeReset
    let canTrain = !options['disable-training'] &&
        (options['training-cap-seconds'] * 1000 > timeInBitnode) &&
        (playerInfo.money - costByNextLoop) > (options['training-reserve'] ||
            (promptedForTrainingBudget ? ns.read(trainingReserveFile) : undefined) || globalReserve);
    if (canTrain && task.some(t => t?.startsWith("train")) && !options['disable-spending-hashes-for-gym-upgrades'])
        if (await getNsDataThroughFile(ns, 'ns.hacknet.spendHashes("Improve Gym Training")', '/Temp/spend-hashes-on-gym.txt'))
            log(ns, `成功：购买"健身房训练提升"加速分身训练`, false, 'success');
    if (canTrain && task.some(t => t?.startsWith("study")) && !options['disable-spending-hashes-for-study-upgrades'])
        if (await getNsDataThroughFile(ns, 'ns.hacknet.spendHashes("Improve Studying")', '/Temp/spend-hashes-on-study.txt'))
            log(ns, `成功：购买"学习提升"加速分身学习`, false, 'success');
    if (playerInBladeburner && (7 in ownedSourceFiles)) {
        const bladeburnerCity = await getNsDataThroughFile(ns, `ns.bladeburner.getCity()`);
        bladeburnerCityChaos = await getNsDataThroughFile(ns, `ns.bladeburner.getCityChaos(ns.args[0])`, null, [bladeburnerCity]);
        bladeburnerContractChances = await getNsDataThroughFile(ns,
            'Object.fromEntries(ns.args.map(c => [c, ns.bladeburner.getActionEstimatedSuccessChance("contract", c)[0]]))',
            '/Temp/sleeve-bladeburner-success-chances.txt', sleeveBbContractNames);
        bladeburnerContractCounts = await getNsDataThroughFile(ns,
            'Object.fromEntries(ns.args.map(c => [c, ns.bladeburner.getActionCountRemaining("contract", c)]))',
            '/Temp/sleeve-bladeburner-contract-counts.txt', sleeveBbContractNames);
    } else
        bladeburnerCityChaos = 0, bladeburnerContractChances = {}, bladeburnerContractCounts = {};

    let sleeveInfo = await getAllSleeves(ns, numSleeves);

    followPlayerSleeve = options['disable-follow-player'] ? -1 : undefined;
    for (let i = 0; i < numSleeves; i++)
        if (sleeveInfo[i].shock == 0 && (i < i || i > 3 || !playerInBladeburner))
            followPlayerSleeve ??= i;
    followPlayerSleeve ??= 0;

    for (let i = 0; i < numSleeves; i++) {
        let sleeve = sleeveInfo[i];
        if (sleeve.shock == 0)
            budget -= await manageSleeveAugs(ns, i, budget);

        let [designatedTask, command, args, statusUpdate] =
            await pickSleeveTask(ns, playerInfo, playerWorkInfo, i, sleeve, canTrain);

        [lastSleeveHp[i], lastSleeveShock[i]] = [sleeve.hp.current, sleeve.shock];

        let assignSuccess = undefined;
        if (task[i] != designatedTask)
            assignSuccess = await setSleeveTask(ns, i, designatedTask, command, args);

        if (statusUpdate && (assignSuccess === true || (
            assignSuccess === undefined && (Date.now() - (lastStatusUpdateTime[i] ?? 0)) > statusUpdateInterval))) {
            log(ns, `信息：分身${i} ${assignSuccess === undefined ? '（持续）' : ''}${statusUpdate}`);
            lastStatusUpdateTime[i] = Date.now();
        }
    }
}

/** 为分身选择最佳任务 */
async function pickSleeveTask(ns, playerInfo, playerWorkInfo, i, sleeve, canTrain) {
    if (lastSleeveHp[i] === undefined) lastSleeveHp[i] = sleeve.hp.current;
    if (lastSleeveShock[i] === undefined) lastSleeveShock[i] = sleeve.shock;
    if (sleeve.sync < 100)
        return ["同步中", `ns.sleeve.setToSynchronize(ns.args[0])`, [i], `同步进度：${sleeve.sync.toFixed(2)}%`];
    if (sleeve.shock > options['min-shock-recovery'])
        return shockRecoveryTask(sleeve, i, `休克值高于${options['min-shock-recovery'].toFixed(0)}% (--min-shock-recovery)`);
    if (sleeve.shock > 0 && options['shock-recovery'] > 0) {
        if (Date.now() - (lastRerollTime[i] || 0) < rerollTime) {
            shockChance[i] = Math.random();
            lastRerollTime[i] = Date.now();
        }
        if (shockChance[i] < options['shock-recovery'])
            return shockRecoveryTask(sleeve, i, `每分钟有${(options['shock-recovery'] * 100).toFixed(1)}%概率(--shock-recovery)选择此任务直到完全恢复`);
    }
    if (canTrain) {
        const univClasses = {
            "hacking": ns.enums.UniversityClassType.algorithms,
            "charisma": ns.enums.UniversityClassType.leadership
        };
        let untrainedStats = trainStats.filter(stat => sleeve.skills[stat] < options[`train-to-${stat}`]);
        let untrainedSmarts = trainSmarts.filter(smart => sleeve.skills[smart] < options[`study-to-${smart}`]);

        if (untrainedStats.length > 0) {
            if (playerInfo.money < 5E6 && !promptedForTrainingBudget)
                await promptForTrainingBudget(ns);
            if (sleeve.city != ns.enums.CityName.Sector12) {
                log(ns, `移动分身${i}从${sleeve.city}到Sector-12以便在Powerhouse Gym训练`);
                await getNsDataThroughFile(ns, 'ns.sleeve.travel(ns.args[0], ns.args[1])', null, [i, ns.enums.CityName.Sector12]);
            }
            var trainStat = untrainedStats.reduce((min, s) => sleeve.skills[s] < sleeve.skills[min] ? s : min, untrainedStats[0]);
            var gym = ns.enums.LocationName.Sector12PowerhouseGym;
            return [`训练${trainStat} (${gym})`, `ns.sleeve.setToGymWorkout(ns.args[0], ns.args[1], ns.args[2])`, [i, gym, trainStat],
            /*   */ `训练${trainStat}中... ${sleeve.skills[trainStat]}/${(options[`train-to-${trainStat}`])}`];
        } else if (untrainedSmarts.length > 0) {
            if (playerInfo.money < 5E6 && !promptedForTrainingBudget)
                await promptForTrainingBudget(ns);
            if (sleeve.city != ns.enums.CityName.Volhaven) {
                log(ns, `移动分身${i}从${sleeve.city}到Volhaven以便在ZB Institute学习`);
                await getNsDataThroughFile(ns, 'ns.sleeve.travel(ns.args[0], ns.args[1])', null, [i, ns.enums.CityName.Volhaven]);
            }
            var trainSmart = untrainedSmarts.reduce((min, s) => sleeve.skills[s] < sleeve.skills[min] ? s : min, untrainedSmarts[0]);
            var univ = ns.enums.LocationName.VolhavenZBInstituteOfTechnology;
            var course = univClasses[trainSmart];
            return [`学习${trainSmart} (${univ})`, `ns.sleeve.setToUniversityCourse(ns.args[0], ns.args[1], ns.args[2])`, [i, univ, course],
            /*   */ `学习${trainSmart}中... ${sleeve.skills[trainSmart]}/${(options[`study-to-${trainSmart}`])}`];
        }
    }
    if (i == followPlayerSleeve && playerWorkInfo.type == "FACTION") {
        const faction = playerWorkInfo.factionName;
        const work = works[workByFaction[faction] || 0];
        return [`为派系'${faction}'工作 (${work})`, `ns.sleeve.setToFactionWork(ns.args[0], ns.args[1], ns.args[2])`, [i, faction, work],
        /*   */ `通过${work}工作帮助获取${faction}派系声望`];
    }
    if (i == followPlayerSleeve && playerWorkInfo.type == "COMPANY") {
        const companyName = playerWorkInfo.companyName;
        return [`为公司'${companyName}'工作`, `ns.sleeve.setToCompanyWork(ns.args[0], ns.args[1])`, [i, companyName],
        /*   */ `帮助获取${companyName}公司声望`];
    }
    if (!playerInGang && !options['disable-gang-homicide-priority'] && (2 in ownedSourceFiles) && ns.heart.break() > -54000)
        return await crimeTask(ns, 'homicide', i, sleeve, '需要帮派业力');
    if (playerInBladeburner) {
        const bbTasks = [
            /*0*/options['enable-bladeburner-team-building'] ? ["Support main sleeve"] : ["Infiltrate synthoids"],
            /*1*/["Take on contracts", "Retirement"], /*2*/["Take on contracts", "Bounty Hunter"], /*3*/["Take on contracts", "Tracking"],
            /*4*/["Infiltrate synthoids"], /*5*/["Diplomacy"], /*6*/["Field analysis"],
            /*7*/options['enable-bladeburner-team-building'] ? ["Recruitment"] : ["Infiltrate synthoids"]
        ];
        let [action, contractName] = bbTasks[i];
        const contractChance = bladeburnerContractChances[contractName] ?? 1;
        const contractCount = bladeburnerContractCounts[contractName] ?? Infinity;
        const onCooldown = () => Date.now() <= bladeburnerCooldown[i];
        if (sleeve.hp.current < lastSleeveHp[i] || sleeve.shock > lastSleeveShock[i]) {
            bladeburnerCooldown[i] = Date.now() + options['failed-bladeburner-contract-cooldown'];
            log(ns, `分身${i}执行刀锋燃烧者任务'${action} - ${contractName}'失败 ` +
                `(HP ${lastSleeveHp[i].toFixed(1)} -> ${sleeve.hp.current.toFixed(1)}, ` +
                `休克: ${lastSleeveShock[i].toFixed(2)} -> ${sleeve.shock.toFixed(2)})。 ` +
                `${formatDuration(options['failed-bladeburner-contract-cooldown'])}后重试`);
        }
        else if (!onCooldown() && (contractChance <= minBbProbability || contractCount < minBbContracts)) {
            bladeburnerCooldown[i] = Date.now() + waitForContractCooldown;
            log(ns, `延迟分身${i}刀锋燃烧者任务'${action} - ${contractName}' - ` +
                (contractCount < minBbContracts ? `合同数不足 (${contractCount} < ${minBbContracts})` :
                    `玩家成功率过低 (${(contractChance * 100).toFixed(2)}% < ${(minBbProbability * 100)}%)`) +
                `，${formatDuration(waitForContractCooldown)}后重试`);
        }
        if (bladeburnerCityChaos > (10 - i) * 10)
            [action, contractName] = ["Diplomacy"];
        else if (onCooldown()) {
            if (sleeve.shock > 0) return shockRecoveryTask(sleeve, i, `刀锋燃烧者任务冷却中`);
            [action, contractName] = ["Infiltrate synthoids"];
        }
        return [`Bladeburner ${action} ${contractName || ''}`.trimEnd(),
        /*   */ `ns.sleeve.setToBladeburnerAction(ns.args[0], ns.args[1], ns.args[2])`, [i, action, contractName ?? ''],
        /*   */ `doing ${action}${contractName ? ` - ${contractName}` : ''} in Bladeburner.`];
    }
    if (sleeve.shock > 0)
        return shockRecoveryTask(sleeve, i, `没有更合适的任务`);
    var crime = options.crime || (await calculateCrimeChance(ns, sleeve, "homicide")) >= options['homicide-chance-threshold'] ? 'homicide' : 'mug';
    return await crimeTask(ns, crime, i, sleeve, `没有更合适的任务`);
}

/** 休克恢复任务 */
function shockRecoveryTask(sleeve, i, reason) {
    return [`shock recovery`, `ns.sleeve.setToShockRecovery(ns.args[0])`, [i],
    /*   */ `休克恢复中 (当前${sleeve.shock.toFixed(2)}%)，原因：${reason}`];
}

/** 犯罪任务 */
async function crimeTask(ns, crime, i, sleeve, reason) {
    const successChance = await calculateCrimeChance(ns, sleeve, crime);
    return [`进行${crime}`, `ns.sleeve.setToCommitCrime(ns.args[0], ns.args[1])`, [i, crime],
    /*   */ `进行${crime}，成功率${(successChance * 100).toFixed(2)}%，原因：${reason}` +
    /*   */ (options.crime || crime == "homicide" ? '' : 
    /*   */     ` (凶杀成功率：${((await calculateCrimeChance(ns, sleeve, "homicide")) * 100).toFixed(2)}%)`)];
}

/** 设置分身任务 */
async function setSleeveTask(ns, i, designatedTask, command, args) {
    let strAction = `设置分身${i}任务为：${designatedTask}`;
    try {
        if (await getNsDataThroughFile(ns, command, `/Temp/sleeve-${command.slice(10, command.indexOf("("))}.txt`, args)) {
            task[i] = designatedTask;
            log(ns, `成功：${strAction}`);
            return true;
        }
    } catch { }
    lastRerollTime[i] = 0;
    if (designatedTask.startsWith('work for faction')) {
        const faction = args[1];
        let nextWorkIndex = (workByFaction[faction] || 0) + 1;
        if (nextWorkIndex >= works.length) {
            log(ns, `警告：${strAction}失败，无支持的工作类型，将循环重试`, true, 'warning');
            nextWorkIndex = 0;
        } else
            log(ns, `信息：${strAction}失败 - 工作类型可能不支持，尝试下个类型：${works[nextWorkIndex]}`);
        workByFaction[faction] = nextWorkIndex;
    } else if (designatedTask.startsWith('Bladeburner')) {
        bladeburnerCooldown[i] = Date.now();
    } else
        log(ns, `错误：${strAction}失败`, true, 'error');
    return false;
}

let promptedForTrainingBudget = false;
/** 训练预算提示 */
async function promptForTrainingBudget(ns) {
    if (promptedForTrainingBudget) return;
    promptedForTrainingBudget = true;
    await ns.write(trainingReserveFile, '', "w");
    if (options['training-reserve'] === null && !options['disable-training'])
        await runCommand(ns, `let ans = await ns.prompt("是否允许分身训练时负债？"); \n` +
            `await ns.write("${trainingReserveFile}", ans ? '-1E100' : '0', "w")`, '/Temp/sleeves-training-reserve-prompt.js');
}

/** 计算犯罪成功率 */
async function calculateCrimeChance(ns, sleeve, crimeName) {
    const crimeStats = cachedCrimeStats[crimeName] ?? (cachedCrimeStats[crimeName] = (4 in ownedSourceFiles ?
        await getNsDataThroughFile(ns, `ns.singularity.getCrimeStats(ns.args[0])`, null, [crimeName]) :
        crimeName == "homicide" ? { difficulty: 1, strength_success_weight: 2, defense_success_weight: 2, dexterity_success_weight: 0.5, agility_success_weight: 0.5 } :
            crimeName == "mug" ? { difficulty: 0.2, strength_success_weight: 1.5, defense_success_weight: 0.5, dexterity_success_weight: 1.5, agility_success_weight: 0.5, } :
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
