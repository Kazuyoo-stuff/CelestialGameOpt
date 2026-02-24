# Changelog

## [v2.8]
- Reworked entire UI layout with new modern concept inspired by KSU-Next and AxManager.
- Redesigned dashboard structure for cleaner hierarchy and better readability.
- Improved toggle interaction behavior and responsiveness.
- Updated game list UI rendering logic for more stable refresh.
- Added smarter task cgroup optimization for critical system processes (surfaceflinger, zygote, hwui, gpuservice).
- Enhanced task nice priority tuning for better rendering and input responsiveness.
- Optimized cpuset assignment for foreground, top-app, and background tasks.
- Improved TCP routing performance (initcwnd & initrwnd tuning).
- Increased GPU and DDR thermal trip limits for better sustained performance.
- Disabled Adreno temperature node restrictions for aggressive GPU performance.
- Added advanced FPSGO kernel optimization handling (auto format detection for gpu_block_boost).
- Disabled unnecessary PVR fence tracing to reduce overhead.
- Forced SDE Rotator clock to stay active for smoother display composition.
- Disabled simple_gpu_algorithm module for manual GPU control preference.
- Disabled Dynamic Clock Scaling (DCS) mode for more stable GPU frequency behavior.
- Disabled GPU tracing and aging mechanisms (MediaTek specific optimization).
- Enabled and forced FPSGO performance mode.
- Improved entropy wakeup thresholds for faster randomness availability.
- Applied Android 14+ ADPF (Adaptive Performance Framework) overrides for gaming optimization.
- Forced GPU client composition for full GPU rendering pipeline.
- Enabled performance-related system flags (perf_game_oom_enable, perf_rt_enable, speed_mode).
- Disabled vendor battery performance limiter (e.g., Oplus battery restriction).
- Improved benchmark detection and integration into game list.
- Refactored game list builder logic for better compatibility across Android versions.
- General performance tuning and internal optimization cleanup.
