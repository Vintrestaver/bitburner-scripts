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
    const CACHE_TTL = 5000; // 5秒缓存

    // 增强型缓存类
    class EnhancedScriptCache {
        constructor(ttl = 5000) {
            this.ttl = ttl;
            this.cache = { 
                timestamp: 0, 
                data: null,
                size: 0
            };
            this.hitCount = 0;
            this.missCount = 0;
        }

        get(ns, forceUpdate = false) {
            const now = Date.now();
            if (forceUpdate || now - this.cache.timestamp > this.ttl || !this.cache.data) {
                const startTime = Date.now();
                const files = ns.ls('home');
                this.cache = {
                    timestamp: now,
                    data: files,
                    size: files.length
                };
                this.missCount++;
                if (DEBUG_MODE) {
                    ns.tprint(`[CACHE] Cache miss | Fetch time: ${Date.now() - startTime}ms | Files: ${files.length}`);
                }
            } else {
                this.hitCount++;
                if (DEBUG_MODE) {
                    ns.tprint(`[CACHE] Cache hit | Hits: ${this.hitCount} | Misses: ${this.missCount}`);
                }
            }
            return this.cache.data;
        }

        getCacheStats() {
            return {
                hitCount: this.hitCount,
                missCount: this.missCount,
                lastUpdate: this.cache.timestamp,
                fileCount: this.cache.size
            };
        }
    }

    // 全局缓存实例
    const scriptCache = new EnhancedScriptCache(CACHE_TTL);

    // 获取缓存的文件列表（使用新的缓存类）
    function getCachedFiles(ns) {
        return scriptCache.get(ns);
    }

    // 过滤脚本文件
    function filterScriptFiles(ns, dirPath, excludeSelf = true) {
        return getCachedFiles(ns).filter(f => {
            const isScript = /\.(js|script)$/i.test(f);
            const isInDir = normalizePath(f).startsWith(normalizePath(dirPath));
            const isSelf = f === ns.getScriptName();
            return isScript && isInDir && !(excludeSelf && isSelf);
        });
    }

    // 增强型确认消息格式化
    function formatConfirmation(message, items, maxPreview = 5) {
        const total = items.length;
        const preview = items.slice(0, maxPreview).map((item, index) => {
            const num = index + 1;
            const icon = num <= 3 ? '🔸' : '•';
            return `${icon} ${item}`;
        }).join('\n');
        
        const moreInfo = total > maxPreview ? 
            `\n...及其他 ${total - maxPreview} 个文件` : '';
            
        const sizeInfo = total > 10 ? 
            `\n⚠️ 注意：操作将影响 ${total} 个文件，请谨慎操作！` : '';
            
        return `📝 ${message}（共 ${total} 项）\n${preview}${moreInfo}${sizeInfo}`;
    }

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

    // 优化后的目录处理函数
    function getScriptDirectories(ns) {
        // 使用局部缓存变量
        let cachedDirs = null;
        if (cachedDirs) {
            return cachedDirs;
        }

        const dirSet = new Set(['/']);
        const files = scriptCache.get(ns);

        // 优化路径处理逻辑
        for (const fullPath of files) {
            try {
                const normalized = normalizePath(fullPath);
                if (!normalized.startsWith('/')) {
                    continue; // 跳过无效路径
                }

                // 分解路径并构建目录树
                const parts = normalized.split('/').filter(Boolean);
                let currentPath = '/';
                for (const part of parts.slice(0, -1)) { // 忽略文件名部分
                    currentPath += part + '/';
                    dirSet.add(currentPath);
                }
            } catch (error) {
                if (DEBUG_MODE) {
                    ns.tprint(`[WARN] 路径处理错误: ${fullPath} - ${error}`);
                }
            }
        }

        // 缓存结果
        cachedDirs = Array.from(dirSet).sort((a, b) => 
            a.localeCompare(b, undefined, { numeric: true })
        );
        return cachedDirs;
    }

    // 新增：统一确认对话框函数
    async function showConfirmation(ns, options = {}) {
        const {
            title = "确认操作",
            message = "确定要继续吗？",
            confirmText = "确定",
            cancelText = "取消",
            type = "boolean"
        } = options;

        return await ns.prompt(
            message,  // 第一个参数应为消息内容
            {
                type,
                title,
                choices: type === "boolean" ? undefined : [],
                confirmText,
                cancelText
            }
        );
    }

    // 修改后的删除文件函数（部分）
    async function handleDeleteFiles(ns) {
        const scriptDirs = getScriptDirectories(ns);
        const selectedDir = await selectDirectory(ns, scriptDirs);
        if (!selectedDir) {
            ns.toast("操作已取消", "warning", 2000);
            return;
        }

        let folderPath = normalizePath(selectedDir);

        // 安全检查：根目录删除需要额外确认
        if (folderPath === '/') {
            const confirmRoot = await showConfirmation(ns, {
                title: "危险操作确认",
                message: "⚠️ 警告：即将删除home服务器所有文件！确认继续？"
            });
            if (!confirmRoot) {
                ns.toast("根目录删除操作已取消", "warning", 2000);
                return;
            }
        }

        const files = getCachedFiles(ns).filter(f => normalizePath(f).startsWith(folderPath));
        if (files.length === 0) {
            return ns.alert(`❌ 在路径 ${folderPath} 中未找到文件！`);
        }

        // 显示要删除的文件预览
        const confirmMessage = formatConfirmation(
            `确定要删除以下文件吗？`,
            files.map(f => truncateName(f, 50))
        );
        const confirmDelete = await showConfirmation(ns, {
            message: confirmMessage,
            title: "确认删除文件"
        });

        if (!confirmDelete) {
            ns.toast("操作已取消", "warning", 2000);
            return;
        }

        // 最终确认
        const finalConfirm = await ns.prompt('⚠️ 最后一次确认：这将永久删除文件且不可恢复！输入 "DELETE" 确认操作', { type: "text" });

        if (String(finalConfirm || '').trim().toUpperCase() !== "DELETE") {
            ns.toast("操作已取消", "warning", 2000);
            return;
        }

        let success = 0, failures = 0;
        try {
            for (const file of files) {
                try {
                    if (ns.rm(file)) {
                        success++;
                        ns.print(`✓ 已删除：${file}`);
                    } else {
                        failures++;
                        ns.print(`✗ 删除失败：${file}`);
                    }
                } catch (error) {
                    failures++;
                    handleError(ns, error, `删除文件 ${file} 时发生错误`);
                }
            }

            const report = `操作完成：成功删除 ${success} 个文件，失败 ${failures} 个。`;
            ns.toast(report, success > 0 ? "success" : "error", 3000);
            if (failures > 0) ns.toast("提示：失败文件可能正在运行或权限不足", "warning", 3000);
        } catch (error) {
            handleError(ns, error, '批量删除文件时发生错误');
        }
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

        try {
            const success = ns.mv('home', oldPath, newName);
            if (success) {
                ns.toast(`✅ 脚本重命名为 ${newName}`, 'success', 3000);
            } else {
                throw new Error('重命名失败，请检查路径权限');
            }
        } catch (error) {
            handleError(ns, error, `重命名脚本 ${oldPath} -> ${newName} 时发生错误`);
            ns.toast(`❌ 重命名失败，请检查路径权限`, 'error', 5000);
        }
    }

    async function handleStartScript(ns, targetDir) {
        const allScripts = filterScriptFiles(ns, targetDir);

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

        const actualPath = allScripts[scriptChoices.indexOf(selected)];

        try {
            // 预加载脚本信息
            const [scriptInfo] = await preloadScriptInfo(ns, [actualPath]);

            // 检查脚本是否存在
            if (!scriptInfo) {
                return ns.alert(`❌ 错误：脚本 ${actualPath} 不存在！`);
            }

            // 如果脚本正在运行，提示用户确认
            if (scriptInfo.running) {
                const confirm = await ns.prompt(
                    `脚本 ${actualPath} 已经在运行（使用 ${scriptInfo.ram.toFixed(2)} GB RAM），是否继续启动新实例？`,
                    { type: "boolean" }
                );
                if (!confirm) return;
            }

            // 获取线程数
            let threads = 1;
            try {
                const threadInput = await ns.prompt("启动线程数 (1-" + THREAD_LIMIT + ")", {
                    type: "text",
                    default: 1,
                    validate: input => {
                        if (isNaN(input)) return "必须输入数字";
                        if (input < 1) return "至少1线程";
                        if (input > THREAD_LIMIT) return `超过最大限制 ${THREAD_LIMIT}`;
                        return true;
                    }
                });
                threads = parseInt(threadInput);
            } catch (error) {
                handleError(ns, error, '设置线程数时发生错误');
                ns.toast("线程数设置失败，使用默认值1", "warning", 2000);
            }

            // 启动脚本
            try {
                const pid = ns.run(actualPath, threads);
                if (pid) {
                    ns.toast(`✅ 已启动 ${truncateName(actualPath, 30)} (PID: ${pid})`, 'success', 3000);
                    if (DEBUG_MODE) ns.tprint(`[DEBUG] 启动成功 | 路径: ${actualPath} | 线程: ${threads}`);
                } else {
                    throw new Error('启动失败，请检查脚本参数');
                }
            } catch (error) {
                handleError(ns, error, `启动脚本 ${actualPath} 时发生错误`);
                ns.toast(`❌ 启动失败，请检查脚本参数`, 'error', 5000);
            }
        } catch (error) {
            handleError(ns, error, '处理脚本启动时发生错误');
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
    // 错误处理与日志记录
    // ========================
    function logError(ns, error, context = '') {
        const timestamp = new Date().toISOString();
        const errorMessage = `[ERROR] ${timestamp} | ${context}\n${error.stack || error}`;
        ns.tprint(errorMessage);
        ns.write('error.log', errorMessage + '\n', 'a');
    }

    // 全局错误处理
    function handleError(ns, error, context = '') {
        logError(ns, error, context);
        ns.toast(`❌ 发生错误：${error.message}`, 'error', 5000);
    }

    // ========================
    // 调试初始化
    // ========================
    if (DEBUG_MODE) {
        ns.tprint(`[DEBUG] 所有检测目录:\n${getScriptDirectories(ns).join('\n')}`);
        ns.tprint(`[DEBUG] 文件列表:\n${ns.ls('home').join('\n')}`);
    }
}

// 新增：脚本信息预加载
async function preloadScriptInfo(ns, scriptPaths) {
    return Promise.all(scriptPaths.map(async path => {
        return {
            path,
            ram: ns.getScriptRam(path),
            running: ns.isRunning(path, 'home')
        };
    }));
}
