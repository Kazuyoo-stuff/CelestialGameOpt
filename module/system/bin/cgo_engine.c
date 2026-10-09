/*
 * Celestial-Game-Opt by Kazuyoo
 * Copyright (C) 2026 Kazuyoo
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <fcntl.h>
#include <dirent.h>
#include <signal.h>
#include <time.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <sys/resource.h>
#include <sys/syscall.h>
#include <sched.h>

/* ── Paths ─────────────────────────────────────────────────────────── */
#define GAMELIST_FILE   "/data/local/tmp/gamelist.txt"
#define FPS_CACHE       "/data/local/tmp/kazuyoo_fps_cache"
#define SVC_PID_FILE    "/data/local/tmp/svc_server.pid"
#define SVC_LOG         "/data/local/tmp/svc_server.log"
#define DS_VAL_FILE     "/data/local/tmp/kazuyoo_render_scale"

#define POLL_INTERVAL        5
#define SCREEN_OFF_INTERVAL  10
#define SCREEN_ON_DELAY      10

/* ── Capacities ─────────────────────────────────────────────────────── */
#define MAX_PIDS      64
#define MAX_TIDS      256
#define MAX_GAMES     256
#define MAX_PKG_LEN   256
#define MAX_LINE      512
#define MAX_CMD       1024

/* ── Helpers ─────────────────────────────────────────────────────────── */

/* Jalan command via /system/bin/sh -c, return exit code */
static int shell(const char *cmd)
{
    pid_t pid = fork();
    if (pid < 0) return -1;
    if (pid == 0) {
        execl("/system/bin/sh", "sh", "-c", cmd, (char *)NULL);
        _exit(127);
    }
    int status = 0;
    waitpid(pid, &status, 0);
    return WIFEXITED(status) ? WEXITSTATUS(status) : -1;
}

/* Jalan command, tangkap stdout ke buf (max len), strip trailing newline */
static int shell_out(const char *cmd, char *buf, size_t len)
{
    int pfd[2];
    if (pipe(pfd) < 0) return -1;

    pid_t pid = fork();
    if (pid < 0) { close(pfd[0]); close(pfd[1]); return -1; }
    if (pid == 0) {
        close(pfd[0]);
        dup2(pfd[1], STDOUT_FILENO);
        close(pfd[1]);
        int fd = open("/dev/null", O_WRONLY);
        if (fd >= 0) { dup2(fd, STDERR_FILENO); close(fd); }
        execl("/system/bin/sh", "sh", "-c", cmd, (char *)NULL);
        _exit(127);
    }
    close(pfd[1]);

    size_t total = 0;
    ssize_t n;
    while (total + 1 < len && (n = read(pfd[0], buf + total, len - total - 1)) > 0)
        total += (size_t)n;
    buf[total] = '\0';
    close(pfd[0]);

    int status = 0;
    waitpid(pid, &status, 0);

    /* strip trailing newline */
    while (total > 0 && (buf[total-1] == '\n' || buf[total-1] == '\r'))
        buf[--total] = '\0';

    return WIFEXITED(status) ? WEXITSTATUS(status) : -1;
}

/* Tulis string ke file */
static void write_file(const char *path, const char *val)
{
    int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (fd < 0) return;
    write(fd, val, strlen(val));
    write(fd, "\n", 1);
    close(fd);
}

/* Baca baris pertama dari file ke buf */
static int read_first_line(const char *path, char *buf, size_t len)
{
    FILE *f = fopen(path, "r");
    if (!f) return -1;
    if (!fgets(buf, (int)len, f)) { fclose(f); buf[0] = '\0'; return -1; }
    fclose(f);
    /* strip newline */
    size_t l = strlen(buf);
    while (l > 0 && (buf[l-1] == '\n' || buf[l-1] == '\r')) buf[--l] = '\0';
    return 0;
}

/* getprop wrapper */
static void getprop(const char *key, char *buf, size_t len)
{
    char cmd[256];
    snprintf(cmd, sizeof(cmd), "getprop %s 2>/dev/null", key);
    if (shell_out(cmd, buf, len) != 0) buf[0] = '\0';
}

/* ── Self-setup ──────────────────────────────────────────────────────── */

