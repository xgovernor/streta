import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * Opens an external URL in the system browser. Inside the Tauri webview
 * `window.open` and `target="_blank"` do not reach the OS, so the opener
 * plugin handles the hand-off; the browser build keeps a normal new tab.
 */
export async function openExternal(url: string): Promise<void> {
  if ("__TAURI_INTERNALS__" in window) {
    try {
      await openUrl(url);
      return;
    } catch {
      // Fall through to the browser path if the plugin is unavailable.
    }
  }

  window.open(url, "_blank", "noopener,noreferrer");
}
