import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;

const CESIUM_ASSETS = [
  "Assets",
  "Widgets",
  "Workers",
  "ThirdParty",
].map((name) => ({
  src: `node_modules/cesium/Build/Cesium/${name}`,
  dest: "cesium",
  // Strip node_modules/cesium/Build/Cesium so the asset lands at
  // dist/cesium/Assets/... rather than dist/cesium/node_modules/...
  rename: { stripBase: 4 },
}));

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [
      react(),
      tailwindcss(),
      viteStaticCopy({ targets: CESIUM_ASSETS }),
    ],
    define: {
      "import.meta.env.GOOGLE_MAPS_API_KEY": JSON.stringify(env.GOOGLE_MAPS_API_KEY || ""),
      "import.meta.env.CESIUM_ION_TOKEN": JSON.stringify(env.CESIUM_ION_TOKEN || ""),
      "import.meta.env.TOMTOM_API_KEY": JSON.stringify(env.TOMTOM_API_KEY || ""),
      "import.meta.env.FIRMS_MAP_KEY": JSON.stringify(env.FIRMS_MAP_KEY || ""),
      "import.meta.env.AISSTREAM_API_KEY": JSON.stringify(env.AISSTREAM_API_KEY || ""),
      "import.meta.env.OPENSKY_CLIENT_ID": JSON.stringify(env.OPENSKY_CLIENT_ID || ""),
    },

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent Vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
      port: 1420,
      strictPort: true,
      host: host || true,
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        // 3. tell Vite to ignore watching `src-tauri`
        ignored: ["**/src-tauri/**"],
        usePolling: true,
        interval: 100,
      },
    },
  };
});

