import {
    instanceCount, getConfiguration, getNsDataThroughFile, runCommand, getActiveSourceFiles, tryGetBitNodeMultipliers,
    formatMoney, formatNumberShort, formatDuration, getStockSymbols
} from './helpers.js'

// ============================================================
// 全局配置变量
// ============================================================

let disableShorts = false;
let commission = 100000;   // 买卖佣金。预期收益必须超过此值才会买入
let totalProfit = 0.0;     // 记录自启动以来的累计收益
let lastLog = "";          // 避免重复日志：仅在消息变化时才输出
let allStockSymbols = null; // 启动时收集的所有股票代码集合
let mock = false;          // 模拟模式：只记录买卖操作，不实际执行交易
let noisy = false;         // 详细模式：每次买卖时打印并弹窗通知

// 4S 数据之前的配置（在没有 4S 数据时影响交易策略）
let showMarketSummary = false;  // 启用后，在独立窗口中持续显示市场预判摘要
let minTickHistory;             // 需要积累至少这么多历史数据才能给出预测
let longTermForecastWindowLength;  // 用于计算历史概率的长期窗口长度（无反转时）
let nearTermForecastWindowLength;  // 用于检测近期反转趋势的短期窗口长度

// 以下常量是预 4S 阶段的硬编码参数（不可通过命令行配置），但可能需要微调
const MARKET_CYCLE_LENGTH = 75;      // 每这么多 tick，所有股票有 45% 概率发生"反转"
const MAX_TICK_HISTORY = 151;        // 保留的最大历史价格记录数
const INVERSION_DETECTION_TOLERANCE = 0.10; // 近期预测与长期预测偏差在此范围内视为潜在反转
const INVERSION_LAG_TOLERANCE = 5;   // 反转可在预期检测时间之后额外信任这么多 tick
// (备注：33 只股票 × 每周期 45% 反转概率 ≈ 每周期约 15 次预期反转)

// 以下预 4S 变量在脚本运行期间动态变化
let marketCycleDetected = false;  // 在检测到市场周期之前，不应做出冒险的购买决策
let detectedCycleTick = 0;        // 检测到市场周期点后重置为零
let inversionAgreementThreshold = 6; // 当这么多股票同时被检测为"反转"，确认市场周期点

const EXPECTED_TICK_TIME = 6000;
const CATCH_UP_TICK_TIME = 4000;
let lastTick = 0;
const SLEEP_INTERVAL = 1000;

let resetInfo = (/**@returns{ResetInfo}*/() => undefined)();
let bitNodeMults = (/**@returns{BitNodeMultipliers}*/() => undefined)();

// ============================================================
// 命令行参数定义
// ============================================================

let options;
const argsSchema = [
    ['l', false],                        // 停止其他 stockmaster.js 实例并卖出所有股票
    ['liquidate', false],                // 上述标志的长格式别名
    ['mock', false],                     // 模拟模式：只记录不实际买卖
    ['noisy', false],                    // 详细模式：每次买卖时打印并弹窗通知
    ['disable-shorts', false],           // 禁止做空。如未解锁 SF8.2 则自动启用
    ['reserve', null],                   // 保留不用于投资的固定金额
    ['fracB', 0.4],                      // 考虑继续买入之前，流动资产占总资产的最小比例
    ['fracH', 0.2],                      // 买入时保留的现金比例
    ['buy-threshold', 0.0001],           // 只买入预期收益高于此值的股票（默认 0.01% = 1 BP）
    ['sell-threshold', 0],               // 卖出预期收益低于此值的股票（默认 0%，即概率 ≤ 50% 时卖出）
    ['diversification', 0.34],           // 4S 数据之前，单只股票持仓不超过总资产此比例
    ['disableHud', false],               // 禁用 HUD 面板中的股票价值显示
    ['disable-purchase-tix-api', false], // 禁用自动购买 TIX API（如果尚未拥有）
    // 以下设置仅用于调整预 4S 阶段的交易策略
    ['show-pre-4s-forecast', false],     // 始终显示预 4S 预测（false 时仅在无持仓时显示）
    ['show-market-summary', false],      // 等同于 "show-pre-4s-forecast"
    ['pre-4s-buy-threshold-probability', 0.15],  // 预 4S：仅买入概率偏离 0.5 超过此值的股票
    ['pre-4s-buy-threshold-return', 0.0015],     // 预 4S：仅买入预期收益高于此值的股票（默认 0.15% = 15 BP）
    ['pre-4s-sell-threshold-return', 0.0005],    // 预 4S：卖出预期收益低于此值的股票（默认 0.05% = 5 BP）
    ['pre-4s-min-tick-history', 21],             // 预 4S：积累这么多历史数据后才开始交易决策（默认 21）
    ['pre-4s-forecast-window', 51],              // 预 4S：长期预测窗口长度（默认 51）
    ['pre-4s-inversion-detection-window', 10],   // 预 4S：反转检测窗口长度（默认 10）
    ['pre-4s-min-blackout-window', 10],          // 预 4S：市场周期点前多少 tick 不买入
    ['pre-4s-minimum-hold-time', 10],            // 预 4S：买入后至少持有多少 tick 才考虑卖出（默认 10）
    ['buy-4s-budget', 0.8],                      // 为购买 4S 数据愿牺牲的最大资金比例。设为 0 则永不购买
];

// ============================================================
// 自动补全
// ============================================================

export function autocomplete(data, args) {
    data.flags(argsSchema);
    return [];
}

// ============================================================
// 股票对象辅助函数（从 initAllStocks 提取为独立函数，避免每只股票重复创建函数实例）
// ============================================================

/** 计算预期收益（含保守标准差修正） */
function calcExpectedReturn(stk) {
    let normalizedProb = (stk.prob - 0.5);
    let conservativeProb = normalizedProb < 0
        ? Math.min(0, normalizedProb + stk.probStdDev)
        : Math.max(0, normalizedProb - stk.probStdDev);
    return stk.vol * conservativeProb;
}

/** 预期收益绝对值（适用于做多/做空均可的情况） */
function calcAbsReturn(stk) { return Math.abs(calcExpectedReturn(stk)); }

/** 看涨（概率 > 50%） */
function isBullish(stk) { return stk.prob > 0.5; }

/** 看跌 */
function isBearish(stk) { return !isBullish(stk); }

