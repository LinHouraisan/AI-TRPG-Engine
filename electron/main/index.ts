import { app, BrowserWindow, shell } from "electron";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { systemClock } from "./clock";
import { createComposition } from "./composition";
import { registerIpc } from "./ipc/register";
import { LifecycleState } from "./lifecycle";
import { resolvePaths } from "./paths";
import { openBetterSqlite } from "./persist/better-sqlite";
import { withKeeperConfig } from "./model-config";
import { probeKeeper } from "../../demo/src/keeper/client";

const clock = systemClock();
const lifecycle = new LifecycleState();
let composition: ReturnType<typeof createComposition> | null = null;

function sqlDir(): string {
  return join(__dirname, "sql");
}

function createWindow(): void {
  lifecycle.set("creating_window");
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: "AI TRPG Engine",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    void window.loadURL(devUrl);
  } else if (app.isPackaged) {
    void window.loadFile(join(process.resourcesPath, "renderer/index.html"));
  } else {
    void window.loadFile(join(__dirname, "../../demo/dist/index.html"));
  }
  lifecycle.set("ready");
}

async function boot(): Promise<void> {
  lifecycle.set("initializing_platform");
  if (!process.env.AI_TRPG_PACKS_DIR) {
    process.env.AI_TRPG_PACKS_DIR = app.isPackaged
      ? join(process.resourcesPath, "packs")
      : join(app.getAppPath(), "../demo/src/data/packs");
  }
  const paths = resolvePaths(app.getPath("userData"));
  composition = createComposition({
    paths,
    clock,
    openDriver: openBetterSqlite,
    sqlDir: sqlDir(),
    lifecycle,
  });
  lifecycle.set("registering_ipc");
  registerIpc(composition, lifecycle, clock);
  if (process.argv.includes("--provider-smoke")) {
    const outputPath = process.argv.find((arg) => arg.startsWith("--provider-smoke-output="))?.slice("--provider-smoke-output=".length);
    let result: unknown;
    try {
      const configured = withKeeperConfig(composition.settings, composition.credentials, (config) => probeKeeper(config));
      if (!configured.ok) throw new Error(configured.error.code);
      result = { ok: true, probe: await configured.value };
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    const serialized = JSON.stringify(result);
    console.log(`PROVIDER_SMOKE ${serialized}`);
    if (outputPath) writeFileSync(outputPath, serialized, "utf8");
    composition.dispose();
    composition = null;
    app.quit();
    return;
  }
  createWindow();
}

const locked = app.requestSingleInstanceLock();
if (!locked) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [window] = BrowserWindow.getAllWindows();
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app.whenReady().then(() => boot()).catch((error: unknown) => {
    lifecycle.set("startup_failed");
    console.error(error);
    app.quit();
  });
  app.on("window-all-closed", () => {
    lifecycle.set("shutting_down");
    composition?.dispose();
    app.quit();
  });
}
