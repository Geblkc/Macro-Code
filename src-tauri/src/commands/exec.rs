use super::proc_tree::{self, ProcTree};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::sync::watch;

const TIMEOUT_SECS: u64 = 15;
const MAX_TIMEOUT_MS: u64 = 600_000;
const MAX_OUTPUT_BYTES: usize = 8192;
/// Süreç öldükten sonra boru okuyucularının boşalması için üst sınır.
/// Torun süreçler stdout/stderr'i açık tutarsa exec sonsuza kadar asılı
/// kalmasın (iptal/timeout sonucu yine UI'a döner).
const DRAIN_TIMEOUT: Duration = Duration::from_secs(2);

/// Faz 3 (K3) — exec allowlist tek kaynağı: `src/lib/engine/allowlist.json`.
/// TS `policy.ts` aynı dosyayı import eder; burası `include_str!` ile gömer.
/// Boş liste = serbest argüman; diğerleri prefix eşleşmesi.
/// exec her zaman manuel onaylıdır (O6) — burası yalnızca allowlist filtresidir.
const ALLOWLIST_JSON: &str = include_str!("../../../src/lib/engine/allowlist.json");

/// O1 (Faz 4) — dosya operandsı alan serbest-argüman komutları: argümanlar
/// workspace-relative olmalı (mutlak yol / `..` / bloklu dosya-dizin reddi).
/// `cat /etc/passwd`, `find /`, `cat .env` bu kapıdan geçemez (read_file'daki
/// koruma exec ile delinemez). Diğer komutlarda argüman jail'i yok — allowlist
/// "hangi komut"u kısıtlar (bilinçli tasarım; bkz. `_note`).
const FILE_ARG_CMDS: [&str; 10] = [
    "cat", "head", "tail", "wc", "find", "rg", "ls", "touch", "mkdir", "prettier",
];

/// Dosya argümanı jail'i: mutlak yol, `..`, bloklu dosya/dizin reddi.
/// Bayraklar (`-la`, `--color`) ve desenler (`*.ts`) etkilenmez.
fn check_file_arg(a: &str) -> Result<(), String> {
    let v = a.trim().replace('\\', "/");
    if v.is_empty() || v.starts_with('-') {
        return Ok(()); // bayrak
    }
    if v.starts_with('/') {
        return Err(err(format!("argüman jail dışı (mutlak yol): {a}")));
    }
    for seg in v.split('/') {
        if seg == ".." {
            return Err(err(format!("argüman jail dışı (../): {a}")));
        }
        if crate::commands::fs::is_blocked_dir(seg) {
            return Err(err(format!("yasaklı dizin argümanda: {a}")));
        }
        if crate::commands::fs::is_blocked_file_name(seg)
            || crate::commands::fs::is_env_prefixed(seg)
        {
            return Err(err(format!("yasaklı dosya argümanda: {a}")));
        }
        // O7 (D2b senkronu): gizli/veri uzantıları — ad-bazlı (`.pem` dotfile
        // dahil) ve case-insensitive. Eskiden kopyalanmış küçük harf tablosuydu
        // (`CERT.PEM`/`.key` kaçardı); artık fs.rs tek kaynak fonksiyonunu kullanır.
        if crate::commands::fs::is_blocked_name_ext(seg) {
            return Err(err(format!("yasaklı dosya argümanda: {a}")));
        }
    }
    Ok(())
}

/// O1 (desen istisnası) — değeri yol değil **glob deseni** alan bayraklar.
/// TS `policy.ts` `PATTERN_FLAGS` ile senkron: `rg --glob '!**/.git/**'`,
/// `find . -name '*.pem'` gibi meşru aramalar jail'e takılmamalı.
fn pattern_flags(cmd: &str) -> &'static [&'static str] {
    match cmd {
        "find" => &["-name", "-iname", "-path", "-ipath", "-regex", "-iregex"],
        "rg" => &["-g", "--glob", "--iglob"],
        _ => &[],
    }
}

/// Dosya operandsı olarak denetlenecek argümanlar (desen bayraklarının
/// değerleri hariç). Glob içeren HER argümanı muaf tutmak `cat *.pem`
/// operandı üzerinden blok listesini atlatırdı; bu yüzden yalnızca desen
/// değeri alan bayraklar atlanır.
fn file_path_args(cmd: &str, args: &[String]) -> Vec<String> {
    let flags = pattern_flags(cmd);
    let mut out: Vec<String> = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = args[i].as_str();
        if !a.starts_with('-') {
            out.push(args[i].clone());
            i += 1;
            continue;
        }
        // `-name desen` / `--glob desen`: değeri atla.
        if flags.contains(&a) {
            i += 2;
            continue;
        }
        // `--glob=desen`: argümanın tamamı desendir.
        if flags
            .iter()
            .any(|f| a.strip_prefix(f).is_some_and(|rest| rest.starts_with('=')))
        {
            i += 1;
            continue;
        }
        i += 1;
    }
    out
}

/// M6 — `--opt=değer` biçiminden değeri çıkarır (`--filefoo` gibi adları
/// yanlışlıkla eşleştirmez).
fn opt_value<'a>(arg: &'a str, flag: &str) -> Option<&'a str> {
    arg.strip_prefix(flag)?.strip_prefix('=')
}

/// M6 — git argümanlarından **dosya/dizin yolu** taşıyanları çıkarır.
///
/// Eski durum: `git` `FILE_ARG_CMDS` dışındaydı; `git diff --no-index
/// /etc/passwd x` keyfi dosya okuyor, `git commit -F /etc/passwd` dosyayı
/// mesaj olarak okuyor, `git show HEAD:.env` bloklu dosyayı döküyordu.
/// Kapsam: `--` sonrası operandlar, `rev:path` path kısmı, `-F/--file`,
/// `--output`, `--pathspec-from-file`, `add` pathspec'leri ve global
/// `-C/--git-dir/--work-tree` değerleri.
fn git_path_args(args: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut i = 0usize;
    let mut sub: Option<&str> = None;

    // Global seçenekler alt komuttan ÖNCE gelir (`git -C dir status`).
    while i < args.len() {
        let a = args[i].as_str();
        if a == "--" {
            out.extend(args[i + 1..].iter().cloned());
            return out;
        }
        if !a.starts_with('-') {
            sub = Some(a);
            i += 1;
            break;
        }
        // `-C <dir>` ve bitişik `-C<dir>`.
        if a == "-C" {
            if let Some(v) = args.get(i + 1) {
                out.push(v.clone());
            }
            i += 2;
            continue;
        }
        if let Some(v) = a.strip_prefix("-C") {
            if !v.is_empty() {
                out.push(v.to_string());
            }
            i += 1;
            continue;
        }
        // `--git-dir=...` / `--work-tree=...`.
        if let Some((name, value)) = a.split_once('=') {
            if name == "--git-dir" || name == "--work-tree" {
                out.push(value.to_string());
            }
            i += 1;
            continue;
        }
        if a == "--git-dir" || a == "--work-tree" {
            if let Some(v) = args.get(i + 1) {
                out.push(v.clone());
            }
            i += 2;
            continue;
        }
        // Değer alan ama yol olmayan global seçenekler: değeri atla ki alt
        // komut sanılmasın.
        if matches!(
            a,
            "-c" | "--config-env" | "--namespace" | "--super-prefix" | "--attr-source"
        ) {
            i += 2;
            continue;
        }
        i += 1;
    }

    let Some(sub) = sub else {
        return out;
    };
    let rest = &args[i..];
    match sub {
        "add" => {
            let mut j = 0;
            while j < rest.len() {
                let a = rest[j].as_str();
                if a == "--" {
                    out.extend(rest[j + 1..].iter().cloned());
                    break;
                }
                if let Some(v) = opt_value(a, "--pathspec-from-file") {
                    out.push(v.to_string());
                } else if a == "--pathspec-from-file" {
                    if let Some(v) = rest.get(j + 1) {
                        out.push(v.clone());
                        j += 1;
                    }
                } else if !a.starts_with('-') {
                    out.push(a.to_string());
                }
                j += 1;
            }
        }
        "diff" | "log" | "show" => {
            let mut j = 0;
            while j < rest.len() {
                let a = rest[j].as_str();
                if a == "--" {
                    out.extend(rest[j + 1..].iter().cloned());
                    break;
                }
                if let Some(v) = opt_value(a, "--output") {
                    out.push(v.to_string());
                } else if a == "--output" {
                    if let Some(v) = rest.get(j + 1) {
                        out.push(v.clone());
                        j += 1;
                    }
                } else if !a.starts_with('-') {
                    // URL (`https://…`) dosya yolu değildir; `rev:path` ise
                    // yalnız path kısmı denetlenir.
                    if a.contains("://") {
                        // atla
                    } else if let Some((_, p)) = a.split_once(':') {
                        if !p.is_empty() {
                            out.push(p.to_string());
                        }
                    } else {
                        out.push(a.to_string());
                    }
                }
                j += 1;
            }
        }
        "commit" => {
            let mut j = 0;
            while j < rest.len() {
                let a = rest[j].as_str();
                if a == "--" {
                    out.extend(rest[j + 1..].iter().cloned());
                    break;
                }
                if let Some(v) =
                    opt_value(a, "--file").or_else(|| opt_value(a, "--pathspec-from-file"))
                {
                    out.push(v.to_string());
                } else if a == "--file" || a == "--pathspec-from-file" || a == "-F" {
                    if let Some(v) = rest.get(j + 1) {
                        out.push(v.clone());
                        j += 1;
                    }
                } else if a.starts_with("-F") && a.len() > 2 {
                    out.push(a[2..].to_string());
                }
                j += 1;
            }
        }
        "stash" => {
            // `git stash push -- <pathspec>`; `-m` değeri mesajdır, yol değil.
            if let Some(pos) = rest.iter().position(|a| a == "--") {
                out.extend(rest[pos + 1..].iter().cloned());
            }
        }
        _ => {}
    }
    out
}