/** 持有总股数 */
function getOwnedShares(stk) { return stk.sharesLong + stk.sharesShort; }

/** 是否有持仓 */
function hasPosition(stk) { return getOwnedShares(stk) > 0; }

/** 多头持仓市值 */
function getLongValue(stk) { return stk.sharesLong * stk.bid_price; }

/** 空头持仓市值 */
function getShortValue(stk) { return stk.sharesShort * (2 * stk.boughtPriceShort - stk.ask_price); }

/** 总持仓市值 */
function getPositionValue(stk) { return getLongValue(stk) + getShortValue(stk); }

/** 在当前预期收益下，覆盖买卖价差所需的 tick 数
 *  由复利公式推导：future = current * (1 + er) ^ n，解 n */
function getTimeToCoverSpread(stk) {
    return Math.log(stk.ask_price / stk.bid_price) / Math.log(1 + calcAbsReturn(stk));
}

/** 黑名单窗口：在距市场周期结束这么多个 tick 内不应买入 */
function getBlackoutWindow(stk) { return Math.ceil(getTimeToCoverSpread(stk)); }

// ============================================================
// 主函数
// ============================================================

/** 需要 TIX API 访问权限。会尽快购买 4S 市场数据 API。
 * @param {NS} ns */
export async function main(ns) {
    const runOptions = getConfiguration(ns, argsSchema);
    if (!runOptions) return; // 无效参数或 --help 模式

    // 如果指定了 "liquidate" 命令，尝试终止其他正在交易的脚本实例
    // 注意：必须在重置全局状态之前立即执行（全局状态在多个脚本实例间共享）
    const hasTixApiAccess = await getNsDataThroughFile(ns, 'ns.stock.hasTixApiAccess()');
    if (runOptions.l || runOptions.liquidate) {
        if (!hasTixApiAccess) return log(ns, 'ERROR: 无法清算股票，因为没有 Tix Api 访问权限', true, 'error');
        log(ns, 'INFO: 正在终止其他 stockmaster 进程...', false, 'info');
        await runCommand(ns, `ns.ps().filter(proc => proc.filename == '${ns.getScriptName()}' && !proc.args.includes('-l') && !proc.args.includes('--liquidate'))` +
            `.forEach(proc => ns.kill(proc.pid))`, '/Temp/kill-stockmarket-scripts.js');
        log(ns, 'INFO: 正在检查并清算所有股票...', false, 'info');
        await liquidate(ns);
        return;
    }
    // 防止同时运行多个实例（即使参数不同）
    if ((await instanceCount(ns)) > 1) return;

    ns.disableLog("ALL");

    // 提取各类参数
    options = runOptions;
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
    longTermForecastWindowLength = options['pre-4s-forecast-window'] || (MARKET_CYCLE_LENGTH + 1);
    showMarketSummary = options['show-pre-4s-forecast'] || options['show-market-summary'];

    // 重置全局状态（避免上次运行残留）
    lastTick = 0;
    totalProfit = 0;
    lastLog = "";
    marketCycleDetected = false;
    detectedCycleTick = 0;
    inversionAgreementThreshold = 6;

    let myStocks = [], allStocks = [];
    let player = await getPlayerInfo(ns);
    resetInfo = await getNsDataThroughFile(ns, 'ns.getResetInfo()');

    // 如果没有 TIX API 访问权限，等待资金足够后自动购买
    if (!hasTixApiAccess) {
        if (options['disable-purchase-tix-api'])
            return log(ns, "ERROR: 你没有股票市场 API 访问权限，且 --disable-purchase-tix-api 已设置。", true);
        let success = false;
        log(ns, `INFO: 缺少股票市场 API 访问权限。（注意：拥有 SF8 后可免费获得。）` +
            `等待资金达到 50 亿后自动购买。（可使用 --disable-purchase-tix-api 禁用此功能。）`, true);
        do {
            await ns.sleep(SLEEP_INTERVAL);
            try {
                const reserve = options['reserve'] != null ? options['reserve'] : Number(ns.read("reserve.txt") || 0);
                player = await getPlayerInfo(ns);
                success = await tryGetStockMarketAccess(ns, player.money - reserve);
            } catch (err) {
                log(ns, `WARNING: stockmaster.js 捕获（并抑制）了等待购买股票市场访问权限时的异常错误：\n` +
                    (typeof err === 'string' ? err : err.message || JSON.stringify(err)), false, 'warning');
            }
        } while (!success);
    }

    // 检查源文件以确定是否允许做空
    const effectiveSourceFiles = await getActiveSourceFiles(ns, true);
    if (!disableShorts && (effectiveSourceFiles[8] ?? 0) < 2) {
        log(ns, "INFO: 做空功能已禁用（你尚未解锁做空权限）");
        disableShorts = true;
    }

    allStockSymbols = await getStockSymbols(ns);
    allStocks = await initAllStocks(ns);
    bitNodeMults = await tryGetBitNodeMultipliers(ns);

    if (showMarketSummary) await launchSummaryTail(ns);

    // 初始化 HUD 显示
    let hudElement = null;
    if (!disableHud) {
        hudElement = initializeHud();
        ns.atExit(() => hudElement.parentElement.parentElement.parentElement.removeChild(hudElement.parentElement.parentElement));
    }

    log(ns, `欢迎！请注意：所有股票购买起初都会显示净（未实现）亏损。这不仅是因为佣金，还因为每只股票都有"价差"（买入价与卖出价之间的差异）。` +
        `本脚本旨在买入最有可能超越该亏损并盈利的股票，但需要几分钟才能看到进展。\n\n` +
        `如果你决定停止脚本，请务必先卖出所有股票（可运行 'run ${ns.getScriptName()} --liquidate'）以取回资金。\n\n祝你好运！\n~ Insight\n\n`);

    let pre4s = true;
    let sortDirty = true; // 用于缓存排序结果：价格变化时标记为需要重新排序

    // ============================================================
    // 主循环
    // ============================================================
    while (true) {
        try {
            const playerStats = await getPlayerInfo(ns);
            const reserve = options['reserve'] != null ? options['reserve'] : Number(ns.read("reserve.txt") || 0);

            // 检查是否已获得 4S 访问权限（一旦获得，无需再次检查）
            if (pre4s) pre4s = !(await checkAccess(ns, "has4SDataTixApi"));
 
            const holdings = await refresh(ns, !pre4s, allStocks, myStocks);
            sortDirty = true; // refresh 可能更新了价格，标记排序失效

            const corpus = holdings + playerStats.money;
            const maxHoldings = (1 - fracH) * corpus;

            // 尝试购买 4S API
            if (pre4s && !mock && await tryGet4SApi(ns, playerStats, corpus * (options['buy-4s-budget'] - fracH) - reserve))
                continue;

            // 根据是否有 4S 数据选择不同的买卖阈值
            const thresholdToBuy = pre4s ? options['pre-4s-buy-threshold-return'] : options['buy-threshold'];
            const thresholdToSell = pre4s ? options['pre-4s-sell-threshold-return'] : options['sell-threshold'];

            // 更新 HUD 状态显示
            if (myStocks.length > 0)
                doStatusUpdate(ns, allStocks, myStocks, hudElement);
            else if (hudElement) hudElement.innerText = "$0.000 ";

            // 等待积累足够的历史数据
            if (pre4s && allStocks[0].priceHistory.length < minTickHistory) {
                log(ns, `正在积累股票价格历史数据 (${allStocks[0].priceHistory.length}/${minTickHistory})...`);
                await ns.sleep(SLEEP_INTERVAL);
                continue;
            }

            // -------------------------------------------------------
            // 卖出阶段：卖出预期收益低于阈值的持仓
            // -------------------------------------------------------
            let sales = 0;
            for (let stk of myStocks) {
                if (calcAbsReturn(stk) <= thresholdToSell
                    || (isBullish(stk) && stk.sharesShort > 0)
                    || (isBearish(stk) && stk.sharesLong > 0)) {
                    if (pre4s && stk.ticksHeld < pre4sMinHoldTime) {
                        if (!stk.warnedBadPurchase)
                            log(ns, `WARNING: 考虑卖出 ${stk.sym} (ER ${formatBP(calcAbsReturn(stk))})，但持有时长仅 ${stk.ticksHeld} tick，暂不卖出...`);
                        stk.warnedBadPurchase = true;
                    } else {
                        sales += await doSellAll(ns, stk);
                        stk.warnedBadPurchase = false;
                    }
                }
            }
            if (sales > 0) continue; // 卖出后立即循环刷新数据，再做买入决策

            // -------------------------------------------------------
            // 买入阶段：资金充裕时买入预期收益最高的股票
            // -------------------------------------------------------
            if (playerStats.money / corpus > fracB) {
                let cash = Math.min(playerStats.money - reserve, maxHoldings - holdings);

                // 估算距离下一个市场周期还有多少 tick
                const estTick = Math.max(detectedCycleTick,
                    MARKET_CYCLE_LENGTH - (!marketCycleDetected ? 10
                        : inversionAgreementThreshold <= 8 ? 20
                            : inversionAgreementThreshold <= 10 ? 30 : MARKET_CYCLE_LENGTH));

                // 按购买优先级排序（仅价格变化后才重新排序）
                const sortedStocks = sortDirty
                    ? [...allStocks].sort((a, b) =>
                        (Math.ceil(getTimeToCoverSpread(a)) - Math.ceil(getTimeToCoverSpread(b)))
                        || (calcAbsReturn(b) - calcAbsReturn(a)))
                    : allStocks;
                sortDirty = false;

                for (const stk of sortedStocks) {
                    if (cash <= 0) break;

                    // 不在黑名单窗口内买入
                    if (getBlackoutWindow(stk) >= MARKET_CYCLE_LENGTH - estTick) continue;
                    if (pre4s && (Math.max(pre4sMinHoldTime, pre4sMinBlackoutWindow) >= MARKET_CYCLE_LENGTH - estTick)) continue;

                    // 跳过已达持仓上限、预期收益不足、或禁止做空时的看跌股票
                    if (getOwnedShares(stk) == stk.maxShares
                        || calcAbsReturn(stk) <= thresholdToBuy
                        || (disableShorts && isBearish(stk))) continue;

                    // 预 4S：跳过反转太近或概率太接近 0.5 的股票
                    if (pre4s && (stk.lastInversion < minTickHistory
                        || Math.abs(stk.prob - 0.5) < pre4sBuyThresholdProbability)) continue;

                    // 分散化：单只股票持仓不超过总资产指定比例
                    let budget = Math.min(cash,
                        maxHoldings * (diversification + stk.spread_pct)
                        - getPositionValue(stk) * (1.01 + stk.spread_pct));

                    let purchasePrice = isBullish(stk) ? stk.ask_price : stk.bid_price;
                    let affordableShares = Math.floor((budget - commission) / purchasePrice);
                    let numShares = Math.min(stk.maxShares - getOwnedShares(stk), affordableShares);
                    if (numShares <= 0) continue;

                    // 确保在周期结束前能覆盖佣金成本
                    let ticksBeforeCycleEnd = MARKET_CYCLE_LENGTH - estTick - getTimeToCoverSpread(stk);
                    if (ticksBeforeCycleEnd < 1) continue;

                    let estEndOfCycleValue = numShares * purchasePrice
                        * ((calcAbsReturn(stk) + 1) ** ticksBeforeCycleEnd - 1);

                    let owned = getOwnedShares(stk) > 0;
                    if (estEndOfCycleValue <= 2 * commission) {
                        log(ns, (owned ? '' : `当前持有 ${formatNumberShort(getOwnedShares(stk), 3, 1)} 股 ${stk.sym}，` +
                            `市值 ${formatMoney(getPositionValue(stk))} ` +
                            `(${(100 * getPositionValue(stk) / maxHoldings).toFixed(1)}% 总资产，上限为 ` +
                            `${(diversification * 100).toFixed(1)}% --diversification)。\n`) +
                            `尽管 ${stk.sym} 的 ER 为 ${formatBP(calcAbsReturn(stk))}，` +
                            `但仍${owned ? '未追加' : '未'}买入。` +
                            `\n预算: ${formatMoney(budget)}，仅能购买 ${numShares.toLocaleString('en')}${owned ? ' 额外' : ''}股 ` +
                            `@ ${formatMoney(purchasePrice)}。` +
                            `\n预计市场周期剩余 ${MARKET_CYCLE_LENGTH - estTick} tick，减去覆盖价差所需的 ` +
                            `${getTimeToCoverSpread(stk).toFixed(1)} tick ` +
                            `（价差 ${(stk.spread_pct * 100).toFixed(2)}%），` +
                            `剩余 ${ticksBeforeCycleEnd.toFixed(1)} tick 仅能产生 ${formatMoney(estEndOfCycleValue)}，` +
                            `低于 2 倍佣金 (${formatMoney(2 * commission, 3)})`);
                    } else {
                        cash -= await doBuy(ns, stk, numShares);
                    }
                }
            }
        } catch (err) {
            log(ns, `WARNING: stockmaster.js 捕获（并抑制）了主循环中的异常错误：\n` +
                (typeof err === 'string' ? err : err.message || JSON.stringify(err)), false, 'warning');
        }
        await ns.sleep(SLEEP_INTERVAL);
    }
}

