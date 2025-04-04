//
// Imports
//
import { companyMeta } from 'stocks/companyMetadata.js';
import * as lib from 'stocks/lib.js';

/** @param {NS} ns */
export async function main(ns) {
	//
	// Logging
	//
	ns.disableLog('ALL');
	ns.clearLog();
	ns.tail();


	//
	// Globals
	//
	const scriptTimer = 2000; // Time script waits
	//const moneyKeep = 1000000000; // Failsafe Money
	const moneyKeep = Math.max([ns.read("reserve.txt"), 0]); // Failsafe Money

	const stockBuyOver_Long = 0.60; // Buy stocks when forcast is over this % 
	const stockBuyUnder_Short = 0.40; // Buy shorts when forcast is under this % 
	const stockVolatility = 0.05; // Stocks must be under this volatility 
	const minSharePercent = 5;
	const maxSharePercent = 1.00;
	const sellThreshold_Long = 0.55; // Sell Long when chance of increasing is under this
	const sellThreshold_Short = 0.40; // Sell Short when chance of increasing is under this
	const shortUnlock = true;  // Set true when short stocks are available to player
	const minSharesToBuy = 1500;  // Tweek this as needed

	const toastDuration = 15000;   // Toast message duration

	const dots = ['.', '..', '...', '....']
	let indexDots = 0;

	const growServer = "home";  // You want to run this on home unless you modify it
	const growScript = '/stocks/growStock.js';  // The grow() script
	//let growThreads = 1000000;  //  How many threads max to use for slaved grow() scripts
	let growThreads = 10000000

	let totalIncome = 0;

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
		const symbolRepeat = Math.floor(Math.abs(forecast * 10)) - 4;
		const plusOrMinus = true ? 50 + symbolRepeat : 50 - symbolRepeat;
		const forcastDisplay = (plusOrMinus ? "+" : "-").repeat(Math.abs(symbolRepeat));
		const profit = position[0] * (ns.stock.getBidPrice(stock) - position[1]) - (200000);
		const company = companyMeta.find(company => company.stockSymbol === stock);

		// Output stock info & forecast
		ns.print(' ' + company.companyName + ' (' + company.serverName + ')');
		ns.print(' ' + stock + ' 4S Forecast -> ' + (Math.round(forecast * 100) + '%   ' + forcastDisplay));
		ns.print('         Position -> ' + ns.nFormat(position[0], '0.00a'));
		ns.print('         Profit -> ' + lib.formatReallyBigNumber(ns, profit));
		ns.print("-----------------------------------------------");
	}

	function sellLongPosition(stock, position, forecast) {
		const soldFor = ns.stock.sellStock(stock, position[0]);
		const message = 'Sold ' + position[0] + ' Long shares of ' + stock + ' for ' + ns.nFormat(soldFor, '$0.000a');
		const bidPrice = ns.stock.getBidPrice(stock);
		const profit = position[0] * (bidPrice - position[1]) - (2 * 100000);
		const company = companyMeta.find(company => company.stockSymbol === stock);

		totalIncome += profit;
		ns.toast(message, 'success', toastDuration);

		// Check for server
		if (company.serverName.length > 0) {
			ns.kill(growScript, 'home', company.serverName);
		} else {
			ns.tprint("WARNING- No server found for: " + company.companyName);
		}
	}

	function sellIfOutsideThreshdold(stock) {
		const position = ns.stock.getPosition(stock);
		const forecast = ns.stock.getForecast(stock);

		if (position[0] > 0) {
			printStockInfo(stock, position, forecast);

			// Check if we need to sell Long stocks
			if (forecast < sellThreshold_Long) {
				sellLongPosition(stock, position, forecast);
			}
		}

		if (shortUnlock) {
			// Check if we need to sell Short stocks
			if (position[2] > 0) {
				ns.print(stock + ' 4S Forecast -> ' + forecast.toFixed(2));

				// Check if we need to sell Short stocks
				if (forecast > sellThreshold_Short) {
					let soldFor = ns.stock.sellShort(stock, position[2]);
					let message = 'Sold ' + stock + ' Short shares of ' + stock + ' for ' + ns.nFormat(soldFor, '$0.000a');

					ns.toast(message, 'success', toastDuration);
				}
			}
		}
	}

	function getOrderedStocks() {
		return ns.stock.getSymbols().sort((a, b) =>
			Math.abs(0.5 - ns.stock.getForecast(b)) - Math.abs(0.5 - ns.stock.getForecast(a))
		);
	}

	function calculateGrowThreads(ns, targetServer) {
		const ramAvailable = ns.getServerMaxRam(growServer) - ns.getServerUsedRam(growServer);
		const ramPerThread = ns.getScriptRam(growScript);
		const growThreadsPossible = Math.floor(ramAvailable / ramPerThread);
		const growThreadsNeeded = ns.growthAnalyze(targetServer, 2, ns.getServer(targetServer).cpuCores);

		let threads = Math.min(growThreads, growThreadsPossible, growThreadsNeeded);
		return {
			canRun: threads > 0,
			threads: threads
		};
	}

	function calculatePositionValue(position, stock) {
		const bidPrice = ns.stock.getBidPrice(stock);
		let value = 0;
		let profit = 0;

		if (position[0] > 0) { // Long position
			const longProfit = position[0] * (bidPrice - position[1]) - (2 * 100000);
			value += position[0] * position[1] + longProfit;
			profit += longProfit;
		}

		if (position[2] > 0) { // Short position
			const shortProfit = position[2] * Math.abs(bidPrice - position[3]) - (2 * 100000);
			value += position[2] * position[3] + shortProfit;
			profit += shortProfit;
		}

		return { value, profit };
	}

	// Main Loop
	while (true) {
		const orderedStocks = getOrderedStocks();
		let currentWorth = 0;
		let totalProfit = 0;
		const dot = dots[indexDots];

		ns.print("===============================================");

		for (const stock of orderedStocks) {
			const position = ns.stock.getPosition(stock);

			// Check if we have stock in the position
			if (position[0] > 0 || position[2] > 0) {
				sellIfOutsideThreshdold(stock);
			}

			buyPositions(stock);

			if (position[0] > 0 || position[2] > 0) {
				const { value, profit } = calculatePositionValue(position, stock);
				currentWorth += value;
				totalProfit += profit;
			}
		}

		// Output Script Status
		const progress = Math.max(Math.min(ns.getServerUsedRam('home') / ns.getServerMaxRam('home'), 1), 0);
		const bars = Math.max(Math.floor(progress / (1 / 20)), 1);
		const dashes = Math.max(20 - bars, 0);

		let barOutput = '[' + "|".repeat(bars) + "-".repeat(dashes) + "]";
		let prefix = '';

		if (bars > 16) prefix = 'WARNING- ';
		else if (bars > 18) prefix = 'ERROR- ';
		else prefix = '         ';

		let stockIncome = ns.getScriptIncome(ns.getRunningScript().filename) * 3600;

		ns.print(' Current Stock Worth: ' + lib.formatReallyBigNumber(ns, currentWorth));
		ns.print('         Total Profit: ' + lib.formatReallyBigNumber(ns, totalProfit));
		ns.print('         Total Income: ' + lib.formatReallyBigNumber(ns, totalIncome) + ' ($' + ns.nFormat(stockIncome, '0.0a') + '/hr)');
		ns.print('         Net Worth: ' + lib.formatReallyBigNumber(ns, currentWorth + ns.getPlayer().money));
		ns.print(prefix + 'Server RAM: ' + barOutput);
		ns.print("-----------------------------------------------");
		ns.print(' ' + new Date().toLocaleTimeString() + ' - Running ' + dot);
		ns.print("===============================================");

		await ns.sleep(scriptTimer);

		// Upadate progress dots
		indexDots = indexDots >= dots.length - 1 ? 0 : indexDots + 1;

		// Clearing log makes the display more static
		// If you need the stock history, save it to a file
		ns.clearLog()
	}
}
