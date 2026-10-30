//! Faz 5 — stdio MCP sunucuları için subprocess köprüsü.
//! WebView subprocess açamaz; JSON-RPC satırları bu komutlarla akar:
//! `mcp_spawn` → id, `mcp_write(id, data)`, `mcp_read(id, timeout)` → satır,
//! `mcp_kill(id)`. App çıkışında tüm child'lar öldürülür (`kill_on_drop` + exit kancası).

use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::State;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt};

fn err(msg: impl Into<String>) -> String {
    msg.into()
}

/// O7 sertleştirmeleri — sınırlar (hasarsız: gerçekçi MCP mesajları KB'tır).
/// Satır: JSON-RPC yanıtları Typ. <100 KB; 1 MB çok cömert bir tavan.
const MAX_LINE_BYTES: usize = 1024 * 1024;
/// Yazma: `mcp_write` gövdesi (istek + toString serialization) için tavan.
const MAX_WRITE_BYTES: usize = 1024 * 1024;
/// Eşzamanlı stdio sunucu sayısı (sızıntı/pompalama sınırlaması).
const MAX_PROCS: usize = 32;

/// O7 — çocuk sürece sızacak ebeveyn ortamı temizlenir; yalnızca stdout/stdin
/// yeterli minimum izin listesi yeniden verilir (ANTHROPIC_API_KEY gibi
/// launcher env'inde kalan anahtarlar çocuk sürece talimat olamaz).
/// Windows için temel sistem ortamları korunur (`SystemRoot` olmadan olmaz).
const ENV_PASSLIST: [&str; 14] = [
    "PATH",
    "HOME",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "USER",
    "USERNAME",
    "SHELL",
    "TERM",
    "COMSPEC",
    "SYSTEMROOT",
    "WINDIR",
    "APPDATA",
    "LOCALAPPDATA",
];

struct McpProc {
    child: tokio::process::Child,
    reader: tokio::io::BufReader<tokio::process::ChildStdout>,
    writer: tokio::process::ChildStdin,
}

#[derive(Default)]
pub struct McpState {
    procs: Mutex<HashMap<String, Arc<tokio::sync::Mutex<McpProc>>>>,
    next_id: Mutex<u64>,
}

impl McpState {
    fn alloc_id(&self) -> String {
        let mut n = self.next_id.lock().unwrap();
        *n += 1;
        format!("mcp-{n}")
    }

    fn get(&self, id: &str) -> Result<Arc<tokio::sync::Mutex<McpProc>>, String> {
        self.procs
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| err("mcp: sunucu bulunamadı"))
    }

    /// App çıkışında çağrılır (bloklamaz; `kill_on_drop` drop'ta da öldürür).
    pub fn kill_all(&self) {
        let mut procs = self.procs.lock().unwrap();
        for (_, p) in procs.drain() {
            if let Ok(mut proc) = p.try_lock() {
                let _ = proc.child.start_kill();
            }
        }
    }
}

#[derive(Debug, Serialize, Clone)]
pub struct McpSpawned {
    pub id: String,
}

/// M3 — çocuk sürece zararlı ortam değişkenleri geçirilemez.
///
/// `env_clear` ebeveyni temizliyor ama çağıran (`env` parametresi) kendi
/// değerini ekliyor: `LD_PRELOAD` ile kütüphane, `PYTHONPATH`/`NODE_OPTIONS`
/// ile yorumlayıcı kod enjeksiyonu yapılabilir (çocuk sürecin kod yüklemesi için
/// gereken tek şey budur). `PATH`/`HOME` zaten `ENV_PASSLIST` ile veriliyor;
/// override'ın meşru gerekçesi yok.
/// Karşılaştırma ASCII-bağımsız; `LD_*` / `DYLD_*` ön ekleri de engellenir.
const BLOCKED_ENV_KEYS: [&str; 22] = [
    "PATH",
    "HOME",
    "PYTHONPATH",
    "PYTHONHOME",
    "PYTHONSTARTUP",
    "PYTHONEXECPREFIX",
    "NODE_OPTIONS",
    "NODE_PATH",
    "BASH_ENV",
    "ENV",
    "PERL5OPT",
    "PERLLIB",
    "PERL5LIB",
    "RUBYOPT",
    "RUBYLIB",
    "GCONV_PATH",
    "IFS",
    "SHELLOPTS",
    "BASHOPTS",
    "JAVA_TOOL_OPTIONS",
    "JDK_JAVA_OPTIONS",
    "SSLKEYLOGFILE",
];

