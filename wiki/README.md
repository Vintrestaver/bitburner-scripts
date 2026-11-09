# Bitburner Scripts — Code Wiki

> **Insight's Scripts**（上游：[alainbryden/bitburner-scripts](https://github.com/alainbryden/bitburner-scripts)，当前仓库为 Vintrestaver 的 fork）— 一套用于自动化游玩编程游戏 [Bitburner](https://github.com/bitburner-official/bitburner-src) 的 Netscript 脚本合集。MIT License。

## 这是什么

Bitburner 是一款以"写 JavaScript 黑服务器"为核心玩法的增量放置类游戏。本仓库不是游戏本体，而是一套**在游戏内运行的自动化脚本**：从破解服务器、调度 hack/grow/weaken 批循环，到经营帮派、炒股、下围棋、购买增强（augmentations）并自动重置进入下一个 BitNode，覆盖整个游戏生命周期。

- **语言 / 运行时**：JavaScript（ES Module），运行于游戏内 Netscript 2.0 环境，全局 `ns` 对象提供全部游戏 API
- **无构建系统**：每个 `.js` 文件即一个可直接 `run` 的游戏内脚本；通过 `git-pull.js` 从 GitHub  raw 地址自我更新
- **规模**：48 个 `.js` 文件，约 **16,166 行**
- **CI**：GitHub Actions 仅运行 `woke`（包容性语言检查），见 `.github/workflows/inclusive_language.yml`

## Wiki 导航

| 页面 | 内容 |
|---|---|
| [01-整体架构](01-整体架构.md) | 分层架构、启动链、HGW 时间片调度模型、通信与配置机制 |
| [02-核心模块](02-核心模块.md) | `daemon.js` / `helpers.js` / `autopilot.js` / `ascend.js` 深度解析 |
| [03-功能模块](03-功能模块.md) | 派系、帮派、分身、刀锋战士、股票、赌场、IPvGO、Stanek、Hacknet |
| [04-基础设施与工具脚本](04-基础设施与工具脚本.md) | `Remote/` worker、`Tasks/` 任务脚本、扫描/统计/小工具 |
| [05-关键类与函数](05-关键类与函数.md) | 共享库 API 参考、各模块关键函数、核心数据结构 |
| [06-依赖关系](06-依赖关系.md) | import 依赖图、启动依赖图、共享状态文件、游戏机制前置条件 |
| [07-运行与配置指南](07-运行与配置指南.md) | 安装更新、启动方式、参数系统、config.txt、推荐别名 |

## 快速开始（30 秒版）

```
nano git-pull.js   # 粘贴本仓库 git-pull.js 内容，保存
run git-pull.js    # 下载全部脚本
run autopilot.js   # 启动总编排器，此后基本全自动
```

## 模块一览

| 分类 | 文件 | 行数 | 职责 |
|---|---|---:|---|
| **总编排** | `autopilot.js` | 1160 | 监控游戏进度，按阶段启动各子系统，判断何时重置 |
| **核心调度** | `daemon.js` | 2364 | 黑客调度守护进程：破解服务器、选择目标、调度 HGW 批循环 |
| **共享库** | `helpers.js` | 961 | 参数系统、日志格式化、网络扫描、临时脚本执行等公共函数 |
| **重置流程** | `ascend.js` | 208 | 清算资产→买增强→安装→软重置的全自动流程 |
| **派系/工作** | `faction-manager.js` / `work-for-factions.js` / `crime.js` | 1009 / 1302 / 37 | 增强购买规划；自动为派系/公司工作；自动犯罪 |
| **子系统** | `gangs.js` / `sleeve.js` / `bladeburner.js` | 604 / 446 / 457 | 帮派经营、分身任务分配、刀锋战士行动 |
| **赚钱** | `stockmaster.js` / `casino.js` / `go.js` | 1043 / 604 / 1570 | 股市交易；赌场 21 点存档读档；IPvGO 围棋对弈 |
| **Stanek** | `stanek.js` / `stanek.js.create.js` / `optimize-stanek.js` | 201 / 276 / 390 | Stanek 礼物充能与 fragment 布局优化 |
| **Hacknet** | `hacknet-upgrade-manager.js` / `spend-hacknet-hashes.js` | 149 / 235 | 节点升级（回本时间模型）与 hash 消费 |
| **基础设施** | `host-manager.js` / `scan.js` / `analyze-hack.js` / `stats.js` | 243 / 158 / 199 / 368 | 购服务器、网络可视化、收益分析、HUD 状态 |
| **Worker** | `Remote/`（5 个脚本） | 148 | 部署到远程服务器执行 hack/grow/weaken/share |
| **任务脚本** | `Tasks/`（9 个脚本） | 1293 | 后门、coding contract 求解、TOR/程序购买、RAM 升级等 |
| **小工具** | `git-pull.js` 等 10 个 | ~370 | 自更新、清场、搜索、终端命令执行等 |

> 详见各分页。[下一步：整体架构 →](01-整体架构.md)
