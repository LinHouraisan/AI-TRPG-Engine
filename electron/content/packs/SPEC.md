# 模组资料包规范

一份模组就是这个目录下的一份子目录，里面是八个 JSON 文件。引擎不认识任何写死的房间、道具或剧情，全部从这里读。

将来的故事编辑器也照着这份规范生成文件，所以字段的含义以本文为准；`src/engine/schema.ts` 是它可执行的那一份，两者不一致时以本文的意图为准并修正代码。

加载顺序是固定的两道关：先过 Zod 模式（字段长得对不对），再过引用完整性（指过去的东西存不存在）。选中某一份来开团时，任何一道不过就拒绝，不做静默降级——宁可开不了团，也不能让引擎带着一份说不清的资料跑下去。扫描仓库里的其它模组时另说，见下面「一个仓库里放多份模组」。

体检命令：

```bash
cd demo && bun run pack:lint
```

「错误」一律不给过；「提醒」只打印，作者自己判断是不是有意为之。

## 一个仓库里放多份模组

`content/packs/` 下面每一个子目录都是一份独立的模组。目录名建议与 `pack.json` 里的 `id` 一致，对号入座不容易看错。引擎用 Vite 的 `import.meta.glob` 扫描这一层，齐了下面八个 JSON 的目录才算一份模组——`SPEC.md` 是给人看的规范，不会被当成模组。

```
content/packs/
  SPEC.md                 本文件，不是模组
  boarding-house/         《寄宿公寓账本》
  photo-studio/           《雨夜照相馆》
```

扫描阶段一份坏掉的模组只让它自己不可用：`listPacks()` 会把它标成不可用并写明原因，其它完好的模组照常列出，程序也开得了团。真正选中某一份来开团时（`loadPackById`，以及当前生效的那一份）则不同——模式不对或引用残缺都是致命错误，引擎不会带着半份资料往下跑。

换一份模组不需要改引擎代码。把新目录丢进 `content/packs/`，体检能扫到就算数。界面选择器会整页重载来切包；默认开的是 `boarding-house`。

V1 分发格式是 ZIP `.scenario-pack`，带 `manifest.json` 与逐文件 SHA-256，目录树是 `entities/`、`story/nodes.json`、`world/initial-state.json`（见 [`docs/05-implementation-design/14-content-system.md`](../../../../docs/05-implementation-design/14-content-system.md)）。本规范的八个扁平 JSON 是编辑器与 Demo 的工作拷贝，不是最终安装包。迁过去时只搬家、不改字段；可见性字段（`hidden`／`revealedWhen`／`lockedBy`）必须原样保留，那是防泄底的数据，不是提示词。

| 工作拷贝 | V1 包内路径 |
| --- | --- |
| `pack.json` | `scenario.json`（`id` → `contentId`，`title` → `name.default`，`version` 须是 SemVer） |
| `rooms.json` | `entities/locations.json` |
| `items.json` | `entities/items.json` |
| `npcs.json` | `entities/characters.json` |
| `story.json` | `story/nodes.json` |
| `facts.json` | `story/clues.json` |
| `locks.json` | `world/locks.json`（额外文件，列入 manifest） |
| `conditions.json` | `world/conditions.json` |
| （生成） | `world/initial-state.json`（`investigator.startAt` + NPC `startAt` + 道具 `at`） |
| （生成） | `manifest.json`（`formatVersion` 1，`entries[]` 含 sha256／size／mime，不含自身） |

打包装命令在 Electron 侧：`cd electron && bun run content:pack`；`bun run content:check` 会打包 `boarding-house` 并拒绝 zipslip、符号链接、未声明文件和哈希不符。

## 编号约定

| 前缀 | 指什么 | 文件 |
| --- | --- | --- |
| `loc.` | 房间 | `rooms.json` |
| `item.` | 道具 | `items.json` |
| `lock.` | 锁 | `locks.json` |
| `fact.` | 线索 | `facts.json` |
| `npc.` | 非玩家角色 | `npcs.json` |
| `node.` | 剧情节点 | `story.json` |
| `cond.` | 条件 | `conditions.json` |
| `pc.` | 预组调查员 | `pack.json` |

编号在整份资料包里唯一，重复即报错。编号一旦发布就不要再改：事件记录里存的是编号，改名等于让旧存档失去指向。

背包用固定编号 `inv.pc`，它不是房间，作者不用也不能定义它。

