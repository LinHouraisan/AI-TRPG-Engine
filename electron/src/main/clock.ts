export interface Clock {
  now(): Date;
  nowIso(): string;
  monotonicMilliseconds(): number;
}

export function systemClock(): Clock {
  return {
    now: () => new Date(),
    nowIso: () => new Date().toISOString(),
    monotonicMilliseconds: () => performance.now(),
  };
}

export function fixedClock(iso: string): Clock {
  const date = new Date(iso);
  return {
    now: () => date,
    nowIso: () => date.toISOString(),
    monotonicMilliseconds: () => 0,
  };
}
