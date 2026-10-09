// Celestial Game Opt
const localExec = (command, options = {}) => new Promise((resolve, reject) => {
  const cb = `exec_cb_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const cleanup = () => { try { delete window[cb]; } catch { window[cb] = undefined; } };
  window[cb] = (errno, stdout, stderr) => { cleanup(); resolve({ errno, stdout, stderr }); };
  try { window.ksu.exec(command, JSON.stringify(options), cb); }
  catch (e) { cleanup(); reject(e); }
});
const localToast = msg => { try { window.ksu?.toast?.(String(msg)); } catch {} };

let exec = localExec, toast = localToast;
if (!window.ksu) {
  try { ({ exec, toast } = await import('https://cdn.jsdelivr.net/npm/kernelsu@1.0.6/+esm')); }
  catch (e) { console.error("KernelSU bridge unavailable", e); }
}

const SCRIPT_NAME   = "kazuyoo";
const TEMP_FILE     = "/data/local/tmp/gamelist.txt";
const GAMELIST_BACKUP = "/data/adb/kazuyoo_gamelist.txt";

let Elements        = {};
let isSecondaryActive  = false;
let currentUtilityType = null;
let _gameListLocked    = false;
let _monitorTimer      = null;
let _pingTimerCounter  = 0;
let cachedScriptPath   = null;
let scriptPathResolved = false;
let cachedPingResult   = "-- ms";
let _subToken          = 0;
const markBusy = (ms = 800) => { window.__busyUntil = Date.now() + ms; };
const setText  = (el, v) => { if (el && el.innerText !== String(v)) el.innerText = String(v); };
let _tickCount         = 0;

function bgLimitLabel(value) {
  if (value === "Default" || value === "off" || !value) return "Standard";
  if (value === "0") return "No background processes";
  return `At most ${value} process${value === "1" ? "" : "es"}`;
}

const utilityConfigs = {
  'Background Process Limit': {
    key: 'bg_limit', opts: ["Default","0","1","2","3","4"],
    desc: "Cap how many cached background processes Android may keep — same official values as the Background process limit option in Developer options.",
    icon: "M4 6h16v2H4zm0 5h16v2H4zm0 5h10v2H4z",
    info: {
      "Default": "Standard limit — no override, system decides",
      "0": "No background processes",
      "1": "At most 1 process",
      "2": "At most 2 processes",
      "3": "At most 3 processes",
      "4": "At most 4 processes"
    }
  },
  'Refresh Rate': {
    key: 'refresh', opts: ["Default","60Hz","90Hz","120Hz","144Hz"],
    desc: "Force a display refresh rate. Higher values feel smoother but use more battery.",
    icon: "M20.38 8.57l-1.23 1.85a8 8 0 0 1-.22 7.58H5.07A8 8 0 0 1 15.58 6.85l1.85-1.23A10 10 0 0 0 3.35 19a2 2 0 0 0 1.72 1h13.85a2 2 0 0 0 1.74-1 10 10 0 0 0-.27-10.44zm-9.79 6.84a2 2 0 0 0 2.83 0l5.66-8.49-8.49 5.66a2 2 0 0 0 0 2.83z",
    info: { "Default": "Follow the system setting", "60Hz": "Best battery life", "90Hz": "Balanced smoothness and battery", "120Hz": "Smooth, higher power use", "144Hz": "Maximum, needs panel support" }
  },
  'Composition Type': {
    key: 'composition', opts: ["Default","gpu","cpu","dyn","hwc","c2d","mdp"],
    desc: "Choose how the screen layers are composed before they are shown.",
    icon: "M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z",
    info: { "Default": "Let the system decide", "gpu": "Compose frames on the GPU", "cpu": "Compose frames on the CPU", "dyn": "Switch dynamically between engines", "hwc": "Hardware Composer", "c2d": "C2D 2D engine (Qualcomm)", "mdp": "MDP display processor (Qualcomm)" }
  },
  'Game Driver': {
    key: 'driver', opts: ["Default","GameDriver","AngleNative"],
    desc: "Select which graphics driver games should use.",
    icon: "M15 9H9v6h6V9zm-2 4h-2v-2h2v2zm8-2V9h-2V7c0-1.1-.9-2-2-2h-2V3h-2v2h-2V3H9v2H7c-1.1 0-2 .9-2 2v2H3v2h2v2H3v2h2v2c0 1.1.9 2 2 2h2v2h2v-2h2v2h2v-2h2c1.1 0 2-.9 2-2v-2h2v-2h-2v-2h2zm-4 6H7V7h10v10z",
    info: { "Default": "Use the system graphics driver", "GameDriver": "Use the game driver package", "AngleNative": "Run OpenGL ES through ANGLE" }
  },
  'Renderer Engine': {
    key: 'renderer', opts: ["Default","skiagl","skiavk"],
    desc: "Select the HWUI backend used to draw the interface.",
    icon: "M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z",
    info: { "Default": "Use the system default", "skiagl": "Skia on OpenGL ES, widely compatible", "skiavk": "Skia on Vulkan, lower CPU overhead" }
  }
};

const SPECIAL_VALUE_KEYS = new Set(["composition","renderer","refresh","driver","dns_private"]);
const SKIP_RESTORE_KEYS  = new Set(["app_logs", "_module_ver", "last_sync_uptime", "first_install_run"]);

const EXEC_TIMEOUT_MS = 20000;
const safeExec = async (cmd, fallback = "") => {
  let timer;
  try {
    const res = await Promise.race([
      exec(cmd),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("exec timeout")), EXEC_TIMEOUT_MS); })
    ]);
    return String(res?.stdout ?? "").trim();
  } catch { return fallback; }
  finally { clearTimeout(timer); }
};
const isPid = v => /^\d+$/.test(String(v).trim());
const isPkg = v => /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$/.test(String(v).trim());

const getScriptPath = async () => {
  if (scriptPathResolved && cachedScriptPath) return cachedScriptPath;
  if ((await safeExec(`[ -f "${SCRIPT_NAME}" ] && echo 1`, "0")) === "1") {
    cachedScriptPath = SCRIPT_NAME;
    scriptPathResolved = true;
    return cachedScriptPath;
  }
  const path = (await safeExec(`command -v "${SCRIPT_NAME}"`, "")).trim();
  if (path) {
    cachedScriptPath = path;
    scriptPathResolved = true;
  }
  return cachedScriptPath;
};

const safeExecScript = async (command, value = "", silent = false) => {
  try {
    const script = await getScriptPath();
    if (!script) return "";
    const args   = value ? `${command} ${value}` : command;
    const useShell = !script.startsWith("/system/bin");
    const cmd    = useShell ? `sh ${script} ${args} 2>&1` : `${script} ${args} 2>&1`;
    const result = await exec(cmd);
    if (!silent) {
      const s = value === "on" || value === "trigger" ? "on"
              : value === "off" ? "off" : "success";
      window.addLog(`${command.toUpperCase()}: ${value || "Executed"}`, s);
    }
    return result.stdout.trim();
  } catch (err) { console.error(err); return ""; }
};

const applyJobSchedulerLimit = async (on) => {
  if (on) {
    await safeExec(`settings put global job_scheduler_constants "min_latency=7200000,max_latency=86400000,max_batch_delay=14400000,background_settle_time=60000,conn_congestion_delay=900000,conn_prefetch_relax=false,min_ready_non_active_jobs_count=10,max_cpu_only_job_batch_delay_ms=14400000,max_non_active_job_batch_delay_ms=14400000,standby_heartbeat=1800000,min_exp_backoff_time_ms=120000,system_stop_to_failure_ratio=1"`, "");
    await safeExec(`settings put global job_scheduler_time_controller_constants "active=3600000,working=10800000,frequent=21600000,rare=43200000,never=86400000"`, "");
    await safeExec(`settings put global job_scheduler_quota_controller_constants "max_job_count_active=5,max_job_count_working=3,max_job_count_frequent=1,max_job_count_rare=1,max_job_count_restricted=0,ej_limit_active_ms=30000,rate_limiting_window_ms=3600000,max_job_count_per_rate_limiting_window=5"`, "");
  } else {
    await safeExec("settings put global job_scheduler_constants 0", "");
    await safeExec("settings put global job_scheduler_time_controller_constants 0", "");
    await safeExec("settings put global job_scheduler_quota_controller_constants max_job_count_per_rate_limiting_window=10,rate_limiting_window_ms=60000,max_job_count_active=75,max_session_count_active=75", "");
  }
};

const applyStoragePressure = async (on) => {
  await safeExec(on ? "cmd devicestoragemonitor force-not-low" : "cmd devicestoragemonitor reset", "");
};

window.openSubTemplate = (pageTitle, templateId, callback = null) => {
  const secondary = document.getElementById('sub-page-secondary');
  if (secondary) secondary.classList.remove('active');
  isSecondaryActive  = false;
  currentUtilityType = null;

  const template = document.getElementById(templateId);
  const overlay  = document.getElementById('sub-page-overlay');
  const body     = document.getElementById('sub-page-body');
  const title    = document.getElementById('sub-page-title');
  if (!template || !overlay) return;

  markBusy();
  title.innerText  = pageTitle;
  body.innerHTML   = template.innerHTML;
  void body.offsetHeight;
  const token = ++_subToken;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (token !== _subToken) return;
    overlay.classList.add('active');
    document.body.classList.add('subpage-open');
  }));
  window.history.pushState({ page: 'subpage' }, '');
  if (callback) setTimeout(async () => {
    if (token !== _subToken) return;
    try { await callback(); } catch (e) { console.error(e); }
  }, 80);
};

window.closeSubPage = () => {
  const overlay = document.getElementById('sub-page-overlay');
  if (!overlay || !overlay.classList.contains('active')) return;
  _subToken++;
  markBusy();
  document.body.classList.remove('subpage-open');
  overlay.classList.remove('active');
  document.body.style.overflow = '';
  if (window.history.state?.page === 'subpage') {
    window.history.back();
  }
  currentUtilityType = null;
};

window.handleBack = () => {
  markBusy();
  const secondary = document.getElementById('sub-page-secondary');
  if (secondary?.classList.contains('active')) {
    secondary.classList.remove('active');
    document.getElementById('sub-page-title').innerText = "Utility Tool";
    isSecondaryActive  = false;
    currentUtilityType = null;
  } else {
    window.closeSubPage();
  }
};

function renderUtilityOptions(type) {
  const secondary     = document.getElementById('sub-page-secondary');
  const secondaryBody = document.getElementById('secondary-body');
  if (!secondary || !secondaryBody) return;

  const config = utilityConfigs[type];
  if (!config) { toast('Utility not available'); return; }

  currentUtilityType = type;
  markBusy();
  const current = localStorage.getItem(config.key) || "Default";

  secondaryBody.innerHTML =
    `<p class="body-medium" style="line-height:1.5;margin-bottom:16px;color:var(--md-text-muted);">${config.desc || ""}</p>
     <div class="card opt-header">
       <div class="clean-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="${config.icon || ""}"/></svg></div>
       <div class="item-text"><span class="stat-label">Current</span><span class="clean-value">${current}</span></div>
     </div>
     <div class="category-label" style="margin-top:16px;">OPTIONS</div>
     <div style="display:flex;flex-direction:column;gap:8px;">` +
    config.opts.map(opt => {
      const active = current === opt;
      const info = (config.info && config.info[opt]) || "";
      return `<div class="card list-item opt-card ${active ? 'active' : ''}" onclick="window.selectUtilityOption('${config.key}','${opt}')">
        <div class="item-text"><span class="label-large">${opt}</span>${info ? `<span class="body-medium">${info}</span>` : ""}</div>
        <span class="opt-radio"></span>
      </div>`;
    }).join('') + `</div>`;

  secondary.classList.add('active');
  isSecondaryActive = true;
}

window.openSettingsPage = (type, fromUtility = false) => {
  if (type === "Utility Tool") {
    window.openSubTemplate("Utility Tool", "utility-template", () => {
      const ids = {
        'silent-log-toggle':  'disable_logging',
        'sensor-toggle':      'dis_sensor',
        'network-toggle':     'network_adjuster',
        'dev-conf-toggle':    'dev_conf',
      };
      for (const [id, key] of Object.entries(ids)) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.checked  = localStorage.getItem(key) === "on";
        el.onchange = e => window.toggleAction(key, e.target.checked);
      }
      const gmsToggle = document.getElementById("gms-toggle");
      if (gmsToggle) {
        gmsToggle.checked  = localStorage.getItem("gms_doze") === "on";
        gmsToggle.onchange = e => {
          const checked = e.target.checked;
          e.target.checked = false;
          if (checked) {
            window.showGmsWarning(() => {
              gmsToggle.checked = true;
              window.toggleAction("gms_doze", true);
            });
          } else {
            window.toggleAction("gms_doze", false);
          }
        };
      }
      initGapStatus();
    });

  } else if (type === "Logging") {
    window.openSubTemplate("Logging Info", "logging-template", () => {
      const logs = JSON.parse(localStorage.getItem("app_logs") || "[]");
      renderLogs(logs, document.getElementById("log-display"));
      const clearBtn = document.getElementById("clear-logs-btn");
      if (clearBtn) clearBtn.onclick = () => window.clearAllLogs();
    });

  } else if (type === "Service Manager") {
    window.openSubTemplate("Service Manager", "server-template", async () => {
      await initServerStatus();
      const btn = document.getElementById('server-restart-btn');
      if (btn) btn.onclick = window.reloadServer;
    });

  } else if (utilityConfigs[type] && fromUtility) {
    document.getElementById('sub-page-title').innerText = type;
    renderUtilityOptions(type);
  }
};

window.selectUtilityOption = async (key, value) => {
  await window.applySetting(key, value);
  renderUtilityOptions(currentUtilityType);
  if (key === "bg_limit") {
    const el = document.getElementById("bg-limit-current");
    if (el) el.innerText = bgLimitLabel(value);
  }
};

window.applySetting = async (key, value, close = false) => {
  localStorage.setItem(key, value);
  const cmdVal  = value === "Default" ? "off" : value;
  const safeVal = cmdVal.replace(/'/g, "'\\''");
  await safeExec(`printf '%s' '${safeVal}' > /data/local/tmp/kazuyoo_${key}`, "");
  await safeExecScript(key, cmdVal);
  if (close) window.closeSubPage();
};

window.toggleAction = async (action, isCheckedOrString) => {
  const value = (isCheckedOrString === "on" || isCheckedOrString === "off")
    ? isCheckedOrString : (isCheckedOrString ? "on" : "off");
  localStorage.setItem(action, value);
  await safeExecScript(action, value);
};

window.showGmsWarning = (onConfirm) => {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card">
      <h3 class="title-medium">Enable GMS Doze?</h3>
      <p class="body-medium" style="margin:10px 0 20px;">
        Notifications from Google-based apps may be delayed until the app is opened manually.
      </p>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="gms-warn-cancel" class="m3-btn tonal">Cancel</button>
        <button id="gms-warn-confirm" class="m3-btn filled">Enable</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#gms-warn-cancel').onclick  = () => overlay.remove();
  overlay.querySelector('#gms-warn-confirm').onclick = () => { overlay.remove(); onConfirm(); };
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
};

const checkGapInstalled = async () =>
  (await safeExec("command -v GAP 2>/dev/null", "")).trim() !== "";

const initGapStatus = async () => {
  const text = document.getElementById('gap-status-text');
  if (!text) return;
  const installed    = await checkGapInstalled();
  text.innerText     = installed ? "Module installed" : "Tap to download module";
  text.style.color   = installed ? 'var(--md-text-main)' : '';
};

window.showDownloadDialog = async () => {
  if (await checkGapInstalled()) { window.showGapStatus(); return; }
  const dialog = document.getElementById('download-dialog');
  if (dialog) { dialog.style.display = 'flex'; }
};

window.showGapStatus = async () => {
  const pidRaw = await safeExec("cat /data/local/tmp/gap_server.pid 2>/dev/null", "");
  const pid    = pidRaw.trim();
  let isRunning = false, foundPid = "";

  if (isPid(pid)) {
    const ok = await safeExec(`kill -0 ${pid} 2>/dev/null && echo 1 || echo 0`, "0");
    if (ok === "1") { isRunning = true; foundPid = pid; }
  }

  if (!isRunning) {
    const pg = await safeExec("pgrep -x GAP 2>/dev/null", "");
    if (pg.trim()) { isRunning = true; foundPid = pg.trim().split("\n")[0]; }
  }

  const gameCount = isRunning
    ? await safeExec(`grep -vc '^#' ${TEMP_FILE} 2>/dev/null || true`, "0")
    : "0";

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card">
      <h3 class="title-medium">Game Preload Status</h3>
      <div style="display:flex;flex-direction:column;gap:8px;margin:12px 0 20px;">
        <div style="display:flex;justify-content:space-between;" class="body-medium">
          <span>Status</span>
          <span style="color:${isRunning ? 'var(--md-success)' : 'var(--md-error)'};font-weight:600;">
            ${isRunning ? 'Running' : 'Not Running'}
          </span>
        </div>
        <div style="display:flex;justify-content:space-between;" class="body-medium">
          <span>PID</span>
          <span>${foundPid || '-'}</span>
        </div>
        <div style="display:flex;justify-content:space-between;" class="body-medium">
          <span>Games in list</span>
          <span>${gameCount.trim() || '0'}</span>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;">
        <button id="gap-status-close" class="m3-btn filled">OK</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#gap-status-close').onclick = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
};

window.closeDownloadDialog = () => {
  const dialog = document.getElementById('download-dialog');
  if (dialog) { dialog.style.display = 'none'; }
};

window.goToDownload = async () => {
  window.closeDownloadDialog();
  await safeExec("am start -a android.intent.action.VIEW -d 'https://t.me/KzyoCh'", "");
};

const getServiceStatusInfo = async () => {
  const pidRaw = await safeExec("cat /data/local/tmp/svc_server.pid 2>/dev/null", "");
  const pid    = pidRaw.trim();
  if (isPid(pid)) {
    const comm = await safeExec(`cat /proc/${pid}/comm 2>/dev/null`, "");
    if (comm.trim() === "cgo_engine") return { running: true, pid };
  }

  const pg = await safeExec("pgrep -x cgo_engine 2>/dev/null", "");
  if (pg.trim()) {
    return { running: true, pid: pg.trim().split("\n")[0] };
  }
  return { running: false, pid: "" };
};

const SERVER_COLORS = { ok: 'var(--md-success)', bad: 'var(--md-error)', busy: 'var(--md-warning)', idle: 'var(--md-outline)' };
const setServerState = (state, text) => {
  const card  = document.getElementById('server-status-card');
  const dot   = document.getElementById('server-svc-dot');
  const label = document.getElementById('server-svc-label');
  const color = SERVER_COLORS[state] || SERVER_COLORS.idle;
  if (card)  card.style.borderLeftColor = color;
  if (dot)   dot.style.background = color;
  if (label) label.innerText = text;
};

const initServerStatus = async () => {
  if (!document.getElementById('server-svc-dot')) return;
  setServerState('idle', "Checking...");
  const serviceInfo = await getServiceStatusInfo();
  setServerState(serviceInfo.running ? 'ok' : 'bad', serviceInfo.running ? 'Running' : 'Not running');
};

window.reloadServer = async () => {
  const btn   = document.getElementById('server-restart-btn');
  const dot   = document.getElementById('server-svc-dot');
  const label = document.getElementById('server-svc-label');

  if (btn) {
    btn.disabled = true; btn.style.opacity = '0.5';
    btn.innerText = "Restarting...";
  }
  setServerState('busy', "Restarting...");
  toast("Restarting service...");

  await safeExec(`
    pid=$(cat /data/local/tmp/svc_server.pid 2>/dev/null)
    [ -n "$pid" ] && kill -9 "$pid" 2>/dev/null
    pkill -9 -x cgo_engine 2>/dev/null
    rm -f /data/local/tmp/svc_server.pid
  `, "");
  await new Promise(r => setTimeout(r, 800));
  await safeExec(`cgo_engine --execute </dev/null >/dev/null 2>&1 &`, "");
  window.addLog("SERVER: cgo_engine restarted", "on");
  await new Promise(r => setTimeout(r, 1500));

  const serviceInfo = await getServiceStatusInfo();
  setServerState(serviceInfo.running ? 'ok' : 'bad', serviceInfo.running ? 'Running' : 'Failed to start');
  if (btn) {
    btn.disabled = false; btn.style.opacity = '1';
    btn.innerText = "Restart";
  }
  toast(serviceInfo.running ? "Service restarted successfully!" : "Failed to start service");
};

const getBatteryStats = async () => {
  const sys = await safeExec("cat /sys/class/power_supply/battery/temp 2>/dev/null", "");
  if (/^-?\d+$/.test(sys)) return { temp: (parseInt(sys, 10) / 10).toFixed(1) };
  const raw = await safeExec("dumpsys battery", "");
  if (!raw) return { temp: 0 };
  const tempRaw = +raw.match(/temperature:\s+(\d+)/)?.[1] || 0;
  return { temp: (tempRaw / 10).toFixed(1) };
};

const getPingLatency = async () => {
  const raw = await safeExec("ping -c 1 -w 2 1.1.1.1 2>/dev/null", "");
  if (!raw) return "--";
  const match = raw.match(/time=([\d.]+)\s*ms/);
  return match ? Math.round(parseFloat(match[1])) : "--";
};

const getDeviceInfo = async () => {
  const out   = await safeExec("getprop ro.build.version.release; getprop ro.build.version.sdk; getprop ro.product.cpu.abilist; uname -r; getenforce", "");
  const lines = out.split("\n");
  const $ = id => document.getElementById(id);
  if ($('android-info'))$('android-info').innerText = `${lines[0]||'N/A'} (API ${lines[1]||'N/A'})`;
  if ($('abis-info'))$('abis-info').innerText    = lines[2] || 'N/A';
  if ($('kernel-info'))$('kernel-info').innerText  = lines[3] || 'N/A';
  if ($('selinux-info'))$('selinux-info').innerText = lines[4] || 'N/A';
};

const updateSystemStats = async () => {
  const doPing = (_tickCount++ % 5 === 0);
  const [serviceInfo, battery, pingResult] = await Promise.all([
    getServiceStatusInfo(),
    getBatteryStats(),
    doPing ? getPingLatency() : Promise.resolve(cachedPingResult === "-- ms" ? "--" : cachedPingResult)
  ]);

  cachedPingResult = pingResult;

  const statusCard = document.getElementById("status-card");
  if (statusCard) {
    const cls = serviceInfo.running ? "card hero-status-card success-card" : "card hero-status-card error-card";
    if (statusCard.className !== cls) statusCard.className = cls;
    setText(Elements.batteryLevelTitle, serviceInfo.running ? "Service running" : "Service not running");
    setText(Elements.batteryStatusDesc, serviceInfo.running ? `Process ID: ${serviceInfo.pid}` : "Process ID was not detected.");
  }

  setText(Elements.batteryTemp, `${battery.temp} °C`);
  setText(Elements.pingLatency, `${cachedPingResult} ms`);

  if (Elements.statsPingTile) {
    const pingVal = parseInt(cachedPingResult);
    const isGood  = cachedPingResult !== "--" && !isNaN(pingVal) && pingVal < 120;
    if (Elements.statsPingTile.dataset.state !== (isGood ? "good" : "bad")) {
      Elements.statsPingTile.dataset.state = isGood ? "good" : "bad";
      Elements.statsPingTile.classList.remove('daemon-on', 'daemon-off');
      Elements.statsPingTile.classList.add(isGood ? 'daemon-on' : 'daemon-off');
      const color  = isGood ? 'var(--md-success)' : 'var(--md-error)';
      if (Elements.pingLatency) Elements.pingLatency.style.color = color;
      const iconEl = Elements.statsPingTile.querySelector('svg, i, .icon');
      if (iconEl) { iconEl.style.color = color; iconEl.style.fill = color; }
    }
  }
};

const ensureGameListFile = async () => {
  const exists = await safeExec(`[ -s ${TEMP_FILE} ] && echo 1 || echo 0`, "0");
  if (exists === "0") {
    const hasBackup = await safeExec(`[ -f ${GAMELIST_BACKUP} ] && echo 1 || echo 0`, "0");
    await safeExec(hasBackup === "1" ? `cp ${GAMELIST_BACKUP} ${TEMP_FILE}` : `touch ${TEMP_FILE}`, "");
  }
};

const writeGameList = async (pkgMap) => {
  const lines  = Array.from(pkgMap.values());
  const tmpFile = `${TEMP_FILE}.tmp`;
  const content = lines.join("\\n");
  await safeExec(`printf '${content.replace(/'/g,"'\\''")}\n' > ${tmpFile} && mv ${tmpFile} ${TEMP_FILE}`, "");
  await safeExec(`cp ${TEMP_FILE} ${GAMELIST_BACKUP} 2>/dev/null`, "");
};

