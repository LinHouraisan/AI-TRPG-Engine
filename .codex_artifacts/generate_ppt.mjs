import fs from "node:fs/promises";
import path from "node:path";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const ROOT = path.resolve(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/(.:)/, "$1")), "..");
const OUT = path.join(ROOT, "答辩材料");
const RENDER = path.join(ROOT, ".codex_artifacts", "ppt-render");
const SCREENSHOT_PATH = "C:\\Users\\35029\\AppData\\Local\\Temp\\codex-clipboard-8677c1e3-2f7a-475c-bfbf-24dcae784465.png";
await fs.mkdir(OUT, { recursive: true });
await fs.mkdir(RENDER, { recursive: true });
const screenshotBuffer = await fs.readFile(SCREENSHOT_PATH);
const screenshotBytes = screenshotBuffer.buffer.slice(
  screenshotBuffer.byteOffset,
  screenshotBuffer.byteOffset + screenshotBuffer.byteLength,
);

const W = 1280, H = 720;
const C = { ink: "#101820", muted: "#5B6573", blue: "#3D8DFF", cyan: "#6DCBF4", pale: "#EAF4FF", panel: "#F1F3F5", line: "#B8BCC4", white: "#FFFFFF", red: "#C00000", dark: "#17324D" };
const deck = Presentation.create({ slideSize: { width: W, height: H } });

function shape(slide, name, left, top, width, height, fill = "none", line = "none", geometry = "rect") {
  return slide.shapes.add({ geometry, name, position: { left, top, width, height }, fill, line: { style: "solid", fill: line, width: line === "none" ? 0 : 1 } });
}
function text(slide, name, value, left, top, width, height, size = 24, opts = {}) {
  const s = shape(slide, name, left, top, width, height, "none", "none", "textbox");
  s.text = value;
  s.text.style = { fontSize: size, fontFamily: "Microsoft YaHei", color: opts.color || C.ink, bold: opts.bold || false, alignment: opts.align || "left", verticalAlignment: opts.valign || "top" };
  return s;
}
function base(title, index, eyebrow = "AI TRPG ENGINE") {
  const slide = deck.slides.add();
  slide.background.fill = C.white;
  text(slide, `eyebrow-${index}`, eyebrow, 72, 42, 600, 26, 13, { bold: true, color: C.blue });
  text(slide, `title-${index}`, title, 72, 80, 1136, 58, 35, { bold: true, color: C.dark });
  shape(slide, `rule-${index}`, 72, 146, 1136, 2, C.line, "none");
  text(slide, `page-${index}`, String(index).padStart(2, "0"), 1160, 672, 48, 20, 12, { color: C.muted, align: "right" });
  return slide;
}
function placeholder(slide, label, left, top, width, height) {
  shape(slide, `placeholder-${label}`, left, top, width, height, "#F7F8FA", C.line);
  text(slide, `placeholder-text-${label}`, `【待替换：${label}】`, left + 28, top + height / 2 - 30, width - 56, 60, 20, { color: C.red, bold: true, align: "center", valign: "middle" });
}
function screenshot(slide, name, left, top, width, height, fit = "cover") {
  slide.images.add({
    blob: screenshotBytes,
    contentType: "image/png",
    alt: "AI TRPG Engine 真实运行界面",
    fit,
    position: { left, top, width, height },
    geometry: "rect",
  });
  shape(slide, `${name}-border`, left, top, width, height, "none", C.line);
}
function bulletList(slide, items, left, top, width, fontSize = 23, gap = 62) {
  items.forEach((item, i) => {
    shape(slide, `bullet-dot-${top}-${i}`, left, top + i * gap + 9, 12, 12, i === 0 ? C.blue : C.cyan, "none", "ellipse");
    text(slide, `bullet-${top}-${i}`, item, left + 28, top + i * gap, width - 28, gap - 4, fontSize, { color: C.ink });
  });
}
function boxLabel(slide, title, body, left, top, width, height, accent = C.blue) {
  shape(slide, `box-${title}`, left, top, width, height, C.panel, "none");
  shape(slide, `box-accent-${title}`, left, top, 7, height, accent, "none");
  text(slide, `box-title-${title}`, title, left + 24, top + 18, width - 40, 34, 22, { bold: true, color: C.dark });
  text(slide, `box-body-${title}`, body, left + 24, top + 58, width - 40, height - 70, 17, { color: C.muted });
}

