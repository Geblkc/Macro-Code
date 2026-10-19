#!/usr/bin/env bash
# MacroCode — gerçek uygulama smoke testi.
#
# ACL/capability hataları (ör. `sql:allow-execute` eksikliği) yalnızca UYGULAMA
# çalışırken ortaya çıkar — birim testleri yakalayamaz. Bu betik:
#   1) uygulamayı derler,
#   2) oturum veritabanını **yedekler** (veri yok edilmez),
#   3) uygulamayı kısa süre çalıştırır,
#   4) veritabanına yazıldığını doğrular (oturum + meta satırı),
#   5) yedeği geri yükler.
#
# Kullanım:  bash scripts/smoke-test.sh
# CI:       GitHub Actions "smoke" işi (workflow_dispatch) → xvfb-run ile.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

APP_ID="com.macrocode.app"
DATA_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/$APP_ID"
DB="$DATA_DIR/sessions.db"
BACKUP_DIR="$(mktemp -d)"
RUN_SECONDS="${SMOKE_RUN_SECONDS:-12}"

log() { printf '\033[36m[smoke]\033[0m %s\n' "$*"; }
fail() { printf '\033[31m[smoke] BAŞARISIZ:\033[0m %s\n' "$*" >&2; exit 1; }

cleanup() {
  # Yedeği geri yükle (veri kaybı olmasın).
  if [ -f "$BACKUP_DIR/sessions.db" ]; then
    mkdir -p "$DATA_DIR"
    cp -f "$BACKUP_DIR/sessions.db" "$DB" 2>/dev/null || true
    rm -f "$DB-wal" "$DB-shm"
  fi
  rm -rf "$BACKUP_DIR"
}
trap cleanup EXIT

log "derleniyor (ön yüz + Rust)…"
npm run build >/dev/null
cargo build --manifest-path src-tauri/Cargo.toml >/dev/null

BIN="src-tauri/target/debug/macrocode"
[ -x "$BIN" ] || fail "derlenmiş ikili bulunamadı: $BIN"

log "veritabanı yedekleniyor…"
mkdir -p "$BACKUP_DIR"
if [ -f "$DB" ]; then
  cp -f "$DB" "$BACKUP_DIR/sessions.db"
  [ -f "$DB-wal" ] && cp -f "$DB-wal" "$BACKUP_DIR/sessions.db-wal" || true
  [ -f "$DB-shm" ] && cp -f "$DB-shm" "$BACKUP_DIR/sessions.db-shm" || true
fi

log "veritabanı temizleniyor (test için)…"
rm -f "$DB" "$DB-wal" "$DB-shm"

log "uygulama ${RUN_SECONDS} sn çalıştırılıyor…"
set +e
timeout "$RUN_SECONDS" "$BIN" >"$BACKUP_DIR/app.log" 2>&1
APP_RC=$?
set -e
# 124 = timeout (beklenen).
if [ "$APP_RC" != "0" ] && [ "$APP_RC" != "124" ]; then
  cat "$BACKUP_DIR/app.log" >&2
  fail "uygulama beklenmeyen şekilde sonlandı (rc=$APP_RC)"
fi
if grep -qiE "panicked|thread .* panicked" "$BACKUP_DIR/app.log"; then
  cat "$BACKUP_DIR/app.log" >&2
  fail "uygulama panic ile sonlandı"
fi

log "veritabanı doğrulanıyor…"
[ -f "$DB" ] || fail "session veritabanı oluşmadı (ACL yoksa yazma sessizce başarısız olur)"

if command -v sqlite3 >/dev/null 2>&1; then
  ROWS="$(sqlite3 "$DB" "select count(*) from sessions;" 2>/dev/null || echo 0)"
  TABLES="$(sqlite3 "$DB" "select count(*) from sqlite_master where type='table' and name in ('sessions','audit_log','pending_approvals');" 2>/dev/null || echo 0)"
  [ "$TABLES" = "3" ] || fail "beklenen tablolar eksik (bulunan: $TABLES/3) — migration çalışmamış"
  [ "$ROWS" -ge 2 ] || fail "sessions tablosuna yazılmadı (satır: $ROWS, beklenen >= 2) → ACL/yazma izni eksik"
  log "OK: $ROWS satır yazıldı, 3 tablo mevcut"
else
  log "UYARI: sqlite3 yok — yalnızca dosya varlığı doğrulandı"
fi

log "BAŞARILI ✓ (uygulama boot etti, veritabanına yazdı)"
