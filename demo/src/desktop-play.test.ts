import { expect, test } from "bun:test";
import type { DesktopApi, DesktopCampaign } from "@/desktop";
import { createFreshDesktopCampaign, loadDesktopCampaign } from "@/desktop-play";

function campaign(overrides: Partial<DesktopCampaign> = {}): DesktopCampaign {
  return {
    campaignId: "campaign-new",
    name: "寄宿公寓试玩",
    headBranchId: "branch-new",
    headStateVersion: 0,
    ...overrides,
  };
}

test("重开会创建并打开一场全新的桌面战役", async () => {
  const calls: string[] = [];
  const fresh = campaign();
  const api = {
    campaign: {
      create: async () => {
        calls.push("create");
        return { ok: true as const, value: fresh };
      },
      open: async ({ campaignId }: { campaignId: string }) => {
        calls.push(`open:${campaignId}`);
        return { ok: true as const, value: fresh };
      },
    },
    timeline: {
      page: async () => ({ ok: true as const, value: { items: [], events: [] } }),
    },
  } as unknown as DesktopApi;

  await expect(createFreshDesktopCampaign(api)).resolves.toEqual({
    campaign: fresh,
    branchId: "branch-new",
    state: expect.objectContaining({ version: 0 }),
    events: [],
  });
  expect(calls).toEqual(["create", "open:campaign-new"]);
});

test("切换或恢复后从主进程分支重放状态", async () => {
  const restored = campaign({
    campaignId: "campaign-old",
    headBranchId: "branch-restored",
    headStateVersion: 2,
  });
  const events = [
    {
      id: "event-1",
      turnId: "turn-1",
      seq: 0,
      versionAfter: 1,
      clock: 1,
      summary: "进入书房",
      visibility: "public",
      cause: "player",
      payload: { type: "moved", to: "loc.study", via: "door", minutes: 1 },
    },
  ];
  const api = {
    campaign: {
      open: async () => ({ ok: true as const, value: restored }),
    },
    timeline: {
      page: async () => ({ ok: true as const, value: { items: [], events } }),
    },
  } as unknown as DesktopApi;

  const loaded = await loadDesktopCampaign(api, "campaign-old");
  expect(loaded?.branchId).toBe("branch-restored");
  expect(loaded?.events).toHaveLength(1);
  expect(loaded?.state.version).toBe(1);
  expect(loaded?.state.pcAt).toBe("loc.study");
});

test("读取目标分支失败时不会把旧战役伪装成空白新局", async () => {
  const api = {
    campaign: {
      open: async () => ({ ok: true as const, value: campaign() }),
    },
    timeline: {
      page: async () => ({
        ok: false as const,
        error: { code: "IPC_INTERNAL_ERROR", messageKey: "timeline.failed" },
      }),
    },
  } as unknown as DesktopApi;

  await expect(loadDesktopCampaign(api, "campaign-new")).resolves.toBeNull();
});
