let options;
const argsSchema = [
    ['github', 'alainbryden'],
    ['repository', 'bitburner-scripts'],
    ['branch', 'main'],
    ['download', []], // 默认情况下，将下载仓库中所有支持的文件。可以在此处覆盖为仅下载子集
    ['new-file', []], // 如果仓库列表获取失败，则仅下载 ns.ls() 返回的文件。可以在此处添加其他文件
    ['subfolder', ''], // 可以设置为下载到远程仓库结构中不存在的子文件夹
    ['extension', ['.js', '.ns', '.txt', '.script']], // 按扩展名下载文件
    ['omit-folder', ['Temp/']], // 获取更新文件列表时要忽略的文件夹（TODO: 现在可能已过时，因为我们直接从 github 获取文件列表）
];

export function autocomplete(data, args) {
    data.flags(argsSchema);
    const lastFlag = args.length > 1 ? args[args.length - 2] : null;
    if (["--download", "--subfolder", "--omit-folder"].includes(lastFlag))
        return data.scripts;
    return [];
}

/** @param {NS} ns
 * 将尝试下载当前服务器上每个文件的最新版本。
 * 你需要负责：
 * - 首先备份你的存档/脚本（尝试在终端中使用 `download *`）
 * - 确保你没有不希望被覆盖的本地更改 **/
export async function main(ns) {
    options = ns.flags(argsSchema);
    // 曾经，游戏 API 要求文件夹以斜杠开头
    // 从 2.3.1 版本开始，这不仅不再需要，而且可能会破坏游戏。
    options.subfolder = options.subfolder ? trimSlash(options.subfolder) : // 移除用户指定文件夹的起始斜杠
        ns.getScriptName().substring(0, ns.getScriptName().lastIndexOf('/')); // 默认为当前文件夹
    const baseUrl = `raw.githubusercontent.com/${options.github}/${options.repository}/${options.branch}/`;
    const filesToDownload = options['new-file'].concat(options.download.length > 0 ? options.download : await repositoryListing(ns));
    for (const localFilePath of filesToDownload) {
        let fullLocalFilePath = pathJoin(options.subfolder, localFilePath);
        const remoteFilePath = `https://` + pathJoin(baseUrl, localFilePath);
        ns.print(`正在尝试从 ${remoteFilePath} 更新 "${fullLocalFilePath}" ...`);
        if (await ns.wget(`${remoteFilePath}?ts=${new Date().getTime()}`, fullLocalFilePath) && rewriteFileForSubfolder(ns, fullLocalFilePath))
            ns.tprint(`成功：已将 "${fullLocalFilePath}" 更新为 ${remoteFilePath} 的最新版本`);
        else
            ns.tprint(`警告："${fullLocalFilePath}" 未更新。（当前正在运行，或未在 ${remoteFilePath} 找到？）`)
    }
    ns.tprint(`信息：拉取完成。如有任何问题，请在 github 上创建 issue 或加入 ` +
        `Bitburner Discord 频道 "#Insight's-scripts": https://discord.com/channels/415207508303544321/935667531111342200`);
    // 删除之前版本的所有临时文件/脚本
    ns.run(pathJoin(options.subfolder, `cleanup.js`));
}

/** 移除指定字符串的起始和结尾斜杠 */
function trimSlash(s) {
    // 曾经，游戏 API 要求文件夹以斜杠开头
    // 从 2.3.1 版本开始，这不仅不再需要，而且可能会破坏游戏。
    if (s.startsWith('/'))
        s = s.slice(1);
    if (s.endsWith('/'))
        s = s.slice(0, -1);
    return s;
}

/** 将所有参数作为路径组件连接起来，例如 pathJoin("foo", "bar", "/baz") = "foo/bar/baz" **/
function pathJoin(...args) {
    return trimSlash(args.filter(s => !!s).join('/').replace(/\/\/+/g, '/'));
}

/** @param {NS} ns
 * 重写文件以处理下载到子文件夹的路径替换。 **/
export function rewriteFileForSubfolder(ns, path) {
    if (!options.subfolder || path.includes('git-pull.js'))
        return true;
    let contents = ns.read(path);
    // 替换 helpers.js 中 getFilePath 的子文件夹引用：
    contents = contents.replace(`const subfolder = ''`, `const subfolder = '${options.subfolder}/'`);
    // 替换任何导入语句，这些语句不能使用 getFilePath，但仅当它们未指定相对路径（../）时
    contents = contents.replace(/from '(\.\/)?((?!\.\.\/).*)'/g, `from '${pathJoin(options.subfolder, '$2')}'`);
    ns.write(path, contents, 'w');
    return true;
}

/** @param {NS} ns
 * 获取要下载的文件列表，要么来自 github 仓库（如果支持），要么使用本地目录列表 **/
async function repositoryListing(ns, folder = '') {
    // 注意：每天 60 次免费 API 请求的限制，不要过度使用
    const listUrl = `https://api.github.com/repos/${options.github}/${options.repository}/contents/${folder}?ref=${options.branch}`
    let response = null;
    try {
        response = await fetch(listUrl); // 原始响应
        // 期望得到一个对象数组：[{path:"", type:"[file|dir]" },{...},...]
        response = await response.json(); // 反序列化
        // 遗憾的是，我们必须递归获取文件夹，这会消耗我们每天 60 次免费 API 请求。
        const folders = response.filter(f => f.type == "dir").map(f => f.path);
        let files = response.filter(f => f.type == "file").map(f => f.path)
            .filter(f => options.extension.some(ext => f.endsWith(ext)));
        ns.print(`以下文件存在于 ${listUrl}\n${files.join(", ")}`);
        for (const folder of folders)
            files = files.concat((await repositoryListing(ns, folder))
                .map(f => `/${f}`)); // 游戏要求文件夹以斜杠开头
        return files;
    } catch (error) {
        if (folder !== '') throw error; // 如果这是递归调用，则传播错误。
        ns.tprint(`警告：无法获取仓库列表（GitHub API 请求限制达到 60 次？）：${listUrl}` +
            `\n响应内容（如果可用）：${JSON.stringify(response ?? '(N/A)')}\n错误：${String(error)}`);
        // 回退，假设用户已经拥有仓库中所有文件的副本，并将其用作目录列表
        return ns.ls('home').filter(name => options.extension.some(ext => f.endsWith(ext)) &&
            !options['omit-folder'].some(dir => name.startsWith(dir)));
    }
}
