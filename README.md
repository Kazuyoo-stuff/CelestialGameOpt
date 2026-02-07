# ⚡ Celestial Game Opt

**Celestial Game Opt** is an adaptive, low-overhead runtime optimization framework designed to enhance Android game performance while preserving system stability and responsiveness.

Unlike traditional performance tweaks that rely on static parameters or aggressive forcing, Celestial operates through a **lightweight adaptive loop**, reacting to real-time system conditions such as CPU load, memory availability, and frame pacing.

---

## ✨ Key Philosophy

Celestial is built on four core principles:

- **Adaptive, not aggressive**  
  Optimizations are applied dynamically based on real device state.

- **Low priority, minimal overhead**  
  Runs with reduced scheduler and I/O priority to avoid interfering with gameplay.

- **Runtime-aware logic**  
  Continuously observes system metrics instead of applying one-time tweaks.

- **Safe restoration**  
  Automatically restores baseline behavior when games exit or the system is idle.

---

## 🧠 Core Logic Overview

Celestial follows a structured decision flow:

1. Initialize in a safe, low-impact execution state  
2. Detect environment (Android version, display FPS, active games)  
3. Collect runtime telemetry (CPU, RAM, FPS stability)  
4. Decide optimal actions based on current conditions  
5. Apply lightweight optimizations  
6. Monitor continuously in a low-overhead loop  
7. Restore safe defaults when no longer needed  

This ensures performance gains without compromising thermal balance or UI smoothness.

---

## 🔁 Adaptive Optimization Flow
CelestialGameOpt Logic
├── Script Start / Trigger
│   ├── Boot / Manual / WebUI
│   └── Mode Detection (Normal / Performance)
│
├── Safe Priority Setup
│   ├── nice / uclamp / taskset
│   └── Safe baseline preparation
│
├── Environment Detection
│   ├── Device & Kernel info
│   ├── Active App / Game List
│   └── FPS / Refresh Rate
│
├── Runtime Telemetry
│   ├── CPU load
│   ├── RAM usage
│   └── FPS / Render state
│
├── Adaptive Decision Engine ──▶ Optimization Apply
│   ├── Condition evaluation          ├── Render optimization
│   ├── Lightweight adaptive logic    ├── Memory tuning
│   └── Optimization selection        └── CPU scheduling
│
├── Monitoring Loop
│   ├── Low overhead runtime check
│   ├── Re-evaluate on change
│   └── Prevent redundant apply
│
└── Restore Safe Baseline
    ├── Revert temporary tweaks
    ├── Cleanup state
    └── Minimal logging

---

## 🧩 What Makes Celestial Different?

| Feature | Celestial Game Opt | Typical Game Tweaks |
|------|------------------|-------------------|
| Runtime adaptive loop | ✅ Yes | ❌ No |
| Low-priority execution | ✅ Yes | ❌ No |
| Dynamic restore mechanism | ✅ Yes | ❌ No |
| Minimal log / spam | ✅ Yes | ❌ Often noisy |
| Hardware-agnostic logic | ✅ Yes | ❌ Device-specific |

Celestial focuses on **balance**, not brute force.

---
