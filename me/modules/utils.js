/** @param {NS} ns */
export function initUtils(ns, CONFIG) {
    return {
        async check4SApiAccess() {
            let retries = 0;
            while (!ns.stock.has4SDataTIXAPI()) {
                ns.ui.resizeTail(400, 60);
                ns.clearLog();
                if (retries++ % 5 === 0) {
                    ns.stock.purchase4SMarketDataTixApi();
                }
                ns.print(`Waiting for 4S API access... (${this.fmtNum(retries)} retries)`);
                await ns.sleep(2000 + Math.random() * 3000);
            }
            return true;
        },

        handleError(error, state, trading) {
            const errorInfo = {
                time: new Date().toISOString(),
                stack: error.stack,
                message: error.message,
                context: JSON.stringify({
                    symbols: state.symbols,
                    netWorth: trading.getNetWorth(ns),
                    exposure: trading.getCurrentExposure(ns)
                }, null, 2)
            };

            ns.print(`\x1b[38;5;196m⚠️ [${errorInfo.time}] Error: ${error.message}\x1b[0m`);

            if (error.message.includes('4S API')) {
                ns.stock.purchase4SMarketDataTixApi();
                ns.tprint('Automatically re-acquired 4S API access');
            }
        },

        cleanupCache(state, CACHE, METRICS) {
            const now = Date.now();
            if (now - METRICS.lastCleanup < 3600000) return;

            for (const key of CACHE.prices.keys()) {
                if (!state.symbols.includes(key)) {
                    CACHE.prices.delete(key);
                    CACHE.analysis.delete(key);
                }
            }

            METRICS.lastCleanup = now;
        },

        optimizeMemory(state, CONFIG) {
            if (state.transactions.length > 1000) {
                state.transactions = state.transactions.slice(-500);
            }

            for (const sym of state.symbols) {
                const data = state.history.get(sym);
                if (data.prices.length > CONFIG.PRICE_MEMORY) {
                    data.prices = data.prices.slice(-CONFIG.PRICE_MEMORY);
                }
            }
        },

        ErrorHandler: {
            retryCount: new Map(),
            async wrap(fn, maxRetries = CONFIG.ERROR_RETRY_LIMIT) {
                try {
                    return await fn();
                } catch (error) {
                    const count = (this.retryCount.get(fn) || 0) + 1;
                    this.retryCount.set(fn, count);

                    if (count <= maxRetries) {
                        await ns.sleep(1000 * count);
                        return await this.wrap(fn, maxRetries);
                    }
                    throw error;
                }
            }
        },

        logTransaction(transaction, state) {
            const record = {
                timestamp: Date.now(),
                time: new Date().toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 8),
                ...transaction,
                context: {
                    volatility: state.marketState.volatility,
                    positionRatio: transaction.shares / ns.stock.getMaxShares(transaction.sym),
                    riskLevel: CONFIG.RISK_PER_TRADE,
                    portfolioValue: state.netWorth
                }
            };

            state.transactions.push(record);

            if (transaction.profit !== 0) {
                state.metrics.totalProfit += transaction.profit;
                state.metrics.peakNetWorth = Math.max(
                    state.metrics.peakNetWorth,
                    state.netWorth
                );
            }
        }
    };
}