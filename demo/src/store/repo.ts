import type { DirectorFrontier } from "@/ai/director";
import { emptyMemory, type MemoryEntry, type MemoryState } from "@/ai/memory";
import type { CheckResult, GameEvent, GameState } from "@/engine/types";
import type { Driver, Row } from "./driver";
import { SCHEMA } from "./schema";

/** play 是团里的对话；notice 是程序刚才做了什么，不该进这一场的记录。 */
export type StoredMessageKind = "play" | "notice";

export type StoredMessage = {
  role: "kp" | "pl" | "system";
  text: string;
  stateVersion: number;
  source?: "模型" | "模板" | "程序";
  note?: string;
  check?: CheckResult;
  kind?: StoredMessageKind;
};

export type BranchInfo = {
  id: string;
  title: string;
  parentBranch: string | null;
  forkSeq: number | null;
  createdAt: number;
  events: number;
  version: number;
};

export type CampaignHandle = {
  campaignId: string;
  branchId: string;
  initialState: GameState;
  fresh: boolean;
};

export type ExportPayload = {
  format: "ai-trpg-engine/campaign";
  version: 1;
  campaign: { id: string; title: string; packRef: string; initialState: GameState };
  branches: {
    id: string;
    title: string;
    parentBranch: string | null;
    forkSeq: number | null;
    events: GameEvent[];
    messages: StoredMessage[];
  }[];
};

/**
 * 一场团的仓储。
 *
 * 权威的只有事件；状态与快照都是从事件推出来的，丢了可以再算一遍。
 * 回滚不改历史，而是从那一刻分出一条新分支——旧分支永远还在那儿，可以翻回去看。
 */
export class Store {
  private constructor(private readonly driver: Driver) {}

  static async open(driver: Driver): Promise<Store> {
    await driver.exec(SCHEMA);
    // 老库是 CREATE TABLE IF NOT EXISTS 建的，不会自己长出 kind 这一列。
    await ensureMessageKindColumn(driver);
    return new Store(driver);
  }

  get backend(): string {
    return this.driver.name;
  }

  async close(): Promise<void> {
    await this.driver.close();
  }

