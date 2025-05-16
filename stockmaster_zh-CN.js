import {
    instanceCount, getConfiguration, getNsDataThroughFile, runCommand, getActiveSourceFiles, tryGetBitNodeMultipliers,
    formatMoney, formatNumberShort, formatDuration, getStockSymbols
} from './helpers.js'

let disableShorts = false;
let commission = 100000; // 买入/卖出佣金。预期利润必须超过此值才能进行购买。
let totalProfit = 0.0; // 我们可以跟踪自启动以来赚取的利润。
let lastLog = ""; // 我们更新速度比股票市场快，但除非有变化，否则不会记录任何内容。
let allStockSymbols = null; // 存储启动时收集的所有股票代码
let mock = false; // 如果设置为 true，将“模拟”买入/卖出，但实际上不会进行任何操作。
let noisy = false; // 如果设置为 true，每次买入/卖出股票时都会打印并通知。
// 4S 数据之前的配置（影响我们在获得 4S 数据之前如何操作股票市场，之后一切都变得简单）
let showMarketSummary = false;  // 如果设置为 true，将始终生成并显示 4S 数据之前的预测表在一个单独的窗口
let minTickHistory; // 在提供股票预测之前，必须收集这么多历史数据。
let longTermForecastWindowLength; // 这么多历史数据将用于确定股票的历史概率（只要没有检测到反转）
let nearTermForecastWindowLength; // 这么多历史数据将用于检测最近的负面趋势并立即采取行动。
// 以下 4S 数据之前的常量是硬编码的（不能通过命令行配置），但可能需要调整
const marketCycleLength = 75; // 每这么多 ticks，所有股票有 45% 的概率“反转”其概率。我们必须快速检测并采取行动以避免亏损。
const maxTickHistory = 151; // 这么多历史数据将保留用于确定波动性，或许有一天可以精确定位市场周期 tick
const inversionDetectionTolerance = 0.10; // 如果短期预测在 (1 - 长期预测) 的这个距离内，则视为潜在的“反转”
const inversionLagTolerance = 5; // 在正常的 nearTermForecastWindowLength 预期检测时间之后，反转“可信”最多这么多 ticks
// （注意：33 只股票 * 每个周期 45% 的反转概率 = 每个周期约 15 次预期反转）
// 以下 4S 数据之前的值在程序生命周期内设置
let marketCycleDetected = false; // 在检测到股票市场周期之前，我们不应做出风险购买决策。这可能需要很长时间，但我们会得到回报
let detectedCycleTick = 0; // 一旦我们检测到市场周期点，这将重置为零。
let inversionAgreementThreshold = 6; // 如果检测到这么多股票处于“反转”状态，则视为股票市场周期点
const expectedTickTime = 6000;
const catchUpTickTime = 4000;
let lastTick = 0;
let sleepInterval = 1000;
let resetInfo = (/**@returns{ResetInfo}*/() => undefined)(); // 当前 Bitnode 的信息
let bitNodeMults = (/**@returns{BitNodeMultipliers}*/() => undefined)();

let options;
const argsSchema = [
    ['l', false], // 停止任何其他正在运行的 stockmaster.js 实例并出售所有股票
    ['liquidate', false], // 上述标志的长格式别名。
    ['mock', false], // 如果设置为 true，将“模拟”买入/卖出，但实际上不会进行任何操作
    ['noisy', false], // 如果设置为 true，每次买入/卖出股票时都会打印并通知
    ['disable-shorts', false], // 如果设置为 true，将不会做空任何股票。默认情况下，根据是否拥有 SF8.2 设置。
    ['reserve', null], // 不花费的固定金额
    ['fracB', 0.4], // 在考虑购买更多股票之前，作为流动资产的资产比例
    ['fracH', 0.2], // 购买时保留为现金的资产比例
    ['buy-threshold', 0.0001], // 仅购买预期收益超过 0.01% 的股票（1 个基点）
    ['sell-threshold', 0], // 出售预期收益低于此值的股票（默认 0% - 当概率达到 50% 或更差时发生）
    ['diversification', 0.34], // 在获得 4S 数据之前，我们不会将超过此比例的资产作为单一股票持有
    ['disableHud', false], // 禁用 HUD 面板中显示股票价值
    ['disable-purchase-tix-api', false], // 如果尚未拥有 TIX API，则禁用它。
    // 以下设置仅与调整 4S 数据之前的股票市场逻辑相关
    ['show-pre-4s-forecast', false], // 如果设置为 true，将始终生成并显示 4S 数据之前的预测（如果为 false，则仅在我们不持有任何股票时显示）
    ['show-market-summary', false], // 与 "show-pre-4s-forecast" 相同，此市场摘要变得如此信息丰富，即使有 4S 数据也很有价值
    ['pre-4s-buy-threshold-probability', 0.15], // 在获得 4S 数据之前，仅购买概率与 0.5 相差超过此值的股票，以考虑不精确性
    ['pre-4s-buy-threshold-return', 0.0015], // 在获得 4S 数据之前，仅购买预期收益超过此值的股票（默认 0.25% 或 25 个基点）
    ['pre-4s-sell-threshold-return', 0.0005], // 在获得 4S 数据之前，出售预期收益低于此值的股票（默认 0.15% 或 15 个基点）
    ['pre-4s-min-tick-history', 21], // 在根据 4S 数据之前的股票预测做出买入/卖出决策之前，必须收集这么多历史数据。（默认 21）
    ['pre-4s-forecast-window', 51], // 这么多历史数据将用于确定股票的历史概率（只要没有检测到反转）（默认 76）
    ['pre-4s-inversion-detection-window', 10], // 这么多历史数据将用于检测最近的负面趋势并立即采取行动。（默认 10）
    ['pre-4s-min-blackout-window', 10], // 在检测到的股票市场周期 tick 之前的这么多 ticks 内，不要进行任何新购买，以避免在反转后不久买入头寸
    ['pre-4s-minimum-hold-time', 10], // 最近买入的头寸必须持有这么长时间才能出售，以避免在市场周期刚结束时因噪音而做出仓促决策。（默认 10）
    ['buy-4s-budget', 0.8], // 为了购买 4S 数据，我们愿意牺牲的最大资产价值。设置为 0 将永远不会购买 4S 数据。
];

export function autocomplete(data, args) {
    data.flags(argsSchema);
    return [];
}

/** 需要访问 TIX API。一旦可以，立即购买 4S 市场数据 API 的访问权限
 * @param {NS} ns */
