import type { AppState } from "../shared/api";

export type Lifecycle = AppState["lifecycle"];

export class LifecycleState {
  private current: Lifecycle = "cold";

  get(): Lifecycle {
    return this.current;
  }

  set(next: Lifecycle): void {
    this.current = next;
  }

  ready(): boolean {
    return this.current === "ready";
  }
}