static void setup_self(void)
{
    /* taskset -p ff $$ */
    cpu_set_t set;
    CPU_ZERO(&set);
    long ncpu = sysconf(_SC_NPROCESSORS_CONF);
    if (ncpu <= 0) ncpu = 8;
    for (long i = 0; i < ncpu; i++) CPU_SET((size_t)i, &set);
    sched_setaffinity(0, sizeof(set), &set);

    /* renice -n 19 */
    setpriority(PRIO_PROCESS, 0, 19);

    /* ionice -c 3 (idle) via ioprio_set syscall */
    /* ioprio = (class << 13) | data; class 3 = IOPRIO_CLASS_IDLE */
    syscall(SYS_ioprio_set, 1 /*IOPRIO_WHO_PROCESS*/, 0, (3 << 13));
}

/* ── FPS ──────────────────────────────────────────────────────────────── */

static int get_fps(void)
{
    struct stat st;
    int cached = 0;
    if (stat(FPS_CACHE, &st) == 0 && (time(NULL) - st.st_mtime) < 3600) {
        char buf[32];
        if (read_first_line(FPS_CACHE, buf, sizeof(buf)) == 0 && buf[0]) {
            int v = atoi(buf);
            if (v > 0) return v;
        }
        cached = 1;
    }
    if (!cached) {
        char buf[64];
        if (shell_out(
            "dumpsys display 2>/dev/null | grep -Eo 'fps=[^.]+' | cut -f2 -d= | sort -n | uniq | tail -n1",
            buf, sizeof(buf)) == 0 && buf[0]) {
            int v = atoi(buf);
            if (v > 0) {
                write_file(FPS_CACHE, buf);
                return v;
            }
        }
    }
    return 60;
}

/* ── CPU mask ─────────────────────────────────────────────────────────── */

static unsigned long get_full_cpu_mask(void)
{
    long n = sysconf(_SC_NPROCESSORS_CONF);
    if (n <= 0 || n > 64) n = 8;
    return (n >= 64) ? ~0UL : ((1UL << n) - 1);
}

/* ── Game list ───────────────────────────────────────────────────────── */

typedef struct {
    char pkgs[MAX_GAMES][MAX_PKG_LEN];
    int  count;
    time_t mtime;
} GameList;

static void refresh_game_list(GameList *gl)
{
    struct stat st;
    if (stat(GAMELIST_FILE, &st) != 0) return;
    if (st.st_mtime == gl->mtime) return;

    gl->mtime = st.st_mtime;
    gl->count = 0;

    FILE *f = fopen(GAMELIST_FILE, "r");
    if (!f) return;
    char line[MAX_PKG_LEN];
    while (fgets(line, sizeof(line), f) && gl->count < MAX_GAMES) {
        /* strip newline */
        size_t l = strlen(line);
        while (l > 0 && (line[l-1] == '\n' || line[l-1] == '\r' || line[l-1] == ' '))
            line[--l] = '\0';
        if (line[0] == '#' || line[0] == '\0') continue;
        strncpy(gl->pkgs[gl->count++], line, MAX_PKG_LEN - 1);
    }
    fclose(f);
}

static int game_list_contains(const GameList *gl, const char *pkg)
{
    for (int i = 0; i < gl->count; i++)
        if (strcmp(gl->pkgs[i], pkg) == 0) return 1;
    return 0;
}

/* ── PID / TID discovery ────────────────────────────────────────────── */

typedef struct {
    pid_t pids[MAX_PIDS];
    int   count;
} PidList;

typedef struct {
    pid_t pid;
    pid_t tid;
} TidEntry;

typedef struct {
    TidEntry entries[MAX_TIDS];
    int      count;
} TidList;

