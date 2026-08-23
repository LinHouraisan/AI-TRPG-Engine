export function resolveElectronPacksRoot(
  configuredRoot: string | undefined,
  resourcesPath: string | undefined,
  join: (...parts: string[]) => string,
): string | undefined {
  if (configuredRoot) return configuredRoot;
  return resourcesPath ? join(resourcesPath, "packs") : undefined;
}