// 1 Cover
{
  const s = deck.slides.add(); s.background.fill = C.white;
  shape(s, "cover-field", 780, 0, 500, 720, C.pale, "none");
  shape(s, "cover-bar", 780, 0, 18, 720, C.blue, "none");
  text(s, "cover-kicker", "毕业实习项目答辩", 72, 86, 500, 30, 16, { bold: true, color: C.blue });
  text(s, "cover-title", "AI TRPG Engine", 72, 166, 640, 92, 54, { bold: true, color: C.dark });
  text(s, "cover-subtitle", "本地优先的 AI 单人跑团桌面引擎", 72, 280, 620, 52, 26, { color: C.muted });
  text(s, "cover-value", "AI 负责理解与叙事，程序负责规则与事实", 72, 374, 600, 46, 22, { bold: true, color: C.ink });
  text(s, "cover-meta", "组号：【待替换：组号】\n组长：【待替换：组长姓名】\n成员：【待替换：全部成员姓名】", 72, 510, 600, 104, 18, { color: C.red });
  screenshot(s, "cover-product", 820, 218, 400, 242, "contain");
  text(s, "cover-product-caption", "V0.1 真实运行界面", 820, 486, 400, 32, 18, { bold: true, color: C.dark, align: "center" });
  text(s, "cover-product-note", "自然语言行动 · 权威状态 · 时间线恢复", 820, 528, 400, 28, 15, { color: C.muted, align: "center" });
}

// 2 Context
{
  const s = base("我们要解决的不是“聊天”，而是一场能持续的游戏", 2, "01  产品场景");
  boxLabel(s, "现实跑团", "需要主持人、玩家和连续时间安排，组织成本高。", 72, 196, 340, 210, C.line);
  boxLabel(s, "普通 AI 对话", "叙事自由，但关键人物、道具和既有结果容易被遗忘或改写。", 446, 196, 340, 210, C.cyan);
  boxLabel(s, "AI TRPG Engine", "自然语言自由行动，同时用规则、状态和事件维护长期一致性。", 820, 196, 388, 210, C.blue);
  text(s, "value", "一句话价值", 72, 478, 190, 32, 20, { bold: true, color: C.blue });
  text(s, "value-statement", "让玩家随时进入一场可保存、可追溯、可恢复的单人跑团。", 72, 520, 1030, 54, 30, { bold: true, color: C.dark });
}

// 3 Architecture
{
  const s = base("AI 负责叙事，确定性内核决定什么真正发生", 3, "02  产品架构");
  const layers = [
    ["玩家交互层", "React 界面 · 人物卡 · 叙事 · 时间线", C.pale],
    ["桌面与 AI 协调层", "Electron Main / Preload · Keeper · Model Gateway", "#E4F7FF"],
    ["确定性运行时", "Turn Router · Rules · RNG · Validator · Events", "#D9ECFF"],
    ["本地数据层", "SQLite · Current State · Immutable Event Log · Checkpoint", "#CBE3FF"],
  ];
  layers.forEach((x, i) => {
    const top = 190 + i * 100;
    shape(s, `layer-${i}`, 72, top, 780, 76, x[2], "none");
    text(s, `layer-title-${i}`, x[0], 98, top + 15, 220, 36, 22, { bold: true, color: C.dark });
    text(s, `layer-body-${i}`, x[1], 330, top + 17, 490, 34, 18, { color: C.ink });
  });
  text(s, "arch-rule", "核心边界", 914, 196, 230, 32, 20, { bold: true, color: C.blue });
  bulletList(s, ["AI 只生成候选和叙事", "程序校验并原子提交", "Renderer 不直连 SQLite", "模型可以替换或降级"], 914, 252, 280, 19, 72);
}