/// M3 — zararlı env anahtarı varsa süreç BAŞLATILMAZ (değerler hata mesajına
/// yazılmaz; yalnızca anahtar adı).
fn check_env_keys(env: &std::collections::HashMap<String, String>) -> Result<(), String> {
    for key in env.keys() {
        let upper = key.to_ascii_uppercase();
        if BLOCKED_ENV_KEYS.iter().any(|b| *b == upper)
            || upper.starts_with("LD_")
            || upper.starts_with("DYLD_")
        {
            return Err(err(format!(
                "mcp: izin verilmeyen ortam değişkeni: {key}"
            )));
        }
    }
    Ok(())
}

async fn spawn_inner(
    state: &McpState,
    command: String,
    args: Vec<String>,
    env: Option<HashMap<String, String>>,
    root: Option<String>,
) -> Result<McpSpawned, String> {
    let cmd = command.trim().to_owned();
    if cmd.is_empty() {
        return Err(err("mcp: sunucu komutu boş olamaz"));
    }
    for a in args
        .iter()
        .chain(env.as_ref().map(|e| e.values()).into_iter().flatten())
    {
        if a.contains('\n') || a.contains('\0') {
            return Err(err("mcp: geçersiz argüman"));
        }
    }
    // M3: zararlı env anahtarları süreç başlatmadan reddedilir.
    if let Some(vars) = env.as_ref() {
        check_env_keys(vars)?;
    }
    // O7 — süreç sayısı üst sınırı: sızan/askıda kalan sunucular uygulamanın
    // süreç tabanını şişiremez.
    if state.procs.lock().unwrap().len() >= MAX_PROCS {
        return Err(err(format!(
            "mcp: eşzamanlı sunucu sınırı dolu ({MAX_PROCS}) · sunucuyu kapatıp tekrar deneyin"
        )));
    }
    let mut child_cmd = tokio::process::Command::new(&cmd);
    child_cmd
        .args(&args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    if let Some(r) = root.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let dir = std::path::PathBuf::from(r)
            .canonicalize()
            .map_err(|e| err(format!("mcp: çalışma dizini geçersiz: {e}")))?;
        child_cmd.current_dir(&dir);
    }
    // O7 — env_clear + izin listesi: ebeveynin TAM ortamı (API anahtarları,
    // proxy tokenler biri olabilir) çocuk sürece sızmaz.
    child_cmd.env_clear();
    for key in ENV_PASSLIST {
        if let Ok(v) = std::env::var(key) {
            child_cmd.env(key, v);
        }
    }
    if let Some(vars) = env {
        child_cmd.envs(&vars);
    }
    let mut child = child_cmd
        .spawn()
        .map_err(|e| err(format!("mcp: sunucu başlatılamadı ({cmd}): {e}")))?;
    let writer = child
        .stdin
        .take()
        .ok_or_else(|| err("mcp: stdin açılamadı"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| err("mcp: stdout açılamadı"))?;
    let id = state.alloc_id();
    state.procs.lock().unwrap().insert(
        id.clone(),
        Arc::new(tokio::sync::Mutex::new(McpProc {
            child,
            reader: tokio::io::BufReader::new(stdout),
            writer,
        })),
    );
    Ok(McpSpawned { id })
}

async fn write_inner(state: &McpState, id: &str, data: &str) -> Result<(), String> {
    // O7 — yazma gövdesi sınırlı: göbeklenme/bellek pompanması kapıyı kapatır.
    if data.len() > MAX_WRITE_BYTES {
        return Err(err(format!(
            "mcp: istek gövdesi çok büyük ({} > {} bayt)",
            data.len(),
            MAX_WRITE_BYTES
        )));
    }
    let proc = state.get(id)?;
    let mut p = proc.lock().await;
    p.writer
        .write_all(data.as_bytes())
        .await
        .map_err(|e| err(format!("mcp: yazılamadı: {e}")))?;
    p.writer
        .write_all(b"\n")
        .await
        .map_err(|e| err(format!("mcp: yazılamadı: {e}")))?;
    p.writer
        .flush()
        .await
        .map_err(|e| err(format!("mcp: yazılamadı: {e}")))?;
    Ok(())
}

async fn read_inner(state: &McpState, id: &str, timeout_ms: Option<u64>) -> Result<String, String> {
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(15_000).clamp(100, 60_000));
    let proc = state.get(id)?;
    let mut p = proc.lock().await;
    // O7 — satır boyutu sınırı: `take()` 1 MB'ı aşan akışı keser; sınırı
    // aşan tek satır newline'sız döner → reddedilir (sonsuz satır büyümez).
    let mut buf: Vec<u8> = Vec::with_capacity(4096);
    let mut limited = (&mut p.reader).take(MAX_LINE_BYTES as u64);
    let n = tokio::time::timeout(timeout, limited.read_until(b'\n', &mut buf))
        .await
        .map_err(|_| err("mcp: yanıt zaman aşımı"))?
        .map_err(|e| err(format!("mcp: okunamadı: {e}")))?;
    if n == 0 {
        return Err(err("mcp: akış kapandı"));
    }
    // Newline byte saw := `\n` in buf — yoksa tavan aşılı ve satır tamamlanmadı.
    if !buf.contains(&b'\n') {
        return Err(err("mcp: satır boyutu sınırı aşıldı"));
    }
    let line = String::from_utf8_lossy(&buf)
        .trim_end_matches(['\r', '\n'])
        .to_owned();
    Ok(line)
}