static void get_pids_for_pkg(const char *pkg, PidList *out)
{
    out->count = 0;
    char cmd[MAX_CMD];

    /* pgrep -x pkg */
    snprintf(cmd, sizeof(cmd), "pgrep -x '%s' 2>/dev/null", pkg);
    char buf[4096] = "";
    shell_out(cmd, buf, sizeof(buf));

    /* pgrep -f ^pkg: */
    char buf2[4096] = "";
    snprintf(cmd, sizeof(cmd), "pgrep -f '^%s:' 2>/dev/null", pkg);
    shell_out(cmd, buf2, sizeof(buf2));

    /* merge */
    char merged[8192];
    snprintf(merged, sizeof(merged), "%s\n%s", buf, buf2);

    /* parse */
    char *p = merged;
    while (*p) {
        while (*p == '\n' || *p == ' ' || *p == '\r') p++;
        if (!*p) break;
        char *end = p;
        while (*end && *end != '\n' && *end != ' ' && *end != '\r') end++;
        char num[32] = "";
        size_t sz = (size_t)(end - p);
        if (sz < sizeof(num)) {
            memcpy(num, p, sz);
            num[sz] = '\0';
            pid_t pid = (pid_t)atoi(num);
            if (pid > 0 && out->count < MAX_PIDS) {
                /* dedup */
                int dup = 0;
                for (int i = 0; i < out->count; i++)
                    if (out->pids[i] == pid) { dup = 1; break; }
                if (!dup) out->pids[out->count++] = pid;
            }
        }
        p = end;
    }

    /* fallback: scan /proc */
    if (out->count == 0) {
        DIR *d = opendir("/proc");
        if (!d) return;
        struct dirent *de;
        while ((de = readdir(d)) != NULL && out->count < MAX_PIDS) {
            if (de->d_name[0] < '1' || de->d_name[0] > '9') continue;
            char path[64];
            snprintf(path, sizeof(path), "/proc/%s/cmdline", de->d_name);
            char cl[MAX_PKG_LEN * 2] = "";
            int fd = open(path, O_RDONLY);
            if (fd < 0) continue;
            ssize_t n = read(fd, cl, sizeof(cl) - 1);
            close(fd);
            if (n <= 0) continue;
            cl[n] = '\0';
            /* null bytes → spaces */
            for (ssize_t i = 0; i < n; i++)
                if (cl[i] == '\0') cl[i] = ' ';
            /* base = first token */
            char *sp = strchr(cl, ' ');
            size_t blen = sp ? (size_t)(sp - cl) : strlen(cl);
            /* match: pkg or pkg: */
            size_t plen = strlen(pkg);
            if (blen == plen && strncmp(cl, pkg, plen) == 0) {
                pid_t pid = (pid_t)atoi(de->d_name);
                int dup = 0;
                for (int i = 0; i < out->count; i++)
                    if (out->pids[i] == pid) { dup = 1; break; }
                if (!dup) out->pids[out->count++] = pid;
            } else if (blen > plen && strncmp(cl, pkg, plen) == 0 && cl[plen] == ':') {
                pid_t pid = (pid_t)atoi(de->d_name);
                int dup = 0;
                for (int i = 0; i < out->count; i++)
                    if (out->pids[i] == pid) { dup = 1; break; }
                if (!dup) out->pids[out->count++] = pid;
            }
        }
        closedir(d);
    }
}

static void get_tids_matching(pid_t pid, const char *match, TidList *out)
{
    char cmd[MAX_CMD];
    snprintf(cmd, sizeof(cmd),
        "ps -AT -p %d 2>/dev/null | grep '%s' | awk '{print $3}'",
        pid, match);
    char buf[4096] = "";
    shell_out(cmd, buf, sizeof(buf));

    char *p = buf;
    while (*p) {
        while (*p == '\n' || *p == ' ' || *p == '\r') p++;
        if (!*p) break;
        char *end = p;
        while (*end && *end != '\n' && *end != ' ' && *end != '\r') end++;
        char num[32] = "";
        size_t sz = (size_t)(end - p);
        if (sz < sizeof(num) && out->count < MAX_TIDS) {
            memcpy(num, p, sz);
            num[sz] = '\0';
            pid_t tid = (pid_t)atoi(num);
            if (tid > 0) {
                out->entries[out->count].pid = pid;
                out->entries[out->count].tid = tid;
                out->count++;
            }
        }
        p = end;
    }
}

static void get_tids_matching_multi(const PidList *pids, const char *match, TidList *out)
{
    out->count = 0;
    for (int i = 0; i < pids->count; i++)
        get_tids_matching(pids->pids[i], match, out);
}

/* ── Screen / fg pkg ─────────────────────────────────────────────────── */

static int is_screen_on(void)
{
    char buf[16];
    getprop("debug.tracing.screen_state", buf, sizeof(buf));
    return strcmp(buf, "2") == 0;
}

/* Extract "pkg/Activity" token → pkg only */
static void extract_pkg_token(const char *line, char *pkg, size_t len)
{
    pkg[0] = '\0';
    /* find pattern: word/word */
    const char *p = line;
    while (*p) {
        /* check if valid pkg char */
        if ((*p >= 'A' && *p <= 'Z') || (*p >= 'a' && *p <= 'z') ||
            (*p >= '0' && *p <= '9') || *p == '_' || *p == '.') {
            const char *start = p;
            while (*p && ((*p >= 'A' && *p <= 'Z') || (*p >= 'a' && *p <= 'z') ||
                          (*p >= '0' && *p <= '9') || *p == '_' || *p == '.')) p++;
            if (*p == '/') {
                size_t l = (size_t)(p - start);
                if (l >= 3 && l < len) {
                    memcpy(pkg, start, l);
                    pkg[l] = '\0';
                    return;
                }
            }
            continue;
        }
        p++;
    }
}

