export function resolveElectronPacksRoot(
  configuredRoot: string | undefined,
  resourcesPath: string | undefined,
  join: (...parts: string[]) => string,
): string | undefined {
  if (configuredRoot) return configuredRoot;
  return resourcesPath ? join(resourcesPath, "packs") : undefined;
}

export function fileUrlPathnameToFsPath(pathname: string, platform: string): string {
  const decoded = decodeURIComponent(pathname);
  return platform === "win32" && /^\/[A-Za-z]:\//.test(decoded) ? decoded.slice(1) : decoded;
}
