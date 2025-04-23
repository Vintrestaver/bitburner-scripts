/**作者：
 * Discord：
 * - Sphyxis
 *
 * 额外贡献者：
 * Discord：
 * - Stoneware
 * - gmcew
 * - eithel
 * - Insight (alainbryden)
 */

import {
    getConfiguration, instanceCount, log, getErrorInfo, getActiveSourceFiles, getNsDataThroughFile, tail
} from './helpers.js'

const argsSchema = [
    ['cheats', true], //（现在默认启用 - 但仍保留选项以兼容旧版）只有拥有 BN14.2 时才可能作弊
    ['disable-cheats', false], // 如果你出于某种原因不想使用作弊功能，请设为 true。
    ['cheat-chance-threshold', 0.9], // 如果我们的成功概率低于此值，则不作弊
    ['logtime', false], // 记录每个玩家走棋所用时间
    ['runOnce', false], // 启用后只进行一局游戏
    ['silent', false], //（已废弃）此脚本曾自动 tail。现在如需 tail，请像平常一样用 --tail。
];

export function autocomplete(data, args) {
    data.flags(argsSchema);
    return [];
}

/** 主脚本入口。
 * 注意：为防止“共享全局内存”，整个脚本都包裹在 main 函数体内。
 * @param {NS} ns */
