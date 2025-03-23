/** @param {NS} ns */
export async function main(ns) {
    // 配置参数
    const MAX_DISPLAY_LENGTH = 40;
    const SCRIPT_ICON = "📜";
    const STOP_ICON = "⏹️";
    const RENAME_ICON = "📝";
    const DELETE_ICON = "🗑️";
    const DEBUG_MODE = 0;
    const THREAD_LIMIT = 10000;

    // ========================
    // 核心功能实现
    // ========================

    // 获取所有可用目录
    const scriptDirs = getScriptDirectories(ns);
    if (scriptDirs.length === 0) {
        return ns.alert("❌ 未找到任何脚本目录！");
    }

    // 主菜单选择
    const action = await ns.prompt("脚本管理器 v2.2", {
        type: "select",
        choices: [
            "⏯ 启动新脚本",
            "⏹️ 关闭运行中脚本",
            `${RENAME_ICON} 重命名脚本`,
            `${DELETE_ICON} 删除文件`
        ]
    });

    if (action === "⏯ 启动新脚本") {
        const selectedDir = await selectDirectory(ns, scriptDirs);
        selectedDir && await handleStartScript(ns, selectedDir);
    } else if (action === "⏹️ 关闭运行中脚本") {
        await handleStopScript(ns);
    } else if (action === `${RENAME_ICON} 重命名脚本`) {
        await handleRenameScript(ns);
    } else if (action === `${DELETE_ICON} 删除文件`) {
        await handleDeleteFiles(ns);
    }

    // ========================
    // 删除文件功能
    // ========================

    async function handleDeleteFiles(ns) {
        const folderInput = await ns.prompt('请输入要删除的文件夹路径（例如输入"foo"对应/foo/）:', {
            type: "text"
        });

        if (folderInput === null || folderInput.trim() === "") {
            ns.toast("操作已取消", "warning", 2000);
            return;
        }

        let folderPath = normalizePath(folderInput.trim());
        if (folderPath === '//') folderPath = '/';

        if (folderPath === '/') {
            const confirmRoot = await ns.prompt("⚠️ 警告：即将删除home服务器所有文件！确认继续？", {
                type: "boolean"
            });
            if (!confirmRoot) {
                ns.toast("根目录删除操作已取消", "warning", 2000);
                return;
            }
        }

        const files = ns.ls('home').filter(f => normalizePath(f).startsWith(folderPath));
        if (files.length === 0) {
            return ns.alert(`❌ 在路径 ${folderPath} 中未找到文件！`);
        }

        const filePreview = files.slice(0, 5).join('\n• ');
        const confirmDelete = await ns.prompt(
            `找到 ${files.length} 个文件，示例：\n• ${filePreview}${files.length > 5 ? '\n...及其他文件' : ''}\n确定要删除吗？`,
            { type: "boolean" }
        );

        if (!confirmDelete) {
            ns.toast("操作已取消", "warning", 2000);
            return;
        }

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

        const report = `操作完成：成功删除 ${success} 个文件，失败 ${failures} 个。`;
        ns.toast(report, success > 0 ? "success" : "error", 3000);
        if (failures > 0) ns.toast("提示：失败文件可能正在运行或权限不足", "warning", 3000);
    }

    // ========================
    // 原有核心功能函数
    // ========================

    async function handleRenameScript(ns) {
        const scriptDirs = getScriptDirectories(ns);
        const selectedDir = await selectDirectory(ns, scriptDirs);
        if (!selectedDir) return;

        const allScripts = ns.ls('home').filter(f => {
            const isScript = /\.(js|script)$/i.test(f);
            return isScript && normalizePath(f).startsWith(normalizePath(selectedDir)) && f !== ns.getScriptName();
        });

        if (allScripts.length === 0) {
            return ns.alert(`❌ 目录 ${selectedDir} 中没有可重命名的脚本！`);
        }

        const scriptChoices = allScripts.map(scriptPath => {
            const displayName = scriptPath.replace(selectedDir, '').replace(/^\//, '');
            return `${SCRIPT_ICON} ${displayName}`;
        });

        const selected = await ns.prompt(`选择要重命名的脚本（目录：${selectedDir}）`, {
            type: "select",
            choices: scriptChoices,
            rows: Math.min(15, scriptChoices.length)
        });

        if (!selected) return;

        const oldPath = allScripts[scriptChoices.indexOf(selected)];
        const newName = await ns.prompt("输入新路径（绝对路径，保持扩展名不变）", {
            type: "text",
            default: oldPath
        });

        if (!newName || newName === oldPath) {
            return ns.alert("❌ 新名称不能为空或与原名称相同！");
        }

        const pathRegex = /^\/(?:[^/]+\/)*[^/]+\.(js|script)$/i;
        if (!pathRegex.test(newName)) {
            return ns.alert('❌ 路径格式无效！必须为绝对路径，文件名以.js或.script结尾，且不含连续斜杠。');
        }

        const oldExt = oldPath.split('.').pop().toLowerCase();
        const newExt = newName.split('.').pop().toLowerCase();
        if (newExt !== oldExt) {
            return ns.alert(`❌ 扩展名必须为.${oldExt}！`);
        }

        const newDir = newName.replace(/\/[^/]+$/, '') + '/';
        if (!isDirectoryExists(ns, newDir)) {
            return ns.alert(`❌ 目标目录 ${newDir} 不存在，请先创建目录！`);
        }

        if (ns.fileExists(newName)) {
            return ns.alert(`❌ 目标文件 ${newName} 已存在！`);
        }

        const success = ns.mv('home', oldPath, newName);
        if (success) {
            ns.toast(`✅ 脚本重命名为 ${newName}`, 'success', 3000);
        } else {
            ns.toast(`❌ 重命名失败，请检查路径权限`, 'error', 5000);
        }
    }

    async function handleStartScript(ns, targetDir) {
        const allScripts = ns.ls('home').filter(f => {
            const isScript = /\.(js|script)$/i.test(f);
            return isScript &&
                normalizePath(f).startsWith(targetDir) &&
                f !== ns.getScriptName();
        });

        if (DEBUG_MODE) {
            ns.tprint(`[DEBUG] 目标目录: ${targetDir}`);
            ns.tprint(`[DEBUG] 找到脚本: \n${allScripts.join('\n')}`);
        }

        if (allScripts.length === 0) {
            return ns.alert(`❌ 目录 ${targetDir} 中未找到脚本！\n`
                + `请检查：\n`
                + `• 文件后缀是否为.js/.script\n`
                + `• 脚本是否位于home服务器\n`
                + `• 是否包含子目录脚本`);
        }

        const scriptChoices = allScripts.map(scriptPath => {
            const displayName = scriptPath
                .replace(targetDir, '')
                .replace(/\.\w+$/, '');
            return `${SCRIPT_ICON} ${displayName}`;
        });

        const selected = await ns.prompt(`选择要启动的脚本（目录：${targetDir}）`, {
            type: "select",
            choices: scriptChoices,
            rows: Math.min(15, scriptChoices.length)
        });

        if (!selected) return;

        const threads = await ns.prompt("启动线程数 (1-" + THREAD_LIMIT + ")", {
            type: "text",
            default: 1,
            validate: input => {
                if (isNaN(input)) return "必须输入数字";
                if (input < 1) return "至少1线程";
                if (input > THREAD_LIMIT) return `超过最大限制 ${THREAD_LIMIT}`;
                return true;
            }
        });

        const actualPath = allScripts[scriptChoices.indexOf(selected)];
        const pid = ns.run(actualPath, threads);

        if (pid) {
            ns.toast(`✅ 已启动 ${truncateName(actualPath, 30)} (PID: ${pid})`, 'success', 3000);
            if (DEBUG_MODE) ns.tprint(`[DEBUG] 启动成功 | 路径: ${actualPath} | 线程: ${threads}`);
        } else {
            ns.toast(`❌ 启动失败，请检查脚本参数`, 'error', 5000);
        }
    }

    async function handleStopScript(ns) {
        const processes = ns.ps('home').filter(p => p.filename !== ns.getScriptName());
        if (processes.length === 0) return ns.alert('ℹ️ 当前没有正在运行的脚本');

        const processMap = new Map();
        const processChoices = processes.map(p => {
            const args = p.args.length ? ` [${p.args.join(', ')}]` : '';
            const display = `${STOP_ICON} ${p.filename}${args}`;
            const truncated = truncateName(display, MAX_DISPLAY_LENGTH);
            processMap.set(truncated, p.pid);
            return truncated;
        });

        const selected = await ns.prompt("选择要终止的进程", {
            type: "select",
            choices: processChoices,
            rows: Math.min(15, processChoices.length)
        });

        if (!selected) return;

        const pid = processMap.get(selected);
        const success = ns.kill(pid);
        ns.toast(
            success ? `✅ 已终止进程 (PID: ${pid})` : '❌ 终止失败',
            success ? 'success' : 'error',
            3000
        );
    }

    // ========================
    // 辅助函数
    // ========================

    function getScriptDirectories(ns) {
        const dirSet = new Set(['/']);
        ns.ls('home').forEach(fullPath => {
            const pathParts = fullPath.split('/').slice(0, -1);
            let currentPath = '';
            pathParts.forEach(part => {
                if (!part) return;
                currentPath += '/' + part;
                dirSet.add(normalizePath(currentPath));
            });
        });
        return Array.from(dirSet)
            .sort((a, b) => a.localeCompare(b))
            .map(p => normalizePath(p));
    }

    async function selectDirectory(ns, dirs) {
        const dirMap = new Map();
        const choices = dirs.map(dir => {
            const parts = dir.split('/').filter(p => p);
            let display = '🏠 根目录';
            if (parts.length) {
                display = parts
                    .map((p, i) => `${'  '.repeat(i)}📂 ${p}`)
                    .join('\n') + '/';
            }
            dirMap.set(display, dir);
            return display;
        });

        const selected = await ns.prompt("浏览目录（使用方向键选择）", {
            type: "select",
            choices: choices,
            rows: 15
        });
        return dirMap.get(selected);
    }

    function normalizePath(path) {
        return ('/' + path)
            .replace(/^\/+/, '/')
            .replace(/\/+/g, '/')
            .replace(/(.)\/?$/, '$1/')
            .replace(/\/$/, '/');
    }

    function truncateName(str, maxLen) {
        if (str.length <= maxLen) return str;
        const keep = maxLen - 3;
        const front = Math.ceil(keep * 0.6);
        const back = keep - front;
        return `${str.substr(0, front)}...${str.substr(-back)}`;
    }

    function isDirectoryExists(ns, dirPath) {
        const normalizedDir = normalizePath(dirPath);
        return ns.ls('home').some(file => normalizePath(file).startsWith(normalizedDir));
    }

    // ========================
    // 调试初始化
    // ========================
    if (DEBUG_MODE) {
        ns.tprint(`[DEBUG] 所有检测目录:\n${getScriptDirectories(ns).join('\n')}`);
        ns.tprint(`[DEBUG] 文件列表:\n${ns.ls('home').join('\n')}`);
    }
}
