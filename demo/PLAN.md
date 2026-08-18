# Demo 实施计划

对应 [PRD/05-里程碑.md](../PRD/05-里程碑.md) 的 M0（原型）与 M1（试玩），以及 [PRD/06-实现计划.md](../PRD/06-实现计划.md) 的 W1–W4。

这一份计划只管 `demo/` 这个目录：Bun + Vite + React 19 + Tailwind v4，先在浏览器里跑通，跑通之后再决定要不要搬回 Tauri 外壳。

## 0. 为什么另开一个目录

仓库里现有的 `src/` 是一个偏 D&D 5e 的聊天程序：工具直接改数据库，房间只存在于手册里，记忆靠聊天记录撑着。要把它就地改成 PRD 描述的样子，等于一边拆承重墙一边住人。

所以先在 `demo/` 里把「权威内核 + 跑团桌」这条纵向切片做干净，让它可玩、可测、可重放；等切片站住了，再把 `src/` 的外壳、设置页和模型接入搬过来。`demo/` 不引入 Tauri，也就没有 Rust 编译这一层，改一行看一眼的循环最快。

## 1. 现在已经完成的部分（M0 切片）

| 能力 | 落在哪 | 状态 |
| --- | --- | --- |
| 状态、事件载荷、意图、检定结果的类型 | `src/engine/types.ts` | 已完成 |
| 带种子的掷骰，种子与回合编号绑定 | `src/engine/rng.ts` | 已完成 |
| 百分骰检定与成功等级 | `src/engine/rules.ts` | 已完成 |
| 事件 → 状态的唯一入口 | `src/engine/events.ts` | 已完成 |
| 原子提交、条件判定、重放、状态哈希 | `src/engine/runtime.ts` | 已完成 |
| 回合路由（保守匹配，匹配不上就追问） | `src/engine/router.ts` | 已完成 |
| 程序裁定：意图 → 候选事件 | `src/engine/resolve.ts` | 已完成 |
| 守秘人叙述与建议行动（确定性模板） | `src/engine/narrate.ts` | 已完成，待换模型 |
| 跑团桌界面 | `src/ui/*` | 已完成初版 |
| 金样冒烟：跑完整条路径并校验重放 | `scripts/smoke.ts` | 已完成 |

跑 `bun run smoke` 会验证四件事：锁着的时候取账本被拒绝并留下事件、开锁之后才能取走和阅读、读夹页扣 5 点理智并完成剧情节点、拿事件记录重放出来的状态哈希与当场一致。

## 2. 接下来的顺序

### D1 — 资料包从代码里搬出来

现在 `src/data/boarding-house.ts` 是 TypeScript 字面量，`storyNodes.doneWhen` 甚至是函数。函数没法存进存档，也没法给模组作者写。

- 把资料包改成 JSON：房间、道具、锁、线索、剧情节点、条件。
- 条件用数据表达（`{"all":[{"flag":"lock.desk.open"},{"has":"item.ledger"}]}`），配一个求值器。
- 加 `bun run pack:lint`：编号唯一、引用可达、出口成对、条件里的标记都有定义。
- 资料包带版本号，事件里引用这个版本号。

**做完的标志：** 手册里的房间与道具改一处，Demo 立刻跟着变，不用改引擎代码。

### D2 — 接上模型，主持人只出叙述

- 定义主持人契约：`clarification` ｜ `context_request` ｜ `action_intent` ｜ `narration`，用 Zod 做联合类型，非法输出直接丢弃且不产生任何副作用。
- `narrate.ts` 的确定性模板降级为兜底：模型失败、超时或结构不合法时照样能出话。
- 上下文只喂三样东西：当前房间的玩家可见事实、背包、未完成的剧情标记。守秘人备注（`keeperNote`）永远不进玩家可见的上下文。
- 3 级复杂行动才走「主持人出 `action_intent` → 程序裁定」；0–2 级仍然由程序直接落实，只调用一次模型生成叙述。
- 重试叙述沿用同一个 `turnId` 和 `state_version`，不重新掷骰，也不重复提交。