static void get_fg_pkg(char *pkg, size_t len)
{
    pkg[0] = '\0';
    char buf[4096] = "";

    shell_out("dumpsys window 2>/dev/null | grep -m1 'mCurrentFocus='", buf, sizeof(buf));
    extract_pkg_token(buf, pkg, len);

    if (!pkg[0]) {
        shell_out("dumpsys activity activities 2>/dev/null | grep -m1 -E 'mResumedActivity|topResumedActivity'",
                  buf, sizeof(buf));
        extract_pkg_token(buf, pkg, len);
    }

    static const char *skip[] = {
        "android", "com.android.systemui",
        "com.transsion.XOSLauncher", "com.android.launcher3",
        "frb.axeron.manager", NULL
    };
    for (int i = 0; skip[i]; i++) {
        if (strcmp(pkg, skip[i]) == 0) { pkg[0] = '\0'; return; }
    }
}

/* ── Notify ──────────────────────────────────────────────────────────── */

static void notify(const char *msg)
{
    char cmd[MAX_CMD];
    snprintf(cmd, sizeof(cmd),
        "su -lp 2000 -c \"cmd notification post -S bigtext -t 'Celestial-Game-Opt' tag '%s'\" >/dev/null 2>&1 || "
        "cmd activity start -a AxManager.TOAST -e text '%s' >/dev/null 2>&1",
        msg, msg);
    shell(cmd);
}

/* ── Priority helpers ────────────────────────────────────────────────── */

static void apply_task_profile(const PidList *pids)
{
    char cmdbuf[MAX_CMD * 4];
    /* build a mini shell loop inline */
    int off = snprintf(cmdbuf, sizeof(cmdbuf),
        "for pid in");
    for (int i = 0; i < pids->count; i++)
        off += snprintf(cmdbuf + off, sizeof(cmdbuf) - (size_t)off, " %d", pids->pids[i]);
    snprintf(cmdbuf + off, sizeof(cmdbuf) - (size_t)off,
        "; do for t in /proc/$pid/task/*; do tid=${t##*/};"
        " settaskprofile \"$tid\" CPUSET_SP_TOP_APP_HIGH_PERF PerfBoost 2>/dev/null;"
        " settaskprofile \"$tid\" SCHED_SP_TOP_APP 2>/dev/null; done; done");

    char wrap[MAX_CMD * 5];
    snprintf(wrap, sizeof(wrap),
        "nice -n 19 ionice -c3 setsid sh -c '%s' >/dev/null 2>&1 &", cmdbuf);
    shell(wrap);
}

static void apply_priority(const PidList *pids, const TidList *rt, const TidList *bt,
                           unsigned long cpu_mask)
{
    char mask_str[32];
    snprintf(mask_str, sizeof(mask_str), "%lx", cpu_mask);

    for (int i = 0; i < pids->count; i++) {
        cpu_set_t set;
        CPU_ZERO(&set);
        for (int b = 0; b < 64; b++)
            if (cpu_mask & (1UL << b)) CPU_SET((size_t)b, &set);
        sched_setaffinity(pids->pids[i], sizeof(set), &set);
        setpriority(PRIO_PROCESS, (id_t)pids->pids[i], -10);
        /* ionice -c 2 -n 0: best-effort prio 0 */
        syscall(SYS_ioprio_set, 1, pids->pids[i], (2 << 13) | 0);
    }

    for (int i = 0; i < rt->count; i++) {
        pid_t tid = rt->entries[i].tid;
        cpu_set_t set;
        CPU_ZERO(&set);
        for (int b = 0; b < 64; b++)
            if (cpu_mask & (1UL << b)) CPU_SET((size_t)b, &set);
        sched_setaffinity(tid, sizeof(set), &set);
        setpriority(PRIO_PROCESS, (id_t)tid, -10);
        struct sched_param sp = { .sched_priority = 1 };
        sched_setscheduler(tid, SCHED_FIFO, &sp);
    }

    for (int i = 0; i < bt->count; i++)
        setpriority(PRIO_PROCESS, (id_t)bt->entries[i].tid, -5);
}

static void revert_priority(const PidList *pids, const TidList *rt, const TidList *bt)
{
    for (int i = 0; i < pids->count; i++) {
        setpriority(PRIO_PROCESS, (id_t)pids->pids[i], 0);
        syscall(SYS_ioprio_set, 1, pids->pids[i], (2 << 13) | 4);
    }

    for (int i = 0; i < rt->count; i++) {
        pid_t tid = rt->entries[i].tid;
        struct sched_param sp = { .sched_priority = 0 };
        sched_setscheduler(tid, SCHED_OTHER, &sp);
        setpriority(PRIO_PROCESS, (id_t)tid, 0);
    }

    for (int i = 0; i < bt->count; i++)
        setpriority(PRIO_PROCESS, (id_t)bt->entries[i].tid, 0);
}