/// M6 — `git -C <dir>` operand çözümlemesini değiştirir. Symlink/canonical
/// jail'in doğru tabanı kullanması için birikimli `-C` değerini döndürür.
fn git_c_base(args: &[String]) -> Option<PathBuf> {
    let mut base = PathBuf::new();
    let mut seen = false;
    let mut i = 0usize;
    while i < args.len() {
        let a = args[i].as_str();
        if a == "--" || !a.starts_with('-') {
            break;
        }
        if a == "-C" {
            if let Some(v) = args.get(i + 1) {
                base = base.join(v);
                seen = true;
            }
            i += 2;
            continue;
        }
        if let Some(v) = a.strip_prefix("-C") {
            if !v.is_empty() {
                base = base.join(v);
                seen = true;
            }
            i += 1;
            continue;
        }
        if matches!(
            a,
            "-c" | "--git-dir"
                | "--work-tree"
                | "--config-env"
                | "--namespace"
                | "--super-prefix"
                | "--attr-source"
        ) {
            i += 2;
            continue;
        }
        i += 1;
    }
    if seen {
        Some(base)
    } else {
        None
    }
}

fn err(msg: impl Into<String>) -> String {
    msg.into()
}

#[derive(Debug, Serialize)]
pub struct ExecOut {
    pub stdout: String,
    pub stderr: String,
    pub code: i32,
    pub truncated: bool,
    /// Kullanıcı `exec_cancel` ile süreci durdurdu.
    #[serde(default)]
    pub cancelled: bool,
    /// Süreç `timeout_ms` sınırını aştığı için durduruldu.
    #[serde(default)]
    pub timed_out: bool,
}

/// P0.2 — canlı exec akışı olayları (`Channel<ExecEvent>`).
/// `k` alanı TS tarafında ayrım için kullanılır: `stdout` / `stderr` / `exit`.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "k", rename_all = "snake_case")]
pub enum ExecEvent {
    Stdout {
        data: String,
    },
    Stderr {
        data: String,
    },
    Exit {
        code: i32,
        truncated: bool,
        cancelled: bool,
        timed_out: bool,
    },
}

/// P0.2 — çalışan süreçlerin iptal kanalları.
///
/// `exec_cmd_stream` her çalıştırma için bir `watch` kanalı kaydeder;
/// `exec_cancel(run_id)` bu kanala `true` gönderir. Akış döngüsü sinyali
/// görünce `Child::start_kill` ile süreci sonlandırır ve `wait` ile reaping
/// yapar (zombie kalmaz).
#[derive(Default)]
pub struct ExecState {
    runs: Mutex<HashMap<String, watch::Sender<bool>>>,
}

impl ExecState {
    /// `false` → aynı `run_id` zaten çalışıyor; yeni kayıt eskisini ezmemeli
    /// (eski akışın iptal kanalı düşerdi).
    fn register(&self, run_id: &str, tx: watch::Sender<bool>) -> bool {
        if let Ok(mut runs) = self.runs.lock() {
            if runs.contains_key(run_id) {
                return false;
            }
            runs.insert(run_id.to_string(), tx);
            return true;
        }
        false
    }

    fn remove(&self, run_id: &str) {
        if let Ok(mut runs) = self.runs.lock() {
            runs.remove(run_id);
        }
    }

    fn cancel(&self, run_id: &str) -> bool {
        if let Ok(runs) = self.runs.lock() {
            if let Some(tx) = runs.get(run_id) {
                tx.send_replace(true);
                return true;
            }
        }
        false
    }
}

fn resolve_timeout(timeout_ms: Option<u64>) -> Duration {
    Duration::from_millis(
        timeout_ms
            .unwrap_or(TIMEOUT_SECS * 1000)
            .clamp(1000, MAX_TIMEOUT_MS),
    )
}

/// Çıktı tavanı: bellekte yalnızca son `limit` bayt tutulur. Canlı akış
/// tüm parçaları gönderir; nihai `ExecOut` ise kuyruk odaklı kırpılır
/// (hata mesajları genellikle çıktının sonundadır).
struct CappedBuf {
    text: String,
    truncated: bool,
    limit: usize,
}

impl CappedBuf {
    fn new(limit: usize) -> Self {
        Self {
            text: String::new(),
            truncated: false,
            limit,
        }
    }

    fn push(&mut self, chunk: &str) {
        if self.limit == 0 {
            self.truncated = true;
            return;
        }
        if chunk.len() >= self.limit {
            let mut start = chunk.len() - self.limit;
            while start < chunk.len() && !chunk.is_char_boundary(start) {
                start += 1;
            }
            self.text.clear();
            self.text.push_str(&chunk[start..]);
            self.truncated = true;
            return;
        }
        if self.text.len() + chunk.len() > self.limit {
            let drop = self.text.len() + chunk.len() - self.limit;
            let mut start = drop;
            while start < self.text.len() && !self.text.is_char_boundary(start) {
                start += 1;
            }
            self.text.drain(..start);
            self.truncated = true;
        }
        self.text.push_str(chunk);
    }
}

/// Boru okuyucusunu sınırlı süre bekler. Süreç ölmüş olsa bile torun bir
/// süreç boruyu açık tutabilir; bu durumda görev iptal edilir ve exec sonucu
/// yine döner.
async fn collect_pump(
    mut task: tokio::task::JoinHandle<CappedBuf>,
    stream: &str,
) -> Result<CappedBuf, String> {
    match tokio::time::timeout(DRAIN_TIMEOUT, &mut task).await {
        Ok(Ok(buf)) => Ok(buf),
        Ok(Err(e)) => Err(err(format!("{stream} okunamadı: {e}"))),
        Err(_) => {
            task.abort();
            let _ = task.await;
            Ok(CappedBuf::new(MAX_OUTPUT_BYTES))
        }
    }
}

