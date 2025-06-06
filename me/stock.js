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
    const minShare = 1000;
    const maxSharePercent = 1;   // 最大买入百分比(100%)
    const sellThreshold_Long = 0.55;    // 当上涨概率低于此值时卖出多头    
    const sellThreshold_Short = 0.45;   // 当下跌概率高于此值时卖出空头
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


        // Look for Long Stocks to buy
        if (forecast >= stockBuyOver_Long && volatilityPercent <= stockVolatility) {
            if (playerMoney - moneyKeep > ns.stock.getPurchaseCost(stock, minShare, "Long")) {
                let shares = Math.min((playerMoney - moneyKeep - 100000) / askPrice, maxShares);
                let boughtFor = ns.stock.buyStock(stock, shares);

                if (boughtFor > 0) {
                    let message = 'Bought ' + Math.round(shares) + ' Long shares of ' + stock + ' for ' + format(boughtFor);

                    ns.toast(message, 'success', toastDuration);
                }
            }
        }

        // Look for Short Stocks to buy
        if (shortUnlock) {
            if (forecast <= stockBuyUnder_Short && volatilityPercent <= stockVolatility) {
                if (playerMoney - moneyKeep > ns.stock.getPurchaseCost(stock, minShare, "Short")) {
                    let shares = Math.min((playerMoney - moneyKeep - 100000) / askPrice, maxSharesShort);
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
            ns.print(`${stock.padEnd(5)} Forecast ${ns.formatPercent(forecast, 1).padStart(6)} ${forecastBar}`);
            ns.print(`       Position: ${format(position[0])} (${ns.formatPercent(position[0] / ns.stock.getMaxShares(stock), 1)} of max)`);
            ns.print(`       ${profitColor}Profit: ${format(profit)} (${ns.formatPercent(profitPct, 1)})${profit >= 0 ? '\x1b[0m' : '\x1b[0m'}`);

            // 检查是否需要卖出多头股票           
            if (forecast < sellThreshold_Long) {
                let soldFor = ns.stock.sellStock(stock, position[0]);
                let message = 'Sold ' + position[0] + ' Long shares of ' + stock + ' for ' + ns.formatNumber(soldFor, 2);

                ns.toast(message, 'success', toastDuration);
            }
        }

        if (shortUnlock) {
            if (position[2] > 0) {
                ns.print(stock + ' 4S Forecast -> ' + forecast.toFixed(2));

                // 检查是否需要卖出空头股票 
                if (forecast > sellThreshold_Short) {
                    let soldFor = ns.stock.sellShort(stock, position[2]);
                    let message = 'Sold ' + stock + ' Short shares of ' + stock + ' for ' + ns.formatNumber(soldFor, 2);

                    ns.toast(message, 'success', toastDuration);
                }
            }
        }
    }


    // 主循环
    while (runScript) {
        // 第一次运行时记录初始资产(如果不存在)
        if (!ns.fileExists("initial_assets.txt")) {
            let initialWorth = 0;
            for (const stock of ns.stock.getSymbols()) {
                const position = ns.stock.getPosition(stock);
                if (position[0] > 0 || position[2] > 0) {
                    let longShares = position[0];
                    let longPrice = position[1];
                    let shortShares = position[2];
                    let shortPrice = position[3];
                    let bidPrice = ns.stock.getBidPrice(stock);
                    let profit = longShares * (bidPrice - longPrice) - (2 * 100000);
                    let profitShort = shortShares * Math.abs(bidPrice - shortPrice) - (2 * 100000);
                    initialWorth += profitShort + profit + (longShares * longPrice) + (shortShares * shortPrice);
                }
            }
            ns.write("initial_assets.txt", (initialWorth + ns.getPlayer().money).toString(), "w");
        }
        // 按有利预测顺序获取股票
        let orderedStocks = ns.stock.getSymbols().sort(function (a, b) {
            return Math.abs(0.5 - ns.stock.getForecast(b)) - Math.abs(0.5 - ns.stock.getForecast(a));
        })
        let currentWorth = 0;

        ns.print("---------------------------------------");

        for (const stock of orderedStocks) {
            const position = ns.stock.getPosition(stock);

            if (position[0] > 0 || position[2] > 0) {

                // 检查是否需要卖出
                sellIfOutsideThreshdold(stock);
            }

            // 检查是否应该买入
            buyPositions(stock);

            // 跟踪当前利润变化
            if (position[0] > 0 || position[2] > 0) {
                let longShares = position[0];
                let longPrice = position[1];
                let shortShares = position[2];
                let shortPrice = position[3];
                let bidPrice = ns.stock.getBidPrice(stock);

                // 计算利润(扣除佣金费用)
                // 多头利润 = 股数×(当前价-买入价) - 2次交易佣金(每次10万)
                let profit = longShares * (bidPrice - longPrice) - (2 * 100000);
                // 空头利润 = 股数×|当前价-卖空价| - 2次交易佣金
                let profitShort = shortShares * Math.abs(bidPrice - shortPrice) - (2 * 100000);

                // 计算净资产值
                // 总价值 = 空头利润 + 多头利润 + 多头市值 + 空头市值
                currentWorth += profitShort + profit + (longShares * longPrice) + (shortShares * shortPrice);
            }
        }

        // 增强版状态输出
        const totalAssets = currentWorth + ns.getPlayer().money;
        const initialAssets = Number(ns.read("initial_assets.txt") || totalAssets);
        const totalReturn = (totalAssets - initialAssets) / initialAssets;

        ns.print("══════════════════════════════════");
        ns.print(`  📈 股票总价值: ${format(currentWorth)}`);
        ns.print(`  💰 可用现金: ${format(ns.getPlayer().money)}`);
        ns.print(`  🏦 总净资产: ${format(totalAssets)}`);
        ns.print(`  📊 总收益率: ${totalReturn >= 0 ? '\x1b[32m' : '\x1b[31m'}${ns.formatPercent(totalReturn, 1)}\x1b[0m`);
        ns.print(`  🕒 ${new Date().toLocaleTimeString()}`);
        ns.print("══════════════════════════════════");

        // await ns.sleep(scriptTimer);
        await ns.stock.nextUpdate();

        // 清除日志使显示更静态
        // 如果需要股票历史记录，请保存到文件
        ns.clearLog()
    }
}
