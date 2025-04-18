/** @param {NS} ns **/
export async function main(ns) {
    ns.ui.openTail();
    ns.disableLog("disableLog");
    ns.disableLog("sleep");
    ns.disableLog("getServerMoneyAvailable");

    // 等待直到有足够资金创建公司
    while (!ns.getPlayer().hasCorporation) {
        try {
            if (ns.getServerMoneyAvailable("home") > 150e9) { // 150 billion
                try {
                    ns.print(`Attempting to create corporation with $${ns.formatNumber(ns.getServerMoneyAvailable("home"), 1)} available`);
                    ns.corporation.createCorporation("MyCorp");
                    if (!ns.getPlayer().hasCorporation) {
                        throw new Error("Failed to create corporation - check if you have access to Corporations in this BitNode");
                    }
                    ns.print("Corporation created successfully!");
                } catch (e) {
                    ns.print(`ERROR in corporation creation: ${e}`);
                    ns.print(`Player has corporation: ${ns.getPlayer().hasCorporation}`);
                    ns.print(`Corporation API available: ${ns.corporation !== undefined}`);
                    throw e; // 重新抛出错误以便外部捕获
                }
            } else {
                const currentMoney = ns.getServerMoneyAvailable("home");
                ns.print(`Need $150b to start corporation, currently have $${ns.formatNumber(currentMoney, 1)}`);
                await ns.sleep(60000);
            }
        } catch (e) {
            ns.print(`ERROR creating corporation: ${e}`);
            await ns.sleep(30000); // 等待30秒后重试
        }
    }

    // 初始化公司
    let corp = ns.corporation.getCorporation();
    if (corp.divisions.length < 1) {
        try {
            ns.print("Setting up initial Tobacco division...");
            ns.corporation.expandIndustry("Tobacco", "Tobacco");
            if (corp.divisions.length < 1) {
                throw new Error("Failed to create Tobacco division");
            }
            await initialCorpUpgrade(ns);
            await initCities(ns, corp.divisions[0]);
        } catch (e) {
            ns.print(`ERROR initializing corporation: ${e}`);
            // 尝试重新初始化
            if (corp.divisions.length < 1) {
                ns.print("Retrying corporation initialization...");
                await ns.sleep(10000);
                return main(ns); // 重启主函数
            }
        }
    }

    // 主循环
    while (true) {
        try {
            corp = ns.corporation.getCorporation();

            // 逆序处理部门以便优先处理新部门
            for (const division of corp.divisions.reverse()) {
                try {
                    await manageDivision(ns, division);
                } catch (e) {
                    ns.print(`ERROR managing division ${division.name}: ${e}`);
                    // 继续处理其他部门
                }
            }

        // 特殊处理：当只有一个部门且没有发行股票时
        if (corp.divisions.length < 2 && corp.numShares === corp.totalShares) {
            const tobaccoDiv = corp.divisions.find(d => d.type === "Tobacco");
            if (tobaccoDiv && tobaccoDiv.products.length > 2) {
                try {
                    await trickInvest(ns, tobaccoDiv);
                } catch (e) {
                    ns.print(`ERROR in investment trick: ${e}`);
                    // 恢复产品销售
                    for (const product of tobaccoDiv.products) {
                        ns.corporation.sellProduct(tobaccoDiv.name, "Sector-12", product, "MAX", "MP", true);
                    }
                }
            }
        }

        await ns.sleep(5000);
        } catch (e) {
            ns.print(`ERROR in main loop: ${e}`);
            await ns.sleep(10000); // 等待更长时间后继续
        }
    }
}

/**
 * 管理单个部门
 * @param {NS} ns
 */
async function manageDivision(ns, division) {
    expandCities(ns, division);
    upgradeWarehouses(ns, division);
    upgradeCorp(ns);
    await hireEmployees(ns, division);

    if (division.type === "Tobacco") {
        newProduct(ns, division);
    }

    doResearch(ns, division);
}

