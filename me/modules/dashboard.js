import { COLORS } from './config.js';

/** @param {NS} ns */
export function initDashboard(ns, CONFIG) {
    return {
        fmtMoney(amount) {
            const color = amount >= 0 ? COLORS.profit : COLORS.loss;
            return `${color}$${ns.formatNumber(Math.abs(amount), 1).padEnd(6)}${COLORS.reset}`;
        },

        fmtNum(number) {
            return ns.formatNumber(number, 1).padStart(6, '_');
        },

        fmtPct(percentage) {
            return ns.formatPercent(percentage, 1).padEnd(5);
        },

        getBar(ratio, color) {
            const filled = Math.floor(ratio * 5);
            return color + '■'.repeat(filled) + COLORS.reset + '□'.repeat(5 - filled);
        },

        getTrendColor(sym, CACHE) {
            const analysis = CACHE.analysis.get(sym);
            return analysis.trend === 'bull' ? COLORS.bullish : COLORS.bearish;
        },

        fmtPosition(pos, index, CACHE) {
            const rsiColor = pos.rsi < 30 ? COLORS.rsiLow :
                pos.rsi > 70 ? COLORS.rsiHigh : COLORS.rsiMid;
            const volColor = pos.volatility > CONFIG.VOLATILITY_FILTER
                ? COLORS.warning : COLORS.reset;
            const trendIcon = pos.trend === 'bull'
                ? `${COLORS.bullish}▲${COLORS.reset}`
                : `${COLORS.bearish}▼${COLORS.reset}`;

            const longRatio = pos.long[0] / pos.maxShares;
            const shortRatio = pos.short[0] / pos.maxShares;

            const longDisplay = pos.long[0] > 0 ?
                `${COLORS.info}📈:${this.fmtNum(pos.long[0])} ${this.getBar(longRatio, COLORS.bullish)}` : '';
            const shortDisplay = pos.short[0] > 0 ?
                `${COLORS.highlight}📉:${this.fmtNum(pos.short[0])} ${this.getBar(shortRatio, COLORS.bearish)}` : '';

            return [
                ` ${index.toString().padStart(2)} ${pos.sym.padEnd(5)} ${trendIcon}`,
                `${rsiColor}RSI:${pos.rsi.toFixed(0).padEnd(3)}${COLORS.reset}`,
                `${volColor}VOL:${this.fmtPct(pos.volatility)}${COLORS.reset}`,
                `FOR:${this.fmtPct(pos.forecast)}`,
                `${longDisplay}${shortDisplay}`,
                `${pos.totalProfit >= 0 ? COLORS.profit : COLORS.loss}${this.fmtMoney(pos.totalProfit)}`
            ].join(' │ ');
        },

        display(state, trading, marketState) {
            ns.print("═".repeat(80));
            ns.print(`${COLORS.header}─[ ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} ]─[ StockManager ${CONFIG.V} ]` + '─'.repeat(45));

            const volColor = trading.getRisk() > 0.2 ? COLORS.warning : COLORS.info;
            ns.print([
                `${COLORS.info}NET: ${this.fmtMoney(trading.getNetWorth(ns))}${COLORS.reset}`,
                `${COLORS.profit}PRO: ${this.fmtMoney(state.metrics.totalProfit)}${COLORS.reset}`,
                `${COLORS.warning}DRA: ${this.fmtPct(state.metrics.maxDrawdown)}${COLORS.reset}`,
                `${COLORS.highlight}LEV: ${trading.getLeverage().toFixed(1)}x${COLORS.reset}`,
                `${volColor}RISK: ${trading.getRisk().toFixed(2)}${COLORS.reset}`
            ].join(' | '));
            ns.print("═".repeat(80));

            ns.print(`${COLORS.header}──📦 Position ${'─'.repeat(80 - 14)}${COLORS.reset}`);
            trading.getActivePositions(ns)
                .sort((a, b) => b.totalProfit - a.totalProfit)
                .slice(0, CONFIG.DISPLAY_ROWS)
                .forEach((p, i) => ns.print(this.fmtPosition(p, i + 1, state.CACHE)));
            ns.print("═".repeat(80));

            ns.print(`${COLORS.header}──📜 Latest Transactions ${'─'.repeat(80 - 25)}${COLORS.reset}`);
            state.transactions.slice(-5).forEach(t => {
                const profitColor = t.profit >= 0 ? COLORS.profit : COLORS.loss;
                ns.print(
                    ` ${COLORS.info}${t.time} ${t.icon.padEnd(5)} ` +
                    `${this.getTrendColor(t.sym, state.CACHE)}${t.sym.padEnd(5)} ` +
                    `${COLORS.highlight}${this.fmtNum(Math.abs(t.shares))}@${this.fmtNum(t.price)} ` +
                    `${profitColor}${t.profit >= 0 ? '▲' : '▼'} ` +
                    `${t.profit != 0 ? this.fmtMoney(t.profit) : ''}${COLORS.reset}`
                );
            });
        },

        adjustWindow() {
            const [W, H] = ns.ui.windowSize();
            const activePositions = trading.getActivePositions(ns).length;
            const windowHeight = (Math.min(activePositions, CONFIG.DISPLAY_ROWS) + 6) * 24 + 180;
            ns.ui.resizeTail(800, windowHeight);
        }
    };
}