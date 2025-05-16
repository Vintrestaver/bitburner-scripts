# Insight的脚本
欢迎使用Insight的Bitburner脚本 - 有史以来最好的Bitburner脚本之一。托管在我的个人GitHub上，因为所有最好的黑客都会自曝身份。

# 下载整个仓库

如果你从终端手动`nano git-pull.js`并复制[该脚本的内容](https://raw.githubusercontent.com/alainbryden/bitburner-scripts/main/git-pull.js)，你应该能够运行它一次并下载我使用的其余文件。在游戏早期，许多脚本将无用，因为它们仅在游戏后期功能启用时才有用，但它们只是存在的话应该不会给你带来太多问题。

# 运行脚本

如果你从终端运行`run autopilot.js`，它将启动几个其他脚本。

你可以将其视为“主协调器”脚本。它将启动`daemon.js`（你的主要黑客脚本），而`daemon.js`又会启动几个辅助脚本。它将监控你在游戏中的进度，并在可能时采取特殊行动。我不想为游戏新手剧透太多，但值得一提的是，`SF4`不是必需的，但强烈建议你启用它以获得该脚本的全部好处。

大多数脚本也可以单独运行，但主要是设计为由`autopilot.js`或`daemon.js`协调运行。

## 手动运行脚本

有些脚本需要根据需要手动运行。大多数脚本接受参数，以便根据你的偏好或特殊情况调整或自定义其行为。更多信息请参见[下文](#customizing-script-behaviour-basic)。
使用`--help`标志运行脚本以获取其参数列表、默认值以及每个参数的简要说明：
![image](https://user-images.githubusercontent.com/2285037/166085058-952b0805-cf4e-4548-8829-1e1ebeb5428b.png)
如果你在运行脚本时出错，你也会看到此对话框的错误版本。

如果你有个人偏好并希望“永久”更改我的脚本配置，你可以在不牺牲“git-pull.js”获取最新版本的能力的情况下进行 - 只需[创建一个自定义的`config.txt`](https://github.com/alainbryden/bitburner-scripts/edit/main/README.md#config-files)文件。

_注意：_ `autopilot.js`（以及`daemon.js`）将使用默认参数运行许多脚本实例。如果你希望使用特殊参数运行它们，你必须要么终止默认版本，要么在启动`daemon.js`之前使用你想要的参数运行脚本。`Daemon.js`只会启动尚未运行的脚本（无论当前运行实例的参数如何）。

## 脚本简要描述

以下是你可能希望手动运行的脚本，大致按你希望尝试它们的顺序排列：

- `git-pull.js` - 希望你使用它来下载脚本。每当你想更新时运行它。
- `scan.js` - 显示整个服务器网络以及每个服务器的重要信息。这是内置`scan`和/或`scan-analyze`命令的一个很好的替代品，支持无限深度。
- `autopilot.js` - 为你玩游戏（或多或少）。
- `daemon.js` - 自动化黑客和基础设施，并启动各种脚本以利用游戏中解锁的其他机制。
- `casino.js` - 第一次运行这个脚本可能会让你感到惊讶，它会玩二十一点，如果输了则重新加载游戏（自动保存作弊）。一旦你赢了100亿，你就不能再进入赌场了。一旦你赚到前往Aevum并使用赌场所需的20万，这是提升进度的好方法。为了获得最佳性能，在运行此脚本之前运行`kill-all-scripts.js`，因为其他正在运行的脚本会减慢游戏的加载时间。
- `reserve.js` - 一种简单的方法来在所有脚本中保留资金，以防你确定要存钱购买某些东西。例如，`run reserve.js 200k`将保留启动`casino.js`所需的20万美元。
- `kill-all-scripts.js` - 终止在家庭和远程服务器上运行的所有脚本，并删除复制到远程服务器的文件。
- `faction-manager.js` - （需要SF4）定期运行此脚本以了解你当前可以购买多少增强。有许多命令行选项可用于调整你希望优先考虑的增强类型。如果你准备好提升，请使用`--purchase`运行以触发。
- `work-for-factions.js` - （需要SF4）`Daemon.js`将启动此脚本的一个版本，以确保你的“专注”工作得到充分利用，但通常你会希望使用自己的参数运行，以指定你希望进行的工作类型，具体取决于你当前BitNode的目标。
- `crime.js` - （需要SF4）虽然`work-for-factions.js`会根据需要进行犯罪，但你可以使用此脚本专门进行犯罪。
- `ascend.js` - （需要SF4）一种几乎完全自动化的提升方式。负责处理你可能知道或不知道在安装增强和重置之前想要做的所有事情。
- `spend-hacknet-hashes.js` - （需要SF9）许多脚本会自动启动此脚本，但你可以启动自己的实例以专注于购买你当前情况下想要的哈希升级。下面有许多此脚本的别名。
- `farm-intelligence.js` - （需要SF4, SF5）包含一个脚本，可以执行一个或多个已知的最佳方法来获取智力经验。
  - 请注意，当前最佳方法（软重置循环）在删除除该脚本（以及它依赖的`helpers.js`）之外的所有脚本后运行效果最佳。你可以通过修改`cleanup.js`以在所有文件上运行而不是仅在`/Temp/`上运行来快速完成此操作。然后你将不得不像刚开始时那样通过nano`git-pull`来恢复脚本。
- `cleanup.js` - 使用此脚本清除你的临时文件夹（其中包含由主脚本生成的数百个微型脚本）。在导出之前减少保存文件大小时很有用。
- `grep.js` - 使用此脚本在一个或所有文件中搜索某些文本。如果你试图找出例如哪个脚本花费哈希，或者关心TIX API，这将非常方便。
- `run-command.js` - 用于从终端测试一些代码而无需创建新脚本。创建别名`alias do="run run-command.js"`使其更加有用。例如，`do ns.getPlayer()`会将玩家的所有信息打印到终端。`do ns.getServer('joesguns')`会将该服务器的所有信息打印到终端。

如果你想了解有关任何脚本的更多信息，请尝试阅读源代码。我尽力清晰地记录内容。如果不清楚，请随时提出问题。

## 自定义脚本行为（基础）
大多数脚本设计为通过命令行参数进行配置。（例如使用`run host-manager.js --min-ram-exponent 8`以确保不会购买少于2^8 GB RAM的服务器）

默认行为是尝试“平衡”优先级，并给予大多数事物平等的预算/RAM份额，但这并不总是理想的，尤其是在那些削弱游戏某一方面或其他方面的bitnodes中。你可以`nano`查看脚本以查看命令行选项是什么，或者输入例如`daemon.js --`（双破折号）并点击`<tab>`以获取弹出式自动完成列表。（确保你的鼠标光标位于终端上以显示自动完成。）

在`daemon.js`的初始化器顶部，有一个最初启动并定期运行的外部脚本列表。如果你不希望该脚本自动运行，可以注释掉其中一些脚本（例如`work-for-factions`，如果你希望手动选择如何花费你的“专注”时间）。一旦你下载了此文件，你应该使用你喜欢的默认选项进行自定义，并注释掉你不想运行的外部脚本。

## 别名

你可能会发现设置一个或多个具有你喜欢的默认选项的别名比编辑文件本身更有用。（专业提示，别名支持标签自动完成）。我个人使用以下别名：

- `alias git-pull="run git-pull.js"`
  - 使自动更新更容易一些。
- `alias start="run autopilot.js"`
- `alias stop="home; kill autopilot.js ; kill daemon.js ; run kill-all-scripts.js"`
  - 快速启动/停止系统的方法。我个人现在使用`auto`而不是`start`作为此别名（auto => autopilot.js）。
- `alias sscan="home; run scan.js"`
  - 使运行此自定义扫描例程更快一些，它显示整个网络、服务器统计信息，并提供方便的链接以跳转到服务器或后门它们。
- `alias do="run run-command.js"`
  - 这使你可以从终端运行ns命令，例如`do ns.getPlayer()`、`do Object.keys(ns)`或`do ns.getServerMoneyAvailable('n00dles')`
- `alias reserve="run reserve.js"`
  - 不会节省太多击键，但值得强调此脚本。你可以运行例如`reserve 100m`以全局保留此金额。所有具有自动支出组件的脚本都应尊重此金额并保持未支出状态。这在例如你正在存钱购买某些东西（SQLInject.exe、一台大服务器、下一个家庭RAM升级）、存钱在赌场花费等情况下很有用。
- `alias liquidate="home; run stockmaster.js --liquidate; run spend-hacknet-hashes.js --liquidate;"`
  - 快速出售你所有的股票和黑客网络哈希以获取资金，以便你可以花费它（在重置之前很有用）
- `alias facman="run faction-manager.js"`
  - 快速查看你可以购买哪些增强。然后使用`facman --purchase`来触发。
- `alias buy-daemons="run host-manager.js --run-continuously --reserve-percent 0 --min-ram-exponent 19 --utilization-trigger 0 --tail"`
  - 这是如何使用host-manager为你购买服务器的示例。在此示例中，我们愿意花费我们当前的所有资金（--reserve-percent 0）以购买具有2^19 GB RAM或更多的服务器（--min-ram-exponent），即使我们的脚本没有在网络中使用任何RAM（--utilization-trigger 0），
- `alias spend-on-ram="run Tasks/ram-manager.js --reserve 0 --budget 1 --tail"`
- `alias spend-on-gangs="run gangs.js --reserve 0 --augmentations-budget 1 --equipment-budget 1 --tail"`
- `alias spend-on-sleeves="run sleeve.js --aug-budget 1 --min-aug-batch 1 --buy-cooldown 0 --reserve 0 --tail"`
  - 在重置之前，在你已经花费了所有可以花费的增强之后，运行这些脚本中的一个或多个（按你自己的优先级顺序）很有用。
- `alias spend-on-hacknet="run hacknet-upgrade-manager.js --interval 10 --max-payoff-time 8888h --continuous --tail"`
  - 基本上花费大量资金升级黑客网络。如果它花费不够，请进一步增加--max-payoff-time。
- `alias hashes-to-bladeburner="run spend-hacknet-hashes.js --spend-on Exchange_for_Bladeburner_Rank --spend-on Exchange_for_Bladeburner_SP --liquidate --tail"`
- `alias hashes-to-corp-money="run spend-hacknet-hashes.js --spend-on Sell_for_Corporation_Funds --liquidate --tail"`
- `alias hashes-to-corp-research="run spend-hacknet-hashes.js --spend-on Exchange_for_Corporation_Research --liquidate --tail"`
- `alias hashes-to-corp="run spend-hacknet-hashes.js --spend-on Sell_for_Corporation_Funds --spend-on Exchange_for_Corporation_Research --liquidate --tail"`
- `alias hashes-to-hack-server="run spend-hacknet-hashes.js --liquidate --spend-on Increase_Maximum_Money --spend-on Reduce_Minimum_Security --spend-on-server"`
  - 设置哈希以在你负担得起时自动花费在一个或多个事情上很有用。如果你想要自己保存哈希并仅在达到容量时花费它们以避免浪费，请省略--liquidate。
- `alias stock="run stockmaster.js --fracH 0.001 --fracB 0.1 --show-pre-4s-forecast --noisy --tail --reserve 100000000"`
  - 在例如BN8中，将所有现金投资于股票市场并密切跟踪进度很有用。（还保留1亿以在赌场玩二十一点，以便你可以快速积累现金。专业提示：如果你赢了就保存，如果你输光了就重新加载（或者如果你讨厌保存作弊就软重置）以拿回你的钱。）
- `alias crime="run crime.js --tail --fast-crimes-only"`
  - 启动自动犯罪循环。（需要SF4，即Singularity访问权限，就像我的许多脚本一样。）
- `alias work="run work-for-factions.js --fast-crimes-only"`
  - 自动为派系工作。也会根据需要执行犯罪循环。（注意，daemon也会自动启动此脚本）
- `alias invites="run work-for-factions.js --fast-crimes-only --get-invited-to-every-faction --prioritize-invites --no-coding-contracts"`
  - 尝试加入尽可能多的派系，无论你是否从他们那里购买了未购买的增强。
- `alias xp="run daemon.js -vx --tail --no-share"`
  - 以专注于尽可能快地赚取黑客XP收入的方式运行daemon。只有在你拥有大量家庭RAM时才实用。
- `alias start-tight="run daemon.js --looping-mode --recovery-thread-padding 30 --cycle-timing-delay 2000 --queue-delay 10 --stock-manipulation-focus --tail --silent-misfires --initial-max-targets 64"`
  - 让这成为一些脚本可定制性的提示（无需编辑源代码）。当你处于bn末期且你的黑客技能非常高（8000+）时，上述别名非常强大，因此黑客/增长/削弱时间非常快（毫秒）。通过切换到这种`--looping-mode`，你可以大大提高生产力并减少延迟，它创建长期运行的黑客/增长/削弱脚本，这些脚本在循环中运行。此外，更紧密的循环时间使它们更容易发生失火（顺序完成），但添加恢复线程填充（使用增长/削弱线程数的倍数）可以快速从失火中恢复。请注意，如果你还没有足够的家庭RAM来支持如此高的恢复线程倍数，你可以从较低的值（5或10）开始，然后购买更多的家庭RAM并逐步提高。
- `alias ascend="run ascend.js --install-augmentations"`
  - 完成你的节点的好方法。我个人在重置时优先考虑增强，因为我解锁了所有SF奖励，但在你拥有SF11.3以降低增强成本之前，你可能希望使用`--prioritize-home-ram`标志，该标志在购买尽可能多的增强之前优先升级家庭RAM。

## 配置文件

持久自定义配置（script.js.config.txt文件）可以指定以覆盖每个脚本中“args schema”指定的默认参数。

确定参数值的顺序为：
1. 命令行（或别名）中提供的参数优先
2. 如果命令行中没有提供覆盖，则使用配置文件中的任何值。
3. 如果配置文件中没有值，则使用源代码中的默认值（argsSchema）。
   - 请注意，args schema中的某些默认值设置为`null`，以便在脚本的其他地方使用更复杂的默认行为进行覆盖。

### 格式规范
文件应命名为`some-script-name.js.config.txt`（即在你要配置的脚本名称后附加`.config.txt`）

你的配置文件应具有以下两种格式之一
1. 字典格式，例如：`{ "string-opt": "value", "num-opt": 123, "array-opt": ["one", "two"] }`
2. 字典条目数组（2元素数组）格式，例如：`[ ["string-opt", "value"], ["num-opt", 123], ["array-opt", ["one", "two"]] ]` +

你可以使用换行符和空格使内容更易于人类阅读，只要它能够被JSON.parse解析（如有疑问，请在代码中构建它并使用JSON.stringify生成）。

## 自定义脚本代码（高级）

我鼓励你创建一个分支并根据自己的需求/喜好自定义脚本。除非你真正认为这是所有人都能受益的东西，否则请不要向我提交PR。如果你分叉了仓库，你可以更新`git-pull.js`源代码以将你的GitHub帐户设置为默认值，或者通过命令行指定此别名（例如`alias git-pull="run git-pull.js --github mygitusername --repository bitburner-scripts`）。这样你可以从你的分叉自动更新，并仅在准备好时合并我的最新更改。


# 免责声明

这是我自己的Bitburner脚本仓库。
我经常不遗余力地使它们通用且可定制，但绝不是将这些脚本作为对Bitburner社区的“服务”提供。
它是我与朋友分享代码并跟踪我的脚本中的更改和错误的简便方式。

- 如果你希望使用我的脚本或从中复制，请随意！
- 如果你认为你在其中发现了一个错误并想让我知道，太棒了！
- 如果你提出了功能请求、错误报告或拉取请求，而我拒绝采取行动，请不要感到被冒犯。
虽然我喜欢我的工作对他人有帮助并被重用，但我只愿意付出这么多努力来根据他人的特定需求或突发奇想进行定制。
你应该分叉代码，并开始按照你希望的方式调整它。这更符合游戏的精神！

如有任何问题，请访问Bitburner Discord：
- Bitburner Discord邀请：https://discord.com/invite/TFc3hKD
- 这些脚本的频道链接：[Bitburner#alains-scripts](https://discord.com/channels/415207508303544321/935667531111342200)

那里有许多熟悉我的脚本或类似脚本的有帮助的人，他们可以比我能更快地解决你的问题和疑虑。