// 4 Features
{
  const s = base("四项核心能力组成完整的单人跑团闭环", 4, "03  核心功能");
  boxLabel(s, "01  创建角色", "属性分配、正式人物卡、稳定实体身份", 72, 192, 530, 170, C.blue);
  boxLabel(s, "02  自由行动", "玩家用自然语言调查、交谈、移动或尝试", 630, 192, 578, 170, C.cyan);
  boxLabel(s, "03  检定与叙事", "系统先裁定并提交，再由 AI 生成主持人反馈", 72, 392, 530, 170, C.cyan);
  boxLabel(s, "04  保存与恢复", "时间线、检查点、分支副本和战役备份", 630, 392, 578, 170, C.blue);
  text(s, "feature-note", "可接入本地模型或用户自己的云端模型密钥", 72, 604, 1136, 34, 19, { bold: true, color: C.dark, align: "center" });
}

// 5 Data and API
{
  const s = base("状态 + 事件 + 类型化 API，让系统结果可验证", 5, "04  数据库与 API");
  text(s, "data-title", "SQLite 数据设计", 72, 190, 480, 38, 24, { bold: true, color: C.dark });
  bulletList(s, ["Current State：快速读取当前世界", "Immutable Event Log：追溯变化原因", "Checkpoint：恢复副本而不覆盖历史", "Credential ID：数据库不保存明文密钥"], 72, 250, 500, 19, 66);
  shape(s, "mid-rule", 620, 190, 2, 390, C.line, "none");
  text(s, "api-title", "类型化桌面 API", 674, 190, 480, 38, 24, { bold: true, color: C.dark });
  bulletList(s, ["campaign:*  战役与人物", "turn:* / operation:*  回合与进度", "timeline:* / checkpoint:*  历史与恢复", "settings:* / backup:*  模型与备份"], 674, 250, 500, 19, 66);
  text(s, "api-bottom", "版本冲突时拒绝提交；叙事失败也不会重复掷骰。", 72, 610, 1136, 32, 20, { bold: true, color: C.blue, align: "center" });
}

// 6 Demo
{
  const s = base("两分钟演示：从自然语言行动到可追溯结果", 6, "05  系统演示");
  const steps = ["打开预置战役", "查看人物与场景", "输入调查行动", "触发检定与叙事", "查看时间线/检查点"];
  steps.forEach((v, i) => {
    const left = 72 + i * 222;
    shape(s, `step-num-${i}`, left, 224, 54, 54, i === 3 ? C.blue : C.dark, "none", "ellipse");
    text(s, `step-num-text-${i}`, String(i + 1), left, 233, 54, 28, 20, { bold: true, color: C.white, align: "center" });
    text(s, `step-text-${i}`, v, left - 26, 298, 160, 70, 19, { bold: true, color: C.ink, align: "center" });
    if (i < 4) shape(s, `step-line-${i}`, left + 66, 250, 146, 3, C.line, "none");
  });
  text(s, "demo-arch-label", "一次行动在程序中的真实调用路径", 72, 390, 1136, 28, 18, { bold: true, color: C.blue, align: "center" });
  const archNodes = [
    ["玩家界面", "React Renderer\n自然语言输入与结果展示", 104, 432, 224, C.panel],
    ["桌面桥接", "Preload / IPC\n输入校验与安全边界", 378, 432, 224, C.pale],
    ["游戏内核", "Router / Rules / RNG\n裁定、校验并提交事件", 652, 432, 224, "#D9ECFF"],
    ["数据与模型", "SQLite 保存权威事实\nKeeper / Provider 生成叙事", 926, 432, 250, "#CBE3FF"],
  ];
  archNodes.forEach(([title, body, left, top, width, fill], i) => {
    shape(s, `demo-arch-node-${i}`, left, top, width, 150, fill, "none");
    shape(s, `demo-arch-accent-${i}`, left, top, width, 6, i === 2 ? C.blue : C.cyan, "none");
    text(s, `demo-arch-title-${i}`, title, left + 18, top + 24, width - 36, 30, 20, { bold: true, color: C.dark, align: "center" });
    text(s, `demo-arch-body-${i}`, body, left + 16, top + 66, width - 32, 64, 15, { color: C.muted, align: "center" });
    if (i < archNodes.length - 1) {
      text(s, `demo-arch-arrow-${i}`, "→", left + width + 8, top + 55, 42, 40, 27, { bold: true, color: C.blue, align: "center" });
    }
  });
  text(s, "demo-arch-note", "硬边界：先裁定并提交事实，再生成正式叙事", 72, 606, 1136, 30, 18, { bold: true, color: C.dark, align: "center" });
}

