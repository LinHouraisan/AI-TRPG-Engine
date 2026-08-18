import { Store } from "./repo";

export type OpenedStore = {
  store: Store;
  /** 落盘的存哪儿，界面上要如实告诉玩家 */
  backend: string;
  /** 关掉浏览器还在不在 */
  durable: boolean;
  note?: string;
};

/**
 * 开库。
 *
 * 首选浏览器里的 SQLite（kvvfs，数据落在 localStorage，刷新还在）；
 * 万一这台浏览器加载不了 WASM，就退到内存库——这一场照样能玩完，
 * 只是关掉页面就没了，而且界面上会明说，不假装存住了。
 */
export async function openStore(): Promise<OpenedStore> {
  try {
    const { createWebDriver } = await import("./web");
    const driver = await createWebDriver("local");
    const store = await Store.open(driver);
    return { store, backend: driver.name, durable: true };
  } catch (error) {
    const { createMemoryDriver } = await import("./memory");
    const store = await Store.open(await createMemoryDriver());
    return {
      store,
      backend: "内存",
      durable: false,
      note: `浏览器里的 SQLite 没开起来（${error instanceof Error ? error.message : String(error)}），这一场只存在内存里。`,
    };
  }
}

export { Store } from "./repo";
export type {
  BranchInfo,
  CampaignHandle,
  ExportPayload,
  StoredMessage,
  StoredMessageKind,
} from "./repo";