// ============================================================
// 辅助函数
// ============================================================

/** 获取玩家信息（通过临时脚本规避 RAM 开销）
 * @param {NS} ns
 * @returns {Promise<Player>} */
async function getPlayerInfo(ns) {
    return await getNsDataThroughFile(ns, `ns.getPlayer()`);
}

/** 获取进入当前 BitNode 的时长（毫秒） */
function getTimeInBitnode() { return Date.now() - resetInfo.lastNodeReset; }

/** 获取所有股票的某个属性字典（通过临时脚本规避 RAM 开销）
 * @param {NS} ns
 * @param {string} stockFunction - 要调用的 ns.stock 方法名 */
async function getStockInfoDict(ns, stockFunction) {
    allStockSymbols ??= await getStockSymbols(ns);
    if (allStockSymbols == null) throw new Error(`尚未获得 WSE API 访问权限，调用 ns.stock.${stockFunction} 为时过早。`);
    return await getNsDataThroughFile(ns,
        `Object.fromEntries(ns.args.map(sym => [sym, ns.stock.${stockFunction}(sym)]))`,
        `/Temp/stock-${stockFunction}.txt`, allStockSymbols);
}

/** 初始化所有股票对象
 * @param {NS} ns **/
async function initAllStocks(ns) {
    let dictMaxShares = await getStockInfoDict(ns, 'getMaxShares');
    return allStockSymbols.map(s => ({
        sym: s,
        maxShares: dictMaxShares[s],
        // 价格相关属性（每次 refresh 时更新）
        ask_price: 0,
        bid_price: 0,
        spread: 0,
        spread_pct: 0,
        price: 0,
        vol: 0,
        prob: 0,
        probStdDev: 0,
        // 持仓相关属性
        position: null,
        sharesLong: 0,
        boughtPrice: 0,
        sharesShort: 0,
        boughtPriceShort: 0,
        ticksHeld: 0,
        warnedBadPurchase: false,
        // 预 4S 预测属性
        priceHistory: [],
        lastInversion: 0,
        nearTermForecast: 0,
        longTermForecast: 0,
        lastTickProbability: 0,
        possibleInversionDetected: false,
        debugLog: '',
    }));
}