export async function main(ns) {
    const runOptions = getConfiguration(ns, argsSchema);
    if (!runOptions) return; // 无效选项，或以 --help 模式运行。

    // 如果给出“liquidate”命令，尝试杀死任何正在交易股票的此脚本版本
    // 注意：我们必须在开始重置/覆盖下面的全局状态之前立即执行此操作（这些状态在脚本实例之间共享）
    const hasTixApiAccess = await getNsDataThroughFile(ns, 'ns.stock.hasTIXAPIAccess()');
    if (runOptions.l || runOptions.liquidate) {
        if (!hasTixApiAccess) return log(ns, '错误：无法清算股票，因为我们没有 Tix API 访问权限', true, 'error');
        log(ns, '信息：正在杀死任何其他 stockmaster 进程...', false, 'info');
        await runCommand(ns, `ns.ps().filter(proc => proc.filename == '${ns.getScriptName()}' && !proc.args.includes('-l') && !proc.args.includes('--liquidate'))` +
            `.forEach(proc => ns.kill(proc.pid))`, '/Temp/kill-stockmarket-scripts.js');
        log(ns, '信息：检查并清算任何股票...', false, 'info');
        await liquidate(ns); // 出售所有股票
        return;
    } // 否则，防止启动此脚本的多个实例，即使使用不同的参数。
    if ((await instanceCount(ns)) > 1) return;

    ns.disableLog("ALL");
    // 从参数中提取各种选项（全局变量、购买决策因素、4S 数据之前的因素）
    options = runOptions; // 在确定这是唯一运行的实例之前，我们不设置全局“options”
    mock = options.mock;
    noisy = options.noisy;
    const fracB = options.fracB;
    const fracH = options.fracH;
    const diversification = options.diversification;
    const disableHud = options.disableHud || options.liquidate || options.mock;
    disableShorts = options['disable-shorts'];
    const pre4sBuyThresholdProbability = options['pre-4s-buy-threshold-probability'];
    const pre4sMinBlackoutWindow = options['pre-4s-min-blackout-window'] || 1;
    const pre4sMinHoldTime = options['pre-4s-minimum-hold-time'] || 0;
    minTickHistory = options['pre-4s-min-tick-history'] || 21;
    nearTermForecastWindowLength = options['pre-4s-inversion-detection-window'] || 10;
    longTermForecastWindowLength = options['pre-4s-forecast-window'] || (marketCycleLength + 1);
    showMarketSummary = options['show-pre-4s-forecast'] || options['show-market-summary'];
    // 其他全局值必须在启动时重置，以免它们从先前的运行中留在内存中
    lastTick = 0, totalProfit = 0, lastLog = "", marketCycleDetected = false, detectedCycleTick = 0, inversionAgreementThreshold = 6;
    let myStocks = [], allStocks = [];
    let player = await getPlayerInfo(ns);
    resetInfo = await getNsDataThroughFile(ns, 'ns.getResetInfo()');

    if (!hasTixApiAccess) { // 在获得 API 访问权限之前，您无法使用 stockmaster
        if (options['disable-purchase-tix-api'])
            return log(ns, "错误：您没有股票市场 API 访问权限，并且设置了 --disable-purchase-tix-api。", true);
        let success = false;
        log(ns, `信息：您缺少股票市场 API 访问权限。（注意：一旦您拥有 SF8，这将免费授予）。` +
            `等待直到我们有 50 亿购买它。（使用 --disable-purchase-tix-api 运行以禁用此功能。）`, true);
        do {
            await ns.sleep(sleepInterval);
            try {
                const reserve = options['reserve'] != null ? options['reserve'] : Number(ns.read("reserve.txt") || 0);
                player = await getPlayerInfo(ns);
                success = await tryGetStockMarketAccess(ns, player.money - reserve);
            } catch (err) {
                log(ns, `警告：stockmaster.js 在等待购买股票市场访问权限时捕获（并抑制）了意外错误：\n` +
                    (typeof err === 'string' ? err : err.message || JSON.stringify(err)), false, 'warning');
            }
        } while (!success);
    }

    const effectiveSourceFiles = await getActiveSourceFiles(ns, true); // 找出用户解锁了哪些源文件
    if (!disableShorts && (effectiveSourceFiles[8] ?? 0) < 2) {
        log(ns, "信息：做空股票已被禁用（您尚未解锁做空权限）");
        disableShorts = true;
    }

    allStockSymbols = await getStockSymbols(ns);
    allStocks = await initAllStocks(ns);
    bitNodeMults = await tryGetBitNodeMultipliers(ns);

    if (showMarketSummary) await launchSummaryTail(ns); // 打开一个单独的脚本/窗口以持续显示 4S 数据之前的预测

    let hudElement = null;
    if (!disableHud) {
        hudElement = initializeHud();
        ns.atExit(() => hudElement.parentElement.parentElement.parentElement.removeChild(hudElement.parentElement.parentElement));
    }

    log(ns, `欢迎！请注意：所有股票购买最初都会导致净（未实现）亏损。这不仅是因为佣金，还因为每只股票都有“价差”（买入价和卖出价之间的差异）。` +
        `此脚本旨在购买最有可能超越该亏损并转为盈利的股票，但需要几分钟才能看到进展。\n\n` +
        `如果您选择停止脚本，请确保您出售所有股票（可以运行 'run ${ns.getScriptName()} --liquidate'）以取回您的资金。\n\n祝您好运！\n~ Insight\n\n`)

    let pre4s = true;
    while (true) {
        try {
            const playerStats = await getPlayerInfo(ns);
            const reserve = options['reserve'] != null ? options['reserve'] : Number(ns.read("reserve.txt") || 0);
            // 检查我们是否已经拥有 4S 数据访问权限（一旦拥有，我们可以停止检查）
            if (pre4s) pre4s = !(await checkAccess(ns, 'has4SDataTIXAPI'));
            const holdings = await refresh(ns, !pre4s, allStocks, myStocks); // 返回总股票价值
            const corpus = holdings + playerStats.money; // 资产意味着总股票 + 现金
            const maxHoldings = (1 - fracH) * corpus; // 在不违反 fracH（保留为现金的比例）的情况下，我们可以持有的最大股票价值
            if (pre4s && !mock && await tryGet4SApi(ns, playerStats, corpus * (options['buy-4s-budget'] - fracH) - reserve))
                continue; // 如果我们刚刚购买了 4S API 访问权限，则重新开始循环
            // 如果我们没有 4S 数据，则在决策上更加保守
            const thresholdToBuy = pre4s ? options['pre-4s-buy-threshold-return'] : options['buy-threshold'];
            const thresholdToSell = pre4s ? options['pre-4s-sell-threshold-return'] : options['sell-threshold'];
            if (myStocks.length > 0)
                doStatusUpdate(ns, allStocks, myStocks, hudElement);
            else if (hudElement) hudElement.innerText = "$0.000 ";
            if (pre4s && allStocks[0].priceHistory.length < minTickHistory) {
                log(ns, `正在构建股票价格历史记录（${allStocks[0].priceHistory.length}/${minTickHistory}）...`);
                await ns.sleep(sleepInterval);
                continue;
            }

            // 出售预期表现不佳的股票（低于某些预期回报阈值）
            let sales = 0;
            for (let stk of myStocks) {
                if (stk.absReturn() <= thresholdToSell || stk.bullish() && stk.sharesShort > 0 || stk.bearish() && stk.sharesLong > 0) {
                    if (pre4s && stk.ticksHeld < pre4sMinHoldTime) {
                        if (!stk.warnedBadPurchase) log(ns, `警告：考虑出售 ${stk.sym}，预期回报 ${formatBP(stk.absReturn())}，但坚持持有，因为它在 ${stk.ticksHeld} ticks 前刚刚购买...`);
                        stk.warnedBadPurchase = true; // 确保我们不会重复此警告
                    } else {
                        sales += await doSellAll(ns, stk);
                        stk.warnedBadPurchase = false;
                    }
                }
            }
            if (sales > 0) continue; // 如果我们出售了任何东西，立即循环（无需睡眠）并在做出购买决策之前立即刷新统计数据。

            // 如果我们没有超过某个流动性阈值，不要尝试购买更多股票
            // 在我们变得超级富有、股票被限制之前，避免因佣金而死亡，这不再是问题
            // 但可能意味着我们在等待积累更多资金时错过了机会。
            if (playerStats.money / corpus > fracB) {
                // 计算我们可以花费的现金（这样全部花费在股票上将使我们降至 fracH 的流动性）
                let cash = Math.min(playerStats.money - reserve, maxHoldings - holdings);
                // 如果我们没有检测到市场周期（或没有可靠地检测到它），假设它可能很快发生，并将赌注限制在那些可以在短期内盈利的股票上。
                const estTick = Math.max(detectedCycleTick, marketCycleLength - (!marketCycleDetected ? 10 : inversionAgreementThreshold <= 8 ? 20 : inversionAgreementThreshold <= 10 ? 30 : marketCycleLength));
                // 如果手头现金超过某些购买阈值，则购买股票。优先考虑那些预期回报将尽快覆盖买入/卖出价差的目标
                for (const stk of allStocks.sort(purchaseOrder)) {
                    if (cash <= 0) break; // 如果我们没钱了，则中断（即来自先前的购买）
                    // 如果股票在下一个市场周期和潜在概率反转之前无法从买入/卖出价差中恢复，则不要购买
                    if (stk.blackoutWindow() >= marketCycleLength - estTick) continue;
                    if (pre4s && (Math.max(pre4sMinHoldTime, pre4sMinBlackoutWindow) >= marketCycleLength - estTick)) continue;
                    // 如果我们已经拥有该股票的所有可能股份，或者预期回报低于我们的阈值，或者做空被禁用且股票看跌，则跳过
                    if (stk.ownedShares() == stk.maxShares || stk.absReturn() <= thresholdToBuy || (disableShorts && stk.bearish())) continue;
                    // 如果是 4S 数据之前，不要购买任何最近反转的股票，或者其概率太接近 0.5
                    if (pre4s && (stk.lastInversion < minTickHistory || Math.abs(stk.prob - 0.5) < pre4sBuyThresholdProbability)) continue;

                    // 强制分散投资：不要将超过 x% 的资产作为单一股票持有（随着资产增加，这自然不再成为限制）
                    // 将我们的预算/当前头寸价值乘以 stk.spread_pct 因子，以避免由于买入/卖出价差使头寸在购买后显得更加分散而重复微购股票
                    let budget = Math.min(cash, maxHoldings * (diversification + stk.spread_pct) - stk.positionValue() * (1.01 + stk.spread_pct))
                    let purchasePrice = stk.bullish() ? stk.ask_price : stk.bid_price; // 取决于我们将购买多头还是空头头寸
                    let affordableShares = Math.floor((budget - commission) / purchasePrice);
                    let numShares = Math.min(stk.maxShares - stk.ownedShares(), affordableShares);
                    if (numShares <= 0) continue;
                    // 不要购买比在下一次股票市场周期之前（在覆盖价差之后）无法击败佣金的股票，以免头寸在我们盈亏平衡之前反转。
                    let ticksBeforeCycleEnd = marketCycleLength - estTick - stk.timeToCoverTheSpread();
                    if (ticksBeforeCycleEnd < 1) continue; // 我们太接近市场周期，头寸可能在我们盈亏平衡之前反转
                    let estEndOfCycleValue = numShares * purchasePrice * ((stk.absReturn() + 1) ** ticksBeforeCycleEnd - 1); // 购买价格与下一个市场周期结束时的预期价值差异
                    let owned = stk.ownedShares() > 0;
                    if (estEndOfCycleValue <= 2 * commission)
                        log(ns, (owned ? '' : `我们目前拥有 ${formatNumberShort(stk.ownedShares(), 3, 1)} 股 ${stk.sym}，价值 ${formatMoney(stk.positionValue())} ` +
                            `(${(100 * stk.positionValue() / maxHoldings).toFixed(1)}% 的资产，由 --diversification 限制为 ${(diversification * 100).toFixed(1)}%)。\n`) +
                            `尽管有吸引力的预期回报 ${formatBP(stk.absReturn())}，${owned ? '更多 ' : ''}${stk.sym} 未被购买。 ` +
                            `\n预算：${formatMoney(budget)} 只能购买 ${numShares.toLocaleString('en')} ${owned ? '更多 ' : ''}股 @ ${formatMoney(purchasePrice)}。 ` +
                            `\n鉴于市场周期剩余 ${marketCycleLength - estTick} ticks，减去 ${stk.timeToCoverTheSpread().toFixed(1)} ticks 以覆盖价差（${(stk.spread_pct * 100).toFixed(2)}%），` +
                            `剩余的 ${ticksBeforeCycleEnd.toFixed(1)} ticks 只会产生 ${formatMoney(estEndOfCycleValue)}，这低于 2 倍佣金（${formatMoney(2 * commission, 3)}）`);
                    else
                        cash -= await doBuy(ns, stk, numShares);
                }
            }
        } catch (err) {
            log(ns, `警告：stockmaster.js 在主循环中捕获（并抑制）了意外错误：\n` +
                (typeof err === 'string' ? err : err.message || JSON.stringify(err)), false, 'warning');
        }
        await ns.sleep(sleepInterval);
    }
}