/* ── Settings helpers ────────────────────────────────────────────────── */

static void apply_settings_on(const char *pkg)
{
    char cmd[MAX_CMD * 2];
    snprintf(cmd, sizeof(cmd),
        "nice -n 19 ionice -c3 setsid sh -c '"
        "pkg_full=\"%s\";"
        "sys=$(settings list system); sec=$(settings list secure); glb=$(settings list global);"
        "echo \"$sec\"|grep -q game_auto_temperature_control && settings put secure game_auto_temperature_control 0;"
        "echo \"$sys\"|grep -q bench_mark_mode && settings put system bench_mark_mode 1;"
        "echo \"$glb\"|grep -q fpsgo_support_status && settings put global fpsgo_support_status 1;"
        "echo \"$sys\"|grep -q settings_game_performance_mode && settings put system settings_game_performance_mode 1;"
        "echo \"$sys\"|grep -q tran_cpupower_mode && settings put system tran_cpupower_mode 1;"
        "echo \"$sys\"|grep -q perf_rt_enable && settings put system perf_rt_enable true;"
        "echo \"$sys\"|grep -q POWER_PERFORMANCE_MODE_OPEN && settings put system power_mode high;"
        "echo \"$sys\"|grep -q POWER_PERFORMANCE_MODE_OPEN && settings put system POWER_PERFORMANCE_MODE_OPEN 1;"
        "echo \"$sec\"|grep -q speed_mode_enable && settings put secure speed_mode_enable 1;"
        "echo \"$sys\"|grep -q perf_proc_game_List && settings put system perf_proc_game_List \"$pkg_full\";"
        "' >/dev/null 2>&1 &",
        pkg);
    shell(cmd);
}

static void apply_settings_off(void)
{
    shell(
        "nice -n 19 ionice -c3 setsid sh -c '"
        "sys=$(settings list system); sec=$(settings list secure); glb=$(settings list global);"
        "echo \"$sec\"|grep -q game_auto_temperature_control && settings put secure game_auto_temperature_control 1;"
        "echo \"$sys\"|grep -q bench_mark_mode && settings put system bench_mark_mode 0;"
        "echo \"$glb\"|grep -q fpsgo_support_status && settings put global fpsgo_support_status 0;"
        "echo \"$sys\"|grep -q settings_game_performance_mode && settings put system settings_game_performance_mode 0;"
        "echo \"$sys\"|grep -q tran_cpupower_mode && settings put system tran_cpupower_mode 0;"
        "echo \"$sys\"|grep -q perf_rt_enable && settings put system perf_rt_enable false;"
        "echo \"$sys\"|grep -q POWER_PERFORMANCE_MODE_OPEN && settings put system power_mode middle;"
        "echo \"$sys\"|grep -q POWER_PERFORMANCE_MODE_OPEN && settings put system POWER_PERFORMANCE_MODE_OPEN 0;"
        "echo \"$sec\"|grep -q speed_mode_enable && settings put secure speed_mode_enable 0;"
        "' >/dev/null 2>&1 &"
    );
}

/* ── Enter / exit game mode ─────────────────────────────────────────── */

