import {
    log, getConfiguration, getFilePath, runCommand, waitForProcessToComplete, getNsDataThroughFile,
    getActiveSourceFiles, getStockSymbols
} from './helpers.js'

const argsSchema = [
    ['install-augmentations', false], // 默认只购买不安装增强。设置此标志将进行安装（即重置）
    /* 或 */['reset', false], // 上述标志的别名，功能相同
    ['allow-soft-reset', false], // 设为true时允许软重置（不安装任何增强），用于快速重置刷黑客网络哈希升级
    ['skip-staneks-gift', false], // 默认会在第一次安装前获取Stanek的礼物（BN8除外）。设为true跳过此步骤
    /* 已弃用 */['bypass-stanek-warning', false], // (被上述选项替代) 用于警告未接受Stanek礼物时安装增强
    // 安装增强后启动的脚本（注意：游戏不支持参数传递）
    ['on-reset-script', null], // 默认如果有Stanek礼物则启动`stanek.js`，否则启动`daemon.js`
    ['ticks-to-wait-for-additional-purchases', 10], // 等待10个游戏tick（约2秒）没有新购买后重置
    ['max-wait-time', 60000], // 等待外部脚本完成购买的最大毫秒数
    ['prioritize-home-ram', false], // 设为true时优先升级家庭服务器RAM
    /* 已弃用 */['prioritize-augmentations', true], // (遗留标志，现忽略-保持向后兼容)
];

export function autocomplete(data, args) {
    data.flags(argsSchema);
    const lastFlag = args.length > 1 ? args[args.length - 2] : null;
    if (["--on-reset-script"].includes(lastFlag))
        return data.scripts;
    return [];
}