async fn kill_inner(state: &McpState, id: &str) -> Result<(), String> {
    let proc = state.get(id)?;
    {
        let mut p = proc.lock().await;
        let _ = p.child.kill().await;
        let _ = p.child.wait().await;
    }
    state.procs.lock().unwrap().remove(id);
    Ok(())
}

#[tauri::command]
pub async fn mcp_spawn(
    state: State<'_, McpState>,
    command: String,
    args: Vec<String>,
    env: Option<HashMap<String, String>>,
    root: Option<String>,
) -> Result<McpSpawned, String> {
    spawn_inner(&state, command, args, env, root).await
}

#[tauri::command]
pub async fn mcp_write(state: State<'_, McpState>, id: String, data: String) -> Result<(), String> {
    write_inner(&state, &id, &data).await
}

#[tauri::command]
pub async fn mcp_read(
    state: State<'_, McpState>,
    id: String,
    timeout_ms: Option<u64>,
) -> Result<String, String> {
    read_inner(&state, &id, timeout_ms).await
}

#[tauri::command]
pub async fn mcp_kill(state: State<'_, McpState>, id: String) -> Result<(), String> {
    kill_inner(&state, &id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[cfg(unix)]
    async fn spawn_echo_kill_dongusu() {
        let state = McpState::default();
        // `cat`: stdin'i stdout'a yankılar (satır tamponlu test sunucusu).
        let spawned = spawn_inner(
            &state,
            "cat".to_string(),
            vec![],
            None,
            Some(std::env::temp_dir().to_string_lossy().to_string()),
        )
        .await
        .unwrap();
        let msg = r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#.to_string();
        write_inner(&state, &spawned.id, &msg).await.unwrap();
        let line = read_inner(&state, &spawned.id, Some(5000)).await.unwrap();
        assert_eq!(line, msg);
        kill_inner(&state, &spawned.id).await.unwrap();
        assert!(read_inner(&state, &spawned.id, Some(200)).await.is_err());
    }

    #[tokio::test]
    async fn bos_komut_reddedilir() {
        let state = McpState::default();
        assert!(spawn_inner(&state, "   ".to_string(), vec![], None, None)
            .await
            .is_err());
    }

    /// M3 — zararlı env anahtarları süreç başlatmadan reddedilir (değer
    /// hata mesajına sızmaz, yalnız anahtar adı döner).
    #[tokio::test]
    async fn m3_zararli_env_anahtarlari_reddedilir() {
        let state = McpState::default();
        for key in ["LD_PRELOAD", "ld_preload", "PYTHONPATH", "NODE_OPTIONS", "PATH", "DYLD_INSERT_LIBRARIES"] {
            let mut env = std::collections::HashMap::new();
            env.insert(key.to_string(), "/tmp/something".to_string());
            let r = spawn_inner(&state, "cat".to_string(), vec![], Some(env), None).await;
            assert!(r.is_err(), "{key} reddedilmeli");
            assert!(
                !r.unwrap_err().contains("/tmp/something"),
                "hata mesajı DEĞER içermemeli"
            );
        }
    }

    /// M3 — meşru env anahtarları ve mevcut davranış bozulmaz.
    #[tokio::test]
    async fn m3_mesru_env_gecer() {
        let state = McpState::default();
        let mut env = std::collections::HashMap::new();
        env.insert("MCP_LOG_LEVEL".to_string(), "debug".to_string());
        let spawned = spawn_inner(
            &state,
            "cat".to_string(),
            vec![],
            Some(env),
            Some(std::env::temp_dir().to_string_lossy().to_string()),
        )
        .await
        .unwrap();
        kill_inner(&state, &spawned.id).await.unwrap();
    }
}