/** 避免获取更新的玩家信息。注意，这是主循环中唯一的异步例程。
 * 如果延迟或内存不稳定是一个问题，您可能希望尝试取消注释直接请求。
 * @param {NS} ns
 * @returns {Promise<Player>} */
async function getPlayerInfo(ns) {
    return await getNsDataThroughFile(ns, `ns.getPlayer()`);
}

function getTimeInBitnode() { return Date.now() - resetInfo.lastNodeReset; }

/* 一个排序函数，用于确定我们应优先投资哪些股票 */
let purchaseOrder = (a, b) => (Math.ceil(a.timeToCoverTheSpread()) - Math.ceil(b.timeToCoverTheSpread())) || (b.absReturn() - a.absReturn());

/** @param {NS} ns
 * 通过生成临时脚本来收集信息的通用助手，以规避股票函数的高内存需求。 */
async function getStockInfoDict(ns, stockFunction) {
    allStockSymbols ??= await getStockSymbols(ns);
    if (allStockSymbols == null) throw new Error(`尚未获得 WSE API 访问权限，此调用 ns.stock.${stockFunction} 为时过早。`);
    return await getNsDataThroughFile(ns,
        `Object.fromEntries(ns.args.map(sym => [sym, ns.stock.${stockFunction}(sym)]))`,
        `/Temp/stock-${stockFunction}.txt`, allStockSymbols);
};