static void enter_game_mode(const char *pkg, const PidList *pids,
                             const TidList *rt, const TidList *bt,
                             unsigned long cpu_mask)
{
    char cmd[MAX_CMD];

    apply_task_profile(pids);
    apply_priority(pids, rt, bt, cpu_mask);

    shell("pm disable-user --user 0 com.oplus.battery >/dev/null 2>&1 &");
    shell("cmd power set-fixed-performance-mode-enabled true &");
    shell("cmd power set-adaptive-power-saver-enabled false &");
    shell("cmd power set-mode 0 &");
    shell("cmd thermalservice override-status 0 &");
    shell("setprop debug.egl.hw 1");

    snprintf(cmd, sizeof(cmd), "cmd deviceidle whitelist +'%s' &", pkg);
    shell(cmd);
    snprintf(cmd, sizeof(cmd), "dumpsys sensorservice set-uid-state '%s' active &", pkg);
    shell(cmd);

    snprintf(cmd, sizeof(cmd),
        "(uid=$(dumpsys package '%s' | grep -m1 'userId=' | sed 's/.*userId=\\([0-9]*\\).*/\\1/');"
        " [ -n \"$uid\" ] && cmd netpolicy add app-idle-whitelist \"$uid\") &", pkg);
    shell(cmd);

    snprintf(cmd, sizeof(cmd), "cmd activity set-bg-restriction-level '%s' exempted &", pkg);
    shell(cmd);

    snprintf(cmd, sizeof(cmd), "cmd tare set-vip 0 '%s' true &", pkg);
    shell(cmd);
    snprintf(cmd, sizeof(cmd), "cmd ufw settings set-boost-proc '%s' 1 true &", pkg);
    shell(cmd);
    snprintf(cmd, sizeof(cmd), "cmd ufw settings set-io-feature 2 '%s' true &", pkg);
    shell(cmd);

    for (int i = 0; i < pids->count; i++) {
        snprintf(cmd, sizeof(cmd),
            "cmd ufw settings set-boost-tid %d %d ui true &", pids->pids[i], pids->pids[i]);
        shell(cmd);
    }

    snprintf(cmd, sizeof(cmd), "cmd ufw settings set-static-grp '%s' '%s' 10 &", pkg, pkg);
    shell(cmd);

    for (int i = 0; i < rt->count; i++) {
        snprintf(cmd, sizeof(cmd),
            "cmd ufw settings set-boost-tid %d %d animator true &",
            rt->entries[i].pid, rt->entries[i].tid);
        shell(cmd);
    }

    for (int i = 0; i < bt->count; i++) {
        snprintf(cmd, sizeof(cmd),
            "cmd ufw settings bt-inherit-rt %d 1 &", bt->entries[i].tid);
        shell(cmd);
        snprintf(cmd, sizeof(cmd),
            "cmd ufw settings bt-skp-prio-restore %d 1 &", bt->entries[i].tid);
        shell(cmd);
    }

    snprintf(cmd, sizeof(cmd), "cmd ufw settings pin-app 1 '%s' 209715200 true &", pkg);
    shell(cmd);
    shell("cmd ufw settings set-mem-reclaim-args 524288 1048576 &");

    /* wait for background jobs (best-effort; shell forks are detached) */
    sleep(1);

    apply_settings_on(pkg);

    char notif[MAX_PKG_LEN + 32];
    snprintf(notif, sizeof(notif), "Status : %s | Optimized!", pkg);
    notify(notif);
}

static void exit_game_mode(const char *pkg, const PidList *pids,
                            const TidList *rt, const TidList *bt)
{
    char cmd[MAX_CMD];

    shell("cmd power set-fixed-performance-mode-enabled false &");
    shell("cmd power set-adaptive-power-saver-enabled true &");
    shell("cmd thermalservice reset &");
    shell("pm enable com.oplus.battery >/dev/null 2>&1 &");
    shell("setprop debug.egl.hw 0");

    snprintf(cmd, sizeof(cmd), "cmd deviceidle whitelist -'%s' &", pkg);
    shell(cmd);
    snprintf(cmd, sizeof(cmd), "dumpsys sensorservice set-uid-state '%s' idle &", pkg);
    shell(cmd);

    snprintf(cmd, sizeof(cmd),
        "(uid=$(dumpsys package '%s' | grep -m1 'userId=' | sed 's/.*userId=\\([0-9]*\\).*/\\1/');"
        " [ -n \"$uid\" ] && cmd netpolicy remove app-idle-whitelist \"$uid\") &", pkg);
    shell(cmd);

    snprintf(cmd, sizeof(cmd), "cmd activity set-bg-restriction-level '%s' adaptive_bucket &", pkg);
    shell(cmd);

    snprintf(cmd, sizeof(cmd), "cmd tare set-vip 0 '%s' false &", pkg);
    shell(cmd);
    snprintf(cmd, sizeof(cmd), "cmd ufw settings set-boost-proc '%s' 1 false &", pkg);
    shell(cmd);
    snprintf(cmd, sizeof(cmd), "cmd ufw settings set-io-feature 2 '%s' false &", pkg);
    shell(cmd);

    for (int i = 0; i < pids->count; i++) {
        snprintf(cmd, sizeof(cmd),
            "cmd ufw settings set-boost-tid %d %d ui false &", pids->pids[i], pids->pids[i]);
        shell(cmd);
    }

    for (int i = 0; i < rt->count; i++) {
        snprintf(cmd, sizeof(cmd),
            "cmd ufw settings set-boost-tid %d %d animator false &",
            rt->entries[i].pid, rt->entries[i].tid);
        shell(cmd);
    }

    for (int i = 0; i < bt->count; i++) {
        snprintf(cmd, sizeof(cmd),
            "cmd ufw settings bt-inherit-rt %d 0 &", bt->entries[i].tid);
        shell(cmd);
        snprintf(cmd, sizeof(cmd),
            "cmd ufw settings bt-skp-prio-restore %d 0 &", bt->entries[i].tid);
        shell(cmd);
    }

    snprintf(cmd, sizeof(cmd), "cmd ufw settings pin-app 1 '%s' 0 false &", pkg);
    shell(cmd);
    snprintf(cmd, sizeof(cmd), "cmd ufw settings set-static-grp '%s' '%s' -1 &", pkg, pkg);
    shell(cmd);
    shell("cmd ufw settings set-mem-reclaim-args 0 0 &");

    sleep(1);

    revert_priority(pids, rt, bt);
    apply_settings_off();
    notify("Status : Game Closed!");
}