/** 刷新所有股票数据（价格、持仓等）
 * @param {NS} ns
 * @param {boolean} has4s - 是否拥有 4S 数据访问权限
 * @param {Object[]} allStocks - 所有股票对象数组
 * @param {Object[]} myStocks - 当前持仓股票数组（会被原地修改）
 * @returns {number} 总持仓市值 */
async function refresh(ns, has4s, allStocks, myStocks) {
    let holdings = 0;

    // 批量获取股票数据（按顺序调用以避免 RAM 问题）
    const dictAskPrices = await getStockInfoDict(ns, 'getAskPrice');
    const dictBidPrices = await getStockInfoDict(ns, 'getBidPrice');
    const dictVolatilities = !has4s ? null : await getStockInfoDict(ns, 'getVolatility');
    const dictForecasts = !has4s ? null : await getStockInfoDict(ns, 'getForecast');
    const dictPositions = mock ? null : await getStockInfoDict(ns, 'getPosition');

    // 检测是否有价格变动（意味着股票市场发生了 tick）
    const ticked = allStocks.some(stk => stk.ask_price !== dictAskPrices[stk.sym]);

    if (ticked) {
        const elapsed = Date.now() - lastTick;
        if (elapsed < EXPECTED_TICK_TIME - SLEEP_INTERVAL) {
            if (elapsed < CATCH_UP_TICK_TIME - SLEEP_INTERVAL) {
                let changedPrices = allStocks.filter(stk => stk.ask_price !== dictAskPrices[stk.sym]);
                log(ns, `WARNING: 检测到股票市场 tick 间隔仅 ${formatDuration(elapsed)}，` +
                    `预期 ~${formatDuration(EXPECTED_TICK_TIME)}。` +
                    (changedPrices.length >= 33 ? '(所有股票已更新)' :
                        `以下 ${changedPrices.length} 只股票价格变动：${changedPrices.map(stk =>
                            `${stk.sym} ${formatMoney(stk.ask_price)} -> ${formatMoney(dictAskPrices[stk.sym])}`).join(", ")}`),
                    false, 'warning');
            } else {
                log(ns, `INFO: 检测到快速股票市场 tick (${formatDuration(elapsed)})，可能是追赶离线时间。`);
            }
        }
        lastTick = Date.now();
    }

    // 更新所有股票的当前数据
    myStocks.length = 0;
    for (const stk of allStocks) {
        const sym = stk.sym;
        stk.ask_price = dictAskPrices[sym];
        stk.bid_price = dictBidPrices[sym];
        stk.spread = stk.ask_price - stk.bid_price;
        stk.spread_pct = stk.spread / stk.ask_price;
        stk.price = (stk.ask_price + stk.bid_price) / 2;
        stk.vol = has4s ? dictVolatilities[sym] : stk.vol;
        stk.prob = has4s ? dictForecasts[sym] : stk.prob;
        stk.probStdDev = has4s ? 0 : stk.probStdDev;

        // 更新持仓信息
        let [priorLong, priorShort] = [stk.sharesLong, stk.sharesShort];
        stk.position = mock ? null : dictPositions[sym];
        stk.sharesLong = mock ? (stk.sharesLong || 0) : (stk.position ? stk.position[0] : 0);
        stk.boughtPrice = mock ? (stk.boughtPrice || 0) : (stk.position ? stk.position[1] : 0);
        stk.sharesShort = mock ? (stk.sharesShort || 0) : (stk.position ? stk.position[2] : 0);
        stk.boughtPriceShort = mock ? (stk.boughtPriceShort || 0) : (stk.position ? stk.position[3] : 0);
        holdings += getPositionValue(stk);

        if (hasPosition(stk)) myStocks.push(stk);
        else stk.ticksHeld = 0;

        if (ticked) {
            // 更新持有时长
            stk.ticksHeld = !hasPosition(stk)
                || (priorLong > 0 && stk.sharesLong === 0)
                || (priorShort > 0 && stk.sharesShort === 0)
                ? 0 : 1 + (stk.ticksHeld || 0);
        }
    }

    if (ticked) await updateForecast(ns, allStocks, has4s);
    return holdings;
}