/** @param {NS} ns **/
async function initAllStocks(ns) {
    let dictMaxShares = await getStockInfoDict(ns, 'getMaxShares'); // 只需获取一次，它永远不会改变
    return allStockSymbols.map(s => ({
        sym: s,
        maxShares: dictMaxShares[s], // 一旦获取，值永远不会改变
        expectedReturn: function () { // 未来持有量预期升值（或贬值）多少
            // 为了在 4S 数据之前的估计中增加保守性，我们将概率减少 1 个标准差，而不超过中点
            let normalizedProb = (this.prob - 0.5);
            let conservativeProb = normalizedProb < 0 ? Math.min(0, normalizedProb + this.probStdDev) : Math.max(0, normalizedProb - this.probStdDev);
            return this.vol * conservativeProb;
        },
        absReturn: function () { return Math.abs(this.expectedReturn()); }, // 当可以同样购买空头头寸或多头头寸时，适合使用
        bullish: function () { return this.prob > 0.5 },
        bearish: function () { return !this.bullish(); },
        ownedShares: function () { return this.sharesLong + this.sharesShort; },
        owned: function () { return this.ownedShares() > 0; },
        positionValueLong: function () { return this.sharesLong * this.bid_price; },
        positionValueShort: function () { return this.sharesShort * (2 * this.boughtPriceShort - this.ask_price); }, // 空头有点奇怪
        positionValue: function () { return this.positionValueLong() + this.positionValueShort(); },
        // 在当前预期回报下，必须发生多少股票市场 ticks 才能恢复因买入和卖出价格之间的价差而损失的价值。
        // 这可以通过复利公式（未来 = 当前 * (1 + 预期回报) ^ n）并求解 n 得出
        timeToCoverTheSpread: function () { return Math.log(this.ask_price / this.bid_price) / Math.log(1 + this.absReturn()); },
        // 我们不应在市场周期的这么多 ticks 内购买此股票，否则我们可能因概率反转而被迫出售，并因价差而亏损
        blackoutWindow: function () { return Math.ceil(this.timeToCoverTheSpread()); },
        // 4S 数据之前用于预测的属性
        priceHistory: [],
        lastInversion: 0,
    }));
}

/** @param {NS} ns **/
async function refresh(ns, has4s, allStocks, myStocks) {
    let holdings = 0;

    // 通过生成一系列临时脚本来规避高内存需求，一次收集一个函数的信息
    const dictAskPrices = await getStockInfoDict(ns, 'getAskPrice');
    const dictBidPrices = await getStockInfoDict(ns, 'getBidPrice');
    const dictVolatilities = !has4s ? null : await getStockInfoDict(ns, 'getVolatility');
    const dictForecasts = !has4s ? null : await getStockInfoDict(ns, 'getForecast');
    const dictPositions = mock ? null : await getStockInfoDict(ns, 'getPosition');
    const ticked = allStocks.some(stk => stk.ask_price != dictAskPrices[stk.sym]); // 如果自上次更新以来任何价格发生变化，股票市场已经“ticked”

    if (ticked) {
        if (Date.now() - lastTick < expectedTickTime - sleepInterval) {
            if (Date.now() - lastTick < catchUpTickTime - sleepInterval) {
                let changedPrices = allStocks.filter(stk => stk.ask_price != dictAskPrices[stk.sym]);
                log(ns, `警告：仅在 ${formatDuration(Date.now() - lastTick)} 后检测到股票市场 tick，但预期约为 ${formatDuration(expectedTickTime)}。 ` +
                    (changedPrices.length >= 33 ? '（所有股票已更新）' : `以下 ${changedPrices.length} 只股票价格发生变化：${changedPrices.map(stk =>
                        `${stk.sym} ${formatMoney(stk.ask_price)} -> ${formatMoney(dictAskPrices[stk.sym])}`).join(", ")}`), false, 'warning');
            } else
                log(ns, `信息：检测到快速的股票市场 tick（${formatDuration(Date.now() - lastTick)}），可能是为了弥补延迟/离线时间。`)
        }
        lastTick = Date.now()
    }

    myStocks.length = 0;
    for (const stk of allStocks) {
        const sym = stk.sym;
        stk.ask_price = dictAskPrices[sym]; // 如果我们购买股票，我们将支付的金额（高于“价格”）
        stk.bid_price = dictBidPrices[sym]; // 如果我们出售股票，我们将收到的金额（低于“价格”）
        stk.spread = stk.ask_price - stk.bid_price;
        stk.spread_pct = stk.spread / stk.ask_price; // 仅因购买股票而损失的价值百分比
        stk.price = (stk.ask_price + stk.bid_price) / 2; // = ns.stock.getPrice(sym);
        stk.vol = has4s ? dictVolatilities[sym] : stk.vol;
        stk.prob = has4s ? dictForecasts[sym] : stk.prob;
        stk.probStdDev = has4s ? 0 : stk.probStdDev; // 估计概率的标准差
        // 更新我们当前持有的股票组合
        let [priorLong, priorShort] = [stk.sharesLong, stk.sharesShort];
        stk.position = mock ? null : dictPositions[sym];
        stk.sharesLong = mock ? (stk.sharesLong || 0) : stk.position[0];
        stk.boughtPrice = mock ? (stk.boughtPrice || 0) : stk.position[1];
        stk.sharesShort = mock ? (stk.shares_short || 0) : stk.position[2];
        stk.boughtPriceShort = mock ? (stk.boughtPrice_short || 0) : stk.position[3];
        holdings += stk.positionValue();
        if (stk.owned()) myStocks.push(stk); else stk.ticksHeld = 0;
        if (ticked) // 增加 ticksHeld，或者如果我们没有持有此股票的头寸或在上一个 tick 反转了我们的头寸，则重置它。
            stk.ticksHeld = !stk.owned() || (priorLong > 0 && stk.sharesLong == 0) || (priorShort > 0 && stk.sharesShort == 0) ? 0 : 1 + (stk.ticksHeld || 0);
    }
    if (ticked) await updateForecast(ns, allStocks, has4s); // 仅在市场 tick 时需要以下逻辑
    return holdings;
}