async fn pump_exec<R>(reader: R, is_stderr: bool, channel: Channel<ExecEvent>) -> CappedBuf
where
    R: AsyncRead + Unpin,
{
    let mut buf = CappedBuf::new(MAX_OUTPUT_BYTES);
    let mut reader = BufReader::new(reader);
    let mut line = Vec::new();
    loop {
        line.clear();
        match reader.read_until(b'\n', &mut line).await {
            Ok(0) => break,
            Ok(_) => {
                // Satır sınırında okunduğu için UTF-8 bölünmesi olmaz denebilir;
                // yine de geçersiz baytlar kaybı önlemek için lossy çevrilir.
                let text = String::from_utf8_lossy(&line).into_owned();
                buf.push(&text);
                let ev = if is_stderr {
                    ExecEvent::Stderr { data: text }
                } else {
                    ExecEvent::Stdout { data: text }
                };
                // WebView kapandıysa gönderim başarısız olur; süreç yine
                // tamamlanana kadar arka planda çalışır (çıktı birikmez).
                let _ = channel.send(ev);
            }
            Err(_) => break,
        }
    }
    buf
}

fn allow_table() -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let v: serde_json::Value =
        serde_json::from_str(ALLOWLIST_JSON).map_err(|e| err(format!("allowlist bozuk: {e}")))?;
    v.as_object()
        .cloned()
        .ok_or_else(|| err("allowlist obje değil"))
}

/// O7 — allowlist.json `_predicates` bölümü: komut başına "bu flagler keyfi
/// süreç başlatır" listesi (tek kaynak; TS `policy.ts` aynı tabloyu okur).
fn predicate_table() -> &'static serde_json::Map<String, serde_json::Value> {
    static TABLE: OnceLock<serde_json::Map<String, serde_json::Value>> = OnceLock::new();
    TABLE.get_or_init(|| {
        serde_json::from_str::<serde_json::Value>(ALLOWLIST_JSON)
            .ok()
            .and_then(|v| v.get("_predicates")?.as_object().cloned())
            .unwrap_or_default()
    })
}

/// O7 — serbest-argüman komutlarda komut-çalıştıran flagler reddedilir.
/// `find . -exec sh -c '…' \;` / `rg --pre 'cmd' pattern` keyfi süreç başlatır;
/// allowlist bu komutları salt-okunur gibi listeler, bu tablo o deliği kapatır.
/// Tam bayrak (`-exec`) ya da `=`-değerli biçim (`--pre=cmd`) eşleşir.
fn check_predicates(cmd: &str, args: &[String]) -> Result<(), String> {
    let Some(bad) = predicate_table().get(cmd.trim()).and_then(|v| v.as_array()) else {
        return Ok(());
    };
    let bads: Vec<&str> = bad.iter().filter_map(|f| f.as_str()).collect();
    if bads.is_empty() {
        return Ok(());
    }
    for a in args {
        for f in &bads {
            if a.as_str() == *f || a.starts_with(&format!("{f}=")) {
                return Err(err(format!(
                    "yasaklı argüman: {cmd} {a} · bu flag komut çalıştırabilir"
                )));
            }
        }
    }
    Ok(())
}

/// `rm` yalnızca `-i` ile; `-f`/`-r`/`-R`/`--force`/`--recursive` reddedilir.
fn is_rm_safe(args: &[String]) -> bool {
    if args.first().is_some_and(|a| a == "-i") {
        for a in &args[1..] {
            if *a == "--force" || *a == "--recursive" || *a == "--no-preserve-root" {
                return false;
            }
            if a.len() > 1
                && a.starts_with('-')
                && !a.starts_with("--")
                && a.chars()
                    .skip(1)
                    .any(|ch| ch == 'f' || ch == 'r' || ch == 'R')
            {
                return false;
            }
        }
        true
    } else {
        false
    }
}

/// Kullanıcının ayarlardan eklediği ek allowlist (TS `parseCustomAllowList` çıktısı).
/// Aynı biçim: `{ "<komut>": [["<arg0>"], ["<arg0>", "<arg1>"]] }` — boş liste = serbest argüman.
pub type ExtraAllow = serde_json::Map<String, serde_json::Value>;

/// `extra` tablosunda bir komutun izinli olup olmadığını kontrol eder.
/// Boş liste (serbest argüman) veya prefix eşleşmesi geçerli → true.
fn extra_allows(extra: &ExtraAllow, cmd: &str, args: &[String]) -> bool {
    let Some(entry) = extra.get(cmd) else {
        return false;
    };
    let Some(prefixes) = entry.as_array() else {
        return false;
    };
    if prefixes.is_empty() {
        return true;
    }
    prefixes.iter().any(|p| {
        p.as_array().is_some_and(|want| {
            want.iter().enumerate().all(|(i, w)| {
                w.as_str()
                    .is_some_and(|s| args.get(i).is_some_and(|a| a == s))
            })
        })
    })
}

/// O7 (Y2) — exec dosya argümanlarında **symlink çözümü** (senkron; `exec_cmd`
/// cwd jail'i çözüldükten sonra çağırır). `check_file_arg` string düzeyinde
/// çalışır; "creds -> ~/.ssh/id_ed25519" gibi workspace içi symlink'i
/// göremez (fs araçları bu kontrolü `resolve_rooted` içinde yapar, exec
/// deliyordu). Var olan hedef canonicalize edilip workspace (root yoksa cwd)
/// altında kalmak zorundadır; çözülen gerçek adlar da (case-insensitive)
/// blok listesinden geçer.
fn guard_file_args(
    dir: &std::path::Path,
    jail_base: &std::path::Path,
    cmd: &str,
    args: &[String],
) -> Result<(), String> {
    // M6: git için yol listesi `git_path_args`'tan gelir; `-C` operand
    // tabanını değiştirdiğinden canonical çözümleme o tabana göre yapılır.
    let (resolve_dir, paths): (PathBuf, Vec<String>) = if cmd == "git" {
        let resolve_dir = match git_c_base(args) {
            Some(rel) => {
                let canon = dir
                    .join(rel)
                    .canonicalize()
                    .map_err(|e| err(format!("git -C dizini geçersiz: {e}")))?;
                if !canon.starts_with(jail_base) {
                    return Err(err("git -C workspace dışına çıkıyor"));
                }
                canon
            }
            None => dir.to_path_buf(),
        };
        (resolve_dir, git_path_args(args))
    } else if cmd == "rm" {
        (
            dir.to_path_buf(),
            args.iter()
                .filter(|a| !a.starts_with('-'))
                .cloned()
                .collect(),
        )
    } else if FILE_ARG_CMDS.contains(&cmd) {
        (dir.to_path_buf(), file_path_args(cmd, args))
    } else {
        return Ok(());
    };
    for a in &paths {
        let v = a.trim().replace('\\', "/");
        if v.is_empty() {
            continue;
        }
        let joined = resolve_dir.join(&v);
        let Ok(canon) = joined.canonicalize() else {
            continue; // yok — string jail zaten desen/missing yoluna izin verir
        };
        if !canon.starts_with(jail_base) {
            return Err(err(format!(
                "argüman workspace dışına çıkıyor (symlink?): {a}"
            )));
        }
        // Çözülen gerçek yoldaki dosya/dizin adları da blok listesinden geçmeli.
        let rel = canon.strip_prefix(jail_base).unwrap_or(&canon);
        for comp in rel.components() {
            let name = comp.as_os_str().to_string_lossy();
            if name.is_empty() {
                continue;
            }
            if crate::commands::fs::is_blocked_dir(&name) {
                return Err(err(format!("yasaklı dizin argümanda: {a}")));
            }
            if crate::commands::fs::is_blocked_file_name(&name)
                || crate::commands::fs::is_env_prefixed(&name)
            {
                return Err(err(format!("yasaklı dosya argümanda: {a}")));
            }
            if crate::commands::fs::is_blocked_name_ext(&name) {
                return Err(err(format!("yasaklı dosya argümanda: {a}")));
            }
        }
    }
    Ok(())
}

