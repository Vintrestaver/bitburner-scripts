# Insight's Bitburner 脚本翻译及概述

## 简介
欢迎来到 Insight's Bitburner 脚本库，这是有史以来最受欢迎的 Bitburner 脚本之一。我的个人 GitHub 上托管了这些脚本，因为所有最棒的黑客都会公开自己的代码。

## 下载整个仓库
如果您从终端手动运行 `nano git-pull.js` 并复制 [该脚本的内容](https://raw.githubusercontent.com/alainbryden/bitburner-scripts/main/git-pull.js)，您将能够运行它一次并下载我使用的其余文件。在游戏初期，许多脚本可能无用，因为它们仅在游戏后期功能启用时才有效，但它们的存在不会给您带来太多问题。

## 运行脚本
如果您从终端运行 `run autopilot.js`，它将启动其他几个脚本。

您可以将其视为“主协调器”脚本。它将启动 `daemon.js`（您的主要黑客脚本），后者又会启动几个其他辅助脚本。它将监控您在游戏中的进度，并在可能时采取特殊行动。我不想为那些刚接触游戏的人剧透太多，但值得一提的是，`SF4` 虽非必需，但强烈推荐以获得此脚本的全部优势。

大多数脚本也可以单独运行，但主要设计为由 `autopilot.js` 或 `daemon.js` 协调。

## 手动运行脚本
一些脚本需要根据需要手动运行。大多数脚本接受参数，以便根据您的偏好或特殊情况调整或自定义其行为。更多信息见下文“自定义脚本行为（基础）”。
使用 `--help` 标志运行脚本，可获取其参数列表、默认值以及每个参数的简要描述：
![image](https://user-images.githubusercontent.com/2285037/166085058-952b0805-cf4e-4548-8829-1e1ebeb5428b.png)
如果您在运行脚本时出错，也会看到此对话框的错误版本。

如果您有个人偏好，并希望“永久”更改我的某个脚本的配置，您可以在不牺牲使用 `git-pull.js` 获取最新版本的能力的情况下进行此操作，只需为该脚本[创建一个自定义的 `config.txt` 文件](https://github.com/alainbryden/bitburner-scripts/edit/main/README.md#config-files)即可。

_注意：_ `autopilot.js`（以及 `daemon.js`）将使用默认参数运行许多脚本实例。如果您希望使用特殊参数运行它们，您必须杀死默认版本，或者在启动 daemon.js **之前**使用您所需的参数运行脚本。Daemon.js 只会启动尚未运行的脚本（无论当前运行实例的参数如何）。

## 脚本简要描述
以下是您可能希望手动运行的脚本，大致按您希望尝试它们的顺序排列：

- `git-pull.js` - 希望您已使用此脚本下载脚本。每当您希望更新时运行它。
- `scan.js` - 显示整个服务器网络以及每个服务器的重要信息。它是内置 `scan` 和/或 `scan-analyze` 命令的绝佳替代品，支持无限深度。
- `autopilot.js` - （或多或少）为您玩游戏。
- `daemon.js` - 自动化黑客攻击和基础设施，并利用您解锁的游戏中的其他机制启动各种脚本。
- `casino.js` - 第一次运行此脚本时可能会让您感到惊讶，它将玩二十一点，如果输了则重新加载游戏（自动保存-加载）。一旦您赢得 100 亿，您将无法再进入赌场。这是您在赚取前往 Aevum 并使用赌场所需的初始 20 万后，加快进度的好方法。为获得最佳性能，在运行此脚本之前运行 `kill-all-scripts.js`，因为其他正在运行的脚本会减慢游戏的加载时间。
- `reserve.js` - 一种在所有脚本中保留资金的简单方法，以防您想确保为某事省钱。例如，`run reserve.js 200k` 将保留运行 `casino.js` 所需的 20 万美元。
- `kill-all-scripts.js` - 杀死在家和远程服务器上运行的所有脚本，并删除复制到远程服务器的文件。
- `faction-manager.js` - （需要 SF4）定期运行此脚本，以了解您目前可以负担多少增强。有许多命令行选项可用于调整您希望优先考虑的增强类型。使用 `--purchase` 运行以在您准备晋升时触发购买。
- `work-for-factions.js` - （需要 SF4）Daemon.js 将启动此脚本的一个版本，以确保您的“专注”工作得到充分利用，但通常您会希望使用自己的参数运行它，以指定您希望在当前 BitNode 中进行的工作类型。
- `crime.js` - （需要 SF4）虽然 `work-for-factions.js` 会在需要时进行犯罪，但您可以使用此脚本专门进行犯罪。
- `ascend.js` - （需要 SF4）一种几乎完全自动化的晋升方式。在您安装增强并重置之前，它会处理您可能知道或不知道希望执行的所有事情。
- `spend-hacknet-hashes.js` - （需要 SF9）许多脚本将自动启动此脚本，但您可以启动自己的实例，以专注于在当前情况下购买所需的哈希升级。下面存在此脚本的许多别名。
- `farm-intelligence.js` - （需要 SF4、SF5）包含一个脚本，可以执行一个或多个已知最佳的智力经验获取方法。
  - 请注意，当前最佳方法（软重置循环）在删除除此脚本（及其依赖的 helpers.js）之外的所有脚本后运行最有效。您可以通过修改 cleanup.js 使其对所有文件而非仅对 /Temp/ 中的文件运行来快速完成此操作。然后，您需要通过像开始时那样运行 nano git-pull 来恢复脚本。
- `cleanup.js` - 使用此脚本清除您的临时文件夹（其中包含主脚本生成的数百个微型脚本）。在导出之前，这有助于减小保存文件的大小。
- `grep.js` - 使用此脚本在一个或多个文件中搜索特定文本。如果您正在尝试弄清楚例如哪个脚本花费哈希，或关心 TIX API，则此脚本非常有用。
- `run-command.js` - 用于从终端测试一段代码，而无需创建新脚本。创建别名 `alias do="run run-command.js"` 会使此脚本更加有用。例如，`do ns.getPlayer()` 将在终端打印所有玩家信息。`do ns.getServer('joesguns')` 将在终端打印有关该服务器的所有信息。

如果您希望获取有关任何脚本的更多信息，请尝试阅读源代码。我尽力清晰地记录事项。如果不够清晰，请随时提出问题。

## 自定义脚本行为（基础）
大多数脚本设计为通过命令行参数进行配置。（例如，使用 `run host-manager.js --min-ram-exponent 8` 确保不购买 RAM 少于 2^8 GB 的服务器）

默认行为是尝试“平衡”优先级，并为大多数事物提供相等的预算/RAM 份额，但这并不总是理想的，尤其是在削弱游戏某一方面的 BitNode 中。您可以使用 `nano` 查看脚本并查看命令行选项，或键入例如 `daemon.js --`（双破折号）并按 `<tab>` 以获取弹出式自动完成列表。（确保您的鼠标光标位于终端上，以便出现自动完成。）

在 `daemon.js` 初始化程序的顶部附近，有一列外部脚本，这些脚本最初会定期生成。如果您不希望某个脚本自动运行（例如，如果您希望手动选择如何花费您的“专注”时间，则不希望 `work-for-factions` 自动运行），可以将其注释掉。下载此文件后，您应使用您喜欢的默认选项进行自定义，并注释掉您不希望运行的外部脚本。

## 别名
您可能会发现设置一个或多个带有您喜欢的默认选项的别名，而不是编辑文件本身，会很有用。（专业提示：别名支持制表符自动完成）。我个人使用以下别名：

- `alias git-pull="run git-pull.js"`
  - 使自动更新变得稍微容易一些。
- `alias start="run autopilot.js"`
- `alias stop="home; kill autopilot.js ; kill daemon.js ; run kill-all-scripts.js"`
  - 快速启动/停止系统的方法。我个人现在使用 `auto` 而不是 `start` 作为此别名（auto => autopilot.js）。
- `alias sscan="home; run scan.js"`
  - 使运行此自定义扫描例程变得更快一些，此例程显示整个网络、有关服务器的统计信息，并提供用于跳转到服务器或对其进行后门攻击的便捷链接。
- `alias do="run run-command.js"`
  - 这使您能够从终端运行 ns 命令，例如 `do ns.getPlayer()`、`do Object.keys(ns)` 或 `do ns.getServerMoneyAvailable('n00dles')`
- `alias reserve="run reserve.js"`
  - 这不会节省太多击键，但值得强调此脚本。您可以运行例如 `reserve 100m` 以全局保留这么多钱。所有具有自动支出组件的脚本都应尊重此金额并将其留作未支出。如果您正在攒钱购买某物（SQLInject.exe、大型服务器、下一个家庭 RAM 升级）、攒钱在赌场花费等，则此功能非常有用。
- `alias liquidate="home; run stockmaster.js --liquidate; run spend-hacknet-hashes.js --liquidate;"`
  - 快速出售您所有的股票和黑客网络哈希以换取金钱，以便您可以花费它（在重置之前很有用）
- `alias facman="run faction-manager.js"`
  - 快速查看您能够负担购买的增强。然后使用 `facman --purchase` 触发购买。
- `alias buy-daemons="run host-manager.js --run-continuously --reserve-percent 0 --min-ram-exponent 19 --utilization-trigger 0 --tail"`
  - 这是如何使用 host-manager 为您购买服务器的示例。在此示例中，如果我们能够购买具有 2^19 GB RAM 或更多内存的服务器（--min-ram-exponent），我们愿意花费我们当前的所有资金（--reserve-percent 0），即使我们的脚本未在网络上使用任何 RAM（--utilization-trigger 0）
- `alias spend-on-ram="run Tasks/ram-manager.js --reserve 0 --budget 1 --tail"`
- `alias spend-on-gangs="run gangs.js --reserve 0 --augmentations-budget 1 --equipment-budget 1 --tail"`
- `alias spend-on-sleeves="run sleeve.js --aug-budget 1 --min-aug-batch 1 --buy-cooldown 0 --reserve 0 --tail"`
  - 在您已将所有资金用于增强之后、重置之前，按您自己的优先级顺序运行一个或多个这些脚本很有用。
- `alias spend-on-hacknet="run hacknet-upgrade-manager.js --interval 10 --max-payoff-time 8888h --continuous --tail"`
  - 基本上花费大量资金升级黑客网络。如果它花费的资金不够多，请增加 --max-payoff-time。
- `alias hashes-to-bladeburner="run spend-hacknet-hashes.js --spend-on Exchange_for_Bladeburner_Rank --spend-on Exchange_for_Bladeburner_SP --liquidate --tail"`
- `alias hashes-to-corp-money="run spend-hacknet-hashes.js --spend-on Sell_for_Corporation_Funds --liquidate --tail"`
- `alias hashes-to-corp-research="run spend-hacknet-hashes.js --spend-on Exchange_for_Corporation_Research --liquidate --tail"`
- `alias hashes-to-corp="run spend-hacknet-hashes.js --spend-on Sell_for_Corporation_Funds --spend-on Exchange_for_Corporation_Research --liquidate --tail"`
- `alias hashes-to-hack-server="run spend-hacknet-hashes.js --liquidate --spend-on Increase_Maximum_Money --spend-on Reduce_Minimum_Security --spend-on-server"`
  - 有用于设置哈希以在您能够负担时自动花费在一个或多个事物上。如果您希望保存哈希以自行花费，并且只希望在达到容量时花费它们以避免浪费，则省略 --liquidate。
- `alias stock="run stockmaster.js --fracH 0.001 --fracB 0.1 --show-pre-4s-forecast --noisy --tail --reserve 100000000"`
  - 例如，在 BN8 中很有用，可将所有现金投资于股票市场，并密切跟踪进度。_（还保留 1 亿以在赌场玩二十一点，以便您可以快速积累现金。专业提示：如果您赢了，请保存，如果输了，则重新加载（或如果您讨厌保存-加载，则进行软重置）以取回您的资金。）_
- `alias crime="run crime.js --tail --fast-crimes-only"`
  - 开始自动犯罪循环。（像我的许多脚本一样，需要 SF4，即 Singularity 访问权限。）
- `alias work="run work-for-factions.js --fast-crimes-only"`
  - 自动为派系工作。还将根据需要进行犯罪循环。（注意，daemon 也会自动启动此脚本）
- `alias invites="run work-for-factions.js --fast-crimes-only --get-invited-to-every-faction --prioritize-invites --no-coding-contracts"`
  - 尝试加入尽可能多的派系，无论您是否从它们那里购买了增强。
- `alias xp="run daemon.js -vx --tail --no-share"`
  - 以一种专注于尽可能快地赚取黑客 XP 收入的方式运行 daemon。仅当您拥有大量家庭 RAM 时才实用。
- `alias start-tight="run daemon.js --looping-mode --recovery-thread-padding 30 --cycle-timing-delay 2000 --queue-delay 10 --stock-manipulation-focus --tail --silent-misfires --initial-max-targets 64"`
  - 这是一个提示，说明其中一些脚本的可定制程度（无需编辑源代码）。上述别名在您处于 bn 末期且黑客技能非常高（8000+）时非常强大，因此黑客/增长/削弱时间非常快（毫秒级）。通过切换到这种 `--looping-mode`，您可以大大提高生产率并减少延迟，此模式会创建长期运行的黑客/增长/削弱脚本，这些脚本在一个循环中运行。此外，更紧密的循环定时使它们更容易发生误触发（完成顺序错乱），但添加恢复线程填充（用于增长/削弱线程数量的倍数）可以快速从误触发中恢复。请注意，如果您还没有足够的家庭 RAM 来支持如此高的恢复线程倍数，您可以从较低值（5 或 10）开始，然后购买更多家庭 RAM 并逐步提高。
- `alias ascend="run ascend.js --install-augmentations"`
  - 完成您节点的好方法。我个人在重置时优先考虑增强，因为我已经解锁了所有 SF 奖励，但在您获得 SF11.3 增强成本降低之前，您可能希望使用 `--prioritize-home-ram` 标志，此标志在购买尽可能多的增强之前，尽可能优先升级家庭 RAM。

## 配置文件
可以指定持久自定义配置（script.js.config.txt 文件）以覆盖每个脚本的“参数架构”中指定的默认参数。

参数值的确定顺序如下：
1. 命令行（或别名）中提供的参数具有优先权
2. 如果命令行中未提供覆盖，则使用配置文件中的任何值
3. 如果配置文件中没有值，则使用源代码（argsSchema）中的默认值
   - 请注意，一些默认值在 argsSchema 中设置为 `null`，以便在脚本的其他位置被更复杂的默认行为覆盖。

### 格式规范
文件应命名为 `some-script-name.js.config.txt`（即将 `.config.txt` 附加到您正在配置的脚本的名称）

您的配置文件应具有以下两种格式之一：
1. 字典，例如：`{ "string-opt": "value", "num-opt": 123, "array-opt": ["one", "two"] }`
2. 字典条目数组（2 元素数组），例如：`[ ["string-opt", "value"], ["num-opt", 123], ["array-opt", ["one", "two"]] ]`

欢迎使用换行符和空格使内容更易于人类阅读，只要它能够被 JSON.parse 解析即可（如有疑问，请在代码中构建它并使用 JSON.stringify 生成它）。

## 自定义脚本代码（高级）
我鼓励您创建分支并根据自己的需求/喜好自定义脚本。除非您真正认为这对所有人都有益，否则请不要向我发送拉取请求。如果您分叉了仓库，您可以更新 `git-pull.js` 源代码，以将您的 GitHub 帐户作为默认值，或设置通过命令行指定此的别名（例如 `alias git-pull="run git-pull.js --github mygitusername --repository bitburner-scripts"`）。这样，您可以从您的分叉自动更新，并且只在您准备好时合并我的最新更改。

## 免责声明
这是我的 Bitburner 脚本仓库。
我经常努力使它们通用且可自定义，但绝非作为对 Bitburner 社区的一项“服务”提供这些脚本。
它旨在作为一种简便的方式，让我与朋友共享代码，并跟踪我的脚本中的更改和错误。

- 如果您希望使用我的脚本或从中复制，请随意！
- 如果您认为在其中发现了错误并希望告诉我，那太棒了！
- 如果您提出功能请求、错误报告或拉取请求而我拒绝采取行动，请不要感到被冒犯。
虽然我喜欢我的工作对他人有所帮助并被重用，但我只愿意投入这么多精力来根据其他人的具体需求或心血来潮进行自定义。
您应该分叉代码，并开始按照您希望的方式调整它。这更符合游戏的精神！

如有任何问题，请加入 Bitburner Discord：
- Bitburner Discord 邀请链接：https://discord.com/invite/TFc3hKD
- 这些脚本的频道链接：[Bitburner#alains-scripts](https://discord.com/channels/415207508303544321/935667531111342200)

其中有许多熟悉我的脚本或类似脚本的有用人士，他们可以比我更快地解决您的问题和疑虑。