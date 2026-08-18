import { importSrd, srdCount } from "@/lib/db";
import type { SrdDoc } from "@/lib/types";
import srdData from "@/data/srd.json";

export async function ensureSrd(): Promise<void> {
  const count = await srdCount();
  if (count > 0) return;
  await importSrd(srdData as SrdDoc[]);
}
