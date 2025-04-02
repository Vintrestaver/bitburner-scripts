/** @param {NS} ns */
export function initConfig(ns) {
    return {
        V: '2.0.0',

        // 风险控制参数
        MAX_POSITIONS: 10,          // 最大持仓数量
        MAX_EXPOSURE: 0.95,         // 最大市场敞口
        MAX_SHARE_RATIO: 0.95,      // 单个股票最大持仓比例
        RISK_PER_TRADE: 0.1,       // 每笔交易的风险比例
        VOLATILITY_FILTER: 0.1,    // 波动率过滤阈值

        // 价格预测参数
        FORECAST_BUY: 0.55,        // 买入预测阈值
        FORECAST_SELL: 0.45,       // 卖出预测阈值

        // 移动平均窗口
        TREND_WINDOW: 10,          // 短期趋势窗口
        BASE_WINDOW: 20,           // 长期趋势窗口

        // 交易管理参数
        STOP_LOSS: 0.03,          // 止损比例
        TAKE_PROFIT: 0.15,        // 止盈比例
        ENABLE_SHORT: true,       // 是否允许做空

        // 价格记忆设置
        PRICE_MEMORY: 50,         // 保留多少个历史价格点

        // 显示设置
        DISPLAY_ROWS: 15,         // 显示多少行持仓信息

        // 错误处理
        ERROR_RETRY_LIMIT: 3,     // 错误重试次数

        // 颜色配置
        COLORS: {
            header: '\x1b[38;5;75m',
            reset: '\x1b[0m',
            profit: '\x1b[38;5;118m',
            loss: '\x1b[38;5;203m',
            warning: '\x1b[38;5;214m',
            info: '\x1b[38;5;147m',
            highlight: '\x1b[38;5;219m',
            bullish: '\x1b[38;5;84m',
            bearish: '\x1b[38;5;203m',
            rsiLow: '\x1b[38;5;118m',
            rsiMid: '\x1b[38;5;145m',
            rsiHigh: '\x1b[38;5;203m'
        }
    };
}