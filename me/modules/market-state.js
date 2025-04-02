/** @param {NS} ns */
export function initMarketState(ns, CONFIG) {
    const state = {
        regime: 'normal',
        momentum: 0,
        volatility: 0,
        correlation: 0,
        lastUpdate: 0,
        risk: 0,
        history: {
            regimes: [],
            transitions: 0,
            lastTransition: 0
        }
    };

    return {
        getState() {
            return { ...state };
        },

        determineMarketRegime(volatility, momentum, correlation) {
            const now = Date.now();
            const minTransitionTime = 300000; // 最小状态持续时间5分钟

            if (now - state.history.lastTransition < minTransitionTime) {
                return state.regime;
            }

            let newRegime = state.regime;

            if (volatility > 0.1 || Math.abs(correlation) > 0.7) {
                newRegime = 'volatile';
            } else if (Math.abs(momentum) > 0.02 && Math.abs(correlation) > 0.6) {
                newRegime = 'trending';
            } else {
                newRegime = 'normal';
            }

            if (newRegime !== state.regime) {
                state.history.regimes.push({
                    from: state.regime,
                    to: newRegime,
                    time: now,
                    context: {
                        volatility,
                        momentum,
                        correlation
                    }
                });

                if (state.history.regimes.length > 10) {
                    state.history.regimes.shift();
                }

                state.history.transitions++;
                state.history.lastTransition = now;
            }

            return newRegime;
        },

        calculateMarketCorrelation(symbols, histories) {
            const returns = symbols.map(sym => {
                const prices = histories.get(sym).prices;
                if (prices.length < 2) return [];
                return prices.slice(1).map((p, i) => (p - prices[i]) / prices[i]);
            }).filter(r => r.length > 0);

            if (returns.length < 2) return 0;

            const pairwiseCorr = [];
            for (let i = 0; i < returns.length; i++) {
                for (let j = i + 1; j < returns.length; j++) {
                    const len = Math.min(returns[i].length, returns[j].length);
                    if (len < 2) continue;

                    const r1 = returns[i].slice(-len);
                    const r2 = returns[j].slice(-len);

                    const mean1 = r1.reduce((a, b) => a + b, 0) / len;
                    const mean2 = r2.reduce((a, b) => a + b, 0) / len;

                    const cov = r1.reduce((sum, _, idx) =>
                        sum + (r1[idx] - mean1) * (r2[idx] - mean2), 0) / len;

                    const std1 = Math.sqrt(r1.reduce((sum, r) =>
                        sum + Math.pow(r - mean1, 2), 0) / len);
                    const std2 = Math.sqrt(r2.reduce((sum, r) =>
                        sum + Math.pow(r - mean2, 2), 0) / len);

                    if (std1 && std2) {
                        pairwiseCorr.push(cov / (std1 * std2));
                    }
                }
            }

            return pairwiseCorr.length ?
                pairwiseCorr.reduce((a, b) => a + b, 0) / pairwiseCorr.length : 0;
        },

        getAverageMomentum(symbols, histories) {
            return symbols.reduce((acc, sym) => {
                const data = histories.get(sym);
                if (!data || !data.maLong) return acc;
                return acc + (data.maShort - data.maLong) / data.maLong;
            }, 0) / symbols.length || 0;
        },

        updateRiskParameters(CONFIG, risk, volatility, momentum) {
            // 基础风险系数
            const baseRisk = 0.1;

            // 市场状态调整因子
            const regimeAdjustment = state.regime === 'volatile' ? 0.7 :
                state.regime === 'trending' ? 1.2 : 1.0;

            // 波动率调整
            const volAdjustment = Math.max(0, 1 - volatility * 5);

            // 动量调整
            const momAdjustment = Math.min(1.5, Math.max(0.5, 1 + momentum));

            // 更新交易风险参数
            CONFIG.RISK_PER_TRADE = Math.min(0.15, Math.max(0.05,
                baseRisk * volAdjustment * momAdjustment * (1 - risk) * regimeAdjustment
            ));

            // 更新止损参数
            CONFIG.STOP_LOSS = Math.max(0.02, Math.min(0.05,
                0.03 * (1 + volatility) * (1 - momentum * 0.5)
            ));

            // 更新止盈参数
            CONFIG.TAKE_PROFIT = Math.max(0.1, Math.min(0.2,
                0.15 * (1 + momentum) * (1 - volatility * 0.5) * regimeAdjustment
            ));

            // 更新预测阈值
            CONFIG.FORECAST_BUY = 0.55 + (risk * 0.1);
            CONFIG.FORECAST_SELL = 0.45 - (risk * 0.1);
        },

        update(symbols, histories, trading) {
            const now = Date.now();
            if (now - state.lastUpdate < 60000) return state;

            const volatility = this.getMarketVolatility(ns, symbols);
            const momentum = this.getAverageMomentum(symbols, histories);
            const correlation = this.calculateMarketCorrelation(symbols, histories);
            const risk = this.calculateRisk(trading);

            state.volatility = volatility;
            state.momentum = momentum;
            state.correlation = correlation;
            state.risk = risk;
            state.regime = this.determineMarketRegime(volatility, momentum, correlation);
            state.lastUpdate = now;

            this.updateRiskParameters(CONFIG, risk, volatility, Math.abs(momentum));

            return state;
        },

        getMarketVolatility(ns, symbols) {
            const vols = symbols.map(sym => ns.stock.getVolatility(sym))
                .filter(v => v > 0);
            return vols.length ?
                vols.reduce((a, b) => a + b, 0) / vols.length : 0;
        },

        calculateRisk(trading) {
            const currentNet = trading.getNetWorth(ns);
            const leverage = this.getLeverage(ns, trading);

            // 动态权重计算
            const regimeWeight = state.regime === 'volatile' ? 1.5 :
                state.regime === 'trending' ? 0.8 : 1.0;

            const volWeight = state.volatility * 50;
            const corrWeight = Math.abs(state.correlation);
            const leverageWeight = leverage * 2;
            const momentumWeight = Math.abs(state.momentum) * 3;

            // 计算综合风险分数
            const riskScore = (
                volWeight * regimeWeight +
                corrWeight +
                leverageWeight +
                momentumWeight
            ) / (regimeWeight + 3);

            return Math.min(1, riskScore);
        },

        getLeverage(ns, trading) {
            const equity = ns.getServerMoneyAvailable('home');
            const netWorth = trading.getNetWorth(ns);
            return equity > 0 ? Math.max(0, (netWorth - equity) / equity) : 0;
        }
    };
}