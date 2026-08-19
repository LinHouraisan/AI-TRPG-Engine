# Demo 实施计划

对应 [PRD/05-里程碑.md](../PRD/05-里程碑.md) 的 M0（原型）与 M1（试玩），以及 [PRD/06-实现计划.md](../PRD/06-实现计划.md) 的 W1–W4。

这一份计划只管 `demo/` 这个目录：Bun + Vite + React 19 + Tailwind v4。D1–D4 已完成。下一档不是继续在浏览器里加功能，而是对照 [`docs/05-implementation-design/`](../docs/05-implementation-design/README.md) 把内核搬进 V1 主进程（见 PRD W0）。相对 W1–W4：已完成；相对 V1 Accepted：还没有。

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
| 资料包出码成 JSON，条件写成数据 | `src/data/packs/`、`src/engine/{schema,pack,conditions}.ts` | 已完成（D1） |
| 按目录扫描模组，坏包只让自己不可用 | `src/engine/pack.ts`、`src/data/packs/*/` | 已完成（D1 遗留） |
| 资料包体检：模式校验加引用完整性 | `scripts/pack-lint.ts` | 已完成（D1，已改成逐份汇报） |
| 主持人契约、上下文、叙述体检、模板兜底 | `src/keeper/*` | 已完成（D2） |
| 假模型契约测试，外加真机试跑 | `scripts/keeper-check.ts` | 已完成（D2） |

跑 `bun run smoke` 会先给资料包做一次体检，再验证四件事：锁着的时候取账本被拒绝并留下事件、开锁之后才能取走和阅读、读夹页扣 5 点理智并完成剧情节点、拿事件记录重放出来的状态哈希与当场一致。

## 2. 接下来的顺序

### D1 — 资料包从代码里搬出来（已完成）

原先 `src/data/boarding-house.ts` 是 TypeScript 字面量，`storyNodes.doneWhen` 甚至是函数。函数没法存进存档，也没法交给模组作者写。现在的做法是：

- 资料包改成 `src/data/packs/boarding-house/` 下的八个 JSON：模组信息、房间、道具、锁、线索、NPC、剧情节点、条件。
- 条件与节点完成条件都用数据表达（`{"all":[{"flag":"lock.desk.failed"},{"clockGte":3}]}`），`engine/conditions.ts` 负责求值，且只读已经提交的状态。
- 条件的效果只能是引擎认得的事件，所以条件里写不出「凭空改一个数」。
- 作者写的叙述（观察说明、开锁成败、读到夹页之后那句）跟着事件走，`narrate.ts` 只在作者没写的地方退回通用模板。
- `bun run pack:lint` 查编号唯一、引用可达、出口成对、条件与节点引用的东西都有定义；错误一律不给过，提醒只打印。
- 资料包带版本号（`boarding-house@0.2.0`），检定的种子和存档都引用它；资料包换了版本，旧存档直接拒绝读取。
- 字段规范写成了文档：[`src/data/packs/SPEC.md`](src/data/packs/SPEC.md)。可见性（`hidden`／`revealedWhen`／`lockedBy`）是其中最要紧的一节——谁看得见什么由作者声明，引擎照着执行，防泄底不靠提示词。故事编辑器将来照这份规范生成资料包，也照它给作者报错。

**已补上：** 引擎用 `import.meta.glob` 扫描 `src/data/packs/*/`，齐了八个 JSON 的目录都算一份模组。`listPacks()` 列出编号、标题、版本和条目数量，坏掉的那份只标成不可用；`loadPackById` 按编号加载并校验。`pack` 与 `packIndex` 仍指向当前生效的那一份（默认 `boarding-house`），引擎其余文件不用改。仓库里另有一份《雨夜照相馆》作为第二份样本。

### D2 — 接上模型，主持人只出叙述（已完成）

主持人现在接本地 Ollama（默认 `qwen3.8:latest`），代码在 `src/keeper/`。契约分成两次调用，都是平铺结构——嵌套联合类型对小模型太难，摊平之后它几乎不会写错：

- **路由**（`{verb, target, text}`）：只有保守匹配认不出来的那句话才轮到模型，而且它给的编号还要再过一遍在场检查，挑了个不在这儿的东西照样作废，转去追问。
- **叙述**（`{text}`）：模型只把已经提交的事实讲成人话。

守住边界的是这几层，缺一不可：

- 上下文只放玩家此刻感知得到的东西（`keeper/context.ts`）。守秘人备注与还没拿到的秘密线索根本不进提示词——模型说不出它没见过的东西，这是结构上的保证，不是靠提示词求它别说。
- 叙述回来还要过一遍体检（`keeper/guard.ts`）：出现了这一刻不该出现的人或物、报出了没掷过的数字、说出戏的话，一律退回重写；两次不过就用模板。
- 模型失败、超时、返回的不是 JSON、字段不合契约，全部退回确定性模板，一场团不会因为模型卡住。
- 「换一种说法」重讲的是同一批已提交事件，不重掷骰子，状态版本也不动——因为骰子在提交那一刻就定死了。

