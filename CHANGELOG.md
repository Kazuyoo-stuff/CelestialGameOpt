# Changelog

## [v3.3]

## Fixed
- Fixed `uninstall.sh` killing itself mid-reset: the temp reset script's filename matched the `pkill -f "cgo_engine|kazuyoo|RC"` pattern, causing the cleanup process to terminate before finishing all `settings`/`device_config` resets.
- Fixed `wait` being placed after `pkill` instead of before it, which made the wait ineffective once the self-kill bug triggered.
- Fixed `debug.hwui.app_memory_policy` using invalid values (`aggressive`, `balanced`) that don't match any recognized policy string in HWUI, silently falling back to default behavior. Replaced with valid values: `default` on game enter, `lowram` on game exit.
- Fixed `game_auto_temperature_control` being set to the same value (`0`) in both `apply_settings_on` and `apply_settings_off`, so the setting never actually toggles between game and non-game state.
- Identified `cmd activity memory-factor set CRITICAL` during gameplay as dispatching `TRIM_MEMORY_RUNNING_CRITICAL` directly to the foreground game process (not just background apps), likely causing both slow game loading and in-session stutter. Removing the override during active gameplay.
- Identified that `cached_apps_freezer` alone has no effect on devices where `activity_manager_native_boot/use_freezer` defaults to `false`; setting both together.

## Optimized
- `get_fg_pkg()`: removed unconditional heavy `cmd activity stack list` call on every poll tick — now only runs as a fallback when the primary detection method returns empty.
- `get_fg_pkg()`: merged `grep | awk` into a single `awk` call with early `exit`, and fixed an unquoted glob pattern (`,0.*=t`) that could misbehave depending on working-directory contents.
- `refresh_game_list()`: gamelist.txt is now cached and only re-parsed when its mtime changes, instead of being read from disk on every 5-second poll.
- `apply_settings_on()` / `apply_settings_off()`: replaced 14 separate `settings list` dumps per call with a single dump per namespace (`system`/`secure`/`global`), reused in memory for all checks.
- `build_game_list()`: replaced generic `com\.[a-zA-Z0-9._]+` extraction from `dumpsys game` with a precise `Name:` field extraction, reducing false positives from unrelated component/class names.
- `build_game_list()`: replaced the O(n²) merge loop (double `grep -qxF` per detected package against the growing backup file) with a single-pass `grep -vFxf` diff.
- `build_game_list()`: removed in-memory string concatenation in a `while read` loop in favor of file-based filtering.
- Boot script `tweaks_optimization()`: preload-enable step now reads the already-built `gamelist.txt` instead of iterating every installed package and re-running `dumpsys game` on each iteration.
- Boot script `tweaks_optimization()`: batched the "vivo opt" `settings list system` checks into a single dump, reused across all 9 checks.
- Boot script `tweaks_optimization()`: removed a redundant `su -c` wrapper around `resetprop` in a context that already runs as root.
- Shell-priority loop: merged `ps | grep ^shell | awk` into a single `ps | awk '$1=="shell"'`.
- Added `wait` after the parallel `device_config delete`/`clear_override` loop in the uninstall reset script to ensure all background jobs finish before the script proceeds.

## Added / UI
- Added a "Device Config Tweaks" toggle to the Utility Tool page, wired to a new `dev_conf` case in the `kazuyoo` bin script for enabling/disabling the `device_config` override set.
