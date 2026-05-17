# Changelog

## [v3.1]

- Added Battery Saver toggle button on status card (home page)
- Fixed Battery Saver toggle not executing command when clicked before opening Utility Tool page
- Fixed Battery Saver toggle showing as active on first install
- Fixed localStorage not resetting on module reinstall — now uses layered detection: reset flag → module version check → first install fallback
- Removed redundant `saverToggle` handler from `openSettingsPage` to prevent listener conflict
- Added `setDefaultStates()` helper to centralize default state initialization
- Added Reload Server button on Logging page with live service status indicator
- Fixed `_module_ver` added to `SKIP_RESTORE_KEYS` to prevent version key from being restored as a toggle
- Added `saver` mode
- Fixed `--execute` daemon not surviving after KSU shell exit — replaced `trap "" HUP` subshell with `setsid` for proper session detachment
- Fixed `disown` error on Android sh — removed since `setsid` alone is sufficient for daemonization
- Fixed PID detection race condition in `--execute` — added `sleep 2` before pgrep to allow `game_profiles_server` to exec into `cgo_engine`
- Simplified `--execute` to follow consistent PID file pattern using `kill -0` check
- Changed daemon PID detection from `pgrep -f` to `pgrep -x cgo_engine` for exact process name match
- Added `taskset`, `renice`, `ionice` to `--execute` for consistent process priority handling

---

**WebUI v3.0.1**

- Refactored service status checking into a single shared `checkServiceRunning()` utility, eliminating duplicated logic across functions
- `updateServiceStatus()` now calls `checkServiceRunning()` directly instead of reimplementing its own process detection
- Fixed `reloadServer()` UI getting stuck in "Restarting..." state by properly detaching `cgo_engine` with `</dev/null >/dev/null 2>&1 &`, preventing the shell from blocking on stdout
- Added dedicated **Service Manager** page under Settings → Service, separated from Logging
- Removed service status section from Logging template; Logging page now shows log viewer only
- Service Manager page features MD3-styled status card with glowing dot indicator, process info list, restart button, and inline note
- Status card icon on home page now dynamically updates between a **play icon** (running) and **info icon** (not running) with matching color, replacing the static warning triangle
- Both running and not-running states on the home status card now use identical visual treatment — same icon shape, same card style, color is the only difference (green vs red)
- `initServerStatus()` replaces the old `initLogServiceStatus()`, using new element IDs scoped to the server template
- `reloadServer()` now syncs the home page card via `updateServiceStatus()` at the end instead of duplicating state updates