// ============================================================
// 预测相关函数
// ============================================================

/**
 * 基于历史价格计算股票上涨概率。
 * 优化：使用简单 for 循环替代 reduce，减少函数调用开销。
 * @param {number[]} history - 价格历史数组（索引 0 为最新价格）
 * @returns {number} 上涨比例（0~1）
 */
function forecast(history) {
    const len = history.length;
    if (len < 2) return 0.5; // 数据不足时返回中性概率
    let ups = 0;
    // 遍历相邻价格对，统计上涨次数
    for (let i = 1; i < len; i++) {
        if (history[i - 1] > history[i]) ups++;
    }
    return ups / (len - 1);
}

// 反转检测的容忍度常量
const TOL_HALF = INVERSION_DETECTION_TOLERANCE / 2;

/**
 * 检测两只股票的概率是否发生了反转（概率 p 变为 1-p）。
 * @param {number} p1 - 长期概率
 * @param {number} p2 - 短期概率
 * @returns {boolean} 是否检测到反转
 */
function detectInversion(p1, p2) {
    return (p1 >= 0.5 + TOL_HALF && p2 <= 0.5 - TOL_HALF && p2 <= (1 - p1) + INVERSION_DETECTION_TOLERANCE)
        || (p1 <= 0.5 - TOL_HALF && p2 >= 0.5 + TOL_HALF && p2 >= (1 - p1) - INVERSION_DETECTION_TOLERANCE);
}

/** 更新预测数据（合并了原来的多个循环为两个高效遍历）
 * @param {NS} ns
 * @param {Object[]} allStocks
 * @param {boolean} has4s */
async function updateForecast(ns, allStocks, has4s) {
    const currentHistory = allStocks[0].priceHistory.length;
    const prepSummary = showMarketSummary || mock
        || (!has4s && (currentHistory < minTickHistory
            || allStocks.filter(stk => hasPosition(stk)).length === 0));

    const inversionsDetected = []; // 收集发生反转的股票
    detectedCycleTick = (detectedCycleTick + 1) % MARKET_CYCLE_LENGTH;

    // ── 第一遍遍历：更新价格历史、波动率、预测、检测反转 ──
    for (const stk of allStocks) {
        // 价格历史（unshift 添加最新价格到头部）
        stk.priceHistory.unshift(stk.price);
        if (stk.priceHistory.length > MAX_TICK_HISTORY)
            stk.priceHistory.splice(MAX_TICK_HISTORY, 1);

        // 计算波动率（单 tick 内最大百分比变动）
        if (!has4s) {
            let maxVol = 0;
            const hist = stk.priceHistory;
            for (let i = 1; i < hist.length; i++) {
                const movement = Math.abs(hist[i - 1] - hist[i]) / hist[i];
                if (movement > maxVol) maxVol = movement;
            }
            stk.vol = maxVol;
        }

        // 近期预测（短期窗口）
        stk.nearTermForecast = forecast(stk.priceHistory.slice(0, nearTermForecastWindowLength));

        // 反转检测：对比反转前的概率与近期概率
        let preNearTermWindowProb = forecast(
            stk.priceHistory.slice(nearTermForecastWindowLength,
                nearTermForecastWindowLength + MARKET_CYCLE_LENGTH)
        );
        stk.possibleInversionDetected = has4s
            ? detectInversion(stk.prob, stk.lastTickProbability || stk.prob)
            : detectInversion(preNearTermWindowProb, stk.nearTermForecast);
        stk.lastTickProbability = stk.prob;
 
        if (stk.possibleInversionDetected) inversionsDetected.push(stk);
    }

    // ── 处理反转检测结果，调整市场周期 ──
    let summary = "";
    if (inversionsDetected.length > 0) {
        summary += `${inversionsDetected.length} 只股票出现趋势反转: ${inversionsDetected.map(s => s.sym).join(', ')} ` +
            `(阈值: ${inversionAgreementThreshold})\n`;
        if (inversionsDetected.length >= inversionAgreementThreshold
            && (has4s || currentHistory >= minTickHistory)) {
            const newPredictedCycleTick = has4s ? 0 : nearTermForecastWindowLength;
            if (detectedCycleTick !== newPredictedCycleTick)
                log(ns, `检测到市场周期变更条件已满足 (${inversionsDetected.length} >= ${inversionAgreementThreshold})。` +
                    `将当前市场 tick 从 ${detectedCycleTick} 更改为 ${newPredictedCycleTick}。`);
            marketCycleDetected = true;
            detectedCycleTick = newPredictedCycleTick;
            // 提高阈值，防止未来误判（上限 14）
            inversionAgreementThreshold = Math.max(14, inversionsDetected.length);
        }
    }

    // ── 第二遍遍历：应用反转、计算概率、生成调试摘要 ──
    for (const stk of allStocks) {
        // 判断是否信任本次反转检测
        if (stk.possibleInversionDetected && (
            has4s && detectedCycleTick === 0 ||
            (!has4s && detectedCycleTick >= nearTermForecastWindowLength / 2
                && detectedCycleTick <= nearTermForecastWindowLength + INVERSION_LAG_TOLERANCE))) {
            stk.lastInversion = detectedCycleTick;
        } else {
            stk.lastInversion++;
        }

        // 基于反转后的价格历史计算长期概率
        const probWindowLength = Math.min(longTermForecastWindowLength, stk.lastInversion);
        stk.longTermForecast = forecast(stk.priceHistory.slice(0, probWindowLength));
        if (!has4s) {
            stk.prob = stk.longTermForecast;
            stk.probStdDev = Math.sqrt((stk.prob * (1 - stk.prob)) / probWindowLength);
        }

        // 信号强度（用于可视化）
        const signalStrength = 1
            + (isBullish(stk) ? (stk.nearTermForecast > stk.prob ? 1 : 0) + (stk.prob > 0.8 ? 1 : 0)
                : (stk.nearTermForecast < stk.prob ? 1 : 0) + (stk.prob < 0.2 ? 1 : 0));

        if (prepSummary) {
            stk.debugLog = `${stk.sym.padEnd(5, '\xA0')} ${(isBullish(stk) ? '+' : '-').repeat(signalStrength).padEnd(3)} ` +
                `Prob:${(stk.prob * 100).toFixed(0).padStart(3)}% (t${probWindowLength.toFixed(0).padStart(2)}:${(stk.longTermForecast * 100).toFixed(0).padStart(3)}%, ` +
                `t${Math.min(stk.priceHistory.length, nearTermForecastWindowLength).toFixed(0).padStart(2)}:${(stk.nearTermForecast * 100).toFixed(0).padStart(3)}%) ` +
                `tLast⇄:${(stk.lastInversion + 1).toFixed(0).padStart(3)} Vol:${(stk.vol * 100).toFixed(2)}% ER:${formatBP(calcExpectedReturn(stk)).padStart(8)} ` +
                `Spread:${(stk.spread_pct * 100).toFixed(2)}% ttProfit:${getBlackoutWindow(stk).toFixed(0).padStart(3)}`;
            if (hasPosition(stk))
                stk.debugLog += ` Pos: ${formatNumberShort(getOwnedShares(stk), 3, 1)} (${getOwnedShares(stk) == stk.maxShares ? 'max' :
                    ((100 * getOwnedShares(stk) / stk.maxShares).toFixed(0).padStart(2) + '%')}) ${stk.sharesLong > 0 ? 'long ' : 'short'} (held ${stk.ticksHeld} ticks)`;
            if (stk.possibleInversionDetected) stk.debugLog += ' ⇄⇄⇄';
        }
    }

    // 生成并输出市场摘要
    if (prepSummary) {
        summary += `市场第 ${detectedCycleTick + 1}${marketCycleDetected ? '' : '?'}/${MARKET_CYCLE_LENGTH} 天 ` +
            `(${marketCycleDetected ? (100 * inversionAgreementThreshold / 19).toPrecision(2) : '0'}% 确定) ` +
            `当前股票摘要与预 4S 预测（按回本时间排序）：\n` +
            allStocks.sort((a, b) =>
                (Math.ceil(getTimeToCoverSpread(a)) - Math.ceil(getTimeToCoverSpread(b)))
                || (calcAbsReturn(b) - calcAbsReturn(a))
            ).map(s => s.debugLog).join("\n");
        if (showMarketSummary) await updateForecastFile(ns, summary); else log(ns, summary);
    }

    // 输出股票概率文件供其他脚本使用（如 hack 编排器可据此操纵市场）
    await ns.write('/Temp/stock-probabilities.txt', JSON.stringify(Object.fromEntries(
        allStocks.map(stk => [stk.sym, {
            prob: stk.prob,
            sharesLong: stk.sharesLong,
            sharesShort: stk.sharesShort
        }]))), "w");
}

