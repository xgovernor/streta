// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    {
        // Workaround for WebKitGTK 2.40+ bug where DMA-BUF renderer triggers NeedDebuggerBreak trap
        // on Linux GPU drivers during WebGL/canvas hardware acceleration
        if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
            // SAFETY: Executed at the very start of main before any threads are spawned
            unsafe {
                std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
            }
        }
    }

    strata_lib::run()
}