  /** 续上这份资料包最近的那一场；没有就新开一场。 */
  async openCampaign(params: {
    packRef: string;
    title: string;
    initialState: GameState;
    /** 重开一场：旧的那场留在库里，不删 */
    forceNew?: boolean;
  }): Promise<CampaignHandle> {
    const existing = params.forceNew
      ? []
      : await this.driver.all<Row>(
          `SELECT id, head_branch, initial_state FROM campaign
           WHERE pack_ref = ? ORDER BY created_at DESC LIMIT 1`,
          [params.packRef],
        );

    if (existing.length > 0) {
      const row = existing[0];
      return {
        campaignId: String(row.id),
        branchId: String(row.head_branch),
        initialState: JSON.parse(String(row.initial_state)) as GameState,
        fresh: false,
      };
    }

    const now = Date.now();
    const campaignId = `cam-${now}`;
    const branchId = `br-${now}`;
    await this.driver.run(
      `INSERT INTO campaign (id, title, pack_ref, initial_state, head_branch, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [campaignId, params.title, params.packRef, JSON.stringify(params.initialState), branchId, now],
    );
    await this.driver.run(
      `INSERT INTO branch (id, campaign_id, title, parent_branch, fork_seq, created_at)
       VALUES (?, ?, ?, NULL, NULL, ?)`,
      [branchId, campaignId, "主线", now],
    );

    return { campaignId, branchId, initialState: params.initialState, fresh: true };
  }

  /** 只追加。同一个 (分支, 序号) 插第二次会被主键挡住，重复提交进不来。 */
  async appendEvents(branchId: string, events: GameEvent[]): Promise<void> {
    const now = Date.now();
    for (const event of events) {
      await this.driver.run(
        `INSERT INTO event
           (branch_id, seq, event_id, turn_id, version_after, clock, visibility, cause, summary, narration, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          branchId,
          event.seq,
          event.id,
          event.turnId,
          event.versionAfter,
          event.clock,
          event.visibility,
          event.cause,
          event.summary,
          event.narration ?? null,
          JSON.stringify(event.payload),
          now,
        ],
      );
    }
  }

  async loadEvents(branchId: string): Promise<GameEvent[]> {
    const rows = await this.driver.all<Row>(
      `SELECT * FROM event WHERE branch_id = ? ORDER BY seq ASC`,
      [branchId],
    );
    return rows.map(toEvent);
  }

  async saveCheckpoint(params: {
    branchId: string;
    cursor: number;
    stateVersion: number;
    stateHash: string;
    packRef: string;
    snapshot?: GameState;
  }): Promise<void> {
    await this.driver.run(
      `INSERT OR REPLACE INTO checkpoint
         (branch_id, cursor, state_version, state_hash, pack_ref, snapshot, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        params.branchId,
        params.cursor,
        params.stateVersion,
        params.stateHash,
        params.packRef,
        params.snapshot ? JSON.stringify(params.snapshot) : null,
        Date.now(),
      ],
    );
  }

  async latestCheckpoint(branchId: string): Promise<
    | {
        cursor: number;
        stateVersion: number;
        stateHash: string;
        packRef: string;
      }
    | undefined
  > {
    const rows = await this.driver.all<Row>(
      `SELECT cursor, state_version, state_hash, pack_ref FROM checkpoint
       WHERE branch_id = ? ORDER BY cursor DESC LIMIT 1`,
      [branchId],
    );
    if (rows.length === 0) return undefined;
    const row = rows[0];
    return {
      cursor: Number(row.cursor),
      stateVersion: Number(row.state_version),
      stateHash: String(row.state_hash),
      packRef: String(row.pack_ref),
    };
  }

  /** 对话不是事实，整段覆盖即可。读档从来不依赖它。system / notice 不落盘。 */
  async saveMessages(branchId: string, messages: StoredMessage[]): Promise<void> {
    const kept = messages.filter((message) => !isNoticeMessage(message));
    await this.driver.run(`DELETE FROM message WHERE branch_id = ?`, [branchId]);
    for (const [index, message] of kept.entries()) {
      await this.driver.run(
        `INSERT INTO message
           (branch_id, seq, role, text, state_version, source, note, check_json, kind)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          branchId,
          index,
          message.role,
          message.text,
          message.stateVersion,
          message.source ?? null,
          message.note ?? null,
          message.check ? JSON.stringify(message.check) : null,
          messageKind(message),
        ],
      );
    }
  }

  async loadMessages(branchId: string): Promise<StoredMessage[]> {
    const rows = await this.driver.all<Row>(
      `SELECT * FROM message WHERE branch_id = ? ORDER BY seq ASC`,
      [branchId],
    );
    return rows
      .map((row) => ({
        role: String(row.role) as StoredMessage["role"],
        text: String(row.text),
        stateVersion: Number(row.state_version),
        source: (row.source as StoredMessage["source"]) ?? undefined,
        note: row.note == null ? undefined : String(row.note),
        check:
          row.check_json == null ? undefined : (JSON.parse(String(row.check_json)) as CheckResult),
        kind: row.kind == null ? undefined : (String(row.kind) as StoredMessageKind),
      }))
      .filter((message) => !isNoticeMessage(message));
  }

  async listBranches(campaignId: string): Promise<BranchInfo[]> {
    const rows = await this.driver.all<Row>(
      `SELECT b.id, b.title, b.parent_branch, b.fork_seq, b.created_at,
              (SELECT COUNT(*) FROM event e WHERE e.branch_id = b.id) AS events,
              (SELECT IFNULL(MAX(version_after), 0) FROM event e WHERE e.branch_id = b.id) AS version
       FROM branch b WHERE b.campaign_id = ? ORDER BY b.created_at ASC`,
      [campaignId],
    );
    return rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      parentBranch: row.parent_branch == null ? null : String(row.parent_branch),
      forkSeq: row.fork_seq == null ? null : Number(row.fork_seq),
      createdAt: Number(row.created_at),
      events: Number(row.events),
      version: Number(row.version),
    }));
  }

  /**
   * 回到某一版：从那一刻分出一条新分支，把之前的事件原样搬过去。
   * 旧分支一个字都不动，随时可以翻回去看。
   */
  async fork(params: {
    campaignId: string;
    fromBranch: string;
    throughSeq: number;
    title: string;
  }): Promise<string> {
    const now = Date.now();
    const branchId = `br-${now}`;
    await this.driver.run(
      `INSERT INTO branch (id, campaign_id, title, parent_branch, fork_seq, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [branchId, params.campaignId, params.title, params.fromBranch, params.throughSeq, now],
    );
    await this.driver.run(
      `INSERT INTO event
         (branch_id, seq, event_id, turn_id, version_after, clock, visibility, cause, summary, narration, payload, created_at)
       SELECT ?, seq, event_id, turn_id, version_after, clock, visibility, cause, summary, narration, payload, ?
       FROM event WHERE branch_id = ? AND seq <= ? ORDER BY seq ASC`,
      [branchId, now, params.fromBranch, params.throughSeq],
    );
    return branchId;
  }

  async setHead(campaignId: string, branchId: string): Promise<void> {
    await this.driver.run(`UPDATE campaign SET head_branch = ? WHERE id = ?`, [
      branchId,
      campaignId,
    ]);
  }

  /** 导出的是事件记录，不是聊天记录：换一台机器重放，能得到一模一样的状态。 */
  async exportCampaign(campaignId: string): Promise<ExportPayload> {
    const rows = await this.driver.all<Row>(`SELECT * FROM campaign WHERE id = ?`, [campaignId]);
    if (rows.length === 0) throw new Error(`没有这一场：${campaignId}`);
    const campaign = rows[0];
    const branches = await this.listBranches(campaignId);

    return {
      format: "ai-trpg-engine/campaign",
      version: 1,
      campaign: {
        id: String(campaign.id),
        title: String(campaign.title),
        packRef: String(campaign.pack_ref),
        initialState: JSON.parse(String(campaign.initial_state)) as GameState,
      },
      branches: await Promise.all(
        branches.map(async (branch) => ({
          id: branch.id,
          title: branch.title,
          parentBranch: branch.parentBranch,
          forkSeq: branch.forkSeq,
          events: await this.loadEvents(branch.id),
          messages: await this.loadMessages(branch.id),
        })),
      ),
    };
  }

  async importCampaign(payload: ExportPayload): Promise<CampaignHandle> {
    if (payload.format !== "ai-trpg-engine/campaign") {
      throw new Error("这不是本引擎导出的存档");
    }
    const now = Date.now();
    const campaignId = `cam-${now}`;
    const remap = new Map<string, string>();
    payload.branches.forEach((branch, index) => remap.set(branch.id, `br-${now}-${index}`));
    const head = remap.get(payload.branches[payload.branches.length - 1]?.id ?? "") ?? `br-${now}-0`;

    await this.driver.run(
      `INSERT INTO campaign (id, title, pack_ref, initial_state, head_branch, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        campaignId,
        payload.campaign.title,
        payload.campaign.packRef,
        JSON.stringify(payload.campaign.initialState),
        head,
        now,
      ],
    );

    for (const branch of payload.branches) {
      const id = remap.get(branch.id)!;
      await this.driver.run(
        `INSERT INTO branch (id, campaign_id, title, parent_branch, fork_seq, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          id,
          campaignId,
          branch.title,
          branch.parentBranch ? (remap.get(branch.parentBranch) ?? null) : null,
          branch.forkSeq,
          now,
        ],
      );
      await this.appendEvents(id, branch.events);
      await this.saveMessages(id, branch.messages);
    }

    return {
      campaignId,
      branchId: head,
      initialState: payload.campaign.initialState,
      fresh: false,
    };
  }

  async saveMemory(branchId: string, memory: MemoryState): Promise<void> {
    const now = Date.now();
    await this.driver.run(`DELETE FROM memory_entry WHERE branch_id = ?`, [branchId]);
    for (const entry of memory.entries) {
      await this.driver.run(
        `INSERT INTO memory_entry (
          memory_id, branch_id, memory_type, summary, structured_json, source_event_ids_json,
          status, extracted_through_turn, scene_id, importance, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.id,
          branchId,
          entry.memoryType,
          entry.summary,
          JSON.stringify({ ...entry.structured, entityIds: entry.entityIds }),
          JSON.stringify(entry.sources),
          entry.status,
          entry.extractedThroughTurn,
          entry.sceneId,
          entry.importance,
          now,
        ],
      );
    }
    await this.driver.run(
      `INSERT OR REPLACE INTO memory_cursor (
        branch_id, raw_recorded_through_turn, memory_processed_through_turn
      ) VALUES (?, ?, ?)`,
      [branchId, memory.cursor.rawRecordedThroughTurn, memory.cursor.memoryProcessedThroughTurn],
    );
  }

  async loadMemory(branchId: string): Promise<MemoryState> {
    const cursors = await this.driver.all<Row>(
      `SELECT raw_recorded_through_turn, memory_processed_through_turn FROM memory_cursor WHERE branch_id = ?`,
      [branchId],
    );
    const rows = await this.driver.all<Row>(
      `SELECT * FROM memory_entry WHERE branch_id = ? ORDER BY created_at ASC, memory_id`,
      [branchId],
    );
    if (cursors.length === 0 && rows.length === 0) return emptyMemory();
    const cursor = cursors[0];
    return {
      cursor: {
        rawRecordedThroughTurn: cursor ? Number(cursor.raw_recorded_through_turn) : 0,
        memoryProcessedThroughTurn: cursor ? Number(cursor.memory_processed_through_turn) : 0,
      },
      entries: rows.map((row) => {
        const structured = JSON.parse(String(row.structured_json)) as MemoryEntry["structured"];
        const entityIds = structured.entityIds;
        return {
          id: String(row.memory_id),
          memoryType: String(row.memory_type) as MemoryEntry["memoryType"],
          summary: String(row.summary),
          sources: JSON.parse(String(row.source_event_ids_json)) as string[],
          entityIds: Array.isArray(entityIds)
            ? entityIds.filter((id): id is string => typeof id === "string")
            : [],
          sceneId: row.scene_id == null ? null : String(row.scene_id),
          importance: Number(row.importance),
          status: String(row.status) as MemoryEntry["status"],
          structured,
          extractedThroughTurn: Number(row.extracted_through_turn),
        };
      }),
    };
  }

  async saveFrontier(branchId: string, frontier: DirectorFrontier): Promise<void> {
    await this.driver.run(
      `INSERT OR REPLACE INTO director_frontier (
        branch_id, based_on_state_version, last_assessed_event_id, frontier_json, updated_at
      ) VALUES (?, ?, ?, ?, ?)`,
      [
        branchId,
        frontier.basedOnStateVersion,
        frontier.lastAssessedEventId,
        JSON.stringify(frontier),
        Date.now(),
      ],
    );
  }

  async loadFrontier(branchId: string): Promise<DirectorFrontier | undefined> {
    const rows = await this.driver.all<Row>(
      `SELECT frontier_json FROM director_frontier WHERE branch_id = ?`,
      [branchId],
    );
    if (rows.length === 0) return undefined;
    return JSON.parse(String(rows[0].frontier_json)) as DirectorFrontier;
  }
}

