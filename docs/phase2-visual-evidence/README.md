# Phase 2 viewport evidence

These images were captured on 2026-09-02 from the actual Tauri development binary (`target/debug/peak-pos-desktop`) running in Xvfb. The window was resized through the native X11 window boundary before each capture; ImageMagick verified the resulting PNG dimensions.

The application was launched with `VITE_PEAK_VISUAL_FIXTURE=terminal`. That development-only switch renders a deterministic composition made from the production Peak Terminal shell and primitives, avoiding any dependency on a live hotel backend while preserving the real Tauri/WebKit rendering path. Production builds render the normal authenticated application.

| Evidence | Verified pixels | Responsive behavior |
| --- | ---: | --- |
| `peak-terminal-1024x768.png` | 1024×768 | Compact icon context rail, three-column product density, 304px persistent order rail |
| `peak-terminal-1280x800.png` | 1280×800 | Expanded labeled context rail, three-column product density, 340px order rail |
| `peak-terminal-1366x768.png` | 1366×768 | Expanded context rail, four-column product density, 360px order rail |
| `peak-terminal-1440x900.png` | 1440×900 | Expanded context rail, four-column product density, 380px order rail |

The runtime reached Cargo's `Finished` state and launched `target/debug/peak-pos-desktop`. The virtual display reported a benign `libEGL` DRI3 software-rendering warning; the application stayed running and all four captures completed.