// 历史概率可以从最近观察到的股票上涨次数与总观察次数的比率推断出来
const forecast = history => history.reduce((ups, price, idx) => idx == 0 ? 0 : (history[idx - 1] > price ? ups + 1 : ups), 0) / (history.length - 1);
// 如果两个概率相距足够远，并且 p1 等于 1-p2 在“容忍度”范围内，则可以检测到“反转”
const tol2 = inversionDetectionTolerance / 2;
const detectInversion = (p1, p2) => ((p1 >= 0.5 + tol2) && (p2 <= 0.5 - tol2) && p2 <= (1 - p1) + inversionDetectionTolerance)
        /* 反向条件： */ || ((p1 <= 0.5 - tol2) && (p2 >= 0.5 + tol2) && p2 >= (1 - p1) - inversionDetectionTolerance);

/** @param {NS} ns **/
async function updateForecast(ns, allStocks, has4s) {
    const currentHistory = allStocks[0].priceHistory.length;
    const prepSummary = showMarketSummary || mock || (!has4s && (currentHistory < minTickHistory || allStocks.filter(stk => stk.owned()).length == 0)); // 决定是否显示市场摘要表。
    const inversionsDetected = []; // 跟踪概率已反转的个别股票（每个“周期”有 45% 的概率发生）
    detectedCycleTick = (detectedCycleTick + 1) % marketCycleLength; // 跟踪股票市场周期（每 75 个 ticks 发生一次）
    for (const stk of allStocks) {
        stk.priceHistory.unshift(stk.price);
        if (stk.priceHistory.length > maxTickHistory) // 限制滚动窗口大小
            stk.priceHistory.splice(maxTickHistory, 1);
        // 波动性很容易 - 单个 tick 中观察到的最大百分比变动
        if (!has4s) stk.vol = stk.priceHistory.reduce((max, price, idx) => Math.max(max, idx == 0 ? 0 : Math.abs(stk.priceHistory[idx - 1] - price) / price), 0);
        // 我们希望股票具有最佳预期回报，在长窗口内平均以提高精度，但游戏会偶尔反转概率
        // （每 75 次更新有 45% 的概率），因此我们还计算一个短期预测窗口，以便尽早检测反转，以便我们可以放弃我们的头寸。
        stk.nearTermForecast = forecast(stk.priceHistory.slice(0, nearTermForecastWindowLength));
        let preNearTermWindowProb = forecast(stk.priceHistory.slice(nearTermForecastWindowLength, nearTermForecastWindowLength + marketCycleLength)); // 用于检测潜在反转事件之前的概率。
        // 检测此股票的概率是否最近发生了反转（即 prob => 1 - prob）
        stk.possibleInversionDetected = has4s ? detectInversion(stk.prob, stk.lastTickProbability || stk.prob) : detectInversion(preNearTermWindowProb, stk.nearTermForecast);
        stk.lastTickProbability = stk.prob;
        if (stk.possibleInversionDetected) inversionsDetected.push(stk);
    }
    // 根据观察到的潜在反转次数，调整我们自动检测的“股票市场周期”时间
    let summary = "";
    if (inversionsDetected.length > 0) {
        summary += `${inversionsDetected.length} 只股票似乎正在反转其前景：${inversionsDetected.map(s => s.sym).join(', ')}（阈值：${inversionAgreementThreshold}）\n`;
        if (inversionsDetected.length >= inversionAgreementThreshold && (has4s || currentHistory >= minTickHistory)) { // 我们相信我们已经检测到了股票市场周期！
            const newPredictedCycleTick = has4s ? 0 : nearTermForecastWindowLength; // 当我们检测到它时，我们已经过了周期开始这么多 ticks
            if (detectedCycleTick != newPredictedCycleTick)
                log(ns, `改变预测市场周期的阈值已满足（${inversionsDetected.length} >= ${inversionAgreementThreshold}）。 ` +
                    `将当前市场 tick 从 ${detectedCycleTick} 更改为 ${newPredictedCycleTick}。`);
            marketCycleDetected = true;
            detectedCycleTick = newPredictedCycleTick;
            // 除非我们看到另一天有相同或更多的同意，否则不要在未来调整此值（上限为 14，有时我们的周期与实际周期不同步，我们需要重置时钟，即使之前以极大的确定性确定了周期。）
            inversionAgreementThreshold = Math.max(14, inversionsDetected.length);
        }
    }
    // 对任何反转采取行动（如果可信），计算概率，并准备股票摘要
    for (const stk of allStocks) {
        // 除非在我们能够检测到市场周期开始的时间附近，否则不要“信任”（采取行动）检测到的反转。避免大多数误报。
        if (stk.possibleInversionDetected && (has4s && detectedCycleTick == 0 ||
            (!has4s && (detectedCycleTick >= nearTermForecastWindowLength / 2) && (detectedCycleTick <= nearTermForecastWindowLength + inversionLagTolerance))))
            stk.lastInversion = detectedCycleTick; // 如果我们“信任”发生了概率反转，则概率将仅基于自上次反转以来的历史记录计算。
        else
            stk.lastInversion++;
        // 仅采用自上次反转以来的股票历史记录来计算股票的概率。
        const probWindowLength = Math.min(longTermForecastWindowLength, stk.lastInversion);
        stk.longTermForecast = forecast(stk.priceHistory.slice(0, probWindowLength));
        if (!has4s) {
            stk.prob = stk.longTermForecast;
            stk.probStdDev = Math.sqrt((stk.prob * (1 - stk.prob)) / probWindowLength);
        }
        const signalStrength = 1 + (stk.bullish() ? (stk.nearTermForecast > stk.prob ? 1 : 0) + (stk.prob > 0.8 ? 1 : 0) : (stk.nearTermForecast < stk.prob ? 1 : 0) + (stk.prob < 0.2 ? 1 : 0));
        if (prepSummary) { // 示例：AERO  ++   Prob: 54% (t51: 54%, t10: 67%) tLast⇄:190 Vol:0.640% ER: 2.778BP Spread:1.784% ttProfit: 65 Pos: 14.7M long  (held 189 ticks)
            stk.debugLog = `${stk.sym.padEnd(5, ' ')} ${(stk.bullish() ? '+' : '-').repeat(signalStrength).padEnd(3)} ` +
                `Prob:${(stk.prob * 100).toFixed(0).padStart(3)}% (t${probWindowLength.toFixed(0).padStart(2)}:${(stk.longTermForecast * 100).toFixed(0).padStart(3)}%, ` +
                `t${Math.min(stk.priceHistory.length, nearTermForecastWindowLength).toFixed(0).padStart(2)}:${(stk.nearTermForecast * 100).toFixed(0).padStart(3)}%) ` +
                `tLast⇄:${(stk.lastInversion + 1).toFixed(0).padStart(3)} Vol:${(stk.vol * 100).toFixed(2)}% ER:${formatBP(stk.expectedReturn()).padStart(8)} ` +
                `Spread:${(stk.spread_pct * 100).toFixed(2)}% ttProfit:${stk.blackoutWindow().toFixed(0).padStart(3)}`;
            if (stk.owned()) stk.debugLog += ` Pos: ${formatNumberShort(stk.ownedShares(), 3, 1)} (${stk.ownedShares() == stk.maxShares ? 'max' :
                ((100 * stk.ownedShares() / stk.maxShares).toFixed(0).padStart(2) + '%')}) ${stk.sharesLong > 0 ? 'long ' : 'short'} (held ${stk.ticksHeld} ticks)`;
            if (stk.possibleInversionDetected) stk.debugLog += ' ⇄⇄⇄';
        }
    }
    // 打印此最新 tick 的股票摘要（如果启用）
    if (prepSummary) {
        summary += `市场第 ${detectedCycleTick + 1}${marketCycleDetected ? '' : '?'} 天，共 ${marketCycleLength} 天（${marketCycleDetected ? (100 * inversionAgreementThreshold / 19).toPrecision(2) : '0'}% 确定） ` +
            `当前股票摘要和 4S 数据之前的预测（按最佳回报时间排序）：\n` + allStocks.sort(purchaseOrder).map(s => s.debugLog).join("\n")
        if (showMarketSummary) await updateForecastFile(ns, summary); else log(ns, summary);
    }
    // 写出股票概率文件，以便其他脚本可以使用此信息（例如黑客编排器可以操纵股票市场）
    await ns.write('/Temp/stock-probabilities.txt', JSON.stringify(Object.fromEntries(
        allStocks.map(stk => [stk.sym, { prob: stk.prob, sharesLong: stk.sharesLong, sharesShort: stk.sharesShort }]))), "w");
}