// 7 Challenge
{
  const s = base("技术难点：多线程、多 AI 如何协同而不争夺事实权", 7, "06  技术难点");
  text(s, "parallel-title", "并发带来的问题", 72, 190, 350, 34, 22, { bold: true, color: C.dark });
  const parallelRisks = [
    ["上下文不同步", "后台任务读到旧状态，产生失效建议", 242, C.line],
    ["职责容易重叠", "多个 AI 同时推进剧情，结果可能冲突", 350, C.cyan],
    ["失败可能扩散", "模型超时或重试，不能阻塞或重复提交", 458, C.blue],
  ];
  parallelRisks.forEach(([title, body, top, accent], i) => {
    shape(s, `parallel-risk-${i}`, 72, top, 350, 96, C.panel, "none");
    shape(s, `parallel-risk-accent-${i}`, 72, top, 7, 96, accent, "none");
    text(s, `parallel-risk-title-${i}`, title, 104, top + 14, 294, 28, 19, { bold: true, color: C.dark });
    text(s, `parallel-risk-body-${i}`, body, 104, top + 53, 294, 26, 14, { color: C.muted });
  });

  text(s, "coord-title", "按职责拆分的协同架构", 488, 190, 720, 34, 22, { bold: true, color: C.blue });
  const aiRoles = [
    ["GM AI", "前台主持", 488, C.blue],
    ["Director AI", "剧情调度", 668, C.cyan],
    ["Information AI", "上下文选择", 848, C.cyan],
    ["Memory AI", "长期整理", 1028, C.blue],
  ];
  aiRoles.forEach(([role, duty, left, accent], i) => {
    shape(s, `ai-role-${i}`, left, 242, 160, 82, C.panel, "none");
    shape(s, `ai-role-accent-${i}`, left, 242, 160, 5, accent, "none");
    text(s, `ai-role-name-${i}`, role, left + 8, 258, 144, 24, 17, { bold: true, color: C.dark, align: "center" });
    text(s, `ai-role-duty-${i}`, duty, left + 8, 288, 144, 22, 14, { color: C.muted, align: "center" });
    text(s, `ai-role-arrow-${i}`, "↓", left + 58, 328, 44, 28, 22, { bold: true, color: accent, align: "center" });
  });
  shape(s, "context-runtime", 540, 362, 596, 68, C.pale, "none");
  text(s, "context-runtime-title", "Context Broker + Application Runtime", 560, 376, 556, 26, 19, { bold: true, color: C.dark, align: "center" });
  text(s, "context-runtime-body", "事件驱动 · 版本化上下文 · 超时与降级", 560, 404, 556, 20, 14, { color: C.muted, align: "center" });
  text(s, "runtime-arrow", "↓", 816, 434, 44, 28, 22, { bold: true, color: C.blue, align: "center" });
  shape(s, "atomic-commit", 594, 466, 488, 76, "#D9ECFF", "none");
  text(s, "atomic-title", "Validator / Atomic Commit", 614, 480, 448, 26, 19, { bold: true, color: C.dark, align: "center" });
  text(s, "atomic-body", "只有程序能够提交 SQLite 权威状态与不可变事件", 614, 510, 448, 22, 14, { color: C.muted, align: "center" });
  text(s, "challenge-result", "多 AI 可以并行思考，但事实只允许按版本串行提交。", 72, 598, 1136, 36, 22, { bold: true, color: C.dark, align: "center" });
}

