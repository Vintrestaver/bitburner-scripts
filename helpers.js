/**
 * 返回使用比例符号格式化的货币金额（例如 $6.50M）
 * @param {number} num - 要格式化的数字
 * @param {number=} maxSignificantFigures - （默认值：6）希望显示的最大有效数字（例如 123、12.3 和 1.23 都有 3 位有效数字）
 * @param {number=} maxDecimalPlaces - （默认值：3）希望显示的最大小数位数，无论有效数字如何。（例如 12.3、1.2、0.1 都有 1 位小数）
 **/
export function formatMoney(num, maxSignificantFigures = 6, maxDecimalPlaces = 3) {
    let numberShort = formatNumberShort(num, maxSignificantFigures, maxDecimalPlaces);
    return num >= 0 ? "$" + numberShort : numberShort.replace("-", "-$");
}

const symbols = ["", "k", "m", "b", "t", "q", "Q", "s", "S", "o", "n", "e33", "e36", "e39"];

/**
 * 返回使用比例符号格式化的数字（例如 6.50M）
 * @param {number} num - 要格式化的数字
 * @param {number=} maxSignificantFigures - （默认值：6）希望显示的最大有效数字（例如 123、12.3 和 1.23 都有 3 位有效数字）
 * @param {number=} maxDecimalPlaces - （默认值：3）希望显示的最大小数位数，无论有效数字如何。（例如 12.3、1.2、0.1 都有 1 位小数）
 **/
export function formatNumberShort(num, maxSignificantFigures = 6, maxDecimalPlaces = 3) {
    if (Math.abs(num) > 10 ** (3 * symbols.length)) // 如果超过了最大符号，切换到指数表示法
        return num.toExponential(Math.min(maxDecimalPlaces, maxSignificantFigures - 1));
    for (var i = 0, sign = Math.sign(num), num = Math.abs(num); num >= 1000 && i < symbols.length; i++) num /= 1000;
    // TODO: 像 9.999 这样的数字，四舍五入后显示 3 位有效数字，会变成 10.00，现在有 4 位有效数字。
    return ((sign < 0) ? "-" : "") + num.toFixed(Math.max(0, Math.min(maxDecimalPlaces, maxSignificantFigures - Math.floor(1 + Math.log10(num))))) + symbols[i];
}

/** 将缩写的数字转换回原始值 */
export function parseShortNumber(text = "0") {
    let parsed = Number(text);
    if (!isNaN(parsed)) return parsed;
    for (const sym of symbols.slice(1))
        if (text.toLowerCase().endsWith(sym))
            return Number.parseFloat(text.slice(0, text.length - sym.length)) * Math.pow(10, 3 * symbols.indexOf(sym));
    return Number.NaN;
}

/**
 * 返回使用指定有效数字或小数位数格式化的数字，以更严格的为准。
 * @param {number} num - 要格式化的数字
 * @param {number=} minSignificantFigures - （默认值：6）希望显示的最小有效数字（例如 123、12.3 和 1.23 都有 3 位有效数字）
 * @param {number=} minDecimalPlaces - （默认值：3）希望显示的最小小数位数，无论有效数字如何。（例如 12.3、1.2、0.1 都有 1 位小数）
 **/
export function formatNumber(num, minSignificantFigures = 3, minDecimalPlaces = 1) {
    return num == 0.0 ? "0" : num.toFixed(Math.max(minDecimalPlaces, Math.max(0, minSignificantFigures - Math.ceil(Math.log10(num)))));
}

const memorySuffixes = ["GB", "TB", "PB", "EB"];

/** 将一些 RAM 量格式化为 GB/TB/PB/EB 的整数，并带有千位分隔符，例如 `1.028 TB` */
export function formatRam(num, printGB) {
    if (printGB) {
        return `${Math.round(num).toLocaleString('en')} GB`;
    }
    let idx = Math.floor(Math.log10(num) / 3) || 0;
    if (idx >= memorySuffixes.length) {
        idx = memorySuffixes.length - 1;
    } else if (idx < 0) {
        idx = 0;
    }
    const scaled = num / 1000 ** idx; // 将数字缩放到所选的数量级
    // 只有在有小数位时才显示
    const formatted = scaled - Math.round(scaled) == 0 ? Math.round(scaled) : formatNumber(num / 1000 ** idx);
    return formatted.toLocaleString('en') + " " + memorySuffixes[idx];
}

/** 返回 ISO 格式的日期时间 */
export function formatDateTime(datetime) { return datetime.toISOString(); }

/** 将持续时间（以毫秒为单位）格式化为例如 '1h 21m 6s' 对于大持续时间，或例如 '12.5s' / '23ms' 对于小持续时间 */
export function formatDuration(duration) {
    if (duration < 1000) return `${duration.toFixed(0)}ms`
    if (!isFinite(duration)) return 'forever (Infinity)'
    const portions = [];
    const msInHour = 1000 * 60 * 60;
    const hours = Math.trunc(duration / msInHour);
    if (hours > 0) {
        portions.push(hours + 'h');
        duration -= (hours * msInHour);
    }
    const msInMinute = 1000 * 60;
    const minutes = Math.trunc(duration / msInMinute);
    if (minutes > 0) {
        portions.push(minutes + 'm');
        duration -= (minutes * msInMinute);
    }
    let seconds = (duration / 1000.0)
    // 如果我们在秒的数量级上，包括毫秒精度
    seconds = (hours == 0 && minutes == 0) ? seconds.toPrecision(3) : seconds.toFixed(0);
    if (seconds > 0) {
        portions.push(seconds + 's');
        duration -= (minutes * 1000);
    }
    return portions.join(' ');
}

/** 为字符串生成一个相当唯一的 hashCode */
export function hashCode(s) { return s.split("").reduce(function (a, b) { a = ((a << 5) - a) + b.charCodeAt(0); return a & a }, 0); }

/** @param {NS} ns **/
export function disableLogs(ns, listOfLogs) { ['disableLog'].concat(...listOfLogs).forEach(log => checkNsInstance(ns, '"disableLogs"').disableLog(log)); }

/** 将所有参数作为路径组件连接起来，例如 pathJoin("foo", "bar", "/baz") = "foo/bar/baz" **/
export function pathJoin(...args) {
    return args.filter(s => !!s).join('/').replace(/\/\/+/g, '/');
}

/** 获取给定本地文件的路径，考虑到通过 git-pull.js 的可选子文件夹重定位 **/
export function getFilePath(file) {
    const subfolder = '';  // git-pull.js 在下载时可选地修改此值
    return pathJoin(subfolder, file);
}

// 提供昂贵 NS 函数替代实现的函数
// NS.RUN 的变体

/** @param {NS} ns
 *  在需要运行脚本的函数中使用，并且您已经在脚本中引用了 ns.run **/
export function getFnRunViaNsRun(ns) { return checkNsInstance(ns, '"getFnRunViaNsRun"').run; }

/** @param {NS} ns
 *  在需要运行脚本的函数中使用，并且您已经在脚本中引用了 ns.exec **/
export function getFnRunViaNsExec(ns, host = "home") {
    checkNsInstance(ns, '"getFnRunViaNsExec"');
    return function (scriptPath, ...args) { return ns.exec(scriptPath, host, ...args); }
}
// NS.ISRUNNING 的变体

/** @param {NS} ns
 *  在需要运行脚本的函数中使用，并且您已经在脚本中引用了 ns.run **/
export function getFnIsAliveViaNsIsRunning(ns) { return checkNsInstance(ns, '"getFnIsAliveViaNsIsRunning"').isRunning; }

/** @param {NS} ns
 *  在需要运行脚本的函数中使用，并且您已经在脚本中引用了 ns.ps **/
export function getFnIsAliveViaNsPs(ns) {
    checkNsInstance(ns, '"getFnIsAliveViaNsPs"');
    return function (pid, host) { return ns.ps(host).some(process => process.pid === pid); }
}

