/**
 * 股票管理脚本
 * @param {NS} ns 
 * @param {Object} config 配置选项
 * @param {boolean} [config.debug=false] 是否启用调试模式
 * @param {number} [config.interval=5000] 检查间隔时间（毫秒）
 * @param {number} [config.maxRetries=50] 最大重试次数
 * @param {boolean} [config.autoRestart=true] 是否自动重启失败脚本
 */
export async function main(ns, config = {}) {
    const { debug = false, interval = 5000, maxRetries = 50, autoRestart = true } = config;

    // 增强日志函数
    const log = (level, message) => {
        if (level === 'DEBUG' && !debug) return;
        const timestamp = new Date().toISOString();
        ns.tprint(`[${timestamp}] ${level}: ${message}`);
    };

    // 验证配置参数
    if (typeof interval !== 'number' || interval < 1000) {
        log('ERROR', `无效的间隔时间: ${interval}，使用默认值5000`);
        config.interval = 5000;
    }

    // 检查4S数据API访问权限
    if (!ns.stock.has4SDataTIXAPI()) {
        log('WARN', '缺少4S数据TIX API访问权限');
        return;
    }

    log('INFO', `启动股票管理脚本`);
    log('DEBUG', `配置参数: ${JSON.stringify(config)}`);

    let retryCount = 0;

    while (retryCount < maxRetries) {
        try {
            // 运行股票交易脚本
            const pid = ns.run("me/stock.js");
            if (pid === 0) {
                throw new Error('无法启动股票交易脚本');
            }

            log('INFO', `成功启动股票交易脚本，PID: ${pid}`);

            if (autoRestart) {
                // 监控脚本状态
                while (ns.isRunning(pid)) {
                    await ns.sleep(interval);
                }
                log('INFO', '检测到股票交易脚本终止，准备重启');
                retryCount = 0; // 重置重试计数器
            } else {
                return; // 成功启动后退出
            }
        } catch (error) {
            retryCount++;
            log('ERROR', `脚本执行失败 (尝试 ${retryCount}/${maxRetries}) - ${error}`);

            if (retryCount >= maxRetries) {
                log('ERROR', '达到最大重试次数，停止脚本');
                return;
            }

            // 指数退避重试
            const waitTime = interval * Math.pow(2, retryCount);
            log('INFO', `等待 ${waitTime} 毫秒后重试...`);
            await ns.sleep(waitTime);
        }
    }
}
