/** @param {NS} ns **/
export async function main(ns) {
    // 获取用户输入的文件夹路径
    const folderInput = await ns.prompt('请输入要删除的文件夹路径（例如输入"foo"对应/foo/）:', { type: "text" });

    // 处理取消输入的情况
    if (folderInput === null || folderInput.trim() === "") {
        ns.tprint("操作已取消。");
        return;
    }

    // 标准化路径格式
    let folderPath = folderInput.trim();
    if (!folderPath.startsWith('/')) folderPath = '/' + folderPath;  // 确保绝对路径
    if (folderPath !== '/' && !folderPath.endsWith('/')) folderPath += '/';  // 添加结尾斜杠

    // 根目录二次确认
    if (folderPath === '/') {
        const confirmRoot = await ns.prompt("警告：即将删除home服务器所有文件！确认继续？", { type: "boolean" });
        if (!confirmRoot) {
            ns.tprint("根目录删除操作已取消。");
            return;
        }
    }

    // 获取文件列表
    const files = ns.ls('home', folderPath);
    if (files.length === 0) {
        ns.alert(`在路径 ${folderPath} 中未找到文件。`);
        return;
    }

    // 显示文件预览并确认
    const filePreview = files.slice(0, 5).join('\n• ');
    const confirmDelete = await ns.prompt(
        `找到 ${files.length} 个文件，示例：\n• ${filePreview}${files.length > 5 ? '\n...及其他文件' : ''}\n确定要删除吗？`,
        { type: "boolean" }
    );

    if (!confirmDelete) {
        ns.tprint("操作已取消。");
        return;
    }

    // 执行删除操作并统计结果
    let success = 0, failures = 0;
    for (const file of files) {
        if (ns.rm(file)) {
            success++;
            ns.print(`✓ 已删除：${file}`);
        } else {
            failures++;
            ns.print(`✗ 删除失败：${file}`);
        }
    }

    // 输出最终报告
    const report = `操作完成：成功删除 ${success} 个文件，失败 ${failures} 个。`;
    ns.tprint(report);
    if (failures > 0) ns.tprint("提示：失败文件可能正在运行或权限不足。");
}