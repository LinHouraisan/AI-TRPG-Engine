/**
 * 带种子的掷骰。种子与回合编号绑定，因此同一个回合重试叙述时，
 * 掷出来的点数不会变——重掷一次骰子必须是显式的新回合。
 */

export function hashText(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngFrom(seed: string): () => number {
  return mulberry32(hashText(seed));
}

export function rollFor(seed: string, turnId: string, sides: number): number {
  const next = rngFrom(`${seed}:${turnId}`);
  return 1 + Math.floor(next() * sides);
}
