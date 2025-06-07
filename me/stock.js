/** @param {NS} ns */
export async function main(ns) {
    // 日志设置
    ns.disableLog('ALL');
    ns.ui.openTail();

    // 全局变量
    const moneyKeep = Number(ns.read("reserve.txt"));   // 保留的安全资金
    const stockBuyOver_Long = 0.60;     // 当预测高于此百分比时买入股票
    const stockBuyUnder_Short = 0.40;   // 当预测低于此百分比时买入股票(如果解锁卖空功能)
    const stockVolatility = 0.03;       // 允许的最大波动率(3%)
    const minShare = 1000;
    const maxSharePercent = 1;          // 最大买入百分比(100%)
    const sellThreshold_Long = 0.55;    // 当上涨概率低于此值时卖出多头
    const sellThreshold_Short = 0.45;   // 当下跌概率高于此值时卖出空头
    const takeProfit = 0.12;            // 止盈百分比（12%）
    const stopLoss = -0.05;             // 止损百分比（-5%）
    const shortUnlock = false;          // 是否解锁卖空功能
    const runScript = true;             // 是否运行脚本
    const toastDuration = 15000;        // 提示消息持续时间(毫秒)
    
    // MACD和RSI参数
    const MACD_SHORT_PERIOD = 12;       // 短期EMA周期
    const MACD_LONG_PERIOD = 26;        // 长期EMA周期
    const MACD_SIGNAL_PERIOD = 9;       // 信号线周期
    const RSI_PERIOD = 14;              // RSI计算周期
    const RSI_OVERSOLD = 30;            // RSI超卖阈值
    const RSI_OVERBOUGHT = 70;          // RSI超买阈值
    const RSI_MID = 50;                 // RSI中轴

    // 函数定义
    function format(number) {
        if (Math.abs(number) < 1e-6) number = 0;
        const absNum = Math.abs(number);
        return number < 0 
            ? `\x1b[31m-$${ns.formatNumber(absNum, 2)}\x1b[0m` 
            : ` $${ns.formatNumber(absNum, 2)}`;
    }

    // 计算指数移动平均线(EMA)
    function calculateEMA(prices, period) {
        if (prices.length < period) return null;
        const multiplier = 2 / (period + 1);
        let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
        
        for (let i = period; i < prices.length; i++) {
            ema = (prices[i] - ema) * multiplier + ema;
        }
        return ema;
    }

    // 计算MACD指标
    function calculateMACD(prices) {
        if (prices.length < MACD_LONG_PERIOD) return null;
        
        const shortEMA = calculateEMA(prices, MACD_SHORT_PERIOD);
        const longEMA = calculateEMA(prices, MACD_LONG_PERIOD);
        const macdLine = shortEMA - longEMA;
        
        // 计算信号线
        const macdValues = [];
        for (let i = MACD_LONG_PERIOD; i < prices.length; i++) {
            const slice = prices.slice(i - MACD_LONG_PERIOD, i);
            const sEMA = calculateEMA(slice, MACD_SHORT_PERIOD);
            const lEMA = calculateEMA(slice, MACD_LONG_PERIOD);
            macdValues.push(sEMA - lEMA);
        }
        
        const signalLine = macdValues.length >= MACD_SIGNAL_PERIOD 
            ? calculateEMA(macdValues, MACD_SIGNAL_PERIOD) 
            : 0;
        
        return {
            macd: macdLine,
            signal: signalLine,
            histogram: macdLine - signalLine
        };
    }

    // 计算RSI指标
    function calculateRSI(prices, period) {
        if (prices.length < period + 1) return 50;
        
        let gains = 0;
        let losses = 0;
        
        for (let i = 1; i <= period; i++) {
            const diff = prices[i] - prices[i-1];
            if (diff >= 0) gains += diff;
            else losses -= diff;
        }
        
        const avgGain = gains / period;
        const avgLoss = losses / period;
        
        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }

    // 检测背离
    function checkDivergence(priceHistory, indicatorHistory, type = 'top') {
        if (priceHistory.length < 2 || indicatorHistory.length < 2) return false;
        
        const lastPrice = priceHistory[priceHistory.length - 1];
        const prevPrice = priceHistory[priceHistory.length - 2];
        const lastIndicator = indicatorHistory[indicatorHistory.length - 1];
        const prevIndicator = indicatorHistory[indicatorHistory.length - 2];
        
        if (type === 'top') {
            return lastPrice > prevPrice && lastIndicator < prevIndicator;
        } else {
            return lastPrice < prevPrice && lastIndicator > prevIndicator;
        }
    }

    /**
     * 买入头寸函数
     */
    function buyPositions(stock, priceHistory, macdHistory, rsiHistory) {
        const position = ns.stock.getPosition(stock);
        const maxShares = (ns.stock.getMaxShares(stock) * maxSharePercent) - position[0];
        const maxSharesShort = (ns.stock.getMaxShares(stock) * maxSharePercent) - position[2];
        const askPrice = ns.stock.getAskPrice(stock);
        const forecast = ns.stock.getForecast(stock);
        const volatilityPercent = ns.stock.getVolatility(stock);
        const playerMoney = ns.getPlayer().money;
        
        // 计算技术指标
        const macdData = calculateMACD(priceHistory);
        const rsi = calculateRSI(priceHistory, RSI_PERIOD);
        const prevRsi = rsiHistory.length > 0 ? rsiHistory[rsiHistory.length - 1] : 50;
        
        // MACD金叉检测
        const macdGoldenCross = macdData && macdHistory.length > 0 
            ? (macdData.macd > macdData.signal) && (macdHistory[macdHistory.length - 1].macd <= macdHistory[macdHistory.length - 1].signal)
            : false;
        
        // RSI从超卖区回升
        const rsiRecovery = (prevRsi < RSI_OVERSOLD) && (rsi > RSI_MID);
        
        // 趋势与动量双重验证
        const longCondition = (forecast >= stockBuyOver_Long && volatilityPercent <= stockVolatility) || 
                             (macdGoldenCross && rsiRecovery);
        
        // 多头买入条件
        if (longCondition) {
            if (playerMoney - moneyKeep > ns.stock.getPurchaseCost(stock, minShare, "Long")) {
                const shares = Math.min((playerMoney - moneyKeep - 100000) / askPrice, maxShares);
                const boughtFor = ns.stock.buyStock(stock, shares);
                
                if (boughtFor > 0) {
                    ns.toast(`买入 ${Math.round(shares)} 股 ${stock}，金额 ${format(boughtFor)}`, 'success', toastDuration);
                }
            }
        }
        
        // 空头买入条件（如果解锁）
        if (shortUnlock) {
            // MACD死叉检测
            const macdDeathCross = macdData && macdHistory.length > 0 
                ? (macdData.macd < macdData.signal) && (macdHistory[macdHistory.length - 1].macd >= macdHistory[macdHistory.length - 1].signal)
                : false;
            
            // RSI从超买区回落
            const rsiDecline = (prevRsi > RSI_OVERBOUGHT) && (rsi < RSI_OVERBOUGHT);
            
            // 底背离检测
            const bottomDivergence = checkDivergence(priceHistory, macdHistory, 'bottom') || 
                                   checkDivergence(priceHistory, rsiHistory, 'bottom');
            
            // 趋势与动量双重验证
            const shortCondition = (forecast <= stockBuyUnder_Short && volatilityPercent <= stockVolatility) || 
                                 (macdDeathCross && rsiDecline) ||
                                 bottomDivergence;
            
            if (shortCondition) {
                if (playerMoney - moneyKeep > ns.stock.getPurchaseCost(stock, minShare, "Short")) {
                    const shares = Math.min((playerMoney - moneyKeep - 100000) / askPrice, maxSharesShort);
                    const boughtFor = ns.stock.buyShort(stock, shares);
                    
                    if (boughtFor > 0) {
                        ns.toast(`卖空 ${Math.round(shares)} 股 ${stock}，金额 ${format(boughtFor)}`, 'success', toastDuration);
                    }
                }
            }
        }
    }

    /**
     * 卖出头寸函数
     */
    function sellIfOutsideThreshold(stock, priceHistory, macdHistory, rsiHistory) {
        const position = ns.stock.getPosition(stock);
        const bidPrice = ns.stock.getBidPrice(stock);
        const forecast = ns.stock.getForecast(stock);
        
        if (position[0] > 0) {
            // 计算利润
            const profit = position[0] * (bidPrice - position[1]) - 200000;
            const profitPct = profit / (position[0] * position[1]);
            
            // 计算技术指标
            const macdData = calculateMACD(priceHistory);
            const rsi = calculateRSI(priceHistory, RSI_PERIOD);
            const prevMacd = macdHistory.length > 0 ? macdHistory[macdHistory.length - 1] : null;
            const prevRsi = rsiHistory.length > 0 ? rsiHistory[rsiHistory.length - 1] : 50;
            
            // MACD死叉检测
            const macdDeathCross = macdData && prevMacd 
                ? (macdData.macd < macdData.signal) && (prevMacd.macd >= prevMacd.signal)
                : false;
            
            // RSI从超买区回落
            const rsiDecline = (prevRsi > RSI_OVERBOUGHT) && (rsi < RSI_OVERBOUGHT);
            
            // 顶背离检测
            const topDivergence = checkDivergence(priceHistory, macdHistory, 'top') || 
                                 checkDivergence(priceHistory, rsiHistory, 'top');
            
            // 卖出条件：技术指标信号或止盈止损
            const sellCondition = forecast < sellThreshold_Long || 
                                 profitPct >= takeProfit || 
                                 profitPct <= stopLoss ||
                                 macdDeathCross || 
                                 rsiDecline ||
                                 topDivergence;
            
            if (sellCondition) {
                ns.stock.sellStock(stock, position[0]);
                let reason = "";
                if (profitPct >= takeProfit) reason = "止盈";
                else if (profitPct <= stopLoss) reason = "止损";
                else if (macdDeathCross) reason = "MACD死叉";
                else if (rsiDecline) reason = "RSI回落";
                else if (topDivergence) reason = "顶背离";
                
                ns.toast(`以${reason}卖出 ${position[0]} 股 ${stock}，获利 ${format(profit)} (${ns.formatPercent(profitPct, 1)})`, 'success', toastDuration);
            }
        }
        
        if (shortUnlock && position[2] > 0) {
            // 计算利润
            const profit = position[2] * (position[3] - bidPrice) - 200000;
            const profitPct = profit / (position[2] * position[3]);
            
            // 计算技术指标
            const macdData = calculateMACD(priceHistory);
            const rsi = calculateRSI(priceHistory, RSI_PERIOD);
            const prevMacd = macdHistory.length > 0 ? macdHistory[macdHistory.length - 1] : null;
            const prevRsi = rsiHistory.length > 0 ? rsiHistory[rsiHistory.length - 1] : 50;
            
            // MACD金叉检测
            const macdGoldenCross = macdData && prevMacd 
                ? (macdData.macd > macdData.signal) && (prevMacd.macd <= prevMacd.signal)
                : false;
            
            // RSI从超卖区回升
            const rsiRecovery = (prevRsi < RSI_OVERSOLD) && (rsi > RSI_OVERSOLD);
            
            // 底背离检测
            const bottomDivergence = checkDivergence(priceHistory, macdHistory, 'bottom') || 
                                   checkDivergence(priceHistory, rsiHistory, 'bottom');
            
            // 卖出条件：技术指标信号或止盈止损
            const sellCondition = forecast > sellThreshold_Short || 
                                 profitPct >= takeProfit || 
                                 profitPct <= stopLoss ||
                                 macdGoldenCross || 
                                 rsiRecovery ||
                                 bottomDivergence;
            
            if (sellCondition) {
                ns.stock.sellShort(stock, position[2]);
                let reason = "";
                if (profitPct >= takeProfit) reason = "止盈";
                else if (profitPct <= stopLoss) reason = "止损";
                else if (macdGoldenCross) reason = "MACD金叉";
                else if (rsiRecovery) reason = "RSI回升";
                else if (bottomDivergence) reason = "底背离";
                
                ns.toast(`以${reason}平仓空头 ${position[2]} 股 ${stock}，获利 ${format(profit)} (${ns.formatPercent(profitPct, 1)})`, 'success', toastDuration);
            }
        }
    }

    // 缓存股票列表
    const allStocks = ns.stock.getSymbols();
    
    // 历史数据存储
    const priceHistory = {};
    const macdHistory = {};
    const rsiHistory = {};
    
    for (const stock of allStocks) {
        priceHistory[stock] = [];
        macdHistory[stock] = [];
        rsiHistory[stock] = [];
    }

    // 主循环
    while (runScript) {
        ns.clearLog();
        const playerMoney = ns.getPlayer().money;
        let currentWorth = 0;
        ns.print("---------------------------------------");
        
        // 更新历史数据
        for (const stock of allStocks) {
            const price = ns.stock.getBidPrice(stock);
            priceHistory[stock].push(price);
            if (priceHistory[stock].length > 50) priceHistory[stock].shift();
        }
        
        // 处理卖出逻辑
        for (const stock of allStocks) {
            const position = ns.stock.getPosition(stock);
            if (position[0] > 0 || position[2] > 0) {
                sellIfOutsideThreshold(stock, priceHistory[stock], macdHistory[stock], rsiHistory[stock]);
            }
        }
        
        // 处理买入逻辑
        for (const stock of allStocks) {
            buyPositions(stock, priceHistory[stock], macdHistory[stock], rsiHistory[stock]);
        }
        
        // 更新MACD和RSI历史
        for (const stock of allStocks) {
            if (priceHistory[stock].length > MACD_LONG_PERIOD) {
                const macdData = calculateMACD(priceHistory[stock]);
                if (macdData) {
                    macdHistory[stock].push(macdData);
                    if (macdHistory[stock].length > 10) macdHistory[stock].shift();
                }
                
                const rsi = calculateRSI(priceHistory[stock], RSI_PERIOD);
                rsiHistory[stock].push(rsi);
                if (rsiHistory[stock].length > 10) rsiHistory[stock].shift();
            }
        }
        
        // 计算当前持仓价值
        for (const stock of allStocks) {
            const position = ns.stock.getPosition(stock);
            if (position[0] > 0 || position[2] > 0) {
                const [longShares, longPrice, shortShares, shortPrice] = position;
                const profit = longShares * (ns.stock.getBidPrice(stock) - longPrice) - 200000;
                const profitShort = shortShares * (shortPrice - ns.stock.getBidPrice(stock)) - 200000;
                currentWorth += profit + profitShort + (longShares * longPrice) + (shortShares * shortPrice);
            }
        }
        
        // 状态输出
        ns.print("══════════════════════════════════");
        ns.print(`  📈 股票总价值: ${format(currentWorth)}`);
        ns.print(`  💰 可用现金: ${format(playerMoney)}`);
        ns.print(`  🏦 总净资产: ${format(currentWorth + playerMoney)}`);
        ns.print(`  🕒 ${new Date().toLocaleTimeString()}`);
        ns.print("══════════════════════════════════");
        
        await ns.sleep(1000);
    }
}