`bun run keeper:check` 把模型换成一只故意乱说的假模型（不给 JSON、编造女房东、报出没掷过的 97、挑一个不存在的编号），九项断言证明事件记录一条没多、状态哈希一点没变；机器上有 Ollama 时，它还会再跑一遍真机。

**遗留：** 上下文还没有预算控制（房间一多就得裁剪）；模型只在回合末尾被调用一次，没有流式输出。

### D3 — 存档换成真持久化（已完成）

选型定了：官方的 `@sqlite.org/sqlite-wasm`，走 kvvfs——数据库本身落在 localStorage 里，不需要跨源隔离头，也不必先搭一套 Worker。等 Demo 搬进 Tauri，这一层换成真正的 SQLite 文件，上面的仓储代码一行都不用改。

已经落地的部分（`src/store/`）：

- 表结构是 [V1 Persistence](../docs/05-implementation-design/03-persistence.md) Campaign DDL 的子集：`campaign`、`branch`、`event`、`checkpoint` 是权威的，`message` 只是让叙述读起来连贯，读档从不依赖它。还缺 `turns`、`operations`、`state_entities`、`rule_decisions`、`narrations`。
- 事件的不可修改由触发器钉死：`UPDATE` 和 `DELETE` 直接 `RAISE(ABORT)`，重复写同一条被主键挡住。不靠自觉。
- 检查点记着事件游标、状态版本、状态哈希、资料包引用；快照只当缓存。
- 回滚不改历史：从那一刻分出一条新分支，把之前的事件原样搬过去，旧分支一个字都不动。
- 导出的是事件记录而不是聊天记录，换一个库导入之后重放，状态哈希仍然一致。
- 驱动做了抽象：浏览器用 sqlite-wasm，脚本用 `bun:sqlite`，SQL 是同一份——存储层最怕的就是「只有真在浏览器里点一遍才知道对不对」。`bun run store:check` 十五项断言全部覆盖上面这些。

D1 留下的「按目录扫描模组」已经做完。`session.ts` 也接上了仓储：自动续场、每次提交落盘、回滚另起分支，界面上有时间线、分支面板和模组选择器。对话记录只让叙述读起来连贯，读档从不依赖它——**程序自己产生的提示（续场、切分支、落盘失败）根本不进库**，判据是 `role === "system"` 一律不是对话，写时拒收、读时滤掉。

**做完的标志（已达成）：** 关掉标签页再打开能续场；把事件记录导出再导入，状态哈希不变。

### D4 — 跑团桌打磨到能试玩（已完成）

- 提交之前显示「正在检定：书桌锁（开锁 45／普通 45）」：门槛公开，成败绝不预报。这份待检定信息由 `session` 在掷骰之前交出来，类型里就没有点数与成败。
- 检定尺可以展开自证：普通看技能值、困难看一半、极难看五分之一，以及大成功与大失败的阈值。门槛只在 `engine/rules.ts` 算一次，界面不重算。
- 窄屏三栏折叠成底栏四项，375 像素下没有横向滚动。
- 「叙述与状态冲突」的兜底在 D2 就有（`keeper/guard.ts`），D4 又补了一类：模型替玩家把没做过的动作做完，一律退回重写。
- 主持人边写边出字：草稿以「未定稿」的样子显示，定稿才进记录、才落盘，体检不过就整段收回。
- 上下文用量面板：并排显示预估与上一回合实发，作者看得见预算花在哪。

**还差：** 找三个没看过文档的人试玩一次，记录他们卡在哪。这件事没法由程序代劳。

**做完的标志：** 试玩的人说得出它和普通对话框的区别。

## 3. 需要先定下来的问题

1. **检定难度怎么写。** [PRD/03-内容与规则.md](../PRD/03-内容与规则.md) §6 写的是「开锁检定，难度 60」，那是 d20 式的目标值；Demo 现在按《克苏鲁的呼唤》原生的三档难度（普通看技能值、困难看一半、极难看五分之一）实现。两者必须统一：要么 PRD 改成难度档位，要么规则资料包同时支持「目标值门槛」。倾向前者，因为演示走的是百分规则。
2. **Demo 与桌面的归并。** V1 Draft 已经回答「怎么合」：权威在主进程，渲染只走 `DesktopApi`。还没回答的是外壳——V1 写 Electron，仓库里是 Tauri。这是程序决策，不是时间问题。没写成 Accepted 之前，Demo 继续当参考实现，不要把内核塞进渲染进程直连的 `plugin-sql`。
3. ~~**浏览器持久化选型。**~~ 已定：官方 `@sqlite.org/sqlite-wasm` 走 kvvfs。PGlite 为了一个三间房的 Demo 背几 MB 的 WASM 不值当；OPFS 虽然更正经，但要跨源隔离头加 Worker，等真需要更大的库再换——驱动已经抽象出来了，换的时候只动一个文件。

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
