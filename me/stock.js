/**
 * Bitburner 股票自动交易脚本 - 量化交易系统 
 * @param {NS} ns Bitburner 游戏API实例
 */
export async function main(ns) {
    // ===================== 核心配置 =====================
    const CONFIG = {
        RISK_PER_TRADE: 0.2,       // 单次交易的风险比例
        MAX_EXPOSURE: 0.8,          // 最大风险敞口比例
        TREND_WINDOW: 8,            // 短期移动平均线窗口大小
        BASE_WINDOW: 40,            // 长期移动平均线窗口大小
        RSI_WINDOW: 14,             // RSI指标窗口大小
        VOLATILITY_FILTER: 0.015,   // 波动率过滤阈值
        STOP_LOSS: 0.05,           // 止损阈值
        TAKE_PROFIT: 0.12,          // 止盈阈值
        ENABLE_SHORT: true,         // 是否启用卖空操作
        MAX_SHARE_RATIO: 0.4,      // 单股最大持仓比例
        FORECAST_BUY: 0.65,         // 做多预测阈值
        FORECAST_SELL: 0.35,        // 做空预测阈值
        DISPLAY_ROWS: 20,           // 仪表盘显示的最大行数
        CACHE_DURATION: 1000,       // 缓存有效时间（毫秒）
        ERROR_RETRY_LIMIT: 3,       // 错误重试次数
        PRICE_MEMORY: 150,          // 增加价格记忆长度
        MARKET_REGIME_WINDOW: 50,   // 市场状态判断窗口
        MAX_POSITIONS: 50,           // 最大持仓数量限制
        V: 'v7.0'
    };

    const COLORS = {
        reset: '\x1b[0m',           // 重置颜色
        bullish: '\x1b[38;5;46m',    // 牛市颜色（亮绿色）
        bearish: '\x1b[38;5;196m',   // 熊市颜色（亮红色）
        profit: '\x1b[38;5;47m',     // 盈利颜色（渐变绿色）
        loss: '\x1b[38;5;160m',      // 亏损颜色（渐变红色）
        warning: '\x1b[38;5;226m',   // 警告颜色（黄色）
        info: '\x1b[38;5;51m',       // 信息颜色（青色）
        highlight: '\x1b[38;5;213m',// 强调颜色（粉紫色）
        header: '\x1b[48;5;236m',    // 头部背景颜色（深灰色）
        rsiLow: '\x1b[38;5;46m',     // RSI低于30的颜色
        rsiMid: '\x1b[38;5;226m',    // RSI在30-70之间的颜色
        rsiHigh: '\x1b[38;5;196m'    // RSI高于70的颜色
    };

    const CACHE = {
        prices: new Map(),          // 存储股票价格缓存
        analysis: new Map(),        // 存储股票分析结果缓存
        lastUpdate: 0               // 上一次更新的时间戳
    };

    const METRICS = {
        apiCalls: 0,                // API调用次数
        processingTime: 0,          // 处理时间
        errorCount: 0,              // 错误计数
        lastCleanup: Date.now()     // 上一次清理的时间戳
    };

    const ErrorHandler = {
        retryCount: new Map(),      // 存储每个函数的重试次数
        async wrap(fn, maxRetries = CONFIG.ERROR_RETRY_LIMIT) {
            try {
                return await fn();  // 尝试执行函数
            } catch (error) {
                METRICS.errorCount++; // 记录错误
                const count = (ErrorHandler.retryCount.get(fn) || 0) + 1;
                ErrorHandler.retryCount.set(fn, count); // 更新重试次数

                if (count <= maxRetries) {
                    await ns.sleep(1000 * count); // 等待后重试
                    return await ErrorHandler.wrap(fn, maxRetries);
                }
                handleError(ns, error); // 处理错误
                return null;
            }
        }
    };

    const STATE = {
        symbols: [],                // 股票符号列表
        history: new Map(),         // 存储每只股票的历史数据
        transactions: [],           // 交易记录
        metrics: {
            totalProfit: 0,         // 总利润
            winRate: 0,             // 赢率
            maxDrawdown: 0,         // 最大回撤
            peakNetWorth: 0         // 净资产峰值
        }
    };

    const MARKET_STATE = {
        regime: 'normal',           // 市场状态：normal, volatile, trending
        momentum: 0,                // 市场动量
        volatility: 0,              // 市场波动率
        correlation: 0,             // 市场相关性
        lastUpdate: 0               // 最后更新时间
    };

    const [W, H] = ns.ui.windowSize();// 获取tail窗口大小
    ns.atExit(() => ns.ui.closeTail());
    ns.disableLog("ALL");           // 禁用所有日志
    ns.ui.setTailTitle(`StockManager ${CONFIG.V} [${ns.getScriptName()}]`); // 设置tail标题
    ns.ui.openTail();               // 打开tail窗口
    ns.ui.moveTail(W * 0.40, H * 0);// 移动tail窗口位置

    await initializeState();        // 初始化状态

    while (true) {
        ns.clearLog();                // 清除日志

        if (!(await check4SApiAccess())) continue;// 检查4S API访问权限

        const [marketVol, avgMomentum] = await Promise.all([
            getMarketVolatility(),   // 获取市场波动率
            getAverageMomentum()     // 获取平均动量
        ]);

        const volatilityFactor = Math.sqrt(marketVol / 0.1); // 计算波动因子
        const momentumFactor = 1 + Math.tanh(avgMomentum * 2); // 计算动量因子
        const riskAdjustment = 0.05 * volatilityFactor * momentumFactor; // 计算风险调整系数

        updateConfig({              // 更新配置参数
            VOLATILITY_FILTER: getRisk() > 0.1 ? 0.01 : 0.02,
            FORECAST_BUY: getRisk() > 0.1 ? 0.65 : 0.55,
            FORECAST_SELL: getRisk() > 0.1 ? 0.35 : 0.45,
            RISK_PER_TRADE: Math.min(Math.max(riskAdjustment, 0.01), 0.15)
        });

        const loopStart = Date.now();// 记录循环开始时间

        try {
            updateAllPrices();        // 更新所有股票价格

            const analyses = await Promise.all(
                STATE.symbols.map(async sym => {
                    const cachedPrice = CACHE.prices.get(sym);
                    if (cachedPrice) {
                        updateHistory(sym, cachedPrice); // 使用缓存价格更新历史数据
                    }
                    return analyzeStock(sym); // 分析股票
                })
            );

            analyses.forEach((analysis, i) =>
                CACHE.analysis.set(STATE.symbols[i], analysis)); // 缓存分析结果

            await Promise.all(STATE.symbols.map((sym, i) => {
                const analysis = analyses[i];
                managePosition(sym, analysis); // 管理头寸
                executeTrades(sym, analysis); // 执行交易
            }));

            const processingTime = Date.now() - loopStart; // 计算处理时间
            updateMetrics(processingTime); // 更新性能指标
            displayDashboard(); // 显示仪表盘

            cleanupCache(); // 清理缓存
        } catch (e) {
            handleError(ns, e); // 处理错误
        }

        const activePositions = getActivePositions().length; // 获取活跃持仓数量
        const windowHeight = (Math.min(activePositions, CONFIG.DISPLAY_ROWS) + 6) * 24 + 180; // 计算窗口高度
        ns.ui.resizeTail(800, windowHeight); // 调整tail窗口大小

        updateMarketState(); // 更新市场状态

        await ns.stock.nextUpdate(); // 等待下一个股票更新
    }

    // ===================== 初始化 =====================
    async function initializeState() {
        STATE.symbols = ns.stock.getSymbols(); // 获取所有股票符号
        STATE.history = new Map(); // 初始化历史数据存储

        await Promise.all(STATE.symbols.map(async sym => {
            const price = ns.stock.getPrice(sym); // 获取初始价格
            STATE.history.set(sym, {
                prices: new Array(100).fill(price), // 初始化价格数组
                maShortSum: 0,                      // 短期MA和
                maShortWindow: [],                  // 短期MA队列
                maLongSum: 0,                       // 长期MA和
                maLongWindow: [],                   // 长期MA队列
                rsi: 50,                            // 初始RSI值
                lastUpdate: Date.now()              // 最后更新时间
            });
        }));
    }

    // ===================== 数据更新 =====================
    function updateAllPrices() {
        const now = Date.now();
        if (now - CACHE.lastUpdate < CONFIG.CACHE_DURATION) {
            return; // 如果缓存未过期则跳过
        }

        STATE.symbols.forEach(sym => {
            const price = ns.stock.getPrice(sym); // 获取最新价格
            CACHE.prices.set(sym, price); // 缓存价格
            METRICS.apiCalls++; // 记录API调用
        });

        CACHE.lastUpdate = now; // 更新最后更新时间
    }

    function updateHistory(sym, cachedPrice = null) {
        const price = cachedPrice || ns.stock.getPrice(sym); // 使用缓存价格或获取最新价格
        const data = STATE.history.get(sym);

        if (!data.priceIndex) data.priceIndex = 0; // 初始化价格索引
        if (!data.priceArray) data.priceArray = new Array(100).fill(price); // 初始化价格数组

        data.priceArray[data.priceIndex] = price; // 更新价格数组
        data.priceIndex = (data.priceIndex + 1) % 100; // 更新价格索引

        data.prices = [...data.priceArray.slice(data.priceIndex), ...data.priceArray.slice(0, data.priceIndex)]; // 更新价格序列

        updateMA(data, 'maShort', CONFIG.TREND_WINDOW, price); // 更新短期MA
        updateMA(data, 'maLong', CONFIG.BASE_WINDOW, price); // 更新长期MA
        data.rsi = calculateRSI(data.prices); // 计算RSI
    }

    function updateMA(data, type, window, price) {
        const queue = data[`${type}Window`]; // 获取MA队列
        const sumKey = `${type}Sum`; // 获取MA和的键名

        queue.push(price); // 添加新价格到队列
        data[sumKey] += price; // 更新MA和

        if (queue.length > window) {
            const removed = queue.shift(); // 移除旧价格
            data[sumKey] -= removed; // 更新MA和
        }
        data[type] = data[sumKey] / queue.length; // 计算新的MA值
    }

    // ===================== 分析 =====================
    function analyzeStock(sym) {
        const data = STATE.history.get(sym); // 获取历史数据
        const volatility = ns.stock.getVolatility(sym);

        return {
            symbol: sym,                     // 股票符号
            bidPrice: ns.stock.getBidPrice(sym), // 买入价
            askPrice: ns.stock.getAskPrice(sym), // 卖出价
            trend: data.maShort > data.maLong ? 'bull' : 'bear', // 趋势判断
            rsi: data.rsi,                   // RSI值
            volatility: ns.stock.getVolatility(sym), // 波动率
            momentum: calculateMomentum(data.prices), // 动量
            forecast: ns.stock.getForecast(sym), // 预测值
            volatilityTrend: volatility / MARKET_STATE.volatility,
            correlation: calculateCorrelation(data.prices),
            efficiency: calculateEfficiency(data.prices),
        };
    }

    // ===================== 交易 =====================
    function executeTrades(sym, analysis) {
        const [longShares, , shortShares] = ns.stock.getPosition(sym); // 获取持仓信息
        const position = calculatePosition(sym, analysis); // 计算交易仓位

        const activePositions = getActivePositions().length;
        if (activePositions >= CONFIG.MAX_POSITIONS) {
            return;
        }

        const marketCondition = MARKET_STATE.regime === 'trending' ? 0.6 : 0.7;
        const positionScore = calculatePositionScore(analysis);

        if (analysis.trend === 'bull' && longShares <= 0 && positionScore > marketCondition) {
            const buyCondition = (
                analysis.forecast > CONFIG.FORECAST_BUY &&
                analysis.rsi < 30 &&
                analysis.volatility < CONFIG.VOLATILITY_FILTER
            );
            if (buyCondition) {
                const bought = ns.stock.buyStock(sym, position); // 买入股票
                if (bought > 0) logTransaction('Buy 📈', sym, bought, analysis.askPrice); // 记录交易
            }
        }

        if (CONFIG.ENABLE_SHORT && analysis.trend === 'bear' && shortShares === 0) {
            const shortCondition = (
                analysis.forecast < CONFIG.FORECAST_SELL &&
                analysis.rsi > 70 &&
                analysis.volatility < CONFIG.VOLATILITY_FILTER
            );
            if (shortCondition) {
                const sold = ns.stock.buyShort(sym, position); // 卖空股票
                if (sold > 0) logTransaction('Buy 📉', sym, sold, analysis.bidPrice); // 记录交易
            }
        }
    }

    function managePosition(sym, analysis) {
        const [long, longAvg, short, shortAvg] = ns.stock.getPosition(sym); // 获取持仓信息

        if (long > 0) {
            const currentPrice = analysis.bidPrice; // 当前买入价
            const profitRatio = (currentPrice - longAvg) / longAvg; // 计算盈利比率
            const currentProfit = long * (currentPrice - longAvg);

            // 修改卖出条件：保留止损，止盈改为高于平均收益1.2倍
            if (((profitRatio <= -CONFIG.STOP_LOSS && analysis.forecast < CONFIG.FORECAST_BUY - 0.05) ||
                (profitRatio > CONFIG.TAKE_PROFIT))) {
                const sold = ns.stock.sellStock(sym, long); // 卖出股票
                if (sold > 0) logTransaction('Sell 📈', sym, -long, currentPrice, currentProfit); // 记录交易
            }
        }

        if (short > 0) {
            const currentPrice = analysis.askPrice; // 当前卖出价
            const profitRatio = (shortAvg - currentPrice) / shortAvg; // 计算盈利比率
            const currentProfit = short * (shortAvg - currentPrice);

            // 修改卖出条件：保留止损，止盈改为高于平均收益1.2倍
            if (((profitRatio <= -CONFIG.STOP_LOSS && analysis.forecast > CONFIG.FORECAST_BUY + 0.05) ||
                (profitRatio > CONFIG.TAKE_PROFIT))) {
                const bought = ns.stock.sellShort(sym, short); // 平仓卖空
                if (bought > 0) logTransaction('Sell 📉', sym, -short, currentPrice, currentProfit); // 记录交易
            }
        }
    }

    // ===================== 仪表盘 =====================
    function displayDashboard() {
        ns.print("═".repeat(80)); // 打印分隔线
        ns.print(`${COLORS.header}─[ ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} ]─[ 量化交易系统 ${CONFIG.V} ]` + '─'.repeat(45)); // 打印头部信息

        const volColor = getRisk() > 0.2 ? COLORS.warning : COLORS.info; // 根据风险设置颜色
        ns.print([
            `${COLORS.info}资产: ${fmtMoney(getNetWorth())}${COLORS.reset}`, // 净资产
            `${COLORS.profit}盈利: ${fmtMoney(STATE.metrics.totalProfit)}${COLORS.reset}`, // 总利润
            `${COLORS.warning}回撤: ${fmtPct(STATE.metrics.maxDrawdown)}${COLORS.reset}`, // 最大回撤
            `${COLORS.highlight}杠杆: ${getLeverage().toFixed(1)}x${COLORS.reset}`, // 杠杆倍数
            `${volColor}风险: ${getRisk().toFixed(2)}${COLORS.reset}` // 风险水平
        ].join(' | ')); // 打印关键指标
        ns.print("═".repeat(80)); // 打印分隔线

        ns.print(`${COLORS.header}──📦 持仓信息 ${'─'.repeat(80 - 14)}${COLORS.reset}`); // 打印持仓标题
        getActivePositions()
            .sort((a, b) => b.totalProfit - a.totalProfit) // 按利润排序
            .slice(0, CONFIG.DISPLAY_ROWS) // 截取显示行数
            .forEach((p, i) => ns.print(fmtPosition(p, i + 1))); // 打印持仓信息
        ns.print("═".repeat(80)); // 打印分隔线

        ns.print(`${COLORS.header}──📜 最近交易记录 ${'─'.repeat(80 - 20)}${COLORS.reset}`); // 打印交易记录标题
        STATE.transactions.slice(-5).forEach(t => {
            const profitColor = t.profit >= 0 ? COLORS.profit : COLORS.loss; // 根据收益设置颜色
            ns.print(
                ` ${COLORS.info}${t.time} ${t.icon.padEnd(5)} ` +
                `${getTrendColor(t.sym)}${t.sym.padEnd(5)} ` +
                `${COLORS.highlight}${fmtNum(Math.abs(t.shares))}@${fmtNum(t.price)} ` +
                `${profitColor}${t.profit >= 0 ? '▲' : '▼'} ` +
                `${t.profit != 0 ? fmtMoney(t.profit) : ''}${COLORS.reset}`
            ); // 打印交易记录
        });
    }

    // ===================== 辅助函数 =====================
    function getBar(ratio, color) {
        const filled = Math.floor(ratio * 5); // 计算填充条长度
        return color + '■'.repeat(filled) + COLORS.reset + '□'.repeat(5 - filled); // 返回条形图字符串
    }

    function getTrendColor(sym) {
        const analysis = CACHE.analysis.get(sym); // 获取分析结果
        return analysis.trend === 'bull' ? COLORS.bullish : COLORS.bearish; // 根据趋势返回颜色
    }

    function fmtPosition(pos, index) {
        const rsiColor = pos.rsi < 30 ? COLORS.rsiLow :
            pos.rsi > 70 ? COLORS.rsiHigh : COLORS.rsiMid; // 根据RSI值返回颜色
        const volColor = pos.volatility > CONFIG.VOLATILITY_FILTER
            ? COLORS.warning : COLORS.reset; // 根据波动率返回颜色
        const trendIcon = pos.trend === 'bull'
            ? `${COLORS.bullish}▲${COLORS.reset}`
            : `${COLORS.bearish}▼${COLORS.reset}`; // 根据趋势返回图标

        const longRatio = pos.long[0] / pos.maxShares; // 长仓比例
        const shortRatio = pos.short[0] / pos.maxShares; // 短仓比例

        const longDisplay = pos.long[0] > 0 ?
            `${COLORS.info}📈:${fmtNum(pos.long[0])} ${getBar(longRatio, COLORS.bullish)}` : ''; // 长仓显示
        const shortDisplay = pos.short[0] > 0 ?
            `${COLORS.highlight}📉:${fmtNum(pos.short[0])} ${getBar(shortRatio, COLORS.bearish)}` : ''; // 短仓显示

        return [
            ` ${index.toString().padStart(2)} ${pos.sym.padEnd(5)} ${trendIcon}`, // 序号、股票代码、趋势图标
            `${rsiColor}RSI:${pos.rsi.toFixed(0).padEnd(3)}${COLORS.reset}`, // RSI值
            `${volColor}VOL:${fmtPct(pos.volatility)}${COLORS.reset}`, // 波动率
            `FOR:${fmtPct(pos.forecast)}`, // 预测值
            `${longDisplay}${shortDisplay}`, // 仓位显示
            `${pos.totalProfit >= 0 ? COLORS.profit : COLORS.loss}${fmtMoney(pos.totalProfit)}` // 总利润
        ].join(' │ '); // 返回格式化的持仓信息
    }

    function logTransaction(icon, sym, shares, price, profit = 0) {
        const record = {
            timestamp: Date.now(), // 时间戳
            time: new Date().toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 8), // 时间
            icon: icon, // 图标
            sym: sym, // 股票代码
            shares: shares, // 股份数量
            price: price, // 价格
            profit: profit, // 收益
            context: {
                volatility: getMarketVolatility(), // 波动率
                positionRatio: shares / ns.stock.getMaxShares(sym), // 仓位比例
                riskLevel: CONFIG.RISK_PER_TRADE, // 风险级别
                portfolioValue: getNetWorth() // 资产净值
            }
        };

        STATE.transactions.push(record); // 添加交易记录

        if (profit !== 0) {
            STATE.metrics.totalProfit += profit; // 更新总利润
            STATE.metrics.peakNetWorth = Math.max(STATE.metrics.peakNetWorth, getNetWorth()); // 更新净资产峰值
        }
    }

    // ===================== 财务计算 =====================
    function calculatePosition(sym, analysis) {
        const portfolioValue = getNetWorth(); // 获取总资产净值
        const currentExposure = getCurrentExposure(); // 获取当前曝光度
        const availableFunds = CONFIG.MAX_EXPOSURE * portfolioValue - currentExposure; // 可用资金

        if (availableFunds <= 0) return 0; // 如果没有可用资金则不交易

        const riskCapital = Math.min(availableFunds, portfolioValue * CONFIG.RISK_PER_TRADE); // 风险资本
        const maxShares = Math.min(
            ns.stock.getMaxShares(sym) * CONFIG.MAX_SHARE_RATIO,
            riskCapital / analysis.askPrice
        ); // 最大可购买股份

        return Math.floor(maxShares); // 返回整数股份数
    }

    function getNetWorth() {
        let total = ns.getServerMoneyAvailable('home'); // 获取账户余额
        for (const sym of STATE.symbols) {
            const [long, , short, sAvg] = ns.stock.getPosition(sym); // 获取持仓信息
            total += long * ns.stock.getBidPrice(sym); // 加上长仓价值
            total += short * (sAvg - ns.stock.getAskPrice(sym)); // 加上短仓价值
        }
        return total; // 返回总资产净值
    }

    function getCurrentExposure() {
        return STATE.symbols.reduce((sum, sym) => {
            const [long, , short, sAvg] = ns.stock.getPosition(sym); // 获取持仓信息
            return sum + (long * ns.stock.getBidPrice(sym)) + (short * (sAvg - ns.stock.getAskPrice(sym))); // 计算总曝光度
        }, 0); // 返回总曝光度
    }

    function getLeverage() {
        const equity = ns.getServerMoneyAvailable('home'); // 获取账户余额
        return equity > 0 ? (getNetWorth() - equity) / equity : 0; // 计算杠杆倍数
    }

    function getRisk() {
        const currentNet = getNetWorth(); // 获取总资产净值
        STATE.metrics.peakNetWorth = Math.max(STATE.metrics.peakNetWorth, currentNet); // 更新净资产峰值
        return (STATE.metrics.peakNetWorth - currentNet) / STATE.metrics.peakNetWorth; // 计算风险水平
    }

    // ===================== 技术指标 =====================
    function calculateRSI(prices) {
        if (prices.length < CONFIG.RSI_WINDOW + 1) return 50; // 如果数据不足则返回默认值

        const gains = new Array(CONFIG.RSI_WINDOW).fill(0); // 初始化增益数组
        const losses = new Array(CONFIG.RSI_WINDOW).fill(0); // 初始化损失数组
        let gainIndex = 0, lossIndex = 0; // 初始化增益和损失索引

        let prevPrice = prices[prices.length - CONFIG.RSI_WINDOW - 1]; // 获取前一个价格

        for (let i = prices.length - CONFIG.RSI_WINDOW; i < prices.length; i++) {
            const delta = prices[i] - prevPrice; // 计算价格变化
            if (delta > 0) {
                gains[gainIndex] = delta; // 记录增益
                gainIndex = (gainIndex + 1) % CONFIG.RSI_WINDOW; // 更新增益索引
            } else {
                losses[lossIndex] = -delta; // 记录损失
                lossIndex = (lossIndex + 1) % CONFIG.RSI_WINDOW; // 更新损失索引
            }
            prevPrice = prices[i]; // 更新前一个价格
        }

        const avgGain = gains.reduce((a, b) => a + b, 0) / CONFIG.RSI_WINDOW; // 计算平均增益
        const avgLoss = losses.reduce((a, b) => a + b, 0) / CONFIG.RSI_WINDOW; // 计算平均损失

        return avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss)); // 计算RSI值
    }

    function calculateMomentum(prices) {
        if (prices.length < CONFIG.TREND_WINDOW + 1) return 0; // 如果数据不足则返回默认值

        const recentPrices = prices.slice(-CONFIG.TREND_WINDOW); // 获取最近的价格
        const firstPrice = recentPrices[0]; // 获取第一个价格
        const lastPrice = recentPrices[recentPrices.length - 1]; // 获取最后一个价格

        return (lastPrice - firstPrice) / firstPrice; // 计算动量
    }

    function calculateCorrelation(prices) {
        if (prices.length < CONFIG.MARKET_REGIME_WINDOW + 1) return 0; // 如果数据不足则返回默认值

        const recentPrices = prices.slice(-CONFIG.MARKET_REGIME_WINDOW); // 获取最近的价格
        const avgPrice = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length; // 计算平均价格

        const deviations = recentPrices.map(p => p - avgPrice); // 计算偏差
        const squaredDeviations = deviations.map(d => d * d); // 计算平方偏差

        const variance = squaredDeviations.reduce((a, b) => a + b, 0) / squaredDeviations.length; // 计算方差
        const stdDev = Math.sqrt(variance); // 计算标准差

        return stdDev / avgPrice; // 计算相关性
    }

    function calculateEfficiency(prices) {
        if (prices.length < CONFIG.TREND_WINDOW + 1) return 0; // 如果数据不足则返回默认值

        const recentPrices = prices.slice(-CONFIG.TREND_WINDOW); // 获取最近的价格
        const firstPrice = recentPrices[0]; // 获取第一个价格
        const lastPrice = recentPrices[recentPrices.length - 1]; // 获取最后一个价格

        const totalChange = Math.abs(lastPrice - firstPrice); // 计算总变化
        const totalDistance = recentPrices.slice(1).reduce((acc, p, i) => acc + Math.abs(p - recentPrices[i]), 0); // 计算总距离

        return totalChange / totalDistance; // 计算效率
    }

    function calculateMarketCorrelation() {
        const allPrices = STATE.symbols.map(sym => STATE.history.get(sym).prices); // 获取所有股票的价格
        const avgPrices = allPrices[0].map((_, i) => allPrices.reduce((acc, prices) => acc + prices[i], 0) / allPrices.length); // 计算平均价格

        const deviations = allPrices.map(prices => prices.map((p, i) => p - avgPrices[i])); // 计算偏差
        const squaredDeviations = deviations.map(devs => devs.map(d => d * d)); // 计算平方偏差

        const variances = squaredDeviations.map(sqDevs => sqDevs.reduce((a, b) => a + b, 0) / sqDevs.length); // 计算方差
        const stdDevs = variances.map(variance => Math.sqrt(variance)); // 计算标准差

        const correlations = deviations.map((devs, i) => devs.map((d, j) => d / stdDevs[i] / stdDevs[j])); // 计算相关性

        return correlations.reduce((acc, corr) => acc + corr.reduce((a, b) => a + b, 0), 0) / (correlations.length * correlations[0].length); // 计算平均相关性
    }

    function determineMarketRegime(volatility, momentum, correlation) {
        // 增强市场状态判断逻辑
        const trendingThreshold = volatility * 1.5;
        const volatileThreshold = volatility * 0.8;

        if (momentum > trendingThreshold && correlation > 0.4) {
            return 'trending'; // 强趋势市场
        } else if (volatility > volatileThreshold || correlation > 0.6) {
            return 'volatile'; // 高波动市场
        } else if (volatility < 0.01 && Math.abs(momentum) < 0.01) {
            return 'stagnant'; // 停滞市场
        } else {
            return 'normal'; // 正常市场
        }
    }

    // ===================== 格式化工具 =====================
    function fmtMoney(amount) {
        const color = amount >= 0 ? COLORS.profit : COLORS.loss; // 根据金额正负设置颜色
        return `${color}$${ns.formatNumber(Math.abs(amount), 1).padEnd(6)}${COLORS.reset}`; // 格式化金额
    }

    function fmtNum(number) {
        return ns.formatNumber(number, 1).padStart(6, '_'); // 格式化数字并填充下划线
    }

    function fmtPct(percentage) {
        return ns.formatPercent(percentage, 1).padEnd(5); // 格式化百分比并填充空格
    }

    // ===================== 错误处理 =====================
    function handleError(ns, error) {
        const errorInfo = {
            time: new Date().toISOString(), // 时间戳
            stack: error.stack, // 错误堆栈
            message: error.message, // 错误消息
            context: JSON.stringify({
                symbols: STATE.symbols, // 股票符号列表
                netWorth: getNetWorth(), // 资产净值
                exposure: getCurrentExposure() // 曝光度
            }, null, 2) // 上下文信息
        };

        ns.print(`\x1b[38;5;196m⚠️ [${errorInfo.time}] 错误: ${error.message}\x1b[0m`); // 打印错误信息

        if (error.message.includes('4S API')) {
            ns.stock.purchase4SMarketDataTixApi(); // 重新获取4S API权限
            ns.tprint('已自动重新获取4S API访问权限'); // 提示信息
        }
    }

    // ===================== 市场指标 =====================
    function getMarketVolatility() {
        return STATE.symbols.reduce((acc, sym) => {
            const vol = ns.stock.getVolatility(sym); // 获取波动率
            return acc + (vol > 0 ? vol : 0); // 累加波动率
        }, 0) / STATE.symbols.length || 0; // 计算平均波动率
    }

    function getAverageMomentum() {
        return STATE.symbols.reduce((acc, sym) => {
            const data = STATE.history.get(sym); // 获取历史数据
            return acc + (data.maShort - data.maLong) / data.maLong; // 累加动量
        }, 0) / STATE.symbols.length || 0; // 计算平均动量
    }

    // ===================== 持仓获取 =====================
    function getActivePositions() {
        return STATE.symbols.map(sym => {
            const [long, lAvg, short, sAvg] = ns.stock.getPosition(sym); // 获取持仓信息
            if (long === 0 && short === 0) return null; // 如果没有持仓则跳过

            const analysis = CACHE.analysis.get(sym); // 获取分析结果
            const longProfit = long * (analysis.bidPrice - lAvg); // 计算长仓利润
            const shortProfit = short * (sAvg - analysis.askPrice); // 计算短仓利润

            return {
                sym: sym, // 股票代码
                trend: analysis.trend, // 趋势
                bid: analysis.bidPrice, // 买入价
                ask: analysis.askPrice, // 卖出价
                rsi: analysis.rsi, // RSI值
                volatility: analysis.volatility, // 波动率
                forecast: analysis.forecast, // 预测值
                long: [long, lAvg], // 长仓信息
                short: [short, sAvg], // 短仓信息
                maxShares: ns.stock.getMaxShares(sym), // 最大可持有股份数
                totalProfit: longProfit + shortProfit // 总利润
            };
        }).filter(p => p !== null); // 过滤掉无效持仓
    }

    // ===================== 性能指标 =====================
    function updateMetrics(processingTime) {
        const closedTrades = STATE.transactions.filter(t => t.profit !== 0); // 获取已平仓交易
        STATE.metrics.winRate = closedTrades.length > 0 ?
            closedTrades.filter(t => t.profit > 0).length / closedTrades.length : 0; // 计算赢率

        const currentNet = getNetWorth(); // 获取总资产净值
        STATE.metrics.peakNetWorth = Math.max(STATE.metrics.peakNetWorth, currentNet); // 更新净资产峰值
        const drawdown = (STATE.metrics.peakNetWorth - currentNet) / STATE.metrics.peakNetWorth; // 计算最大回撤
        STATE.metrics.maxDrawdown = Math.max(STATE.metrics.maxDrawdown, drawdown); // 更新最大回撤

        STATE.metrics.avgProcessingTime =
            (STATE.metrics.avgProcessingTime || 0) * 0.9 +
            processingTime * 0.1; // 更新平均处理时间

        const now = Date.now();
        STATE.transactions.forEach(t => {
            if (!t.entryTime && t.shares > 0) {
                t.entryTime = now; // 记录进入时间
            } else if (t.entryTime && t.shares === 0) {
                const duration = now - t.entryTime; // 计算持仓时间
                STATE.metrics.avgHoldingTime =
                    (STATE.metrics.avgHoldingTime || 0) * 0.9 +
                    duration * 0.1; // 更新平均持仓时间
                delete t.entryTime; // 删除进入时间
            }
        });

        if (!STATE.metrics.startTime) {
            STATE.metrics.startTime = Date.now(); // 记录启动时间
        }
        STATE.metrics.uptime = Date.now() - STATE.metrics.startTime; // 计算运行时间
    }

    // ===================== 配置管理 =====================
    function updateConfig(newConfig) {
        Object.keys(newConfig).forEach(key => {
            if (CONFIG.hasOwnProperty(key)) {
                const oldValue = CONFIG[key];
                CONFIG[key] = newConfig[key]; // 更新配置参数
                // ns.print(`${COLORS.info}配置更新: ${key} ${oldValue.toFixed(2)} → ${newConfig[key].toFixed(2)}${COLORS.reset}`); // 打印配置更新信息
            }
        });
    }

    // ===================== 辅助工具 =====================
    async function check4SApiAccess() {
        let retries = 0;
        while (!ns.stock.has4SDataTIXAPI()) {
            ns.ui.resizeTail(400, 60); // 调整tail窗口大小
            ns.clearLog(); // 清除日志
            if (retries++ % 5 === 0) {
                ns.stock.purchase4SMarketDataTixApi(); // 重新获取4S API权限
            }
            ns.print(`等待4S API权限... (${fmtNum(retries)}次重试)`); // 打印提示信息
            await ns.sleep(2000 + Math.random() * 3000); // 等待一段时间后重试
        }
        return true; // 返回成功标志
    }

    function cleanupCache() {
        const now = Date.now();
        if (now - METRICS.lastCleanup < 3600000) return; // 如果未超过一小时则跳过

        for (const key of CACHE.prices.keys()) {
            if (!STATE.symbols.includes(key)) {
                CACHE.prices.delete(key); // 删除无效缓存
                CACHE.analysis.delete(key); // 删除无效分析结果
            }
        }

        METRICS.lastCleanup = now; // 更新最后清理时间
    }

    function optimizeMemory() {
        if (STATE.transactions.length > 1000) {
            STATE.transactions = STATE.transactions.slice(-500);
        }

        for (const sym of STATE.symbols) {
            const data = STATE.history.get(sym);
            if (data.prices.length > CONFIG.PRICE_MEMORY) {
                data.prices = data.prices.slice(-CONFIG.PRICE_MEMORY);
            }
        }
    }

    function calculatePositionScore(analysis) {
        return (
            0.3 * (analysis.forecast - 0.5) +
            0.2 * Math.min(1, Math.max(0, (70 - analysis.rsi) / 40)) +
            0.2 * (1 - analysis.volatilityTrend) +
            0.15 * analysis.efficiency +
            0.15 * (1 - Math.abs(analysis.correlation))
        );
    }

    function updateRiskParameters() {
        const risk = getRisk();
        const volatility = MARKET_STATE.volatility;
        const momentum = Math.abs(MARKET_STATE.momentum);

        CONFIG.RISK_PER_TRADE = Math.min(0.15, Math.max(0.05,
            0.1 * (1 - risk) * (1 - volatility) * (1 + momentum)
        ));

        CONFIG.STOP_LOSS = Math.max(0.02, Math.min(0.05,
            0.03 * (1 + volatility) * (1 - momentum)
        ));
    }

    function updateMarketState() {
        const now = Date.now();
        if (now - MARKET_STATE.lastUpdate < 60000) return;

        const volatility = getMarketVolatility();
        const momentum = getAverageMomentum();
        const correlation = calculateMarketCorrelation();

        MARKET_STATE.volatility = volatility;
        MARKET_STATE.momentum = momentum;
        MARKET_STATE.correlation = correlation;
        MARKET_STATE.regime = determineMarketRegime(volatility, momentum, correlation);
        MARKET_STATE.lastUpdate = now;

        updateRiskParameters();
        optimizeMemory();
    }
}
