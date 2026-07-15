# Changelog

## [v3.2]

- Refactored `game_profiles_server` into modular functions — `enter_game_mode`, `exit_game_mode`, `apply_task_profile`, `apply_settings_on`, `apply_settings_off`, `apply_soc_on`, `apply_soc_off`, `notify`, `is_screen_on`, `get_fg_pkg` each with single responsibility
- Moved SOC detection (`MTK`/`QCOM`) outside the daemon loop — detected once at startup, not re-evaluated every iteration
- Added separate idle and gaming poll intervals — `IDLE_INTERVAL=10s` when no game running, `POLL_INTERVAL=5s` when game active, reducing CPU overhead and battery drain during idle
- Fixed battery drain after game exit — `power_mode middle` corrected to `power_mode normal` in `apply_settings_off`
- Fixed `--stop` case — replaced `pkill -f cgo_engine` with `kill -9 $(cat $SVC_PID_FILE)` + `rm -f $SVC_PID_FILE`
- Added Transsion `gamecube` and `game_*` settings to `apply_settings_on` — `game_do_not_disturb`, `gamecube_competition_mode_state`, `gamecube_competition_system_state`, `gamecube_block_notification_state`, `gamecube_refused_call_state`, `gamecube_lock_screen_brightness_state`, `gamecube_shorten_nav_bar_key_state`, `game_scene_more_fps`, `gamecube_shield_screen_capture_state`
- Added `gamecube` and `game_*` revert in `apply_settings_off` — all toggled settings restored to default values on game exit
- Added `device_config override` block in `final_optimize_gpu` — `core_graphics` SurfaceFlinger flags, `art_performance` ART compiler flags, and `game` ADPF flags
- Added ADPF overrides — `adpf_gpu_report_actual_work_duration=true`, `adpf_gpu_sf=true`, `adpf_hwui_gpu=false`, `adpf_prefer_power_efficiency=false`
- Added `core_graphics` overrides — `latch_unsignaled_with_auto_refresh_changed=false`, `use_known_refresh_rate_for_fps_consistency=true`, `cache_when_source_crop_layer_only_moved=true`, `commit_not_composited=true`, `add_sf_skipped_frames_to_trace=false`
- Added `art_performance` overrides — `fast_baseline_compiler=true`, `reg_alloc_spill_slot_reuse=true`, `use_app_image_startup_cache=true`
- Fixed WebUI `checkServiceRunning` — was incorrectly reading `svc_server.log` instead of `svc_server.pid`
- Fixed WebUI `reloadServer` — binary reference corrected from `cgo_engine` to `game_profiles`
- Upgraded WebUI PID detection to three-layer check — PID file → `pgrep` → `/proc` cmdline scan fallback for both GAP and `game_profiles` service
- Fixed WebUI `writeGameList` — now uses atomic tmpfile + `mv` to prevent race condition on concurrent writes
- Centralized `readGameList` as single reusable function — eliminates duplicated parsing logic across toggle, add, remove operations
- Fixed WebUI `restoreSession` — `job_scheduler_limit` and `storage_pressure` now restored via dedicated handlers instead of generic `safeExecScript` on reboot
- Added `visibilitychange` listener to system stats monitor — pauses update cycle when WebUI tab is hidden to reduce background overhead
- Extracted `applyJobSchedulerLimit` and `applyStoragePressure` as standalone async functions — reused in both toggle handlers and session restore
- Fixed `restoreSession()` in script.js silently skipping every on/off tweak (job scheduler, storage pressure, GMS doze, disable logging, sensor disable, network adjuster, saver, ram compact) after a reboot due to a `PERSIST_KEYS` set that excluded them from being re-applied
- Added dedicated `applyJobSchedulerLimit()` and `applyStoragePressure()` helpers so both the UI toggle handlers and `restoreSession()` share the same logic instead of duplicating it
- Fixed reboot restore for `composition`/`renderer`/`refresh`/`driver`/`dns_private` to correctly re-exec only when their value isn't `off`/`Default`
- Fixed `build_game_list()` in script.sh overwriting `gamelist.txt` from scratch on every boot, which wiped user-managed enable/disable state and custom entries added via the WebUI
- Changed `build_game_list()` to merge: use `/data/adb/kazuyoo_gamelist.txt` as the base when it exists, and only append newly detected games not already present (enabled or disabled), falling back to a full scan only on first install
- Fixed nested single-quote corruption inside `sh -c '...'` wrappers in `gms_doze` (on/off) and `saver on` in the kazuyoo dispatcher, which silently broke/truncated those background commands
- Fixed `saver on` referencing `$GAMELIST_FILE` and `$DS_VAL` inside a child shell without exporting them (and `$DS_VAL` was never even set in that branch), causing the game-overlay reset loop to always no-op
- Changed `gms_doze` and `saver on` to write their logic to temp script files via heredoc and execute those, avoiding nested-quote issues entirely
- Fixed `saver off` writing the engine PID to `svc_server.log` instead of `svc_server.pid`, which is what `checkServiceRunning()`/`reloadServer()` in the WebUI actually read
- Fixed nested single-quote corruption in uninstall.sh's reset block (`grep -oE`, `sed 's/...'`, `tr -d ' '` inside the outer `sh -c '...'`), where an unquoted space from the broken nesting truncated the command before the GMS netpolicy restore loop and driver-settings cleanup loop ever ran
- Fixed duplicated `for X in for X in $(...)` loops (game list reset loop and GMS package loop) in uninstall.sh
- Changed uninstall.sh's reset block to run from a temp script file via heredoc instead of an inline `sh -c '...'` one-liner
- Flagged `$AXERONXBIN` in uninstall.sh as referenced but never defined/exported, risking `rm -f /kazuyoo*` at filesystem root instead of removing the actual installed binaries
- Flagged that `/data/adb/kazuyoo_gamelist.txt` (the gamelist backup) is not removed by uninstall.sh's cleanup, so custom game entries persist across reinstall unless removed intentionally