fn check_cmd(cmd: &str, args: &[String], extra: &ExtraAllow) -> Result<(), String> {
    let c = cmd.trim();
    if c.is_empty() {
        return Err(err("komut boş olamaz"));
    }
    // Tehlikeli argümanlar: shell operatörleri ve mutlak kaçışlar ham string olarak gelmemeli.
    // (args dizisi kullanıldığı için shell parse edilmez; yine de savunma amaçlı kontrol.)
    for a in args {
        if a.contains('\n') || a.contains('\0') {
            return Err(err("geçersiz argüman"));
        }
    }
    if c == "rm" {
        if !is_rm_safe(args) {
            return Err(err("yasaklı komut: rm yalnızca -i ile · -f/-r reddedilir"));
        }
        // O1: rm de dosya argümanı alır — jail dışı hedef satılamaz.
        for a in args.iter().filter(|a| !a.starts_with('-')) {
            check_file_arg(a)?;
        }
        return Ok(());
    }
    // O7: komut-çalıştıran flagler (`find -exec`, `rg --pre` …) — kullanıcı
    // ek allowlist'i de dahil HER yol geçemez (rm kuralıyla aynı sertlik).
    check_predicates(c, args)?;
    // L1 düzeltmesi: dosya argümanı jail'i `extra_allows` erken dönüşünden ÖNCE
    // çalışır. Eski sırayla kullanıcı `touch` gibi bir komutu serbest tanımlarsa
    // jail hiç çalışmıyor; mutlak yol / `../` / bloklu dosya doğrudan invoke
    // ile hedeflenebiliyordu (yerleşik tabloyla aynı sertlikte olmalı).
    if FILE_ARG_CMDS.contains(&c) {
        for a in file_path_args(c, args) {
            check_file_arg(&a)?;
        }
    }
    // M6 — git dosya argümanı jail'i. `git` eskiden `FILE_ARG_CMDS` dışındaydı:
    // `git diff --no-index /etc/passwd x` keyfi dosya okuyor, `git commit -F
    // /etc/passwd` dosyayı mesaj olarak okuyordu. `--exec-path` ise keyfi
    // `git-<altkomut>` programı çalıştırır → doğrudan reddedilir.
    if c == "git" {
        if args
            .iter()
            .any(|a| a == "--exec-path" || a.starts_with("--exec-path="))
        {
            return Err(err(
                "yasaklı argüman: git --exec-path · keyfi program çalıştırabilir",
            ));
        }
        for p in git_path_args(args) {
            check_file_arg(&p)?;
        }
    }
    let table = allow_table()?;
    // Faz 8 L3: kullanıcının ek allowlist'i de geçerli (yerleşik tablo ile birleşik).
    if extra_allows(extra, c, args) {
        return Ok(());
    }
    // `_note`/`_predicates` meta anahtarları komut değildir.
    let entry = table.get(c).filter(|_| c != "_note" && c != "_predicates");
    match entry {
        None => {
            let mut cmds: Vec<&String> = table.keys().filter(|k| *k != "_note").collect();
            cmds.sort();
            Err(err(format!(
                "yasaklı komut: {c} · allowlist: {}",
                cmds.iter()
                    .map(|s| s.as_str())
                    .collect::<Vec<_>>()
                    .join("/")
            )))
        }
        Some(v) => {
            let prefixes = v.as_array().ok_or_else(|| err("allowlist biçimi bozuk"))?;
            // Dosya argümanı jail'i (FILE_ARG_CMDS) yukarıda, prefix'ten bağımsız
            // uygulandı; burada yalnızca allowlist prefix eşleşmesi kalır.
            // Boş liste: args serbest (ls/pwd/echo/eslint/pytest/…).
            if prefixes.is_empty() {
                return Ok(());
            }
            let ok = prefixes.iter().any(|p| {
                p.as_array().is_some_and(|want| {
                    want.iter().enumerate().all(|(i, w)| {
                        w.as_str()
                            .is_some_and(|s| args.get(i).is_some_and(|a| a == s))
                    })
                })
            });
            if ok {
                Ok(())
            } else {
                Err(err(format!("yasaklı argüman: {c} {}", args.join(" "))))
            }
        }
    }
}

/// M5 — cwd jail'i (test edilebilir, `exec_cmd`'den ayrı).
///
/// Sıra önemli: root canonical → cwd canonical → `is_dir` → `starts_with`
/// → bloklu bileşen denetimi. Eski kod root `Option` iken root verilmezse
/// tüm denetimi atlıyordu; artık her çağrı bu kapıdan geçer.
fn resolve_jailed_cwd(root: &str, cwd: &str) -> Result<(PathBuf, PathBuf), String> {
    let root_trimmed = root.trim();
    if root_trimmed.is_empty() {
        return Err(err("workspace root boş olamaz"));
    }
    let base = PathBuf::from(root_trimmed)
        .canonicalize()
        .map_err(|e| err(format!("workspace kökü geçersiz: {e}")))?;
    let cwd_trimmed = cwd.trim();
    if cwd_trimmed.is_empty() {
        return Err(err("cwd boş olamaz"));
    }
    let dir = PathBuf::from(cwd_trimmed)
        .canonicalize()
        .map_err(|e| err(format!("cwd geçersiz: {e}")))?;

    // M5 — cwd jail'i artık koşulsuz: canonical cwd workspace altında,
    // gerçekten bir dizin ve bloklu bileşen içermiyor olmalı. `.git` /
    // `.macrocode` gibi dizinlerde komut çalıştırmak (ör. `.git/hooks`)
    // argüman jail'ini atlatmanın dolaylı yoluydu.
    if !dir.is_dir() {
        return Err(err("cwd bir dizin değil"));
    }
    if !dir.starts_with(&base) {
        return Err(err("cwd workspace dışına çıkamaz"));
    }
    crate::commands::fs::check_rel_components(&base, &dir)?;
    Ok((base, dir))
}

/// P0.2 — güvenlik kapılarının tek ortak yolu (hem `exec_cmd` hem
/// `exec_cmd_stream` spawn'dan ÖNCE buradan geçer).
fn prepare_exec(
    cmd: &str,
    args: &[String],
    cwd: &str,
    root: &str,
    extra: &ExtraAllow,
) -> Result<PathBuf, String> {
    check_cmd(cmd, args, extra)?;
    let (base, dir) = resolve_jailed_cwd(root, cwd)?;

    // O7 (Y2) — exec dosya argümanlarında **symlink çözümü**:
    // `check_file_arg` string düzeyinde çalışır; "creds -> ~/.ssh/id_ed25519"
    // gibi workspace içi symlink'i göremez (fs araçları bu kontrolü
    // `resolve_rooted` içinde yapar, exec deliyordu). Var olan hedef burada
    // canonicalize edilip workspace altında kalmak zorundadır.
    guard_file_args(&dir, &base, cmd.trim(), args)?;
    Ok(dir)
}