/** @param {NS} ns 
 * 本脚本用于在重置时执行所有最佳操作（按理想顺序）**/
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    if (!options) return; // 无效选项或帮助模式
    let dictSourceFiles = await getActiveSourceFiles(ns); // 获取用户已解锁的源文件
    if (!(4 in dictSourceFiles))
        return log(ns, "错误：在获得单例访问权限（SF4）前无法自动安装增强", true, 'error');
    ns.disableLog('sleep');
    if (options['prioritize-augmentations'])
        log(ns, "提示：--prioritize-augmentations 标志已弃用，现为默认行为。使用--prioritize-home-ram恢复旧行为")

    // 终止除本脚本外的所有脚本
    let pid = await runCommand(ns, `ns.ps().filter(s => s.filename != ns.args[0]).forEach(s => ns.kill(s.pid));`,
        '/Temp/kill-everything-but.js', [ns.getScriptName()]);
    await waitForProcessToComplete(ns, pid, true);

    // 停止当前行动以停止花钱（如训练）并收集声望（如工作）
    await getNsDataThroughFile(ns, 'ns.singularity.stopAction()');

    // 清除全局储备金
    await ns.write("reserve.txt", 0, "w");

    // 步骤1：清算股票和（SF9）黑客网络哈希
    log(ns, '正在出售股票和哈希...', true, 'info');
    ns.run(getFilePath('spend-hacknet-hashes.js'), 1, '--liquidate');

    // 如果没有股票API访问则跳过
    const hasTixApiAccess = await getNsDataThroughFile(ns, 'ns.stock.hasTIXAPIAccess()');
    if (hasTixApiAccess) {
        const stkSymbols = await getStockSymbols(ns);
        const countOwnedStocks = async () => await getNsDataThroughFile(ns, `ns.args.map(sym => ns.stock.getPosition(sym))` +
            `.reduce((t, stk) => t + (stk[0] + stk[2] > 0 ? 1 : 0), 0)`, '/Temp/owned-stocks.txt', stkSymbols);
        let ownedStocks;
        do {
            log(ns, `提示：正在等待出售${ownedStocks}支持有的股票...`, false, 'info');
            pid = ns.run(getFilePath('stockmaster.js'), 1, '--liquidate');
            if (pid) await waitForProcessToComplete(ns, pid, true);
            else log(ns, `错误：运行"stockmaster.js --liquidate"失败，将重试...`, false, 'true');
            await ns.sleep(1000);
            ownedStocks = await countOwnedStocks();
        } while (ownedStocks > 0);
    }

    // 步骤2：升级家庭服务器RAM（比多买几个增强更重要）
    const spendOnHomeRam = async () => {
        log(ns, '正在尝试升级家庭服务器RAM...', true, 'info');
        pid = ns.run(getFilePath('Tasks/ram-manager.js'), 1, '--reserve', '0', '--budget', '0.8');
        await waitForProcessToComplete(ns, pid, true);
    };
    if (options['prioritize-home-ram']) await spendOnHomeRam();

    // 步骤3：（SF13）Stanek的礼物
    if (13 in dictSourceFiles) {
        let isInBn8 = 8 === (await getNsDataThroughFile(ns, `ns.getResetInfo()`)).currentNode;

        if (options['skip-staneks-gift'])
            log(ns, '提示：已设置--skip-staneks-gift，跳过接受礼物');
        else if (isInBn8) {
            log(ns, '提示：BN8中Stanek礼物无效，自动设置--skip-staneks-gift');
            options['skip-staneks-gift'] = true;
        } else {
            log(ns, '正在接受Stanek的礼物（如果是第一次重置）...', true, 'info');
            const haveStanek = await getNsDataThroughFile(ns, `ns.stanek.acceptGift()`);
            if (haveStanek) log(ns, '提示：已确认获得Stanek礼物', true, 'info');
            else {
                log(ns, '警告：无法获得Stanek礼物（是否手动购买过增强？）', true, 'warning');
                options['skip-staneks-gift'] = true;
            }
        }
    }

    // 步骤4：尽可能购买所需增强
    log(ns, '正在购买增强...', true, 'info');
    const facmanArgs = ['--purchase', '-v'];
    if (options['skip-staneks-gift']) {
        log(ns, '提示：向faction-manager.js发送--ignore-stanek参数')
        facmanArgs.push('--ignore-stanek');
    }
    pid = ns.run(getFilePath('faction-manager.js'), 1, ...facmanArgs);
    await waitForProcessToComplete(ns, pid, true);

    // 检查是否有可安装的增强
    let purchasedAugmentations = await getNsDataThroughFile(ns, 'ns.singularity.getOwnedAugmentations(true)', '/Temp/player-augs-purchased.txt');
    let installedAugmentations = await getNsDataThroughFile(ns, 'ns.singularity.getOwnedAugmentations()', '/Temp/player-augs-installed.txt');
    let noAugsToInstall = purchasedAugmentations.length == installedAugmentations.length;
    if (noAugsToInstall && !options['allow-soft-reset'])
        return log(ns, `错误：没有新购买的增强，使用--allow-soft-reset继续无增强重置`, true, 'error');

    // 步骤2（延迟执行）：如果设置则后置升级家庭RAM
    if (!options['prioritize-home-ram']) await spendOnHomeRam();

    // 步骤5：尝试购买4S数据/API
    log(ns, '正在检查股票市场升级...', true, 'info');
    await getNsDataThroughFile(ns, 'ns.stock.purchaseWseAccount()');
    let hasStockApi = await getNsDataThroughFile(ns, 'ns.stock.purchaseTixApi()');
    if (hasStockApi) {
        await getNsDataThroughFile(ns, 'ns.stock.purchase4SMarketData()');
        await getNsDataThroughFile(ns, 'ns.stock.purchase4SMarketDataTixApi()');
    }

    // 步骤6：（SF10）升级义体
    if (10 in dictSourceFiles) {
        log(ns, '正在尝试升级义体...', true, 'info');
        ns.run(getFilePath('sleeve.js'), 1, '--reserve', '0', '--aug-budget', '1', '--min-aug-batch', '1', '--buy-cooldown', '0', '--disable-training');
        await ns.sleep(500);
    }

    // 步骤7：（SF2）升级帮派装备
    if (2 in dictSourceFiles) {
        log(ns, '正在尝试升级帮派...', true, 'info');
        ns.run(getFilePath('gangs.js'), 1, '--reserve', '0', '--augmentations-budget', '1', '--equipment-budget', '1');
        await ns.sleep(500);
    }

    // 步骤8：升级家庭CPU核心
    log(ns, '正在尝试升级家庭CPU核心...', true, 'info');
    pid = await runCommand(ns, `while(ns.singularity.upgradeHomeCores()); { await ns.sleep(10); }`, '/Temp/upgrade-home-ram.js');
    await waitForProcessToComplete(ns, pid, true);

    // 步骤9：加入所有收到邀请的派系（获取少量智力经验）
    let invites = await getNsDataThroughFile(ns, 'ns.singularity.checkFactionInvitations()');
    if (invites.length > 0) {
        pid = await runCommand(ns, 'ns.args.forEach(f => ns.singularity.joinFaction(f))', '/Temp/join-factions.js', invites);
        await waitForProcessToComplete(ns, pid, true);
    }

    // 步骤10：等待资金停止变动（外部脚本完成购买）
    log(ns, '正在等待购买完成...', true, 'info');
    let money = 0, lastMoney = 0, ticksWithoutPurchases = 0;
    const maxWait = Date.now() + options['max-wait-time'];
    while (ticksWithoutPurchases < options['ticks-to-wait-for-additional-purchases'] && (Date.now() < maxWait)) {
        const start = Date.now();
        const refreshMoney = async () => money =
            await getNsDataThroughFile(ns, `ns.getServerMoneyAvailable(ns.args[0])`, null, ["home"]);
        while ((Date.now() - start <= 200) && lastMoney == await refreshMoney())
            await ns.sleep(10);
        ticksWithoutPurchases = money < lastMoney ? 0 : ticksWithoutPurchases + 1;
        lastMoney = money;
    }

    // 步骤4补充：尝试购买其他可负担的增强
    log(ns, '正在检查是否可购买其他增强...', true, 'info');
    facmanArgs.push('--stat-desired', '_');
    pid = ns.run(getFilePath('faction-manager.js'), 1, ...facmanArgs);
    await waitForProcessToComplete(ns, pid, true);

    // 清理临时文件夹
    await waitForProcessToComplete(ns, ns.run(getFilePath('cleanup.js')), true);

    // 最终：执行重置
    if (options.reset || options['install-augmentations']) {
        log(ns, '\n下次重置见！\n', true, 'success');
        await ns.sleep(1000);
        const resetScript = options['on-reset-script'] ??
            (purchasedAugmentations.includes(`Stanek's Gift - Genesis`) ? getFilePath('stanek.js') : getFilePath('daemon.js'));
        if (noAugsToInstall)
            await runCommand(ns, `ns.singularity.softReset(ns.args[0])`, null, [resetScript]);
        else
            await runCommand(ns, `ns.singularity.installAugmentations(ns.args[0])`, null, [resetScript]);
    } else
        log(ns, `成功：准备重置。未来可使用--reset或--install-augmentations自动执行`, true, 'success');
}
