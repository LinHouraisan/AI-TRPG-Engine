import { latestDialogueTurns, type DialogueTurn } from "./dialogue-context";

export class PersistedDialogueSource {
  private readonly turns = new Map<string, DialogueTurn[]>();
  private readonly saves = new Map<string, Promise<void>>();

  recent(branchId: string): DialogueTurn[] {
    return [...(this.turns.get(branchId) ?? [])];
  }

  hydrate(branchId: string, turns: DialogueTurn[]): void {
    this.turns.set(branchId, latestDialogueTurns(turns));
  }

  persist(
    branchId: string,
    turns: DialogueTurn[],
    save: () => Promise<void>,
  ): Promise<void> {
    const previous = this.saves.get(branchId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      await save();
      this.turns.set(branchId, latestDialogueTurns(turns));
    });
    this.saves.set(branchId, current);
    return current;
  }

  async settle(branchId: string): Promise<void> {
    await this.saves.get(branchId)?.catch(() => undefined);
  }

  async snapshot(branchId: string): Promise<DialogueTurn[]> {
    await this.settle(branchId);
    return this.recent(branchId);
  }
}
