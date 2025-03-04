import {
    instanceCount, getConfiguration, getNsDataThroughFile, runCommand, getActiveSourceFiles, tryGetBitNodeMultipliers,
    formatMoney, formatNumberShort, formatDuration, getStockSymbols
} from './helpers.js'

let disableShorts = false;
// 交易配置参数
let commission = 100000; // 交易佣金。预期利润必须超过此值才会进行买卖
let totalProfit = 0.0; // 记录脚本启动后的累计收益
let lastLog = ""; // 仅当有变化时记录日志（股票市场更新频率低于脚本轮询）
let allStockSymbols = null; // 启动时收集所有股票代码
let mock = false; // 模拟模式：执行买卖计算但不实际交易
let noisy = false; // 详细模式：每次买卖操作时显示通知

// 4S数据获取前的配置参数
let showMarketSummary = false;  // 始终在独立窗口显示预4S市场预测
let minTickHistory; // 生成预测所需最小历史数据量
let longTermForecastWindowLength; // 长期趋势分析窗口长度
let nearTermForecastWindowLength; // 短期趋势检测窗口长度

// 预4S常量配置（不可通过命令行配置）
const marketCycleLength = 75; // 市场周期长度（单位：tick），每个周期股票有45%概率反转趋势
const maxTickHistory = 151; // 最大历史数据保留量（用于波动率分析）
const inversionDetectionTolerance = 0.10; // 反转检测容差阈值
const inversionLagTolerance = 5; // 反转检测延迟容差
let marketCycleDetected = false; // 是否检测到市场周期
let detectedCycleTick = 0; // 检测到的周期起始点
let inversionAgreementThreshold = 6; // 触发周期检测的反转股票数量阈值

// 运行时参数
const expectedTickTime = 6000; // 预期tick间隔（毫秒）
const catchUpTickTime = 4000; // 追赶模式tick间隔
let lastTick = 0; // 最后记录tick时间
let sleepInterval = 1000; // 主循环休眠间隔

// 命令行参数配置表
const argsSchema = [
    ['l', false], // 停止其他实例并清空所有持仓
    ['liquidate', false], // 同上（长参数形式）
    ['mock', false], // 启用模拟交易模式
    ['noisy', false], // 启用详细交易通知
    ['disable-shorts', false], // 禁用做空交易（默认根据SF8.2状态自动设置）
    ['reserve', null], // 保留的固定资金量（不用于交易）
    ['fracB', 0.4], // 流动资产比例阈值（低于此值才考虑买入）
    ['fracH', 0.2], // 现金保留比例（买入时保留）
    ['buy-threshold', 0.0001], // 买入阈值（预期收益率 > 0.01%）
    ['sell-threshold', 0], // 卖出阈值（预期收益率 < 0%）
    ['diversification', 0.34], // 单只股票最大持仓比例（预4S模式）
    ['disableHud', false], // 禁用HUD股票信息显示
    ['disable-purchase-tix-api', false], // 禁止自动购买TIX API
    // 预4S模式高级参数
    ['show-pre-4s-forecast', false], // 始终显示预4S预测界面
    ['show-market-summary', false], // 显示详细市场摘要（即使持有股票）
    ['pre-4s-buy-threshold-probability', 0.15], // 预4S最小买入概率差阈值（距0.5）
    ['pre-4s-buy-threshold-return', 0.0015], // 预4S买入收益率阈值（0.25%）
    ['pre-4s-sell-threshold-return', 0.0005], // 预4S卖出收益率阈值（0.15%）
    ['pre-4s-min-tick-history', 21], // 预4S分析所需最小历史数据量
    ['pre-4s-forecast-window', 51], // 长期趋势分析窗口长度
    ['pre-4s-inversion-detection-window', 10], // 短期反转检测窗口
    ['pre-4s-min-blackout-window', 10], // 周期点前禁止买入窗口
    ['pre-4s-minimum-hold-time', 10], // 最小持仓时间（避免误操作）
    ['buy-4s-budget', 0.8], // 购买4S数据的最大资金占比（0为禁用）
];
export function autocomplete(data, args) {
    data.flags(argsSchema);
    return [];
}

/** Requires access to the TIX API. Purchases access to the 4S Mkt Data API as soon as it can
 * @param {NS} ns */
