/** 
 * 增强版网络资源管理器
 * @param {NS} ns 
 */
export async function main(ns) {
    ns.disableLog("sleep");
    
    // 参数校验
    if (!ns.fileExists("me/stock.js")) {
        ns.tprint("错误：缺少依赖文件 me/stock.js");
        return;
    }

    // 主监控循环
    while (true) {
        try {
            // 检查4S数据接口
            if (ns.stock.has4SDataTIXAPI()) {
                if (!ns.isRunning("me/stock.js")) {
                    ns.run("me/stock.js", 1, "--daemon");
                    ns.tprint("✅ 股票交易系统已启动");
                }
            } 

            // 性能优化：根据游戏阶段调整检查间隔
            const interval = ns.stock.has4SDataTIXAPI() ? 60000 : 30000;
            await ns.sleep(interval);

        } catch (e) {
            ns.tprint(`严重错误：${e}`);
            await ns.sleep(5000);
        }
    }
}