// ============================================================
// 市场摘要窗口
// ============================================================

let summaryFile = '/Temp/stockmarket-summary.txt';
let updateForecastFile = async (ns, summary) => await ns.write(summaryFile, summary, 'w');

/** 启动独立的市场摘要显示窗口 */
let launchSummaryTail = async ns => {
    let summaryTailScript = summaryFile.replace('.txt', '-tail.js');
    if (await getNsDataThroughFile(ns,
        `ns.scriptRunning('${summaryTailScript}', ns.getHostname())`,
        '/Temp/stockmarket-summary-is-running.txt'))
        return;
    await runCommand(ns, `ns.disableLog('sleep'); tail(ns); let lastRead = '';
        while (true) {
            let read = ns.read('${summaryFile}');
            if (lastRead != read) ns.print(lastRead = read);
            await ns.sleep(1000);
        }`, summaryTailScript);
};

// ============================================================
// 交易函数
// ============================================================

/** 执行股票交易（通过临时脚本规避 2.5GB RAM 开销）
 * @param {NS} ns
 * @param {string} sym - 股票代码
 * @param {number} numShares - 股数
 * @param {string} action - 交易动作 ('buyStock'|'buyShort'|'sellStock'|'sellShort') */
async function transactStock(ns, sym, numShares, action) {
    return await getNsDataThroughFile(ns,
        `ns.stock.${action}(ns.args[0], ns.args[1])`, null, [sym, numShares]);
}

/** 买入股票（根据看涨/看跌自动选择做多或做空）
 * @param {NS} ns
 * @param {Object} stk - 股票对象
 * @param {number} sharesToBuy - 要买入的股数
 * @returns {number} 交易花费金额 */
