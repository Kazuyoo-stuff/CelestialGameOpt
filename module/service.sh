#!/system/bin/sh
# Celestial-Game-Opt by Kazuyoo
# Copyright (c) 2026 Kazuyoo
# Licensed under the GNU General Public License v3.0 or later.
# See LICENSE file for details.
# Open-source powered — with appreciation to GL-DP and all contributors.
MODDIR=${0%/*}
export PATH="$MODDIR/system/bin:$PATH"
CPU_INFO=$(cat /proc/cpuinfo 2>/dev/null)
SOC=""
echo "$CPU_INFO" | grep -q "MT" && SOC="MTK"
echo "$CPU_INFO" | grep -q "Qualcomm" && SOC="QCOM"

build_game_list() {
    local out="/data/local/tmp/gamelist.txt"
    local tmp="/data/local/tmp/gamelist_raw.txt"
    local ref="$MODDIR/gamelist.txt"
    local ignored="whatsapp|chrome|youtube|browser|webview|music|video|gallery|maps|gmail|drive"

    if [ -z "$MODDIR" ] || [ ! -s "$ref" ]; then
        return 1
    fi

    mkdir -p /data/local/tmp
    : > "$tmp"

    cmd package query-activities -a android.intent.action.MAIN -c android.intent.category.LAUNCHER 2>/dev/null \
        | awk -F= '/geNa/{p=$2} /ry=0/{print p}' \
        | grep -Ff "$ref" >> "$tmp"

    if [ ! -s "$tmp" ]; then
        if [ "$(getprop ro.build.version.sdk)" -ge 31 ]; then
            dumpsys game 2>/dev/null | awk 'match($0, /Name:[^ \t]+/){print substr($0, RSTART+5, RLENGTH-5)}' >> "$tmp"
        fi
        pm list packages -3 2>/dev/null | cut -d: -f2 | grep -Ff "$ref" >> "$tmp"
    fi

    if [ ! -s "$tmp" ]; then
        rm -f "$tmp"
        return 1
    fi

    grep -vE "(^$|$ignored)" "$tmp" | sort -u > "$out"
    rm -f "$tmp"
}

tweaks_optimization() {
    settings put global activity_manager_constants "max_cached_processes=8,background_settle_time=30000,gc_min_interval=60000,process_start_async=true,power_check_max_cpu_1=5,power_check_max_cpu_2=3,power_check_max_cpu_3=1,power_check_max_cpu_4=1,max_phantom_processes=16,low_swap_threshold_percent=0.20,proactive_kills_enabled=true,max_previous_time=30000,service_restart_duration=5000,binder_heavy_hitter_watcher_enabled=false"

    echo "0" > "/sys/kernel/tracing/tracing_on" 2>/dev/null
    echo "0" > "/sys/kernel/debug/tracing/tracing_on" 2>/dev/null

    # @HoyoSlave
    for third_package in $(cmd package list packages --user 0 -3|cut -f2 -d:);do
        pid=$(pidof "$third_package")
        [ -n "$pid" ] && cmd activity send-trim-memory "${pid%% *}" COMPLETE
    done
    logcat -P "$(dumpsys cpuinfo|awk '{print $1$2}'|grep /|sort -nr|cut -f2 -d%|cut -f1 -d/|head -n512|sed 's/^/~/g')"
    for a in $(dumpsys thermalservice|grep -Eo 'mName[^,]+'|cut -f2 -d=|sort|uniq);do
      cmd thermalservice inject-temperature "$a" none "$a" 20
    done
    
    sfdo force-client-composition enabled
    cmd display set-match-content-frame-rate-pref 1
    local native_fps
    native_fps=$(dumpsys display 2>/dev/null | grep -Eo 'fps=[^.]+' | cut -f2 -d= | sort -n | uniq | tail -n1)
    case "$native_fps" in ''|*[!0-9]*) native_fps=60 ;; esac
    resetprop -n ro.surface_flinger.game_default_frame_rate_override "$native_fps"
    setprop debug.graphics.game_default_frame_rate.disabled true
    cmd display set-user-disabled-hdr-types 1 2 3 4

    settings put global settings_enable_monitor_phantom_procs false
    settings put secure long_press_timeout 190
    settings put secure multi_press_timeout 200
    settings put global fstrim_mandatory_interval 1
    
    # cached freeze
    device_config put activity_manager_native_boot use_freezer true
    settings put global cached_apps_freezer 1

    local sys
    sys="$(settings list system)"
    echo "$sys" | grep -q game_do_not_disturb && settings put system game_do_not_disturb 1
    echo "$sys" | grep -q game_scene_more_fps && settings put system game_scene_more_fps 1
    echo "$sys" | grep -q gamecube_background_call_state && settings put system gamecube_background_call_state 1
    echo "$sys" | grep -q gamecube_block_notification_on && settings put system gamecube_block_notification_on 1
    echo "$sys" | grep -q gamecube_block_notification_state && settings put system gamecube_block_notification_state 1
    echo "$sys" | grep -q gamecube_competition_mode_state && settings put system gamecube_competition_mode_state 1
    echo "$sys" | grep -q gamecube_competition_system_state && settings put system gamecube_competition_system_state 1
    echo "$sys" | grep -q call_feedback && settings put system call_feedback 0
    echo "$sys" | grep -q call_feedback && settings put system call_log 0
    echo "$sys" | grep -q color_enhancement && settings put system color_enhancement 1
    
    case "$SOC" in
        "MTK")
            setprop debug.mediatek.appgamepq_compress 1
            setprop debug.mediatek.disp_decompress 1
            setprop debug.mediatek.appgamepq 1
            setprop debug.mediatek.game_pq_enable 1
            setprop debug.mediatek.high_frame_rate_sf_set_big_core_fps_threshold 120
            ;;
        "QCOM")
            setprop debug.qc.hardware true
            setprop debug.gralloc.gfx_ubwc_disable 0
            ;;
    esac

    local GAMELIST_FILE="/data/local/tmp/gamelist.txt"
    if [ -f "$GAMELIST_FILE" ]; then
        grep -v '^#' "$GAMELIST_FILE" | while read -r app; do
            [ -n "$app" ] && cmd ufw settings set-preload-enable "$app" true
        done
    fi

    [ -n "$(getprop debug.thermal.throttle.support)" ] && {
        setprop debug.thermal.throttle.support no
        resetprop -n -v debug.thermal.throttle.support no 2>/dev/null
    }

    [ "$(getprop ro.build.version.release)" -ge 13 ] && {
        setprop debug.fwk.enable_adpf_cpu_hint true
        setprop debug.sf.enable_adpf_cpu_hint true
    }
}

# Wait for boot
while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 2; done
until [ -d "/sdcard/Android" ] || [ -d "/storage/emulated/0/Android" ]; do sleep 1; done

# Start daemon first
build_game_list
cgo_engine --execute

# Then run optimizations
tweaks_optimization

# TRANSACTION_setProcessLimit
t_code=$(dexdump /system/framework/framework.jar 2>/dev/null | awk '/TRANSACTION_setProcessLimit/,/value/{if(/value/){print $3; exit}}');echo "$t_code" > /data/local/tmp/kazuyoo_t_code

# Notify & set daemon priority
if command -v su >/dev/null 2>&1; then
    su -lp 2000 -c "cmd notification post -S bigtext -t 'Celestial-Game-Opt' tag 'Status : Optimization Completed!'" >/dev/null 2>&1
else
    cmd notification post -S bigtext -t 'Celestial-Game-Opt' 'tags' 'Status : Optimization Completed!' >/dev/null 2>&1
fi
sleep 1

# lower shell priority @HoyoSlave
for a in $(ps | awk '$1=="shell"{print $2}'); do
    ionice -c 3 -n 7 -p "$a"
    iorenice "$a" 7 idle
    renice -n 19 -p "$a"
done 2>/dev/null

exit 0

