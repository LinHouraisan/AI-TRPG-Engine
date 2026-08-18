import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // 浏览器直连 Ollama 会撞上跨域，所以开发时一律走这层代理。
  // 地址写在 demo/.env.local 里（该文件不进版本库）。
  const ollama = env.OLLAMA_URL || "http://127.0.0.1:11434";

  return {
    plugins: [react(), tailwindcss()],
    // sqlite-wasm 用 new URL("sqlite3.wasm", import.meta.url) 找自己的 wasm，
    // 预打包会把这个相对位置搞丢，所以让它保持原样。
    optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      port: 1421,
      proxy: {
        "/ollama": {
          target: ollama,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/ollama/, ""),
        },
      },
    },
  };
});