const readGameList = async () => {
  const raw = await safeExec(`cat ${TEMP_FILE}`, "");
  if (!raw) return new Map();
  const map = new Map();
  for (const line of raw.split('\n').map(l => l.replace(/\r/,'').trim()).filter(Boolean)) {
    const name = line.replace(/^#+/,'');
    if (!isPkg(name)) continue;
    map.set(name, line);
  }
  return map;
};

window.toggleGameOpt = async (pkg, isEnabled) => {
  if (_gameListLocked) return;
  _gameListLocked = true;
  try {
    const map = await readGameList();
    map.set(pkg, isEnabled ? pkg : "#" + pkg);
    await writeGameList(map);
    await window.updateGameListUI();
  } catch(err) { console.error(err); toast("Failed to update game list"); await window.updateGameListUI(); }
  finally { _gameListLocked = false; }
};

window.addGameToList = async () => {
  const input = document.getElementById('add-game-input');
  const pkg   = input?.value.trim();
  if (!pkg || !isPkg(pkg)) { toast("Enter valid package name (e.g. com.example.game)"); return; }
  if (_gameListLocked) return;
  _gameListLocked = true;
  try {
    const map = await readGameList();
    if (map.has(pkg)) { toast("Already in list"); return; }
    map.set(pkg, pkg);
    await writeGameList(map);
    if (input) input.value = "";
    await window.updateGameListUI();
  } catch(err) { console.error(err); toast("Failed to add game"); }
  finally { _gameListLocked = false; }
};

window.removeGameFromList = async (pkg) => {
  if (_gameListLocked) return;
  _gameListLocked = true;
  try {
    const map = await readGameList();
    map.delete(pkg);
    await writeGameList(map);
    await window.updateGameListUI();
    toast("Removed: " + pkg);
  } catch(err) { console.error(err); toast("Failed to remove game"); }
  finally { _gameListLocked = false; }
};

window.compileGame = (pkg) => {
  const mode = localStorage.getItem(`compile_mode_${pkg}`) || "unknown";
  if (mode === "unknown" || !/^[a-z0-9-]+$/i.test(mode) || !isPkg(pkg)) { toast("Select compile mode first"); return; }
  toast(`Compiling ${pkg}...`);
  exec(`setsid sh -c '
    sdk=$(getprop ro.build.version.sdk)
    if [ "$sdk" -ge 34 ]; then
      pm compile -m ${mode} -p PRIORITY_INTERACTIVE_FAST --full -f "${pkg}" 2>/dev/null
    else
      pm compile -m ${mode} "${pkg}" 2>/dev/null
    fi
  ' >/dev/null 2>&1 &`).catch(() => {});
};

window.setCompileMode = (pkg, mode) => {
  localStorage.setItem(`compile_mode_${pkg}`, mode);
  window.updateGameListUI();
};

window.toggleDnd = async (pkg, isEnabled) => {
  localStorage.setItem(`dnd_${pkg}`, isEnabled ? "on" : "off");
  
  const mode = isEnabled ? "ignore" : "allow";
  await safeExec(`cmd appops set "${pkg}" POST_NOTIFICATION ${mode}`, "");
};

window.updateGameListUI = async () => {
  const container = document.getElementById('game-list-container');
  if (!container) return;
  try {
    const map   = await readGameList();
    const lines = Array.from(map.values());

    let html = `<div style="display:flex;gap:8px;padding:12px 16px 8px;align-items:center;">
      <input id="add-game-input" type="text" placeholder="com.package.name"
        style="flex:1;padding:10px 14px;border-radius:14px;border:none;background:var(--md-surface-variant);color:var(--md-text-main);font-size:13px;outline:none;">
      <button onclick="window.addGameToList()" class="m3-btn filled">Add</button>
    </div>`;

    if (lines.length === 0) {
      html += '<p class="body-medium" style="padding:16px;text-align:center;">Looking for games...</p>';
      container.innerHTML = html;
      return;
    }

    lines.forEach((line, idx) => {
      const isEnabled = !line.startsWith("#");
      const pkgName   = line.replace(/^#+/,'').trim();
      const savedMode = localStorage.getItem(`compile_mode_${pkgName}`) || "unknown";
      const border    = idx < lines.length-1 ? 'border-bottom:1px solid var(--md-outline-variant);' : '';

      html += `<div style="padding:14px 18px;${border}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div style="flex:1;min-width:0;padding-right:12px;">
            <h3 class="label-large" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${pkgName}</h3>
            <p class="body-medium">Mode: ${savedMode}</p>
          </div>
          <!-- Kontainer aksi diletakkan align-items: center agar pas di tengah secara vertikal -->
          <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
            <button id="compile-btn-${pkgName.replace(/\./g, '_')}" onclick="window.compileGame('${pkgName}')" class="m3-btn filled" style="padding:6px 12px;font-size:11px;">Compile</button>
            <label class="switch" style="display:flex;align-items:center;">
              <input type="checkbox" ${isEnabled?'checked':''} onchange="window.toggleGameOpt('${pkgName}',this.checked)">
              <span class="slider"></span>
            </label>
            <button onclick="window.removeGameFromList('${pkgName}')" class="icon-button" style="width:32px;height:32px;color:var(--md-error);display:flex;align-items:center;justify-content:center;">✕</button>
          </div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          ${['speed-profile','speed'].map(m => `
            <button onclick="window.setCompileMode('${pkgName}','${m}')"
              style="padding:4px 10px;border-radius:10px;font-size:11px;font-weight:600;cursor:pointer;border:none;
                     background:${savedMode===m?'var(--md-primary-container)':'var(--md-surface-3)'};
                     color:${savedMode===m?'var(--md-on-primary-container)':'var(--md-text-muted)'};">${m}</button>`).join('')}
        </div>
      </div>`;
    });
    container.innerHTML = html;
  } catch(err) {
    console.error(err);
    container.innerHTML = '<p class="body-medium" style="padding:16px;text-align:center;color:var(--md-error);">Looking for games...</p>';
  }
};

window.addLog = (message, status = null) => {
  if (typeof message !== "string" || message.includes("[{") || message.startsWith("APP_LOGS")) return;
  const entry = { timestamp: new Date().toLocaleTimeString("en-GB",{hour12:false}), message, status };
  let logs = [];
  try { logs = JSON.parse(localStorage.getItem("app_logs")) || []; } catch { logs = []; }
  logs.unshift(entry);
  if (logs.length > 50) logs.length = 50;
  localStorage.setItem("app_logs", JSON.stringify(logs));
  const container = document.getElementById("log-display");
  if (container) renderLogs(logs, container);
};

const escapeHtml = s => String(s).replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));

function renderLogs(logs, container) {
  const list  = Array.isArray(logs) ? logs.filter(l => typeof l.message === "string") : [];
  const count = document.getElementById("log-count");
  const clear = document.getElementById("clear-logs-btn");
  if (clear) clear.disabled = !list.length;
  if (!list.length) {
    if (count) count.textContent = "0 entries";
    container.innerHTML = `<div class="log-empty">
      <div class="log-empty-icon"><svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-3 12H8c-.55 0-1-.45-1-1s.45-1 1-1h8c.55 0 1 .45 1 1s-.45 1-1 1zm0-4H8c-.55 0-1-.45-1-1s.45-1 1-1h8c.55 0 1 .45 1 1s-.45 1-1 1z"/></svg></div>
      <div class="log-empty-title">No logs yet</div>
      <div class="log-empty-sub">Actions you run in the app will show up here.</div>
    </div>`;
    return;
  }
  if (count) count.textContent = `${list.length} ${list.length === 1 ? "entry" : "entries"} · latest 50 kept`;
  container.innerHTML = list.map(l => {
    const s = String(l.status || "").toLowerCase();
    const cls = s === "on" ? "on" : s === "off" ? "off" : "";
    return `<div class="log-row ${cls}"><span class="log-dot"></span><div class="log-body"><span class="log-time">${escapeHtml(l.timestamp)}</span><span class="log-msg">${escapeHtml(l.message)}</span></div></div>`;
  }).join("");
}

window.clearAllLogs = () => {
  localStorage.removeItem('app_logs');
  const d = document.getElementById('log-display');
  if (d) renderLogs([], d);
  toast("Logs cleared successfully");
};

window.runCleanRam = async () => {
  toast("Cleaning Background Apps...");
  await safeExecScript("clean_ram","trigger");
  toast("RAM Cleaned!");
};

window.runCleanCache = async () => {
  toast("Cleaning Cache...");
  await safeExecScript("clean_cache","trigger");
  toast("Cache cleaned successfully");
};

const setupControls = () => {
  document.querySelectorAll("select").forEach(sel => {
    const saved = localStorage.getItem(sel.id);
    if (saved) sel.value = saved;
    sel.onchange = async () => {
      localStorage.setItem(sel.id, sel.value);
      const cmd = sel.getAttribute("data-setting");
      if (cmd) await safeExecScript(cmd, sel.value);
    };
  });
};

const initTweaksListeners = () => {
  document.querySelectorAll('.clickable').forEach(card => {
    card.addEventListener('click', async () => {
      const title = (card.dataset.action
        || card.querySelector('.label-large')?.innerText?.trim()
        || "").trim();
      if (!title) return;

      if (title === "Cleaning") {
        window.openSubTemplate("Cleaning", "cleaning-template", async () => {
          const toggle = document.getElementById("ram-compact-toggle");
          if (toggle) {
            toggle.checked = localStorage.getItem("ram_compact") === "on";
            toggle.onchange = e => window.toggleAction("ram_compact", e.target.checked);
          }

          const jobSw = document.getElementById("job-scheduler-toggle");
          if (jobSw) {
            jobSw.checked = localStorage.getItem("job_scheduler_limit") === "on";
            jobSw.onchange = async e => {
              const on = e.target.checked;
              localStorage.setItem("job_scheduler_limit", on ? "on" : "off");
              await applyJobSchedulerLimit(on);
            };
          }

          const dkaSw = document.getElementById("dont-keep-activities-toggle");
          if (dkaSw) {
            dkaSw.checked = localStorage.getItem("dont_keep_activities") === "on";
            dkaSw.onchange = e => window.toggleAction("dont_keep_activities", e.target.checked);
          }

          const bgLimitEl = document.getElementById("bg-limit-current");
          if (bgLimitEl) bgLimitEl.innerText = bgLimitLabel(localStorage.getItem("bg_limit") || "Default");

          document.getElementById("btnCleanRam").onclick   = window.runCleanRam;
          document.getElementById("btnCleanCache").onclick = window.runCleanCache;

          const spSw = document.getElementById("storage-pressure-toggle");
          if (spSw) {
            spSw.checked  = localStorage.getItem("storage_pressure") === "on";
            spSw.onchange = async e => {
              const on = e.target.checked;
              localStorage.setItem("storage_pressure", on ? "on" : "off");
              await applyStoragePressure(on);
            };
          }

          await new Promise(r => setTimeout(r, 600));
          if (!document.getElementById("cleanRamBar")) return;
          const rawMem = await safeExec("cat /proc/meminfo", "");
          const t = +rawMem.match(/MemTotal:\s+(\d+)/)?.[1]     || 0;
          const a = +rawMem.match(/MemAvailable:\s+(\d+)/)?.[1] || 0;
          const u = t - a;
          const ramPercentage = t ? Math.round((u/t)*100) : 0;

          document.getElementById("cleanRamUsed").innerText  = `${Math.round((u/1048576)*1024)} MB`;
          const ramTotalEl = document.getElementById("cleanRamTotal");
          if (ramTotalEl) ramTotalEl.innerText = `of ${Math.round(t/1024)} MB total`;
          const ramPctEl = document.getElementById("cleanRamPct");
          if (ramPctEl) ramPctEl.innerText = `${ramPercentage}%`;
          const ramBar = document.getElementById("cleanRamBar");
          ramBar.style.width = `${ramPercentage}%`;
          ramBar.classList.toggle("high", ramPercentage >= 85);

          const stRaw = await safeExec("df -k /data | tail -1", "");
          if (stRaw) {
            const p = stRaw.trim().split(/\s+/);
            const totalGb = (parseFloat(p[1])/1048576).toFixed(1);
            const usedGb  = (parseFloat(p[2])/1048576).toFixed(1);
            document.getElementById("cleanStorageUsed").innerText = `${usedGb} GB`;
            const bar = document.getElementById("cleanStorageBar");
            if (bar && totalGb > 0) {
              const stPct = Math.min(100, Math.round((parseFloat(usedGb)/parseFloat(totalGb))*100));
              bar.style.width = `${stPct}%`;
              bar.classList.toggle("high", stPct >= 85);
              const stPctEl = document.getElementById("cleanStoragePct");
              if (stPctEl) stPctEl.innerText = `${stPct}%`;
              const stTotalEl = document.getElementById("cleanStorageTotal");
              if (stTotalEl) stTotalEl.innerText = `of ${totalGb} GB total`;
            }
          }

        });

      } else if (title === "Downscaling") {
        window.openSubTemplate("Downscaling", "downscale-template", () => {
          const slider   = document.getElementById("render-slider");
          const scaleVal = document.getElementById("scale-val");
          const chips = document.querySelectorAll(".chip-row .chip");
          const paint = () => {
            const v = parseFloat(slider.value);
            slider.style.setProperty("--pct", ((v - slider.min) / (slider.max - slider.min) * 100) + "%");
            scaleVal.innerText = v.toFixed(2) + "x";
            chips.forEach(c => c.classList.toggle("active", Math.abs(parseFloat(c.dataset.scale) - v) < 0.001));
          };
          slider.value   = localStorage.getItem("render_scale") || "1.00";
          paint();
          slider.oninput = paint;
          chips.forEach(c => c.onclick = () => { slider.value = c.dataset.scale; paint(); });
          document.getElementById("apply-downscale").onclick = async () => {
            const scaleStr = parseFloat(slider.value).toFixed(2);
            localStorage.setItem("render_scale", scaleStr);
            await safeExecScript("downscale", scaleStr);
            toast("Applied: " + slider.value + "x");
          };
          document.getElementById("reset-downscale").onclick = async () => {
            slider.value = "1.00"; paint();
            localStorage.setItem("render_scale","1.00");
            await safeExecScript("downscale","disable");
            toast("Downscale reset");
          };
        });

      } else if (title === "DNS Private") {
        window.openSubTemplate("DNS Private", "dns-template", () => {
          const select = document.getElementById("dns-select");
          select.value = localStorage.getItem("dns_private") || "Default";
          select.onchange = e => window.applySetting("dns_private", e.target.value);
        });

      } else if (title === "Utility Tool") {
        window.openSettingsPage('Utility Tool');
      } else if (title === "Service Manager") {
        window.openSettingsPage('Service Manager');
      } else if (utilityConfigs[title]) {
        window.openSettingsPage(title, true);
      }
    });
  });
};

const setDefaultStates = () => {
  ["saver","ram_compact","disable_logging","network_adjuster","gms_doze","dis_sensor","global_dnd"]
    .forEach(k => localStorage.setItem(k, "off"));
  localStorage.setItem("first_install_run","true");
};

const restoreSession = async () => {
  await new Promise(r => setTimeout(r, 600));

  const reset = await safeExecScript("check_reset_flag","trigger",true);
  if (reset.trim() === "1") {
    localStorage.clear(); setDefaultStates();
    setTimeout(() => location.reload(), 500); return;
  }

  const moduleVer = await safeExec(
    "grep '^version=' /data/adb/modules/CelestialGameOpt/module.prop 2>/dev/null | cut -d= -f2", "");
  if (moduleVer && moduleVer !== localStorage.getItem("_module_ver")) {
    localStorage.clear();
    localStorage.setItem("_module_ver", moduleVer);
    setDefaultStates();
    setTimeout(() => location.reload(), 500); return;
  }

  const uptime     = parseInt(await safeExec("awk '{print int($1)}' /proc/uptime","0")) || 0;
  const lastUptime = parseInt(localStorage.getItem("last_sync_uptime") || "0");
  const isReboot   = uptime < lastUptime;

  document.querySelectorAll("select").forEach(sel => {
    const saved = localStorage.getItem(sel.id);
    if (saved) sel.value = saved;
  });

  if (isReboot) {
    const restoreCmds = [];
    const dndRestores = [];

    for (const [key, value] of Object.entries(localStorage)) {
      if (SKIP_RESTORE_KEYS.has(key) || key.startsWith("compile_mode_")) continue;

      if (key === "global_dnd") {
        if (value === "on" || value === "off") {
          await safeExec(value === "on" ? "settings put global zen_mode 1" : "settings put global zen_mode 0", "");
          await safeExecScript("dnd_mode", value);
        }
        continue;
      }

      if (key.startsWith("dnd_")) {
        if (value === "on") dndRestores.push(key.slice(4));
        continue;
      }
      if (key === "job_scheduler_limit") {
        if (value === "on" || value === "off") await applyJobSchedulerLimit(value === "on");
        continue;
      }
      if (key === "storage_pressure") {
        if (value === "on" || value === "off") await applyStoragePressure(value === "on");
        continue;
      }
      if (key === "render_scale") {
        if (value && parseFloat(value) !== 1.0) restoreCmds.push(["downscale", value]);
        continue;
      }
      if (SPECIAL_VALUE_KEYS.has(key)) {
        if (value && value !== "off" && value !== "Default") restoreCmds.push([key, value]);
        continue;
      }
      if (value === "on" || value === "off") restoreCmds.push([key, value]);
    }

    for (const [key, value] of restoreCmds) {
      await safeExecScript(key, value);
    }
    for (const pkg of dndRestores) {
      await safeExec(`cmd notification allow_dnd "${pkg}" 2>/dev/null`, "");
    }
  }

  if (!localStorage.getItem("first_install_run")) setDefaultStates();
  localStorage.setItem("last_sync_uptime", uptime.toString());
};

let _monitorBound = false;
const startMonitor = () => {
  if (_monitorTimer) clearTimeout(_monitorTimer);
  const schedule = (ms) => { _monitorTimer = setTimeout(tick, ms); };
  const tick = () => {
    _monitorTimer = null;
    if (document.hidden) return;
    const wait = (window.__busyUntil || 0) - Date.now();
    if (wait > 0) { schedule(wait + 60); return; }
    updateSystemStats().catch(console.error).finally(() => { if (!_monitorTimer) schedule(4000); });
  };
  schedule(4000);
  if (_monitorBound) return;
  _monitorBound = true;
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !_monitorTimer) schedule(0);
  });
};

document.addEventListener("DOMContentLoaded", () => {
  try {
    const raw = localStorage.getItem("app_logs");
    if (raw) {
      const logs = JSON.parse(raw);
      if (Array.isArray(logs)) {
        localStorage.setItem("app_logs", JSON.stringify(
          logs.map(l => typeof l === "string" ? { timestamp:"?", message:l, status:null } : l)
        ));
      }
    }
  } catch { localStorage.removeItem("app_logs"); }

  Elements = {
    batteryLevelTitle: document.getElementById("battery-level-title"),
    batteryStatusDesc:  document.getElementById("battery-status-desc"),
    batteryTemp:        document.getElementById("batteryTemp"),
    pingLatency:        document.getElementById("pingLatency"),
    statsPingTile:      document.getElementById("stats-ping-tile")
  };

  initTweaksListeners();
  setupControls();

  requestAnimationFrame(() => {
    Promise.all([updateSystemStats(), getDeviceInfo()]).catch(console.error);
  });

  ensureGameListFile().then(() => window.updateGameListUI()).catch(console.error);
  restoreSession().catch(console.error);
  startMonitor();

  const saverBtn = document.getElementById('saver-toggle');
  if (saverBtn) {
    if (!localStorage.getItem('saver')) localStorage.setItem('saver','off');
    saverBtn.classList.toggle('active', localStorage.getItem('saver') === 'on');
    saverBtn.addEventListener('click', async () => {
      const next = !saverBtn.classList.contains('active');
      saverBtn.classList.toggle('active', next);
      await window.toggleAction('saver', next ? 'on' : 'off');
    });
  }

  // Setup Global DND Mode Toggle Card
  const globalDndToggle = document.getElementById('global-dnd-toggle');
  if (globalDndToggle) {
    if (!localStorage.getItem('global_dnd')) localStorage.setItem('global_dnd', 'off');
    globalDndToggle.checked = localStorage.getItem('global_dnd') === 'on';
    globalDndToggle.addEventListener('change', async (e) => {
      const on = e.target.checked;
      localStorage.setItem('global_dnd', on ? 'on' : 'off');
      await safeExec(on ? "settings put global zen_mode 1" : "settings put global zen_mode 0", "");
      await safeExecScript("dnd_mode", on ? "on" : "off");
    });
  }
});

window.addEventListener('popstate', () => {
  const secondary = document.getElementById('sub-page-secondary');
  if (secondary?.classList.contains('active')) {
    secondary.classList.remove('active');
    document.getElementById('sub-page-title').innerText = "Utility Tool";
    isSecondaryActive  = false;
    currentUtilityType = null;
    window.history.pushState({ page: 'subpage' }, '');
    return;
  }
  const overlay = document.getElementById('sub-page-overlay');
  if (overlay?.classList.contains('active')) {
    _subToken++;
    markBusy();
    document.body.classList.remove('subpage-open');
    overlay.classList.remove('active');
    document.body.style.overflow = '';
    currentUtilityType = null;
  }
});

window.openUrl = async url => safeExec(`am start -a android.intent.action.VIEW -d '${String(url).replace(/'/g, "")}'`, "");