// 在单独窗口中显示股票市场摘要的助手。
let summaryFile = '/Temp/stockmarket-summary.txt';
let updateForecastFile = async (ns, summary) => await ns.write(summaryFile, summary, 'w');
let launchSummaryTail = async ns => {
    let summaryTailScript = summaryFile.replace('.txt', '-tail.js');
    if (await getNsDataThroughFile(ns, `ns.scriptRunning('${summaryTailScript}', ns.getHostname())`, '/Temp/stockmarket-summary-is-running.txt'))
        return;
    //await getNsDataThroughFile(ns, `ns.scriptKill('${summaryTailScript}', ns.getHostname())`, summaryTailScript.replace('.js', '-kill.js')); // 仅在我们更改以下脚本时才需要
    await runCommand(ns, `ns.disableLog('sleep'); tail(ns); let lastRead = '';
        while (true) {
            let read = ns.read('${summaryFile}');
            if (lastRead != read) ns.print(lastRead = read);
            await ns.sleep(1000);
        }`, summaryTailScript);
}

// 通过生成临时脚本来规避高内存需求的助手，而不是为每个变体支付 2.5GB 内存
let buyStockWrapper = async (ns, sym, numShares) => await transactStock(ns, sym, numShares, 'buyStock'); // ns.stock.buyStock(sym, numShares);
let buyShortWrapper = async (ns, sym, numShares) => await transactStock(ns, sym, numShares, 'buyShort'); // ns.stock.buyShort(sym, numShares);
let sellStockWrapper = async (ns, sym, numShares) => await transactStock(ns, sym, numShares, 'sellStock'); // ns.stock.sellStock(sym, numShares);
let sellShortWrapper = async (ns, sym, numShares) => await transactStock(ns, sym, numShares, 'sellShort'); // ns.stock.sellShort(sym, numShares);
let transactStock = async (ns, sym, numShares, action) =>
    await getNsDataThroughFile(ns, `ns.stock.${action}(ns.args[0], ns.args[1])`, null, [sym, numShares]);

/** @param {NS} ns
 * 根据股票的前景自动购买空头或多头头寸。 */
