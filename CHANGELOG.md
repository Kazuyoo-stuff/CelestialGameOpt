# Changelog

## [v3.0]

**Changelog**

- Separated `game_profiles_server` into standalone `game_profiles` binary for cleaner daemon management
- Fixed daemon not starting — replaced broken `setsid sh -c '...'` with direct `refresh_loop >> log &`
- Fixed gamelist path mismatch — `TEMP_FILE` in script.js now points to `/data/local/tmp/gamelist.txt` consistent with GAP
- Added `game_profiles` to `customize.sh` extract and `chmod +x`
- Fixed settings put commands wrapped in background subshell to avoid blocking main loop
- Fixed `mode` variable not resetting after game exit causing duplicate triggers
- Remove root parameter or tweak for root in service.sh section (because I doubt if it will be stable)
- Optimized pid checking (now more thorough)
- more optimizations 
