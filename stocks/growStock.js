/**
 * 主函数，用于自动化管理目标服务器的安全等级和资金增长。
 * @param {NS} ns
 * @param {Object} ns - 提供与游戏交互的API对象。
 * @param {string} ns.args[0] - 目标服务器的名称。
 * @returns {Promise<void>} - 该函数为异步函数，不返回具体值。
 */
export async function main(ns) {
    // 获取目标服务器名称
    let target = ns.args[0];

    // 定义变量用于存储服务器的最小安全等级、当前安全等级、最大资金和当前可用资金
    let securityLevelMin;
    let currentSecurityLevel;
    let serverMaxMoney;
    let serverMoneyAvailable;

    // 获取当前脚本使用的线程数
    let threadsUsedForStocks = ns.getRunningScript().threads;

    // 主循环，持续执行以下操作
    while (true) {
        // 获取目标服务器的最小安全等级和当前安全等级
        securityLevelMin = ns.getServerMinSecurityLevel(target);
        currentSecurityLevel = ns.getServerSecurityLevel(target);

        // 如果当前安全等级高于最小安全等级加5，则执行削弱操作
        while (currentSecurityLevel > securityLevelMin + 5) {
            await ns.weaken(target);
            
            // 更新当前安全等级
            currentSecurityLevel = ns.getServerSecurityLevel(target);
        }

        // 获取目标服务器的当前可用资金和最大资金
        serverMoneyAvailable = ns.getServerMoneyAvailable(target);
        serverMaxMoney = ns.getServerMaxMoney(target);

        // 如果当前可用资金低于最大资金的75%，则执行增长操作
        if (serverMoneyAvailable < (serverMaxMoney * 0.75)) {
            await ns.grow(target);

            // 更新当前可用资金和最大资金
            serverMoneyAvailable = ns.getServerMoneyAvailable(target);
            serverMaxMoney = ns.getServerMaxMoney(target);
        }
        else
        {
            // 打印当前使用的线程数
            ns.print('threadsUsedForStocks:' + threadsUsedForStocks)

            // 如果当前可用资金高于最大资金的75%，则执行增长操作并利用股票机制
            await ns.grow(target, { stock: true, threads: threadsUsedForStocks});
        }

        // 等待2秒后继续循环
        await ns.sleep(2000);
    }
}