/**
 * 通过在一个临时的 .js 脚本中执行 ns 命令来检索结果，将结果写入文件，然后关闭它
 * 导入会消耗 1.0 GB RAM（使用 ns.run），但如果您已经在脚本中为其他目的使用了 ns.exec，
 * 您可以调用 getNsDataThroughFile_Custom，并将 fnRun 设置为 `getFnRunViaNsExec(ns)` 的结果，这样不会产生额外的 RAM 消耗。
 * 如果失败（例如由于 RAM 不足），可以重试。不建议用于性能关键的代码。
 * @param {NS} ns 传递给脚本主入口点的 nestcript 实例
 * @param {string} command 应该调用的 ns 命令以获取所需数据（例如 "ns.getServer('home')"）
 * @param {string?} fName （默认值："/Temp/{command-name}.txt"）临时进程将数据写入磁盘的文件名
 * @param {any[]?} args 作为新脚本参数传递给命令的参数。
 * @param {boolean?} verbose （默认值：false）如果设置为 true，命令的 pid 和结果将被记录。
 * TODO: 切换到 args 对象，这变得太复杂了
 **/
export async function getNsDataThroughFile(ns, command, fName = null, args = [], verbose = false, maxRetries = 5, retryDelayMs = 50, silent = false) {
    checkNsInstance(ns, '"getNsDataThroughFile"');
    if (!verbose) disableLogs(ns, ['run', 'isRunning']);
    return await getNsDataThroughFile_Custom(ns, ns.run, command, fName, args, verbose, maxRetries, retryDelayMs, silent);
}

/** 将命令名称如 "ns.namespace.someFunction(args, args)" 转换为
 * 运行该命令的默认文件路径 "/Temp/namespace-someFunction.txt" */
function getDefaultCommandFileName(command, ext = '.txt') {
    // 如果以 "ns." 开头，去掉它
    let fname = command;
    if (fname.startsWith("await ")) fname = fname.slice(6);
    if (fname.startsWith("ns.")) fname = fname.slice(3);
    // 删除括号之间的任何内容
    fname = fname.replace(/ *\([^)]*\) */g, "");
    // 将任何解引用（点）替换为破折号
    fname = fname.replace(".", "-");
    return `/Temp/${fname}${ext}`
}

/**
 * getNsDataThroughFile 的高级版本，允许您传递自己的 "fnRun" 实现以减少 RAM 消耗
 * 导入不会消耗 RAM（现在 ns.read 是免费的），加上您提供的 fnRun 的消耗。
 * 如果失败（例如由于 RAM 不足），可以重试。不建议用于性能关键的代码。
 * @param {NS} ns 传递给脚本主入口点的 nestcript 实例
 * @param {function} fnRun 用于启动新脚本的单参数函数，例如 `ns.run` 或 `(f,...args) => ns.exec(f, "home", ...args)`
 * @param {string} command 应该调用的 ns 命令以获取所需数据（例如 "ns.getServer('home')"）
 * @param {string?} fName （默认值："/Temp/{command-name}.txt"）临时进程将数据写入磁盘的文件名
 * @param {any[]?} args 作为新脚本参数传递给命令的参数。
 * @param {boolean?} verbose （默认值：false）如果设置为 true，命令的 pid 和结果将被记录。
 **/
export async function getNsDataThroughFile_Custom(ns, fnRun, command, fName = null, args = [], verbose = false, maxRetries = 5, retryDelayMs = 50, silent = false) {
    checkNsInstance(ns, '"getNsDataThroughFile_Custom"');
    // 如果任何参数被跳过（通过传递 null 或 undefined），将它们设置为默认值
    if (args == null) args = []; if (verbose == null) verbose = false;
    if (maxRetries == null) maxRetries = 5; if (retryDelayMs == null) retryDelayMs = 50; if (silent == null) silent = false;
    if (!verbose) disableLogs(ns, ['read']);
    fName = fName || getDefaultCommandFileName(command);
    const fNameCommand = fName + '.js'
    // 预先写入文件内容，以便我们可以检测到临时脚本是否从未运行
    const initialContents = "<Insufficient RAM>";
    ns.write(fName, initialContents, 'w');
    // TODO: 针对 v2.3.0 弃用的变通方法。当警告消失时删除。
    // 避免序列化 ns.getPlayer() 属性，这些属性会生成警告
    if (command === "ns.getPlayer()")
        command = `( ()=> { let player = ns.getPlayer();
            const excludeProperties = ['playtimeSinceLastAug', 'playtimeSinceLastBitnode', 'bitNodeN'];
            return Object.keys(player).reduce((pCopy, key) => {
                if (!excludeProperties.includes(key))
                   pCopy[key] = player[key];
                return pCopy;
            }, {});
        })()`;

    // 准备一个命令，将命令的结果写入新文件
    // 除非它已经存在并且内容相同（节省时间/内存，先检查）
    // 如果发生错误，它将写入一个空文件以避免读取旧结果。
    const commandToFile = `let r;try{r=JSON.stringify(\n` +
        `    ${command}\n` +
        `, jsonReplacer);}catch(e){r="ERROR: "+(typeof e=='string'?e:e?.message??JSON.stringify(e));}\n` +
        `const f="${fName}"; if(ns.read(f)!==r) ns.write(f,r,'w')`;
    // 运行命令，如果失败则自动重试
    const pid = await runCommand_Custom(ns, fnRun, commandToFile, fNameCommand, args, verbose, maxRetries, retryDelayMs, silent);
    // 等待进程完成。注意，只要上面返回了 pid，我们实际上不必检查它，只需检查文件内容
    const fnIsAlive = (ignored_pid) => ns.read(fName) === initialContents;
    await waitForProcessToComplete_Custom(ns, fnIsAlive, pid, verbose);
    if (verbose) log(ns, `Process ${pid} is done. Reading the contents of ${fName}...`);
    // 读取文件，如果失败则自动重试 // TODO: 不确定读取文件是否会失败或需要重试。
    let lastRead;
    const fileData = await autoRetry(ns, () => ns.read(fName),
        f => (lastRead = f) !== undefined && f !== "" && f !== initialContents && !(typeof f == "string" && f.startsWith("ERROR: ")),
        () => `\nns.read('${fName}') returned a bad result: "${lastRead}".` +
            `\n  Script:  ${fNameCommand}\n  Args:    ${JSON.stringify(args)}\n  Command: ${command}` +
            (lastRead == undefined ? '\nThe developer has no idea how this could have happened. Please post a screenshot of this error on discord.' :
                lastRead == initialContents ? `\nThe script that ran this will likely recover and try again later once you have more free ram.` :
                    lastRead == "" ? `\nThe file appears to have been deleted before a result could be retrieved. Perhaps there is a conflicting script.` :
                        lastRead.includes('API ACCESS ERROR') ? `\nThis script should not have been run until you have the required Source-File upgrades. Sorry about that.` :
                            `\nThe script was likely passed invalid arguments. Please post a screenshot of this error on discord.`),
        maxRetries, retryDelayMs, undefined, verbose, verbose, silent);
    if (verbose) log(ns, `Read the following data for command ${command}:\n${fileData}`);
    return JSON.parse(fileData, jsonReviver); // 将其反序列化为对象/数组并返回
}

/** 允许我们序列化 JSON.serialize 通常不支持的类型 */
export function jsonReplacer(key, val) {
    if (val === Infinity)
        return { $type: 'number', $value: 'Infinity' };
    if (val === -Infinity)
        return { $type: 'number', $value: '-Infinity' };
    if (Number.isNaN(val))
        return { $type: 'number', $value: 'NaN' };
    if (typeof val === 'bigint')
        return { $type: 'bigint', $value: val.toString() };
    if (val instanceof Map)
        return { $type: 'Map', $value: [...val] };
    if (val instanceof Set)
        return { $type: 'Set', $value: [...val] };
    return val;
}

