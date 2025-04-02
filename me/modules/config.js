/** @param {NS} ns */
export const initConfig = (ns) => ({
    RISK_PER_TRADE: 0.2,       // 单次交易的风险比例
    MAX_EXPOSURE: 0.7,         // 最大风险敞口比例
    TREND_WINDOW: 8,           // 短期移动平均线窗口大小
    BASE_WINDOW: 40,           // 长期移动平均线窗口大小
    RSI_WINDOW: 14,            // RSI指标窗口大小
    VOLATILITY_FILTER: 0.015,  // 波动率过滤阈值
    STOP_LOSS: 0.025,          // 止损阈值
    TAKE_PROFIT: 0.12,         // 止盈阈值
    ENABLE_SHORT: true,        // 是否启用卖空操作
    MAX_SHARE_RATIO: 0.2,      // 单股最大持仓比例
    FORECAST_BUY: 0.65,        // 做多预测阈值
    FORECAST_SELL: 0.35,       // 做空预测阈值
    DISPLAY_ROWS: 20,          // 仪表盘显示的最大行数
    CACHE_DURATION: 1000,      // 缓存有效时间（毫秒）
    BATCH_SIZE: 10,            // 批处理大小
    ERROR_RETRY_LIMIT: 3,      // 错误重试次数
    MIN_TRADE_AMOUNT: 1e6,     // 最小交易金额
    PRICE_MEMORY: 200,         // 增加价格记忆长度
    MOMENTUM_THRESHOLD: 0.02,  // 动量阈值
    ADAPTIVE_RISK: true,       // 启用自适应风险控制
    MARKET_REGIME_WINDOW: 50,  // 市场状态判断窗口
    MAX_POSITIONS: 8,          // 最大持仓数量限制
    MIN_POSITION_HOLD: 5,      // 最小持仓时间(分钟)
    V: 'v7.0'
});

export const COLORS = {
    reset: '\x1b[0m',           // 重置颜色
    bullish: '\x1b[38;5;46m',   // 牛市颜色（亮绿色）
    bearish: '\x1b[38;5;196m',  // 熊市颜色（亮红色）
    profit: '\x1b[38;5;47m',    // 盈利颜色（渐变绿色）
    loss: '\x1b[38;5;160m',     // 亏损颜色（渐变红色）
    warning: '\x1b[38;5;226m',  // 警告颜色（黄色）
    info: '\x1b[38;5;51m',      // 信息颜色（青色）
    highlight: '\x1b[38;5;213m',// 强调颜色（粉紫色）
    header: '\x1b[48;5;236m',   // 头部背景颜色（深灰色）
    rsiLow: '\x1b[38;5;46m',    // RSI低于30的颜色
    rsiMid: '\x1b[38;5;226m',   // RSI在30-70之间的颜色
    rsiHigh: '\x1b[38;5;196m'   // RSI高于70的颜色
};