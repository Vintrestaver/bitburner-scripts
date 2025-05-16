import { runCommand } from './helpers.js'

const escapeChars = ['"', "'", "`"];

/** @param {NS} ns
 * 参数可以包含多个要运行的命令。第一个命令的输出将自动打印，
 * 除非后续命令包含 '; output = ...' - 在这种情况下，将打印该结果。 **/
export async function main(ns) {
    let args = ns.args;
    if (args.length == 0)
        return ns.tprint("你必须提供一个参数作为要测试的代码来运行此脚本。")
    // 第一个参数为 -s 时将进入“静默”模式 - 在成功情况下不输出结果
    let silent = false;
    if (args.includes('-s')) {
        silent = true;
        args = args.slice(args.indexOf('-s'), 1);
    }
    const firstArg = String(args[0]);
    const escaped = escapeChars.some(c => firstArg.startsWith(c) && firstArg.endsWith(c));
    let command = args == escaped ? args[0] : args.join(" "); // 如果参数未被转义，则将它们连接在一起
    // 为避免混淆，去除任何尾随的空格/分号
    command = command.trim();
    if (command.endsWith(';')) command = command.slice(0, -1);
    // 如果命令似乎包含多个语句，巧妙地（或许危险地）
    // 看看是否可以注入一个 return 语句，以便获取最后一个语句的返回值
    if (command.includes(';')) {
        const lastStatement = command.lastIndexOf(';');
        if (!command.slice(lastStatement + 1).trim().startsWith('return'))
            command = command.slice(0, lastStatement + 1) + `return ` + command.slice(lastStatement + 1);
        // 在多语句命令周围创建一个作用域，以便它们可以在 lambda 中使用
        command = `{ ${command} }`;
    }
    // 将命令包装在一个可以捕获并打印其输出的 lambda 中。
    command = `ns.tprint(JSON.stringify(await (async () => ${command})() ?? "(无输出)", jsonReplacer, 2)` +
        // 虽然我们使用漂亮的格式化，但对于嵌套超过 2 层的任何对象，使用“压缩”格式化
        `.replaceAll(/\\n      +/gi,""))`;
    await ns.write(`/Temp/terminal-command.js`, "", "w"); // 清除之前的命令文件以避免重复使用临时脚本名称的警告。这是唯一的例外。
    return await runCommand(ns, command, `/Temp/terminal-command.js`, (escaped ? args.slice(1) : undefined), !silent);
}