**做完的标志：** 把模型换成一只故意乱说的假模型，事件记录和状态不受任何影响。

### D3 — 存档换成真持久化

- localStorage 换成浏览器侧 SQLite（`wa-sqlite` 或 PGlite 一类），表结构照 [PRD/04-技术选型.md](../PRD/04-技术选型.md) §4。
- 检查点记录事件游标、状态版本、状态哈希、资料包引用；快照只当缓存。
- 回滚开新分支，旧分支仍然可以查看，绝不原地改写。
- 界面上给出「导出这一场」的按钮，导出的是事件记录，不是聊天记录。

**做完的标志：** 关掉标签页再打开，能续场；把事件记录导出再导入，状态哈希不变。

### D4 — 跑团桌打磨到能试玩

- 处理状态：提交之前显示「正在检定：书桌锁」，但绝不预报成败。
- 检定尺补上难度档位的解释，让玩家看得懂 45 和 22 是怎么来的。
- 移动端和窄屏下的三栏折叠。
- 一条「叙述与状态冲突」的兜底：叙述里出现状态里没有的事实时，拒绝这段叙述并按同一版本重试。
- 找三个没看过文档的人试玩一次，记录他们卡在哪。

**做完的标志：** 试玩的人说得出它和普通对话框的区别。

## 3. 需要先定下来的问题

1. **检定难度怎么写。** [PRD/03-内容与规则.md](../PRD/03-内容与规则.md) §6 写的是「开锁检定，难度 60」，那是 d20 式的目标值；Demo 现在按《克苏鲁的呼唤》原生的三档难度（普通看技能值、困难看一半、极难看五分之一）实现。两者必须统一：要么 PRD 改成难度档位，要么规则资料包同时支持「目标值门槛」。倾向前者，因为演示走的是百分规则。
2. **Demo 与 `src/` 的归并时机。** 是把 `demo/` 的引擎搬进 Tauri 程序，还是把 Tauri 外壳套到 `demo/` 上？建议等 D2 做完再决定，那时候模型接入的形状才清楚。
3. **浏览器持久化选型。** `wa-sqlite`（贴近未来的 Tauri SQLite）还是 PGlite（开箱即用但体积大）？D3 开工前定。

## 4. 风险

| 风险 | 对策 |
| --- | --- |
| 模型不守契约 | Zod 校验后丢弃，非法对象不产生任何副作用；确定性模板兜底 |
| 快路径误判玩家意图 | 只匹配当前房间里唯一的那个动词与目标，含糊一律追问 |
| 把叙述当成事实来源 | 叙述只读已提交事件；冲突时保状态、改叙述 |
| 资料包与手册各写一份，慢慢对不上 | D1 之后手册直接引用资料包 JSON，单一来源 |
| 范围膨胀（战斗、多人、SRD 检索） | 试玩阶段就三间房，其余一律搁置 |

## 5. 参考实现

下面这些仓库都在 2026-08-18 通过 GitHub API 核对过星数、许可证和最后提交时间。**许可证决定了能抄到什么程度**：MIT／Apache／BSD／公有领域可以直接引入或改写；GPL 与 AGPL 只能读思路，然后自己重写——尤其 AGPL 连「通过网络提供服务」都会触发传染。

### 先看这几个