/**
 * 雇佣员工并分配工作
 * @param {NS} ns
 */
async function hireEmployees(ns, division, productCity = "Sector-12") {
    const officeSizeUpgradeCost = ns.corporation.getOfficeSizeUpgradeCost(division.name, productCity, 3);

    // 如果有足够资金，升级办公室并雇佣员工
    if (ns.corporation.getCorporation().funds > (cities.length * officeSizeUpgradeCost)) {
        for (const city of cities) {
            try {
                ns.corporation.upgradeOfficeSize(division.name, city, 3);
                for (let i = 0; i < 3; i++) {
                    ns.corporation.hireEmployee(division.name, city);
                }
            } catch (e) {
                ns.print(`Error upgrading office in ${city}: ${e}`);
            }
        }
    }

    // 分配工作
    for (const city of cities) {
        const office = ns.corporation.getOffice(division.name, city);
        const employeeCount = office.employees.length;

        if (ns.corporation.hasResearched(division.name, "Market-TA.II")) {
            await assignJobsWithTA(ns, division, city, employeeCount);
        } else {
            await assignJobsBasic(ns, division, city, employeeCount, productCity);
        }
    }
}

/**
 * 分配工作 - 有市场TA研究的情况
 * @param {NS} ns
 */
async function assignJobsWithTA(ns, division, city, employeeCount) {
    const isProductCity = city === "Sector-12";

    if (isProductCity) {
        const ops = Math.ceil(employeeCount / 5);
        const eng = Math.ceil(employeeCount / 5);
        const bus = Math.ceil(employeeCount / 5);
        const mgmt = Math.ceil(employeeCount / 10);
        const train = employeeCount - (ops + eng + bus + mgmt);

        ns.corporation.setAutoJobAssignment(division.name, city, "Operations", ops);
        ns.corporation.setAutoJobAssignment(division.name, city, "Engineer", eng);
        ns.corporation.setAutoJobAssignment(division.name, city, "Business", bus);
        ns.corporation.setAutoJobAssignment(division.name, city, "Management", mgmt);
        ns.corporation.setAutoJobAssignment(division.name, city, "Training", train);
    } else {
        const ops = Math.floor(employeeCount / 10);
        const eng = 1;
        const bus = Math.floor(employeeCount / 5);
        const mgmt = Math.ceil(employeeCount / 100);
        const rnd = Math.ceil(employeeCount / 2);
        const train = employeeCount - (ops + eng + bus + mgmt + rnd);

        ns.corporation.setAutoJobAssignment(division.name, city, "Operations", ops);
        ns.corporation.setAutoJobAssignment(division.name, city, "Engineer", eng);
        ns.corporation.setAutoJobAssignment(division.name, city, "Business", bus);
        ns.corporation.setAutoJobAssignment(division.name, city, "Management", mgmt);
        ns.corporation.setAutoJobAssignment(division.name, city, "Research & Development", rnd);
        ns.corporation.setAutoJobAssignment(division.name, city, "Training", train);
    }
}

/**
 * 分配工作 - 基础分配
 * @param {NS} ns
 */
async function assignJobsBasic(ns, division, city, employeeCount, productCity) {
    if (city === productCity) {
        const ops = Math.floor((employeeCount - 2) / 2);
        const eng = Math.ceil((employeeCount - 2) / 2);
        ns.corporation.setAutoJobAssignment(division.name, city, "Operations", ops);
        ns.corporation.setAutoJobAssignment(division.name, city, "Engineer", eng);
        ns.corporation.setAutoJobAssignment(division.name, city, "Management", 2);
    } else {
        ns.corporation.setAutoJobAssignment(division.name, city, "Operations", 1);
        ns.corporation.setAutoJobAssignment(division.name, city, "Engineer", 1);
        ns.corporation.setAutoJobAssignment(division.name, city, "Research & Development", (employeeCount - 2));
    }
}

/**
 * 扩展城市
 * @param {NS} ns
 */