// 8 Personal work and AI learnings
{
  const s = base("独立完成产品，也重新认识了 AI 的工程边界", 8, "07  个人实践与实习收获");
  text(s, "work-title", "个人完成的工作", 72, 190, 460, 34, 23, { bold: true, color: C.dark });
  shape(s, "work-panel", 72, 244, 500, 330, C.panel, "none");
  bulletList(s, [
    "完成产品定位、架构设计与功能拆解",
    "实现桌面界面、游戏内核与本地数据层",
    "接入模型、内容包、检查点与演示流程",
    "通过测试与复盘持续修正产品体验",
  ], 104, 280, 436, 19, 66);
  text(s, "learn-title", "对 AI 的核心认知", 674, 190, 460, 34, 23, { bold: true, color: C.dark });
  shape(s, "learn-panel", 674, 244, 534, 330, C.pale, "none");
  bulletList(s, [
    "模型能力不等于产品可靠性，关键事实要由程序约束",
    "本地模型需要按任务做参数、提示词与上下文调优",
    "针对性适配比盲目追求大模型规模更重要",
    "结构化输出、评测和失败降级决定实际可用性",
  ], 706, 272, 466, 18, 69);
  text(s, "learn-note", "最大的收获：从“会调用 AI”，走向“能让 AI 在明确边界内稳定完成任务”。", 72, 612, 1136, 36, 20, { color: C.blue, bold: true, align: "center" });
}

// 9 Version path
{
  const s = base("从可分发的 V0.1，走向完整的 V1.0", 9, "08  版本演进");
  text(s, "v01-label", "V0.1  ·  已经完成", 72, 190, 500, 40, 25, { bold: true, color: C.blue });
  shape(s, "v01-panel", 72, 244, 520, 330, C.panel, "none");
  bulletList(s, [
    "可安装、可独立启动的桌面产品",
    "角色创建、战役与自然语言行动",
    "规则检定、AI 叙事与权威状态",
    "时间线、检查点和基础恢复",
    "模型配置与内容基础接入",
  ], 104, 276, 452, 19, 53);
  text(s, "v10-label", "V1.0  ·  完整产品形态", 674, 190, 520, 40, 25, { bold: true, color: C.dark });
  shape(s, "v10-panel", 674, 244, 534, 330, C.pale, "none");
  bulletList(s, [
    "目标战役长度内的长期一致性",
    "文字卡、轻量内容与剧本包兼容",
    "Scenario Pack 制作与发布路径",
    "模型替换、失败降级和成本控制",
    "存档回滚、分支、迁移与完整文档",
  ], 706, 276, 466, 19, 53);
  text(s, "version-boundary", "V1.0 仍聚焦 AI 主持的单人跑团；多人实时联机与真人 GM 工作台属于远期方向。", 72, 616, 1136, 34, 18, { color: C.muted, align: "center" });
}

// 10 Close
{
  const s = deck.slides.add(); s.background.fill = C.dark;
  text(s, "close-kicker", "AI TRPG ENGINE", 72, 62, 500, 28, 14, { bold: true, color: C.cyan });
  text(s, "close-title", "让 AI 成为主持人，\n让程序守住世界的事实", 72, 148, 860, 150, 46, { bold: true, color: C.white });
  text(s, "close-summary", "当前成果：完整试玩闭环 · 本地权威状态 · 可替换模型 · 可恢复历史", 72, 354, 1060, 48, 23, { color: C.white });
  text(s, "close-future", "下一步：增强长期记忆与内容工具，并逐步探索多人协作", 72, 430, 1000, 42, 21, { color: C.cyan });
  shape(s, "close-rule", 72, 520, 1136, 2, "#58708A", "none");
  text(s, "close-qa", "Q & A", 72, 558, 300, 64, 38, { bold: true, color: C.white });
  text(s, "close-thanks", "感谢各位老师指导", 900, 580, 308, 30, 18, { color: C.white, align: "right" });
}

async function writeBlob(file, blob) { await fs.writeFile(file, new Uint8Array(await blob.arrayBuffer())); }
for (const [i, slide] of deck.slides.items.entries()) {
  await writeBlob(path.join(RENDER, `slide-${String(i + 1).padStart(2, "0")}.png`), await deck.export({ slide, format: "png", scale: 1 }));
  const layout = await slide.export({ format: "layout" });
  await fs.writeFile(path.join(RENDER, `slide-${String(i + 1).padStart(2, "0")}.layout.json`), await layout.text());
}
await writeBlob(path.join(RENDER, "montage.webp"), await deck.export({ format: "webp", montage: true, scale: 1 }));
const pptx = await PresentationFile.exportPptx(deck);
await pptx.save(path.join(OUT, "AI TRPG Engine-项目汇报PPT.pptx"));
console.log(path.join(OUT, "AI TRPG Engine-项目汇报PPT.pptx"));
