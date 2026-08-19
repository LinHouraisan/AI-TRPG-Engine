/** Electron preload 挂上的桥。浏览器里没有，Demo 继续走自己的 wasm 库。 */
export type DesktopResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; messageKey: string } };

export interface DesktopCampaign {
  campaignId: string;
  name: string;
  headBranchId: string;
  headStateVersion: number;
}

export interface DesktopApi {
  version: { major: 1; minor: number };
  campaign: {
    create(input: { name: string }): Promise<DesktopResult<DesktopCampaign>>;
    list(input: { limit: number }): Promise<DesktopResult<{ items: DesktopCampaign[] }>>;
    open(input: { campaignId: string }): Promise<DesktopResult<DesktopCampaign>>;
  };
  turn: {
    submitAction(input: {
      campaignId: string;
      branchId: string;
      actorId: string;
      controllerId: string;
      expectedStateVersion: number;
      commandId: string;
      text: string;
    }): Promise<DesktopResult<{ operationId: string; turnId?: string }>>;
  };
  timeline: {
    page(input: {
      campaignId: string;
      branchId: string;
      page: { limit: number };
    }): Promise<DesktopResult<{ items: unknown[]; events?: unknown[] }>>;
  };
  operation: {
    get(input: {
      operationId: string;
      campaignId: string;
    }): Promise<DesktopResult<unknown>>;
  };
}

export function desktopApi(): DesktopApi | undefined {
  const api = (window as Window & { desktopApi?: DesktopApi }).desktopApi;
  return api;
}