function expandCities(ns, division) {
    for (const city of cities) {
        if (!division.cities.includes(city)) {
            const cost = ns.corporation.getExpandCityCost(division.name, city);
            if (cost < ns.corporation.getCorporation().funds) {
                ns.print(`${division.name} Expanding to ${city}`);
                ns.corporation.expandCity(division.name, city);
            }
        }
    }
}

/**
 * 升级仓库
 * @param {NS} ns
 */
function upgradeWarehouses(ns, division) {
    for (const city of division.cities) {
        // 确保有仓库
        if (!ns.corporation.hasWarehouse(division.name, city)) {
            const cost = ns.corporation.getPurchaseWarehouseCost();
            if (cost < ns.corporation.getCorporation().funds) {
                ns.print(`${division.name} Purchasing warehouse in ${city}`);
                ns.corporation.purchaseWarehouse(division.name, city);
            }
            continue;
        }

        // 检查仓库容量
        const warehouse = ns.corporation.getWarehouse(division.name, city);
        if (warehouse.sizeUsed > 0.9 * warehouse.size) {
            const cost = ns.corporation.getUpgradeWarehouseCost(division.name, city);
            if (cost < ns.corporation.getCorporation().funds) {
                ns.print(`${division.name} Upgrading warehouse in ${city}`);
                ns.corporation.upgradeWarehouse(division.name, city);
            }
        }
    }

    // 广告升级
    if (ns.corporation.getUpgradeLevel("Wilson Analytics") > 20) {
        const cost = ns.corporation.getHireAdVertCost(division.name);
        if (ns.corporation.getCorporation().funds > (4 * cost)) {
            ns.print(`${division.name} Hiring AdVert`);
            ns.corporation.hireAdVert(division.name);
        }
    }
}

/**
 * 升级公司
 * @param {NS} ns
 */
function upgradeCorp(ns) {
    // 优先升级
    for (const upgrade of upgradeList) {
        const cost = upgrade.prio * ns.corporation.getUpgradeLevelCost(upgrade.name);
        if (ns.corporation.getCorporation().funds > cost) {
            // 特定升级的延迟条件
            if ((upgrade.name !== "ABC SalesBots" && upgrade.name !== "Wilson Analytics") ||
                (ns.corporation.getUpgradeLevel("DreamSense") > 20)) {
                ns.print(`Upgrading ${upgrade.name} to level ${ns.corporation.getUpgradeLevel(upgrade.name) + 1}`);
                ns.corporation.levelUpgrade(upgrade.name);
            }
        }
    }

    // 解锁升级
    if (!ns.corporation.hasUnlockUpgrade("Shady Accounting")) {
        const cost = ns.corporation.getUnlockUpgradeCost("Shady Accounting") * 2;
        if (cost < ns.corporation.getCorporation().funds) {
            ns.print("Unlocking Shady Accounting");
            ns.corporation.unlockUpgrade("Shady Accounting");
        }
    } else if (!ns.corporation.hasUnlockUpgrade("Government Partnership")) {
        const cost = ns.corporation.getUnlockUpgradeCost("Government Partnership") * 2;
        if (cost < ns.corporation.getCorporation().funds) {
            ns.print("Unlocking Government Partnership");
            ns.corporation.unlockUpgrade("Government Partnership");
        }
    }
}

/**
 * 投资者技巧
 * @param {NS} ns
 */