## 可见性：藏与露

**这是这份规范里最要紧的一条。** 玩家看得见什么，由作者在数据里声明，引擎只负责执行。

判定口径只有一句：**看得见 =「没藏着」或者「`revealedWhen` 成立」**；已经拿在手上的东西一律看得见。

| 写法 | 含义 |
| --- | --- |
| 什么都不写 | 一进房间就看得见 |
| `"lockedBy": "lock.desk"` | 关在这把锁后面，开锁之前看不见。等价于 `hidden: true` 加 `revealedWhen: { "unlocked": "lock.desk" }` |
| `"hidden": true` 加 `"revealedWhen": <谓词>` | 藏着，直到谓词成立才露面。搜出来的暗格、点亮油灯才看得清的字迹，都用这个写 |
| `"hidden": true` 单写 | 永远看不见。体检会提醒你这是一段死内容 |
| `"lockedBy"` 与 `"revealedWhen"` 同时写 | 以 `revealedWhen` 为准。体检会提醒你开锁之前它就露面了——「隔着玻璃看得见但拿不走」才需要这么写 |

藏着的东西，在这几个地方一处都不会出现：房间描述、建议行动、界面上的场景清单、喂给主持人模型的上下文。因此模型也不可能提前把它说出来——防泄底靠的是它压根拿不到，而不是靠提示词求它别说。

玩家自己猜着名字点它（「看看黑色账本」），得到的回答与点一件根本不存在的东西完全一样：「这里没有那样东西。」两种情况回答一致，玩家就无法用试探把秘密问出来。

注意区分两件事：**看得见**与**拿得走**。`lockedBy` 两样都挡；只想挡后者（看得见、够不着）就写 `revealedWhen` 把它显式放出来，并接受体检的那条提醒。

## 各文件字段

### `pack.json` 清单

| 字段 | 说明 |
| --- | --- |
| `id`、`title`、`version` | 编号、标题、版本号。事件记录里存的是 `id@version`，改了资料就该改版本号，否则旧存档重放会对不上 |
| `kind` | `one-shot`、`scenario`、`campaign` |
| `rules` | 目前只有 `percentile`（百分骰） |
| `opening` | 开场白 |
| `investigator` | 预组调查员：编号、姓名、职业、生命值、理智与理智上限、出生房间、技能表 |

技能表的键就是检定时写的技能名。锁需要的技能不在这张表上，体检会提醒。

### `rooms.json` 房间

| 字段 | 说明 |
| --- | --- |
| `id`、`title` | 编号与名字 |
| `intro` | 第一次进来时念的一段。之后再进来只报看得见的东西、在场的人和出口 |
| `exits` | `{ to, via }`，`via` 是玩家嘴里的那个说法（「房门」「楼梯」） |

出口通往不存在的房间是错误；那边没有回来的路只是提醒，单向通道是合法设计。

### `items.json` 道具

| 字段 | 说明 |
| --- | --- |
| `id`、`title`、`aliases` | 编号、正式名字、玩家可能用的别名。别名直接影响自由输入认不认得出来，值得多写几个 |
| `at` | 初始所在房间 |
| `observed` | 观察时念的一段。只有玩家观察过，才听得到这段 |
| `keeperNote` | 守秘人备注。**永远不会进入模型上下文，也不会呈现给玩家** |
| `observeGrants` | 观察即到手的线索编号 |
| `portable` | 拿不拿得走 |
| `hidden`、`revealedWhen`、`lockedBy` | 可见性，见上一节 |
| `takeText` | 拿走时念的一句 |
| `read` | 可读内容，见下 |

`read` 展开：`text` 正文，`afterText` 读完补的一句，`grants` 读到的线索，`sanLoss` 理智损失，`flag` 记「读过了」的剧情标记，`alreadyText` 再读一次时的回话。

一件东西可以既观察又阅读：观察是外观，阅读是内容。玩家问「账本里有什么」问的是后者。

### `locks.json` 锁

| 字段 | 说明 |
| --- | --- |
| `id`、`title`、`at` | 编号、名字、所在房间 |
| `skill`、`difficulty` | 检定用的技能，难度档位 `regular`／`hard`／`extreme` |
| `opens` | 打开之后放出哪件道具。那件道具通常写 `lockedBy` 指回来 |
| `minutes` | 成功与失败各推进多少团内分钟。失败也要花时间，这是压力的来源 |
| `text` | `ok`、`fail`、`fumble`、`alreadyOpen` 四段话 |