/** 允许我们反序列化由上述 jsonReplacer 创建的特殊值 */
export function jsonReviver(key, val) {
    if (val == null || typeof val !== 'object' || val.$type == null)
        return val;
    if (val.$type == 'number')
        return Number.parseFloat(val.$value);
    if (val.$type == 'bigint')
        return BigInt(val.$value);
    if (val.$type === 'Map')
        return new Map(val.$value);
    if (val.$type === 'Set')
        return new Set(val.$value);
    return val;
}

/** 通过将 ns 命令写入新脚本并运行或执行它来评估任意 ns 命令。
 * @param {NS} ns 传递给脚本主入口点的 nestcript 实例
 * @param {string} command 应该调用的 ns 命令以获取所需数据（例如 "ns.getServer('home')"）
 * @param {string?} fileName （默认值："/Temp/{command-name}.txt"）临时进程将数据写入磁盘的文件名
 * @param {any[]?} args 作为新脚本参数传递给命令的参数。
 * @param {boolean?} verbose （默认值：false）如果设置为 true，命令的评估结果将打印到终端
 */
export async function runCommand(ns, command, fileName, args = [], verbose = false, maxRetries = 5, retryDelayMs = 50, silent = false) {
    checkNsInstance(ns, '"runCommand"');
    if (!verbose) disableLogs(ns, ['run']);
    return await runCommand_Custom(ns, ns.run, command, fileName, args, verbose, maxRetries, retryDelayMs, silent);
}

const _cachedExports = []; // helpers.js 导出的函数的缓存列表。只要我们没有主动编辑它，应该没问题。
/** @param {NS} ns 传递给脚本主入口点的 nestcript 实例
 * @returns {string[]} 此文件导出的所有函数名称的集合。 */
function getExports(ns) {
    if (_cachedExports.length > 0) return _cachedExports;
    const scriptHelpersRows = ns.read(getFilePath('helpers.js')).split("\n");
    for (const row of scriptHelpersRows) {
        if (!row.startsWith("export")) continue;
        const funcNameStart = row.indexOf("function") + "function".length + 1;
        const funcNameEnd = row.indexOf("(", funcNameStart);
        _cachedExports.push(row.substring(funcNameStart, funcNameEnd));
    }
    return _cachedExports;
}

/**
 * runCommand 的高级版本，允许您传递自己的 "isAlive" 测试以减少 RAM 消耗（例如避免引用 ns.isRunning）
 * 导入不会消耗 RAM（假设 fnRun、fnWrite 是使用您已经在其他地方引用的另一个 ns 函数实现的，如 ns.exec）
 * @param {NS} ns 传递给脚本主入口点的 nestcript 实例
 * @param {function} fnRun 用于启动新脚本的单参数函数，例如 `ns.run` 或 `(f,...args) => ns.exec(f, "home", ...args)`
 * @param {string} command 应该调用的 ns 命令以获取所需数据（例如 "ns.getServer('home')"）
 * @param {string?} fileName （默认值："/Temp/{commandhash}-data.txt"）临时进程将数据写入磁盘的文件名
 * @param {any[]?} args 作为新脚本参数传递给命令的参数。
 **/
export async function runCommand_Custom(ns, fnRun, command, fileName, args = [], verbose = false, maxRetries = 5, retryDelayMs = 50, silent = false) {
    checkNsInstance(ns, '"runCommand_Custom"');
    if (!Array.isArray(args)) throw new Error(`args specified were a ${typeof args}, but an array is required.`);
    if (!verbose) disableLogs(ns, ['sleep']);
    // 自动导入临时脚本尝试使用的任何 helpers
    let importFunctions = getExports(ns).filter(e => command.includes(`${e}`)) // 检查脚本是否包含任何函数的名称
        // 为了避免误报，将这些缩小为“整个单词”匹配（两侧没有字母字符）
        .filter(e => new RegExp(`(^|[^\\w])${e}([^\\w]|\$)`).test(command));
    let script = (importFunctions.length > 0 ? `import { ${importFunctions.join(", ")} } from 'helpers.js'\n` : '') +
        `export async function main(ns) { ${command} }`;
    fileName = fileName || getDefaultCommandFileName(command, '.js');
    if (verbose)
        log(ns, `INFO: Using a temporary script (${fileName}) to execute the command:` +
            `\n  ${command}\nWith the following arguments:    ${JSON.stringify(args)}`);
    // 文件可能在尝试执行时被删除，因此即使写入文件也要包装在重试中
    return await autoRetry(ns, async () => {
        // 为了提高性能，如果临时脚本已经存在并且内容正确，不要重新写入。
        const oldContents = ns.read(fileName);
        if (oldContents != script) {
            if (oldContents) // 如果临时脚本以相同名称创建但内容不同，生成一些噪音
                ns.tprint(`WARNING: Had to overwrite temp script ${fileName}\nOld Contents:\n${oldContents}\nNew Contents:\n${script}` +
                    `\nThis warning is generated as part of an effort to switch over to using only 'immutable' temp scripts. ` +
                    `Please paste a screenshot in Discord at https://discord.com/channels/415207508303544321/935667531111342200`);
            ns.write(fileName, script, "w");
            // 等待脚本出现并可读（游戏在完成写入时可能会有些问题）
            await autoRetry(ns, () => ns.read(fileName), c => c == script, () => `Temporary script ${fileName} is not available, ` +
                `despite having written it. (Did a competing process delete or overwrite it?)`, maxRetries, retryDelayMs, undefined, verbose, verbose, silent);
        }
        // 新功能！我们可以将 "RunOptions" 作为中间参数注入（而不是整数线程数）
        // 运行脚本，现在我们确定它已经就位
        return fnRun(fileName, { temporary: true }, ...args);
    }, pid => pid !== 0,
        async () => {
            if (silent) return `(silent = true)`; // 在静默模式下不需要原因，所有消息都应该被抑制
            let reason = " (likely due to insufficient RAM)";
            // 为了更加明确 - 尝试找出此脚本需要多少 RAM 与我们可用的 RAM
            try {
                const reqRam = await getNsDataThroughFile_Custom(ns, fnRun, 'ns.getScriptRam(ns.args[0])', null, [fileName], false, 1, 0, true);
                const homeMaxRam = await getNsDataThroughFile_Custom(ns, fnRun, 'ns.getServerMaxRam(ns.args[0])', null, ["home"], false, 1, 0, true);
                const homeUsedRam = await getNsDataThroughFile_Custom(ns, fnRun, 'ns.getServerUsedRam(ns.args[0])', null, ["home"], false, 1, 0, true);
                if (reqRam > homeMaxRam)
                    reason = ` as it requires ${formatRam(reqRam)} RAM, but home only has ${formatRam(homeMaxRam)}`;
                else if (reqRam > homeMaxRam - homeUsedRam)
                    reason = ` as it requires ${formatRam(reqRam)} RAM, but home only has ${formatRam(homeMaxRam - homeUsedRam)} of ${formatRam(homeMaxRam)} free.`;
                else
                    reason = `, but the reason is unclear. (Perhaps a syntax error?) This script requires ${formatRam(reqRam)} RAM, and ` +
                        `home has ${formatRam(homeMaxRam - homeUsedRam)} of ${formatRam(homeMaxRam)} free, which appears to be sufficient. ` +
                        `If you wish to troubleshoot, you can try manually running the script with the arguments listed below:`;
            } catch (ex) { /* 值得一试。坚持使用通用错误消息。 */ }
            return `The temp script was not run${reason}.` +
                `\n  Script:  ${fileName}\n  Args:    ${JSON.stringify(args)}\n  Command: ${command}` +
                `\nThe script that ran this will likely recover and try again later.`
        },
        maxRetries, retryDelayMs, undefined, verbose, verbose, silent);
}

/**
 * 等待进程 id 完成运行
 * 导入最多消耗 0.1 GB RAM（用于 ns.isRunning）
 * @param {NS} ns 传递给脚本主入口点的 nestcript 实例
 * @param {number} pid 要监视的进程 id
 * @param {boolean?} verbose （默认值：false）如果设置为 true，pid 和命令的结果将被记录。 **/