/* ── game_profiles_server ───────────────────────────────────────────── */

static void game_profiles_server(void)
{
    GameList gl;
    memset(&gl, 0, sizeof(gl));

    PidList cur_pids;
    TidList cur_rt, cur_bt;
    memset(&cur_pids, 0, sizeof(cur_pids));
    memset(&cur_rt, 0, sizeof(cur_rt));
    memset(&cur_bt, 0, sizeof(cur_bt));

    char current_game_pkg[MAX_PKG_LEN] = "";
    int  mode_game        = 0;
    int  screen_was_off   = 0;

    unsigned long cpu_mask = get_full_cpu_mask();

    while (1) {
        if (!is_screen_on()) {
            if (!screen_was_off) {
                shell("cmd deviceidle force-inactive >/dev/null 2>&1");
                shell("cmd deviceidle force-modemanager-quickdoze true >/dev/null 2>&1");
                shell("cmd deviceidle step deep >/dev/null 2>&1");
                screen_was_off = 1;
            }
            sleep(SCREEN_OFF_INTERVAL);
            continue;
        }

        if (screen_was_off) {
            screen_was_off = 0;
            sleep(SCREEN_ON_DELAY);
            shell("cmd deviceidle unforce >/dev/null 2>&1");
        }

        char pkg[MAX_PKG_LEN];
        get_fg_pkg(pkg, sizeof(pkg));
        if (!pkg[0]) { sleep(POLL_INTERVAL); continue; }

        if (mode_game && strcmp(pkg, current_game_pkg) == 0) {
            sleep(POLL_INTERVAL);
            continue;
        }

        refresh_game_list(&gl);

        if (game_list_contains(&gl, pkg)) {
            if (!mode_game) {
                mode_game = 1;
                strncpy(current_game_pkg, pkg, MAX_PKG_LEN - 1);
                get_pids_for_pkg(pkg, &cur_pids);
                get_tids_matching_multi(&cur_pids, "RenderThread", &cur_rt);
                get_tids_matching_multi(&cur_pids, "Binder:", &cur_bt);
                enter_game_mode(pkg, &cur_pids, &cur_rt, &cur_bt, cpu_mask);
            }
        } else {
            if (mode_game) {
                exit_game_mode(current_game_pkg, &cur_pids, &cur_rt, &cur_bt);
                mode_game = 0;
                current_game_pkg[0] = '\0';
                memset(&cur_pids, 0, sizeof(cur_pids));
                memset(&cur_rt,   0, sizeof(cur_rt));
                memset(&cur_bt,   0, sizeof(cur_bt));
            }
        }

        sleep(POLL_INTERVAL);
    }
}

/* ── --stop ──────────────────────────────────────────────────────────── */

static void do_stop(void)
{
    pid_t self = getpid();
    int killed = 0;

    DIR *d = opendir("/proc");
    if (!d) { fprintf(stderr, "[-] Cannot open /proc\n"); return; }

    struct dirent *de;
    while ((de = readdir(d)) != NULL) {
        if (de->d_name[0] < '1' || de->d_name[0] > '9') continue;
        pid_t tpid = (pid_t)atoi(de->d_name);
        if (tpid == self) continue;

        char path[64];
        snprintf(path, sizeof(path), "/proc/%d/cmdline", tpid);
        char cl[512] = "";
        int fd = open(path, O_RDONLY);
        if (fd < 0) continue;
        ssize_t n = read(fd, cl, sizeof(cl) - 1);
        close(fd);
        if (n <= 0) continue;
        cl[n] = '\0';
        /* null → space */
        for (ssize_t i = 0; i < n; i++) if (cl[i] == '\0') cl[i] = ' ';

        /* base name of first token */
        char first[256] = "";
        char *sp = strchr(cl, ' ');
        size_t fl = sp ? (size_t)(sp - cl) : strlen(cl);
        if (fl < sizeof(first)) { memcpy(first, cl, fl); first[fl] = '\0'; }
        char *slash = strrchr(first, '/');
        const char *base = slash ? slash + 1 : first;

        if (strcmp(base, "cgo_engine") == 0) {
            if (kill(tpid, SIGKILL) == 0) killed = 1;
        }
    }
    closedir(d);

    if (killed) {
        unlink(SVC_PID_FILE);
        printf("[-] Service stopped.\n");
    } else {
        printf("[-] Service not running.\n");
    }
}