| 仓库 | 许可证 | 拿它来做什么 |
| --- | --- | --- |
| [assistant-ui/assistant-ui](https://github.com/assistant-ui/assistant-ui) | MIT | 技术栈完全对得上（React 19 + Tailwind + shadcn，CLI 默认就是 Base UI）。它把工具调用渲染成 React 组件的那套「生成式 UI」，正是我们把检定尺嵌进叙述流里的做法。 |
| [lizadaly/windrift](https://github.com/lizadaly/windrift) | MIT | 版式几乎就是我们的目标：叙述正文里嵌选项芯片，旁边跟着剧情状态。用 React 写的，可以直接读代码。 |
| [event-driven-io/emmett](https://github.com/event-driven-io/emmett) | 需核对 LICENSE | `decide(命令, 状态) → 事件` 加 `evolve(状态, 事件) → 状态` 的 decider 模式，与我们的 `resolve` ＋ `applyEvent` 是同一套骨架，可以拿来校正命名和边界。API 没报出 SPDX，引入前先看许可证文件。 |
| [sealdice/sealdice-core](https://github.com/sealdice/sealdice-core) | MIT | 中文社区里唯一宽松许可的 COC 骰子内核。`dice/roll.peg` 是骰式的 PEG 文法，`.setcoc` 把大成功／大失败的判定阈值做成可切换的规则变体——这正是 D1 要的「房规可配置」的形状。Go 写的，移植逻辑即可。 |
| [Miskatonic-Investigative-Society/CoC7-FoundryVTT](https://github.com/Miskatonic-Investigative-Society/CoC7-FoundryVTT) | **GPL-3.0** | 目前最完整的 CoC 七版规则实现：成功等级、奖励／惩罚骰、孤注一掷（pushed roll）、对抗检定、理智损失与临时疯狂、幸运消费。**只读算法，不抄代码。** |
| [edloidas/roll-parser](https://github.com/edloidas/roll-parser) | MIT | 纯 TypeScript、零依赖、带类型化 AST，而且**随机源可注入**——这正是我们「掷骰带种子、可重放」所要求的。作者少，但代码量小，风险可控。 |
| [RSamaium/RPG-JS](https://github.com/RSamaium/RPG-JS) | MIT | TypeScript 生态里唯一把 RPG Maker 那套事件、开关、变量做成一等 API 的项目，可以照着它定我们的剧情标记与事件页模型。 |
| [tinyplex/tinybase](https://github.com/tinyplex/tinybase) | MIT | 一个依赖同时解决响应式存储、撤销重做、查询和持久化（IndexedDB 或 SQLite-WASM），适合 D3 阶段让 Demo 继续留在浏览器里。 |

### 按阶段对应

**D1（资料包出码 + 条件求值）**

- [okaybenji/text-engine](https://github.com/okaybenji/text-engine)（GPL-3.0，只读）：房间、出口、道具、背包的 JSON 模型极简，适合对照我们的资料包结构。
- [y-lohse/inkjs](https://github.com/y-lohse/inkjs) 与 [inkle/ink](https://github.com/inkle/ink)（均为 MIT）：ink 的变量、列表与条件织入，是「剧情标记」这件事最成熟的参考设计。
- [4ian/GDevelop](https://github.com/4ian/GDevelop)（多许可证，按目录核对）：事件表（条件行 → 动作行 + 场景／全局变量）是 RPG Maker 事件页最完善的开源对应物，而且编辑器本身就是 React，D1 之后如果要做条件编辑界面，可以看它。
- [foundryvtt/dnd5e](https://github.com/foundryvtt/dnd5e)（MIT）：成熟的「规则即数据」模型，尤其是哪些字段是作者写的、哪些是派生的，这条界线值得照搬。

**D2（接模型，主持人只出叙述）**

- [SillyTavern/SillyTavern](https://github.com/SillyTavern/SillyTavern)（**AGPL-3.0**，只读）：世界书的关键词注入、人设卡、提示词拼装顺序、上下文预算——我们的线索与剧情标记注入是同一个问题，它踩过的坑最多。
- [SumanasJ/coc-kp-host](https://github.com/SumanasJ/coc-kp-host)（MIT，中文）：给 Claude Code／Codex 用的中文 COC 守秘人技能，重点看它怎么切分「玩家可见」与「守秘人独有」的信息。
- [pineoncellar/glyphkeeper](https://github.com/pineoncellar/glyphkeeper)（Apache-2.0，中文）：自称就是「LangGraph 编排 + 事件溯源的 LLM 守秘人系统」，虽然很早期，但和我们的架构假设最接近。
- [diceframe/diceframe](https://github.com/diceframe/diceframe)（**AGPL-3.0**，中文，只读）：自托管的 AI 跑团引擎，支持 COC／DND、世界书、检定与状态跟踪，当需求清单来读。
- [kwaroran/Risuai](https://github.com/kwaroran/Risuai)（GPL-3.0，只读）：它在回合之间用脚本／正则钩子改状态，可以对照我们的条件触发。

**D3（持久化与分支）**

- [sqlite/sqlite-wasm](https://github.com/sqlite/sqlite-wasm)（SQLite 本体属公有领域）：官方 WASM 构建，OPFS 持久化；注意同步 VFS 需要 COOP/COEP 跨源隔离头，Vite 开发服务器要额外配置。
- [rhashimoto/wa-sqlite](https://github.com/rhashimoto/wa-sqlite)（MIT）：想弄明白浏览器里的 VFS 到底怎么回事，读它。
- [dexie/Dexie.js](https://github.com/dexie/Dexie.js)（Apache-2.0）：如果只是「事件表 + 定期快照」，它是摩擦最小的选择，代价是 IndexedDB 没有 SQL。
- [electric-sql/pglite](https://github.com/electric-sql/pglite)（Apache-2.0）：live query 很诱人，但几 MB 的 WASM 对一个 Demo 偏重。
- [immerjs/immer](https://github.com/immerjs/immer)（MIT）：`produceWithPatches` 能同时给出正向和逆向补丁，可以直接当回滚用；但补丁描述的是状态差异，不是领域事件，**主存的仍应是事件，补丁只当派生**。

**D4（跑团桌打磨）**

- [dungeon-revealer/dungeon-revealer](https://github.com/dungeon-revealer/dungeon-revealer)（ISC）：渐进揭示的地图与标记数据结构，和我们的房间小地图最接近，而且许可证宽松到可以直接搬。
- [hay-kot/obsidian-dnd-ui-toolkit](https://github.com/hay-kot/obsidian-dnd-ui-toolkit)（MIT）：生命值条、属性块、技能表这类人物卡小部件，用声明式 schema 驱动，值得照着做我们的调查员卡。
- [jakobhoeg/shadcn-chat](https://github.com/jakobhoeg/shadcn-chat)（MIT）：shadcn 风格的消息流与自适应输入框，可以直接抄成叙述列。
- [mythal/boluo](https://github.com/mythal/boluo)（**AGPL-3.0**，中文，只读）：把「角色内叙述、角色外闲聊、骰子结果」三类消息在同一条流里区分开的做法，正对我们的叙述列。
- [3d-dice/dice-box](https://github.com/3d-dice/dice-box)（MIT）：3D 骰子，但已经近两年没更新，而且带 WASM 物理引擎，属于锦上添花。

### 顺手记下的坑

- **`teal-dice` 查无此仓库**，3D 骰子用 `3d-dice/dice-box`。
- **塔骰／SinaNya 没有可核实的开源仓库**，只能当成命令兼容目标，不能当代码参考。
- **ccfolia 是闭源商业软件**；可核实的开源对应物是 [flocon-trpg/servers](https://github.com/flocon-trpg/servers)（MIT）。
- **Owlbear Rodeo 2.0 闭源**，`owlbear-rodeo-legacy` 用的是「仅限非营利」的非 OSI 许可证，不能引入；只有 [owlbear-rodeo/sdk](https://github.com/owlbear-rodeo/sdk)（MIT）可用。
- npm 上没有作用域的 `rpg-dice-roller` 是废弃的 v5，要用 `@dice-roller/rpg-dice-roller`。
- 两个仓库路径已经重定向：`oobabooga/text-generation-webui` → `oobabooga/textgen`，`vercel/ai-chatbot` → `vercel/chatbot`。
- [OlivOS-Team/onedice](https://github.com/OlivOS-Team/onedice)（MIT）是中文社区约定的骰式记法**规范**（没有实现）。照它实现，中文玩家习惯输入的命令就能直接用。