#[tauri::command]
pub async fn exec_cmd(
    cmd: String,
    args: Vec<String>,
    cwd: String,
    timeout_ms: Option<u64>,
    // M5: root artık ZORUNLU. Eskiden `Option` idi ve root verilmezse cwd
    // jail'i tamamen atlanıyordu (doğrudan invoke ile her dizinde komut).
    root: String,
    // Faz 8 L3: kullanıcı allowlist uzantısı (TS `parseCustomAllowList` çıktısı).
    extra_allow: Option<ExtraAllow>,
) -> Result<ExecOut, String> {
    let extra = extra_allow.unwrap_or_default();
    let dir = prepare_exec(&cmd, &args, &cwd, &root, &extra)?;

    let timeout = resolve_timeout(timeout_ms);

    let mut child_cmd = tokio::process::Command::new(cmd.trim());
    proc_tree::configure_command(&mut child_cmd);
    child_cmd
        .args(&args)
        .current_dir(&dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    let mut child = child_cmd
        .spawn()
        .map_err(|e| err(format!("komut çalıştırılamadı: {e}")))?;
    let mut tree = ProcTree::attach(&mut child);
    let output_fut = child.wait_with_output();
    tokio::pin!(output_fut);
    let output = match tokio::time::timeout(timeout, &mut output_fut).await {
        Ok(res) => {
            // Child sonuçlandı; guard drop'ta eski PID'e dokunmamalı.
            tree.disarm();
            res.map_err(|e| err(format!("komut çalıştırılamadı: {e}")))?
        }
        Err(_) => {
            // Yalnız doğrudan child'ı değil, süreç ağacını da durdur.
            tree.kill();
            tree.disarm();
            let _ = tokio::time::timeout(DRAIN_TIMEOUT, &mut output_fut).await;
            return Err(err("komut zaman aşımına uğradı"));
        }
    };

    let mut stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let mut stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let mut truncated = false;
    if stdout.len() + stderr.len() > MAX_OUTPUT_BYTES {
        let mut combined = format!("{stdout}\n{stderr}");
        combined.truncate(MAX_OUTPUT_BYTES);
        stdout = combined;
        stderr.clear();
        truncated = true;
    }
    Ok(ExecOut {
        stdout,
        stderr,
        code: output.status.code().unwrap_or(-1),
        truncated,
        cancelled: false,
        timed_out: false,
    })
}

/// P0.2 — canlı akışlı exec.
///
/// Güvenlik kapıları (`check_cmd`, cwd jail, symlink/dosya argümanı jail'i)
/// `prepare_exec` üzerinden **spawn'dan önce** aynen çalışır. Çıktı satır
/// satır `Channel<ExecEvent>` ile UI'a akar; nihai sonuç yine `ExecOut`'tur
/// (eski sözleşme korunur).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn exec_cmd_stream(
    run_id: String,
    cmd: String,
    args: Vec<String>,
    cwd: String,
    timeout_ms: Option<u64>,
    root: String,
    extra_allow: Option<ExtraAllow>,
    on_event: Channel<ExecEvent>,
    state: tauri::State<'_, ExecState>,
) -> Result<ExecOut, String> {
    let run_id = run_id.trim().to_string();
    if run_id.is_empty() || run_id.len() > 256 {
        return Err(err("geçersiz çalıştırma kimliği"));
    }
    let extra = extra_allow.unwrap_or_default();
    let dir = prepare_exec(&cmd, &args, &cwd, &root, &extra)?;
    let timeout = resolve_timeout(timeout_ms);

    // Kayıt spawn'dan ÖNCE: aynı kimlikle ikinci bir çalıştırma eskisinin
    // iptal kanalını ezmesin ve gereksiz süreç doğurmasın.
    let (tx, mut rx) = watch::channel(false);
    if !state.register(&run_id, tx) {
        return Err(err("çalıştırma kimliği zaten kullanımda"));
    }

    let mut child_cmd = tokio::process::Command::new(cmd.trim());
    proc_tree::configure_command(&mut child_cmd);
    child_cmd
        .args(&args)
        .current_dir(&dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    let mut child = match child_cmd.spawn() {
        Ok(child) => child,
        Err(e) => {
            state.remove(&run_id);
            return Err(err(format!("komut çalıştırılamadı: {e}")));
        }
    };
    // İptal/timeout'ta doğrudan child yerine tüm süreç ağacını durdur.
    let mut tree = ProcTree::attach(&mut child);
    let Some(stdout) = child.stdout.take() else {
        state.remove(&run_id);
        return Err(err("stdout alınamadı"));
    };
    let Some(stderr) = child.stderr.take() else {
        state.remove(&run_id);
        return Err(err("stderr alınamadı"));
    };

    // Kayıt sonrası HER çıkış yolunda state temizlenmeli (erken `?` dahil).
    let result = async {
        let stdout_task = tokio::spawn(pump_exec(stdout, false, on_event.clone()));
        let stderr_task = tokio::spawn(pump_exec(stderr, true, on_event.clone()));

        let started = std::time::Instant::now();
        let mut cancelled = false;
        let mut timed_out = false;
        let status = loop {
            if let Some(st) = child
                .try_wait()
                .map_err(|e| err(format!("süreç durumu alınamadı: {e}")))?
            {
                break st;
            }
            if started.elapsed() >= timeout {
                timed_out = true;
                tree.kill();
                let _ = child.start_kill();
                break child
                    .wait()
                    .await
                    .map_err(|e| err(format!("süreç beklenemedi: {e}")))?;
            }
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_millis(40)) => {}
                changed = rx.changed() => {
                    if changed.is_err() || *rx.borrow() {
                        cancelled = true;
                        tree.kill();
                        let _ = child.start_kill();
                        break child
                            .wait()
                            .await
                            .map_err(|e| err(format!("süreç beklenemedi: {e}")))?;
                    }
                }
            }
        };
        // Süreç normal bitti; ağaç guard'ı artık drop'ta öldürmemeli.
        tree.disarm();

        // Boru okuyucuları süreç ölünce EOF görür; burada reaping tamamlanır.
        // (Torun süreç boruyu açık tutarsa yine de asılı kalmayız.)
        // İki okuyucu da beklenir; biri hata verse bile diğeri boşta kalmaz.
        let out_res = collect_pump(stdout_task, "stdout").await;
        let err_res = collect_pump(stderr_task, "stderr").await;
        let out_buf = out_res?;
        let err_buf = err_res?;
        let mut stdout = out_buf.text;
        let mut stderr = err_buf.text;
        let mut truncated = out_buf.truncated || err_buf.truncated;
        if stdout.len() + stderr.len() > MAX_OUTPUT_BYTES {
            let combined = format!("{stdout}\n{stderr}");
            let mut start = combined.len().saturating_sub(MAX_OUTPUT_BYTES);
            while start < combined.len() && !combined.is_char_boundary(start) {
                start += 1;
            }
            stdout = combined[start..].to_string();
            stderr.clear();
            truncated = true;
        }
        let code = status.code().unwrap_or(-1);
        let out = ExecOut {
            stdout,
            stderr,
            code,
            truncated,
            cancelled,
            timed_out,
        };
        let _ = on_event.send(ExecEvent::Exit {
            code,
            truncated,
            cancelled,
            timed_out,
        });
        Ok(out)
    }
    .await;

    state.remove(&run_id);
    result
}

