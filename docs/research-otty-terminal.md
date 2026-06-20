# Otty 终端特性调研与借鉴笔记

调研对象：[Otty](https://docs.otty.sh/) —— 一款现代化跨平台终端模拟器
（macOS 用原生 Metal 渲染，Windows 计划用 DirectX 12；当前以 macOS 为主）。
文档站点基于 VitePress，结构清晰，分为 Getting Started / User Interface /
Terminal Features / Working with Agents / Customization / Terminal API (VT) /
Reference 七大板块。下文按「Otty 的做法 → 对 View 的借鉴价值」组织，最后给出
落地优先级建议。

## 1. Otty 是什么

- **定位**：原生渲染、智能面板、配置即代码的现代终端，且把「与代码 Agent
  协作」当作一等公民。
- **三句话亮点**（取自首页）：
  - GPU 加速渲染（Metal / DirectX），无 Electron，支持连字、真彩、内联图片。
  - 面板像你想象的那样工作：标签、分屏、文件/文件夹面板，可拖拽、可重组、
    可原地恢复。
  - 为代码 Agent 而生：Claude Code / Codex / OpenCode 并排运行，实时观察任务，
    可把终端输出直接喂给对话。

## 2. 架构与渲染（值得借鉴的底层思路）

Otty 性能页 (`reference/performance`) 描述的几个关键点对 View 内嵌终端同样适用：

- **逐面板一个 GPU 图层**：macOS 上每个 pane 一个 Metal layer，避免整窗重绘。
  View 的终端是嵌入在 Tauri/WebView 里的，无法直接用 Metal layer，但其「面板
  级独立渲染 + 非活跃资源释放」的思路对应到前端：终端画布应按 pane 独立、
  失焦时降级或暂停高频刷新。
- **亚像素感知的 glyph 缓存**：同一字形只栅格化一次后复用，且缓存按亚像素位置
  区分。这与 AGENTS.md 中「`:root` 用 `optimizeLegibility` 会在小号等宽字体
  上产生连字/字距瑕疵、需在密集等宽容器改 `text-rendering: auto`」的规则呼应——
  即终端/diff/编辑器等密集等宽区域应避免依赖会因位置变化重排的渲染策略。
- **稀疏行网格存储**：只给真正写过的格子分配内存，空行免费。View 在做虚拟滚
  动终端或超大 diff 时可借鉴「只渲染/只存可见与已写入行」的稀疏思路。
- **非活跃标签释放渲染器资源**（`freeze-inactive-tab`）。对应到 View：后台
  不可见的终端/diff 面板应停止高代价的轮询与重渲染，符合 AGENTS.md「resize
  不应让大树/提交列表/diff 每帧重渲染」的方向。
- **回滚行数上限可配**（`scrollback-rows = 10000` 默认）。View 终端应有上限并
  可在设置中调整，防止长任务吃光内存。

## 3. 终端特性（与 View 嵌入式终端直接相关）

### 3.1 Shell 集成（OSC 133）—— 最值得借鉴

Otty 注入小段 shell 钩子，发出 OSC 133（FTCS）提示标记，作为一切「理解命令边界」
功能的基础：

| 序列 | 时机 | 作用 |
| --- | --- | --- |
| `OSC 133 ; A` | 绘制 prompt 前 | 标记 prompt 起始 |
| `OSC 133 ; B` | prompt 之后、输入之前 | 区分 prompt 与用户输入 |
| `OSC 133 ; C` | 命令开始运行 | 输出从此开始 |
| `OSC 133 ; D ; <exit>` | 命令结束 | 记录退出码 |
| `OSC 7 ; file://<host><cwd>` | 每个 prompt | 跟踪 pane 当前目录 |

Otty 自动检测 zsh/bash/fish 并注入；其它 shell 退化为「普通终端」。这些标记驱动了：
命令大纲（Outline/Jump To，每条命令带退出状态：绿✓/红✗/灰点运行中）、
工作目录跟踪、退出状态指示、命令状态徽标。

> **对 View 的借鉴**：View 的嵌入式终端目前若只是裸 PTY，缺少「命令边界」语义。
> 引入 OSC 133 + OSC 7 注入，即可低成本解锁：命令历史与跳转、退出状态、
> pane cwd 同步（可驱动 View 的文件树/diff 自动跟随终端所在仓库与路径）。
> 这是投入产出比最高的一项。

### 3.2 命令进度状态（OSC 9;4）与系统通知

- **进度协议**：ConEmu `OSC 9;4` 报告任务状态（0 清除 / 1 进行中百分比 /
  2 错误 / 3 不定 / 5 Otty 扩展「以退出码完成」）。驱动标签徽标、Dock 动画、
  任务栏进度条。`otty watch <cmd>` 可包裹任意命令获得 spinner→完成徽标；
  shell 集成也可对可配置命令列表自动发进度。
- **桌面通知**：`OSC 9`（仅正文）/ `OSC 777`（标题+正文）/ `OSC 99`
  （kitty 富结构、按 id 替换、能力查询）三套协议都映射为原生通知；
  `BEL` 走系统提示音；非前台时弹通知并 bounce Dock 图标。
- **权限门控**：是否允许 shell 程序发通知 / 响铃，由
  `Notification — Shell Controlled`、`Sound — Shell Controlled` 控制；
  `Sound on Error Exit`（命令非零退出时蜂鸣，依赖 shell 集成）。

> **对 View 的借鉴**：View 长任务（构建、测试、git 操作）跑在嵌入式终端里，
> 解析 `OSC 9;4` 即可在标签/面板上显示进度与完成状态，并配合系统通知，
> 与 Otty 的「Badge When Task Completes / Awaiting Input」体验一致。
> 这是与 View「日志/diff/构建结果」面板天然契合的增强点。

### 3.3 输入与编辑（原生 GUI 体验）

- 把 shell prompt 当作原生 macOS 文本框：`⌘A` 全选、`⌘←/→` 行首行尾、
  自然文本编辑的 caret/word/line 删除都映射成 readline 序列，且每个都是可重绑
  的 keybinding。支持 `⌘Z/⌘Y` 撤销重做、`⌘F` 查找。
- **Click-to-Move**：点击 prompt 把 shell 光标移过去（发送合适数量的方向键，
  跨软换行也正确）。
- **Kitty keyboard protocol**、**IME 国际输入**、**安全输入**。
- **只读模式（Read-only）**：锁住 pane，键盘/粘贴/点击移动/鼠标上报/拖拽全阻断，
  但输出继续流、可滚动可复制可搜索。用于长任务或把窗口交给他人查看。
  Vi/Hint 模式临时隐藏只读锁（它们自己的键位驱动选区）。

> **对 View 的借鉴**：View 终端若想做到「桌面工具感」，应补齐原生编辑快捷键
> 的等价映射与可重绑定性；只读模式对一个常驻、可能跑长任务的终端非常实用，
> 成本低、收益明显。Click-to-Move 对在 diff/日志间快速跳转也有参考价值。

### 3.4 Hint 模式（键盘导航）

- Vimium 式：按一个快捷键，所有可点击目标打上 2 字母标签，输入标签即「点击」。
- 可 hint 的目标：文件路径（绝对/`~`/相对，与 Files-and-Links 同集）、URL、
  Git commit hash（`[0-9a-f]{7,}` 带仓库上下文）、IP 地址、**用户自定义正则**。
  自定义示例：`hint-pattern = "TICKET-\\d+"`，并用
  `hint-pattern-action = "open https://linear.app/team/issue/{0}"` 定义动作，
  `{0}` 取匹配文本。
- `hint-to-open` / `hint-to-copy` / `hint-to-reveal-in-finder` 三类动作。

> **对 View 的借鉴**：View 本身是 Git 客户端，终端输出里大量出现 commit hash、
  路径、`file:line:col`。借鉴「对 commit hash 做 hint/点击 → 跳转到 View 的
  commit/diff 视图」、对路径做 hint → 跳到 View 文件树/diff，是把终端与 Git
  视图打通的高价值特性。自定义正则 + 动作模板也很灵活，可做成可配置项。

### 3.5 Vi 模式 / 选区 / 复制粘贴

- **Vi 模式**：`⌃⇧Space` 进入，键不转发给 shell 而是在 scrollback 里移动光标；
  支持数字前缀（`5j` 下移 5 行）、完整 motion、可视选区；有 pill 状态指示与
  `⌘/` 键位提示栏。
- **选区**：双击选词、三击选行、`⌥`+拖拽矩形选、`⇧`+点击扩展、`⇧`+方向键
  按字符/行扩展（`⌥` 变矩形）。程序开鼠标上报时 `⌥` 强制原生选区。
- **复制粘贴**：`Copy on Select`、`Clipboard Trim Trailing Spaces`、
  `Clear Selection on Copy`；自动 bracketed paste；**粘贴保护**对多行/尾换行/
  `sudo`/控制字符给出预览确认（TUI 全屏与已声明 bracketed-paste 的程序跳过检查）；
  `Paste as…`（选区/Base64 文件/Shell 转义/强制 bracketed/送入 Composer）。

> **对 View 的借鉴**：粘贴保护对一个会执行 `git` 等命令的终端很有价值，建议补
> 「危险粘贴预览确认」；矩形选区、`Copy on Select`、裁剪尾空格都是低成本体验
> 提升。Vi 模式优先级可后置，但可作未来增强。

### 3.6 文本与图形渲染

- 全 Unicode（U+0000–U+10FFFF）：组合符叠加、CJK 全角占双格、RTL/BIDI、
  彩色 emoji（ZWJ 家族/修饰符/国旗变单图、变体选择符）、
  East-Asian-Ambiguous 按块可配置加宽（默认加宽 ①②③Ⓐⓐ 修复 macOS 常见错位）。
- **连字**：可设 none / 标准-上下文 / discretionary，默认仅在符号串上触发，
  不动字母数字。
- **内嵌 Nerd Font**：自动用于 PUA 图标，Powerline/文件类型/Git 状态/Starship
  等开箱即用，无需额外安装字体。
- **盒绘（Box Drawing）**：盒绘/方块/盲文/Powerline 字形用解析绘制而非字体
  栅格化；箭头/三角形与连接线无缝拼接（可关闭）。对比图显示优于 Ghostty/Terminal.app。
- **内联图片**：iTerm2 OSC 1337 与 Kitty graphics 协议；Kitty 支持光标定位、
  单元格尺寸、z-index、按 id 删除/替换，共享内存传输为 planned。

> **对 View 的借鉴**：View 的终端若基于 `xterm.js` 一类前端终端，连字、emoji、
> 盒绘的解析绘制多由底层库处理；重点借鉴的是「内嵌 Nerd Font / PUA 图标免配置」
> 的体验，以及 East-Asian-Ambiguous 加宽策略——后者直接影响 View 在中文环境
> 下 diff/日志的表格对齐。AGENTS.md 已强调密集等宽容器的渲染策略，这里需一并
> 处理连字与对齐。内联图片对「在终端里看图片预览」是锦上添花，优先级低。

### 3.7 `$TERM` 与身份识别

- 默认 `term = auto` → `xterm-256color`（保守、到处都有、覆盖行编辑所需能力），
  真彩通过 `COLORTERM` 单独声明；设其它值会先校验 terminfo 是否存在，否则回退。
- **明确警告**：不要把 `term` 设成 `xterm-kitty`/`xterm-ghostty` 妄图继承功能
  —— `TERM` 选的是能力数据库而非行为，谎称别的终端会让程序发出不支持的序列。
  Otty 通过设备属性与查询序列声明真实能力。

> **对 View 的借鉴**：View 内嵌终端的 `TERM` 设置应同样保守且可校验回退，
> 避免因 `TERM` 错误导致 SSH/`less` 下行编辑错乱。可写进 AGENTS.md 的 Tauri/Rust
> 约束里作为一条注意事项。

## 4. 用户界面（窗口/标签/分屏/面板）

### 4.1 三级嵌套：window → tab → pane

- pane 是叶子（终端/文件/文件夹/URL），window/tab/split 是容器。一个 tab 内可
  split 成多个 pane。标签、分屏、面板皆一等公民，可拖拽重组、移到别的窗口、
  撕成新窗口。
- **文件/文件夹/URL pane**：不只是终端 pane，目录可作「文件夹面板」浏览，
  文件可作「文件面板」查看/编辑，URL 可作「网页面板」。与 View「文件树/编辑器/
  diff/终端」多面板理念高度一致。
- **拖拽**：从 Finder/浏览器拖入，聚焦 pane 显示四边投放目标，每边分内外两半：
  内侧(绿)=以该路径开新终端，外侧(蓝)=作面板（目录→文件夹面板，文件→文件面板，
  URL→URL 面板）；文本片段内侧粘贴、外侧同。View 自己的 tab/pane 也可拖拽重排、
  跨窗移动、撕出。

> **对 View 的借鉴**：View 已是「Git/项目/终端/编辑器/设置/树/diff 多面板」
> 应用，思路天然契合。可借鉴：拖拽投放目标的双语义（终端 cwd vs 面板查看）、
> 撕出/跨窗拖拽、以及「文件面板/URL 面板」这类非终端 pane 概念，让「在 View 内
> 查看 agent 改动的文件」更顺滑。

### 4.2 Details Panel（右侧上下文面板）

- 跟随聚焦 pane 更新，含四页：
  - **Info**：cwd、运行中进程列表、监听端口、快速「打开方式」。
  - **Outline**：终端/agent pane 列命令标记与 agent prompt；文件 pane 列
    Markdown/HTML 目录、diff 改动文件列表、JSON/YAML/TOML 顶层键、`.jsonl` 转录 prompt。
  - **Git**：仓库概要 + 工具栏 + 改动文件列表（悬停操作）+ 内联 diff 查看器；
    可在设置配置默认 Git 客户端。
  - **Files**：以聚焦 pane 的 cwd 为根的文件树，免开文件夹面板的快速浏览。

> **对 View 的借鉴**：这是最贴合 View 的设计——View 本身就有 diff、文件树、
> git status。值得借鉴的是「面板跟随聚焦 pane 的 cwd/git 上下文」的联动：
> 在终端里切到某仓库某目录，Details 的 Git/Files 就跟随；以及 Outline 把
> 命令历史/agent prompt 列成可跳转大纲。监听端口列表对开发场景也很实用。

### 4.3 Open Quickly / Command Palette / Outline / Find

- **Open Quickly**（`⌘⇧O`，Xcode 式）：一个输入框模糊搜索一切可跳转目标——
  打开的标签、最近会话、常用文件夹、SSH 主机、agent 会话、聚焦 pane 的命令与
  链接、保存的 recipes。8 个 filter（All/Opened/Recent/...）可 `Tab` 循环。
  `⌘J` 是「跳到当前 pane」的快捷版（其命令、链接、大纲）。
- **Command Palette**（`⌘⇧P`，VSCode 式）：搜索并执行任意 action（含无快捷键者），
  每个 action 标注 pane/window/app 作用域。
- **Outline / Jump To**：基于 OSC 133 标记的 per-pane 命令索引（带退出状态），
  右侧大纲面板可右键跳转或复制；agent 会话还列历史 prompt。
- **Find**（`⌘F`）：在聚焦 pane 的可见缓冲与 scrollback 内搜索，实时高亮 +
  `N of M` 计数；文件 pane 搜整文件，文件夹 pane 只搜文件名。

> **对 View 的借鉴**：Command Palette 与 Open Quickly 是「桌面工具感」的标配，
> 值得引入；View 已有 diff/树/提交等结构化数据，把「命令/链接/改动文件」纳入
> 统一跳转器会很顺手。Find 跨 scrollback + 文件 + 文件名的分层 scope 设计可借鉴。

## 5. 与代码 Agent 协作（View 可重点参考的差异化方向）

Otty 把 Claude Code / Codex / OpenCode 当作「在终端里自己跑的 CLI」，只通过
注入钩子/插件让 Agent 把状态汇报给 Otty，从而点亮徽标/通知/历史/fork。

### 5.1 接入方式

- Otty 不替你跑 agent，你照常用 `claude`/`codex`/`opencode`。
- 首次需要时，Otty 请求一键往 agent 自身配置写入：
  - Claude Code → `~/.claude/settings.json`（hooks）
  - Codex → `~/.codex/hooks.json`（+ `config.toml` 里 `hooks = true`）
  - OpenCode → `~/.config/opencode/plugins/`（plugin）
- 只写它自己的条目，其余不动；可一键卸载。
- 重启 agent 后，标签徽标/通知/历史/fork 自动生效。

> **对 View 的借鉴**：View 若要支持 agent，应走「不替换用户 CLI，只注入状态钩子」
> 的轻量路线，单一职责、可卸载、不碰用户其它配置——这与 AGENTS.md「Tauri 命令
> 集中、返回类型化结构、不 panic」的工程取向一致。

### 5.2 Composer（多行输入面板）

- agent 会话的输入：多行编辑、光标操作、撤销重做、浮置面板、图片粘贴。
- `⌘↩` 发送（发送后清空草稿）；`↩`/`⇧↩` 插入换行（默认多行，不会误发半句）；
  `⎋` 取消但保留草稿；最大高度后内部滚动。
- 富粘贴：`⌘V` 把剪贴板 HTML/RTF/图片转 Markdown，`⇧⌘V` 纯文本。
- **Pin**：切到非 agent tab 时草稿暂存、回来恢复；pinned 则跨 tab 常驻。
- **Float Panel**：撕成 Spotlight 式浮窗，置顶但不抢菜单栏，可边看别的 app 边起草。
- **Add to Queue**（`⌥⌘↩`）：把草稿送入 Prompt Queue 而非立即发送，每行成一条
  排队命令在下次空闲 prompt 自动触发。
- 可在任意普通终端用 `⌘⇧E` 打开 Composer。

### 5.3 Monitor Tasks / Prompt Queue / Send to Chat / History / Fork

- **Monitor Tasks**：每 tab 独立的徽标/通知开关（Badge While Processing /
  Task Completes / Awaiting Input；对应通知同义项），徽标聚焦 tab 自动清除；
  **Prevent Sleep While Processing** 按 tab 持有唤醒锁，agent 空闲即释放；
  Queue next command 在下次空闲 prompt 自动派发（依赖 shell 集成、仅 prompt
  为空时触发，避免覆盖正在输入的内容）。
- **Prompt Queue**（`⌘⇧M`）：底部输入栏排队多条 prompt，逐条在空闲 prompt 派发；
  可拖拽重排、点击回填 Composer、`✕` 删除；普通终端也可用于「忘了链式命令时」
  事后追加。
- **Send to Chat**（右键或 `⌘⌃↩`）：把终端选区/上一条命令输出/文件片段作为
  引用上下文送到活动或新建 agent 会话；多会话时弹出选择器，默认上次会话。
- **Agent History**：每个会话都捕获且可搜；把 `~/.claude/...`、`~/.codex/...`、
  `~/.local/share/opencode/...` 的 `.jsonl`/`.json` 渲染成可读转录而非原始 JSON；
  可右键 View as 切回 JSONL 语法高亮；Resume 按钮用 agent 的 `--resume` 续跑
  （保留原 provider/model/system prompt）。
- **Fork / Branch**：把会话历史复制到某点分叉成新会话，落到新 tab 或 split，
  两线程并行；走各 agent 自己的 `/branch`(Claude) `/fork`(Codex/OpenCode)。

> **对 View 的借鉴**（这是 Otty 最差异化、也最值得 View 思考的方向）：
> View 作为 Git 客户端，与 Agent 协作的高价值点不在于「再造一个输入框」，
> 而在于把 **终端输出/git 状态/diff/文件** 当作可送入会话的上下文，以及把
> **会话状态映射到 git 概念**（commit hash hint→commit 视图、改动文件→diff、
> 会话历史→可恢复）。若 View 未来集成 agent，优先实现：
> - 任务徽标/通知（依赖 OSC 9;4 + 钩子，复用 §3.2）；
> - Send to Chat 式「把 View 的 diff/选区/路径作为上下文送入会话」；
> - 会话历史可恢复（与 View 的项目持久化 `src/lib/projects.ts` 结合）。
> Composer、Prompt Queue、Fork 属于体验增强，可在基础打通后再做。

## 6. 配置与定制化

- **配置文件**：`~/.config/otty/config.toml`，Ghostty 式 `key = value` 逐行
  （`.toml` 后缀但并非真 TOML，值是裸的，引号可选并被剥离）；未知键静默忽略，
> 使新版本配置在旧版上仍可加载。多数键也可在 Settings GUI 编辑（GUI 写同一文件）。
- **主题**：可在主菜单/命令面板/设置面板/CLI(`otty theme list|set`)/配置文件
  五种方式切换；支持跟随 OS 明暗自动切换且实时生效（`theme` 明槽 +
  `theme-dark` 暗槽）。
- **字体/快捷键/自定义命令**：均有对应页面与可重绑的 keybinding 体系；
  autocomplete 有 6 个 `autocomplete-*` 键（快捷键接受、候选面板触发、内联
  ghost text、本地学习开关、历史忽略 glob、描述语言）。

> **对 View 的借鉴**：View 已有 `src/lib/settings*` 与 `src/components/settings`，
> 可借鉴 Otty 的「配置文件热重载 + GUI 写同一文件」一致性原则，以及「明/暗双
> 主题槽跟随 OS」的体验；这与 AGENTS.md「复用既有 design tokens 与 Pierre
> 暗色主题、不引入一次性调色板」相符。

## 7. Autocomplete / Inline Suggest

- 监听 shell prompt 行自动给出建议：停顿片刻后最可能的续接以暗淡 ghost text
  出现，多个候选时在光标下方开候选面板。
- 基于 Fig 兼容的 spec 数据库（700+ CLI 工具）+ Otty **端侧学习**（历史、
  `--help` 探测、README 扫描，全部留在本机）。
- 隐私：`autocomplete-on-device-learning` 主开关；`autocomplete-history-ignore`
  glob 模式排除（如 `ssh *`、`export *TOKEN*`）。

> **对 View 的借鉴**：View 终端若要做补全，端侧学习 + 历史忽略的隐私设计值得
> 参照；但这属于较重特性，优先级应低于 shell 集成与任务徽标。

## 8. VT 协议参考（Terminal API）

Otty 把 VT 协议做成可查文档：C0 / ESC / CSI / OSC 各序列逐条说明，并标注
是否支持（如 Kitty graphics 共享内存传输 = planned、OSC 88 终端恢复协议 =
proposal）。这是其「真彩、连字、图片、进度、通知、shell 集成」特性背后的
协议基座。

> **对 View 的借鉴**：View 内嵌终端若基于成熟库（如 xterm.js），不必自建 VT
> 解析；但若需自行处理 OSC 133/7、OSC 9;4 等业务相关序列，可参考 Otty 的
> 「能力声明 + 渐进支持」原则：先实现最关键的 OSC 133/OSC 7/OSC 9;4，其余
> 列为 planned/proposal，避免谎称支持导致程序误用。

## 9. 落地优先级建议（针对 View）

按「投入产出比 × 与 View 定位的契合度」排序：

1. **Shell 集成（OSC 133 + OSC 7）** —— 命令边界、退出状态、cwd 同步。
   解锁后续几乎所有增强；建议作为 View 终端增强的第一步，并让 pane cwd
   驱动文件树/diff 跟随终端所在仓库与路径（契合 AGENTS.md 关于 git status
   各情形的考量）。
2. **任务进度与通知（OSC 9;4 + 桌面通知）** —— 长构建/测试/git 任务的可视化
   与完成提醒，与 View 的日志/diff 面板天然契合。
3. **路径/commit hash/链接的点击与 hint** —— 打通「终端输出 ↔ View 的
   commit/diff/文件树」，把终端从孤岛变成 View 各视图的入口。
4. **Command Palette + Open Quickly** —— 桌面工具感标配，复用 View 已有的
   结构化数据（提交、改动文件、命令）做统一跳转。
5. **Details 式上下文面板联动** —— 面板跟随聚焦 pane 的 cwd/git 上下文，
   Outline 列命令历史与 agent prompt。
6. **粘贴保护 + 矩形选区 + Copy on Select** —— 低成本体验提升。
7. **配置热重载 + 明/暗双主题槽 + 字体策略** —— 与现有 settings 体系整合。
8. **（远期）Agent 协作**：任务徽标、Send to Chat、会话历史可恢复，走「不替换
   用户 CLI、只注入状态钩子」的轻量路线。

## 10. 几点需要注意的差异

- Otty 是原生应用（Metal/DirectX），View 是 Tauri + React/WebView；其 GPU 图层、
  glyph 缓存等底层优化不能直接照搬，应映射为前端的「面板级独立渲染、非活跃降级、
  密集等宽容器渲染策略」。
- Otty 的 macOS 原生编辑快捷键依赖系统能力，View 跨平台需考虑 Windows/Linux
  的键位映射与不可用能力（与 AGENTS.md「跨平台文件操作需考虑 Windows 无效名/
  分隔符/保留名/绝对路径捷径」同理，输入层也要跨平台）。
- Otty 的 agent 集成深度依赖各 agent 的 hook/plugin 机制与 session 文件路径，
> View 若集成需逐个适配且要随上游变化维护。

## 参考

- 首页与总览：https://docs.otty.sh/
- 终端特性：https://docs.otty.sh/terminal-features/shell-integration 等
- 用户界面：https://docs.otty.sh/user-interface/details-panel 等
- 与 Agent 协作：https://docs.otty.sh/agents/agents-overview 等
- 配置与性能：https://docs.otty.sh/reference/configuration 、
  https://docs.otty.sh/reference/performance
- VT 协议参考：https://docs.otty.sh/vt/osc/osc-133 等
