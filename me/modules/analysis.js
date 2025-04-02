/** @param {NS} ns */
export function initAnalysis(ns, CONFIG) {
    return {
        calculateRSI(prices) {
            if (prices.length < CONFIG.RSI_WINDOW + 1) return 50;

            const gains = new Array(CONFIG.RSI_WINDOW).fill(0);
            const losses = new Array(CONFIG.RSI_WINDOW).fill(0);
            let gainIndex = 0, lossIndex = 0;

            let prevPrice = prices[prices.length - CONFIG.RSI_WINDOW - 1];

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

            const avgGain = gains.reduce((a, b) => a + b, 0) / CONFIG.RSI_WINDOW;
            const avgLoss = losses.reduce((a, b) => a + b, 0) / CONFIG.RSI_WINDOW;

            return avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
        },

        calculateMomentum(prices) {
            if (prices.length < CONFIG.TREND_WINDOW + 1) return 0;

            const recentPrices = prices.slice(-CONFIG.TREND_WINDOW);
            const firstPrice = recentPrices[0];
            const lastPrice = recentPrices[recentPrices.length - 1];

            return (lastPrice - firstPrice) / firstPrice;
        },

        calculateCorrelation(prices) {
            if (prices.length < CONFIG.MARKET_REGIME_WINDOW + 1) return 0;

            const recentPrices = prices.slice(-CONFIG.MARKET_REGIME_WINDOW);
            const avgPrice = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;

            const deviations = recentPrices.map(p => p - avgPrice);
            const squaredDeviations = deviations.map(d => d * d);

            const variance = squaredDeviations.reduce((a, b) => a + b, 0) / squaredDeviations.length;
            const stdDev = Math.sqrt(variance);

            return stdDev / avgPrice;
        },

        calculateEfficiency(prices) {
            if (prices.length < CONFIG.TREND_WINDOW + 1) return 0;

            const recentPrices = prices.slice(-CONFIG.TREND_WINDOW);
            const firstPrice = recentPrices[0];
            const lastPrice = recentPrices[recentPrices.length - 1];

            const totalChange = Math.abs(lastPrice - firstPrice);
            const totalDistance = recentPrices.slice(1).reduce((acc, p, i) =>
                acc + Math.abs(p - recentPrices[i]), 0);

            return totalDistance === 0 ? 0 : totalChange / totalDistance;
        },

        calculatePositionScore(analysis) {
            return (
                0.3 * (analysis.forecast - 0.5) +
                0.2 * Math.min(1, Math.max(0, (70 - analysis.rsi) / 40)) +
                0.2 * (1 - analysis.volatilityTrend) +
                0.15 * analysis.efficiency +
                0.15 * (1 - Math.abs(analysis.correlation))
            );
        },

        updateMA(data, type, window, price) {
            const queue = data[`${type}Window`];
            const sumKey = `${type}Sum`;

            queue.push(price);
            data[sumKey] += price;

            if (queue.length > window) {
                const removed = queue.shift();
                data[sumKey] -= removed;
            }
            data[type] = data[sumKey] / queue.length;
        },

        analyzeStock(sym, data, ns) {
            const volatility = ns.stock.getVolatility(sym);
            const momentum = this.calculateMomentum(data.prices);

            return {
                symbol: sym,
                bidPrice: ns.stock.getBidPrice(sym),
                askPrice: ns.stock.getAskPrice(sym),
                trend: data.maShort > data.maLong ? 'bull' : 'bear',
                rsi: data.rsi,
                volatility,
                momentum: (data.maShort - data.maLong) / data.maLong * 100,
                forecast: ns.stock.getForecast(sym),
                volatilityTrend: volatility / this.getMarketVolatility(ns),
                correlation: this.calculateCorrelation(data.prices),
                efficiency: this.calculateEfficiency(data.prices),
            };
        },

        getMarketVolatility(ns) {
            const symbols = ns.stock.getSymbols();
            return symbols.reduce((acc, sym) => {
                const vol = ns.stock.getVolatility(sym);
                return acc + (vol > 0 ? vol : 0);
            }, 0) / symbols.length || 0;
        }
    };
}