export async function waitForProcessToComplete(ns, pid, verbose = false) {
    checkNsInstance(ns, '"waitForProcessToComplete"');
    if (!verbose) disableLogs(ns, ['isRunning']);
    return await waitForProcessToComplete_Custom(ns, ns.isRunning, pid, verbose);
}
/**
 * waitForProcessToComplete 的高级版本，允许您传递自己的 "isAlive" 测试以减少 RAM 消耗（例如避免引用 ns.isRunning）
 * 导入不会消耗 RAM（假设 fnIsAlive 是使用您已经在其他地方引用的另一个 ns 函数实现的，如 ns.ps）
 * @param {NS} ns 传递给脚本主入口点的 nestcript 实例
 * @param {(pid: number) => Promise<boolean>} fnIsAlive 用于启动新脚本的单参数函数，例如 `ns.isRunning` 或 `pid => ns.ps("home").some(process => process.pid === pid)`
 * @param {number} pid 要监视的进程 id
 * @param {boolean?} verbose （默认值：false）如果设置为 true，pid 和命令的结果将被记录。 **/
export async function waitForProcessToComplete_Custom(ns, fnIsAlive, pid, verbose = false) {
    checkNsInstance(ns, '"waitForProcessToComplete_Custom"');
    if (!verbose) disableLogs(ns, ['sleep']);
    // 等待 PID 停止运行（比例如删除（rm）可能预先存在的文件并等待它重新创建更便宜）
    let start = Date.now();
    let sleepMs = 1;
    let done = false;
    for (var retries = 0; retries < 1000; retries++) {
        if (!(await fnIsAlive(pid))) {
            done = true;
            break; // 脚本已完成运行
        }
        if (verbose && retries % 100 === 0) ns.print(`Waiting for pid ${pid} to complete... (${formatDuration(Date.now() - start)})`);
        await ns.sleep(sleepMs); // TODO: 如果我们可以切换到 `await nextPortWrite(pid)` 来通知临时脚本完成，它会返回得更快。
        sleepMs = Math.min(sleepMs * 2, 200);
    }
    // 确保进程已关闭，而不仅仅是我们停止了重试
    if (!done) {
        let errorMessage = `run-command pid ${pid} is running much longer than expected. Max retries exceeded.`;
        ns.print(errorMessage);
        throw new Error(errorMessage);
    }
}

/** 如果参数是 Error 实例，则按原样返回，否则返回一个新的 Error 实例。 */
function asError(error) {
    return error instanceof Error ? error :
        new Error(typeof error === 'string' ? error :
            JSON.stringify(error, jsonReplacer)); // TODO: jsonReplacer 以支持 ScriptDeath 对象和其他自定义 Bitburner 抛出
}

/** 帮助重试某些暂时失败的操作（例如当我们暂时没有足够的 RAM 来运行时）
 * @param {NS} ns 传递给脚本主入口点的 nestcript 实例 */
export async function autoRetry(ns, fnFunctionThatMayFail, fnSuccessCondition, errorContext = "Success condition not met",
    maxRetries = 5, initialRetryDelayMs = 50, backoffRate = 3, verbose = false, tprintFatalErrors = true, silent = false) {
    // 如果任何参数被跳过（通过传递 null 或 undefined），将它们设置为默认值
    if (errorContext == null) errorContext = "Success condition not met";
    if (maxRetries == null) maxRetries = 5; if (initialRetryDelayMs == null) initialRetryDelayMs = 50; if (backoffRate == null) backoffRate = 3;
    if (verbose == null) verbose = false; if (tprintFatalErrors == null) tprintFatalErrors = true; if (silent == null) silent = false;
    checkNsInstance(ns, '"autoRetry"');
    let retryDelayMs = initialRetryDelayMs, attempts = 0;
    let sucessConditionMet;
    while (attempts++ <= maxRetries) {
        // 在尝试之间休眠
        if (attempts > 1) {
            await ns.sleep(retryDelayMs);
            retryDelayMs *= backoffRate;
        }
        try {
            sucessConditionMet = true;
            const result = await fnFunctionThatMayFail()
            // 检查这是否被视为成功的结果
            sucessConditionMet = fnSuccessCondition(result);
            if (sucessConditionMet instanceof Promise)
                sucessConditionMet = await sucessConditionMet; // 如果 fnSuccessCondition 是异步的，等待其结果
            if (!sucessConditionMet) {
                // 如果我们还没有达到最大重试次数，可以继续，而不抛出
                if (attempts < maxRetries) {
                    if (!silent) log(ns, `INFO: Attempt ${attempts} of ${maxRetries} failed. Trying again in ${retryDelayMs}ms...`, false, !verbose ? undefined : 'info');
                    continue;
                }
                // 否则，使用 errorContext 字符串或函数参数提供的消息抛出错误
                let errorMessage = typeof errorContext === 'string' ? errorContext : errorContext(result);
                if (errorMessage instanceof Promise)
                    errorMessage = await errorMessage; // 如果 errorContext 函数是异步的，等待其结果
                throw asError(errorMessage);
            }
            return result;
        }
        catch (error) {
            const fatal = attempts >= maxRetries;
            if (!silent) log(ns, `${fatal ? 'FAIL' : 'INFO'}: Attempt ${attempts} of ${maxRetries} raised an error` +
                (fatal ? `: ${getErrorInfo(error)}` : `. Trying again in ${retryDelayMs}ms...`),
                tprintFatalErrors && fatal, !verbose ? undefined : (fatal ? 'error' : 'info'))
            if (fatal) throw asError(error);
        }
    }
    throw new Error("Unexpected return from autoRetry");
}

/** 帮助从游戏抛出的错误中提取错误消息。
 * @param {Error|string} err 抛出的错误消息或对象
*/
export function getErrorInfo(err) {
    if (err === undefined || err == null) return "(null error)"; // 没有捕获到任何内容
    if (typeof err === 'string') return err; // 抛出了简单的字符串
    let strErr = null;
    // 如果可用，在下面添加堆栈跟踪
    if (err instanceof Error) {
        if (err.stack) // 堆栈对于调试问题最有用。（从堆栈中删除 bitburner 源代码。）
            strErr = '  ' + err.stack.split('\n').filter(s => !s.includes('bitburner-official'))
                .join('\n    '); // 在这里，缩进堆栈跟踪以帮助将其与其余部分区分开来。
        if (err.cause) // 一些错误有一个嵌套的 "cause" 错误对象 - 递归！
            strErr = (strErr ? strErr + '\n' : '') + getErrorInfo(err.cause);
    }
    // 获取此对象的默认字符串表示形式
    let defaultToString = err.toString === undefined ? null : err.toString();
    if (defaultToString && defaultToString != '[object Object]') { // 确保字符串表示有意义
        // 如果我们还没有错误消息，使用这个
        if (!strErr)
            strErr = defaultToString
        // 如果堆栈还没有包含它，添加错误消息（它并不总是包含：https://mtsknn.fi/blog/js-error-stack/ ）
        else if (!err.stack || !err.stack.includes(defaultToString))
            strErr = `${defaultToString}\n  ${strErr}`;
    }
    if (strErr) return strErr.trimEnd(); // 一些堆栈跟踪有尾随换行符。
    // 其他类型将被序列化
    let typeName = typeof err; // 获取抛出的类型
    // 如果类型是 "object"，尝试从其构造函数名称中获取其名称（可能被缩小）
    if (typeName == 'object') typeName = `${typeName} (${err.constructor.name})`;
    return `non-Error type thrown: ${typeName}` +
        ' { ' + Object.keys(err).map(key => `${key}: ${err[key]}`).join(', ') + ' }';
}

/** 帮助记录消息，并可选地将其打印到终端并弹出通知
 * @param {NS} ns 传递给脚本主入口点的 nestcript 实例
 * @param {string} message 要显示的消息
 * @param {boolean} alsoPrintToTerminal 设置为 true 以不仅打印到当前脚本的 tail 文件，还打印到终端
 * @param {""|"success"|"warning"|"error"|"info"} toastStyle - 如果指定，您的日志也将成为弹出通知
 * @param {int} */