async function trickInvest(ns, division, productCity = "Sector-12") {
    ns.print("Preparing to trick investors...");

    // 停止销售产品
    for (const product of division.products) {
        ns.corporation.sellProduct(division.name, productCity, product, "0", "MP", true);
    }

    // 将所有员工分配到生产
    for (const city of cities) {
        const employees = ns.corporation.getOffice(division.name, city).employees.length;
        await clearAssignments(ns, division, city);
        ns.corporation.setAutoJobAssignment(division.name, city, "Operations", employees);
    }

    // 等待仓库填满
    ns.print("Waiting for warehouses to fill up...");
    while (!areWarehousesFull(ns, division)) {
        await ns.sleep(5000);
    }

    // 开始销售
    ns.print("Warehouses full, starting sales...");
    const initialOffer = ns.corporation.getInvestmentOffer().funds;
    ns.print(`Initial offer: $${ns.formatNumber(initialOffer, 1)}`);

    // 将所有员工分配到销售
    for (const city of cities) {
        const employees = ns.corporation.getOffice(division.name, city).employees.length;
        await clearAssignments(ns, division, city);
        await ns.corporation.setAutoJobAssignment(division.name, city, "Business", employees);
    }

    // 重新开始销售产品
    for (const product of division.products) {
        ns.corporation.sellProduct(division.name, productCity, product, "MAX", "MP", true);
    }

    // 等待投资报价上升
    while (ns.corporation.getInvestmentOffer().funds < (4 * initialOffer)) {
        await ns.sleep(200);
    }

    // 上市
    ns.print(`Final offer: $${ns.formatNumber(ns.corporation.getInvestmentOffer().funds, 1)}`);
    ns.print(`Pre-IPO funds: $${ns.formatNumber(ns.corporation.getCorporation().funds, 1)}`);
    ns.corporation.goPublic(800e6);
    ns.print(`Post-IPO funds: $${ns.formatNumber(ns.corporation.getCorporation().funds, 1)}`);

    // 恢复员工分配
    for (const city of cities) {
        const employees = ns.corporation.getOffice(division.name, city).employees.length;
        await clearAssignments(ns, division, city);

        if (city === productCity) {
            ns.corporation.setAutoJobAssignment(division.name, city, "Operations", 1);
            ns.corporation.setAutoJobAssignment(division.name, city, "Engineer", (employees - 2));
            ns.corporation.setAutoJobAssignment(division.name, city, "Management", 1);
        } else {
            ns.corporation.setAutoJobAssignment(division.name, city, "Operations", 1);
            ns.corporation.setAutoJobAssignment(division.name, city, "Research & Development", (employees - 1));
        }
    }

    // 扩展新部门
    ns.print("Expanding to Healthcare division...");
    ns.corporation.expandIndustry("Healthcare", "Healthcare");
    await initCities(ns, ns.corporation.getCorporation().divisions[1]);
}

/**
 * 检查仓库是否已满
 * @param {NS} ns
 */
function areWarehousesFull(ns, division) {
    for (const city of cities) {
        const warehouse = ns.corporation.getWarehouse(division.name, city);
        if (warehouse.sizeUsed <= 0.98 * warehouse.size) {
            return false;
        }
    }
    return true;
}

/**
 * 清除所有工作分配
 * @param {NS} ns
 */
async function clearAssignments(ns, division, city) {
    const jobTypes = ["Operations", "Engineer", "Business", "Management", "Research & Development", "Training"];
    for (const job of jobTypes) {
        ns.corporation.setAutoJobAssignment(division.name, city, job, 0);
    }
}

/**
 * 研究管理
 * @param {NS} ns
 */
function doResearch(ns, division) {
    const laboratory = "Hi-Tech R&D Laboratory";
    const marketTAI = "Market-TA.I";
    const marketTAII = "Market-TA.II";

    // 优先研究实验室
    if (!ns.corporation.hasResearched(division.name, laboratory)) {
        const cost = ns.corporation.getResearchCost(division.name, laboratory);
        if (division.research > cost) {
            ns.print(`${division.name} Researching ${laboratory}`);
            ns.corporation.research(division.name, laboratory);
        }
        return;
    }

    // 然后研究市场TA
    if (!ns.corporation.hasResearched(division.name, marketTAII)) {
        const totalCost = ns.corporation.getResearchCost(division.name, marketTAI) +
            ns.corporation.getResearchCost(division.name, marketTAII);

        if (division.research > totalCost * 1.1) {
            ns.print(`${division.name} Researching ${marketTAI}`);
            ns.corporation.research(division.name, marketTAI);
            ns.print(`${division.name} Researching ${marketTAII}`);
            ns.corporation.research(division.name, marketTAII);

            // 为所有产品启用TA
            for (const product of division.products) {
                ns.corporation.setProductMarketTA1(division.name, product, true);
                ns.corporation.setProductMarketTA2(division.name, product, true);
            }
        }
        return;
    }

    // 其他研究
    for (const research of researchList) {
        if (!ns.corporation.hasResearched(division.name, research.name)) {
            const cost = research.prio * ns.corporation.getResearchCost(division.name, research.name);
            if (division.research > cost) {
                ns.print(`${division.name} Researching ${research.name}`);
                ns.corporation.research(division.name, research.name);
            }
        }
    }
}

