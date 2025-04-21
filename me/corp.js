/** @ts-check */
/**
 * 自动创建公司并扩展业务脚本（Bitburner专用）
 * 增强版本 - 包含创建公司、扩展产业和城市功能
 * @param {import("../../index").NS} ns 
 */
export async function main(ns) {
    // ===== 配置部分 =====
    const CONFIG = {
        corpName: "CyberCorp",      // 公司名称
        selfFund: true,             // 使用自筹资金模式
        debugMode: false,           // 调试模式开关
        startingIndustry: "Agriculture", // 初始产业类型 
        startingCity: "Aevum",      // 初始城市 
        expansionCities: [          // 待扩展城市列表
            "Sector-12",
            "Volhaven",
            "Chongqing"
        ]
    };

    // ===== 初始化 =====
    const corpAPI = ns.corporation;
    const log = (msg, isError = false) => {
        const prefix = isError ? "× [错误] " : "✓ ";
        ns.tprint(`[${new Date().toLocaleTimeString()}] [Corp] ${prefix}${msg}`);
    };

    // 调试信息输出
    if (CONFIG.debugMode) {
        log(`调试模式已启用`);
        log(`公司名称: ${CONFIG.corpName}`);
        log(`初始产业: ${CONFIG.startingIndustry}`);
        log(`初始城市: ${CONFIG.startingCity}`);
    }

    // ===== 第一步：检查创建条件 =====
    const checkResult = corpAPI.checkCanCreateCorporation(CONFIG.selfFund);
    if (checkResult !== "Success") {
        handleCreationError(checkResult);
        return;
    }

    // ===== 第二步：尝试创建公司 =====
    try {
        const success = corpAPI.createCorporation(CONFIG.corpName, CONFIG.selfFund);

        if (!success) {
            log("公司创建失败", true);
            return;
        }

        log(`公司 ${CONFIG.corpName} 创建成功`);
        log(`当前资金: ${corpAPI.getCorporation().funds}`);

        // ===== 第三步：扩展初始产业 =====
        try {
            corpAPI.expandIndustry(CONFIG.startingIndustry, CONFIG.corpName);
            log(`成功扩展初始产业: ${CONFIG.startingIndustry}`);

            // ===== 第四步：设置初始城市 =====
            corpAPI.expandCity(CONFIG.corpName, CONFIG.startingCity);
            log(`成功设置初始城市: ${CONFIG.startingCity}`);

            // ===== 第五步：扩展其他城市 =====
            for (const city of CONFIG.expansionCities) {
                try {
                    corpAPI.expandCity(CONFIG.corpName, city);
                    log(`成功扩展城市: ${city}`);
                } catch (e) {
                    log(`扩展城市 ${city} 失败: ${e}`, true);
                }
            }
        } catch (e) {
            log(`产业扩展失败: ${e}`, true);
        }
    } catch (e) {
        log(`创建过程中发生异常: ${e}`, true);
        if (CONFIG.debugMode) {
            log("异常堆栈:");
            log(e.stack);
        }
    }

    // 错误处理函数
    function handleCreationError(errorCode) {
        switch (errorCode) {
            case "CorporationExists":
                log("已有公司存在，无法创建新公司", true);
                break;
            case "DisabledBySoftCap":
                log("BitNode软顶限制（软顶系数需≥0.15）", true); 
                break;
            case "UseSeedMoneyOutsideBN3":
                log("仅限BitNode3可用种子资金", true); 
                break;
            default:
                log(`未知错误: ${errorCode}`, true);
        }
    }
}