async function ensureMessageKindColumn(driver: Driver): Promise<void> {
  const cols = await driver.all<Row>(`PRAGMA table_info(message)`);
  if (cols.some((col) => String(col.name) === "kind")) return;
  await driver.exec(`ALTER TABLE message ADD COLUMN kind TEXT`);
}

/**
 * 在这个程序里，system 消息就是「程序刚才做了什么」，没有例外。
 * 缺类型的历史行按 role 认，不许默认成 play——那会把污染洗白。
 */
function isNoticeMessage(message: Pick<StoredMessage, "role" | "kind">): boolean {
  return message.role === "system" || message.kind === "notice";
}

function messageKind(message: Pick<StoredMessage, "role" | "kind">): StoredMessageKind {
  if (message.kind) return message.kind;
  return message.role === "system" ? "notice" : "play";
}

function toEvent(row: Row): GameEvent {
  return {
    id: String(row.event_id),
    seq: Number(row.seq),
    turnId: String(row.turn_id),
    versionAfter: Number(row.version_after),
    clock: Number(row.clock),
    visibility: String(row.visibility) as GameEvent["visibility"],
    cause: String(row.cause),
    summary: String(row.summary),
    narration: row.narration == null ? undefined : String(row.narration),
    payload: JSON.parse(String(row.payload)) as GameEvent["payload"],
  };
}