/* ── --execute ───────────────────────────────────────────────────────── */

static void do_execute(void)
{
    /* cek PID file */
    {
        char buf[32];
        if (read_first_line(SVC_PID_FILE, buf, sizeof(buf)) == 0 && buf[0]) {
            pid_t old = (pid_t)atoi(buf);
            if (old > 0 && kill(old, 0) == 0) {
                printf("[+] Service already running (PID: %d)\n", old);
                return;
            }
        }
        unlink(SVC_PID_FILE);
    }

    /* DS_VAL */
    char ds_val[64] = "disable";
    {
        char tmp[64];
        if (read_first_line(DS_VAL_FILE, tmp, sizeof(tmp)) == 0 && tmp[0]) {
            if (strcmp(tmp, "1.00") != 0 && strcmp(tmp, "1") != 0)
                strncpy(ds_val, tmp, sizeof(ds_val) - 1);
        }
    }

    /* API level */
    char api_str[16];
    getprop("ro.build.version.sdk", api_str, sizeof(api_str));
    int api = api_str[0] ? atoi(api_str) : 0;

    /* FPS */
    int fps = get_fps();

    /* apply game overlay per pkg */
    FILE *gf = fopen(GAMELIST_FILE, "r");
    if (gf) {
        char line[MAX_PKG_LEN];
        while (fgets(line, sizeof(line), gf)) {
            size_t l = strlen(line);
            while (l > 0 && (line[l-1] == '\n' || line[l-1] == '\r' || line[l-1] == ' '))
                line[--l] = '\0';
            if (line[0] == '#' || line[0] == '\0') continue;

            char cmd[MAX_CMD];
            snprintf(cmd, sizeof(cmd), "cmd game reset '%s' >/dev/null 2>&1", line);
            shell(cmd);

            snprintf(cmd, sizeof(cmd),
                "cmd device_config put game_overlay '%s' "
                "'mode=2,downscaleFactor=%s,useAngle=true,fps=%d,loadingBoost=1073741824' "
                ">/dev/null 2>&1",
                line, ds_val, fps);
            shell(cmd);

            if (api >= 34) {
                snprintf(cmd, sizeof(cmd), "cmd game mode performance '%s' >/dev/null 2>&1", line);
                shell(cmd);
            } else if (api == 33) {
                snprintf(cmd, sizeof(cmd),
                    "cmd game set --downscale '%s' --fps %d '%s' >/dev/null 2>&1",
                    ds_val, fps, line);
                shell(cmd);
            }
        }
        fclose(gf);
    }

    /* redirect stdout/stderr ke SVC_LOG sebelum fork daemon */
    int log_fd = open(SVC_LOG, O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (log_fd >= 0) {
        dup2(log_fd, STDOUT_FILENO);
        dup2(log_fd, STDERR_FILENO);
        close(log_fd);
    }

    printf("[+] Starting game_profiles_server...\n");
    fflush(stdout);

    pid_t pid = fork();
    if (pid < 0) { perror("fork"); return; }
    if (pid == 0) {
        /* daemon child */
        setsid();
        game_profiles_server();
        _exit(0);
    }

    /* parent: tulis PID */
    char pidbuf[32];
    snprintf(pidbuf, sizeof(pidbuf), "%d", pid);
    write_file(SVC_PID_FILE, pidbuf);
    printf("[+] Service enabled (PID: %d) | Log: %s\n", pid, SVC_LOG);
    fflush(stdout);
}

/* ── main ────────────────────────────────────────────────────────────── */

int main(int argc, char *argv[])
{
    setup_self();

    if (argc < 2) return 1;

    if (strcmp(argv[1], "--execute") == 0) {
        do_execute();
    } else if (strcmp(argv[1], "--stop") == 0) {
        do_stop();
    }

    return 0;
}
