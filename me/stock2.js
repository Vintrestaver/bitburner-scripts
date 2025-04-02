import { initConfig } from './modules/config.js';
import { initAnalysis } from './modules/analysis.js';
import { initTrading } from './modules/trading.js';
import { initMarketState } from './modules/market-state.js';
import { initDashboard } from './modules/dashboard.js';
import { initUtils } from './modules/utils.js';

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog('ALL');
    const CONFIG = initConfig(ns);

    // Initialize global state
    const state = {
        symbols: ns.stock.getSymbols(),
        transactions: [],
        history: new Map(),
        metrics: {
            totalProfit: 0,
            peakNetWorth: 0,
            maxDrawdown: 0,
            lastCleanup: Date.now()
        }
    };

    // Initialize all modules
    const marketState = initMarketState(ns, CONFIG);
    const analysis = initAnalysis(ns, CONFIG);
    const trading = initTrading(ns, CONFIG, marketState, analysis);
    const dashboard = initDashboard(ns, CONFIG);
    const utils = initUtils(ns, CONFIG);

    // Wait for 4S API access
    await utils.check4SApiAccess();

    // Initialize historical data
    for (const sym of state.symbols) {
        state.history.set(sym, {
            prices: [],
            maShortWindow: [],
            maShortSum: 0,
            maLongWindow: [],
            maLongSum: 0,
            maShort: 0,
            maLong: 0,
            rsi: 50
        });
    }

    // Main loop
    while (true) {
        try {
            // Update market data
            for (const sym of state.symbols) {
                const data = state.history.get(sym);
                const price = (ns.stock.getBidPrice(sym) + ns.stock.getAskPrice(sym)) / 2;

                data.prices.push(price);
                analysis.updateMA(data, 'maShort', CONFIG.TREND_WINDOW, price);
                analysis.updateMA(data, 'maLong', CONFIG.BASE_WINDOW, price);
                data.rsi = analysis.calculateRSI(data.prices);
            }

            // Update market state
            marketState.update(state.symbols, state.history, trading);

            // Execute trades
            for (const sym of state.symbols) {
                const result = trading.managePosition(sym, state);
                if (result) {
                    utils.logTransaction(result, state);
                    continue;
                }

                const stockAnalysis = analysis.analyzeStock(sym, state.history.get(sym), ns);
                const tradeResult = trading.executeTrades(sym, stockAnalysis, state);
                if (tradeResult) {
                    utils.logTransaction(tradeResult, state);
                }
            }

            // Optimize memory usage
            utils.optimizeMemory(state, CONFIG);
            utils.cleanupCache(state, state.history, state.metrics);

            // Update display
            ns.clearLog();
            dashboard.display(state, trading, marketState);
            dashboard.adjustWindow();

            // Wait for next cycle
            await ns.sleep(2000 + Math.random() * 1000);

        } catch (error) {
            utils.handleError(error, state, trading);
            await ns.sleep(5000);
        }
    }
}