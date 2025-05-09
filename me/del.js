/** 
 * 安全删除工具 - 增强版
 * @param {NS} ns 
 * @returns {Promise<void>}
 */
export async function main(ns) {
    // 带颜色样式的打印函数
    const style = {
        warning: (text) => `\u001b[38;5;208m${text}\u001b[0m`,
        error: (text) => `\u001b[31m${text}\u001b[0m`,
        success: (text) => `\u001b[32m${text}\u001b[0m`,
        info: (text) => `\u001b[36m${text}\u001b[0m`
    };

    // 获取并验证用户输入
    const folderInput = await ns.prompt(style.info('请输入要删除的文件夹路径：'), { 
        type: "text",
        placeholder: "示例: foo/bar 或 /foo"
    });

    if (!folderInput?.trim()) {
        ns.tprint(style.warning('⚠️ 操作已取消'));
        return;
    }

    // 标准化路径处理
    const normalizePath = (rawPath) => {
        let path = rawPath.trim()
            .replace(/\/+/g, '/')  // 清理多余斜杠
            .replace(/\/$/, '');   // 移除末尾斜杠
        
        // 处理相对路径
        if (!path.startsWith('/')) path = '/' + path;
        
        // 防止路径穿越攻击
        if (path.includes('..')) {
            ns.tprint(style.error('❌ 非法路径：检测到路径穿越符'));
            return null;
        }
        
        return path + '/';  // 统一添加结尾斜杠
    };

    const folderPath = normalizePath(folderInput);
    if (!folderPath) return;

    // 获取文件列表
    const files = ns.ls('home', folderPath);
    if (files.length === 0) {
        ns.alert(style.warning(`在路径 ${folderPath} 中未找到文件。`));
        return;
    }

    // 根目录二次确认（增强版）
    if (folderPath === '/') {
        const confirmRoot = await ns.prompt(
            style.error('‼️ 危险操作：即将删除HOME服务器所有文件！\n') + 
            `共找到 ${files.length} 个文件\n` +
            style.warning('此操作不可逆！确认继续？'), 
            { type: "boolean" }
        );
        if (!confirmRoot) {
            ns.tprint(style.warning('⚠️ 根目录删除操作已取消'));
            return;
        }
    }

    // 系统文件保护检查
    const systemFiles = files.filter(f => f.endsWith('.cct'));
    if (systemFiles.length > 0) {
        ns.alert(style.error(`发现 ${systemFiles.length} 个合约文件！\n删除系统文件可能导致任务失败！`));
        return;
    }

    // 增强版确认对话框
    const confirmMessage = [
        style.warning(`即将删除 ${files.length} 个文件`),
        style.info('示例文件：'),
        ...files.slice(0, 3).map(f => `• ${f}`),
        files.length > 3 ? style.info('...及其他文件') : '',
        style.error('\n此操作不可撤销！确认删除？')
    ].join('\n');

    const confirmDelete = await ns.prompt(confirmMessage, { type: "boolean" });
    if (!confirmDelete) {
        ns.tprint(style.warning('⚠️ 删除操作已取消'));
        return;
    }

    // 执行删除操作（带进度反馈）
    let success = 0, failures = 0;
    const totalFiles = files.length;
    const startTime = Date.now();
    
    for (const [index, file] of files.entries()) {
        try {
            // 进度显示
            const progress = Math.floor((index + 1) / totalFiles * 100);
            ns.print(style.info(`[${progress}%] 正在处理：${file}`));
            
            if (ns.rm(file)) {
                success++;
                ns.print(style.success(`✓ 已删除：${file}`));
            } else {
                failures++;
                ns.print(style.error(`✗ 删除失败：${file}`));
            }
        } catch (e) {
            failures++;
            ns.print(style.error(`⚠️ 异常错误：${e}`));
        }
    }

    // 生成统计报告
    const duration = ((Date.now() - startTime)/1000).toFixed(2);
    const report = [
        style.success(`✅ 成功删除：${success} 文件`),
        failures > 0 ? style.error(`❌ 失败删除：${failures} 文件`) : '',
        style.info(`⏱️ 耗时：${duration} 秒`),
        failures > 0 ? style.warning('提示：失败文件可能正在运行或权限不足') : ''
    ].filter(Boolean).join('\n');

    ns.tprint(`\n${report}`);
}