export async function main(ns) {
    let cheats = false;
    let cheatChanceThreshold = 1.0;
    let logtime = false;
    let runOnce = true;
    let silent = false;
    let currentValidMovesTurn = 0; //当前回合 currentValidMoves 的有效回合数
    let turn = 0;
    let START = performance.now();
    // 全局变量以这种方式初始化，在整个脚本中获得强类型
    let board = (/**@returns{string[]}*/() => undefined)(); // 当前棋盘状态
    let currentValidMoves = (/**@returns{number[][]}*/() => undefined)(); // 当前回合所有有效走法
    let currentValidContestedMoves = (/**@returns{number[][]}*/() => undefined)(); // 当前回合所有可占据争夺点的走法
    let contested = (/**@returns{string[]}*/() => undefined)(); // 争夺点信息
    let validMove = (/**@returns{boolean[][]}*/() => undefined)(); // 有效走法布尔矩阵
    let validLibMoves = (/**@returns{number[][]}*/() => undefined)(); // 每点的气数
    let chains = (/**@returns{number[][]}*/() => undefined)(); // 连锁信息
    let testBoard = (/**@returns{string[]}*/() => [])(); // 用于模式检测的测试棋盘

    //X,O = 我, 对手  x, o = 除对方或阻挡/墙外，W 表示棋盘外，? 表示任意
    //B 表示阻挡（墙或你，不是空或敌），b 表示阻挡但可能是敌，A 表示除 . 外所有（墙、我、你、空）
    //* 表示下步必须下在此处 - 无安全性

    const disrupt4 = [
        ["??b?", "?b.b", "b.*b", "?bb?"], // 模式# Sphyxis - 争取一回合 #极佳
        ["?bb?", "b..b", "b*Xb", "?bb?"], // 模式# Sphyxis - 争取一回合 #极佳
        ["?bb?", "b..b", "b.*b", "?bb?"], // 模式# Sphyxis - 争取一回合 #极佳
        ["??b?", "?b.b", "?b*b", "??O?"], // 模式# Sphyxis - 牺牲破眼
        ["?bbb", "bb.b", "W.*b", "?oO?"], // 模式# Sphyxis - 2x2 角破坏
        ["?bbb", "bb.b", "W.*b", "?Oo?"], // 模式# Sphyxis - 2x2 角破坏
        [".bbb", "o*.b", ".bbb", "????"], // 模式# Sphyxis - 悬挂 2 破坏
    ];
    const disrupt5 = [
        ["?bbb?", "b.*.b", "?bbb?", "?????", "?????"], // 模式# Sphyxis - 转为单眼
        ["??OO?", "?b*.b", "?b..b", "??bb?", "?????"], // 模式# Sphyxis - 拖延时间
        ["?????", "??bb?", "?b*Xb", "?boob", "??bb?"], // 模式# Sphyxis - 拖延时间
        ["WWW??", "WWob?", "Wo*b?", "WWW??", "?????"], // 模式# Sphyxis - 角上 2x2 攻击
        ["??b??", "?b.b?", "?b*b?", "?b.A?", "??b??"], // 模式# Sphyxis - 破双眼为单眼，争取一回合
        ["??b??", "?b.b?", "??*.b", "?b?b?", "?????"], // 模式# Sphyxis - 破眼，拖延
        ["?WWW?", "WoOoW", "WOO*W", "W???W", "?????"], // 封锁 3x3 角
        ["?WWW?", "Wo*oW", "WOOOW", "W???W", "?????"], // 封锁 3x3 角
    ];
    const def5 = [
        ["?WW??", "WW.X?", "W.XX?", "WWW??", "?????"], // 模式# Sphyxis - 角眼
        ["WWW??", "WW.X?", "W.*X?", "WWW??", "?????"], // 模式# Sphyxis - 2x2 角防守 #极佳
        ["BBB??", "BB.X?", "B..X?", "BBB??", "?????"], // 模式# Sphyxis - 2x2 角防守 #极佳
        ["?WWW?", "W.*.W", "WXXXW", "?????", "?????"], // 占据 3x3 角
    ];

    // 测试
    //const opponent = ["Slum Snakes", "Tetrads", "Daedalus", "Illuminati"]
    //const opponent2 = ["????????????"]
    // 原始
    const opponent = ["Netburners", "Slum Snakes", "The Black Hand", "Tetrads", "Daedalus", "Illuminati"];
    const opponent2 = ["Netburners", "Slum Snakes", "The Black Hand", "Tetrads", "Daedalus", "Illuminati", "????????????"];

    await start();

    /** @param {NS} ns */
    async function start() {
        const runOptions = getConfiguration(ns, argsSchema);
        if (!runOptions || (await instanceCount(ns)) > 1) return; // 防止脚本多实例启动，即使参数不同。

        logtime = runOptions.logtime;
        runOnce = runOptions.runOnce;

        const sourceFiles = await getActiveSourceFiles(ns, true);
        // 如果拥有 SF14.2 或更高（且未禁用作弊），则启用作弊。
        cheats = !runOptions['disable-cheats'] && (sourceFiles[14] ?? 0) >= 2;
        cheatChanceThreshold = runOptions['cheat-chance-threshold'];

        ns.disableLog("go.makeMove")

        let ranToCompletion = false;
        while (!ranToCompletion) {
            try {
                await playGo(ns);
                ranToCompletion = true;
            }
            catch (err) {
                log(ns, `警告: go.js 捕获（并抑制）了一个意外错误:\n${getErrorInfo(err)}`, false, 'warning');
                log(ns, `信息: 10 秒后重试。`, false);
                await ns.sleep(10 * 1000);
            }
        }
    }

    // Ram 规避助手（让脚本只需最大函数所需内存）
    /** @param {NS} ns @returns {Promise<string[]>} */
    async function go_getBoardState(ns) {
        return await getNsDataThroughFile(ns, `ns.go.getBoardState()`);
    }
    /** @param {NS} ns @returns {Promise<string[]>} */
    async function go_analysis_getControlledEmptyNodes(ns) {
        return await getNsDataThroughFile(ns, `ns.go.analysis.getControlledEmptyNodes()`);
    }
    /** @param {NS} ns @returns {Promise<boolean[][]>} */
    async function go_analysis_getValidMoves(ns) {
        return await getNsDataThroughFile(ns, `ns.go.analysis.getValidMoves()`);
    }
    /** @param {NS} ns @returns {Promise<number[][]>} */
    async function go_analysis_getLiberties(ns) {
        return await getNsDataThroughFile(ns, `ns.go.analysis.getLiberties()`);
    }
    /** @param {NS} ns @returns {Promise<number[][]>} */
    async function go_analysis_getChains(ns) {
        return await getNsDataThroughFile(ns, `ns.go.analysis.getChains()`);
    }
    /** @param {NS} ns @returns {Promise<number>} */
    async function go_cheat_getCheatSuccessChance(ns) {
        return await getNsDataThroughFile(ns, `ns.go.cheat.getCheatSuccessChance()`);
    }
    /** @param {NS} ns @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
     * @returns {Promise<{type: "move" | "pass" | "gameOver";x: number;y: number;}>} */
    async function go_cheat_playTwoMoves(ns, x1, y1, x2, y2) {
        return await getNsDataThroughFile(ns, `await ns.go.cheat.playTwoMoves(...ns.args)`, null, [x1, y1, x2, y2]);
    }
    /** @param {NS} ns @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
     * @returns {Promise<{type: "move" | "pass" | "gameOver";x: number;y: number;}>} */
    async function go_makeMove(ns, x, y) {
        return await ns.go.makeMove(x, y);
        //return await getNsDataThroughFile(ns, `await ns.go.makeMove(...ns.args)`, null, [x, y]);
    }

    /** @param {NS} ns */
    async function playGo(ns) {
        const startBoard = await go_getBoardState(ns)
        let inProgress = false
        turn = 0
        START = performance.now()
        //如果我们已经走过，跳到第 3 回合以跳过开局
        for (let x = 0; x < startBoard[0].length; x++) {
            for (let y = 0; y < startBoard[0].length; y++) {
                if (startBoard[x][y] === "X") {
                    inProgress = true
                    turn = 3
                    break
                }
            }
            if (inProgress) break
        }
        const currentGame = await ns.go.opponentNextTurn(false)
        checkNewGame(ns, currentGame)
        const playStyle = getStyle(ns);

        // 策略步骤数组，每个风格对应一组 move 函数及参数
        const strategies = [
            // Netburners
            [
                () => movePiece(ns, getRandomCounterLib()),
                () => movePiece(ns, getRandomLibAttack(88)),
                () => movePiece(ns, getRandomLibDefend()),
                () => moveSnakeEyes(ns, getSnakeEyes(6)),
                () => movePiece(ns, getAggroAttack(2, 2, 2)),
                () => movePiece(ns, disruptEyes()),
                () => movePiece(ns, getDefPattern()),
                () => movePiece(ns, getAggroAttack(3, 3, 3, 1, 6)),
                () => movePiece(ns, getRandomBolster(2, 1)),
                () => movePiece(ns, getAggroAttack(4, 7, 3, 1, 6)),
                () => movePiece(ns, attackGrowDragon(1)),
                () => movePiece(ns, getDefAttack(8, 20, 2)),
                () => movePiece(ns, getRandomExpand()),
                () => movePiece(ns, getRandomBolster(2, 1, false, 1)),
                () => movePiece(ns, getRandomLibAttack()),
                () => movePiece(ns, getRandomStrat()),
            ],
            // The Black Hand
            [
                () => movePiece(ns, getRandomCounterLib()),
                () => movePiece(ns, getRandomLibAttack(88)),
                () => movePiece(ns, getRandomLibDefend()),
                () => moveSnakeEyes(ns, getSnakeEyes(6)),
                () => movePiece(ns, getAggroAttack(2, 2, 2)),
                () => movePiece(ns, disruptEyes()),
                () => movePiece(ns, getDefPattern()),
                () => movePiece(ns, getAggroAttack(3, 3, 3, 1, 6)),
                () => movePiece(ns, getRandomBolster(2, 1)),
                () => movePiece(ns, getAggroAttack(4, 7, 3, 1, 6)),
                () => movePiece(ns, attackGrowDragon(1)),
                () => movePiece(ns, getRandomExpand()),
                () => movePiece(ns, getRandomBolster(2, 1, false, 1)),
                () => movePiece(ns, getRandomLibAttack()),
                () => movePiece(ns, getRandomStrat()),
            ],
            // Slum Snakes
            [
                () => movePiece(ns, getRandomCounterLib()),
                () => movePiece(ns, getRandomLibAttack(88)),
                () => movePiece(ns, getRandomLibDefend()),
                () => moveSnakeEyes(ns, getSnakeEyes(6)),
                () => movePiece(ns, getAggroAttack(2, 2, 2)),
                () => movePiece(ns, disruptEyes()),
                () => movePiece(ns, getDefPattern()),
                () => movePiece(ns, getAggroAttack(3, 3, 3, 1, 6)),
                () => movePiece(ns, getRandomBolster(2, 1)),
                () => movePiece(ns, getDefAttack(4, 7, 3, 1, 6)),
                () => movePiece(ns, attackGrowDragon(1)),
                () => movePiece(ns, getRandomExpand()),
                () => movePiece(ns, getRandomBolster(2, 1, false, 1)),
                () => movePiece(ns, getRandomLibAttack()),
                () => movePiece(ns, getRandomStrat()),
            ],
            // Daedalus
            [
                () => movePiece(ns, getRandomCounterLib()),
                () => movePiece(ns, getRandomLibAttack(88)),
                () => movePiece(ns, getRandomLibDefend()),
                () => moveSnakeEyes(ns, getSnakeEyes(6)),
                () => movePiece(ns, getAggroAttack(2, 2, 2)),
                () => movePiece(ns, disruptEyes()),
                () => movePiece(ns, getDefPattern()),
                () => movePiece(ns, getAggroAttack(3, 4, 3, 1, 6)),
                () => movePiece(ns, getRandomBolster(2, 1)),
                () => movePiece(ns, getDefAttack(5, 7, 3, 2, 6)),
                () => movePiece(ns, attackGrowDragon(1)),
                () => movePiece(ns, getRandomExpand()),
                () => movePiece(ns, getRandomBolster(2, 1, false, 1)),
                () => movePiece(ns, getRandomLibAttack()),
                () => movePiece(ns, getRandomStrat()),
            ],
            // Tetrads
            [
                () => movePiece(ns, getRandomCounterLib()),
                () => movePiece(ns, getRandomLibAttack(88)),
                () => movePiece(ns, getRandomLibDefend()),
                () => moveSnakeEyes(ns, getSnakeEyes(6)),
                () => movePiece(ns, getAggroAttack(2, 2, 2)),
                () => movePiece(ns, disruptEyes()),
                () => movePiece(ns, getDefPattern()),
                () => movePiece(ns, getAggroAttack(3, 4, 3)),
                () => movePiece(ns, getRandomBolster(2, 1)),
                () => movePiece(ns, getAggroAttack(5, 7, 3)),
                () => movePiece(ns, attackGrowDragon(1)),
                () => movePiece(ns, getRandomExpand()),
                () => movePiece(ns, getRandomBolster(2, 1, false)),
                () => movePiece(ns, getRandomLibAttack()),
                () => movePiece(ns, getRandomStrat()),
            ],
            // Illuminati
            [
                () => movePiece(ns, getRandomCounterLib()),
                () => movePiece(ns, getRandomLibAttack(88)),
                () => movePiece(ns, getRandomLibDefend()),
                () => moveSnakeEyes(ns, getSnakeEyes(6)),
                () => movePiece(ns, getAggroAttack(2, 2, 2)),
                () => movePiece(ns, disruptEyes()),
                () => movePiece(ns, getDefPattern()),
                () => movePiece(ns, getAggroAttack(3, 4, 3)),
                () => movePiece(ns, getRandomBolster(2, 1)),
                () => movePiece(ns, attackGrowDragon(1)),
                () => movePiece(ns, getRandomExpand()),
                () => movePiece(ns, getRandomBolster(2, 1, false)),
                () => movePiece(ns, getRandomLibAttack()),
                () => movePiece(ns, getRandomStrat()),
            ],
            // Default
            [
                () => movePiece(ns, getRandomCounterLib()),
                () => movePiece(ns, getRandomLibAttack(88)),
                () => movePiece(ns, getRandomLibDefend()),
                () => moveSnakeEyes(ns, getSnakeEyes(6)),
                () => movePiece(ns, getAggroAttack(2, 2, 2)),
                () => movePiece(ns, disruptEyes()),
                () => movePiece(ns, getDefPattern()),
                () => movePiece(ns, getAggroAttack(3, 4, 3)),
                () => movePiece(ns, getRandomBolster(2, 1)),
                () => movePiece(ns, getDefAttack(5, 7, 3)),
                () => movePiece(ns, attackGrowDragon(1)),
                () => movePiece(ns, getRandomExpand()),
                () => movePiece(ns, getRandomBolster(2, 1, false)),
                () => movePiece(ns, getRandomLibAttack()),
                () => movePiece(ns, getRandomStrat()),
            ],
        ];

        while (true) {
            turn++
            board = await go_getBoardState(ns);
            contested = await go_analysis_getControlledEmptyNodes(ns);
            validMove = await go_analysis_getValidMoves(ns);
            validLibMoves = await go_analysis_getLiberties(ns);
            chains = await go_analysis_getChains(ns);
            const size = board[0].length
            //构建带墙的测试棋盘
            let testWall = "W".repeat(size + 2);
            testBoard = [];
            testBoard.push(testWall);
            for (const b of board)
                testBoard.push("W" + b + "W");
            testBoard.push(testWall);
            //我们已获得测试棋盘

            let results;
            if (turn < 3) {
                results = await movePiece(ns, getOpeningMove(ns))
            } else {
                for (const moveFn of strategies[playStyle] || strategies[strategies.length - 1]) {
                    results = await moveFn();
                    if (results) break;
                }
                if (!results) {
                    ns.print("回合跳过")
                    results = await ns.go.passTurn()
                }
            }
            checkNewGame(ns, results)
        }
    }

    /** @param {NS} ns */
    function getStyle(ns) {
        switch (ns.go.getOpponent()) {
            case "Netburners": return 0;
            case "The Black Hand": return 1;
            case "Slum Snakes": return 2;
            case "Daedalus": return 3;
            case "Tetrads": return 4;
            case "Illuminati": return 5;
            default: return 6;
        }
    }

    /** @param {NS} ns
     * @param {{ type:"move"|"pass"|"gameOver"; x:number; y:number;}} gameInfo
     */
    function checkNewGame(ns, gameInfo) {
        if (gameInfo.type === "gameOver") {
            if (runOnce) ns.exit()
            try { ns.go.resetBoardState(opponent2[Math.floor(Math.random() * opponent2.length)], 13) }
            catch { ns.go.resetBoardState(opponent[Math.floor(Math.random() * opponent.length)], 13) }
            turn = 0
            ns.clearLog()
        }
    }
    /** @param {NS} ns
     * @param {number} x
     * @param {number} y
     * @param {string[]} pattern
     * @returns {boolean}
     */
    function isPattern(x, y, pattern) {
        //通过 x/y 循环移动模式，检查下子后是否匹配
        //可假设 x, y 是有效走法

        const size = testBoard[0].length
        const patterns = getAllPatterns(pattern)
        const patternSize = pattern.length

        for (const patternCheck of patterns) {
            //cx 和 cy - 检查模式与测试棋盘的点
            //对于 3x3 模式，范围为 0,0 -> 2,2
            for (let cx = ((patternSize - 1) * -1); cx <= 0; cx++) { // 我们已在周围加了墙，所以 0 是墙
                if (cx + x + 1 < 0 || cx + x + 1 > size - 1) continue
                for (let cy = ((patternSize - 1) * -1); cy <= 0 - 1; cy++) {
                    //我们现在有一个循环，检查网格的每个部分是否与模式匹配
                    //安全检查：我们知道 0,0 是安全的，它是传入的点，但其他部分可能不安全
                    if (cy + y + 1 < 0 || cy + y + 1 > size - 1) continue
                    let count = 0
                    let abort = false
                    for (let px = 0; px < patternSize && !abort; px++) {
                        if (x + cx + px + 1 < 0 || x + cx + px + 1 >= size) {  //不越界
                            abort = true
                            break
                        }
                        for (let py = 0; py < patternSize && !abort; py++) {
                            if (y + cy + py + 1 < 0 || y + cy + py + 1 >= size) { //是否越界？
                                abort = true
                                break
                            }
                            if (cx + px === 0 && cy + py === 0 && !["X", "*"].includes(patternCheck[px][py])) {
                                abort = true
                                break
                            }
                            if (cx + px === 0 && cy + py === 0 && ["X"].includes(contested[x][y]) && patternCheck[px][py] !== "*") {
                                abort = true
                                break
                            }
                            //我们现在有一个循环，检查模式的每个点
                            //对于 3x3，范围为 0,0 -> 2,2
                            switch (patternCheck[px][py]) {
                                case "X":
                                    if (testBoard[cx + x + 1 + px][cy + y + 1 + py] === "X" || (cx + px === 0 && cy + py === 0 && testBoard[cx + x + 1 + px][cy + y + 1 + py] === ".")) {
                                        count++
                                    }
                                    else if (cx + px === 0 && cy + py === 0) {
                                        count++ // 我们的放置点
                                    }
                                    else abort = true
                                    break
                                case "*": // 特殊情况。我们下步下在此处或中断测试
                                    if (testBoard[cx + x + 1 + px][cy + y + 1 + py] === "." && cx + px === 0 && cy + py === 0) {
                                        count++
                                    }
                                    else abort = true
                                    break
                                case "O":
                                    if (testBoard[cx + x + 1 + px][cy + y + 1 + py] === "O")
                                        count++
                                    else abort = true
                                    break
                                case "x":
                                    if (["X", "."].includes(testBoard[cx + x + 1 + px][cy + y + 1 + py]))
                                        count++
                                    else abort = true
                                    break
                                case "o":
                                    if (["O", "."].includes(testBoard[cx + x + 1 + px][cy + y + 1 + py]))
                                        count++
                                    else abort = true
                                    break
                                case "?":
                                    count++
                                    break
                                case ".":
                                    if (testBoard[cx + x + 1 + px][cy + y + 1 + py] === ".")
                                        count++
                                    else abort = true
                                    break
                                case "W":
                                    if (["W", "#"].includes(testBoard[cx + x + 1 + px][cy + y + 1 + py]))
                                        count++
                                    else abort = true
                                    break
                                case "B":
                                    if (["W", "#", "X"].includes(testBoard[cx + x + 1 + px][cy + y + 1 + py]))
                                        count++
                                    else abort = true
                                    break
                                case "b":
                                    if (["W", "#", "O"].includes(testBoard[cx + x + 1 + px][cy + y + 1 + py]))
                                        count++
                                    else abort = true
                                    break
                                case "A":
                                    if (["W", "#", "X", "O"].includes(testBoard[cx + x + 1 + px][cy + y + 1 + py]))
                                        count++
                                    else abort = true
                                    break
                            }
                            if (count === patternSize * patternSize) return true
                        }
                    }
                }
            }
        }
        return false
    }
    /** @param {NS} ns
     * @param {string[]} pattern
     * @returns {string[][]} */
    function getAllPatterns(pattern) {
        // 获取所有旋转和镜像的模式
        const rotations = [
            pattern,
            rotate90Degrees(pattern),
            rotate90Degrees(rotate90Degrees(pattern)),
            rotate90Degrees(rotate90Degrees(rotate90Degrees(pattern))),
        ]
        return [...rotations, ...rotations.map(verticalMirror)]
    }

    //特别感谢 @gmcew 提供以下两个函数！
    /** @param {NS} ns
     * @param {string[]} pattern
     * @returns {string[]} */
    function rotate90Degrees(pattern) {
        // 旋转 90 度
        return pattern.map((val, index) => pattern.map(row => row[index]).reverse().join(""))
    }
    /** @param {NS} ns
     * @param {string[]} pattern
     * @returns {string[]} */
    function verticalMirror(pattern) {
        // 垂直镜像
        return pattern.toReversed();
    }

    /** @param {NS} ns
     * @returns {{coords: number[]; msg: string;}} */
    function getSnakeEyes(minKilled = 5) {
        if (!cheats) return []
        const moveOptions = []
        const size = board[0].length
        let highValue = 1

        const checked = new Set

        for (let x = 0; x < size - 1; x++)
            for (let y = 0; y < size - 1; y++) {
                if (contested[x][y] === "X" || board[x][y] !== "O" || validLibMoves[x][y] !== 2 || checked.has(JSON.stringify([x, y]))) continue
                //是否为敌方，气数为 2（可杀），且未检查过，链足够大
                const chain = getChainValue(x, y, "O")
                if (chain < minKilled) continue
                //我们找到一个目标！检查所有点，找出两步杀棋。将已检查点加入 checked，避免重复
                checked.add(JSON.stringify([x, y]))
                const enemySearch = new Set
                const move1 = []
                const move2 = []
                enemySearch.add(JSON.stringify([x, y]))
                for (const explore of enemySearch) {
                    const [fx, fy] = JSON.parse(explore)
                    //找眼
                    if (board[fx][fy] === ".") {
                        move1.length ? move2.push([fx, fy]) : move1.push([fx, fy])
                        checked.add(JSON.stringify([fx, fy]))
                        continue
                    }

                    //找更多自己以搜索...
                    if (fx < size - 1 && ["O", "."].includes(board[fx + 1][fy])) {
                        enemySearch.add(JSON.stringify([fx + 1, fy]))
                        checked.add(JSON.stringify([fx, fy]))
                    }
                    if (fx > 0 && ["O", "."].includes(board[fx - 1][fy])) {
                        enemySearch.add(JSON.stringify([fx - 1, fy]))
                        checked.add(JSON.stringify([fx, fy]))
                    }
                    if (fy > 0 && ["O", "."].includes(board[fx][fy - 1])) {
                        enemySearch.add(JSON.stringify([fx, fy - 1]))
                        checked.add(JSON.stringify([fx, fy]))
                    }
                    if (fy < size - 1 && ["O", "."].includes(board[fx][fy + 1])) {
                        enemySearch.add(JSON.stringify([fx, fy + 1]))
                        checked.add(JSON.stringify([fx, fy]))
                    }
                } // 结束搜索敌方

                if (chain > highValue) {
                    highValue = chain
                    moveOptions.length = 0
                    const mv1 = move1.pop()
                    const mv2 = move2.pop()
                    moveOptions.push([mv1[0], mv1[1], mv2[0], mv2[1]])
                }
                else if (chain === highValue) {
                    const mv1 = move1.pop()
                    const mv2 = move2.pop()
                    moveOptions.push([mv1[0], mv1[1], mv2[0], mv2[1]])
                }
            } // 搜索整个棋盘

        // 随机选一个找到的走法
        const randomIndex = Math.floor(Math.random() * moveOptions.length)
        return moveOptions[randomIndex] ? {
            coords: moveOptions[randomIndex],
            msg: "SnakeEyes Cheat"
        } : []
    }
    /** @param {NS} ns
     * @returns {{coords: number[]; msg: string;}} */
    function getRandomLibAttack(minKilled = 1) {
        const moveOptions = []
        const size = board[0].length
        let highValue = 1
        // 遍历棋盘所有点
        const moves = getAllValidMoves(true)
        for (const [x, y] of moves) {
            if (contested[x][y] === "X" || validLibMoves[x][y] !== -1) continue

            let count = 0
            let chains = 0

            //只检查上下左右
            if (x > 0 && board[x - 1][y] === "O" && validLibMoves[x - 1][y] === 1) {
                count++
                chains += getChainValue(x - 1, y, "O")
            }
            if (x < size - 1 && board[x + 1][y] === "O" && validLibMoves[x + 1][y] === 1) {
                count++
                chains += getChainValue(x + 1, y, "O")
            }
            if (y > 0 && board[x][y - 1] === "O" && validLibMoves[x][y - 1] === 1) {
                count++
                chains += getChainValue(x, y - 1, "O")
            }
            if (y < size - 1 && board[x][y + 1] === "O" && validLibMoves[x][y + 1] === 1) {
                count++
                chains += getChainValue(x, y + 1, "O")
            }
            const enemyLibs = getSurroundLibs(x, y, "O")
            if (count === 0 || (chains < minKilled && enemyLibs <= 1)) continue

            const result = count * chains
            if (result > highValue) {
                moveOptions.length = 0
                moveOptions.push([x, y])
                highValue = result
            }
            else if (result === highValue) moveOptions.push([x, y]);
        }
        // 随机选一个找到的走法
        const randomIndex = Math.floor(Math.random() * moveOptions.length)
        return moveOptions[randomIndex] ? {
            coords: moveOptions[randomIndex],
            msg: "Lib Attack"
        } : []
    }
    /** @param {NS} ns
     * @returns {{coords: number[]; msg: string;}} */
    function getRandomLibDefend(savedMin = 1) {
        const moveOptions = []
        const size = board[0].length
        let highValue = 0
        // 遍历棋盘所有点
        const moves = getAllValidMoves()
        for (const [x, y] of moves) {
            const surround = getSurroundLibs(x, y, "X")
            const myEyes = getEyeValue(x, y, "X")
            if (surround + myEyes < 2) continue //放弃。随它去吧...

            if (validLibMoves[x][y] === -1) {
                let count = 0
                //只检查上下左右
                if (x > 0 && validLibMoves[x - 1][y] === 1 && board[x - 1][y] === "X") count += getChainValue(x - 1, y, "X")
                if (x < size - 1 && validLibMoves[x + 1][y] === 1 && board[x + 1][y] === "X") count += getChainValue(x + 1, y, "X")
                if (y > 0 && validLibMoves[x][y - 1] === 1 && board[x][y - 1] === "X") count += getChainValue(x, y - 1, "X")
                if (y < size - 1 && validLibMoves[x][y + 1] === 1 && board[x][y + 1] === "X") count += getChainValue(x, y + 1, "X")
                if (count === 0 || count < savedMin) continue
                //此走法有多有效？如能反击则反击。
                count *= surround

                if (count > highValue) {
                    moveOptions.length = 0
                    moveOptions.push([x, y])
                    highValue = count
                }
                else if (count === highValue) moveOptions.push([x, y])
            }
        }
        // 随机选一个找到的走法
        const randomIndex = Math.floor(Math.random() * moveOptions.length)
        return moveOptions[randomIndex] ? {
            coords: moveOptions[randomIndex],
            msg: "Lib Defend"
        } : []
    }
    /** @param {NS} ns
     * @returns {{coords: number[]; msg: string;}} */
    function getRandomCounterLib() {
        // 高级策略
        // 如果有即将被吃掉的链，且有挂着的气，找出并断气救链
        const size = board[0].length
        // 遍历棋盘所有点
        const moves = getAllValidMoves()
        const movesAvailable = new Set //包含我们要检查是否应占据的空点
        const friendlyToCheckForOpp = new Set
        for (const [x, y] of moves) {
            //先检查上下左右
            if (x > 0 && validLibMoves[x - 1][y] === 1 && board[x - 1][y] === "X") {
                movesAvailable.add(JSON.stringify([x, y]))
                friendlyToCheckForOpp.add(JSON.stringify([x - 1, y]))
            }
            if (x < size - 1 && validLibMoves[x + 1][y] === 1 && board[x + 1][y] === "X") {
                movesAvailable.add(JSON.stringify([x, y]))
                friendlyToCheckForOpp.add(JSON.stringify([x + 1, y]))
            }
            if (y > 0 && validLibMoves[x][y - 1] === 1 && board[x][y - 1] === "X") {
                movesAvailable.add(JSON.stringify([x, y]))
                friendlyToCheckForOpp.add(JSON.stringify([x, y - 1]))
            }
            if (y < size - 1 && validLibMoves[x][y + 1] === 1 && board[x][y + 1] === "X") {
                movesAvailable.add(JSON.stringify([x, y]))
                friendlyToCheckForOpp.add(JSON.stringify([x, y + 1]))
            }
        }
        //捷径。虽然有 1 个，但它是 THE one 吗？
        //我们知道这条链的一侧是有 1 气的友军，另一侧是敌方吗？
        for (const explore of movesAvailable) {
            const [fx, fy] = JSON.parse(explore)
            if (!validMove[fx][fy]) continue
            if (fx < size - 1 && board[fx + 1][fy] === "O" && validLibMoves[fx + 1][fy] === 1) {
                return {
                    coords: [fx, fy],
                    msg: "Counter Lib Attack - Fist of the east"
                }
            }
            if (fx > 0 && board[fx - 1][fy] === "O" && validLibMoves[fx - 1][fy] === 1) {
                return {
                    coords: [fx, fy],
                    msg: "Counter Lib Attack - Fist of the west"
                }
            }
            if (fy > 0 && board[fx][fy - 1] === "O" && validLibMoves[fx][fy - 1] === 1) {
                return {
                    coords: [fx, fy],
                    msg: "Counter Lib Attack - Fist of the south"
                }
            }
            if (fy < size - 1 && board[fx][fy + 1] === "O" && validLibMoves[fx][fy + 1] === 1) {
                return {
                    coords: [fx, fy],
                    msg: "Counter Lib Attack - Fist of the north"
                }
            }
        }
        const enemiesToSearch = new Set
        //我们有空链。遍历它，找相邻 O 可杀及其他友军
        for (const explore of friendlyToCheckForOpp) {
            const [fx, fy] = JSON.parse(explore)
            if (fx < size - 1 && board[fx + 1][fy] === "O" && validLibMoves[fx + 1][fy] === 1) enemiesToSearch.add(JSON.stringify([fx + 1, fy]))
            if (fx > 0 && board[fx - 1][fy] === "O" && validLibMoves[fx - 1][fy] === 1) enemiesToSearch.add(JSON.stringify([fx - 1, fy]))
            if (fy > 0 && board[fx][fy - 1] === "O" && validLibMoves[fx][fy - 1] === 1) enemiesToSearch.add(JSON.stringify([fx, fy - 1]))
            if (fy < size - 1 && board[fx][fy + 1] === "O" && validLibMoves[fx][fy + 1] === 1) enemiesToSearch.add(JSON.stringify([fx, fy + 1]))

            if (fx < size - 1 && ["X"].includes(board[fx + 1][fy])) friendlyToCheckForOpp.add(JSON.stringify([fx + 1, fy]))
            if (fx > 0 && ["X"].includes(board[fx - 1][fy])) friendlyToCheckForOpp.add(JSON.stringify([fx - 1, fy]))
            if (fy > 0 && ["X"].includes(board[fx][fy - 1])) friendlyToCheckForOpp.add(JSON.stringify([fx, fy - 1]))
            if (fy < size - 1 && ["X"].includes(board[fx][fy + 1])) friendlyToCheckForOpp.add(JSON.stringify([fx, fy + 1]))
        }

        for (const explore of enemiesToSearch) {
            const [fx, fy] = JSON.parse(explore)
            if (fx < size - 1 && board[fx + 1][fy] === "O") enemiesToSearch.add(JSON.stringify([fx + 1, fy]))
            if (fx > 0 && board[fx - 1][fy] === "O") enemiesToSearch.add(JSON.stringify([fx - 1, fy]))
            if (fy > 0 && board[fx][fy - 1] === "O") enemiesToSearch.add(JSON.stringify([fx, fy - 1]))
            if (fy < size - 1 && board[fx][fy + 1] === "O") enemiesToSearch.add(JSON.stringify([fx, fy + 1]))

            if (fx < size - 1 && board[fx + 1][fy] === "." && validMove[fx + 1][fy]) {
                return {
                    coords: [fx + 1, fy],
                    msg: "Counter Lib Attack - The wind blows"
                }
            }
            if (fx > 0 && board[fx - 1][fy] === "." && validMove[fx - 1][fy]) {
                return {
                    coords: [fx - 1, fy],
                    msg: "Counter Lib Attack - The earth grows"
                }
            }
            if (fy > 0 && board[fx][fy - 1] === "." && validMove[fx][fy - 1]) {
                return {
                    coords: [fx, fy - 1],
                    msg: "Counter Lib Attack - The fire burns"
                }
            }
            if (fy < size - 1 && board[fx][fy + 1] === "." && validMove[fx][fy + 1]) {
                return {
                    coords: [fx, fy + 1],
                    msg: "Counter Lib Attack - The water flows"
                }
            }
        }
        return []
    }
    /** @param {NS} ns
     * @returns {{coords: number[]; msg: string;}} */
    function getRandomExpand() {
        const moveOptions = []
        const size = board[0].length;
        let highValue = 0
        // 遍历棋盘所有点
        const moves = getAllValidMoves(true)
        for (const [x, y] of moves) {
            const surroundLibs = getSurroundLibs(x, y, "X")
            const enemySurroundLibs = getSurroundLibs(x, y, "O")
            if (contested[x][y] !== "?" || surroundLibs <= 2 || createsLib(x, y, "X") || enemySurroundLibs <= 1) continue
            let count = 0
            //只检查上下左右。若被友军包围则不扩展
            if (x > 0 && board[x - 1][y] === "X") count++
            if (x < size - 1 && board[x + 1][y] === "X") count++
            if (y > 0 && board[x][y - 1] === "X") count++
            if (y < size - 1 && board[x][y + 1] === "X") count++
            if (count >= 3 || count <= 0) continue

            const surroundSpace = getSurroundSpaceFull(x, y) + 1
            const enemySurroundChains = getChainAttack(x, y) + 1
            const myEyes = getEyeValueFull(x, y, "X") + 1
            const enemies = getSurroundEnemiesFull(x, y) + 1
            const freeSpace = getFreeSpace(x, y)
            const rank = myEyes * enemySurroundLibs * enemies * enemySurroundChains * freeSpace * surroundSpace

            if (rank > highValue) {
                moveOptions.length = 0
                moveOptions.push([x, y])
                highValue = rank
            }
            else if (rank === highValue) moveOptions.push([x, y]);
        }
        // 随机选一个找到的走法
        const randomIndex = Math.floor(Math.random() * moveOptions.length)
        return moveOptions[randomIndex] ? {
            coords: moveOptions[randomIndex],
            msg: "Expansion"
        } : []
    }
    /** @param {NS} ns
     * @returns {{coords: number[]; msg: string;}} */
    function getRandomBolster(libRequired, savedNodesMin, onlyContested = true) {
        const moveOptions = [];
        const size = board[0].length;
        let highValue = 1
        // 遍历棋盘所有点
        const moves = getAllValidMoves()
        for (const [x, y] of moves) {
            if ((onlyContested && contested[x][y] !== "?") || createsLib(x, y, "X")) continue
            let right = 0
            let left = 0
            let up = 0
            let down = 0

            //只检查上下左右。检查友军链，过滤已检查的
            let checkedChains = []
            if (x < size - 1 && board[x + 1][y] === "X" && validLibMoves[x + 1][y] === libRequired) {
                right = getChainValue(x + 1, y, "X")
                checkedChains.push(chains[x + 1][y])
            }
            if (x > 0 && board[x - 1][y] === "X" && !checkedChains.includes(chains[x - 1][y]) && validLibMoves[x - 1][y] === libRequired) {
                left = getChainValue(x - 1, y, "X")
                checkedChains.push(chains[x - 1][y])
            }
            if (y < size - 1 && board[x][y + 1] === "X" && !checkedChains.includes(chains[x][y + 1]) && validLibMoves[x][y + 1] === libRequired) {
                up = getChainValue(x, y + 1, "X")
                checkedChains.push(chains[x][y + 1])
            }
            if (y > 0 && board[x][y - 1] === "X" && !checkedChains.includes(chains[x][y - 1]) && validLibMoves[x][y - 1] === libRequired)
                down = getChainValue(x, y - 1, "X")

            let count = 0
            let total = 0
            if (right >= savedNodesMin) {
                count++
                total += right
            }
            if (left >= savedNodesMin) {
                count++
                total += left
            }
            if (up >= savedNodesMin) {
                count++
                total += up
            }
            if (down >= savedNodesMin) {
                count++
                total += down
            }
            if (count <= 0) continue
            const surroundMulti = getSurroundLibSpread(x, y, "X")
            const rank = total * count * surroundMulti
            if (rank > highValue) {
                moveOptions.length = 0
                moveOptions.push([x, y])
                highValue = rank
            }
            else if (rank === highValue) moveOptions.push([x, y]);
        }
        // 随机选一个找到的走法
        const randomIndex = Math.floor(Math.random() * moveOptions.length)
        return moveOptions[randomIndex] ? {
            coords: moveOptions[randomIndex],
            msg: "Bolster - Libs: " + libRequired + "  Nodes: " + savedNodesMin + "  OnlyContested: " + onlyContested
        } : []
    }
    /** @param {NS} ns
     * @returns {number} */
    function getChainValue(checkx, checky, player) {
        const size = board[0].length
        const otherPlayer = player === "X" ? "O" : "X"
        const explored = new Set()
        if (contested[checkx][checky] === "?" || board[checkx][checky] === otherPlayer) return 0
        if (checkx < size - 1) explored.add(JSON.stringify([checkx + 1, checky]))
        if (checkx > 0) explored.add(JSON.stringify([checkx - 1, checky]))
        if (checky > 0) explored.add(JSON.stringify([checkx, checky - 1]))
        if (checky < size - 1) explored.add(JSON.stringify([checkx, checky + 1]))
        let count = 1
        for (const explore of explored) {
            const [x, y] = JSON.parse(explore)
            if (contested[x][y] === "?" || contested[x][y] === "#" || board[x][y] === otherPlayer) continue
            count++
            if (x < size - 1) explored.add(JSON.stringify([x + 1, y]))
            if (x > 0) explored.add(JSON.stringify([x - 1, y]))
            if (y > 0) explored.add(JSON.stringify([x, y - 1]))
            if (y < size - 1) explored.add(JSON.stringify([x, y + 1]))
        }
        return count
    }
    /** @param {NS} ns
     * @returns {number} */
    function getEyeValue(checkx, checky, player) {
        const size = board[0].length
        const otherPlayer = player === "X" ? "O" : "X"
        const explored = new Set()
        if (checkx < size - 1) explored.add(JSON.stringify([checkx + 1, checky]))
        if (checkx > 0) explored.add(JSON.stringify([checkx - 1, checky]))
        if (checky > 0) explored.add(JSON.stringify([checkx, checky - 1]))
        if (checky < size - 1) explored.add(JSON.stringify([checkx, checky + 1]))
        let count = 0
        for (const explore of explored) {
            const [x, y] = JSON.parse(explore)
            if (contested[x][y] === "?" || contested[x][y] === "#" || board[x][y] === otherPlayer) continue
            if (contested[x][y] === player) count++
            if (x < size - 1) explored.add(JSON.stringify([x + 1, y]))
            if (x > 0) explored.add(JSON.stringify([x - 1, y]))
            if (y > 0) explored.add(JSON.stringify([x, y - 1]))
            if (y < size - 1) explored.add(JSON.stringify([x, y + 1]))
        }
        return count
    }
    /** @param {NS} ns
     * @returns {number} */
    function getFreeSpace(checkx, checky) {
        const size = board[0].length
        if (contested[checkx][checky] !== "?") return 0
        const explored = new Set()
        if (checkx < size - 1) explored.add(JSON.stringify([checkx + 1, checky]))
        if (checkx > 0) explored.add(JSON.stringify([checkx - 1, checky]))
        if (checky > 0) explored.add(JSON.stringify([checkx, checky - 1]))
        if (checky < size - 1) explored.add(JSON.stringify([checkx, checky + 1]))
        let count = 1
        for (const explore of explored) {
            const [x, y] = JSON.parse(explore)
            if (["#", "X", "O"].includes(contested[x][y])) continue
            if (contested[x][y] === "?") count++
            if (x < size - 1) explored.add(JSON.stringify([x + 1, y]))
            if (x > 0) explored.add(JSON.stringify([x - 1, y]))
            if (y > 0) explored.add(JSON.stringify([x, y - 1]))
            if (y < size - 1) explored.add(JSON.stringify([x, y + 1]))
        }
        return count
    }
    /** @param {NS} ns
     * @returns {number} */
    function getEyeValueFull(checkx, checky, player) {
        const size = board[0].length
        const otherPlayer = player === "X" ? "O" : "X"
        const explored = new Set()
        if (checkx < size - 1) explored.add(JSON.stringify([checkx + 1, checky]))
        if (checkx > 0) explored.add(JSON.stringify([checkx - 1, checky]))
        if (checky > 0) explored.add(JSON.stringify([checkx, checky - 1]))
        if (checky < size - 1) explored.add(JSON.stringify([checkx, checky + 1]))
        if (checkx < size - 1 && checky < size - 1) explored.add(JSON.stringify([checkx + 1, checky + 1]))
        if (checkx > 0 && checky < size - 1) explored.add(JSON.stringify([checkx - 1, checky + 1]))
        if (checkx < size - 1 && checky > 0) explored.add(JSON.stringify([checkx + 1, checky - 1]))
        if (checkx > 0 && checky > 0) explored.add(JSON.stringify([checkx - 1, checky - 1]))
        let count = 0
        for (const explore of explored) {
            const [x, y] = JSON.parse(explore)
            if (contested[x][y] === "?" || contested[x][y] === "#" || board[x][y] === otherPlayer) continue
            if (contested[x][y] === player) count++
            if (x < size - 1) explored.add(JSON.stringify([x + 1, y]))
            if (x > 0) explored.add(JSON.stringify([x - 1, y]))
            if (y > 0) explored.add(JSON.stringify([x, y - 1]))
            if (y < size - 1) explored.add(JSON.stringify([x, y + 1]))
        }
        return count
    }
    /** @param {NS} ns
     * @returns {number} */
    function getChainAttack(x, y) {
        const size = board[0].length
        let count = 0
        if (x > 0 && board[x - 1][y] === "O") count += getChainValue(x - 1, y, "O")
        if (x < size - 1 && board[x + 1][y] === "O") count += getChainValue(x + 1, y, "O")
        if (y > 0 && board[x][y - 1] === "O") count += getChainValue(x, y - 1, "O")
        if (y < size - 1 && board[x][y + 1] === "O") count += getChainValue(x, y + 1, "O")

        return count
    }
    /** @param {NS} ns
     * @returns {number} */
    function getChainAttackFull(x, y) {
        const size = board[0].length
        let count = 0
        if (x < size - 1) count += getChainValue(x + 1, y, "O")
        if (x > 0) count += getChainValue(x - 1, y, "O")
        if (y > 0) count += getChainValue(x, y - 1, "O")
        if (y < size - 1) count += getChainValue(x, y + 1, "O")
        if (x < size - 1 && y < size - 1) count += getChainValue(x + 1, y + 1, "O")
        if (x > 0 && y < size - 1) count += getChainValue(x - 1, y + 1, "O")
        if (x < size - 1 && y > 0) count += getChainValue(x + 1, y - 1, "O")
        if (x > 0 && y > 0) count += getChainValue(x - 1, y - 1, "O")
        return count
    }
    /** @param {NS} ns
     * @returns {number} */
    function getSurroundSpace(x, y) {
        const size = board[0].length
        let surround = 0
        if (x > 0 && board[x - 1][y] === ".") surround++
        if (x < size - 1 && board[x + 1][y] === ".") surround++
        if (y > 0 && board[x][y - 1] === ".") surround++
        if (y < size - 1 && board[x][y + 1] === ".") surround++
        return surround
    }
    /** @param {NS} ns
     * @returns {number} */
    function getSurroundSpaceFull(startx, starty, player = "X", depth = 1) {
        const size = board[0].length
        let surround = 0
        for (let x = startx - depth; x <= startx + depth; x++)
            for (let y = starty - depth; y <= starty + depth; y++)
                if (x >= 0 && x <= size - 1 && y >= 0 && y <= size - 1 && [".", player].includes(board[x][y])) surround++
        return surround
    }
    /** @param {NS} ns
     * @returns {number} */
    function getHeatMap(startx, starty, player = "X", depth = 2) {
        const size = board[0].length
        let count = 1
        for (let x = startx - depth; x <= startx + depth; x++)
            for (let y = starty - depth; y <= starty + depth; y++)
                if (x >= 0 && x <= size - 1 && y >= 0 && y <= size - 1 && [".", player].includes(board[x][y])) count += board[x][y] === player ? 1.5 : board[x][y] === "." ? 1 : 0
        return count
    }
    /** @param {NS} ns
     * @returns {number} */
    function getSurroundLibs(x, y, player) {
        const size = board[0].length
        let surround = 0
        if (x > 0 && (board[x - 1][y] === "." || board[x - 1][y] === player)) surround += board[x - 1][y] === "." ? 1 : validLibMoves[x - 1][y] - 1
        if (x < size - 1 && (board[x + 1][y] === "." || board[x + 1][y] === player)) surround += board[x + 1][y] === "." ? 1 : validLibMoves[x + 1][y] - 1
        if (y > 0 && (board[x][y - 1] === "." || board[x][y - 1] === player)) surround += board[x][y - 1] === "." ? 1 : validLibMoves[x][y - 1] - 1
        if (y < size - 1 && (board[x][y + 1] === "." || board[x][y + 1] === player)) surround += board[x][y + 1] === "." ? 1 : validLibMoves[x][y + 1] - 1
        return surround
    }
    /** @param {NS} ns
     * @returns {number} */
    function getSurroundLibSpread(x, y, player) {
        const size = board[0].length
        let surround = 0
        const checks = new Set
        if (board[x][y] === ".") checks.add(JSON.stringify([x, y]))
        else return 0
        if (x > 0 && board[x - 1][y] === ".") checks.add(JSON.stringify([x - 1, y]))
        if (x < size - 1 && board[x + 1][y] === ".") checks.add(JSON.stringify([x + 1, y]))
        if (y > 0 && board[x][y - 1] === ".") checks.add(JSON.stringify([x, y - 1]))
        if (y < size - 1 && board[x][y + 1] === ".") checks.add(JSON.stringify([x, y + 1]))
        //现在，检查所有 checks 的气数
        for (const check of checks) {
            const [x, y] = JSON.parse(check)
            surround += getSurroundLibs(x, y, player)
        }
        return surround
    }
    /** @param {NS} ns
     * @returns {number} */
    function getSurroundEnemiesFull(x, y) {
        const size = board[0].length
        let surround = 0
        if (x > 0 && board[x - 1][y] === "O") surround += getChainValue(x - 1, y, "O")
        if (x < size - 1 && board[x + 1][y] === "O") surround += getChainValue(x + 1, y, "O")
        if (y > 0 && board[x][y - 1] === "O") surround += getChainValue(x, y - 1, "O")
        if (y < size - 1 && board[x][y + 1] === "O") surround += getChainValue(x, y + 1, "O")

        if (x > 0 && y > 0 && board[x - 1][y - 1] === "O") surround += getChainValue(x - 1, y - 1, "O")
        if (x < size - 1 && y > 0 && board[x + 1][y - 1] === "O") surround += getChainValue(x + 1, y - 1, "O")
        if (y < size - 1 && x > 0 && board[x - 1][y + 1] === "O") surround += getChainValue(x - 1, y - 1, "O")
        if (y < size - 1 && x < size - 1 && board[x + 1][y + 1] === "O") surround += getChainValue(x + 1, y + 1, "O")

        return surround
    }
    /** @param {NS} ns
     * @returns {{coords: number[]; msg: string;}} */
    function getRandomStrat() {
        const moveOptions = []
        const moveOptions2 = []
        const size = board[0].length

        // 遍历棋盘所有点
        let bestRank = 0
        const moves = getAllValidMoves(true)
        for (const [x, y] of moves) {
            if (!["?", "O"].includes(contested[x][y]) || createsLib(x, y, "X")) continue
            let isSupport = ((x > 0 && board[x - 1][y] === "X" && validLibMoves[x - 1][y] >= 1) || (x < size - 1 && board[x + 1][y] === "X" && validLibMoves[x + 1][y] >= 1) || (y > 0 && board[x][y - 1] === "X" && validLibMoves[x][y - 1] >= 1) || (y < size - 1 && board[x][y + 1] === "X" && validLibMoves[x][y + 1] >= 1)) ? true : false
            let isAttack = ((x > 0 && board[x - 1][y] === "O" && validLibMoves[x - 1][y] >= 2) || (x < size - 1 && board[x + 1][y] === "O" && validLibMoves[x + 1][y] >= 2) || (y > 0 && board[x][y - 1] === "O" && validLibMoves[x][y - 1] >= 2) || (y < size - 1 && board[x][y + 1] === "O" && validLibMoves[x][y + 1] >= 2)) ? true : false

            const surround = getSurroundSpace(x, y)
            if (isSupport || isAttack) {
                if (surround > bestRank) {
                    moveOptions.length = 0
                    bestRank = surround
                    moveOptions.push([x, y]);
                }
                else if (surround === bestRank) {
                    moveOptions.push([x, y])
                }
            }
            else {
                moveOptions2.push([x, y])
            }
        }
        // 随机选一个找到的走法
        const randomIndex = Math.floor(Math.random() * moveOptions.length);
        const randomIndex2 = Math.floor(Math.random() * moveOptions2.length);
        return moveOptions[randomIndex] ? {
            coords: moveOptions[randomIndex],
            msg: "Random Safe"
        } : moveOptions2[randomIndex2] ? {
            coords: moveOptions2[randomIndex2],
            msg: "Random Unsafe"
        } : []
    }
    /** @param {NS} ns
     * @returns {{coords: number[]; msg: string;}} */
    function getAggroAttack(libsMin, libsMax, minSurround = 3, minChain = 1, minFreeSpace = 0) {
        const moveOptions = [];
        const size = board[0].length;
        let highestValue = 0
        // 遍历棋盘所有点
        const moves = getAllValidMoves(true)
        for (const [x, y] of moves) {
            if (createsLib(x, y, "X")) continue
            const isAttack = (
                (x > 0 && board[x - 1][y] === "O" && validLibMoves[x - 1][y] >= libsMin && validLibMoves[x - 1][y] <= libsMax) ||
                (x < size - 1 && board[x + 1][y] === "O" && validLibMoves[x + 1][y] >= libsMin && validLibMoves[x + 1][y] <= libsMax) ||
                (y > 0 && board[x][y - 1] === "O" && validLibMoves[x][y - 1] >= libsMin && validLibMoves[x][y - 1] <= libsMax) ||
                (y < size - 1 && board[x][y + 1] === "O" && validLibMoves[x][y + 1] >= libsMin && validLibMoves <= libsMax)) ? true : false
            const surround = getSurroundLibs(x, y, "X")
            const freeSpace = getFreeSpace(x, y)
            if (freeSpace < minFreeSpace) continue
            if (!isAttack || surround < minSurround) continue
            const chainAtk = getChainAttack(x, y)
            if (chainAtk < minChain) continue
            let lowestLibs = 999
            if (x > 0 && board[x - 1][y] === "O" && validLibMoves[x - 1][y] < lowestLibs) lowestLibs = validLibMoves[x - 1][y]
            if (x < size - 1 && board[x + 1][y] === "O" && validLibMoves[x + 1][y] < lowestLibs) lowestLibs = validLibMoves[x + 1][y]
            if (y > 0 && board[x][y - 1] === "O" && validLibMoves[x][y - 1] < lowestLibs) lowestLibs = validLibMoves[x][y - 1]
            if (y < size - 1 && board[x][y + 1] === "O" && validLibMoves[x][y + 1] < lowestLibs) lowestLibs = validLibMoves[x][y + 1]

            const enemyLibs = getSurroundLibSpread(x, y, "O")
            const startEyeValue = getEyeValue(x, y, "O")
            const eyeValue = startEyeValue > 1 ? startEyeValue : 1
            const atk = enemyLibs * chainAtk / eyeValue * getHeatMap(x, y, "O") / lowestLibs
            if (atk > highestValue) {
                highestValue = atk
                moveOptions.length = 0
                moveOptions.push([x, y]);
            }
            else if (atk === highestValue) {
                highestValue = atk
                moveOptions.push([x, y]);
            }
        }
        // 随机选一个找到的走法
        const randomIndex = Math.floor(Math.random() * moveOptions.length)
        return moveOptions[randomIndex] ? {
            coords: moveOptions[randomIndex],
            msg: "Aggro Attack: " + libsMin + "/" + libsMax + "  Surround: " + minSurround
        } : []
    }
    /** @param {NS} ns
     * @returns {{coords: number[]; msg: string;}} */
    function getDefAttack(libsMin, libsMax, minSurround = 3, minChain = 1, minFreeSpace = 0) {
        const moveOptions = [];
        const size = board[0].length;
        let highestValue = 0
        // 遍历棋盘所有点
        const moves = getAllValidMoves(true)
        for (const [x, y] of moves) {
            if (createsLib(x, y, "X")) continue
            const isAttack = (
                (x > 0 && board[x - 1][y] === "O" && validLibMoves[x - 1][y] >= libsMin && validLibMoves[x - 1][y] <= libsMax) ||
                (x < size - 1 && board[x + 1][y] === "O" && validLibMoves[x + 1][y] >= libsMin && validLibMoves[x + 1][y] <= libsMax) ||
                (y > 0 && board[x][y - 1] === "O" && validLibMoves[x][y - 1] >= libsMin && validLibMoves[x][y - 1] <= libsMax) ||
                (y < size - 1 && board[x][y + 1] === "O" && validLibMoves[x][y + 1] >= libsMin && validLibMoves <= libsMax)) ? true : false
            const surround = getSurroundLibs(x, y, "X")
            const freeSpace = getFreeSpace(x, y)
            if (freeSpace < minFreeSpace) continue
            if (!isAttack || surround < minSurround) continue
            const chainAtk = getChainAttack(x, y)
            if (chainAtk < minChain) continue
            let lowestLibs = 999
            if (x > 0 && board[x - 1][y] === "O" && validLibMoves[x - 1][y] < lowestLibs) lowestLibs = validLibMoves[x - 1][y]
            if (x < size - 1 && board[x + 1][y] === "O" && validLibMoves[x + 1][y] < lowestLibs) lowestLibs = validLibMoves[x + 1][y]
            if (y > 0 && board[x][y - 1] === "O" && validLibMoves[x][y - 1] < lowestLibs) lowestLibs = validLibMoves[x][y - 1]
            if (y < size - 1 && board[x][y + 1] === "O" && validLibMoves[x][y + 1] < lowestLibs) lowestLibs = validLibMoves[x][y + 1]

            const friendlyLibs = getSurroundLibs(x, y, "X")
            const startEyeValue = getEyeValue(x, y, "O")
            const eyeValue = startEyeValue > 1 ? startEyeValue : 1

            const atk = friendlyLibs * chainAtk / eyeValue * getHeatMap(x, y, "X") / lowestLibs * (getEyeValue(x, y, "X") + 1)

            if (atk > highestValue) {
                highestValue = atk
                moveOptions.length = 0
                moveOptions.push([x, y]);
            }
            else if (atk === highestValue) {
                highestValue = atk
                moveOptions.push([x, y]);
            }
        }
        // 随机选一个找到的走法
        const randomIndex = Math.floor(Math.random() * moveOptions.length)
        return moveOptions[randomIndex] ? {
            coords: moveOptions[randomIndex],
            msg: "Defensive Attack: " + libsMin + "/" + libsMax + "  Surround: " + minSurround
        } : []
    }
    /** @param {NS} ns
     * @returns {{coords: number[]; msg: string;}} */
    function attackGrowDragon(requiredEyes, killLib = false) {
        const moveOptions = [];
        let highestValue = 0
        // 遍历棋盘所有点
        const moves = getAllValidMoves(true)
        for (const [x, y] of moves) {
            if (contested[x][y] !== "?" || createsLib(x, y, "X")) continue
            const surround = getSurroundEnemiesFull(x, y)
            const myLibs = getSurroundLibs(x, y, "X")
            if (surround < 1 || myLibs < 3) continue
            const enemyLibs = getSurroundLibs(x, y, "O")
            if (enemyLibs === 1 && !killLib) continue
            const enemyChains = getChainAttackFull(x, y)
            const myEyes = getEyeValueFull(x, y, "X")
            if (myEyes < requiredEyes) continue // 或 count === 3 继续
            const result = enemyLibs * enemyChains // surround * enemyLibs * myChains *  /*freeSpace * */ enemyEyes * enemyChains

            if (result > highestValue) {
                highestValue = result
                moveOptions.length = 0
                moveOptions.push([x, y])
            }
            else if (result === highestValue) {
                highestValue = result
                moveOptions.push([x, y])
            }
        }
        // 随机选一个找到的走法
        const randomIndex = Math.floor(Math.random() * moveOptions.length)
        return moveOptions[randomIndex] ? {
            coords: moveOptions[randomIndex],
            msg: "Attack/Grow Dragon: " + requiredEyes
        } : []
    }
    /** @param {NS} ns
     * @returns {{coords: number[]; msg: string;}} */
    function getDefPattern() {
        let def = []
        def.push(...def5)

        const moves = getAllValidMoves()
        for (const [x, y] of moves) {
            for (const pattern of def)
                if (isPattern(x, y, pattern)) {
                    const msg = sprintf("Def Pattern: %s\n%s\n%s", pattern.length, pattern.join("\n"), "---------------")
                    return {
                        coords: [x, y],
                        msg: msg
                    }
                }
        }
        return []
    }
    /** @param {NS} ns
     * @returns {{coords: number[]; msg: string;}} */
    function disruptEyes() {
        let disrupt = []
        disrupt.push(...disrupt4)
        disrupt.push(...disrupt5)

        const moves = getAllValidMoves()
        for (const [x, y] of moves) {
            for (const pattern of disrupt)
                if (isPattern(x, y, pattern)) {
                    const msg = sprintf("Eye Disruption: %s\n%s\n%s", pattern.length, pattern.join("\n"), "---------------")
                    return {
                        coords: [x, y],
                        msg: msg
                    }
                }
        }
        return []
    }
    /** @param {NS} ns
     * @returns {Promise<false | {type:"move"|"pass"|"gameOver"; x:number; y:number;}} */
    async function movePiece(ns, attack) {
        if (attack.coords === undefined) return false
        const [x, y] = attack.coords
        if (x === undefined) return false
        let mid = performance.now()
        ns.printf("%s", attack.msg)
        const results = await go_makeMove(ns, x, y);
        let END = performance.now()
        if (logtime) ns.printf("用时: 我: %s  对手: %s", ns.tFormat(mid - START, true), ns.tFormat(END - mid, true))
        START = performance.now()
        return results
    }
    /** @param {NS} ns
     * @returns {Promise<false | {type:"move"|"pass"|"gameOver"; x:number; y:number;}} */
    async function moveSnakeEyes(ns, attack) {
        if (attack.coords === undefined || !cheats) return false
        const [s1x, s1y, s2x, s2y] = attack.coords
        if (s1x === undefined) return false
        const chance = await go_cheat_getCheatSuccessChance(ns);
        if (chance < cheatChanceThreshold) return false
        try {
            let mid = performance.now()
            const results = await go_cheat_playTwoMoves(ns, s1x, s1y, s2x, s2y)
            ns.printf("%s  概率: %.2f%%  结果: %s", attack.msg, chance * 100, results.type);
            let END = performance.now()
            if (logtime) ns.printf("用时: 我: %s  对手: %s", ns.tFormat(mid - START, true), ns.tFormat(END - mid, true))
            START = performance.now()
            return results
        }
        catch { return false }
    }
    function getAllValidMoves(notMine = false) {
        if (currentValidMovesTurn === turn) return notMine ? currentValidContestedMoves : currentValidMoves
        let moves = []
        let contestedMoves = []
        for (let x = 0; x < board[0].length; x++)
            for (let y = 0; y < board[0].length; y++) {
                if (validMove[x][y]) {
                    if (["O", "?"].includes(contested[x][y])) contestedMoves.push([x, y])
                    moves.push([x, y])
                }
            }

        //Moves 随机排序
        moves = moves.sort(() => Math.random() - Math.random())
        contestedMoves = contestedMoves.sort(() => Math.random() - Math.random())
        currentValidMoves = moves
        currentValidContestedMoves = contestedMoves
        currentValidMovesTurn = turn
        return notMine ? currentValidContestedMoves : currentValidMoves
    }
    function createsLib(x, y, player) {
        const size = board[0].length

        if (x > 0 && board[x - 1][y] === player && validLibMoves[x - 1][y] > 2) return false
        if (x < size - 1 && board[x + 1][y] === player && validLibMoves[x + 1][y] > 2) return false
        if (y > 0 && board[x][y - 1] === player && validLibMoves[x][y - 1] > 2) return false
        if (y < size - 1 && board[x][y + 1] === player && validLibMoves[x][y + 1] > 2) return false

        if (x > 0 && board[x - 1][y] === player && validLibMoves[x - 1][y] === 2) return true
        if (x < size - 1 && board[x + 1][y] === player && validLibMoves[x + 1][y] === 2) return true
        if (y > 0 && board[x][y - 1] === player && validLibMoves[x][y - 1] === 2) return true
        if (y < size - 1 && board[x][y + 1] === player && validLibMoves[x][y + 1] === 2) return true

        return false
    }
    /** @returns {{coords: number[];msg: string;}} */
    function getOpeningMove() {
        const size = board[0].length
        switch (size) {
            case 13:
                if (getSurroundSpace(2, 2) === 4 && validMove[2][2]) return ({
                    coords: [2, 2],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(2, 10) === 4 && validMove[2][10]) return ({
                    coords: [2, 10],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(10, 10) === 4 && validMove[10][10]) return ({
                    coords: [10, 10],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(10, 2) === 4 && validMove[10][2]) return ({
                    coords: [10, 2],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(3, 3) === 4 && validMove[3][3]) return ({
                    coords: [3, 3],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(3, 9) === 4 && validMove[3][9]) return ({
                    coords: [3, 9],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(9, 9) === 4 && validMove[9][9]) return ({
                    coords: [9, 9],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(9, 3) === 4 && validMove[9][3]) return ({
                    coords: [9, 3],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(4, 4) === 4 && validMove[4][4]) return ({
                    coords: [4, 4],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(4, 8) === 4 && validMove[4][8]) return ({
                    coords: [4, 8],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(8, 8) === 4 && validMove[8][8]) return ({
                    coords: [8, 8],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(8, 4) === 4 && validMove[8][4]) return ({
                    coords: [8, 4],
                    msg: "Opening Move: " + turn
                })
                else return getRandomStrat()
            case 9:
                if (getSurroundSpace(2, 2) === 4 && validMove[2][2]) return ({
                    coords: [2, 2],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(2, 6) === 4 && validMove[2][6]) return ({
                    coords: [2, 6],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(6, 6) === 4 && validMove[6][6]) return ({
                    coords: [6, 6],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(6, 2) === 4 && validMove[6][2]) return ({
                    coords: [6, 2],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(3, 3) === 4 && validMove[3][3]) return ({
                    coords: [3, 3],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(3, 5) === 4 && validMove[3][5]) return ({
                    coords: [3, 5],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(5, 5) === 4 && validMove[5][5]) return ({
                    coords: [5, 5],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(5, 3) === 4 && validMove[5][3]) return ({
                    coords: [5, 3],
                    msg: "Opening Move: " + turn
                })
                else return getRandomStrat()
            case 7:
                if (getSurroundSpace(2, 2) === 4 && validMove[2][2]) return ({
                    coords: [2, 2],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(2, 4) === 4 && validMove[2][4]) return ({
                    coords: [2, 4],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(4, 4) === 4 && validMove[4][4]) return ({
                    coords: [4, 4],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(4, 2) === 4 && validMove[4][2]) return ({
                    coords: [4, 2],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(3, 3) === 4 && validMove[3][3]) return ({
                    coords: [3, 3],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(1, 1) === 4 && validMove[1][1]) return ({
                    coords: [1, 1],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(5, 1) === 4 && validMove[5][1]) return ({
                    coords: [5, 1],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(5, 5) === 4 && validMove[5][5]) return ({
                    coords: [5, 5],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(1, 5) === 4 && validMove[1][5]) return ({
                    coords: [1, 5],
                    msg: "Opening Move: " + turn
                })
                else return getRandomStrat()
            case 5:
                if (getSurroundSpace(2, 2) === 4 && validMove[2][2]) return ({
                    coords: [2, 2],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(3, 3) === 4 && validMove[3][3]) return ({
                    coords: [3, 3],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(3, 1) === 4 && validMove[3][1]) return ({
                    coords: [3, 1],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(1, 3) === 4 && validMove[1][3]) return ({
                    coords: [1, 3],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(1, 1) === 4 && validMove[1][1]) return ({
                    coords: [1, 1],
                    msg: "Opening Move: " + turn
                })
                else return getRandomStrat()
            case 19:
                if (getSurroundSpace(9, 9) === 4 && validMove[9][9]) return ({
                    coords: [9, 9],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(2, 2) === 4 && validMove[2][2]) return ({
                    coords: [2, 2],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(16, 2) === 4 && validMove[16][2]) return ({
                    coords: [16, 2],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(2, 16) === 4 && validMove[2][16]) return ({
                    coords: [2, 16],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(16, 16) === 4 && validMove[16][16]) return ({
                    coords: [16, 16],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(3, 3) === 4 && validMove[3][3]) return ({
                    coords: [3, 3],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(3, 15) === 4 && validMove[3][15]) return ({
                    coords: [3, 15],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(15, 15) === 4 && validMove[15][15]) return ({
                    coords: [15, 15],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(15, 3) === 4 && validMove[15][3]) return ({
                    coords: [15, 3],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(4, 4) === 4 && validMove[4][4]) return ({
                    coords: [4, 4],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(4, 14) === 4 && validMove[4][14]) return ({
                    coords: [4, 14],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(14, 14) === 4 && validMove[14][14]) return ({
                    coords: [14, 14],
                    msg: "Opening Move: " + turn
                })
                else if (getSurroundSpace(14, 4) === 4 && validMove[14][4]) return ({
                    coords: [14, 4],
                    msg: "Opening Move: " + turn
                })
                else return getRandomStrat()
        }
    }
}