export async function main(ns) {
    const runOptions = getConfiguration(ns, argsSchema);
    if (!runOptions) return; // Invalid options, or ran in --help mode.

    // If given the "liquidate" command, try to kill any versions of this script trading in stocks
    // NOTE: We must do this immediately before we start resetting / overwriting global state below (which is shared between script instances)
    const hasTixApiAccess = await getNsDataThroughFile(ns, 'ns.stock.hasTIXAPIAccess()');
    if (runOptions.l || runOptions.liquidate) {
        if (!hasTixApiAccess) return log(ns, 'ERROR: Cannot liquidate stocks because we do not have Tix Api Access', true, 'error');
        log(ns, 'INFO: Killing any other stockmaster processes...', false, 'info');
        await runCommand(ns, `ns.ps().filter(proc => proc.filename == '${ns.getScriptName()}' && !proc.args.includes('-l') && !proc.args.includes('--liquidate'))` +
            `.forEach(proc => ns.kill(proc.pid))`, '/Temp/kill-stockmarket-scripts.js');
        log(ns, 'INFO: Checking for and liquidating any stocks...', false, 'info');
        await liquidate(ns); // Sell all stocks
        return;
    } // Otherwise, prevent multiple instances of this script from being started, even with different args.
    if ((await instanceCount(ns)) > 1) return;

    ns.disableLog("ALL");
    // Extract various options from the args (globals, purchasing decision factors, pre-4s factors)
    options = runOptions; // We don't set the global "options" until we're sure this is the only running instance
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
    // Other global values must be reset at start lest they be left in memory from a prior run
    lastTick = 0, totalProfit = 0, lastLog = "", marketCycleDetected = false, detectedCycleTick = 0, inversionAgreementThreshold = 6;
    let myStocks = [], allStocks = [];
    let player = await getPlayerInfo(ns);
    resetInfo = await getNsDataThroughFile(ns, 'ns.getResetInfo()');

    if (!hasTixApiAccess) { // You cannot use the stockmaster until you have API access
        if (options['disable-purchase-tix-api'])
            return log(ns, "ERROR: You do not have stock market API access, and --disable-purchase-tix-api is set.", true);
        let success = false;
        log(ns, `INFO: You are missing stock market API access. (NOTE: This is granted for free once you have SF8). ` +
            `Waiting until we have the 5b needed to buy it. (Run with --disable-purchase-tix-api to disable this feature.)`, true);
        do {
            await ns.sleep(sleepInterval);
            try {
                const reserve = options['reserve'] != null ? options['reserve'] : Number(ns.read("reserve.txt") || 0);
                player = await getPlayerInfo(ns);
                success = await tryGetStockMarketAccess(ns, player.money - reserve);
            } catch (err) {
                log(ns, `WARNING: stockmaster.js Caught (and suppressed) an unexpected error while waiting to buy stock market access:\n` +
                    (typeof err === 'string' ? err : err.message || JSON.stringify(err)), false, 'warning');
            }
        } while (!success);
    }

    const effectiveSourceFiles = await getActiveSourceFiles(ns, true); // Find out what source files the user has unlocked
    if (!disableShorts && (effectiveSourceFiles[8] ?? 0) < 2) {
        log(ns, "INFO: Shorting stocks has been disabled (you have not yet unlocked access to shorting)");
        disableShorts = true;
    }

    allStockSymbols = await getStockSymbols(ns);
    allStocks = await initAllStocks(ns);
    bitNodeMults = await tryGetBitNodeMultipliers(ns);

    if (showMarketSummary) await launchSummaryTail(ns); // Opens a separate script / window to continuously display the Pre4S forecast

    let hudElement = null;
    if (!disableHud) {
        hudElement = initializeHud();
        ns.atExit(() => hudElement.parentElement.parentElement.parentElement.removeChild(hudElement.parentElement.parentElement));
    }

    log(ns, `Welcome! Please note: all stock purchases will initially result in a Net (unrealized) Loss. This is not only due to commission, but because each stock has a 'spread' (difference in buy price and sell price). ` +
        `This script is designed to buy stocks that are most likely to surpass that loss and turn a profit, but it will take a few minutes to see the progress.\n\n` +
        `If you choose to stop the script, make sure you SELL all your stocks (can go 'run ${ns.getScriptName()} --liquidate') to get your money back.\n\nGood luck!\n~ Insight\n\n`)

    let pre4s = true;
    while (true) {
        try {
            const playerStats = await getPlayerInfo(ns);
            const reserve = options['reserve'] != null ? options['reserve'] : Number(ns.read("reserve.txt") || 0);
            // Check whether we have 4s access yes (once we do, we can stop checking)
            if (pre4s) pre4s = !(await checkAccess(ns, 'has4SDataTIXAPI'));
            const holdings = await refresh(ns, !pre4s, allStocks, myStocks); // Returns total stock value
            const corpus = holdings + playerStats.money; // Corpus means total stocks + cash
            const maxHoldings = (1 - fracH) * corpus; // The largest value of stock we could hold without violiating fracH (Fraction to keep as cash)
            if (pre4s && !mock && await tryGet4SApi(ns, playerStats, corpus * (options['buy-4s-budget'] - fracH) - reserve))
                continue; // Start the loop over if we just bought 4S API access
            // Be more conservative with our decisions if we don't have 4S data
            const thresholdToBuy = pre4s ? options['pre-4s-buy-threshold-return'] : options['buy-threshold'];
            const thresholdToSell = pre4s ? options['pre-4s-sell-threshold-return'] : options['sell-threshold'];
            if (myStocks.length > 0)
                doStatusUpdate(ns, allStocks, myStocks, hudElement);
            else if (hudElement) hudElement.innerText = "$0.000 ";
            if (pre4s && allStocks[0].priceHistory.length < minTickHistory) {
                log(ns, `Building a history of stock prices (${allStocks[0].priceHistory.length}/${minTickHistory})...`);
                await ns.sleep(sleepInterval);
                continue;
            }

            // Sell forecasted-to-underperform shares (worse than some expected return threshold)
            let sales = 0;
            for (let stk of myStocks) {
                if (stk.absReturn() <= thresholdToSell || stk.bullish() && stk.sharesShort > 0 || stk.bearish() && stk.sharesLong > 0) {
                    if (pre4s && stk.ticksHeld < pre4sMinHoldTime) {
                        if (!stk.warnedBadPurchase) log(ns, `WARNING: Thinking of selling ${stk.sym} with ER ${formatBP(stk.absReturn())}, but holding out as it was purchased just ${stk.ticksHeld} ticks ago...`);
                        stk.warnedBadPurchase = true; // Hack to ensure we don't spam this warning
                    } else {
                        sales += await doSellAll(ns, stk);
                        stk.warnedBadPurchase = false;
                    }
                }
            }
            if (sales > 0) continue; // If we sold anything, loop immediately (no need to sleep) and refresh stats immediately before making purchasing decisions.

            // If we haven't gone above a certain liquidity threshold, don't attempt to buy more stock
            // Avoids death-by-a-thousand-commissions before we get super-rich, stocks are capped, and this is no longer an issue
            // BUT may mean we miss striking while the iron is hot while waiting to build up more funds.
            if (playerStats.money / corpus > fracB) {
                // Compute the cash we have to spend (such that spending it all on stock would bring us down to a liquidity of fracH)
                let cash = Math.min(playerStats.money - reserve, maxHoldings - holdings);
                // If we haven't detected the market cycle (or haven't detected it reliably), assume it might be quite soon and restrict bets to those that can turn a profit in the very-near term.
                const estTick = Math.max(detectedCycleTick, marketCycleLength - (!marketCycleDetected ? 10 : inversionAgreementThreshold <= 8 ? 20 : inversionAgreementThreshold <= 10 ? 30 : marketCycleLength));
                // Buy shares with cash remaining in hand if exceeding some buy threshold. Prioritize targets whose expected return will cover the ask/bit spread the soonest
                for (const stk of allStocks.sort(purchaseOrder)) {
                    if (cash <= 0) break; // Break if we are out of money (i.e. from prior purchases)
                    // Do not purchase a stock if it is not forecasted to recover from the ask/bid spread before the next market cycle and potential probability inversion
                    if (stk.blackoutWindow() >= marketCycleLength - estTick) continue;
                    if (pre4s && (Math.max(pre4sMinHoldTime, pre4sMinBlackoutWindow) >= marketCycleLength - estTick)) continue;
                    // Skip if we already own all possible shares in this stock, or if the expected return is below our threshold, or if shorts are disabled and stock is bearish
                    if (stk.ownedShares() == stk.maxShares || stk.absReturn() <= thresholdToBuy || (disableShorts && stk.bearish())) continue;
                    // If pre-4s, do not purchase any stock whose last inversion was too recent, or whose probability is too close to 0.5
                    if (pre4s && (stk.lastInversion < minTickHistory || Math.abs(stk.prob - 0.5) < pre4sBuyThresholdProbability)) continue;

                    // Enforce diversification: Don't hold more than x% of our portfolio as a single stock (as corpus increases, this naturally stops being a limiter)
                    // Inflate our budget / current position value by a factor of stk.spread_pct to avoid repeated micro-buys of a stock due to the buy/ask spread making holdings appear more diversified after purchase
                    let budget = Math.min(cash, maxHoldings * (diversification + stk.spread_pct) - stk.positionValue() * (1.01 + stk.spread_pct))
                    let purchasePrice = stk.bullish() ? stk.ask_price : stk.bid_price; // Depends on whether we will be buying a long or short position
                    let affordableShares = Math.floor((budget - commission) / purchasePrice);
                    let numShares = Math.min(stk.maxShares - stk.ownedShares(), affordableShares);
                    if (numShares <= 0) continue;
                    // Don't buy fewer shares than can beat the comission before the next stock market cycle (after covering the spread), lest the position reverse before we break-even.
                    let ticksBeforeCycleEnd = marketCycleLength - estTick - stk.timeToCoverTheSpread();
                    if (ticksBeforeCycleEnd < 1) continue; // We're cutting it too close to the market cycle, position might reverse before we break-even on commission
                    let estEndOfCycleValue = numShares * purchasePrice * ((stk.absReturn() + 1) ** ticksBeforeCycleEnd - 1); // Expected difference in purchase price and value at next market cycle end
                    let owned = stk.ownedShares() > 0;
                    if (estEndOfCycleValue <= 2 * commission)
                        log(ns, (owned ? '' : `We currently have ${formatNumberShort(stk.ownedShares(), 3, 1)} shares in ${stk.sym} valued at ${formatMoney(stk.positionValue())} ` +
                            `(${(100 * stk.positionValue() / maxHoldings).toFixed(1)}% of corpus, capped at ${(diversification * 100).toFixed(1)}% by --diversification).\n`) +
                            `Despite attractive ER of ${formatBP(stk.absReturn())}, ${owned ? 'more ' : ''}${stk.sym} was not bought. ` +
                            `\nBudget: ${formatMoney(budget)} can only buy ${numShares.toLocaleString('en')} ${owned ? 'more ' : ''}shares @ ${formatMoney(purchasePrice)}. ` +
                            `\nGiven an estimated ${marketCycleLength - estTick} ticks left in market cycle, less ${stk.timeToCoverTheSpread().toFixed(1)} ticks to cover the spread (${(stk.spread_pct * 100).toFixed(2)}%), ` +
                            `remaining ${ticksBeforeCycleEnd.toFixed(1)} ticks would only generate ${formatMoney(estEndOfCycleValue)}, which is less than 2x commission (${formatMoney(2 * commission, 3)})`);
                    else
                        cash -= await doBuy(ns, stk, numShares);
                }
            }
        } catch (err) {
            log(ns, `WARNING: stockmaster.js Caught (and suppressed) an unexpected error in the main loop:\n` +
                (typeof err === 'string' ? err : err.message || JSON.stringify(err)), false, 'warning');
        }
        await ns.sleep(sleepInterval);
    }
}

