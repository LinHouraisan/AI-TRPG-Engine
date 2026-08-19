import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";
import { systemClock } from "./clock";
import { createComposition } from "./composition";
import { registerIpc } from "./ipc/register";
import { LifecycleState } from "./lifecycle";
import { resolvePaths } from "./paths";
import { openBetterSqlite } from "./persist/better-sqlite";

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
  } else {
    void window.loadFile(join(__dirname, "../../demo/dist/index.html"));
  }
  lifecycle.set("ready");
}

function boot(): void {
  lifecycle.set("initializing_platform");
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
  app.whenReady().then(boot).catch((error: unknown) => {
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