async function doBuy(ns, stk, sharesToBuy) {
    // 我们在股票的“持有价值”中包括 -2*佣金，但如果我们重复购买同一只股票，我们必须跟踪
    // 额外的佣金。因此，如果这不是我们第一次购买此代码，则从我们的运行利润中减去它
    if (stk.owned())
        totalProfit -= commission;
    let long = stk.bullish();
    let expectedPrice = long ? stk.ask_price : stk.bid_price; // 取决于我们将购买多头还是空头头寸
    log(ns, `信息：${long ? '买入  ' : '做空'} ${formatNumberShort(sharesToBuy, 3, 3).padStart(5)} (` +
        `${stk.maxShares == sharesToBuy + stk.ownedShares() ? '@max shares' : `${formatNumberShort(sharesToBuy + stk.ownedShares(), 3, 3).padStart(5)}/${formatNumberShort(stk.maxShares, 3, 3).padStart(5)}`}) ` +
        `${stk.sym.padEnd(5)} @ ${formatMoney(expectedPrice).padStart(9)} for ${formatMoney(sharesToBuy * expectedPrice).padStart(9)} (Spread:${(stk.spread_pct * 100).toFixed(2)}% ` +
        `ER:${formatBP(stk.expectedReturn()).padStart(8)}) Ticks to Profit: ${stk.timeToCoverTheSpread().toFixed(2)}`, noisy, 'info');
    let price = mock ? expectedPrice : Number(await transactStock(ns, stk.sym, sharesToBuy, long ? 'buyStock' : 'buyShort'));
    // 其余工作用于故障排除/模拟模式
    if (price == 0) {
        const playerMoney = (await getPlayerInfo(ns)).money;
        if (playerMoney < sharesToBuy * expectedPrice)
            log(ns, `警告：未能 ${long ? '买入' : '做空'} ${stk.sym}，因为资金刚刚下降到 ${formatMoney(playerMoney)}，我们再也买不起了。`, noisy);
        else
            log(ns, `错误：未能 ${long ? '买入' : '做空'} ${stk.sym} @ ${formatMoney(expectedPrice)}（返回 0），尽管拥有 ${formatMoney(playerMoney)}。`, true, 'error');
        return 0;
    } else if (price != expectedPrice) {
        log(ns, `警告：${long ? '买入' : '做空'} ${stk.sym} @ ${formatMoney(price)} 但预期 ${formatMoney(expectedPrice)}（价差：${formatMoney(stk.spread)})`, false, 'warning');
        price = expectedPrice; // 目前已知的 Bitburner 错误，做空返回“price”而不是“bid_price”。纠正此问题，以便运行利润计算正确。
    }
    if (mock && long) stk.boughtPrice = (stk.boughtPrice * stk.sharesLong + price * sharesToBuy) / (stk.sharesLong + sharesToBuy);
    if (mock && !long) stk.boughtPriceShort = (stk.boughtPriceShort * stk.sharesShort + price * sharesToBuy) / (stk.sharesShort + sharesToBuy);
    if (long) stk.sharesLong += sharesToBuy; else stk.sharesShort += sharesToBuy; // 为模拟模式维护，否则，冗余（在下次刷新时被覆盖）
    return sharesToBuy * price + commission; // 返回交易花费的金额，以便可以从我们的手头现金中减去
}

/** @param {NS} ns
 * 出售我们在此股票中的当前头寸。 */
async function doSellAll(ns, stk) {
    let long = stk.sharesLong > 0;
    if (long && stk.sharesShort > 0) // 在此处检测任何问题 - 我们应该总是在购买另一个之前出售一个。
        log(ns, `错误：不知何故最终同时持有 ${stk.sharesShort} 空头和 ${stk.sharesLong} 多头 ${stk.sym}`, true, 'error');
    let expectedPrice = long ? stk.bid_price : stk.ask_price; // 取决于我们将出售多头还是空头头寸
    let sharesSold = long ? stk.sharesLong : stk.sharesShort;
    let price = mock ? expectedPrice : await transactStock(ns, stk.sym, sharesSold, long ? 'sellStock' : 'sellShort');
    const profit = (long ? stk.sharesLong * (price - stk.boughtPrice) : stk.sharesShort * (stk.boughtPriceShort - price)) - 2 * commission;
    log(ns, `${profit > 0 ? '成功' : '警告'}：出售所有 ${formatNumberShort(sharesSold, 3, 3).padStart(5)} ${stk.sym.padEnd(5)} ${long ? ' 多头' : '空头'}头寸 ` +
        `@ ${formatMoney(price).padStart(9)} 获得 ` + (profit > 0 ? `利润 ${formatMoney(profit).padStart(9)}` : `亏损  ${formatMoney(-profit).padStart(9)}`) + ` 在 ${stk.ticksHeld} ticks 后`,
        noisy, noisy ? (profit > 0 ? 'success' : 'error') : undefined);
    if (price == 0) {
        log(ns, `错误：未能出售 ${sharesSold} ${stk.sym} ${long ? '股' : '空头'} @ ${formatMoney(expectedPrice)} - 返回 0。`, true, 'error');
        return 0;
    } else if (price != expectedPrice) {
        log(ns, `警告：出售 ${stk.sym} ${long ? '股' : '空头'} @ ${formatMoney(price)} 但预期 ${formatMoney(expectedPrice)}（价差：${formatMoney(stk.spread)})`, false, 'warning');
        price = expectedPrice; // 目前已知的 Bitburner 错误，sellSort 返回“price”而不是“ask_price”。纠正此问题，以便运行利润计算正确。
    }
    if (long) stk.sharesLong -= sharesSold; else stk.sharesShort -= sharesSold; // 为模拟模式维护，否则，冗余（在下次刷新时被覆盖）
    totalProfit += profit;
    return price * sharesSold - commission; // 返回交易收到的金额
}

let formatBP = fraction => formatNumberShort(fraction * 100 * 100, 3, 2) + " BP";

/** 日志 / tprint / toast 助手。
 * @param {NS} ns */
let log = (ns, message, tprint = false, toastStyle = "") => {
    if (message == lastLog) return;
    ns.print(message);
    if (tprint) ns.tprint(message);
    if (toastStyle) ns.toast(message, toastStyle);
    return lastLog = message;
}

function doStatusUpdate(ns, stocks, myStocks, hudElement = null) {
    let maxReturnBP = 10000 * Math.max(...myStocks.map(s => s.absReturn())); // 我们投资组合中最大的回报（以基点计）
    let minReturnBP = 10000 * Math.min(...myStocks.map(s => s.absReturn())); // 我们投资组合中最小的回报（以基点计）
    let est_holdings_cost = myStocks.reduce((sum, stk) => sum + (stk.owned() ? commission : 0) +
        stk.sharesLong * stk.boughtPrice + stk.sharesShort * stk.boughtPriceShort, 0);
    let liquidation_value = myStocks.reduce((sum, stk) => sum - (stk.owned() ? commission : 0) + stk.positionValue(), 0);
    let status = `多头 ${myStocks.filter(s => s.sharesLong > 0).length}, 空头 ${myStocks.filter(s => s.sharesShort > 0).length} 共 ${stocks.length} 只股票 ` +
        (myStocks.length == 0 ? '' : `(预期回报 ${minReturnBP.toFixed(1)}-${maxReturnBP.toFixed(1)} BP) `) +
        `利润：${formatMoney(totalProfit, 3)} 持有：${formatMoney(liquidation_value, 3)} (成本：${formatMoney(est_holdings_cost, 3)}) ` +
        `净额：${formatMoney(totalProfit + liquidation_value - est_holdings_cost, 3)}`
    log(ns, status);
    if (hudElement) hudElement.innerText = formatMoney(liquidation_value, 6, 3);
}

