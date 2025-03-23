/**
 * Bitburner 股票自动交易脚本 v6.8 - 量化交易系统
 * 
 * 功能特性：
 * 1. 多策略融合交易系统（趋势跟踪 + 均值回归 + 波动率过滤）
 * 2. 动态风险管理（仓位控制 + 止损止盈 + 杠杆监控）
 * 3. 实时市场仪表盘（持仓分析 + 交易记录 + 绩效指标）
 * 4. 自适应技术指标（双均线系统 + RSI + 波动率分析）
 * 
 * 主要模块：
 * - 市场数据实时更新
 * - 自动化交易策略执行
 * - 风险暴露动态控制
 * - 交易绩效实时监控
 *  
 * @param {NS} ns Bitburner 游戏API实例
 * @example
 */
export async function main(ns) {
  // ===================== 核心配置 =====================
  let CONFIG = {
    // 优化风险控制参数
    RISK_PER_TRADE: 0.2,       // 降低单次交易风险
    MAX_EXPOSURE: 0.7,          // 降低最大风险敞口
    TREND_WINDOW: 8,            // 缩短趋势窗口提高灵敏度
    BASE_WINDOW: 40,            // 优化基准窗口长度
    RSI_WINDOW: 14,             // 标准RSI窗口
    VOLATILITY_FILTER: 0.015,   // 更严格的波动率过滤
    STOP_LOSS: 0.025,          // 更紧的止损
    TAKE_PROFIT: 0.12,         // 更合理的止盈
    ENABLE_SHORT: true,
    MAX_SHARE_RATIO: 0.2,     // 降低单股最大持仓比例
    FORECAST_BUY: 0.65,        // 提高做多阈值
    FORECAST_SELL: 0.35,       // 降低做空阈值
    DISPLAY_ROWS: 33,

    // 新增性能优化参数
    CACHE_DURATION: 1000,      // 缓存有效期(毫秒)
    BATCH_SIZE: 10,            // 批处理大小
    ERROR_RETRY_LIMIT: 3,      // 错误重试次数
    MIN_TRADE_AMOUNT: 1e6      // 最小交易金额
  };

  // 增加颜色配置
  const COLORS = {
    reset: '\x1b[0m',
    bullish: '\x1b[38;5;46m',      // 亮绿色
    bearish: '\x1b[38;5;196m',     // 亮红色
    profit: '\x1b[38;5;47m',       // 渐变绿色
    loss: '\x1b[38;5;160m',        // 渐变红色  
    warning: '\x1b[38;5;226m',     // 黄色
    info: '\x1b[38;5;51m',         // 青色
    highlight: '\x1b[38;5;213m',   // 粉紫色
    header: '\x1b[48;5;236m',      // 深灰色背景
    rsiLow: '\x1b[38;5;46m',       // RSI <30
    rsiMid: '\x1b[38;5;226m',      // RSI 30-70
    rsiHigh: '\x1b[38;5;196m'      // RSI >70
  };

  // 增加缓存管理
  const CACHE = {
    prices: new Map(),
    analysis: new Map(),
    lastUpdate: 0
  };

  // 增加性能监控
  const METRICS = {
    apiCalls: 0,
    processingTime: 0,
    errorCount: 0,
    lastCleanup: Date.now()
  };

  // 优化错误处理
  const ErrorHandler = {
    retryCount: new Map(),
    async wrap(fn, maxRetries = CONFIG.ERROR_RETRY_LIMIT) {
      try {
        return await fn();
      } catch (error) {
        METRICS.errorCount++;
        const count = (ErrorHandler.retryCount.get(fn) || 0) + 1;
        ErrorHandler.retryCount.set(fn, count);

        if (count <= maxRetries) {
          await ns.sleep(1000 * count);
          return await ErrorHandler.wrap(fn, maxRetries);
        }
        handleError(ns, error);
        return null;
      }
    }
  };

  // 优化初始化
  async function initializeState() {
    STATE.symbols = ns.stock.getSymbols();
    STATE.history = new Map();

    // 并行初始化历史数据
    STATE.symbols.forEach(sym => {
      STATE.history.set(sym, {
        prices: new Array(100).fill(ns.stock.getPrice(sym)),
        maShortSum: 0,
        maShortWindow: [],
        maLongSum: 0,
        maLongWindow: [],
        rsi: 50,
        lastUpdate: Date.now()
      });
    });

    // 预热缓存
    updateAllPrices();
  }

  // 优化价格更新
  function updateAllPrices() {
    const now = Date.now();
    if (now - CACHE.lastUpdate < CONFIG.CACHE_DURATION) {
      return;
    }

    STATE.symbols.forEach(sym => {
      const price = ns.stock.getPrice(sym);
      CACHE.prices.set(sym, price);
      METRICS.apiCalls++;
    });

    CACHE.lastUpdate = now;
  }

  // ===================== 全局状态 =====================
  const STATE = {
    symbols: ns.stock.getSymbols(),
    history: new Map(),
    transactions: [],
    metrics: {
      totalProfit: 0,
      winRate: 0,
      maxDrawdown: 0,
      peakNetWorth: 0
    }
  };

  // ===================== 初始化 =====================
  ns.disableLog("ALL");
  ns.ui.setTailTitle(`StockManager v6.8 [${ns.getScriptName()}]`);
  ns.ui.openTail();
  const [W, H] = ns.ui.windowSize();

  // 调用初始化函数替换原有初始化逻辑
  await initializeState();


  // ===================== 主循环 =====================

  // 缓存分析结果
  const analysisCache = new Map();

  while (true) {
    ns.ui.moveTail(W * 0.48, H * 0);
    ns.clearLog();
    // 优化API检测机制
    if (!(await check4SApiAccess())) continue;
    // 基于市场状态的动态风险调整
    const [marketVol, avgMomentum] = await Promise.all([
      getMarketVolatility(),
      getAverageMomentum()
    ]);

    // 计算动态风险系数
    const clamp = (value, min, max) => Math.min(Math.max(value, min), max)
    const volatilityFactor = Math.sqrt(marketVol / 0.1);
    const momentumFactor = 1 + Math.tanh(avgMomentum * 2);
    const riskAdjustment = 0.05 * volatilityFactor * momentumFactor;

    // 初始配置检查和更新
    updateConfig({
      VOLATILITY_FILTER: getRisk() > 0.1 ? 0.01 : 0.02,
      FORECAST_BUY: getRisk() > 0.1 ? 0.65 : 0.55,
      FORECAST_SELL: getRisk() > 0.1 ? 0.35 : 0.45,
      RISK_PER_TRADE: clamp(riskAdjustment, 0.01, 0.2)
    });

    // 增加性能监控
    const loopStart = Date.now();



    try {
      // 使用缓存的价格数据
      updateAllPrices();

      // 优化数据管道：使用缓存的价格进行分析
      const analyses = await Promise.all(
        STATE.symbols.map(async sym => {
          const cachedPrice = CACHE.prices.get(sym);
          if (cachedPrice) {
            updateHistory(sym, cachedPrice);
          }
          return analyzeStock(sym);
        })
      );

      // 批量缓存分析结果
      analyses.forEach((analysis, i) =>
        analysisCache.set(STATE.symbols[i], analysis));

      // 并行执行仓位管理和交易
      await Promise.all(STATE.symbols.map((sym, i) => {
        const analysis = analyses[i];
        managePosition(sym, analysis);
        return executeTrades(sym, analysis);
      }));

      // 更新性能指标
      const processingTime = Date.now() - loopStart;
      updateMetrics(processingTime);
      displayDashboard();

      // 智能缓存清理
      analysisCache.forEach((_, sym) => {
        if (!STATE.symbols.includes(sym)) {
          analysisCache.delete(sym);
        }
      });
    } catch (e) {
      handleError(ns, e);
    }

    const ActivePositions = getActivePositions().length;
    const windowHeight = (Math.min(ActivePositions, CONFIG.DISPLAY_ROWS) + 6) * 24 + 180;
    ns.ui.resizeTail(800, windowHeight);

    // 使用官方推荐的更新等待方式
    await ns.stock.nextUpdate();
  }

  // ===================== 核心功能 =====================
  /** 更新历史数据 */
  function updateHistory(sym, cachedPrice = null) {
    // 使用缓存价格或实时获取
    const price = cachedPrice || ns.stock.getPrice(sym);
    const data = STATE.history.get(sym);

    // 使用循环数组优化数据存储
    if (!data.priceIndex) data.priceIndex = 0;
    if (!data.priceArray) data.priceArray = new Array(100).fill(price);

    data.priceArray[data.priceIndex] = price;
    data.priceIndex = (data.priceIndex + 1) % 100;

    // 获取最近的价格序列
    data.prices = [...data.priceArray.slice(data.priceIndex), ...data.priceArray.slice(0, data.priceIndex)];

    updateMA(data, 'maShort', CONFIG.TREND_WINDOW, price);
    updateMA(data, 'maLong', CONFIG.BASE_WINDOW, price);
    data.rsi = calculateRSI(data.prices);
  }

  /** 更新移动平均线（MA） */
  function updateMA(data, type, window, price) {
    const queue = data[`${type}Window`];
    const sumKey = `${type}Sum`;

    queue.push(price);
    data[sumKey] += price;

    if (queue.length > window) {
      const removed = queue.shift();
      data[sumKey] -= removed;
    }
    data[type] = data[sumKey] / queue.length;
  }

  /** 分析股票信息 */
  function analyzeStock(sym) {
    const data = STATE.history.get(sym);
    return {
      symbol: sym,
      bidPrice: ns.stock.getBidPrice(sym),
      askPrice: ns.stock.getAskPrice(sym),
      trend: data.maShort > data.maLong ? 'bull' : 'bear',
      rsi: data.rsi,
      volatility: ns.stock.getVolatility(sym),
      momentum: (data.maShort - data.maLong) / data.maLong * 100,
      forecast: ns.stock.getForecast(sym)
    };
  }

  // ===================== 交易策略 =====================
  /** 执行交易函数 */
  function executeTrades(sym, analysis) {
    const [longShares, , shortShares] = ns.stock.getPosition(sym);
    const position = calculatePosition(sym, analysis);

    if (analysis.trend === 'bull' && longShares <= 0) {
      const buyCondition = (
        analysis.forecast > CONFIG.FORECAST_BUY &&
        analysis.rsi < 40 &&
        analysis.volatility < CONFIG.VOLATILITY_FILTER
      );
      if (buyCondition) {
        const bought = ns.stock.buyStock(sym, position);
        if (bought > 0) logTransaction('Buy 📈', sym, bought, analysis.askPrice);
      }
    }

    if (CONFIG.ENABLE_SHORT && analysis.trend === 'bear' && shortShares === 0) {
      const shortCondition = (
        analysis.forecast < CONFIG.FORECAST_SELL &&
        analysis.rsi > 60 &&
        analysis.volatility < CONFIG.VOLATILITY_FILTER
      );
      if (shortCondition) {
        const sold = ns.stock.buyShort(sym, position);
        if (sold > 0) logTransaction('Buy 📉', sym, sold, analysis.bidPrice);
      }
    }
  }

  /** 管理股票头寸 */
  function managePosition(sym, analysis) {
    const [long, longAvg, short, shortAvg] = ns.stock.getPosition(sym);

    if (long > 0) {
      const currentPrice = analysis.bidPrice;
      const profitRatio = (currentPrice - longAvg) / longAvg;
      if ((profitRatio <= -CONFIG.STOP_LOSS && analysis.forecast < CONFIG.FORECAST_BUY - 0.05) || profitRatio >= CONFIG.TAKE_PROFIT) {
        const sold = ns.stock.sellStock(sym, long);
        if (sold > 0) logTransaction('Sell📈', sym, -long, currentPrice, long * (currentPrice - longAvg));
      }
    }

    if (short > 0) {
      const currentPrice = analysis.askPrice;
      const profitRatio = (shortAvg - currentPrice) / shortAvg;
      if ((profitRatio <= -CONFIG.STOP_LOSS && analysis.forecast > CONFIG.FORECAST_BUY + 0.05) || profitRatio >= CONFIG.TAKE_PROFIT) {
        const bought = ns.stock.sellShort(sym, short);
        if (bought > 0) logTransaction('Sell📉', sym, -short, currentPrice, short * (shortAvg - currentPrice));
      }
    }
  }

  // ===================== 增强仪表盘 =====================
  /** 显示仪表盘界面	 */
  function displayDashboard() {
    // 顶部状态栏
    ns.print("═".repeat(80));
    ns.print(`${COLORS.header}─[ ${new Date().toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 8)} ]─[ StockManager v6.8 ]─[ ${ns.getHostname()} ]─` + '─'.repeat(35));

    // 关键指标行
    const volColor = getRisk() > 0.1 ? COLORS.warning : COLORS.info;
    ns.print([
      `${COLORS.info}NET: ${fmtMoney(getNetWorth())}`,
      `${COLORS.profit}PRO: ${fmtMoney(STATE.metrics.totalProfit)}`,
      `${COLORS.warning}DRA: ${fmtPct(STATE.metrics.maxDrawdown)}`,
      `${COLORS.highlight}LEV: ${getLeverage().toFixed(1)}x`,
      `${volColor}RISK: ${getRisk().toFixed(2)}`
    ].join(' | '));
    ns.print("═".repeat(80));

    // 持仓列表
    ns.print(`${COLORS.header}──📦 Position ${'─'.repeat(80 - 14)}${COLORS.reset}`);
    getActivePositions()
      .sort((a, b) => b.totalProfit - a.totalProfit)
      .slice(0, CONFIG.DISPLAY_ROWS)
      .forEach((p, i) => ns.print(fmtPosition(p, i + 1)));
    ns.print("═".repeat(80));

    // 交易记录
    ns.print(`${COLORS.header}──📜 Latest Transactions ${'─'.repeat(80 - 25)}${COLORS.reset}`);
    STATE.transactions.slice(-5).forEach(t => {
      const profitColor = t.profit > 0 ? COLORS.profit : COLORS.loss;
      ns.print(` ${COLORS.info}${t.time} ${t.icon.padEnd(5)} ` +
        `${getTrendColor(t.sym)}${t.sym.padEnd(5)} ` +
        `${COLORS.highlight}${fmtNum(Math.abs(t.shares))}@${fmtNum(t.price)} ` +
        `${profitColor}${t.profit > 0 ? '▲' : t.profit < 0 ? '▼' : ' '} ${fmtMoney(t.profit)}`);
    });
  }

  // ===================== 辅助函数 =====================
  /** 根据比例和颜色生成条形图 */
  function getBar(ratio, color) {
    const filled = Math.floor(ratio * 5);
    return color + '■'.repeat(filled) + COLORS.reset + '□'.repeat(5 - filled);
  }

  /** 根据股票代码获取趋势颜色 */
  function getTrendColor(sym) {
    const analysis = analyzeStock(sym);
    return analysis.trend === 'bull' ? COLORS.bullish : COLORS.bearish;
  }

  /** 格式化股票持仓信息 */
  function fmtPosition(pos, index) {
    const rsiColor = pos.rsi < 30 ? COLORS.rsiLow :
      pos.rsi > 70 ? COLORS.rsiHigh : COLORS.rsiMid;
    const volColor = pos.volatility > CONFIG.VOLATILITY_FILTER
      ? COLORS.warning : COLORS.reset;
    const trendIcon = pos.trend === 'bull'
      ? `${COLORS.bullish}▲${COLORS.reset}`
      : `${COLORS.bearish}▼${COLORS.reset}`;

    const longRatio = pos.long[0] / pos.maxShares;
    const shortRatio = pos.short[0] / pos.maxShares;

    const longDisplay = pos.long[0] > 0 ?
      `${COLORS.info}📈:${fmtNum(pos.long[0])} ${getBar(longRatio, COLORS.bullish)}` : '';
    const shortDisplay = pos.short[0] > 0 ?
      `${COLORS.highlight}📉:${fmtNum(pos.short[0])} ${getBar(shortRatio, COLORS.bearish)}` : '';

    return [
      ` ${index.toString().padStart(2)} ${pos.sym.padEnd(5)} ${trendIcon}`,
      `${rsiColor}RSI:${pos.rsi.toFixed(0).padEnd(3)}${COLORS.reset}`,
      `${volColor}VOL:${fmtPct(pos.volatility)}${COLORS.reset}`,
      `${volColor}FOR:${fmtPct(pos.forecast)}`,
      `${longDisplay}${shortDisplay}`,
      `${pos.totalProfit >= 0 ? COLORS.profit : COLORS.loss}${fmtMoney(pos.totalProfit)}`
    ].join(' │ ');
  }

  /** 记录交易日志 */
  function logTransaction(icon, sym, shares, price, profit = 0) {
    try {
      const marketVol = getMarketVolatility();
      const positionRatio = shares / ns.stock.getMaxShares(sym);

      const record = {
        timestamp: Date.now(),
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 8),
        icon: icon,
        sym: sym,
        shares: shares,
        price: price,
        profit: profit,
        context: {
          volatility: marketVol,
          positionRatio: positionRatio,
          riskLevel: CONFIG.RISK_PER_TRADE,
          portfolioValue: getNetWorth()
        }
      };

      // 写入交易日志
      STATE.transactions.push(record);

      if (profit !== 0) {
        STATE.metrics.totalProfit += profit;
        STATE.metrics.peakNetWorth = Math.max(STATE.metrics.peakNetWorth, getNetWorth());
        STATE.metrics.tradeCount = (STATE.metrics.tradeCount || 0) + 1;
      }
    } catch (e) {
      ns.print(`\x1b[38;5;196m交易日志记录失败: ${e.message}\x1b[0m`);
    }
  }

  // ===================== 财务计算 =====================
  /** 计算股票交易仓位 */
  function calculatePosition(sym, analysis) {
    const portfolioValue = getNetWorth();
    const currentExposure = getCurrentExposure();
    const availableFunds = CONFIG.MAX_EXPOSURE * portfolioValue - currentExposure;

    if (availableFunds <= 0) return 0;

    const riskCapital = Math.min(availableFunds, portfolioValue * CONFIG.RISK_PER_TRADE);
    const maxShares = Math.min(
      ns.stock.getMaxShares(sym) * CONFIG.MAX_SHARE_RATIO,
      riskCapital / analysis.askPrice
    );

    return Math.floor(maxShares);
  }

  /** 计算当前的总净资产 */
  function getNetWorth() {
    let total = ns.getServerMoneyAvailable('home');
    for (const sym of STATE.symbols) {
      const [long, , short, sAvg] = ns.stock.getPosition(sym);
      total += long * ns.stock.getBidPrice(sym);
      total += short * (sAvg - ns.stock.getAskPrice(sym));
    }
    return total;
  }

  /** 获取当前持仓的敞口金额 */
  function getCurrentExposure() {
    return STATE.symbols.reduce((sum, sym) => {
      const [long, , short, sAvg] = ns.stock.getPosition(sym);
      return sum + (long * ns.stock.getBidPrice(sym)) + (short * (sAvg - ns.stock.getAskPrice(sym)));
    }, 0);
  }

  /** 获取杠杆率 */
  function getLeverage() {
    const equity = ns.getServerMoneyAvailable('home');
    return equity > 0 ? (getNetWorth() - equity) / equity : 0;
  }

  /** 获取当前风险值 */
  function getRisk() {
    const currentNet = getNetWorth();
    STATE.metrics.peakNetWorth = Math.max(STATE.metrics.peakNetWorth, currentNet);
    return (STATE.metrics.peakNetWorth - currentNet) / STATE.metrics.peakNetWorth;
  }

  // ===================== 技术指标 =====================
  /** 计算相对强弱指数（RSI）*/
  function calculateRSI(prices) {
    if (prices.length < CONFIG.RSI_WINDOW + 1) return 50;

    // 使用滑动窗口优化RSI计算
    const gains = new Array(CONFIG.RSI_WINDOW).fill(0);
    const losses = new Array(CONFIG.RSI_WINDOW).fill(0);
    let gainIndex = 0, lossIndex = 0;

    // 初始化第一个数据点
    let prevPrice = prices[prices.length - CONFIG.RSI_WINDOW - 1];

    // 使用滑动窗口计算增益和损失
    for (let i = prices.length - CONFIG.RSI_WINDOW; i < prices.length; i++) {
      const delta = prices[i] - prevPrice;
      if (delta > 0) {
        gains[gainIndex] = delta;
        gainIndex = (gainIndex + 1) % CONFIG.RSI_WINDOW;
      } else {
        losses[lossIndex] = -delta;
        lossIndex = (lossIndex + 1) % CONFIG.RSI_WINDOW;
      }
      prevPrice = prices[i];
    }

    // 计算平均值
    const avgGain = gains.reduce((a, b) => a + b, 0) / CONFIG.RSI_WINDOW;
    const avgLoss = losses.reduce((a, b) => a + b, 0) / CONFIG.RSI_WINDOW;

    return avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  }

  // ===================== 格式化工具 =====================
  /** 格式化金额 */
  function fmtMoney(amount) {
    const color = amount >= 0 ? COLORS.profit : COLORS.loss;
    return `${color}$${ns.formatNumber(Math.abs(amount), 1).padEnd(6)}${COLORS.reset}`;
  }

  /** 格式化数字为指定小数位数的字符串，并在前面填充下划线，使总长度达到6位 */
  function fmtNum(number) {
    return ns.formatNumber(number, 1).padStart(6, '_');
  }

  /** 将百分比格式化为字符串，并右对齐填充空格至5个字符长度 */
  function fmtPct(percentage) {
    return ns.formatPercent(percentage, 1).padEnd(5);
  }

  /** 错误处理函数 */
  function handleError(ns, error) {
    const errorInfo = {
      time: new Date().toISOString(),
      stack: error.stack,
      message: error.message,
      context: JSON.stringify({
        symbols: STATE.symbols,
        netWorth: getNetWorth(),
        exposure: getCurrentExposure()
      }, null, 2)
    };

    ns.print(`\x1b[38;5;196m⚠️ [${errorInfo.time}] 错误: ${error.message}\x1b[0m`);

    // 自动恢复机制
    if (error.message.includes('4S API')) {
      ns.stock.purchase4SMarketDataTixApi();
      ns.tprint('已自动重新获取4S API访问权限');
    }
  }

  // 计算市场整体波动率
  /** 获取市场波动率 */
  function getMarketVolatility() {
    return STATE.symbols.reduce((acc, sym) => {
      const vol = ns.stock.getVolatility(sym);
      return acc + (vol > 0 ? vol : 0);
    }, 0) / STATE.symbols.length || 0;
  }

  /** 计算平均动量 */
  function getAverageMomentum() {
    return STATE.symbols.reduce((acc, sym) => {
      const data = STATE.history.get(sym);
      return acc + (data.maShort - data.maLong) / data.maLong;
    }, 0) / STATE.symbols.length || 0;
  }

  // ===================== 持仓获取 =====================
  /** 获取当前所有活跃股票持仓信息 */
  function getActivePositions() {
    return STATE.symbols.map(sym => {
      const [long, lAvg, short, sAvg] = ns.stock.getPosition(sym);
      if (long === 0 && short === 0) return null;

      const analysis = analyzeStock(sym);
      const longProfit = long * (analysis.bidPrice - lAvg);
      const shortProfit = short * (sAvg - analysis.askPrice);

      return {
        sym: sym,
        trend: analysis.trend,
        bid: analysis.bidPrice,
        ask: analysis.askPrice,
        rsi: analysis.rsi,
        volatility: analysis.volatility,
        forecast: analysis.forecast,
        long: [long, lAvg],
        short: [short, sAvg],
        maxShares: ns.stock.getMaxShares(sym),
        totalProfit: longProfit + shortProfit
      };
    }).filter(p => p !== null);
  }

  // ===================== 增强指标更新 =====================
  /** 更新交易系统的性能指标。 */
  function updateMetrics(processingTime) {
    try {
      // 计算基础指标
      const closedTrades = STATE.transactions.filter(t => t.profit !== 0);
      STATE.metrics.winRate = closedTrades.length > 0 ?
        closedTrades.filter(t => t.profit > 0).length / closedTrades.length : 0;

      const currentNet = getNetWorth();
      STATE.metrics.peakNetWorth = Math.max(STATE.metrics.peakNetWorth, currentNet);
      const drawdown = (STATE.metrics.peakNetWorth - currentNet) / STATE.metrics.peakNetWorth;
      STATE.metrics.maxDrawdown = Math.max(STATE.metrics.maxDrawdown, drawdown);

      // 新增性能指标
      STATE.metrics.avgProcessingTime =
        (STATE.metrics.avgProcessingTime || 0) * 0.9 +
        processingTime * 0.1;

      // 计算持仓时间指标
      const now = Date.now();
      STATE.transactions.forEach(t => {
        if (!t.entryTime && t.shares > 0) {
          t.entryTime = now;
        } else if (t.entryTime && t.shares === 0) {
          const duration = now - t.entryTime;
          STATE.metrics.avgHoldingTime =
            (STATE.metrics.avgHoldingTime || 0) * 0.9 +
            duration * 0.1;
          delete t.entryTime;
        }
      });

      // 记录运行时间
      if (!STATE.metrics.startTime) {
        STATE.metrics.startTime = Date.now();
      }
      STATE.metrics.uptime = Date.now() - STATE.metrics.startTime;
    } catch (e) {
      handleError(ns, e);
    }
  }

  // ===================== 配置管理 =====================
  /**  动态更新配置参数 */
  function updateConfig(newConfig) {
    Object.keys(newConfig).forEach(key => {
      if (CONFIG.hasOwnProperty(key)) {
        const oldValue = CONFIG[key];
        CONFIG[key] = newConfig[key];
        ns.print(`${COLORS.info}配置更新: ${key} ${oldValue.toFixed(2)} → ${newConfig[key].toFixed(2)}${COLORS.reset}`);
      }
    });
  }

  // ===================== 辅助工具 =====================
  /**  检查4S API访问权限 */
  async function check4SApiAccess() {

    let retries = 0;
    while (!ns.stock.has4SDataTIXAPI()) {
      ns.ui.resizeTail(400, 60);
      ns.clearLog();
      if (retries++ % 5 === 0) {
        ns.stock.purchase4SMarketDataTixApi();
      }
      ns.print(`等待4S API权限... (${fmtNum(retries)}次重试)`);
      await ns.sleep(2000 + Math.random() * 3000);
    }
    return true;
  }
}
