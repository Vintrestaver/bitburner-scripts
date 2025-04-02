/** @param {NS} ns */
export function initMarketState(ns, CONFIG) {
    const state = {
        regime: 'normal',           // 市场状态：normal, volatile, trending
        momentum: 0,                // 市场动量
        volatility: 0,              // 市场波动率
        correlation: 0,             // 市场相关性
        lastUpdate: 0               // 最后更新时间
    };

    return {
        getState() {
            return state;
        },

        determineMarketRegime(volatility, momentum, correlation) {
            if (volatility > 0.02 && momentum > 0.02) {
                return 'trending';
            } else if (volatility > 0.02 || correlation > 0.5) {
                return 'volatile';
            } else {
                return 'normal';
            }
        },

        calculateMarketCorrelation(symbols, histories) {
            const allPrices = symbols.map(sym => histories.get(sym).prices);
            const avgPrices = allPrices[0].map((_, i) =>
                allPrices.reduce((acc, prices) => acc + prices[i], 0) / allPrices.length
            );

            const deviations = allPrices.map(prices =>
                prices.map((p, i) => p - avgPrices[i])
            );
            const squaredDeviations = deviations.map(devs =>
                devs.map(d => d * d)
            );

            const variances = squaredDeviations.map(sqDevs =>
                sqDevs.reduce((a, b) => a + b, 0) / sqDevs.length
            );
            const stdDevs = variances.map(variance => Math.sqrt(variance));

            const correlations = deviations.map((devs, i) =>
                devs.map((d, j) => d / stdDevs[i] / stdDevs[j])
            );

            return correlations.reduce((acc, corr) =>
                acc + corr.reduce((a, b) => a + b, 0), 0
            ) / (correlations.length * correlations[0].length);
        },

        getAverageMomentum(symbols, histories) {
            return symbols.reduce((acc, sym) => {
                const data = histories.get(sym);
                return acc + (data.maShort - data.maLong) / data.maLong;
            }, 0) / symbols.length || 0;
        },

        updateRiskParameters(CONFIG, risk, volatility, momentum) {
            CONFIG.RISK_PER_TRADE = Math.min(0.15, Math.max(0.05,
                0.1 * (1 - risk) * (1 - volatility) * (1 + momentum)
            ));

            CONFIG.STOP_LOSS = Math.max(0.02, Math.min(0.05,
                0.03 * (1 + volatility) * (1 - momentum)
            ));
        },

        update(symbols, histories, trading) {
            const now = Date.now();
            if (now - state.lastUpdate < 60000) return;

            const volatility = this.getMarketVolatility(ns, symbols);
            const momentum = this.getAverageMomentum(symbols, histories);
            const correlation = this.calculateMarketCorrelation(symbols, histories);

            state.volatility = volatility;
            state.momentum = momentum;
            state.correlation = correlation;
            state.regime = this.determineMarketRegime(volatility, momentum, correlation);
            state.lastUpdate = now;

            const risk = this.calculateRisk(trading);
            this.updateRiskParameters(CONFIG, risk, volatility, Math.abs(momentum));
        },

        getMarketVolatility(ns, symbols) {
            return symbols.reduce((acc, sym) => {
                const vol = ns.stock.getVolatility(sym);
                return acc + (vol > 0 ? vol : 0);
            }, 0) / symbols.length || 0;
        },

        calculateRisk(trading) {
            const currentNet = trading.getNetWorth(ns);
            const leverage = this.getLeverage(ns, trading);
            const volatilityFactor = state.volatility / 0.01;
            return (leverage * volatilityFactor) / 5;
        },

        getLeverage(ns, trading) {
            const equity = ns.getServerMoneyAvailable('home');
            return equity > 0 ? (trading.getNetWorth(ns) - equity) / equity : 0;
        }
    };
}