export function log(ns, message = "", alsoPrintToTerminal = false, toastStyle = "", maxToastLength = Number.MAX_SAFE_INTEGER) {
    checkNsInstance(ns, '"log"');
    ns.print(message);
    if (toastStyle) ns.toast(message.length <= maxToastLength ? message : message.substring(0, maxToastLength - 3) + "...", toastStyle);
    if (alsoPrintToTerminal) {
        ns.tprint(message);
        // TODO: 找到一种方法将记录到终端的内容写入“永久”终端日志文件，最好不使此函数成为异步函数。
        //       也许我们将日志复制到一个端口，以便一个单独的脚本可以选择弹出并将它们附加到文件中。
        //ns.write("log.terminal.txt", message + '\n', 'a'); // 注意：我们可以不等待这个 promise，因为它不是一个脚本文件
    }
    return message;
}

/** 帮助获取网络上所有主机名的列表
 * @param {NS} ns 传递给脚本主入口点的 nestcript 实例
 * @returns {string[]} **/
export function scanAllServers(ns) {
    checkNsInstance(ns, '"scanAllServers"');
    let discoveredHosts = []; // 我们已经扫描过的主机（即服务器）
    let hostsToScan = ["home"]; // 我们知道但尚未扫描的主机
    let infiniteLoopProtection = 9999; // 以防你搞乱这段代码，这应该可以防止你卡住
    while (hostsToScan.length > 0 && infiniteLoopProtection-- > 0) { // 循环直到要扫描的主机列表为空
        let hostName = hostsToScan.pop(); // 获取下一个要扫描的主机
        discoveredHosts.push(hostName); // 将此主机标记为“已扫描”
        for (const connectedHost of ns.scan(hostName)) // “扫描”（列出连接到此主机的所有主机）
            if (!discoveredHosts.includes(connectedHost) && !hostsToScan.includes(connectedHost)) // 如果我们还没有找到此主机
                hostsToScan.push(connectedHost); // 将其添加到要扫描的主机队列中
    }
    return discoveredHosts; // 扫描过的主机列表现在应该是游戏中所有主机的集合！
}

/** 获取活动源文件的字典，考虑到当前活动的 bitNode（可选禁用）。
 * @param {NS} ns 传递给脚本主入口点的 nestcript 实例
 * @param {bool} includeLevelsFromCurrentBitnode 设置为 true 以使用当前 bitNode 编号推断有效的源代码级别（用于确定解锁的功能）
 * @param {bool} silent 设置为 true 如果你想最小化记录错误（例如由于没有 singularity 或 RAM 不足）
 * @returns {Promise<{[k: number]: number}>} 以源文件编号为键的字典，值为级别（对于除 BN12 之外的所有文件，介于 1 和 3 之间） **/
export async function getActiveSourceFiles(ns, includeLevelsFromCurrentBitnode = true, silent = true) {
    return await getActiveSourceFiles_Custom(ns, getNsDataThroughFile, includeLevelsFromCurrentBitnode, silent);
}

/** getActiveSourceFiles 帮助函数，允许用户传递他们选择的 getNsDataThroughFile 实现以最小化 RAM 消耗
 * @param {NS} ns 传递给脚本主入口点的 nestcript 实例
 * @param {(ns: NS, command: string, fName?: string, args?: any, verbose?: any, maxRetries?: number, retryDelayMs?: number, silent?: bool) => Promise<any>} fnGetNsDataThroughFile getActiveSourceFiles 帮助函数，允许用户传递他们选择的 getNsDataThroughFile 实现以最小化 RAM 消耗
 * @param {bool} includeLevelsFromCurrentBitnode 设置为 true 以使用当前 bitNode 编号推断有效的源代码级别（用于确定解锁的功能）
 * @param {bool} silent 设置为 true 如果你想最小化记录错误（例如由于没有 singularity 或 RAM 不足）
 * @returns {Promise<{[k: number]: number}>} 以源文件编号为键的字典，值为级别（对于除 BN12 之外的所有文件，介于 1 和 3 之间） **/
export async function getActiveSourceFiles_Custom(ns, fnGetNsDataThroughFile, includeLevelsFromCurrentBitnode = true, silent = true) {
    checkNsInstance(ns, '"getActiveSourceFiles"');
    // 找出用户解锁了哪些源文件
    let dictSourceFiles = (/**@returns{{[bitNodeN: number]: number;}}*/() => null)();
    try {
        dictSourceFiles = await fnGetNsDataThroughFile(ns,
            `Object.fromEntries(ns.singularity.getOwnedSourceFiles().map(sf => [sf.n, sf.lvl]))`,
            '/Temp/getOwnedSourceFiles-asDict.txt', null, null, null, null, silent);
    } catch { } // 如果失败（例如可能由于 RAM 不足或没有 singularity 访问权限），默认为空字典
    dictSourceFiles ??= {};

    // 尝试获取重置信息
    let resetInfo = (/**@returns{ResetInfo}*/() => null)();
    try {
        resetInfo = await fnGetNsDataThroughFile(ns, 'ns.getResetInfo()', null, null, null, null, null, silent);
    } catch { } // 如上所述，抑制任何错误并使用回退以在低 RAM 条件下生存。
    resetInfo ??= { currentNode: 0 }

    // 如果用户当前在某个 bitnode 中，他们将解锁其功能。如果请求，包括这些“有效”级别；
    if (includeLevelsFromCurrentBitnode && resetInfo.currentNode != 0) {
        // 在某些 Bitnodes 中，我们只需在 bitnode 中即可获得源文件级别 3 的效果
        // TODO: 这对于某些 BN（BN4）是正确的，但对于其他 BN（BN14.2）则不然，检查所有！
        let effectiveSfLevel = [4, 8].includes(resetInfo.currentNode) ? 3 : 1;
        dictSourceFiles[resetInfo.currentNode] = Math.max(effectiveSfLevel, dictSourceFiles[resetInfo.currentNode] || 0);
    }

    // 如果设置了任何 bitNodeOptions，它可能会出于游戏目的减少我们的源文件级别，
    // 但游戏目前有一个错误，getOwnedSourceFiles 不会反映这一点，所以我们必须自己处理。
    if ((resetInfo?.bitNodeOptions?.sourceFileOverrides?.size ?? 0) > 0) {
        resetInfo.bitNodeOptions.sourceFileOverrides.forEach((sfLevel, bn) => dictSourceFiles[bn] = sfLevel);
        // 完全删除覆盖级别为 0 的键
        Object.keys(dictSourceFiles).filter(bn => dictSourceFiles[bn] == 0).forEach(bn => delete dictSourceFiles[bn]);
    }

    return dictSourceFiles;
}

/** 返回 bitNode 乘数，或者如果当前无法检索（没有 SF5 或 RAM 不足），则基于硬编码值的最佳猜测
 *  @param {NS} ns 传递给脚本主入口点的 nestcript 实例
 * @returns {Promise<BitNodeMultipliers>} 当前的 bitNode 乘数，或者如果我们当前无法访问，则返回最佳猜测。 */
export async function tryGetBitNodeMultipliers(ns) {
    return await tryGetBitNodeMultipliers_Custom(ns, getNsDataThroughFile);
}

/** tryGetBitNodeMultipliers 帮助函数，允许用户传递他们选择的 getNsDataThroughFile 实现以最小化 RAM 消耗
 * @param {NS} ns 传递给脚本主入口点的 nestcript 实例
 * @param {(ns: NS, command: string, fName?: string, args?: any, verbose?: any, maxRetries?: number, retryDelayMs?: number, silent?: bool) => Promise<any>} fnGetNsDataThroughFile getActiveSourceFiles 帮助函数，允许用户传递他们选择的 getNsDataThroughFile 实现以最小化 RAM 消耗
 * @returns {Promise<BitNodeMultipliers>} 当前的 bitNode 乘数，或者如果我们当前无法访问，则返回最佳猜测。 */
