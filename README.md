![Celestial Logic Flow](https://raw.githubusercontent.com/Kazuyoo-stuff/CelestialGameOpt/main/docs/logic_flow.png)

# Celestial Game Opt

A runtime game optimization module for rooted Android devices. Detects when a game is running, applies targeted system tweaks, and restores defaults when you exit.

---

## How It Works

The core daemon polls the foreground app every 5 seconds. When a game from your list is detected, optimizations are applied. When you leave, everything reverts automatically.

```
Boot → service.sh → kazuyoo --execute
         ↓
    Loop every 5s
         ↓
    Foreground app = game?
    ├── Yes → apply optimizations
    └── No  → revert to baseline
```

The daemon runs at **nice 19, ionice idle** — never competing with your game for resources.

---

## What Gets Applied

- CPU governor set to `performance`, game threads profiled with top-app cpuset and realtime scheduler
- Fixed performance mode, adaptive power saver disabled, thermal unrestricted
- Hardware EGL and HWUI memory policy set aggressive
- Game Mode API (Android 12+): mode 2, UFW boost, I/O feature, loading boost
- OEM-specific flags for MediaTek, Qualcomm, and Unisoc
- All settings reverted automatically when game exits

---

## WebUI

Accessible via KernelSU/APatch/Ax manager.

- **Game tab** — gamelist management, per-game compile mode, DND toggle
- **Utility Tool** — refresh rate, composition type, game driver, GMS doze, network adjuster, logging
- **Cleaning** — RAM compaction and cache clear
- **Downscaling** — render scale via Game Mode API
- **DNS Private** — private DNS provider
- **Other tweaking** — improvement for android

---

## Requirements

- Support Android 9+
- Android 12+ recommended
- Magisk / KernelSU / APatch / AxManager

---

## Credits

- KSUN & AxManager for reference UI
`@AduhaiWelewele` · `@notzeetaa` · `@HoyoSlave` · `@LeanHijosdesusMadres` · `@Bias_khaliq` · `@Dcx400` · `@RiProG` · Matt Yang

---

## License

GPL-3.0 — see [LICENSE](LICENSE)
