#!/system/bin/sh
# Celestial-Game-Opt by Kazuyoo
# Copyright (c) 2026 Kazuyoo
# Licensed under the GNU General Public License v3.0 or later.
# See LICENSE file for details.
# Open-source powered — with appreciation to GL-DP and all contributors.

TMPDIR_FOR_VERIFY="$TMPDIR/.vunzip"
mkdir -p "$TMPDIR_FOR_VERIFY"

# Variable
DATE=$(date)
VERSION="3.5"
NAME="Celestial-Game-Opt | Kzyo"
API=$(getprop ro.build.version.sdk)
DEVICES=$(getprop ro.product.board)
MANUFACTURER=$(getprop ro.product.manufacturer)
ANDROIDVERSION=$(getprop ro.build.version.release)
OFFICIAL_REPO="https://github.com/Kazuyoo-stuff/CelestialGameOpt"

# Set logcat buffer size @Dcx400
a=$(awk '/MemTotal/ {printf"%.0f\n",$2/1024/1024}' /proc/meminfo)
logcat -G "$a"m

if [ "$AXERON" = "true" ]; then
  PRINT="printf"
else
  PRINT="ui_print"
fi

print_msg() {
  case "$PRINT" in
    ui_print) ui_print "$1" ;;
    printf)   printf "$1" ;;
  esac
}

print_line() {
  print_msg "***************************************"
}

abort_verify() {
  print_msg "! $1"
  sleep 0.1
  print_msg "! Installation aborted. The module may be corrupted."
  sleep 0.1
  print_msg "! Please re-download and try again."
  sleep 0.1
  rm -rf "$MODPATH"
  abort ""
}

# extract <zip> <file> <target dir>
extract() {
  local zip="$1"
  local file="$2"
  local dir="$3"
  local file_path="$dir/$file"
  local hash_path="$TMPDIR_FOR_VERIFY/$file.sha256"

  unzip -o "$zip" "$file" -d "$dir" >&2
  [ -f "$file_path" ] || abort_verify "$file does not exist"

  unzip -o "$zip" "$file.sha256" -d "$TMPDIR_FOR_VERIFY" >&2
  [ -f "$hash_path" ] || abort_verify "Missing checksum for $file"

  (echo "$(cat "$hash_path")  $file_path" | sha256sum -c -s -) || abort_verify "Checksum mismatch for $file"
}

check_official_repo() {
  RELEASE="Unofficial"
  case "${OFFICIAL_REPO:-}" in
    *"github.com/Kazuyoo-stuff/CelestialGameOpt"*) RELEASE="Official" ;;
  esac
}
check_official_repo

trim_partition() {
  setsid sh -c '
    for partition in data cache metadata storage; do
      if command -v su >/dev/null; then
        fstrim -v "/$partition"
      else
        sm fstrim "/$partition"
      fi
    done
  ' >/dev/null 2>&1 &
}

# Verify update-binary integrity first
file="META-INF/com/google/android/update-binary"
file_path="$TMPDIR_FOR_VERIFY/$file"
hash_path="$file_path.sha256"
unzip -o "$ZIPFILE" "META-INF/com/google/android/*" -d "$TMPDIR_FOR_VERIFY" >&2
[ -f "$file_path" ] || abort_verify "$file does not exist"
if [ -f "$hash_path" ]; then
  (echo "$(cat "$hash_path")  $file_path" | sha256sum -c -s -) || abort_verify "Checksum mismatch for $file"
fi

# STARTER
[ -z "$ABI" ] && ABI=$(getprop ro.product.cpu.abi);if [[ "$ABI" == *64* ]];then arch=64;rm -f "$MODPATH/system/bin/cgo_engine32";else arch=32;rm -f "$MODPATH/system/bin/cgo_engine64";fi;[ -f "$MODPATH/system/bin/cgo_engine$arch" ] && mv -f "$MODPATH/system/bin/cgo_engine$arch" "$MODPATH/system/bin/cgo_engine"

# Display banner
print_msg "░█▀▀█ ── ░█▀▀█ ░█▀▄▀█ ── ░█▀▀▀█ ░█▀▀█ ▀▀█▀▀ 
░█─── ▀▀ ░█─▄▄ ░█░█░█ ▀▀ ░█──░█ ░█▄▄█ ─░█── 
░█▄▄█ ── ░█▄▄█ ░█──░█ ── ░█▄▄▄█ ░█─── ─░█──"
ui_print ""
sleep 0.5
print_msg " Tweaks & improvements for better gaming performance."
sleep 0.2
ui_print ""
print_line
sleep 0.2
print_msg "- Name            : ${NAME}"
sleep 0.2
print_msg "- Version         : ${VERSION} | ${RELEASE:-Unknown}"
sleep 0.2
print_msg "- Android Version : ${ANDROIDVERSION:-Unknown}"
sleep 0.2
print_msg "- Current Date    : ${DATE}"
sleep 0.2
print_line
sleep 0.2
print_msg "- Devices         : ${DEVICES:-Unknown}"
sleep 0.2
print_msg "- Manufacturer    : ${MANUFACTURER:-Unknown}"
sleep 0.2
print_line
sleep 0.2

# Extract & verify module files
print_msg "- Extracting and verifying module files"
extract "$ZIPFILE" 'module.prop' "$MODPATH"
extract "$ZIPFILE" 'system.prop' "$MODPATH"
extract "$ZIPFILE" 'service.sh' "$MODPATH"
extract "$ZIPFILE" 'uninstall.sh' "$MODPATH"
extract "$ZIPFILE" "system/bin/cgo_engine${arch}" "$MODPATH"
extract "$ZIPFILE" "system/bin/kazuyoo" "$MODPATH"
extract "$ZIPFILE" "system/bin/RC" "$MODPATH"
sleep 1

print_msg "- Architecture ${arch}-bit detected."
sleep 0.2

# Set permissions
print_msg "- Setting permissions"
set_perm_recursive "$MODPATH" 0 0 0755 0755 >/dev/null 2>&1
set_perm_recursive "$MODPATH/system/bin" 0 0 0777 0755 >/dev/null 2>&1
sleep 2

# Trim partitions
print_msg "- Trimming up Partitions"
trim_partition
sleep 2

# Cleanup
logcat -c >/dev/null 2>&1
rm -rf "$TMPDIR_FOR_VERIFY"