async function doBuy(ns, stk, sharesToBuy) {
    // 非首次购买同一股票时，额外佣金从累计利润中扣除
    if (hasPosition(stk))
        totalProfit -= commission;

    let long = isBullish(stk);
    let expectedPrice = long ? stk.ask_price : stk.bid_price;
    log(ns, `INFO: ${long ? '买入  ' : '做空  '} ${formatNumberShort(sharesToBuy, 3, 3).padStart(5)} (` +
        `${stk.maxShares == sharesToBuy + getOwnedShares(stk) ? '@已达上限' :
            `${formatNumberShort(sharesToBuy + getOwnedShares(stk), 3, 3).padStart(5)}/${formatNumberShort(stk.maxShares, 3, 3).padStart(5)}`}) ` +
        `${stk.sym.padEnd(5)} @ ${formatMoney(expectedPrice).padStart(9)} 总额 ${formatMoney(sharesToBuy * expectedPrice).padStart(9)} ` +
        `(价差:${(stk.spread_pct * 100).toFixed(2)}% ER:${formatBP(calcExpectedReturn(stk)).padStart(8)}) ` +
        `回本 tick: ${getTimeToCoverSpread(stk).toFixed(2)}`, noisy, 'info');

    let price = mock ? expectedPrice : Number(await transactStock(ns, stk.sym, sharesToBuy, long ? 'buyStock' : 'buyShort'));

    if (price === 0) {
        const playerMoney = (await getPlayerInfo(ns)).money;
        if (playerMoney < sharesToBuy * expectedPrice)
            log(ns, `WARN: ${long ? '买入' : '做空'} ${stk.sym} 失败，资金不足 (${formatMoney(playerMoney)})。`, noisy);
        else
            log(ns, `ERROR: ${long ? '买入' : '做空'} ${stk.sym} @ ${formatMoney(expectedPrice)} 返回 0，` +
                `但资金为 ${formatMoney(playerMoney)}。`, true, 'error');
        return 0;
    } else if (price !== expectedPrice) {
        log(ns, `WARNING: ${long ? '买入' : '做空'} ${stk.sym} @ ${formatMoney(price)}，` +
            `预期 ${formatMoney(expectedPrice)} (价差: ${formatMoney(stk.spread)})`, false, 'warning');
        price = expectedPrice; // Bitburner 已知 bug：做空返回"price"而非"bid_price"
    }

    // 模拟模式下更新持仓
    if (mock && long)
        stk.boughtPrice = (stk.boughtPrice * stk.sharesLong + price * sharesToBuy) / (stk.sharesLong + sharesToBuy);
    if (mock && !long)
        stk.boughtPriceShort = (stk.boughtPriceShort * stk.sharesShort + price * sharesToBuy) / (stk.sharesShort + sharesToBuy);

    if (long) stk.sharesLong += sharesToBuy;
    else stk.sharesShort += sharesToBuy;

    return sharesToBuy * price + commission;
}

/** 卖出当前持仓
 * @param {NS} ns
 * @param {Object} stk - 股票对象
 * @returns {number} 交易收回金额 */
async function doSellAll(ns, stk) {
    let long = stk.sharesLong > 0;
    if (long && stk.sharesShort > 0)
        log(ns, `ERROR: 异常状态 - ${stk.sym} 同时持有 ${stk.sharesShort} 空头和 ${stk.sharesLong} 多头`, true, 'error');

    let expectedPrice = long ? stk.bid_price : stk.ask_price;
    let sharesSold = long ? stk.sharesLong : stk.sharesShort;
    let price = mock ? expectedPrice : await transactStock(ns, stk.sym, sharesSold, long ? 'sellStock' : 'sellShort');

    const profit = (long
        ? stk.sharesLong * (price - stk.boughtPrice)
        : stk.sharesShort * (stk.boughtPriceShort - price)) - 2 * commission;

    log(ns, `${profit > 0 ? 'SUCCESS' : 'WARNING'}: 卖出 ${formatNumberShort(sharesSold, 3, 3).padStart(5)} ` +
        `${stk.sym.padEnd(5)} ${long ? ' 多头' : ' 空头'} @ ${formatMoney(price).padStart(9)}，` +
        (profit > 0 ? `盈利 ${formatMoney(profit).padStart(9)}` : `亏损 ${formatMoney(-profit).padStart(9)}`) +
        ` (持有 ${stk.ticksHeld} tick)`,
        noisy, noisy ? (profit > 0 ? 'success' : 'error') : undefined);

    if (price === 0) {
        log(ns, `ERROR: 卖出 ${sharesSold} 股 ${stk.sym} ${long ? '多头' : '空头'} ` +
            `@ ${formatMoney(expectedPrice)} 失败 - 返回 0。`, true, 'error');
        return 0;
    } else if (price !== expectedPrice) {
        log(ns, `WARNING: 卖出 ${stk.sym} ${long ? '多头' : '空头'} @ ${formatMoney(price)}，` +
            `预期 ${formatMoney(expectedPrice)} (价差: ${formatMoney(stk.spread)})`, false, 'warning');
        price = expectedPrice;
    }

    if (long) stk.sharesLong -= sharesSold;
    else stk.sharesShort -= sharesSold;

    totalProfit += profit;
    return price * sharesSold - commission;
}

// ============================================================
// 格式化与日志
// ============================================================

/** 格式化为基点 (Basis Points) */
let formatBP = fraction => formatNumberShort(fraction * 100 * 100, 3, 2) + "\u202FBP";

/** 日志输出辅助函数（支持 print / tprint / toast）
 * @param {NS} ns */
let log = (ns, message, tprint = false, toastStyle = "") => {
    if (message === lastLog) return;
    ns.print(message);
    if (tprint) ns.tprint(message);
    if (toastStyle) ns.toast(message, toastStyle);
    return lastLog = message;
};

/** 更新状态显示（包括 HUD）
 * @param {NS} ns */
function doStatusUpdate(ns, stocks, myStocks, hudElement = null) {
    let maxReturnBP = 10000 * Math.max(...myStocks.map(s => calcAbsReturn(s)));
    let minReturnBP = 10000 * Math.min(...myStocks.map(s => calcAbsReturn(s)));
    let estHoldingsCost = myStocks.reduce((sum, stk) => sum + (hasPosition(stk) ? commission : 0) +
        stk.sharesLong * stk.boughtPrice + stk.sharesShort * stk.boughtPriceShort, 0);
    let liquidationValue = myStocks.reduce((sum, stk) => sum - (hasPosition(stk) ? commission : 0) + getPositionValue(stk), 0);
    let status = `多头 ${myStocks.filter(s => s.sharesLong > 0).length}, 空头 ${myStocks.filter(s => s.sharesShort > 0).length} / ${stocks.length} 只股票 ` +
        (myStocks.length === 0 ? '' : `(ER ${minReturnBP.toFixed(1)}-${maxReturnBP.toFixed(1)} BP) `) +
        `累计利润: ${formatMoney(totalProfit, 3)} 持仓: ${formatMoney(liquidationValue, 3)} ` +
        `(成本: ${formatMoney(estHoldingsCost, 3)}) 净收益: ${formatMoney(totalProfit + liquidationValue - estHoldingsCost, 3)}`;
    log(ns, status);
    if (hudElement) hudElement.innerText = formatMoney(liquidationValue, 6, 3);
}

// ============================================================
// 清算与 API 购买
// ============================================================

/** 清算所有持仓
 * @param {NS} ns **/
