//! Faz 5 — stdio MCP sunucuları için subprocess köprüsü.
//! WebView subprocess açamaz; JSON-RPC satırları bu komutlarla akar:
//! `mcp_spawn` → id, `mcp_write(id, data)`, `mcp_read(id, timeout)` → satır,
//! `mcp_kill(id)`. App çıkışında tüm child'lar öldürülür (`kill_on_drop` + exit kancası).

use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::State;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};

fn err(msg: impl Into<String>) -> String {
    msg.into()
}

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
    let mut line = String::new();
    tokio::time::timeout(timeout, p.reader.read_line(&mut line))
        .await
        .map_err(|_| err("mcp: yanıt zaman aşımı"))?
        .map_err(|e| err(format!("mcp: okunamadı: {e}")))?;
    Ok(line.trim_end_matches(['\r', '\n']).to_owned())
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
}
