export function deepSeekPreset() {
  return {
    providerType: "deepseek",
    displayName: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    modelId: "deepseek-v4-flash",
  } as const;
}

export function providerPatchForType(providerType: string) {
  return providerType === "deepseek" ? deepSeekPreset() : { providerType };
}

export function secretStateAfterSave(_secret: string): string {
  return "";
}
