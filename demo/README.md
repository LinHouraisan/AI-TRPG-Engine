# AI TRPG Engine · 试玩 Demo

《寄宿公寓账本》的一次性模组切片，用来证明这不是给聊天窗口套了层皮：掷骰、房间、道具、剧情标记全部由程序掌管，叙述只能引用已经提交的事实。

技术栈是 Bun + Vite + React 19 + Tailwind CSS v4 + TypeScript，不依赖 Tauri，浏览器里就能跑。

相对 [PRD W1–W4](../PRD/06-实现计划.md) 已经做完。相对 [V1 模块实现设计](../docs/05-implementation-design/README.md) 还只是子集：事件信封更扁、没有 `turns`／`state_entities`／`rule_decisions` 表、资料包是八个 JSON 而不是带哈希的 `.scenario-pack`、掷骰是 mulberry32 而不是 `xoshiro256ss-v1`。下一步见 PRD **W0**，不要把这套浏览器库当成 V1 验收。

## 跑起来

```bash
cd demo
bun install
cp .env.example .env.local   # 填上 Ollama 的地址
bun run dev            # http://localhost:1421
bun run pack:lint      # 资料包体检：模式校验加引用完整性
bun run keeper:check   # 主持人契约测试：假模型怎么乱说都动不了状态
bun run store:check    # 存储层测试：改不动、删不掉、重放一致、回滚分支
bun run smoke          # 上面几项加金样冒烟，跑完整条路径并校验重放
bun run build          # tsc -b && vite build
```

## 主持人接哪

