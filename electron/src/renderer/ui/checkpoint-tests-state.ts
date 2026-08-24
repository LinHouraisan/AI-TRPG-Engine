export function partitionCheckpoints<T extends { branchId: string }>(
  rows: T[],
  branchId: string,
): { current: T[]; history: T[] } {
  return {
    current: rows.filter((row) => row.branchId === branchId),
    history: rows.filter((row) => row.branchId !== branchId),
  };
}

export function restoreNeedsConfirmation(currentVersion: number, checkpointVersion: number): boolean {
  return checkpointVersion < currentVersion;
}

export function checkpointLabel(version: number, now = new Date()): string {
  return `手动检查点 v${version} · ${now.toLocaleString("zh-CN")}`;
}
