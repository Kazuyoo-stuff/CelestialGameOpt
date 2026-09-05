# Changelog

## [v3.4]

- Fixed a critical bug where `apply_task_profile()` applied a UI boost (`cmd ufw settings set-boost-tid ... ui true`) to every single thread of the game process instead of just the main thread, causing dozens of unnecessary Binder calls on game launch
- Added proper per-role priority boosting: `ui` boost for the main thread only, `animator` boost for RenderThread, and `bt-inherit-rt`/`bt-skp-prio-restore` for Binder threads
- Fixed a leak where per-thread boosts applied on game entry were never reverted on game exit
- Added direct kernel-level priority tuning (`taskset`, `renice`, `ionice`, `chrt`) on top of the Unisoc-specific `cmd ufw` calls, so the module also benefits non-Unisoc devices
- Fixed a self-kill bug in `--stop` where `pkill -9 -f cgo_engine` (or the equivalent `/proc` scan in the C port) matched the invoking process's own command line and killed itself before completing
- Fixed `--stop` to report accurate status ("Service stopped." vs "Service not running.") instead of always printing "not running", and to clean up the stale PID file on success
- Fixed a state leak where turning the screen off during an active game session permanently skipped `exit_game_mode`, leaving all performance overrides applied indefinitely
- Added a full C port of `cgo_engine`, using direct syscalls (`sched_setaffinity`, `setpriority`, `sched_setscheduler`, `ioprio_set`, system property API) instead of exec'ing external binaries wherever possible
- Fixed 7 settings in `service.sh` (`game_do_not_disturb`, `game_scene_more_fps`, `gamecube_background_call_state`, `gamecube_block_notification_on`, `gamecube_block_notification_state`, `gamecube_competition_mode_state`, `gamecube_competition_system_state`) that were missing the `settings put system` prefix and silently failing to apply
- Fixed an argument-shift bug in `service.sh`'s background trim-memory loop when a target app wasn't running
- Fixed `build_game_list()` only checking `pm list packages` as a fallback when `dumpsys game` returned nothing, instead of merging both sources — games without the `isGame` flag (e.g. spin-off titles) were silently excluded whenever any other game was already detected via `dumpsys game`
- Fixed a WebUI bug where a failed script-path lookup on first load was cached permanently for the entire session, requiring the user to force-close and reopen the manager app before the WebUI would work
