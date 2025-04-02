import { COLORS } from './config.js';

/** @param {NS} ns */
export function initDashboard(ns, CONFIG) {
    return {
        fmtMoney(amount) {
            const color = amount >= 0 ? CONFIG.COLORS.profit : CONFIG.COLORS.loss;
            return `${color}$${ns.formatNumber(Math.abs(amount), 1).padEnd(6)}${CONFIG.COLORS.reset}`;
        },

        fmtNum(number) {
            return ns.formatNumber(number, 1).padStart(6, '_');
        },

        fmtPct(percentage) {
            return ns.formatPercent(percentage, 1).padEnd(5);
        },

        getBar(ratio, color) {
            const filled = Math.floor(ratio * 5);
            return color + '■'.repeat(filled) + CONFIG.COLORS.reset + '□'.repeat(5 - filled);
        },

        getTrendColor(sym, CACHE) {
            const analysis = CACHE.analysis.get(sym);
            return analysis.trend === 'bull' ? CONFIG.COLORS.bullish : CONFIG.COLORS.bearish;
        },

        fmtPosition(pos, index, CACHE) {
            const rsiColor = pos.rsi < 30 ? CONFIG.COLORS.rsiLow :
                pos.rsi > 70 ? CONFIG.COLORS.rsiHigh : CONFIG.COLORS.rsiMid;
            const volColor = pos.volatility > CONFIG.VOLATILITY_FILTER
                ? CONFIG.COLORS.warning : CONFIG.COLORS.reset;
            const trendIcon = pos.trend === 'bull'
                ? `${CONFIG.COLORS.bullish}▲${CONFIG.COLORS.reset}`
                : `${CONFIG.COLORS.bearish}▼${CONFIG.COLORS.reset}`;

            const longRatio = pos.long[0] / pos.maxShares;
            const shortRatio = pos.short[0] / pos.maxShares;

            const longDisplay = pos.long[0] > 0 ?
                `${CONFIG.COLORS.info}📈:${this.fmtNum(pos.long[0])} ${this.getBar(longRatio, CONFIG.COLORS.bullish)}` : '';
            const shortDisplay = pos.short[0] > 0 ?
                `${CONFIG.COLORS.highlight}📉:${this.fmtNum(pos.short[0])} ${this.getBar(shortRatio, CONFIG.COLORS.bearish)}` : '';

            return [
                ` ${index.toString().padStart(2)} ${pos.sym.padEnd(5)} ${trendIcon}`,
                `${rsiColor}RSI:${pos.rsi.toFixed(0).padEnd(3)}${CONFIG.COLORS.reset}`,
                `${volColor}VOL:${this.fmtPct(pos.volatility)}${CONFIG.COLORS.reset}`,
                `FOR:${this.fmtPct(pos.forecast)}`,
                `${longDisplay}${shortDisplay}`,
                `${pos.totalProfit >= 0 ? CONFIG.COLORS.profit : CONFIG.COLORS.loss}${this.fmtMoney(pos.totalProfit)}`
            ].join(' │ ');
        },

        display(state, trading, marketState) {
            const mState = marketState.getState();

            // 标题栏
            ns.print("═".repeat(80));
            const time = new Date().toLocaleTimeString('en-US', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });

            // 版本和时间信息
            ns.print(`${CONFIG.COLORS.header}─[ ${time} ]─[ StockManager ${CONFIG.V} ]${'─'.repeat(45)}`);

            // 市场状态指标
            const regimeColor = mState.regime === 'volatile' ? CONFIG.COLORS.warning :
                mState.regime === 'trending' ? CONFIG.COLORS.bullish : CONFIG.COLORS.info;

            const riskColor = mState.risk > 0.7 ? CONFIG.COLORS.loss :
                mState.risk > 0.4 ? CONFIG.COLORS.warning : CONFIG.COLORS.profit;

            const momColor = mState.momentum > 0 ? CONFIG.COLORS.bullish : CONFIG.COLORS.bearish;

            ns.print([
                `${CONFIG.COLORS.info}NET: ${this.fmtMoney(trading.getNetWorth(ns))}${CONFIG.COLORS.reset}`,
                `${CONFIG.COLORS.profit}PRO: ${this.fmtMoney(state.metrics.totalProfit)}${CONFIG.COLORS.reset}`,
                `${CONFIG.COLORS.warning}DRA: ${this.fmtPct(state.metrics.maxDrawdown)}${CONFIG.COLORS.reset}`,
                `${riskColor}RISK: ${mState.risk.toFixed(2)}${CONFIG.COLORS.reset}`
            ].join(' | '));

            // 市场状态行
            ns.print([
                `${regimeColor}REGIME: ${mState.regime.padEnd(8)}${CONFIG.COLORS.reset}`,
                `${CONFIG.COLORS.info}VOL: ${this.fmtPct(mState.volatility)}${CONFIG.COLORS.reset}`,
                `${momColor}MOM: ${this.fmtPct(mState.momentum)}${CONFIG.COLORS.reset}`,
                `${CONFIG.COLORS.info}CORR: ${this.fmtPct(mState.correlation)}${CONFIG.COLORS.reset}`
            ].join(' | '));

            ns.print("═".repeat(80));

            // 持仓列表
            ns.print(`${CONFIG.COLORS.header}──📦 Position ${'─'.repeat(80 - 14)}${CONFIG.COLORS.reset}`);
            trading.getActivePositions(ns)
                .sort((a, b) => b.totalProfit - a.totalProfit)
                .slice(0, CONFIG.DISPLAY_ROWS)
                .forEach((p, i) => ns.print(this.fmtPosition(p, i + 1, state.CACHE)));
            ns.print("═".repeat(80));

            // 最近交易记录
            ns.print(`${CONFIG.COLORS.header}──📜 Latest Transactions ${'─'.repeat(80 - 25)}${CONFIG.COLORS.reset}`);
            state.transactions.slice(-5).forEach(t => {
                const profitColor = t.profit >= 0 ? CONFIG.COLORS.profit : CONFIG.COLORS.loss;
                ns.print(
                    ` ${CONFIG.COLORS.info}${t.time} ${t.type} ` +
                    `${this.getTrendColor(t.sym, state.CACHE)}${t.sym.padEnd(5)} ` +
                    `${CONFIG.COLORS.highlight}${this.fmtNum(Math.abs(t.shares))}@${this.fmtNum(t.price)} ` +
                    `${profitColor}${t.profit !== 0 ? this.fmtMoney(t.profit) : ''}${CONFIG.COLORS.reset}`
                );
            });
        },

        adjustWindow() {
            const activePositions = ns.stock.getSymbols()
                .filter(sym => {
                    const [long, , short] = ns.stock.getPosition(sym);
                    return long > 0 || short > 0;
                }).length;

            const windowHeight = (Math.min(activePositions, CONFIG.DISPLAY_ROWS) + 8) * 20 + 180;
            ns.ui.resizeTail(800, windowHeight);
        }
    };
}