export async function tryGetBitNodeMultipliers_Custom(ns, fnGetNsDataThroughFile) {
    checkNsInstance(ns, '"tryGetBitNodeMultipliers"');
    let canGetBitNodeMultipliers = false;
    try { // 我们在下面的请求中使用“silent”参数，因为我们有低 RAM 条件的回退，并且不想用警告/错误日志混淆玩家
        canGetBitNodeMultipliers = 5 in (await getActiveSourceFiles_Custom(ns, fnGetNsDataThroughFile, /*silent:*/true));
    } catch { }
    if (canGetBitNodeMultipliers) {
        try {
            return await fnGetNsDataThroughFile(ns, 'ns.getBitNodeMultipliers()', '/Temp/bitNode-multipliers.txt', null, null, null, null, /*silent:*/true);
        } catch { }
    }
    return await getHardCodedBitNodeMultipliers(ns, fnGetNsDataThroughFile);
}

/** 从 https://github.com/bitburner-official/bitburner-src/blob/dev/src/BitNode/BitNode.tsx#L456 偷来的硬编码值
 *  这样我们基本上可以提供 bitNode 乘数，即使没有 SF-5 或足够的 RAM 来请求它们。
 *  我们仍然更喜欢使用 API，这只是回退，但它可能会随着时间的推移而变得过时。
 * @param {NS} ns 传递给脚本主入口点的 nestcript 实例
 * @param {(ns: NS, command: string, fName?: string, args?: any, verbose?: any, maxRetries?: number) => Promise<any>} fnGetNsDataThroughFile getActiveSourceFiles 帮助函数，允许用户传递他们选择的 getNsDataThroughFile 实现以最小化 RAM 消耗
 * @param {number} bnOverride 要检索乘数的 bitnode。如果为 null，则默认为当前 BN。
 * @returns {Promise<BitNodeMultipliers>} 带有硬编码值的模拟 BitNodeMultipliers 实例。 */