/** Ram-dodge getting updated player info. Note that this is the only async routine called in the main loop.
 * If latency or ram instability is an issue, you may wish to try uncommenting the direct request.
 * @param {NS} ns
 * @returns {Promise<Player>} */
async function getPlayerInfo(ns) {
    return await getNsDataThroughFile(ns, `ns.getPlayer()`);
}

function getTimeInBitnode() { return Date.now() - resetInfo.lastNodeReset; }

/* A sorting function to put stocks in the order we should prioritize investing in them */
let purchaseOrder = (a, b) => (Math.ceil(a.timeToCoverTheSpread()) - Math.ceil(b.timeToCoverTheSpread())) || (b.absReturn() - a.absReturn());

/** @param {NS} ns
 * Generic helper for dodging the hefty RAM requirements of stock functions by spawning a temporary script to collect info for us. */
async function getStockInfoDict(ns, stockFunction) {
    allStockSymbols ??= await getStockSymbols(ns);
    if (allStockSymbols == null) throw new Error(`No WSE API Access yet, this call to ns.stock.${stockFunction} is premature.`);
    return await getNsDataThroughFile(ns,
        `Object.fromEntries(ns.args.map(sym => [sym, ns.stock.${stockFunction}(sym)]))`,
        `/Temp/stock-${stockFunction}.txt`, allStockSymbols);
};