/** @param {NS} ns **/
async function liquidate(ns) {
    allStockSymbols ??= await getStockSymbols(ns);
    if (allStockSymbols == null) return; // 无需清算，没有 API 访问权限
    let totalStocks = 0, totalSharesLong = 0, totalSharesShort = 0, totalRevenue = 0;
    const dictPositions = mock ? null : await getStockInfoDict(ns, 'getPosition');
    for (const sym of allStockSymbols) {
        var [sharesLong, , sharesShort, avgShortCost] = dictPositions[sym];
        if (sharesLong + sharesShort == 0) continue;
        totalStocks++, totalSharesLong += sharesLong, totalSharesShort += sharesShort;
        if (sharesLong > 0) totalRevenue += (await sellStockWrapper(ns, sym, sharesLong)) * sharesLong - commission;
        if (sharesShort > 0) totalRevenue += (2 * avgShortCost - (await sellShortWrapper(ns, sym, sharesShort))) * sharesShort - commission;
    }
    log(ns, `出售了 ${totalSharesLong.toLocaleString('en')} 多头股份和 ${totalSharesShort.toLocaleString('en')} 空头股份 ` +
        `共 ${totalStocks} 只股票，获得 ${formatMoney(totalRevenue, 3)}`, true, 'success');
}

/** @param {NS} ns **/
/** @param {Player} playerStats **/
async function tryGet4SApi(ns, playerStats, budget) {
    if (await checkAccess(ns, 'has4SDataTIXAPI')) return false; // 仅在我们刚刚购买它时返回 true
    const cost4sData = 1E9 * bitNodeMults.FourSigmaMarketDataCost;
    const cost4sApi = 25E9 * bitNodeMults.FourSigmaMarketDataApiCost;
    const has4S = await checkAccess(ns, 'has4SData');
    const totalCost = (has4S ? 0 : cost4sData) + cost4sApi;
    // 如果出售股票将允许我们负担 4S API 数据，则清算股票
    if (totalCost > budget) /* 需要保留一些资金进行投资 */
        return false;
    if (playerStats.money < totalCost)
        await liquidate(ns);
    if (!has4S) {
        if (await tryBuy(ns, 'purchase4SMarketData'))
            log(ns, `成功：购买了 4SMarketData，花费 ${formatMoney(cost4sData)} ` +
                `（在 BitNode 中 ${formatDuration(getTimeInBitnode())}）`, true, 'success');
        else
            log(ns, '尝试购买 4SMarketData 时出错！', false, 'error');
    }
    if (await tryBuy(ns, 'purchase4SMarketDataTixApi')) {
        log(ns, `成功：购买了 4SMarketDataTixApi，花费 ${formatMoney(cost4sApi)} ` +
            `（在 BitNode 中 ${formatDuration(getTimeInBitnode())}）`, true, 'success');
        return true;
    } else {
        log(ns, '尝试购买 4SMarketDataTixApi 时出错！', false, 'error');
    }
    return false;
}

/** @param {NS} ns
 * @param {"hasWSEAccount"|"hasTIXAPIAccess"|"has4SData"|"has4SDataTIXAPI"} stockFn
 * 检查股票访问权限的助手 */
async function checkAccess(ns, stockFn) {
    return await getNsDataThroughFile(ns, `ns.stock.${stockFn}()`)
}

/** @param {NS} ns
 * @param {"purchaseWseAccount"|"purchaseTixApi"|"purchase4SMarketData"|"purchase4SMarketDataTixApi"} stockFn
 * 尝试购买股票访问权限的助手。是的，代码与上面相同，但我想明确说明。 */
async function tryBuy(ns, stockFn) {
    return await getNsDataThroughFile(ns, `ns.stock.${stockFn}()`)
}

/** @param {NS} ns
 * @param {number} budget - 我们愿意花费在 WSE 和 API 访问上的金额
 * 尝试购买股票市场访问权限 **/
async function tryGetStockMarketAccess(ns, budget) {
    if (await checkAccess(ns, 'hasTIXAPIAccess')) return true; // 已经拥有访问权限
    const costWseAccount = 200E6;
    const costTixApi = 5E9;
    const hasWSE = await checkAccess(ns, 'hasWSEAccount');
    const totalCost = (hasWSE ? 0 : costWseAccount) + costTixApi;
    if (totalCost > budget) return false;
    if (!hasWSE) {
        if (await tryBuy(ns, 'purchaseWseAccount'))
            log(ns, `成功：购买了 WSE（股票市场）账户，花费 ${formatMoney(costWseAccount)} ` +
                `（在 BitNode 中 ${formatDuration(getTimeInBitnode())}）`, true, 'success');
        else
            log(ns, '尝试购买 WSE 账户时出错！', false, 'error');
    }
    if (await tryBuy(ns, 'purchaseTixApi')) {
        log(ns, `成功：购买了 Tix（股票市场）API 访问权限，花费 ${formatMoney(costTixApi)} ` +
            `（在 BitNode 中 ${formatDuration(getTimeInBitnode())}）`, true, 'success');
        return true;
    } else
        log(ns, '尝试购买 Tix API 时出错！', false, 'error');
    return false;
}

function initializeHud() {
    const d = eval("document");
    let htmlDisplay = d.getElementById("stock-display-1");
    if (htmlDisplay !== null) return htmlDisplay;
    // 获取 HUD 中的自定义显示元素。
    let customElements = d.getElementById("overview-extra-hook-0").parentElement.parentElement;
    // 为额外 HUD 元素创建一个钩子的克隆，并将其移动到金钱下方
    let stockValueTracker = customElements.cloneNode(true);
    // 删除由 stats.js 创建的任何嵌套元素
    stockValueTracker.querySelectorAll("p > p").forEach(el => el.parentElement.removeChild(el));
    // 更改 id，因为重复的 id 是无效的
    stockValueTracker.querySelectorAll("p").forEach((el, i) => el.id = "stock-display-" + i);
    // 获取我们的输出元素
    htmlDisplay = stockValueTracker.querySelector("#stock-display-1");
    // 显示标签和默认值
    stockValueTracker.querySelectorAll("p")[0].innerText = "股票";
    htmlDisplay.innerText = "$0.000 "
    // 将我们的元素插入到金钱之后
    customElements.parentElement.insertBefore(stockValueTracker, customElements.parentElement.childNodes[2]);
    return htmlDisplay;
}
