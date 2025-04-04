//
// 导入
//
import { companyMeta } from 'stocks/companyMetadata.js';
import * as lib from 'stocks/lib.js';

/** @param {NS} ns */
export async function main(ns) {
	//
	// 日志设置
	//
	ns.disableLog('ALL');  // 禁用所有日志
	ns.clearLog();  // 清空日志
	ns.tail();  // 将日志显示在窗口中

	//
	// 全局变量
	//
	const scriptTimer = 2000; // 脚本等待时间(毫秒)
	//const moneyKeep = 1000000000; // 保留资金(旧版)
	const moneyKeep = Math.max([ns.read("reserve.txt"), 0]); // 从文件读取保留资金

	const stockBuyOver_Long = 0.60; // 当预测值超过此百分比时买入股票(做多)
	const stockBuyUnder_Short = 0.40; // 当预测值低于此百分比时买入空头(做空) 
	const stockVolatility = 0.05; // 股票波动率必须低于此值
	const minSharePercent = 5;  // 最小持股百分比
	const maxSharePercent = 1.00;  // 最大持股百分比
	const sellThreshold_Long = 0.55; // 当上涨概率低于此值时卖出多头
	const sellThreshold_Short = 0.40; // 当上涨概率低于此值时卖空头
	const shortUnlock = true;  // 当玩家可以做空股票时设为true
	const minSharesToBuy = 1500;  // 最小购买股数(可根据需要调整)

	const toastDuration = 15000;   // 提示消息显示时长(毫秒)

	const dots = ['.', '..', '...', '....']  // 进度点动画
	let indexDots = 0;  // 当前进度点索引

	const growServer = "home";  // 运行此脚本的服务器(默认为home)
	const growScript = '/stocks/growStock.js';  // 股票增长脚本
	let growThreads = 10000000  // 用于增长脚本的最大线程数

	let totalIncome = 0;  // 总收入统计

	//
	// Functions
	//
	function buyPositions(stock) {
		let position = ns.stock.getPosition(stock);
		let maxShares = (ns.stock.getMaxShares(stock) * maxSharePercent) - position[0];
		let maxSharesShort = (ns.stock.getMaxShares(stock) * maxSharePercent) - position[2];
		const askPrice = ns.stock.getAskPrice(stock);
		const forecast = ns.stock.getForecast(stock);
		const volatilityPercent = ns.stock.getVolatility(stock);
		const playerMoney = ns.getPlayer().money;
		const shouldBuyLong = forecast >= stockBuyOver_Long && volatilityPercent <= stockVolatility;

		// Look for Long Stocks to buy
		if (shouldBuyLong) {
			if (playerMoney - moneyKeep > ns.stock.getPurchaseCost(stock, minSharePercent, "Long")) {
				let shares = Math.min((playerMoney - moneyKeep - 100000) / askPrice, maxShares);
				let boughtFor = 0;

				if (shares >= minSharesToBuy) boughtFor = ns.stock.buyStock(stock, shares);

				if (boughtFor > 0) {
					const message = 'Bought ' + Math.round(shares) + ' Long shares of ' + stock + ' for ' + lib.formatReallyBigNumber(ns, boughtFor);
					const company = companyMeta.find(company => company.stockSymbol === stock);

					ns.toast(message, 'success', toastDuration);

					// Check for company and server
					if (company && company.serverName.length > 0) {
						// Check if company has a server
						if (company.serverName != 'NoServer') {
							if (ns.hasRootAccess(company.serverName)) {
								const { canRun, threads } = calculateGrowThreads(ns, company.serverName);
								if (canRun) {
									ns.run(growScript, threads, company.serverName);
								} else {
									ns.tprint("WARNING- Not enough RAM available on home to execute grow() for " + company.serverName);
								}
							}
							else {
								//ns.tprint("WARNING- No root access for: " + company.serverName);
							}
						}
					}
					else {
						ns.tprint("WARNING- No server defined for: " + stock);
					}
				}
			}


			// Look for Short Stocks to buy
			if (shortUnlock) {
				const shouldBuyShort = forecast <= stockBuyUnder_Short && volatilityPercent <= stockVolatility;
				if (shouldBuyShort) {
					if (playerMoney - moneyKeep > ns.stock.getPurchaseCost(stock, minSharePercent, "Short")) {
						let shares = Math.min((playerMoney - moneyKeep - 100000) / askPrice, maxSharesShort);
						let boughtFor = ns.stock.buyShort(stock, shares);

						if (boughtFor > 0) {
							let message = 'Bought ' + Math.round(shares) + ' Short shares of ' + stock + ' for ' + lib.formatReallyBigNumber(ns, boughtFor);

							ns.toast(message, 'success', toastDuration);
						}
					}
				}
			}
		}
	}

	function printStockInfo(stock, position, forecast) {
		// 计算预测值显示符号
		const symbolRepeat = Math.floor(Math.abs(forecast * 10)) - 4;
		const plusOrMinus = true ? 50 + symbolRepeat : 50 - symbolRepeat;
		const forcastDisplay = (plusOrMinus ? "+" : "-").repeat(Math.abs(symbolRepeat));
		// 计算利润
		const profit = position[0] * (ns.stock.getBidPrice(stock) - position[1]) - (200000);
		// 查找公司信息
		const company = companyMeta.find(company => company.stockSymbol === stock);

		// 输出股票信息和预测
		ns.print(' ' + company.companyName + ' (' + company.serverName + ')');
		ns.print(' ' + stock + ' 4S Forecast -> ' + (Math.round(forecast * 100) + '%   ' + forcastDisplay));
		ns.print('         持仓量 -> ' + ns.nFormat(position[0], '0.00a'));
		ns.print('         利润 -> ' + lib.formatReallyBigNumber(ns, profit));
		ns.print("-----------------------------------------------");
	}

	function sellLongPosition(stock, position, forecast) {
		// 卖出多头持仓
		const soldFor = ns.stock.sellStock(stock, position[0]);
		const message = '卖出 ' + position[0] + ' 股 ' + stock + ' 多头, 获得 ' + ns.nFormat(soldFor, '$0.000a');
		const bidPrice = ns.stock.getBidPrice(stock);
		// 计算利润
		const profit = position[0] * (bidPrice - position[1]) - (2 * 100000);
		const company = companyMeta.find(company => company.stockSymbol === stock);

		// 更新总收入
		totalIncome += profit;
		ns.toast(message, 'success', toastDuration);

		// 检查关联服务器并停止增长脚本
		if (company.serverName.length > 0) {
			ns.kill(growScript, 'home', company.serverName);
		} else {
			ns.tprint("警告- 未找到服务器: " + company.companyName);
		}
	}

	function sellIfOutsideThreshdold(stock) {
		// 获取当前持仓和预测
		const position = ns.stock.getPosition(stock);
		const forecast = ns.stock.getForecast(stock);

		// 处理多头持仓
		if (position[0] > 0) {
			printStockInfo(stock, position, forecast);

			// 检查是否需要卖出多头
			if (forecast < sellThreshold_Long) {
				sellLongPosition(stock, position, forecast);
			}
		}

		// 处理空头持仓(如果已解锁)
		if (shortUnlock) {
			if (position[2] > 0) {
				ns.print(stock + ' 4S 预测 -> ' + forecast.toFixed(2));

				// 检查是否需要卖空头
				if (forecast > sellThreshold_Short) {
					let soldFor = ns.stock.sellShort(stock, position[2]);
					let message = '卖出 ' + stock + ' 股空头, 获得 ' + ns.nFormat(soldFor, '$0.000a');

					ns.toast(message, 'success', toastDuration);
				}
			}
		}
	}

	function getOrderedStocks() {
		// 按预测值偏离0.5的程度排序股票
		return ns.stock.getSymbols().sort((a, b) =>
			Math.abs(0.5 - ns.stock.getForecast(b)) - Math.abs(0.5 - ns.stock.getForecast(a))
		);
	}

	function calculateGrowThreads(ns, targetServer) {
		// 计算可用RAM
		const ramAvailable = ns.getServerMaxRam(growServer) - ns.getServerUsedRam(growServer);
		// 计算单线程RAM需求
		const ramPerThread = ns.getScriptRam(growScript);
		// 计算可能的最大线程数
		const growThreadsPossible = Math.floor(ramAvailable / ramPerThread);
		// 计算需要的线程数
		const growThreadsNeeded = ns.growthAnalyze(targetServer, 2, ns.getServer(targetServer).cpuCores);

		// 取最小值作为实际线程数
		let threads = Math.min(growThreads, growThreadsPossible, growThreadsNeeded);
		return {
			canRun: threads > 0,  // 是否可以运行
			threads: threads      // 实际线程数
		};
	}

	function calculatePositionValue(position, stock) {
		// 获取当前卖出价
		const bidPrice = ns.stock.getBidPrice(stock);
		let value = 0;    // 总价值
		let profit = 0;    // 总利润

		// 计算多头持仓价值
		if (position[0] > 0) { 
			const longProfit = position[0] * (bidPrice - position[1]) - (2 * 100000);
			value += position[0] * position[1] + longProfit;
			profit += longProfit;
		}

		// 计算空头持仓价值
		if (position[2] > 0) { 
			const shortProfit = position[2] * Math.abs(bidPrice - position[3]) - (2 * 100000);
			value += position[2] * position[3] + shortProfit;
			profit += shortProfit;
		}

		return { value, profit };
	}

	// 主循环
	while (true) {
		// 获取排序后的股票列表
		const orderedStocks = getOrderedStocks();
		let currentWorth = 0;     // 当前总价值
		let totalProfit = 0;      // 当前总利润
		const dot = dots[indexDots];  // 进度点

		ns.print("===============================================");

		// 处理每只股票
		for (const stock of orderedStocks) {
			const position = ns.stock.getPosition(stock);

			// 检查是否有持仓
			if (position[0] > 0 || position[2] > 0) {
				sellIfOutsideThreshdold(stock);
			}

			// 尝试买入
			buyPositions(stock);

			// 计算持仓价值
			if (position[0] > 0 || position[2] > 0) {
				const { value, profit } = calculatePositionValue(position, stock);
				currentWorth += value;
				totalProfit += profit;
			}
		}

		// 输出脚本状态信息
		const progress = Math.max(Math.min(ns.getServerUsedRam('home') / ns.getServerMaxRam('home'), 1), 0);
		const bars = Math.max(Math.floor(progress / (1 / 20)), 1);
		const dashes = Math.max(20 - bars, 0);

		let barOutput = '[' + "|".repeat(bars) + "-".repeat(dashes) + "]";
		let prefix = '';

		// 根据RAM使用量设置警告前缀
		if (bars > 16) prefix = '警告- ';
		else if (bars > 18) prefix = '错误- ';
		else prefix = '         ';

		// 计算每小时股票收入
		let stockIncome = ns.getScriptIncome(ns.getRunningScript().filename) * 3600;

		// 输出股票信息
		ns.print(' 当前股票价值: ' + lib.formatReallyBigNumber(ns, currentWorth));
		ns.print('         总利润: ' + lib.formatReallyBigNumber(ns, totalProfit));
		ns.print('         总收入: ' + lib.formatReallyBigNumber(ns, totalIncome) + ' ($' + ns.nFormat(stockIncome, '0.0a') + '/小时)');
		ns.print('         净资产: ' + lib.formatReallyBigNumber(ns, currentWorth + ns.getPlayer().money));
		ns.print(prefix + '服务器内存: ' + barOutput);
		ns.print("-----------------------------------------------");
		ns.print(' ' + new Date().toLocaleTimeString() + ' - 运行中 ' + dot);
		ns.print("===============================================");

		// 等待下次循环
		await ns.sleep(scriptTimer);

		// 更新进度点动画
		indexDots = indexDots >= dots.length - 1 ? 0 : indexDots + 1;

		// 清空日志使显示更静态
		// 如果需要股票历史记录，请将其保存到文件中
		ns.clearLog()
	}
}
