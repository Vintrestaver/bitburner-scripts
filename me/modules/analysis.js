/** @param {NS} ns */
export function initAnalysis(ns, CONFIG) {
    return {
        analyzeStock(sym, data, ns) {
            const price = (ns.stock.getBidPrice(sym) + ns.stock.getAskPrice(sym)) / 2;
            const forecast = ns.stock.getForecast(sym);
            const volatility = ns.stock.getVolatility(sym);

            if (!data) {
                return {
                    askPrice: ns.stock.getAskPrice(sym),
                    bidPrice: ns.stock.getBidPrice(sym),
                    price,
                    forecast,
                    volatility,
                    rsi: 50,
                    trend: forecast > 0.5 ? 'bull' : 'bear',
                    efficiency: 0.5,
                    correlation: 0
                };
            }

            // 计算RSI
            const rsi = this.calculateRSI(data.prices);

            // 计算趋势效率
            const efficiency = this.calculateEfficiency(data.prices);

            // 计算相关性
            const correlation = this.calculateCorrelation(data.prices);

            // 综合趋势判断
            const trend = this.determineTrend(forecast, rsi, data.maShort, data.maLong);

            return {
                askPrice: ns.stock.getAskPrice(sym),
                bidPrice: ns.stock.getBidPrice(sym),
                price,
                forecast,
                volatility,
                rsi,
                trend,
                efficiency,
                correlation
            };
        },

        updateMA(data, type, window, price) {
            const windowArray = data[type + 'Window'];
            const sum = data[type + 'Sum'];

            windowArray.push(price);
            data[type + 'Sum'] = sum + price;

            if (windowArray.length > window) {
                data[type + 'Sum'] -= windowArray.shift();
            }

            data[type] = data[type + 'Sum'] / windowArray.length;
        },

        calculateRSI(prices, period = 14) {
            if (prices.length < period + 1) return 50;

            let gains = 0;
            let losses = 0;

            for (let i = prices.length - period; i < prices.length; i++) {
                const difference = prices[i] - prices[i - 1];
                if (difference >= 0) {
                    gains += difference;
                } else {
                    losses -= difference;
                }
            }

            const avgGain = gains / period;
            const avgLoss = losses / period;

            return avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
        },

        calculateEfficiency(prices, window = 20) {
            if (prices.length < window) return 0.5;

            const priceWindow = prices.slice(-window);
            const directionalMove = Math.abs(priceWindow[priceWindow.length - 1] - priceWindow[0]);

            let volatilityMove = 0;
            for (let i = 1; i < priceWindow.length; i++) {
                volatilityMove += Math.abs(priceWindow[i] - priceWindow[i - 1]);
            }

            return volatilityMove === 0 ? 0 : directionalMove / volatilityMove;
        },

        calculateCorrelation(prices, window = 20) {
            if (prices.length < window + 1) return 0;

            const returns = [];
            for (let i = 1; i < prices.length; i++) {
                returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
            }

            const recentReturns = returns.slice(-window);
            const laggedReturns = returns.slice(-window - 1, -1);

            const meanRecent = recentReturns.reduce((a, b) => a + b, 0) / window;
            const meanLagged = laggedReturns.reduce((a, b) => a + b, 0) / window;

            let covariance = 0;
            let varRecent = 0;
            let varLagged = 0;

            for (let i = 0; i < window; i++) {
                const diffRecent = recentReturns[i] - meanRecent;
                const diffLagged = laggedReturns[i] - meanLagged;

                covariance += diffRecent * diffLagged;
                varRecent += diffRecent * diffRecent;
                varLagged += diffLagged * diffLagged;
            }

            const stdRecent = Math.sqrt(varRecent / window);
            const stdLagged = Math.sqrt(varLagged / window);

            return stdRecent * stdLagged === 0 ? 0 :
                (covariance / window) / (stdRecent * stdLagged);
        },

        determineTrend(forecast, rsi, maShort, maLong) {
            const forecastSignal = forecast > 0.55 ? 1 : forecast < 0.45 ? -1 : 0;
            const rsiSignal = rsi > 70 ? -1 : rsi < 30 ? 1 : 0;
            const maSignal = maShort > maLong ? 1 : maShort < maLong ? -1 : 0;

            const signalSum = forecastSignal + rsiSignal + maSignal;

            if (Math.abs(signalSum) >= 2) {
                return signalSum > 0 ? 'bull' : 'bear';
            }

            return forecast > 0.5 ? 'bull' : 'bear';
        }
    };
}