守秘人叙述接本地 [Ollama](https://ollama.com)，默认模型 `qwen3.8:latest`，地址在界面右上角随时能改。浏览器直连 Ollama 会撞跨域，所以开发时统一走 Vite 代理：把主机写进 `demo/.env.local` 的 `OLLAMA_URL`，前端请求 `/ollama` 就行。

把主持人关掉，Demo 退回确定性模板照样能玩——回合、掷骰、事件记录一点都不依赖模型。

## 这一版做到了什么

- 一条完整的回合链路：玩家说话 → 回合路由 → 程序裁定 → 原子提交 → 守秘人叙述。
- 检定是百分骰（1d100），按《克苏鲁的呼唤》第七版的成功等级判定，点数只能来自程序。
- 掷骰带种子，并且与回合编号绑定，所以重试叙述不会改变已经掷出的点数。
- 事件记录只追加，载荷是纯数据，状态只能通过 `applyEvent` 改变——因此任何一个数字都追得回它的来源。
- 存档落在浏览器里的 SQLite（`@sqlite.org/sqlite-wasm`，kvvfs）：每提交一个回合就追加事件、写检查点，刷新页面自动续场。续场走的是重放，再拿检查点的哈希对账，对不上就明说，不假装续上了。
- 事件写进去就改不动也删不掉，这一条由数据库触发器钉死，不靠自觉。
- 回到某一版不会抹掉后面的事：它从那一刻分出一条新分支，原来那条一个字不动，随时能切回去看。
- 导出的是整场事件记录而不是聊天记录，换一台机器导入再重放，状态哈希仍然一致；资料包版本对不上会直接拒绝导入。
- 条件在提交之后判定，需要立即生效的并进同一笔提交（例如撬锁出声之后，女房东下楼守在门厅）。
- 建议行动只是省事，自由输入随时可用；路由匹配不上就追问，绝不靠关键词硬猜。
- 查询类提问（背包、人物卡、线索、团内时间、出口、刚才发生了什么）只把玩家已经知道的事再讲一遍：不掷骰、不提交、也不消耗团内时间。
- 谁看得见什么，是资料包里的字段（`hidden`／`revealedWhen`／`lockedBy`），不是引擎里的暗规。藏着的东西不出现在房间描述、建议行动、界面清单里，也不进模型的上下文，因此谁都没法提前把它说出来。玩家自己猜着名字点它，得到的回答和不存在的东西一样——「这里没有那样东西」。
- 拿锁去保护一件本来就看得见的东西，属于作者写反了，`pack:lint` 会当场指出来；这条查错本身也有自检，故意写坏几处看它认不认得出来。
- 玩家叫得出名字的东西，路由一律认得出；在不在场、够不够得着，交给裁定去回答。把「不在场」当成「听不懂」只会让人一头雾水。
- 模组写在 JSON 资料包里，引擎里没有一处写死的房间、道具或剧情。条件也是数据，作者写不出「气氛到了」这种没法检验的触发条件。
- 主持人是本地模型，但它只干两件事：把玩家的话认成意图，把已提交的事实讲成人话。它给的编号要过在场检查，它写的叙述要过体检——出现这一刻不该出现的人、报出没掷过的点数、替玩家把没做过的动作做完（「你拿起账本翻开」），一律退回重写，两次不过就用模板。
- 「换一种说法」重讲的是同一批已提交事件：不重掷骰子，状态版本也不变。

## 资料包

一份模组就是 `src/data/packs/<模组编号>/` 下的八个 JSON。仓库里可以并排放多份，引擎按目录扫描，不需要为换模组改代码。加载时先过 Zod 模式，再查引用完整性。坏掉的那一份只会被标成不可用，其它完好的照常列出；真正拿来开团的那一份有一处错误就拒绝，不做静默降级。字段规范写在 [`src/data/packs/SPEC.md`](src/data/packs/SPEC.md)，将来的故事编辑器也照它生成与报错。

目前有两份：`boarding-house`（《寄宿公寓账本》，默认开这一份）和 `photo-studio`（《雨夜照相馆》，用来证明扫描是真的在扫）。界面上的模组选择器会整页重载来切包，避免一半旧一半新。V1 的 ZIP 资料包格式见 [14-content-system](../docs/05-implementation-design/14-content-system.md)；当前 `SPEC.md` 是编辑器能用的扁平规范，不是最终分发格式。

```
src/data/packs/<模组编号>/
  pack.json        模组信息、开场白、预组调查员
  rooms.json       房间与出口
  items.json       道具：别名、观察说明、守秘人备注、可读内容与理智损失，以及什么时候才看得见
  locks.json       锁：需要的技能、难度档位、成败各自的叙述
  facts.json       线索，分公开与秘密
  npcs.json        NPC 与出生点
  story.json       剧情节点，完成条件写成数据
  conditions.json  条件：命中之后产生哪些事件，配上写好的叙述
```

条件长这样，求值器只读已经提交的状态：

```json
{
  "when": { "all": [{ "flag": "lock.desk.failed" }, { "clockGte": 3 }] },
  "effects": [{ "event": { "type": "npc_moved", "npc": "npc.landlady", "to": "loc.hall" }, "summary": "…" }]
}
```

## 目录

```
src/
  data/packs/              模组资料包（JSON，见上）
  engine/
    types.ts               状态、事件载荷、意图、检定结果
    schema.ts              资料包的 Zod 模式与条件的数据表达
    pack.ts                按目录扫描模组、列表、按编号加载、索引、引用完整性检查
    conditions.ts          条件求值：只读已提交状态
    rng.ts                 带种子的掷骰，种子绑定回合编号
    rules.ts               百分骰检定与成功等级
    events.ts              事件 → 状态的唯一入口（reducer）
    runtime.ts             原子提交、条件判定、重放、状态哈希
    router.ts              自然语言 → 意图，保守匹配，宁可追问
    resolve.ts             程序裁定：意图 → 候选事件
    narrate.ts             确定性叙述与建议行动，同时兼任模型的兜底
  keeper/
    contract.ts            主持人契约：路由回复与叙述回复的 Zod 模式
    context.ts             喂给模型的上下文，只放玩家感知得到的东西
    client.ts              Ollama 调用：结构化输出、超时、错误分类
    guard.ts               叙述体检：编人编物、编点数、出戏，一律退回
    keeper.ts              编排：先快路径后模型，失败退回模板
    config.ts              主持人配置，存在 localStorage
  store/
    schema.ts              表结构：战役、分支、事件、检查点、对话
    repo.ts                仓储：只追加、检查点、分支、导出导入
    driver.ts              驱动接口，SQL 与具体的 SQLite 实现解耦
    web.ts                 浏览器侧 sqlite-wasm（kvvfs）
    memory.ts              兜底的内存库，加载不了 WASM 时用
    bun.ts                 脚本侧 bun:sqlite，专供测试
  ui/                      跑团桌：叙述列、检定尺、调查员卡、房间、时间线、事件记录
  session.ts               一场团的状态、提交、续场、分支
scripts/
  pack-lint.ts             资料包体检（逐份汇报，含体检自身的自检）
  smoke.ts                 金样冒烟
  keeper-check.ts          主持人契约测试（假模型 + 可选真机）
  store-check.ts           存储层测试（bun:sqlite，与浏览器同一份 SQL）
```

## 还没做的（见 PLAN.md）

- 导演与记忆、人设卡导入。
- 上下文预算：房间和线索多起来之后要裁剪，现在是整份塞进去。
- 存储换成 OPFS：kvvfs 借的是 localStorage，容量只有几 MB，长战役迟早不够。
