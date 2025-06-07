/** @param {NS} ns */
export async function main(ns) {
    // 日志设置
    ns.disableLog('ALL');
    ns.ui.openTail();

    // 全局变量
    const moneyKeep = Number(ns.read("reserve.txt"));   // 保留的安全资金(默认为reserve.txt中的值)
    const stockBuyOver_Long = 0.60;     // 当预测高于此百分比时买入股票
    const stockBuyUnder_Short = 0.40;   // 当预测低于此百分比时买入股票(如果解锁卖空功能)
    const stockVolatility = 0.03;   // 允许的最大波动率(5%)
    const minShare = 5;
    const maxSharePercent = 1;   // 最大买入百分比(100%)
    const sellThreshold_Long = 0.55;    // 当上涨概率低于此值时卖出多头    
    const sellThreshold_Short = 0.45;   // 当下跌概率高于此值时卖出空头
    const takeProfit = 0.12;   // 止盈百分比（12%）
    const stopLoss = -0.05;    // 止损百分比（-5%）
    const shortUnlock = false;      // 是否解锁卖空功能(如果解锁则允许卖空)
    const runScript = true; // 是否运行脚本(如果需要停止脚本，请将此值设置为false)
    const toastDuration = 15000;   // 提示消息持续时间(毫秒)

    // 函数定义
    // 对能处理的数值使用nFormat进行格式化
    // 主要处理常规数字的显示格式
    function format(number) {
        if (Math.abs(number) < 1e-6) {
            number = 0;
        }
        const absNum = Math.abs(number)
        const answer = number < 0
            ? `\x1b[31m-$${ns.formatNumber(absNum, 2)}\x1b[0m`
            : ` $${ns.formatNumber(absNum, 2)}`;

        if (answer === "NaN") {
            return `${number}`;
        }

        return answer;
    }

    /**
     * 买入头寸函数
     * @param {string} stock - 股票代码
     * 功能: 根据预测和波动率决定买入多头或空头
     * 条件1: 预测值高于阈值且波动率低于阈值时买入多头
     * 条件2: 预测值低于阈值且波动率低于阈值时买入空头(如果解锁)
     * 注意: 会保留安全资金(moneyKeep)
     */
    function buyPositions(stock) {
        let position = ns.stock.getPosition(stock); // 获取当前头寸
        let maxShares = (ns.stock.getMaxShares(stock) * maxSharePercent) - position[0]; // 计算可买入的最大多头股数
        let maxSharesShort = (ns.stock.getMaxShares(stock) * maxSharePercent) - position[2];    // 计算可买入的最大空头股数
        let askPrice = ns.stock.getAskPrice(stock); // 获取当前卖出价格
        let forecast = ns.stock.getForecast(stock); // 获取股票预测值
        let volatilityPercent = ns.stock.getVolatility(stock);  // 获取股票波动率
        let playerMoney = ns.getPlayer().money; // 获取玩家当前资金

        // 凯利公式计算投资比例
        const kellyLong = (forecast * (1 + volatilityPercent) - 1) / volatilityPercent;
        const kellyShort = ((1 - forecast) * (1 + volatilityPercent) - 1) / volatilityPercent;
        const maxKellyFraction = 0.2; // 最大投资比例限制


        // Look for Long Stocks to buy (使用凯利公式优化)
        if (forecast >= stockBuyOver_Long && volatilityPercent <= stockVolatility) {
            if (playerMoney - moneyKeep > ns.stock.getPurchaseCost(stock, minShare, "Long")) {
                // 计算凯利比例并限制范围
                const kellyF = Math.max(0, Math.min(kellyLong, maxKellyFraction));
                const moneyToInvest = (playerMoney - moneyKeep) * kellyF;
                let shares = Math.min(moneyToInvest / askPrice, maxShares);
                let boughtFor = ns.stock.buyStock(stock, shares);

                if (boughtFor > 0) {
                    let message = 'Bought ' + Math.round(shares) + ' Long shares of ' + stock + ' for ' + format(boughtFor);

                    ns.toast(message, 'success', toastDuration);
                }
            }
        }

        // Look for Short Stocks to buy (使用凯利公式优化)
        if (shortUnlock) {
            if (forecast <= stockBuyUnder_Short && volatilityPercent <= stockVolatility) {
                if (playerMoney - moneyKeep > ns.stock.getPurchaseCost(stock, minShare, "Short")) {
                    // 计算凯利比例并限制范围
                    const kellyF = Math.max(0, Math.min(kellyShort, maxKellyFraction));
                    const moneyToInvest = (playerMoney - moneyKeep) * kellyF;
                    let shares = Math.min(moneyToInvest / askPrice, maxSharesShort);
                    let boughtFor = ns.stock.buyShort(stock, shares);

                    if (boughtFor > 0) {
                        let message = 'Bought ' + Math.round(shares) + ' Short shares of ' + stock + ' for ' + format(boughtFor);

                        ns.toast(message, 'success', toastDuration);
                    }
                }
            }
        }
    }

    /**
     * 卖出头寸函数
     * @param {string} stock - 股票代码
     * 功能: 检查并卖出不符合条件的头寸
     * 卖出多头条件: 预测值低于sellThreshold_Long
     * 卖出空头条件: 预测值高于sellThreshold_Short(如果解锁)
     * 附加功能: 打印股票预测信息和利润数据
     */
    function sellIfOutsideThreshdold(stock) {
        let position = ns.stock.getPosition(stock); // 获取当前头寸
        let forecast = ns.stock.getForecast(stock); // 获取股票预测值

        if (position[0] > 0) {
            // 预测可视化 (0-100% 条形图)
            const forecastBarLength = 20;
            const forecastBarPos = Math.floor(forecast * forecastBarLength);
            const forecastBar = '[' +
                '='.repeat(forecastBarPos) +
                '|' +
                ' '.repeat(forecastBarLength - forecastBarPos - 1) +
                ']';

            // 利润计算与颜色标记
            const profit = position[0] * (ns.stock.getBidPrice(stock) - position[1]) - 200000;
            const profitColor = profit >= 0 ? '\x1b[32m' : '\x1b[31m';
            const profitPct = profit / (position[0] * position[1]);

            // 打印增强版股票信息
            ns.print(`📊 ${stock.padEnd(5)} ${forecastBar} ${ns.formatPercent(forecast, 1).padStart(6)}`);
            ns.print(`├─ Position: ${format(position[0])} (${ns.formatPercent(position[0] / ns.stock.getMaxShares(stock), 1)} of max)`);
            ns.print(`├─ Avg Cost: ${format(position[1])}`);
            ns.print(`├─ Current: ${format(ns.stock.getBidPrice(stock))}`);
            ns.print(`└─ ${profitColor}Profit: ${format(profit)} (${ns.formatPercent(profitPct, 1)})${profit >= 0 ? '\x1b[0m' : '\x1b[0m'}`);

            // 检查是否需要卖出多头股票           
            // 检查是否需要卖出多头股票（基于预测阈值或止盈止损）
            if (forecast < sellThreshold_Long || profitPct >= takeProfit || profitPct <= stopLoss) {
                ns.stock.sellStock(stock, position[0]);
                let reason = "";
                if (profitPct >= takeProfit) reason = "止盈";
                else if (profitPct <= stopLoss) reason = "止损";
                else reason = "预测值低于阈值";

                let message = `以${reason}卖出 ${position[0]} 股 ${stock}，获利 ${format(profit)} (${ns.formatPercent(profitPct, 1)})`;
                ns.toast(message, 'success', toastDuration);
            }
        }

        if (shortUnlock) {
            if (position[2] > 0) {
                ns.print(stock + ' 4S Forecast -> ' + forecast.toFixed(2));

                // 检查是否需要卖出空头股票 
                // 计算空头利润
                const profitShort = position[2] * (position[3] - ns.stock.getBidPrice(stock)) - 200000;
                const profitShortPct = profitShort / (position[2] * position[3]);

                ns.print(`       Short Position: ${format(position[2])}`);
                ns.print(`       ${profitColor}Short Profit: ${format(profitShort)} (${ns.formatPercent(profitShortPct, 1)})${profitShort >= 0 ? '\x1b[0m' : '\x1b[0m'}`);

                // 检查是否需要卖出空头股票（基于预测阈值或止盈止损）
                if (forecast > sellThreshold_Short || profitShortPct >= takeProfit || profitShortPct <= stopLoss) {
                    ns.stock.sellShort(stock, position[2]);
                    let reason = "";
                    if (profitShortPct >= takeProfit) reason = "止盈";
                    else if (profitShortPct <= stopLoss) reason = "止损";
                    else reason = "预测值高于阈值";

                    let message = `以${reason}卖出 ${position[2]} 股空头 ${stock}，获利 ${format(profitShort)} (${ns.formatPercent(profitShortPct, 1)})`;
                    ns.toast(message, 'success', toastDuration);
                }
            }
        }
    }

    // 缓存股票列表 (性能优化)
    const allStocks = ns.stock.getSymbols();

    // 主循环
    while (runScript) {
        ns.clearLog();
        // 获取玩家资金 (单次调用优化)
        const playerMoney = ns.getPlayer().money;
        let currentWorth = 0;
        ns.print("---------------------------------------");

        // 批量获取股票数据 (减少API调用)
        const stockData = allStocks.map(stock => {
            const position = ns.stock.getPosition(stock);
            const bidPrice = ns.stock.getBidPrice(stock);
            return {
                symbol: stock,
                position,
                bidPrice,
                forecast: ns.stock.getForecast(stock)
            };
        });

        // 处理卖出逻辑
        for (const { symbol, position } of stockData) {
            if (position[0] > 0 || position[2] > 0) {
                sellIfOutsideThreshdold(symbol);
            }
        }

        // 处理买入逻辑
        for (const { symbol } of stockData) {
            buyPositions(symbol);
        }

        // 计算当前持仓价值
        for (const { position, bidPrice } of stockData) {
            if (position[0] > 0 || position[2] > 0) {
                const [longShares, longPrice, shortShares, shortPrice] = position;
                const profit = longShares * (bidPrice - longPrice) - 200000;
                const profitShort = shortShares * Math.abs(bidPrice - shortPrice) - 200000;
                currentWorth += profit + profitShort + (longShares * longPrice) + (shortShares * shortPrice);
            }
        }

        // 状态输出 (优化日志频率)
        ns.print("╔════════════════════════════════╗");
        ns.print(`║ 📈 股票总价值: ${format(currentWorth).padEnd(20)} ║`);
        ns.print(`║ 💰 可用现金: ${format(playerMoney).padEnd(21)} ║`);
        ns.print(`║ 🏦 总净资产: ${format(currentWorth + playerMoney).padEnd(20)} ║`);
        ns.print(`║ 🎯 止盈/止损: ${ns.formatPercent(takeProfit, 1)}/${ns.formatPercent(stopLoss, 1)}`);
        ns.print(`║ 🕒 ${new Date().toLocaleTimeString().padEnd(23)} ║`);
        ns.print("╚════════════════════════════════╝");

        // await ns.stock.nextUpdate();
        await ns.sleep(1000)
    }
}