/// P0.2 — çalışan bir `exec_cmd_stream` sürecini iptal eder.
/// Bilinmeyen/tamamlanmış `run_id` için `false` döner (yarış durumu güvenli).
#[tauri::command]
pub fn exec_cancel(run_id: String, state: tauri::State<'_, ExecState>) -> bool {
    state.cancel(run_id.trim())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    /// Ek allowlist olmadan kontrol (yerleşik tablo).
    fn check_cmd2(cmd: &str, args: &[String]) -> Result<(), String> {
        check_cmd(cmd, args, &serde_json::Map::new())
    }

    /// P0.2 — timeout üst sınırı 600 sn'ye çıkarıldı; alt sınır 1 sn korunur.
    #[test]
    fn p02_timeout_clamp() {
        assert_eq!(resolve_timeout(Some(0)).as_millis(), 1000);
        assert_eq!(resolve_timeout(Some(999)).as_millis(), 1000);
        assert_eq!(resolve_timeout(Some(15_000)).as_millis(), 15_000);
        assert_eq!(resolve_timeout(Some(300_000)).as_millis(), 300_000);
        assert_eq!(resolve_timeout(Some(600_000)).as_millis(), 600_000);
        assert_eq!(resolve_timeout(Some(9_999_999)).as_millis(), 600_000);
        // Verilmezse eski varsayılan (15 sn) korunur.
        assert_eq!(resolve_timeout(None).as_millis(), 15_000);
    }

    /// P0.2 — iptal kaydı: bilinen id sinyal gönderir, temizlenen id false döner.
    #[test]
    fn p02_exec_state_cancel() {
        let state = ExecState::default();
        let (tx, rx) = watch::channel(false);
        assert!(state.register("kosu-1", tx));
        assert!(!*rx.borrow());
        assert!(state.cancel("kosu-1"));
        assert!(*rx.borrow());
        assert!(!state.cancel("bilinmeyen"));
        // Aynı kimlik ikinci kez kaydedilemez (mevcut kanal ezilmez).
        let (tx2, _rx2) = watch::channel(false);
        assert!(!state.register("kosu-1", tx2));
        state.remove("kosu-1");
        assert!(!state.cancel("kosu-1"));
    }

    /// P0.2 — `exec_cmd` artık `spawn + wait_with_output` kullanıyor; süreç
    /// ağacı guard'ı normal çıkışta disarme edilmeli ve çıktı korunmalı.
    #[cfg(unix)]
    #[test]
    fn p02_exec_cmd_spawn_yolu_calisir() {
        use std::fs;
        let base = std::env::temp_dir().join(format!("macrocode-p02-exec-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        let root = base.to_string_lossy().to_string();

        let out = tauri::async_runtime::block_on(exec_cmd(
            "echo".to_string(),
            vec!["merhaba".to_string()],
            root.clone(),
            Some(5_000),
            root,
            None,
        ))
        .expect("echo çalışmalı");
        assert_eq!(out.code, 0);
        assert!(out.stdout.contains("merhaba"));
        assert!(!out.cancelled);
        assert!(!out.timed_out);
        let _ = fs::remove_dir_all(&base);
    }

    /// P0.2 — final çıktı tavanı: bellekte son 8 KB tutulur, kırpma işaretlenir.
    #[test]
    fn p02_capped_buf_son_kismi_tutar() {
        let mut b = CappedBuf::new(10);
        b.push("abc");
        assert_eq!(b.text, "abc");
        assert!(!b.truncated);
        b.push("defghijk");
        assert_eq!(b.text, "bcdefghijk");
        assert!(b.truncated);
        // Tek parça limitten büyükse yalnızca son limit bayt kalır.
        let mut c = CappedBuf::new(4);
        c.push("0123456789");
        assert_eq!(c.text, "6789");
        assert!(c.truncated);
    }

    /// Kullanıcı allowlist'i: `{ "docker": [["ps"]] }`
    fn extra(pairs: &[(&str, &[&[&str]])]) -> ExtraAllow {
        let mut m = ExtraAllow::new();
        for (cmd, prefixes) in pairs {
            let arr: Vec<serde_json::Value> =
                prefixes.iter().map(|p| serde_json::json!(p)).collect();
            m.insert((*cmd).to_string(), serde_json::Value::Array(arr));
        }
        m
    }

    #[test]
    fn keyfi_calistirma_reddedilir() {
        assert!(check_cmd2("node", &args(&["-e", "1"])).is_err());
        assert!(check_cmd2("npx", &args(&["kotu-paket"])).is_err());
        assert!(check_cmd2("npm", &args(&["install"])).is_err());
        assert!(check_cmd2("npm", &args(&["exec", "kotu"])).is_err());
        assert!(check_cmd2("rm", &args(&["-rf", "/"])).is_err());
        assert!(check_cmd2("rm", &args(&["-i", "-rf", "dosya"])).is_err());
        assert!(check_cmd2("rm", &args(&["dosya"])).is_err());
        assert!(check_cmd2("", &args(&[])).is_err());
    }

    #[test]
    fn o1_dosya_argumani_jail() {
        // O1 (Faz 4): serbest-argüman komutlarında dosya operandsı jail içinde olmalı.
        assert!(check_cmd2("cat", &args(&["/etc/passwd"])).is_err());
        assert!(check_cmd2("cat", &args(&["../../.ssh/id_rsa"])).is_err());
        assert!(check_cmd2("cat", &args(&[".env"])).is_err());
        assert!(check_cmd2("cat", &args(&[".git/config"])).is_err());
        assert!(check_cmd2("find", &args(&["/"])).is_err());
        assert!(check_cmd2("find", &args(&[".."])).is_err());
        assert!(check_cmd2("ls", &args(&["/home"])).is_err());
        assert!(check_cmd2("touch", &args(&["../kacis.txt"])).is_err());
        assert!(check_cmd2("rg", &args(&["token", ".git"])).is_err());
        assert!(check_cmd2("head", &args(&["-n", "5", "/var/log/syslog"])).is_err());
        // Bloklu dosya uzantısı da düşer (read_file ile senkron).
        assert!(check_cmd2("cat", &args(&["sertifika.pem"])).is_err());
        // Normal kullanım etkilenmez.
        assert!(check_cmd2("cat", &args(&["src/app.ts"])).is_ok());
        assert!(check_cmd2("find", &args(&[".", "-name", "*.ts"])).is_ok());
        assert!(check_cmd2("rg", &args(&["desen", "src"])).is_ok());
        assert!(check_cmd2("cat", &args(&["-n", "src/a.ts"])).is_ok());
        // Desen bayraklarının değerleri yol gibi denetlenmez (yanlış ret).
        assert!(check_cmd2("rg", &args(&["--glob", "!**/.git/**", "token", "src"])).is_ok());
        assert!(check_cmd2("rg", &args(&["-g", "*.pem", "token"])).is_ok());
        assert!(check_cmd2("rg", &args(&["--glob=!**/node_modules/**", "token"])).is_ok());
        assert!(check_cmd2("find", &args(&[".", "-path", "*/node_modules/*", "-prune"])).is_ok());
        assert!(check_cmd2("find", &args(&[".", "-name", "*.pem"])).is_ok());
        // Glob'lu OPERAND muaf değildir: gizli dosya hedefi hâlâ reddedilir.
        assert!(check_cmd2("cat", &args(&["*.pem"])).is_err());
        assert!(check_cmd2("rg", &args(&["--glob", "*.ts", "token", ".git"])).is_err());
        // Bayraklar jail'e takılmaz.
        assert!(check_cmd2("ls", &args(&["-la"])).is_ok());
    }

    #[test]
    fn o1_rm_jail() {
        assert!(check_cmd2("rm", &args(&["-i", "/etc/hosts"])).is_err());
        assert!(check_cmd2("rm", &args(&["-i", "../disari.txt"])).is_err());
        assert!(check_cmd2("rm", &args(&["-i", ".env"])).is_err());
        assert!(check_cmd2("rm", &args(&["-i", "build/turetilmis.js"])).is_ok());
    }

    /// M6 — git dosya argümanı jail'i (string düzeyi; symlink/canonical
    /// denetimi `guard_file_args` içinde ayrıca yapılır).
    #[test]
    fn m6_git_dosya_argumani_jail() {
        // Workspace dışı / bloklu dosya okuma.
        assert!(check_cmd2("git", &args(&["diff", "--no-index", "/etc/passwd", "x"])).is_err());
        assert!(check_cmd2("git", &args(&["commit", "-F", "/etc/passwd"])).is_err());
        assert!(check_cmd2("git", &args(&["commit", "--file=/etc/passwd"])).is_err());
        assert!(check_cmd2("git", &args(&["show", "HEAD:.env"])).is_err());
        assert!(check_cmd2("git", &args(&["log", "--", ".env"])).is_err());
        assert!(check_cmd2("git", &args(&["diff", "--output=/tmp/x", "HEAD"])).is_err());
        assert!(check_cmd2("git", &args(&["add", ".ssh/id_rsa"])).is_err());
        assert!(check_cmd2("git", &args(&["add", "../disari.txt"])).is_err());
        assert!(check_cmd2("git", &args(&["-C", "../disari", "status"])).is_err());
        assert!(check_cmd2("git", &args(&["--git-dir=/etc", "status"])).is_err());
        assert!(check_cmd2("git", &args(&["--exec-path=/tmp", "status"])).is_err());
        // Meşru kullanım etkilenmez.
        assert!(check_cmd2("git", &args(&["status"])).is_ok());
        assert!(check_cmd2("git", &args(&["show", "HEAD:src/app.ts"])).is_ok());
        assert!(check_cmd2("git", &args(&["diff", "src/a.ts", "src/b.ts"])).is_ok());
        assert!(check_cmd2("git", &args(&["log", "--", "src"])).is_ok());
        // `-m` değeri mesajdır, yol değil — `..` içermesi reddedilmemeli.
        assert!(check_cmd2("git", &args(&["commit", "-m", "fix: ../tmp yolunu düzelt"])).is_ok());
        assert!(check_cmd2("git", &args(&["add", "src/app.ts"])).is_ok());
    }

    /// M6 — symlink ve `git -C` tabanı canonical jail'den geçer.
    #[cfg(unix)]
    #[test]
    fn m6_git_symlink_ve_c_jail() {
        use std::fs;
        let base = std::env::temp_dir().join(format!("macrocode-m6-{}", std::process::id()));
        let outside = std::env::temp_dir().join(format!("macrocode-m6-out-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let _ = fs::remove_dir_all(&outside);
        fs::create_dir_all(base.join("alt")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("gizli.txt"), "x").unwrap();
        std::os::unix::fs::symlink(outside.join("gizli.txt"), base.join("creds")).unwrap();
        std::os::unix::fs::symlink(&outside, base.join("alt").join("kacis")).unwrap();

        // `creds` symlink'i dışarıyı gösterir → reddedilir.
        assert!(guard_file_args(
            &base,
            &base,
            "git",
            &args(&["diff", "--no-index", "creds", "x"])
        )
        .is_err());
        // `-C alt` tabanı doğru çözülür: alt/kacis dışarıyı gösterir.
        assert!(guard_file_args(
            &base,
            &base,
            "git",
            &args(&["-C", "alt", "diff", "--no-index", "kacis", "x"])
        )
        .is_err());
        // Workspace içi normal yol geçer.
        assert!(guard_file_args(
            &base,
            &base,
            "git",
            &args(&["diff", "--no-index", "alt", "alt"])
        )
        .is_ok());
        let _ = fs::remove_dir_all(&base);
        let _ = fs::remove_dir_all(&outside);
    }

    /// M5 — cwd jail: root zorunlu, cwd canonical + `is_dir` + bloklu bileşen.
    #[test]
    fn m5_cwd_jail() {
        use std::fs;
        let base = std::env::temp_dir().join(format!("macrocode-m5-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("alt")).unwrap();
        fs::create_dir_all(base.join(".git")).unwrap();
        fs::write(base.join("dosya.txt"), "x").unwrap();
        let root = base.to_string_lossy().to_string();
        let sub = base.join("alt").to_string_lossy().to_string();
        let git = base.join(".git").to_string_lossy().to_string();
        let file = base.join("dosya.txt").to_string_lossy().to_string();

        // Normal kullanım: kök ve alt dizin.
        assert!(resolve_jailed_cwd(&root, &root).is_ok());
        assert!(resolve_jailed_cwd(&root, &sub).is_ok());
        // Bloklu dizin cwd olamaz (.git).
        assert!(resolve_jailed_cwd(&root, &git).is_err());
        // Workspace dışı (mutlak) cwd.
        assert!(resolve_jailed_cwd(&root, "/").is_err());
        // `..` ile kaçış canonicalize sonrası dışarıda kalır.
        assert!(resolve_jailed_cwd(&root, &format!("{sub}/../..")).is_err());
        // root/cwd boş olamaz.
        assert!(resolve_jailed_cwd("", &root).is_err());
        assert!(resolve_jailed_cwd(&root, "").is_err());
        // Dosya cwd olamaz.
        assert!(resolve_jailed_cwd(&root, &file).is_err());
        let _ = fs::remove_dir_all(&base);
    }

    /// M5 — workspace içindeki symlink dışarıyı gösteriyorsa cwd reddedilir.
    #[cfg(unix)]
    #[test]
    fn m5_cwd_symlink_escape_reddedilir() {
        use std::fs;
        let base = std::env::temp_dir().join(format!("macrocode-m5-link-{}", std::process::id()));
        let outside = std::env::temp_dir().join(format!("macrocode-m5-out-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let _ = fs::remove_dir_all(&outside);
        fs::create_dir_all(&base).unwrap();
        fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, base.join("kacis")).unwrap();
        let root = base.to_string_lossy().to_string();
        let link = base.join("kacis").to_string_lossy().to_string();
        assert!(resolve_jailed_cwd(&root, &link).is_err());
        let _ = fs::remove_dir_all(&base);
        let _ = fs::remove_dir_all(&outside);
    }

    /// O7 — komut-çalıştıran flagler (`find -exec`, `rg --pre`) reddedilir;
    /// kullanıcı ek-allowlist'i boş (serbest) olsa bile geçemez.
    #[test]
    fn o7_komut_calistiran_flagler_reddedilir() {
        assert!(check_cmd2(
            "find",
            &args(&[".", "-name", "*.ts", "-exec", "sh", "-c", "id"])
        )
        .is_err());
        assert!(check_cmd2("find", &args(&[".", "-execdir", "rm", "-i", "{}", "+"])).is_err());
        assert!(check_cmd2("find", &args(&[".", "-ok", "sh", "{}", ";"])).is_err());
        assert!(check_cmd2("find", &args(&[".", "-okdir", "sh", "{}", ";"])).is_err());
        // `=`-değerli biçimler de yakalanır (find'ta biçimsiz ama savunma amaçlı).
        assert!(check_cmd2("rg", &args(&["--pre", "kotu.sh", "desen"])).is_err());
        assert!(check_cmd2("rg", &args(&["--pre=grep1", "desen"])).is_err());
        assert!(check_cmd2("rg", &args(&["--pre-glob", "*.txt", "desen"])).is_err());
        // Normal kullanım etkilenmez.
        assert!(check_cmd2("find", &args(&[".", "-name", "*.ts"])).is_ok());
        assert!(check_cmd2("rg", &args(&["desen", "-g", "*.ts"])).is_ok());
    }

    /// O7 — ek-allowlist (kullanıcı "find"i serbest tanımlasa bile) bu flagleri
    /// açamaz; predicate denetimi prefix eşleşmesinden ÖNCE çalışır.
    #[test]
    fn o7_ek_allowlist_predicateleri_asamaz() {
        let ex = extra(&[("find", &[&["-name"]]), ("rg", &[])]);
        assert!(check_cmd("find", &args(&["-name", "x", "-exec", "id"]), &ex).is_err());
        assert!(check_cmd("rg", &args(&["--pre", "kotu.sh", "d"]), &ex).is_err());
        // Temiz argümanlar yine geçer.
        assert!(check_cmd("find", &args(&["-name", "x"]), &ex).is_ok());
        assert!(check_cmd("rg", &args(&["desen"]), &ex).is_ok());
    }

    /// O7 senkronu — `rm` kısa bayrak kümesi char-üyeliğiyle denetlenir
    /// ("-1f" gibi regex'in kaçtığı biçimler de reddedilir; TS `isRmSafe` aynısı).
    #[test]
    fn o7_rm_bayrak_kumesi_char_uyeligi() {
        assert!(check_cmd2("rm", &args(&["-i", "-1f", "x"])).is_err());
        assert!(check_cmd2("rm", &args(&["-i", "-1r", "x"])).is_err());
        assert!(check_cmd2("rm", &args(&["-i", "-1", "x"])).is_ok());
    }

    /// O7 (Y2) — workspace içi symlink workspace dışına çıkarsa reddedilir:
    /// `cat .gizli/creds` string-jail'i geçer ama hedef jail dışındaysa
    /// canonicalize çözümüyle durdurulur.
    #[cfg(unix)]
    #[test]
    fn o7_exec_symlink_jail_disina_cikmaz() {
        use std::os::unix::fs::symlink;
        let kok = std::env::temp_dir().join(format!("mcode-exec-syml-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&kok);
        std::fs::create_dir_all(kok.join("ws/.gizli")).unwrap();
        // Jail DIŞI gerçek klasör (temp kökünde, ws dışında).
        std::fs::create_dir_all(kok.join("dis/ssh")).unwrap();
        std::fs::write(kok.join("dis/ssh/id_ed25519"), b"ab").unwrap();
        // ws içi symlink → jail dışı hedef.
        symlink(kok.join("dis/ssh/id_ed25519"), kok.join("ws/.gizli/creds")).unwrap();

        let ws = kok.join("ws");
        // root verilmediyse jail = cwd: symlink hedefi dışarı → reddedilir.
        let r1 = super::guard_file_args(&ws, &ws, "cat", &args(&[".gizli/creds"]));
        assert!(r1.is_err(), "symlink jail dışına çıkmamalı");

        // root daha genişse (jail = ws yerine temp kökü) symlink jail'i geçer;
        // bu kez çözülen GERÇEK yoldaki "id_ed25519" bloklu ad düşer.
        let r2 = super::guard_file_args(&ws, &kok, "cat", &args(&[".gizli/creds"]));
        assert!(
            r2.is_err(),
            "çözülen yoldaki bloklu ad (id_ed25519) reddedilmeli"
        );

        // String jail'de zaten yasak olan .env VARSA: çözülen yolda da düşer.
        std::fs::write(kok.join("ws/.env"), b"secret").unwrap();
        let r3 = super::guard_file_args(&ws, &ws, "cat", &args(&[".env"]));
        assert!(r3.is_err(), "string jail zaten reddeder");

        // Workspace İÇİ normal hedef: yine geçer (meşru akış bozulmaz).
        std::fs::write(kok.join("ws/ok.txt"), b"selam").unwrap();
        let r4 = super::guard_file_args(&ws, &ws, "cat", &args(&["ok.txt"]));
        assert!(r4.is_ok());

        // Desen (var olmayan yol): canonicalize başarısız → jail'e takılmaz.
        let r5 = super::guard_file_args(&ws, &ws, "find", &args(&[".", "-name", "*.ts"]));
        assert!(r5.is_ok());

        let _ = std::fs::remove_dir_all(&kok);
    }

    #[test]
    fn faz8_l3_kullanici_allowlisti_gecerer() {
        let ex = extra(&[("docker", &[&["ps"]]), ("mytool", &[])]);
        // Kullanıcının eklediği komut + prefix eşleşmesi → geçer.
        assert!(check_cmd("docker", &args(&["ps"]), &ex).is_ok());
        // Prefix eşleşmiyorsa reddedilir.
        assert!(check_cmd("docker", &args(&["rm", "-rf"]), &ex).is_err());
        // Boş liste = serbest argüman.
        assert!(check_cmd("mytool", &args(&["-x", "1"]), &ex).is_ok());
        // Ek tablo olmadan aynı komut reddedilir.
        assert!(check_cmd2("docker", &args(&["ps"])).is_err());
    }

    #[test]
    fn faz8_l3_yerlesik_ve_ek_tablo_birlestirilir() {
        // Yerleşik "npm" tablosu prefix eşleşmesi yapıyor; ek tablo da birleşir.
        let ex = extra(&[("npm", &[&["run", "build:ozel"]])]);
        assert!(check_cmd("npm", &args(&["run", "build"]), &ex).is_ok()); // yerleşik
        assert!(check_cmd("npm", &args(&["run", "build:ozel"]), &ex).is_ok()); // ek
        assert!(check_cmd("npm", &args(&["install"]), &ex).is_err());
    }

    /// L1 — kullanıcı ek-allowlist'i dosya argümanı jail'ini GEÇEMEZ
    /// (jail artık `extra_allows` erken dönüşünden önce çalışır).
    #[test]
    fn l1_ek_allowlist_dosya_argumani_jailini_asamaz() {
        let ex = extra(&[("touch", &[]), ("cat", &[])]);
        assert!(check_cmd("touch", &args(&["/etc/pwned"]), &ex).is_err());
        assert!(check_cmd("touch", &args(&["../kacis.txt"]), &ex).is_err());
        assert!(check_cmd("touch", &args(&[".env"]), &ex).is_err());
        assert!(check_cmd("cat", &args(&["../../.ssh/id_rsa"]), &ex).is_err());
        // Meşru kullanım etkilenmez.
        assert!(check_cmd("touch", &args(&["yeni.txt"]), &ex).is_ok());
        assert!(check_cmd("cat", &args(&["src/app.ts"]), &ex).is_ok());
    }

    /// H2 — dosya argümanı jail'i de büyük/küçük harf duyarlı (exec.rs daha
    /// önce yalnız çözülen yolu küçük harfe indiriyordu; ham seg'ler kaçıyordu).
    #[test]
    fn h2_dosya_argumani_jaili_buyuk_kucuk_harf_duyarsiz() {
        assert!(check_cmd2("cat", &args(&[".GIT/config"])).is_err());
        assert!(check_cmd2("cat", &args(&["KEYS.JSON"])).is_err());
        assert!(check_cmd2("cat", &args(&[".ENV.local"])).is_err());
        assert!(check_cmd2("ls", &args(&["Node_Modules"])).is_err());
        assert!(check_cmd2("cat", &args(&["src/app.ts"])).is_ok());
    }

    #[test]
    fn faz8_l3_ek_tablo_dangerous_komutlari_acmaz() {
        // `rm` ek tabloda olsa bile -f/-r reddedilir (kurallar değişmez).
        let ex = extra(&[("rm", &[&["-rf"]])]);
        assert!(check_cmd("rm", &args(&["-rf", "x"]), &ex).is_err());
    }

    #[test]
    fn izinli_prefixler_gecer() {
        assert!(check_cmd2("node", &args(&["--version"])).is_ok());
        assert!(check_cmd2("npx", &args(&["--version"])).is_ok());
        assert!(check_cmd2("npm", &args(&["--version"])).is_ok());
        assert!(check_cmd2("npm", &args(&["run", "build"])).is_ok());
        assert!(check_cmd2("npm", &args(&["run"])).is_ok()); // betiksiz `npm run` sadece listeler (salt-okunur)
        assert!(check_cmd2("npm", &args(&["test"])).is_ok());
        assert!(check_cmd2("cargo", &args(&["check"])).is_ok());
        assert!(check_cmd2("cargo", &args(&["clippy"])).is_ok());
        assert!(check_cmd2("cargo", &args(&["test", "--", "filtre"])).is_ok());
        assert!(check_cmd2("cargo", &args(&["run"])).is_err());
        assert!(check_cmd2("git", &args(&["status"])).is_ok());
        assert!(check_cmd2("git", &args(&["push"])).is_ok());
        assert!(check_cmd2("git", &args(&["add", "."])).is_ok());
        assert!(check_cmd2("ls", &args(&["-la"])).is_ok());
        assert!(check_cmd2("echo", &args(&["merhaba"])).is_ok());
        assert!(check_cmd2("rm", &args(&["-i", "dosya"])).is_ok());
        assert!(check_cmd2("pytest", &args(&["-k", "test_x"])).is_ok());
        assert!(check_cmd2("tsc", &args(&["--noEmit"])).is_ok());
        assert!(check_cmd2("go", &args(&["test", "./..."])).is_ok());
        assert!(check_cmd2("rg", &args(&["desen"])).is_ok());
        assert!(check_cmd2("pip", &args(&["install", "paket"])).is_ok());
        assert!(check_cmd2("pip", &args(&["uninstall", "paket"])).is_err());
    }
}
