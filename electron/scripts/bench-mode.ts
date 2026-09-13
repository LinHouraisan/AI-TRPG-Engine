export function generationRetrieval<TIndex, TEmbed>(
  mode: string,
  index: TIndex | undefined,
  createEmbedder: () => TEmbed,
): { index?: TIndex; embed?: TEmbed } {
  if (mode === "base" || !index) return {};
  return { index, embed: createEmbedder() };
}
