# Changelog

## [v2.9]
**v2.9 Changelog**

- Fixed restore session — composition & renderer re-applied after reboot.
- Fixed gamelist disappearing after reboot with persistent backup to `/data/adb/`.
- Fixed duplicate `.section-title` CSS causing margin issues.
- Fixed scroll lag in WebUI by removing slideUp animation and adding GPU compositing hints.
- Fixed overflow reset bug in closeSubPage and closeDownloadDialog.
- Fixed `$gms` variable bug in uninstall.sh GMS doze loop.
- Fixed missing `rm -f /data/adb/kazuyoo_gamelist.txt` in uninstall.sh.
- Removed redundant `bindBtn` and `bindSw` calls for non-existent DOM elements.
- Added Job Scheduler Limit toggle in cleaning menu.
- Added GMS Doze warning dialog before enabling.
- Added Game Preload status popup.
- Added UNISOC-specific game props — frameboost, pwctl, ylog, aegean mem compact.
- Added daily smooth props for pwctl in service.sh.
- Redesigned about page with horizontal layout and MD3 list style credits.
- Improved WebUI restore session logic with skipKeys and persistKeys separation.