/**
 * 新产品开发
 * @param {NS} ns
 */
function newProduct(ns, division) {
    try {
        // 检查是否有产品正在开发
        for (const product of division.products) {
            const prodInfo = ns.corporation.getProduct(division.name, product);
            if (!prodInfo) {
                ns.print(`WARN: Could not get info for product ${product}`);
                continue;
            }
            
            if (prodInfo.developmentProgress < 100) {
                ns.print(`${division.name} Product ${product} development: ${prodInfo.developmentProgress.toFixed(1)}%`);
                return;
            }

            // 初始化产品销售
            if (prodInfo.sCost === 0) {
                try {
                    ns.print(`${division.name} Starting sales for ${product}`);
                    ns.corporation.sellProduct(division.name, "Sector-12", product, "MAX", "MP", true);
                    if (ns.corporation.hasResearched(division.name, "Market-TA.II")) {
                        ns.corporation.setProductMarketTA1(division.name, product, true);
                        ns.corporation.setProductMarketTA2(division.name, product, true);
                    }
                } catch (e) {
                    ns.print(`ERROR starting sales for ${product}: ${e}`);
                }
            }
        }

        // 计算最大产品数量
        let maxProducts = 3;
        if (ns.corporation.hasResearched(division.name, "uPgrade: Capacity.I")) maxProducts++;
        if (ns.corporation.hasResearched(division.name, "uPgrade: Capacity.II")) maxProducts++;

        // 如果超过最大数量，淘汰最旧的产品
        if (division.products.length >= maxProducts) {
            const oldestProduct = division.products[0];
            try {
                ns.print(`${division.name} Discontinuing ${oldestProduct}`);
                ns.corporation.discontinueProduct(division.name, oldestProduct);
            } catch (e) {
                ns.print(`ERROR discontinuing ${oldestProduct}: ${e}`);
            }
        }

        // 生成新产品名称
        let newProductNum = 0;
        if (division.products.length > 0) {
            const lastProduct = division.products[division.products.length - 1];
            newProductNum = parseInt(lastProduct.split("-")[1]) + 1;
            if (newProductNum > 9) newProductNum = 0;
        }
        const newProductName = `Product-${newProductNum}`;

        // 计算研发投资
        let investAmount = 1e9;
        const corpFunds = ns.corporation.getCorporation().funds;

        if (corpFunds < (2 * investAmount)) {
            if (corpFunds <= 0) {
                ns.print("WARN: Negative funds, cannot develop new product");
                return;
            }
            investAmount = Math.floor(corpFunds / 2);
        }

        try {
            ns.print(`Developing new product: ${newProductName} with $${ns.formatNumber(investAmount, 1)} investment`);
            ns.corporation.makeProduct(division.name, "Sector-12", newProductName, investAmount, investAmount);
        } catch (e) {
            ns.print(`ERROR creating new product: ${e}`);
            // 尝试减少投资金额
            if (e.toString().includes("not enough funds")) {
                const reducedAmount = Math.floor(investAmount / 2);
                if (reducedAmount > 1e8) { // 至少投资1亿
                    ns.print(`Retrying with reduced investment: $${ns.formatNumber(reducedAmount, 1)}`);
                    ns.corporation.makeProduct(division.name, "Sector-12", newProductName, reducedAmount, reducedAmount);
                }
            }
        }
    } catch (e) {
        ns.print(`ERROR in newProduct function: ${e}`);
    }
}

