export type DiceMode = "normal" | "advantage" | "disadvantage";

export type DiceTerm = {
  count: number;
  sides: number;
  rolls: number[];
  kept: number[];
};

export type DiceResult = {
  notation: string;
  mode: DiceMode;
  total: number;
  terms: DiceTerm[];
  modifier: number;
  detail: string;
};

const TERM_RE = /(\d*)d(\d+)/gi;
const MOD_RE = /([+-]\d+)(?!d)/g;

function rollDie(sides: number): number {
  return 1 + Math.floor(Math.random() * sides);
}

export function rollDice(
  notation: string,
  mode: DiceMode = "normal",
): DiceResult {
  const cleaned = notation.replace(/\s+/g, "").toLowerCase();
  if (!cleaned) {
    throw new Error("骰式不能为空");
  }

  const terms: DiceTerm[] = [];
  let modifier = 0;

  for (const match of cleaned.matchAll(TERM_RE)) {
    const count = Math.min(100, Math.max(1, Number(match[1] || "1")));
    const sides = Math.min(1000, Math.max(1, Number(match[2])));
    const rolls = Array.from({ length: count }, () => rollDie(sides));
    terms.push({ count, sides, rolls, kept: [...rolls] });
  }

  for (const match of cleaned.matchAll(MOD_RE)) {
    modifier += Number(match[1]);
  }

  if (terms.length === 0) {
    throw new Error(`无法解析这个骰式：${notation}`);
  }

  if (mode !== "normal" && terms.length === 1 && terms[0].sides === 20 && terms[0].count === 1) {
    const extra = rollDie(20);
    terms[0].rolls.push(extra);
    const [a, b] = terms[0].rolls;
    terms[0].kept = [mode === "advantage" ? Math.max(a, b) : Math.min(a, b)];
  }

  const total =
    terms.reduce((sum, term) => sum + term.kept.reduce((a, b) => a + b, 0), 0) +
    modifier;

  const termText = terms
    .map((term) => {
      const shown = term.rolls.join(",");
      return `${term.count}d${term.sides}[${shown}]`;
    })
    .join(" + ");
  const modText = modifier === 0 ? "" : modifier > 0 ? ` + ${modifier}` : ` - ${Math.abs(modifier)}`;
  const modeText =
    mode === "normal" ? "" : mode === "advantage" ? "（优势）" : "（劣势）";

  return {
    notation,
    mode,
    total,
    terms,
    modifier,
    detail: `${termText}${modText} = ${total}${modeText}`,
  };
}