/** @param {NS} ns **/
async function initAllStocks(ns) {
    let dictMaxShares = await getStockInfoDict(ns, 'getMaxShares'); // Only need to get this once, it never changes
    return allStockSymbols.map(s => ({
        sym: s,
        maxShares: dictMaxShares[s], // Value never changes once retrieved
        expectedReturn: function () { // How much holdings are expected to appreciate (or depreciate) in the future
            // To add conservatism to pre-4s estimates, we reduce the probability by 1 standard deviation without crossing the midpoint
            let normalizedProb = (this.prob - 0.5);
            let conservativeProb = normalizedProb < 0 ? Math.min(0, normalizedProb + this.probStdDev) : Math.max(0, normalizedProb - this.probStdDev);
            return this.vol * conservativeProb;
        },
        absReturn: function () { return Math.abs(this.expectedReturn()); }, // Appropriate to use when can just as well buy a short position as a long position
        bullish: function () { return this.prob > 0.5 },
        bearish: function () { return !this.bullish(); },
        ownedShares: function () { return this.sharesLong + this.sharesShort; },
        owned: function () { return this.ownedShares() > 0; },
        positionValueLong: function () { return this.sharesLong * this.bid_price; },
        positionValueShort: function () { return this.sharesShort * (2 * this.boughtPriceShort - this.ask_price); }, // Shorts work a bit weird
        positionValue: function () { return this.positionValueLong() + this.positionValueShort(); },
        // How many stock market ticks must occur at the current expected return before we regain the value lost by the spread between buy and sell prices.
        // This can be derived by taking the compound interest formula (future = current * (1 + expected_return) ^ n) and solving for n
        timeToCoverTheSpread: function () { return Math.log(this.ask_price / this.bid_price) / Math.log(1 + this.absReturn()); },
        // We should not buy this stock within this many ticks of a Market cycle, or we risk being forced to sell due to a probability inversion, and losing money due to the spread
        blackoutWindow: function () { return Math.ceil(this.timeToCoverTheSpread()); },
        // Pre-4s properties used for forecasting
        priceHistory: [],
        lastInversion: 0,
    }));
}

/** @param {NS} ns **/
async function refresh(ns, has4s, allStocks, myStocks) {
    let holdings = 0;

    // Dodge hefty RAM requirements by spawning a sequence of temporary scripts to collect info for us one function at a time
    const dictAskPrices = await getStockInfoDict(ns, 'getAskPrice');
    const dictBidPrices = await getStockInfoDict(ns, 'getBidPrice');
    const dictVolatilities = !has4s ? null : await getStockInfoDict(ns, 'getVolatility');
    const dictForecasts = !has4s ? null : await getStockInfoDict(ns, 'getForecast');
    const dictPositions = mock ? null : await getStockInfoDict(ns, 'getPosition');
    const ticked = allStocks.some(stk => stk.ask_price != dictAskPrices[stk.sym]); // If any price has changed since our last update, the stock market has "ticked"

    if (ticked) {
        if (Date.now() - lastTick < expectedTickTime - sleepInterval) {
            if (Date.now() - lastTick < catchUpTickTime - sleepInterval) {
                let changedPrices = allStocks.filter(stk => stk.ask_price != dictAskPrices[stk.sym]);
                log(ns, `WARNING: Detected a stock market tick after only ${formatDuration(Date.now() - lastTick)}, but expected ~${formatDuration(expectedTickTime)}. ` +
                    (changedPrices.length >= 33 ? '(All stocks updated)' : `The following ${changedPrices.length} stock prices changed: ${changedPrices.map(stk =>
                        `${stk.sym} ${formatMoney(stk.ask_price)} -> ${formatMoney(dictAskPrices[stk.sym])}`).join(", ")}`), false, 'warning');
            } else
                log(ns, `INFO: Detected a rapid stock market tick (${formatDuration(Date.now() - lastTick)}), likely to make up for lag / offline time.`)
        }
        lastTick = Date.now()
    }

    myStocks.length = 0;
    for (const stk of allStocks) {
        const sym = stk.sym;
        stk.ask_price = dictAskPrices[sym]; // The amount we would pay if we bought the stock (higher than 'price')
        stk.bid_price = dictBidPrices[sym]; // The amount we would recieve if we sold the stock (lower than 'price')
        stk.spread = stk.ask_price - stk.bid_price;
        stk.spread_pct = stk.spread / stk.ask_price; // The percentage of value we lose just by buying the stock
        stk.price = (stk.ask_price + stk.bid_price) / 2; // = ns.stock.getPrice(sym);
        stk.vol = has4s ? dictVolatilities[sym] : stk.vol;
        stk.prob = has4s ? dictForecasts[sym] : stk.prob;
        stk.probStdDev = has4s ? 0 : stk.probStdDev; // Standard deviation around the est. probability
        // Update our current portfolio of owned stock
        let [priorLong, priorShort] = [stk.sharesLong, stk.sharesShort];
        stk.position = mock ? null : dictPositions[sym];
        stk.sharesLong = mock ? (stk.sharesLong || 0) : stk.position[0];
        stk.boughtPrice = mock ? (stk.boughtPrice || 0) : stk.position[1];
        stk.sharesShort = mock ? (stk.shares_short || 0) : stk.position[2];
        stk.boughtPriceShort = mock ? (stk.boughtPrice_short || 0) : stk.position[3];
        holdings += stk.positionValue();
        if (stk.owned()) myStocks.push(stk); else stk.ticksHeld = 0;
        if (ticked) // Increment ticksHeld, or reset it if we have no position in this stock or reversed our position last tick.
            stk.ticksHeld = !stk.owned() || (priorLong > 0 && stk.sharesLong == 0) || (priorShort > 0 && stk.sharesShort == 0) ? 0 : 1 + (stk.ticksHeld || 0);
    }
    if (ticked) await updateForecast(ns, allStocks, has4s); // Logic below only required on market tick
    return holdings;
}