/**
 * 初始化城市
 * @param {NS} ns
 */
async function initCities(ns, division, productCity = "Sector-12") {
    for (const city of cities) {
        // 扩展城市并购买仓库
        if (!division.cities.includes(city)) {
            ns.print(`Expanding ${division.name} to ${city}`);
            ns.corporation.expandCity(division.name, city);
            ns.corporation.purchaseWarehouse(division.name, city);
        }

        // 升级仓库
        for (let i = 0; i < 3; i++) {
            ns.corporation.upgradeWarehouse(division.name, city);
        }

        // 产品城市特殊处理
        if (city === productCity) {
            // 升级办公室并雇佣更多员工
            const newEmployees = 9;
            ns.corporation.upgradeOfficeSize(division.name, city, newEmployees);

            for (let i = 0; i < newEmployees + 3; i++) {
                ns.corporation.hireEmployee(division.name, city);
            }

            // 分配工作
            ns.corporation.setAutoJobAssignment(division.name, city, "Operations", 4);
            ns.corporation.setAutoJobAssignment(division.name, city, "Engineer", 6);
            ns.corporation.setAutoJobAssignment(division.name, city, "Management", 2);
        } else {
            // 其他城市基础设置
            for (let i = 0; i < 3; i++) {
                ns.corporation.hireEmployee(division.name, city);
            }
            ns.corporation.setAutoJobAssignment(division.name, city, "Research & Development", 3);
        }
    }

    // 创建第一个产品
    ns.corporation.makeProduct(division.name, productCity, "Product-0", 1e9, 1e9);
}

/**
 * 初始公司升级
 * @param {NS} ns
 */
async function initialCorpUpgrade(ns) {
    ns.print("Performing initial upgrades...");

    // 解锁智能供应
    ns.corporation.unlockUpgrade("Smart Supply");

    // 初始升级
    const initialUpgrades = [
        "Smart Storage", "Smart Storage", "Smart Storage", "Smart Storage",
        "DreamSense",
        "Nuoptimal Nootropic Injector Implants",
        "Speech Processor Implants",
        "Neural Accelerators",
        "FocusWires"
    ];

    for (const upgrade of initialUpgrades) {
        ns.corporation.levelUpgrade(upgrade);
    }
}

// 城市列表
const cities = ["Sector-12", "Aevum", "Volhaven", "Chongqing", "New Tokyo", "Ishima"];

// 升级优先级列表
const upgradeList = [
    { prio: 2, name: "Project Insight" },
    { prio: 2, name: "DreamSense" },
    { prio: 4, name: "ABC SalesBots" },
    { prio: 4, name: "Smart Factories" },
    { prio: 4, name: "Smart Storage" },
    { prio: 8, name: "Neural Accelerators" },
    { prio: 8, name: "Nuoptimal Nootropic Injector Implants" },
    { prio: 8, name: "FocusWires" },
    { prio: 8, name: "Speech Processor Implants" },
    { prio: 8, name: "Wilson Analytics" },
];

// 研究优先级列表
const researchList = [
    { prio: 10, name: "Overclock" },
    { prio: 10, name: "uPgrade: Fulcrum" },
    { prio: 3, name: "uPgrade: Capacity.I" },
    { prio: 4, name: "uPgrade: Capacity.II" },
    { prio: 10, name: "Self-Correcting Assemblers" },
    { prio: 21, name: "Drones" },
    { prio: 4, name: "Drones - Assembly" },
    { prio: 10, name: "Drones - Transport" },
    { prio: 26, name: "Automatic Drug Administration" },
    { prio: 10, name: "CPH4 Injections" },
];
