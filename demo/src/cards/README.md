# 人设卡原型（酒馆 / SillyTavern）

**状态：** 能解析、自动车、预览；用户确认后写入当前战役（`sheet_applied` 事件）。不当模组，不改资料包里的预组调查员定义。

## 现在有什么

- 读 SillyTavern **V1** 扁平 JSON、**V2 / V3**（`spec` + `data`）、PNG 的 `chara` / `ccv3` tEXt。
- 抽出名字、描述、性格、场景、开场白、示例对白、世界书。
- **自动车**：按描述 + 场景 + 世界书，用卡面哈希当种子，掷 CoC 7e 百分属性，再把职业技能和关键词加成写上去。同一张卡数值不变。
- 能力只标 **`character_card` / 人设卡**。`confirmed: false`。生命值、理智、技能、职业全部 `origin: generated`（候选）。
- 卡里的 `system_prompt` / `post_history_instructions` 留下当不可信文本，**不**升成系统指令。
- CLI：`cd demo && bun run card:check`
- 跑团桌顶栏「人设卡」可打开 JSON / PNG 预览。点「确认写入这场战役」才提交 `sheet_applied`。能力仍是人设卡。

示例卡：`src/data/cards/suheng.card.json`（苏蘅，接线员）、`v1-plain.card.json`（阿宁）。

## 还不是

- 人设卡升级成轻量冒险或完整模组。
- 覆盖全部酒馆卡变体（iTXt、zTXt、正则、lorebook 递归）。
- 用模型补结构（现在是关键词 + 骰子，不是 LLM）。
- 内容库安装状态机 / `installed_content`。

对照：[14-content-system](../../../docs/05-implementation-design/14-content-system.md) 的 `CharacterCardImporter`；PRD [06 W5](../../../PRD/06-实现计划.md)。