// Historical probability can be inferred from the number of times the stock was recently observed increasing over the total number of observations
const forecast = history => history.reduce((ups, price, idx) => idx == 0 ? 0 : (history[idx - 1] > price ? ups + 1 : ups), 0) / (history.length - 1);
// An "inversion" can be detected if two probabilities are far enough apart and are within "tolerance" of p1 being equal to 1-p2
const tol2 = inversionDetectionTolerance / 2;
const detectInversion = (p1, p2) => ((p1 >= 0.5 + tol2) && (p2 <= 0.5 - tol2) && p2 <= (1 - p1) + inversionDetectionTolerance)
        /* Reverse Condition: */ || ((p1 <= 0.5 - tol2) && (p2 >= 0.5 + tol2) && p2 >= (1 - p1) - inversionDetectionTolerance);

/** @param {NS} ns **/
async function updateForecast(ns, allStocks, has4s) {
    const currentHistory = allStocks[0].priceHistory.length;
    const prepSummary = showMarketSummary || mock || (!has4s && (currentHistory < minTickHistory || allStocks.filter(stk => stk.owned()).length == 0)); // Decide whether to display the market summary table.
    const inversionsDetected = []; // Keep track of individual stocks whose probability has inverted (45% chance of happening each "cycle")
    detectedCycleTick = (detectedCycleTick + 1) % marketCycleLength; // Keep track of stock market cycle (which occurs every 75 ticks)
    for (const stk of allStocks) {
        stk.priceHistory.unshift(stk.price);
        if (stk.priceHistory.length > maxTickHistory) // Limit the rolling window size
            stk.priceHistory.splice(maxTickHistory, 1);
        // Volatility is easy - the largest observed % movement in a single tick
        if (!has4s) stk.vol = stk.priceHistory.reduce((max, price, idx) => Math.max(max, idx == 0 ? 0 : Math.abs(stk.priceHistory[idx - 1] - price) / price), 0);
        // We want stocks that have the best expected return, averaged over a long window for greater precision, but the game will occasionally invert probabilities
        // (45% chance every 75 updates), so we also compute a near-term forecast window to allow for early-detection of inversions so we can ditch our position.
        stk.nearTermForecast = forecast(stk.priceHistory.slice(0, nearTermForecastWindowLength));
        let preNearTermWindowProb = forecast(stk.priceHistory.slice(nearTermForecastWindowLength, nearTermForecastWindowLength + marketCycleLength)); // Used to detect the probability before the potential inversion event.
        // Detect whether it appears as though the probability of this stock has recently undergone an inversion (i.e. prob => 1 - prob)
        stk.possibleInversionDetected = has4s ? detectInversion(stk.prob, stk.lastTickProbability || stk.prob) : detectInversion(preNearTermWindowProb, stk.nearTermForecast);
        stk.lastTickProbability = stk.prob;
        if (stk.possibleInversionDetected) inversionsDetected.push(stk);
    }
    // Detect whether our auto-detected "stock market cycle" timing should be adjusted based on the number of potential inversions observed
    let summary = "";
    if (inversionsDetected.length > 0) {
        summary += `${inversionsDetected.length} Stocks appear to be reversing their outlook: ${inversionsDetected.map(s => s.sym).join(', ')} (threshold: ${inversionAgreementThreshold})\n`;
        if (inversionsDetected.length >= inversionAgreementThreshold && (has4s || currentHistory >= minTickHistory)) { // We believe we have detected the stock market cycle!
            const newPredictedCycleTick = has4s ? 0 : nearTermForecastWindowLength; // By the time we've detected it, we're this many ticks past the cycle start
            if (detectedCycleTick != newPredictedCycleTick)
                log(ns, `Threshold for changing predicted market cycle met (${inversionsDetected.length} >= ${inversionAgreementThreshold}). ` +
                    `Changing current market tick from ${detectedCycleTick} to ${newPredictedCycleTick}.`);
            marketCycleDetected = true;
            detectedCycleTick = newPredictedCycleTick;
            // Don't adjust this in the future unless we see another day with as much or even more agreement (capped at 14, it seems sometimes our cycles get out of sync with
            // actual cycles and we need to reset our clock even after previously determining the cycle with great certainty.)
            inversionAgreementThreshold = Math.max(14, inversionsDetected.length);
        }
    }
    // Act on any inversions (if trusted), compute the probability, and prepare the stock summary
    for (const stk of allStocks) {
        // Don't "trust" (act on) a detected inversion unless it's near the time when we're capable of detecting market cycle start. Avoids most false-positives.
        if (stk.possibleInversionDetected && (has4s && detectedCycleTick == 0 ||
            (!has4s && (detectedCycleTick >= nearTermForecastWindowLength / 2) && (detectedCycleTick <= nearTermForecastWindowLength + inversionLagTolerance))))
            stk.lastInversion = detectedCycleTick; // If we "trust" a probability inversion has occurred, probability will be calculated based on only history since the last inversion.
        else
            stk.lastInversion++;
        // Only take the stock history since after the last inversion to compute the probability of the stock.
        const probWindowLength = Math.min(longTermForecastWindowLength, stk.lastInversion);
        stk.longTermForecast = forecast(stk.priceHistory.slice(0, probWindowLength));
        if (!has4s) {
            stk.prob = stk.longTermForecast;
            stk.probStdDev = Math.sqrt((stk.prob * (1 - stk.prob)) / probWindowLength);
        }
        const signalStrength = 1 + (stk.bullish() ? (stk.nearTermForecast > stk.prob ? 1 : 0) + (stk.prob > 0.8 ? 1 : 0) : (stk.nearTermForecast < stk.prob ? 1 : 0) + (stk.prob < 0.2 ? 1 : 0));
        if (prepSummary) { // Example: AERO  ++   Prob: 54% (t51: 54%, t10: 67%) tLast⇄:190 Vol:0.640% ER: 2.778BP Spread:1.784% ttProfit: 65 Pos: 14.7M long  (held 189 ticks)
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
    // Print a summary of stocks as of this most recent tick (if enabled)
    if (prepSummary) {
        summary += `Market day ${detectedCycleTick + 1}${marketCycleDetected ? '' : '?'} of ${marketCycleLength} (${marketCycleDetected ? (100 * inversionAgreementThreshold / 19).toPrecision(2) : '0'}% certain) ` +
            `Current Stock Summary and Pre-4S Forecasts (by best payoff-time):\n` + allStocks.sort(purchaseOrder).map(s => s.debugLog).join("\n")
        if (showMarketSummary) await updateForecastFile(ns, summary); else log(ns, summary);
    }
    // Write out a file of stock probabilities so that other scripts can make use of this (e.g. hack orchestrator can manipulate the stock market)
    await ns.write('/Temp/stock-probabilities.txt', JSON.stringify(Object.fromEntries(
        allStocks.map(stk => [stk.sym, { prob: stk.prob, sharesLong: stk.sharesLong, sharesShort: stk.sharesShort }]))), "w");
}

// Helpers to display the stock market summary in a separate window.
let summaryFile = '/Temp/stockmarket-summary.txt';
let updateForecastFile = async (ns, summary) => await ns.write(summaryFile, summary, 'w');
let launchSummaryTail = async ns => {
    let summaryTailScript = summaryFile.replace('.txt', '-tail.js');
    if (await getNsDataThroughFile(ns, `ns.scriptRunning('${summaryTailScript}', ns.getHostname())`, '/Temp/stockmarket-summary-is-running.txt'))
        return;
    //await getNsDataThroughFile(ns, `ns.scriptKill('${summaryTailScript}', ns.getHostname())`, summaryTailScript.replace('.js', '-kill.js')); // Only needed if we're changing the script below
    await runCommand(ns, `ns.disableLog('sleep'); tail(ns); let lastRead = '';
        while (true) {
            let read = ns.read('${summaryFile}');
            if (lastRead != read) ns.print(lastRead = read);
            await ns.sleep(1000);
        }`, summaryTailScript);
}

// Ram-dodging helpers that spawn temporary scripts to buy/sell rather than pay 2.5GB ram per variant
let buyStockWrapper = async (ns, sym, numShares) => await transactStock(ns, sym, numShares, 'buyStock'); // ns.stock.buyStock(sym, numShares);
let buyShortWrapper = async (ns, sym, numShares) => await transactStock(ns, sym, numShares, 'buyShort'); // ns.stock.buyShort(sym, numShares);
let sellStockWrapper = async (ns, sym, numShares) => await transactStock(ns, sym, numShares, 'sellStock'); // ns.stock.sellStock(sym, numShares);
let sellShortWrapper = async (ns, sym, numShares) => await transactStock(ns, sym, numShares, 'sellShort'); // ns.stock.sellShort(sym, numShares);
let transactStock = async (ns, sym, numShares, action) =>
    await getNsDataThroughFile(ns, `ns.stock.${action}(ns.args[0], ns.args[1])`, null, [sym, numShares]);

/** @param {NS} ns
 * Automatically buys either a short or long position depending on the outlook of the stock. */
async function doBuy(ns, stk, sharesToBuy) {
    // We include -2*commission in the "holdings value" of our stock, but if we make repeated purchases of the same stock, we have to track
    // the additional commission somewhere. So only subtract it from our running profit if this isn't our first purchase of this symbol
    if (stk.owned())
        totalProfit -= commission;
    let long = stk.bullish();
    let expectedPrice = long ? stk.ask_price : stk.bid_price; // Depends on whether we will be buying a long or short position
    log(ns, `INFO: ${long ? 'Buying  ' : 'Shorting'} ${formatNumberShort(sharesToBuy, 3, 3).padStart(5)} (` +
        `${stk.maxShares == sharesToBuy + stk.ownedShares() ? '@max shares' : `${formatNumberShort(sharesToBuy + stk.ownedShares(), 3, 3).padStart(5)}/${formatNumberShort(stk.maxShares, 3, 3).padStart(5)}`}) ` +
        `${stk.sym.padEnd(5)} @ ${formatMoney(expectedPrice).padStart(9)} for ${formatMoney(sharesToBuy * expectedPrice).padStart(9)} (Spread:${(stk.spread_pct * 100).toFixed(2)}% ` +
        `ER:${formatBP(stk.expectedReturn()).padStart(8)}) Ticks to Profit: ${stk.timeToCoverTheSpread().toFixed(2)}`, noisy, 'info');
    let price = mock ? expectedPrice : Number(await transactStock(ns, stk.sym, sharesToBuy, long ? 'buyStock' : 'buyShort'));
    // The rest of this work is for troubleshooting / mock-mode purposes
    if (price == 0) {
        const playerMoney = (await getPlayerInfo(ns)).money;
        if (playerMoney < sharesToBuy * expectedPrice)
            log(ns, `WARN: Failed to ${long ? 'buy' : 'short'} ${stk.sym} because money just recently dropped to ${formatMoney(playerMoney)} and we can no longer afford it.`, noisy);
        else
            log(ns, `ERROR: Failed to ${long ? 'buy' : 'short'} ${stk.sym} @ ${formatMoney(expectedPrice)} (0 was returned) despite having ${formatMoney(playerMoney)}.`, true, 'error');
        return 0;
    } else if (price != expectedPrice) {
        log(ns, `WARNING: ${long ? 'Bought' : 'Shorted'} ${stk.sym} @ ${formatMoney(price)} but expected ${formatMoney(expectedPrice)} (spread: ${formatMoney(stk.spread)})`, false, 'warning');
        price = expectedPrice; // Known Bitburner bug for now, short returns "price" instead of "bid_price". Correct this so running profit calcs are correct.
    }
    if (mock && long) stk.boughtPrice = (stk.boughtPrice * stk.sharesLong + price * sharesToBuy) / (stk.sharesLong + sharesToBuy);
    if (mock && !long) stk.boughtPriceShort = (stk.boughtPriceShort * stk.sharesShort + price * sharesToBuy) / (stk.sharesShort + sharesToBuy);
    if (long) stk.sharesLong += sharesToBuy; else stk.sharesShort += sharesToBuy; // Maintained for mock mode, otherwise, redundant (overwritten at next refresh)
    return sharesToBuy * price + commission; // Return the amount spent on the transaction so it can be subtracted from our cash on hand
}

/** @param {NS} ns
 * Sell our current position in this stock. */
async function doSellAll(ns, stk) {
    let long = stk.sharesLong > 0;
    if (long && stk.sharesShort > 0) // Detect any issues here - we should always sell one before buying the other.
        log(ns, `ERROR: Somehow ended up both ${stk.sharesShort} short and ${stk.sharesLong} long on ${stk.sym}`, true, 'error');
    let expectedPrice = long ? stk.bid_price : stk.ask_price; // Depends on whether we will be selling a long or short position
    let sharesSold = long ? stk.sharesLong : stk.sharesShort;
    let price = mock ? expectedPrice : await transactStock(ns, stk.sym, sharesSold, long ? 'sellStock' : 'sellShort');
    const profit = (long ? stk.sharesLong * (price - stk.boughtPrice) : stk.sharesShort * (stk.boughtPriceShort - price)) - 2 * commission;
    log(ns, `${profit > 0 ? 'SUCCESS' : 'WARNING'}: Sold all ${formatNumberShort(sharesSold, 3, 3).padStart(5)} ${stk.sym.padEnd(5)} ${long ? ' long' : 'short'} positions ` +
        `@ ${formatMoney(price).padStart(9)} for a ` + (profit > 0 ? `PROFIT of ${formatMoney(profit).padStart(9)}` : ` LOSS  of ${formatMoney(-profit).padStart(9)}`) + ` after ${stk.ticksHeld} ticks`,
        noisy, noisy ? (profit > 0 ? 'success' : 'error') : undefined);
    if (price == 0) {
        log(ns, `ERROR: Failed to sell ${sharesSold} ${stk.sym} ${long ? 'shares' : 'shorts'} @ ${formatMoney(expectedPrice)} - 0 was returned.`, true, 'error');
        return 0;
    } else if (price != expectedPrice) {
        log(ns, `WARNING: Sold ${stk.sym} ${long ? 'shares' : 'shorts'} @ ${formatMoney(price)} but expected ${formatMoney(expectedPrice)} (spread: ${formatMoney(stk.spread)})`, false, 'warning');
        price = expectedPrice; // Known Bitburner bug for now, sellSort returns "price" instead of "ask_price". Correct this so running profit calcs are correct.
    }
    if (long) stk.sharesLong -= sharesSold; else stk.sharesShort -= sharesSold; // Maintained for mock mode, otherwise, redundant (overwritten at next refresh)
    totalProfit += profit;
    return price * sharesSold - commission; // Return the amount of money recieved from the transaction
}

let formatBP = fraction => formatNumberShort(fraction * 100 * 100, 3, 2) + " BP";

/** Log / tprint / toast helper.
 * @param {NS} ns */
let log = (ns, message, tprint = false, toastStyle = "") => {
    if (message == lastLog) return;
    ns.print(message);
    if (tprint) ns.tprint(message);
    if (toastStyle) ns.toast(message, toastStyle);
    return lastLog = message;
}

function doStatusUpdate(ns, stocks, myStocks, hudElement = null) {
    let maxReturnBP = 10000 * Math.max(...myStocks.map(s => s.absReturn())); // The largest return (in basis points) in our portfolio
    let minReturnBP = 10000 * Math.min(...myStocks.map(s => s.absReturn())); // The smallest return (in basis points) in our portfolio
    let est_holdings_cost = myStocks.reduce((sum, stk) => sum + (stk.owned() ? commission : 0) +
        stk.sharesLong * stk.boughtPrice + stk.sharesShort * stk.boughtPriceShort, 0);
    let liquidation_value = myStocks.reduce((sum, stk) => sum - (stk.owned() ? commission : 0) + stk.positionValue(), 0);
    let status = `Long ${myStocks.filter(s => s.sharesLong > 0).length}, Short ${myStocks.filter(s => s.sharesShort > 0).length} of ${stocks.length} stocks ` +
        (myStocks.length == 0 ? '' : `(ER ${minReturnBP.toFixed(1)}-${maxReturnBP.toFixed(1)} BP) `) +
        `Profit: ${formatMoney(totalProfit, 3)} Holdings: ${formatMoney(liquidation_value, 3)} (Cost: ${formatMoney(est_holdings_cost, 3)}) ` +
        `Net: ${formatMoney(totalProfit + liquidation_value - est_holdings_cost, 3)}`
    log(ns, status);
    if (hudElement) hudElement.innerText = formatMoney(liquidation_value, 6, 3);
}

/** @param {NS} ns **/
async function liquidate(ns) {
    allStockSymbols ??= await getStockSymbols(ns);
    if (allStockSymbols == null) return; // Nothing to liquidate, no API Access
    let totalStocks = 0, totalSharesLong = 0, totalSharesShort = 0, totalRevenue = 0;
    const dictPositions = mock ? null : await getStockInfoDict(ns, 'getPosition');
    for (const sym of allStockSymbols) {
        var [sharesLong, , sharesShort, avgShortCost] = dictPositions[sym];
        if (sharesLong + sharesShort == 0) continue;
        totalStocks++, totalSharesLong += sharesLong, totalSharesShort += sharesShort;
        if (sharesLong > 0) totalRevenue += (await sellStockWrapper(ns, sym, sharesLong)) * sharesLong - commission;
        if (sharesShort > 0) totalRevenue += (2 * avgShortCost - (await sellShortWrapper(ns, sym, sharesShort))) * sharesShort - commission;
    }
    log(ns, `Sold ${totalSharesLong.toLocaleString('en')} long shares and ${totalSharesShort.toLocaleString('en')} short shares ` +
        `in ${totalStocks} stocks for ${formatMoney(totalRevenue, 3)}`, true, 'success');
}

/** @param {NS} ns **/
/** @param {Player} playerStats **/
async function tryGet4SApi(ns, playerStats, budget) {
    if (await checkAccess(ns, 'has4SDataTIXAPI')) return false; // Only return true if we just bought it
    const cost4sData = 1E9 * bitNodeMults.FourSigmaMarketDataCost;
    const cost4sApi = 25E9 * bitNodeMults.FourSigmaMarketDataApiCost;
    const has4S = await checkAccess(ns, 'has4SData');
    const totalCost = (has4S ? 0 : cost4sData) + cost4sApi;
    // Liquidate shares if it would allow us to afford 4S API data
    if (totalCost > budget) /* Need to reserve some money to invest */
        return false;
    if (playerStats.money < totalCost)
        await liquidate(ns);
    if (!has4S) {
        if (await tryBuy(ns, 'purchase4SMarketData'))
            log(ns, `SUCCESS: Purchased 4SMarketData for ${formatMoney(cost4sData)} ` +
                `(At ${formatDuration(getTimeInBitnode())} into BitNode)`, true, 'success');
        else
            log(ns, 'ERROR attempting to purchase 4SMarketData!', false, 'error');
    }
    if (await tryBuy(ns, 'purchase4SMarketDataTixApi')) {
        log(ns, `SUCCESS: Purchased 4SMarketDataTixApi for ${formatMoney(cost4sApi)} ` +
            `(At ${formatDuration(getTimeInBitnode())} into BitNode)`, true, 'success');
        return true;
    } else {
        log(ns, 'ERROR attempting to purchase 4SMarketDataTixApi!', false, 'error');
    }
    return false;
}

/** @param {NS} ns
 * @param {"hasWSEAccount"|"hasTIXAPIAccess"|"has4SData"|"has4SDataTIXAPI"} stockFn
 * Helper to check for one of the stock access functions */
async function checkAccess(ns, stockFn) {
    return await getNsDataThroughFile(ns, `ns.stock.${stockFn}()`)
}

/** @param {NS} ns
 * @param {"purchaseWseAccount"|"purchaseTixApi"|"purchase4SMarketData"|"purchase4SMarketDataTixApi"} stockFn
 * Helper to try and buy a stock access. Yes, the code is the same as above, but I wanted to be explicit. */
async function tryBuy(ns, stockFn) {
    return await getNsDataThroughFile(ns, `ns.stock.${stockFn}()`)
}

/** @param {NS} ns
 * @param {number} budget - The amount we are willing to spend on WSE and API access
 * Tries to purchase access to the stock market **/
async function tryGetStockMarketAccess(ns, budget) {
    if (await checkAccess(ns, 'hasTIXAPIAccess')) return true; // Already have access
    const costWseAccount = 200E6;
    const costTixApi = 5E9;
    const hasWSE = await checkAccess(ns, 'hasWSEAccount');
    const totalCost = (hasWSE ? 0 : costWseAccount) + costTixApi;
    if (totalCost > budget) return false;
    if (!hasWSE) {
        if (await tryBuy(ns, 'purchaseWseAccount'))
            log(ns, `SUCCESS: Purchased a WSE (stockmarket) account for ${formatMoney(costWseAccount)} ` +
                `(At ${formatDuration(getTimeInBitnode())} into BitNode)`, true, 'success');
        else
            log(ns, 'ERROR attempting to purchase WSE account!', false, 'error');
    }
    if (await tryBuy(ns, 'purchaseTixApi')) {
        log(ns, `SUCCESS: Purchased Tix (stockmarket) Api access for ${formatMoney(costTixApi)} ` +
            `(At ${formatDuration(getTimeInBitnode())} into BitNode)`, true, 'success');
        return true;
    } else
        log(ns, 'ERROR attempting to purchase Tix Api!', false, 'error');
    return false;
}

function initializeHud() {
    const d = eval("document");
    let htmlDisplay = d.getElementById("stock-display-1");
    if (htmlDisplay !== null) return htmlDisplay;
    // Get the custom display elements in HUD.
    let customElements = d.getElementById("overview-extra-hook-0").parentElement.parentElement;
    // Make a clone of the hook for extra hud elements, and move it up under money
    let stockValueTracker = customElements.cloneNode(true);
    // Remove any nested elements created by stats.js
    stockValueTracker.querySelectorAll("p > p").forEach(el => el.parentElement.removeChild(el));
    // Change ids since duplicate id's are invalid
    stockValueTracker.querySelectorAll("p").forEach((el, i) => el.id = "stock-display-" + i);
    // Get out output element
    htmlDisplay = stockValueTracker.querySelector("#stock-display-1");
    // Display label and default value
    stockValueTracker.querySelectorAll("p")[0].innerText = "Stock";
    htmlDisplay.innerText = "$0.000 "
    // Insert our element right after Money
    customElements.parentElement.insertBefore(stockValueTracker, customElements.parentElement.childNodes[2]);
    return htmlDisplay;
}