async function liquidate(ns) {
    allStockSymbols ??= await getStockSymbols(ns);
    if (allStockSymbols == null) return;

    let totalStocks = 0, totalSharesLong = 0, totalSharesShort = 0, totalRevenue = 0;
    const dictPositions = mock ? null : await getStockInfoDict(ns, 'getPosition');

    for (const sym of allStockSymbols) {
        var [sharesLong, , sharesShort, avgShortCost] = dictPositions[sym];
        if (sharesLong + sharesShort === 0) continue;
        totalStocks++;
        totalSharesLong += sharesLong;
        totalSharesShort += sharesShort;
        if (sharesLong > 0) totalRevenue += (await transactStock(ns, sym, sharesLong, 'sellStock')) * sharesLong - commission;
        if (sharesShort > 0) totalRevenue += (2 * avgShortCost - await transactStock(ns, sym, sharesShort, 'sellShort')) * sharesShort - commission;
    }

    log(ns, `已卖出 ${totalSharesLong.toLocaleString('en')} 股多头和 ${totalSharesShort.toLocaleString('en')} 股空头，` +
        `涉及 ${totalStocks} 只股票，收回 ${formatMoney(totalRevenue, 3)}`, true, 'success');
}

/** 尝试购买 4S 市场数据 API
 * @param {NS} ns
 * @param {Player} playerStats
 * @param {number} budget - 可用于购买 4S 的预算
 * @returns {boolean} 是否刚刚购买了 4S API */
async function tryGet4SApi(ns, playerStats, budget) {
    if (await checkAccess(ns, 'has4SDataTixApi')) return false;

    const cost4sData = 1E9 * bitNodeMults.FourSigmaMarketDataCost;
    const cost4sApi = 25E9 * bitNodeMults.FourSigmaMarketDataApiCost;
    const has4S = await checkAccess(ns, 'has4SData');
    const totalCost = (has4S ? 0 : cost4sData) + cost4sApi;

    if (totalCost > budget) return false;
    if (playerStats.money < totalCost) await liquidate(ns);

    if (!has4S) {
        if (await tryBuy(ns, 'purchase4SMarketData'))
            log(ns, `SUCCESS: 已购买 4S 市场数据，花费 ${formatMoney(cost4sData)} ` +
                `(BitNode 计时 ${formatDuration(getTimeInBitnode())})`, true, 'success');
        else
            log(ns, 'ERROR: 购买 4S 市场数据失败！', false, 'error');
    }

    if (await tryBuy(ns, 'purchase4SMarketDataTixApi')) {
        log(ns, `SUCCESS: 已购买 4S 市场数据 Tix API，花费 ${formatMoney(cost4sApi)} ` +
            `(BitNode 计时 ${formatDuration(getTimeInBitnode())})`, true, 'success');
        return true;
    } else {
        log(ns, 'ERROR: 购买 4S 市场数据 Tix API 失败！', false, 'error');
    }
    return false;
}

/** 检查是否拥有某股票访问功能
 * @param {NS} ns
 * @param {"hasWseAccount"|"hasTixApiAccess"|"has4SData"|"has4SDataTixApi"} stockFn */
async function checkAccess(ns, stockFn) {
    return await getNsDataThroughFile(ns, `ns.stock.${stockFn}()`);
}

/** 尝试购买某股票访问功能
 * @param {NS} ns
 * @param {"purchaseWseAccount"|"purchaseTixApi"|"purchase4SMarketData"|"purchase4SMarketDataTixApi"} stockFn */
async function tryBuy(ns, stockFn) {
    return await getNsDataThroughFile(ns, `ns.stock.${stockFn}()`);
}

/** 尝试获取股票市场访问权限
 * @param {NS} ns
 * @param {number} budget - 愿意花费的预算
 * @returns {boolean} 是否已拥有访问权限 */
async function tryGetStockMarketAccess(ns, budget) {
    if (await checkAccess(ns, 'hasTixApiAccess')) return true;

    const costWseAccount = 200E6;
    const costTixApi = 5E9;
    const hasWSE = await checkAccess(ns, 'hasWseAccount');
    const totalCost = (hasWSE ? 0 : costWseAccount) + costTixApi;

    if (totalCost > budget) return false;

    if (!hasWSE) {
        if (await tryBuy(ns, 'purchaseWseAccount'))
            log(ns, `SUCCESS: 已购买 WSE 账户，花费 ${formatMoney(costWseAccount)} ` +
                `(BitNode 计时 ${formatDuration(getTimeInBitnode())})`, true, 'success');
        else
            log(ns, 'ERROR: 购买 WSE 账户失败！', false, 'error');
    }

    if (await tryBuy(ns, 'purchaseTixApi')) {
        log(ns, `SUCCESS: 已购买 Tix API 访问权限，花费 ${formatMoney(costTixApi)} ` +
            `(BitNode 计时 ${formatDuration(getTimeInBitnode())})`, true, 'success');
        return true;
    } else {
        log(ns, 'ERROR: 购买 Tix API 失败！', false, 'error');
    }
    return false;
}

// ============================================================
// HUD 初始化
// ============================================================

/** 初始化 HUD 显示元素 */
function initializeHud() {
    const d = eval("document");
    let htmlDisplay = d.getElementById("stock-display-1");
    if (htmlDisplay !== null) return htmlDisplay;

    // 获取 HUD 中的自定义显示元素
    let customElements = d.getElementById("overview-extra-hook-0").parentElement.parentElement;
    // 克隆 hook 元素，插入到资金显示下方
    let stockValueTracker = customElements.cloneNode(true);
    // 清理嵌套元素
    stockValueTracker.querySelectorAll("p > p").forEach(el => el.parentElement.removeChild(el));
    // 修改 id 防止重复
    stockValueTracker.querySelectorAll("p").forEach((el, i) => el.id = "stock-display-" + i);
    // 获取输出元素
    htmlDisplay = stockValueTracker.querySelector("#stock-display-1");
    // 设置标签和默认值
    stockValueTracker.querySelectorAll("p")[0].innerText = "Stock";
    htmlDisplay.innerText = "$0.000 ";
    // 插入到 Money 显示之后
    customElements.parentElement.insertBefore(stockValueTracker, customElements.parentElement.childNodes[2]);
    return htmlDisplay;
}