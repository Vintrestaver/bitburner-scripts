/** @param {NS} ns */
export function initTrading(ns, CONFIG, MARKET_STATE) {
    return {
        executeTrades(sym, analysis, state) {
            const [longShares, , shortShares] = ns.stock.getPosition(sym);
            const position = this.calculatePosition(sym, analysis, state);

            const activePositions = this.getActivePositions(ns).length;
            if (activePositions >= CONFIG.MAX_POSITIONS) {
                return;
            }

            const marketCondition = MARKET_STATE.regime === 'trending' ? 0.6 : 0.7;
            const positionScore = this.calculatePositionScore(analysis);

            if (analysis.trend === 'bull' && longShares <= 0 && positionScore > marketCondition) {
                const buyCondition = (
                    analysis.forecast > CONFIG.FORECAST_BUY &&
                    analysis.rsi < 40 &&
                    analysis.volatility < CONFIG.VOLATILITY_FILTER
                );
                if (buyCondition) {
                    const bought = ns.stock.buyStock(sym, position);
                    if (bought > 0) return { type: 'Buy 📈', shares: bought, price: analysis.askPrice };
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
                    if (sold > 0) return { type: 'Buy 📉', shares: sold, price: analysis.bidPrice };
                }
            }

            return null;
        },

        managePosition(sym, analysis) {
            const [long, longAvg, short, shortAvg] = ns.stock.getPosition(sym);
            let result = null;

            if (long > 0) {
                const currentPrice = analysis.bidPrice;
                const profitRatio = (currentPrice - longAvg) / longAvg;
                if ((profitRatio <= -CONFIG.STOP_LOSS && analysis.forecast < CONFIG.FORECAST_BUY - 0.05) ||
                    profitRatio >= CONFIG.TAKE_PROFIT) {
                    const sold = ns.stock.sellStock(sym, long);
                    if (sold > 0) {
                        result = {
                            type: 'Sell 📈',
                            shares: -long,
                            price: currentPrice,
                            profit: long * (currentPrice - longAvg)
                        };
                    }
                }
            }

            if (short > 0) {
                const currentPrice = analysis.askPrice;
                const profitRatio = (shortAvg - currentPrice) / shortAvg;
                if ((profitRatio <= -CONFIG.STOP_LOSS && analysis.forecast > CONFIG.FORECAST_BUY + 0.05) ||
                    profitRatio >= CONFIG.TAKE_PROFIT) {
                    const bought = ns.stock.sellShort(sym, short);
                    if (bought > 0) {
                        result = {
                            type: 'Sell 📉',
                            shares: -short,
                            price: currentPrice,
                            profit: short * (shortAvg - currentPrice)
                        };
                    }
                }
            }

            return result;
        },

        calculatePosition(sym, analysis, state) {
            const portfolioValue = this.getNetWorth(ns);
            const currentExposure = this.getCurrentExposure(ns);
            const availableFunds = CONFIG.MAX_EXPOSURE * portfolioValue - currentExposure;

            if (availableFunds <= 0) return 0;

            const riskCapital = Math.min(availableFunds, portfolioValue * CONFIG.RISK_PER_TRADE);
            const maxShares = Math.min(
                ns.stock.getMaxShares(sym) * CONFIG.MAX_SHARE_RATIO,
                riskCapital / analysis.askPrice
            );

            return Math.floor(maxShares);
        },

        getNetWorth(ns) {
            let total = ns.getServerMoneyAvailable('home');
            for (const sym of ns.stock.getSymbols()) {
                const [long, , short, sAvg] = ns.stock.getPosition(sym);
                total += long * ns.stock.getBidPrice(sym);
                total += short * (sAvg - ns.stock.getAskPrice(sym));
            }
            return total;
        },

        getCurrentExposure(ns) {
            return ns.stock.getSymbols().reduce((sum, sym) => {
                const [long, , short, sAvg] = ns.stock.getPosition(sym);
                return sum + (long * ns.stock.getBidPrice(sym)) +
                    (short * (sAvg - ns.stock.getAskPrice(sym)));
            }, 0);
        },

        getActivePositions(ns) {
            return ns.stock.getSymbols()
                .map(sym => {
                    const [long, lAvg, short, sAvg] = ns.stock.getPosition(sym);
                    if (long === 0 && short === 0) return null;

                    const analysis = ns.stock.getPosition(sym);
                    const longProfit = long * (ns.stock.getBidPrice(sym) - lAvg);
                    const shortProfit = short * (sAvg - ns.stock.getAskPrice(sym));

                    return {
                        sym,
                        long: [long, lAvg],
                        short: [short, sAvg],
                        maxShares: ns.stock.getMaxShares(sym),
                        totalProfit: longProfit + shortProfit
                    };
                })
                .filter(p => p !== null);
        },

        calculatePositionScore(analysis) {
            return (
                0.3 * (analysis.forecast - 0.5) +
                0.2 * Math.min(1, Math.max(0, (70 - analysis.rsi) / 40)) +
                0.2 * (1 - analysis.volatilityTrend) +
                0.15 * analysis.efficiency +
                0.15 * (1 - Math.abs(analysis.correlation))
            );
        }
    };
}