### `facts.json` 线索

| 字段 | 说明 |
| --- | --- |
| `id`、`title` | 编号与说法 |
| `visibility` | `public` 或 `secret`。秘密线索在玩家拿到之前不进模型上下文 |

### `npcs.json` 非玩家角色

| 字段 | 说明 |
| --- | --- |
| `id`、`title`、`startAt` | 编号、称呼、出生房间 |
| `line` | 搭话时的一句。真正的对话由主持人接着写，但依据是这一句 |
| `keeperNote` | 守秘人备注，同样不外泄 |

NPC 的位置是状态，只能由条件或裁定改动。「女房东在门厅警戒」是一条状态，不是对话里烘托出来的气氛。

### `story.json` 剧情节点

| 字段 | 说明 |
| --- | --- |
| `id`、`title` | 编号与标题 |
| `doneWhen` | 什么情况算完成（谓词） |
| `failedWhen` | 什么情况算失败（谓词，可不写） |

节点表达的是事实条件，不是强迫玩家按顺序走的房间清单。完成与否每次提交之后重算，作者不需要、也不能手动去标它。

### `conditions.json` 条件

| 字段 | 说明 |
| --- | --- |
| `id`、`title` | 编号与标题 |
| `once` | 只触发一次还是每次成立都触发 |
| `when` | 触发谓词 |
| `effects` | 触发之后做什么，至少一条 |

每条效果由三部分组成：`event` 是引擎认得的事件（`npc_moved`、`flag_set`、`fact_known`、`resource_changed`、`item_moved`），`summary` 是写进事件记录的一句人话，`narration` 是可选的、当场念给玩家听的一句；不写就只改状态、不出声。另有 `visibility` 决定这条事实算公开还是秘密。

条件是在提交**之后**对着已提交的状态判定的，需要立即生效的会并进同一笔提交。条件写不出「气氛到了」这种没法检验的触发条件——这是故意的。

## 谓词

条件、剧情节点、`revealedWhen` 用的是同一套谓词，可以嵌套。

| 写法 | 成立的条件 |
| --- | --- |
| `{ "flag": "alarm.raised" }` | 剧情标记为真 |
| `{ "unlocked": "lock.desk" }` | 这把锁开了 |
| `{ "has": "item.ledger" }` | 东西在背包里 |
| `{ "observed": "item.desk_lock" }` | 玩家观察过它 |
| `{ "known": "fact.dock_time" }` | 玩家已经知道这条线索 |
| `{ "pcAt": "loc.study" }` | 调查员在这个房间 |
| `{ "npcAt": { "npc": "npc.landlady", "room": "loc.hall" } }` | 某个 NPC 在某个房间 |
| `{ "clockGte": 3 }` | 团内时间已经过了这么多分钟 |
| `{ "resource": { "which": "san", "lte": 0 } }` | 生命值或理智到达某个水位（`lte`／`gte`） |
| `{ "all": [...] }`、`{ "any": [...] }`、`{ "not": {...} }` | 与、或、非 |

谓词里引用的编号同样要过引用完整性检查。

## 体检查什么

**错误（不给过）**

- 编号重复，或者引用了不存在的房间、道具、锁、线索、NPC
- 出口通往不存在的房间
- 道具的初始位置不是房间；调查员或 NPC 的出生点不是房间
- 锁打开之后放出的道具不存在

**提醒（自行判断）**

- 出口是单向的
- 道具挂了锁却又拿不走，玩家开锁之后无事可做
- 道具藏起来了却没写露面条件，玩家永远看不到它
- 道具同时写了 `lockedBy` 与 `revealedWhen`，而后者没提到那把锁
- 锁打开之后放出的道具，开锁之前就看得见
- 锁需要的技能不在预组调查员的技能表上

## 写模组时容易踩的坑

- **别名写太少。** 玩家不会照着编号说话。账本至少要有「账本」「本子」「册子」。
- **把秘密写进 `observed`。** 那是玩家听得到的文字；只有 `keeperNote` 是安全的。
- **想靠提示词让模型别提某件东西。** 靠不住。把它藏起来，模型就无从提起。
- **让锁保护一件本来就看得见的东西。** 这样锁只挡住了「拿」，秘密早在开锁前就泄了。