export async function getHardCodedBitNodeMultipliers(ns, fnGetNsDataThroughFile, bnOverride = null) {
    let bn = bnOverride ?? 1;
    if (!bnOverride) {
        try { bn = (await fnGetNsDataThroughFile(ns, 'ns.getResetInfo()', '/Temp/reset-info.txt')).currentNode; }
        catch { /* 我们预计在低 RAM 条件下具有容错能力 */ }
    }
    return Object.fromEntries(Object.entries({
        AgilityLevelMultiplier: /*     */[1, 1, 1, 1, 1, 1, 1, 1, 0.45, 0.4, 1, 1, 0.7, 0.5],
        AugmentationMoneyCost: /*      */[1, 1, 3, 1, 2, 1, 3, 1, 1, 5, 2, 1, 1, 1.5],
        AugmentationRepCost: /*        */[1, 1, 3, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1],
        BladeburnerRank: /*            */[1, 1, 1, 1, 1, 1, 0.6, 0, 0.9, 0.8, 1, 1, 0.45, 0.6],
        BladeburnerSkillCost: /*       */[1, 1, 1, 1, 1, 1, 2, 1, 1.2, 1, 1, 1, 2, 2],
        CharismaLevelMultiplier: /*    */[1, 1, 1, 1, 1, 1, 1, 1, 0.45, 0.4, 1, 1, 1, 1],
        ClassGymExpGain: /*            */[1, 1, 1, 0.5, 1, 1, 1, 1, 1, 1, 1, 1, 0.5, 1],
        CodingContractMoney: /*        */[1, 1, 1, 1, 1, 1, 1, 0, 1, 0.5, 0.25, 1, 0.4, 1],
        CompanyWorkExpGain: /*         */[1, 1, 1, 0.5, 1, 1, 1, 1, 1, 1, 1, 1, 0.5, 1],
        CompanyWorkMoney: /*           */[1, 1, 0.25, 0.1, 1, 0.5, 0.5, 0, 1, 0.5, 0.5, 1, 0.4, 1],
        CompanyWorkRepGain: /*         */[1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.2],
        CorporationDivisions: /*       */[1, 0.9, 1, 1, 0.75, 0.8, 0.8, 0, 0.8, 0.9, 0.9, 0.5, 0.4, 0.8],
        CorporationSoftcap: /*         */[1, 0.9, 1, 1, 1, 0.9, 0.9, 0, 0.75, 0.9, 0.9, 0.8, 0.4, 0.9],
        CorporationValuation: /*       */[1, 1, 1, 1, 0.75, 0.2, 0.2, 0, 0.5, 0.5, 0.1, 1, 0.001, 0.4],
        CrimeExpGain: /*               */[1, 1, 1, 0.5, 1, 1, 1, 1, 1, 1, 1, 1, 0.5, 1],
        CrimeMoney: /*                 */[1, 3, 0.25, 0.2, 0.5, 0.75, 0.75, 0, 0.5, 0.5, 3, 1, 0.4, 0.75],
        CrimeSuccessRate: /*           */[1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.4],
        DaedalusAugsRequirement: /*    */[30, 30, 30, 30, 30, 35, 35, 30, 30, 30, 30, 31, 30, 30],
        DefenseLevelMultiplier: /*     */[1, 1, 1, 1, 1, 1, 1, 1, 0.45, 0.4, 1, 1, 0.7, 1],
        DexterityLevelMultiplier: /*   */[1, 1, 1, 1, 1, 1, 1, 1, 0.45, 0.4, 1, 1, 0.7, 0.5],
        FactionPassiveRepGain: /*      */[1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        FactionWorkExpGain: /*         */[1, 1, 1, 0.5, 1, 1, 1, 1, 1, 1, 1, 1, 0.5, 1],
        FactionWorkRepGain: /*         */[1, 0.5, 1, 0.75, 1, 1, 1, 1, 1, 1, 1, 1, 0.6, 0.2],
        FourSigmaMarketDataApiCost: /* */[1, 1, 1, 1, 1, 1, 2, 1, 4, 1, 4, 1, 10, 1],
        FourSigmaMarketDataCost: /*    */[1, 1, 1, 1, 1, 1, 2, 1, 5, 1, 4, 1, 10, 1],
        GangSoftcap: /*                */[1, 1, 0.9, 1, 1, 0.7, 0.7, 0, 0.8, 0.9, 1, 0.8, 0.3, 0.7],
        GangUniqueAugs: /*             */[1, 1, 0.5, 0.5, 0.5, 0.2, 0.2, 0, 0.25, 0.25, 0.75, 1, 0.1, 0.4],
        GoPower: /*                    */[1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 4],
        HackExpGain: /*                */[1, 1, 1, 0.4, 0.5, 0.25, 0.25, 1, 0.05, 1, 0.5, 1, 0.1, 1],
        HackingLevelMultiplier: /*     */[1, 0.8, 0.8, 1, 1, 0.35, 0.35, 1, 0.5, 0.35, 0.6, 1, 0.25, 0.4],
        HackingSpeedMultiplier: /*     */[1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.3],
        HacknetNodeMoney: /*           */[1, 1, 0.25, 0.05, 0.2, 0.2, 0.2, 0, 1, 0.5, 0.1, 1, 0.4, 0.25],
        HomeComputerRamCost: /*        */[1, 1, 1.5, 1, 1, 1, 1, 1, 5, 1.5, 1, 1, 1, 1],
        InfiltrationMoney: /*          */[1, 3, 1, 1, 1.5, 0.75, 0.75, 0, 1, 0.5, 2.5, 1, 1, 0.75],
        InfiltrationRep: /*            */[1, 1, 1, 1, 1.5, 1, 1, 1, 1, 1, 2.5, 1, 1, 1],
        ManualHackMoney: /*            */[1, 1, 1, 1, 1, 1, 1, 0, 1, 0.5, 1, 1, 1, 1],
        PurchasedServerCost: /*        */[1, 1, 2, 1, 1, 1, 1, 1, 1, 5, 1, 1, 1, 1],
        PurchasedServerSoftcap: /*     */[1, 1.3, 1.3, 1.2, 1.2, 2, 2, 4, 1, 1.1, 2, 1, 1.6, 1],
        PurchasedServerLimit: /*       */[1, 1, 1, 1, 1, 1, 1, 1, 0, 0.6, 1, 1, 1, 1],
        PurchasedServerMaxRam: /*      */[1, 1, 1, 1, 1, 1, 1, 1, 1, 0.5, 1, 1, 1, 1],
        RepToDonateToFaction: /*       */[1, 1, 0.5, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1],
        ScriptHackMoney: /*            */[1, 1, 0.2, 0.2, 0.15, 0.75, 0.5, 0.3, 0.1, 0.5, 1, 1, 0.2, 0.3],
        ScriptHackMoneyGain: /*        */[1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1],
        ServerGrowthRate: /*           */[1, 0.8, 0.2, 1, 1, 1, 1, 1, 1, 1, 0.2, 1, 1, 1],
        ServerMaxMoney: /*             */[1, 0.08, 0.04, 0.1125, 1, 0.2, 0.2, 1, 0.01, 1, 0.01, 1, 0.3375, 0.7],
        ServerStartingMoney: /*        */[1, 0.4, 0.2, 0.75, 0.5, 0.5, 0.5, 1, 0.1, 1, 0.1, 1, 0.75, 0.5],
        ServerStartingSecurity: /*     */[1, 1, 1, 1, 2, 1.5, 1.5, 1, 2.5, 1, 1, 1.5, 3, 1.5],
        ServerWeakenRate: /*           */[1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1],
        StrengthLevelMultiplier: /*    */[1, 1, 1, 1, 1, 1, 1, 1, 0.45, 0.4, 1, 1, 0.7, 0.5],
        StaneksGiftPowerMultiplier: /* */[1, 2, 0.75, 1.5, 1.3, 0.5, 0.9, 1, 0.5, 0.75, 1, 1, 2, 0.5],
        StaneksGiftExtraSize: /*       */[0, -6, -2, 0, 0, 2, -1, -99, 2, -3, 0, 1, 1, -1],
        WorldDaemonDifficulty: /*      */[1, 5, 2, 3, 1.5, 2, 2, 1, 2, 2, 1.5, 1, 3, 5]
    }).map(([mult, values]) => [mult, values[bn - 1]]));
}

/** 返回指定主机上当前脚本运行的实例数。
 *  使用 RAM 规避（如果您还没有使用它，ns.run 会消耗 1GB）。
 * @param {NS} ns 传递给脚本主入口点的 nestcript 实例
 * @param {string} onHost - 要搜索脚本的主机
 * @param {boolean} warn - 当有其他运行实例时是否自动记录警告
 * @param {tailOtherInstances} warn - 是否打开其他运行实例的 tail 窗口以便轻松杀死它们
 * @returns {Promise<number>} 此主机上此脚本的其他实例数。 */
export async function instanceCount(ns, onHost = "home", warn = true, tailOtherInstances = true) {
    checkNsInstance(ns, '"alreadyRunning"');
    const scriptName = ns.getScriptName();
    let otherInstancePids = (/**@returns{number[]}*/() => [])();
    try {
        otherInstancePids = await getNsDataThroughFile(ns, 'ns.ps(ns.args[0]).filter(p => p.filename == ns.args[1]).map(p => p.pid)',
            '/Temp/ps-other-instances.txt', [onHost, scriptName]);
    } catch (err) {
        if (err.message?.includes("insufficient RAM") ?? false) {
            log(ns, `ERROR: Not enough free RAM on ${onHost} to run ${scriptName}.` +
                `\nBuy more RAM or kill some other scripts first.` +
                `\nYou can run the 'top' command from the terminal to see what scripts are using RAM.`, true, 'error');
            return 2;
        }
        else throw err;
    }
    if (otherInstancePids.length >= 2) {
        if (warn)
            log(ns, `WARNING: You cannot start multiple versions of this script (${scriptName}). Please shut down the other instance(s) first: ${otherInstancePids}` +
                (tailOtherInstances ? ' (To help with this, a tail window for the other instance will be opened)' : ''), true, 'warning');
        if (tailOtherInstances) // Tail all but the last pid, since it will belong to the current instance (which will be shut down)
            otherInstancePids.slice(0, otherInstancePids.length - 1).forEach(pid => tail(ns, pid));
    }
    //ns.tprint(`instanceCount: ${otherInstancePids.length}\n  ${new Error().stack.replaceAll("@", "   @").replaceAll("\n", "\n  ")}\n\n`)
    return otherInstancePids.length;
}

/** 帮助函数获取所有股票代码，或者如果您没有 TIX api 访问权限，则返回 null。
 *  @param {NS} ns 传递给脚本主入口点的 nestcript 实例
 * @returns {Promise<string[]>} 股票代码数组 */
export async function getStockSymbols(ns) {
    return await getNsDataThroughFile(ns,
        `(() => { try { return ns.stock.getSymbols(); } catch { return null; } })()`,
        '/Temp/stock-symbols.txt');
}

/** 帮助函数获取股票的总价值，使用尽可能少的 RAM。
 *  @param {NS} ns 传递给脚本主入口点的 nestcript 实例
 * @returns {Promise<number>} 当前所有拥有股票的美元总价值 */
export async function getStocksValue(ns) {
    let stockSymbols = await getStockSymbols(ns);
    if (stockSymbols == null) return 0; // 没有 TIX API 访问权限
    const stockGetAll = async (fn) => await getNsDataThroughFile(ns,
        `(() => { try { return Object.fromEntries(ns.args.map(sym => [sym, ns.stock.${fn}(sym)])); } catch { return null; } })()`,
        `/Temp/stock-${fn}-all.txt`, stockSymbols);
    const askPrices = await stockGetAll('getAskPrice');
    // 针对 Bug #304 的变通方法：如果我们失去了 TIX 访问权限，我们的股票代码缓存仍然有效，但我们将无法获取价格。
    if (askPrices == null) return 0; // 没有 TIX API 访问权限
    const bidPrices = await stockGetAll('getBidPrice');
    const positions = await stockGetAll('getPosition');
    return stockSymbols.map(sym => ({ sym, pos: positions[sym], ask: askPrices[sym], bid: bidPrices[sym] }))
        .reduce((total, stk) => total + (stk.pos[0] * stk.bid) /* 多头价值 */ + stk.pos[2] * (stk.pos[3] * 2 - stk.ask) /* 空头价值 */
            // 只有在我们有一个或多个股票时才减去佣金（这是我们卖出头寸时不会得到的钱）
            // 如果出于某种疯狂的原因，我们在空头和多头头寸中都有股票，我们将不得不支付两次佣金（两次单独的销售）
            - 100000 * (Math.sign(stk.pos[0]) + Math.sign(stk.pos[2])), 0);
}

/** 如果我们忘记将 ns 实例传递给函数，则返回有用的错误消息
 *  @param {NS} ns 传递给脚本主入口点的 nestcript 实例 */
export function checkNsInstance(ns, fnName = "this function") {
    if (ns === undefined || !ns.print) throw new Error(`The first argument to function ${fnName} should be a 'ns' instance.`);
    return ns;
}

/** 帮助解析命令行参数，具有许多额外功能，例如
 * - 从以脚本命名的本地配置文件中加载持久默认值覆盖。
 * - 渲染 "--help" 输出，而无需所有脚本显式指定它
 * @param {NS} ns 传递给脚本主入口点的 nestcript 实例
 * @param {[string, string | number | boolean | string[]][]} argsSchema - 可能的命令行参数的规范。 **/
export function getConfiguration(ns, argsSchema) {
    checkNsInstance(ns, '"getConfig"');
    const scriptName = ns.getScriptName();
    // 如果用户有本地配置文件，覆盖 argsSchema 中的默认值
    const confName = `${scriptName}.config.txt`;
    const overrides = ns.read(confName);
    const overriddenSchema = overrides ? [...argsSchema] : argsSchema; // 克隆原始 args schema
    if (overrides) {
        try {
            let parsedOverrides = JSON.parse(overrides); // 期望一个可解析的字典或 2 元素数组的数组，如 args schema
            if (Array.isArray(parsedOverrides)) parsedOverrides = Object.fromEntries(parsedOverrides);
            log(ns, `INFO: Applying ${Object.keys(parsedOverrides).length} overriding default arguments from "${confName}"...`);
            for (const key in parsedOverrides) {
                const override = parsedOverrides[key];
                const matchIndex = overriddenSchema.findIndex(o => o[0] == key);
                const match = matchIndex === -1 ? null : overriddenSchema[matchIndex];
                if (!match)
                    throw new Error(`Unrecognized key "${key}" does not match of this script's options: ` + JSON.stringify(argsSchema.map(a => a[0])));
                else if (override === undefined)
                    throw new Error(`The key "${key}" appeared in the config with no value. Some value must be provided. Try null?`);
                else if (match && JSON.stringify(match[1]) != JSON.stringify(override)) {
                    if (typeof (match[1]) !== typeof (override))
                        log(ns, `WARNING: The "${confName}" overriding "${key}" value: ${JSON.stringify(override)} has a different type (${typeof override}) than the ` +
                            `current default value ${JSON.stringify(match[1])} (${typeof match[1]}). The resulting behaviour may be unpredictable.`, false, 'warning');
                    else
                        log(ns, `INFO: Overriding "${key}" value: ${JSON.stringify(match[1])}  ->  ${JSON.stringify(override)}`);
                    overriddenSchema[matchIndex] = { ...match }; // 克隆新 argsSchema 中此位置的（先前浅复制的）对象
                    overriddenSchema[matchIndex][1] = override; // 更新克隆的值。
                }
            }
        } catch (err) {
            log(ns, `ERROR: There's something wrong with your config file "${confName}", it cannot be loaded.` +
                `\nThe error encountered was: ${getErrorInfo(err)}` +
                `\nYour config file should either be a dictionary e.g.: { "string-opt": "value", "num-opt": 123, "array-opt": ["one", "two"] }` +
                `\nor an array of dict entries (2-element arrays) e.g.: [ ["string-opt", "value"], ["num-opt", 123], ["array-opt", ["one", "two"]] ]` +
                `\n"${confName}" contains:\n${overrides}`, true, 'error', 80);
            return null;
        }
    }
    // 返回使用游戏内 args 解析器将默认值与提供的命令行参数组合的结果
    try {
        const finalOptions = ns.flags(overriddenSchema);
        log(ns, `INFO: Running ${scriptName} with the following settings:` + Object.keys(finalOptions).filter(a => a != "_").map(a =>
            `\n  ${a.length == 1 ? "-" : "--"}${a} = ${finalOptions[a] === null ? "null" : JSON.stringify(finalOptions[a])}`).join("") +
            `\nrun ${scriptName} --help  to get more information about these options.`)
        return finalOptions;
    } catch (err) {
        // 检测用户是否传递了无效参数，并返回帮助文本
        // 如果用户明确要求 --help，抑制解析错误
        const error = ns.args.includes("help") || ns.args.includes("--help") ? null : getErrorInfo(err);
        // 尝试从源代码的注释中解析每个参数的文档
        const source = ns.read(scriptName).split("\n");
        let argsRow = 1 + source.findIndex(row => row.includes("argsSchema ="));
        const optionDescriptions = {}
        while (argsRow && argsRow < source.length) {
            const nextArgRow = source[argsRow++].trim();
            if (nextArgRow.length == 0) continue;
            if (nextArgRow[0] == "]" || nextArgRow.includes(";")) break; // 我们已经到达 args schema 的末尾
            const commentSplit = nextArgRow.split("//").map(e => e.trim());
            if (commentSplit.length != 2) continue; // 此行似乎不是格式：[option...], // 注释
            const optionSplit = commentSplit[0].split("'"); // 期望类似：['name', someDefault]。我们只需要名称
            if (optionSplit.length < 2) continue;
            optionDescriptions[optionSplit[1]] = commentSplit[1];
        }
        log(ns, (error ? `ERROR: There was an error parsing the script arguments provided: ${error}\n` : 'INFO: ') +
            `${scriptName} possible arguments:` + argsSchema.map(a => `\n  ${a[0].length == 1 ? " -" : "--"}${a[0].padEnd(30)} ` +
                `Default: ${(a[1] === null ? "null" : (JSON.stringify(a[1]) ?? "undefined")).padEnd(10)}` +
                (a[0] in optionDescriptions ? ` // ${optionDescriptions[a[0]]}` : '')).join("") + '\n' +
            `\nTip: All argument names, and some values support auto-complete. Hit the <tab> key to autocomplete or see possible options.` +
            `\nTip: Array arguments are populated by specifying the argument multiple times, e.g.:` +
            `\n       run ${scriptName} --arrayArg first --arrayArg second --arrayArg third  to run the script with arrayArg=[first, second, third]` +
            (!overrides ? `\nTip: You can override the default values by creating a config file named "${confName}" containing e.g.: { "arg-name": "preferredValue" }`
                : overrides && !error ? `\nNote: The default values are being modified by overrides in your local "${confName}":\n${overrides}`
                    : `\nThis error may have been caused by your local overriding "${confName}" (especially if you changed the types of any options):\n${overrides}`), true);
        return null; // 调用者应处理 null 并优雅地关闭。
    }
}

/** 为了将参数传递给启动/完成脚本，它们可能必须被引用，当作为此脚本的参数给出时，
 * 但在将这些作为原始字符串传递给后续脚本时，必须去掉这些引号。
 * @param {string[]} args - 传递给脚本的数组参数。
 * @returns {string[]} 未转义的数组参数（如果提供了以 '[' 开头的单个参数，则反序列化）。 */
export function unEscapeArrayArgs(args) {
    // 为了方便起见，还支持 args 作为单个字符串化数组
    if (args.length == 1 && args[0].startsWith("[")) return JSON.parse(args[0]);
    // 否则，用引号包裹的 args 应该去掉引号。
    const escapeChars = ['"', "'", "`"];
    return args.map(arg => escapeChars.some(c => arg.startsWith(c) && arg.endsWith(c)) ? arg.slice(1, -1) : arg);
}

/**
 * 自定义 tail 函数，还应用默认的调整大小和 tail 窗口放置。
 * 此算法并不完美，但在大多数情况下不应生成窗口标题栏的重叠。
 * @param {NS} ns 传递给脚本主入口点的 nestcript 实例
 * @param {number|undefined} processId 要 tail 的进程 id，或 null 以使用当前进程 id
 */
export function tail(ns, processId = undefined) {
    checkNsInstance(ns, '"tail"');
    processId ??= ns.pid
    ns.ui.openTail(processId);
    // 不要移动或调整之前打开并可能被玩家移动的 tail 窗口
    const tailFile = '/Temp/helpers-tailed-pids.txt'; // 使用文件以便在重置时可以清除
    const fileContents = ns.read(tailFile);
    const tailedPids = fileContents.length > 1 ? JSON.parse(fileContents) : [];
    if (tailedPids.includes(processId))
        return //ns.tprint(`PID was previously moved ${processId}`);
    // 默认情况下，使所有 tail 窗口占据可用宽度的 75%，高度的 25%
    const [width, height] = ns.ui.windowSize();
    ns.ui.resizeTail(width * 0.60, height * 0.25, processId);
    // 级联窗口：每次 tail 后，将窗口稍微向下和向右移动，以便它们不重叠
    let offsetPct = ((((tailedPids.length % 30.0) / 30.0) + tailedPids.length) % 6.0) / 6.0;
    ns.print(width, ' ', height, ' ', processId, ' ', offsetPct, ' ', tailedPids)
    ns.ui.moveTail(offsetPct * (width * 0.25 - 300) + 250, offsetPct * (height * 0.75 - 100) + 50, processId);
    tailedPids.push(processId);
    ns.write(tailFile, JSON.stringify(tailedPids), 'w');
}
