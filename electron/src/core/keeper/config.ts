export type KeeperConfig = {
  enabled: boolean;
  protocol?: "ollama" | "openai_compatible";
  /** 浏览器里走 Vite 代理（/ollama），脚本里直接连主机 */
  baseUrl: string;
  /** 只由 Electron Main 临时解密后提供，不写进浏览器 localStorage。 */
  apiKey?: string;
  /** DeepSeek V4 默认思考；GM 叙述显式关闭以降低延迟和费用。 */
  disableThinking?: boolean;
  model: string;
  timeoutMs: number;
  temperature: number;
  /**
   * 喂给叙述模型的上下文预算，按字符数估，不引入分词器。
   * 现有两份模组（寄宿公寓、雨夜照相馆）单回合上下文都在一千字以内；
   * 4000 还能再装下一场短团的公开经过，又撑不满本地小模型的窗口。
   */
  contextBudgetChars: number;
  /**
   * 叙述是否走 Ollama 的流式接口。
   * 流式过程中吐出的字在体检通过之前只是草稿，不算定稿；关掉则等整段收齐再返回。
   */
  stream: boolean;
  /**
   * Debug panel for Information / Director / Memory after-commit jobs.
   * Off by default. Does not change facts or gold hash.
   */
  debugTrace: boolean;
};

/** 与 defaultConfig.contextBudgetChars 同一处数字，裁剪与测试都读这个。 */
export const DEFAULT_CONTEXT_BUDGET_CHARS = 4000;

const inBrowser = typeof window !== "undefined";

export const defaultConfig: KeeperConfig = {
  enabled: true,
  protocol: "ollama",
  baseUrl: inBrowser ? "/ollama" : (process.env.OLLAMA_URL ?? "http://127.0.0.1:11434"),
  model: (inBrowser ? import.meta.env?.VITE_KEEPER_MODEL : process.env.KEEPER_MODEL) || "qwen3.8:latest",
  // 本地大模型第一次加载权重要几十秒，超时给宽一点，超了就退回模板。
  timeoutMs: 60_000,
  temperature: 0.7,
  contextBudgetChars: DEFAULT_CONTEXT_BUDGET_CHARS,
  stream: false,
  debugTrace: false,
};

const KEY = "ai-trpg-engine/keeper";

export function loadConfig(): KeeperConfig {
  if (!inBrowser) return defaultConfig;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultConfig;
    const parsed = JSON.parse(raw) as Partial<KeeperConfig>;
    const merged = { ...defaultConfig, ...parsed };
    if (!Number.isFinite(merged.contextBudgetChars) || merged.contextBudgetChars < 1) {
      merged.contextBudgetChars = DEFAULT_CONTEXT_BUDGET_CHARS;
    }
    if (typeof merged.stream !== "boolean") merged.stream = false;
    if (typeof merged.debugTrace !== "boolean") merged.debugTrace = false;
    return merged;
  } catch {
    return defaultConfig;
  }
}

export function saveConfig(config: KeeperConfig): void {
  if (!inBrowser) return;
  localStorage.setItem(KEY, JSON.stringify(config));
}
