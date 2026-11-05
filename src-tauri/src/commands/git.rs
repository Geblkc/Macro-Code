//! Git entegrasyonu — typed, jail-safe Git CLI köprüsü.
//!
//! Tasarım kararları (bkz. `docs/GIT.md`):
//!  - **Shell yok.** Yalnızca `Command::new("git").args([...])`; hiçbir argüman
//!    `sh -c` içinden geçmez.
//!  - **Repo kökü = workspace kökü.** Workspace bir üst repo'nun alt klasörüyse
//!    mutasyonlar reddedilir (`E_REPO_OUTSIDE_WORKSPACE`); yalnızca read-only
//!    tespit bilgisi döner.
//!  - **Path/ref/message doğrulaması** burada, tek yerde. Path'ler `--`
//!    ayırıcısından sonra verilir; mutlak yol/`..`/`-`/`:`/`.git` reddedilir.
//!  - **Kimlik istemi yok.** `GIT_TERMINAL_PROMPT=0`, askpass devre dışı.
//!  - **Çıktı tavanı + timeout.** Asılı kalan ağ işlemi veya dev diff belleği
//!    şişirmez.
//!
//! Frontend `src/lib/git/` aynı sözleşmeyi tiplerle yansıtır.

use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};

use super::fs;

/// Tek bir Git çıktısının üst sınırı (stdout). Aşılırsa `truncated=true`.
const MAX_CAPTURE_BYTES: usize = 4 * 1024 * 1024;
/// stderr için daha küçük tavan (yalnızca hata mesajı gösterilir).
const MAX_ERR_BYTES: usize = 256 * 1024;
const DEFAULT_TIMEOUT_SECS: u64 = 15;
const NETWORK_TIMEOUT_SECS: u64 = 90;
const MAX_PATHS: usize = 500;
const MAX_MESSAGE_CHARS: usize = 5000;
const MAX_DIFF_CONTEXT: u32 = 50;

/* ─────────────────────────── Hata modeli ─────────────────────────── */

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitError {
    /// Kararlı hata kodu; frontend i18n anahtarına çevirir.
    pub code: String,
    /// İnsan okunur ayrıntı (git stderr dahil).
    pub message: String,
}

impl GitError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
        }
    }
}

fn ge(code: &str, message: impl Into<String>) -> GitError {
    GitError::new(code, message)
}

fn err_not_repo() -> GitError {
    ge("E_NOT_REPO", "bu klasör bir git deposu değil")
}

fn err_outside_repo() -> GitError {
    ge(
        "E_REPO_OUTSIDE_WORKSPACE",
        "workspace bir üst git deposunun alt klasörü · repo kökünü workspace olarak aç",
    )
}

/* ─────────────────────────── Süreç çalıştırıcı ─────────────────────────── */

#[derive(Debug, Clone, Copy)]
struct GitOpts {
    timeout_secs: u64,
    read_only: bool,
    /// `GIT_CEILING_DIRECTORIES` ile üst dizinlerde repo aramayı engelle.
    ceiling: bool,
}

impl Default for GitOpts {
    fn default() -> Self {
        Self {
            timeout_secs: DEFAULT_TIMEOUT_SECS,
            read_only: true,
            ceiling: true,
        }
    }
}

impl GitOpts {
    fn network() -> Self {
        Self {
            timeout_secs: NETWORK_TIMEOUT_SECS,
            read_only: false,
            ceiling: true,
        }
    }

    fn write() -> Self {
        Self {
            timeout_secs: DEFAULT_TIMEOUT_SECS,
            read_only: false,
            ceiling: true,
        }
    }
}

struct GitOutput {
    stdout: String,
    stderr: String,
    code: i32,
    truncated: bool,
}

impl GitOutput {
    fn ok(&self) -> bool {
        self.code == 0
    }
}

async fn read_limited<R: AsyncRead + Unpin>(
    reader: &mut R,
    max: usize,
) -> std::io::Result<(Vec<u8>, bool)> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    let mut truncated = false;
    loop {
        let n = reader.read(&mut chunk).await?;
        if n == 0 {
            break;
        }
        if buf.len() >= max {
            truncated = true;
            continue; // süreci bloklamamak için okumaya devam et, veriyi at.
        }
        let room = max - buf.len();
        let take = n.min(room);
        buf.extend_from_slice(&chunk[..take]);
        if take < n {
            truncated = true;
        }
    }
    Ok((buf, truncated))
}

/// Git'i shell olmadan çalıştırır. `stdin` verilirse commit mesajı gibi
/// içerik boru üzerinden gider (komut satırına gömülmez).
async fn run_git(
    root: &Path,
    args: &[&str],
    stdin: Option<&str>,
    opts: GitOpts,
) -> Result<GitOutput, GitError> {
    let mut full: Vec<String> = vec![
        "--no-pager".into(),
        "-c".into(),
        "core.quotepath=false".into(),
        "-c".into(),
        "core.fsmonitor=false".into(),
    ];
    full.extend(args.iter().map(|s| (*s).to_string()));

    let mut cmd = tokio::process::Command::new("git");
    cmd.args(&full)
        .current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_PAGER", "cat")
        .env("GIT_OPTIONAL_LOCKS", if opts.read_only { "0" } else { "1" })
        .env("LC_ALL", "C")
        .env("LANG", "C")
        .env("SSH_ASKPASS_REQUIRE", "never")
        // Dış ortamdan gelen `GIT_DIR`/`GIT_WORK_TREE` vb. başka bir depoyu
        // hedefleyebilir; cwd jail'ini bunlarla atlatmayı engelle.
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
        .env_remove("GIT_OBJECT_DIRECTORY")
        .env_remove("GIT_ALTERNATE_OBJECT_DIRECTORIES")
        .env_remove("GIT_NAMESPACE")
        .env_remove("GIT_ASKPASS")
        .env_remove("SSH_ASKPASS")
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    if opts.ceiling {
        if let Some(parent) = root.parent() {
            cmd.env("GIT_CEILING_DIRECTORIES", parent);
        }
    }

    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            ge("E_GIT_MISSING", "git kurulu değil veya PATH'te bulunamadı")
        } else {
            ge("E_GIT_FAILED", format!("git başlatılamadı: {e}"))
        }
    })?;

    let stdin_pipe = child.stdin.take();
    let mut stdout_pipe = child
        .stdout
        .take()
        .ok_or_else(|| ge("E_GIT_FAILED", "git stdout açılamadı"))?;
    let mut stderr_pipe = child
        .stderr
        .take()
        .ok_or_else(|| ge("E_GIT_FAILED", "git stderr açılamadı"))?;
    let input = stdin.map(|s| s.to_string());

    let work = async move {
        let write = async move {
            if let Some(mut pipe) = stdin_pipe {
                if let Some(data) = input {
                    let _ = pipe.write_all(data.as_bytes()).await;
                }
                let _ = pipe.shutdown().await;
            }
        };
        let read_out = read_limited(&mut stdout_pipe, MAX_CAPTURE_BYTES);
        let read_err = read_limited(&mut stderr_pipe, MAX_ERR_BYTES);
        let wait = child.wait();
        let (_, out_res, err_res, status) = tokio::join!(write, read_out, read_err, wait);
        let (out_buf, out_trunc) =
            out_res.map_err(|e| ge("E_GIT_FAILED", format!("çıktı okunamadı: {e}")))?;
        let (err_buf, _err_trunc) =
            err_res.map_err(|e| ge("E_GIT_FAILED", format!("çıktı okunamadı: {e}")))?;
        let status = status.map_err(|e| ge("E_GIT_FAILED", format!("git beklenemedi: {e}")))?;
        Ok::<GitOutput, GitError>(GitOutput {
            stdout: String::from_utf8_lossy(&out_buf).into_owned(),
            stderr: String::from_utf8_lossy(&err_buf).into_owned(),
            code: status.code().unwrap_or(-1),
            truncated: out_trunc,
        })
    };

    match tokio::time::timeout(Duration::from_secs(opts.timeout_secs), work).await {
        Ok(res) => res,
        Err(_) => Err(ge(
            "E_TIMEOUT",
            format!("git zaman aşımına uğradı ({} sn)", opts.timeout_secs),
        )),
    }
}

/// Başarısız git çıktısını kararlı bir hataya çevirir.
fn fail(out: &GitOutput) -> GitError {
    let msg = if out.stderr.trim().is_empty() {
        out.stdout.trim()
    } else {
        out.stderr.trim()
    };
    let msg = msg.chars().take(2000).collect::<String>();
    let lower = msg.to_lowercase();
    // Devam eden merge/rebase/cherry-pick/revert/bisect — kullanıcıya
    // "önce tamamla/iptal et" yönlendirmesi verilir.
    let operation_in_progress = (lower.contains("in progress")
        && (lower.contains("merge")
            || lower.contains("rebase")
            || lower.contains("cherry-pick")
            || lower.contains("revert")
            || lower.contains("bisect")))
        || lower.contains("cannot switch branch while")
        || lower.contains("you need to resolve your current index first");
    if operation_in_progress {
        return ge(
            "E_OPERATION_IN_PROGRESS",
            "sürmekte olan git işlemi var · önce tamamla veya iptal et",
        );
    }
    ge(
        "E_GIT_FAILED",
        if msg.is_empty() {
            format!("git çıkış kodu {}", out.code)
        } else {
            msg
        },
    )
}

fn run_ok(out: GitOutput) -> Result<GitOutput, GitError> {
    if out.ok() {
        Ok(out)
    } else {
        Err(fail(&out))
    }
}

/* ─────────────────────────── Workspace / repo sınırı ─────────────────────────── */

fn canonical_workspace(root: &str) -> Result<PathBuf, GitError> {
    let p = fs::canonical_root(root).map_err(|e| ge("E_INVALID_ROOT", e))?;
    if !p.is_dir() {
        return Err(ge("E_INVALID_ROOT", "workspace kökü bir dizin değil"));
    }
    Ok(p)
}

async fn rev_parse_toplevel(root: &Path, ceiling: bool) -> Result<Option<PathBuf>, GitError> {
    let opts = GitOpts {
        ceiling,
        ..GitOpts::default()
    };
    let out = match run_git(root, &["rev-parse", "--show-toplevel"], None, opts).await {
        Ok(o) => o,
        Err(e) if e.code == "E_GIT_MISSING" => return Err(e),
        Err(_) => return Ok(None),
    };
    if !out.ok() {
        return Ok(None);
    }
    let raw = out.stdout.trim();
    if raw.is_empty() {
        return Ok(None);
    }
    let p = PathBuf::from(raw);
    Ok(Some(p.canonicalize().unwrap_or(p)))
}

/// Repo kökünü doğrular; workspace köküne eşit değilse hata döner.
async fn ensure_repo(root: &str) -> Result<PathBuf, GitError> {
    let ws = canonical_workspace(root)?;
    match rev_parse_toplevel(&ws, true).await? {
        Some(repo) if repo == ws => {}
        Some(_) => return Err(err_outside_repo()),
        None => {
            // Üst dizinde repo var mı? (read-only bilgi için ayrı tespit)
            if rev_parse_toplevel(&ws, false).await?.is_some() {
                return Err(err_outside_repo());
            }
            return Err(err_not_repo());
        }
    }

    let bare = run_git(
        &ws,
        &["rev-parse", "--is-bare-repository"],
        None,
        GitOpts::default(),
    )
    .await?;
    if bare.ok() && bare.stdout.trim() == "true" {
        return Err(ge(
            "E_BARE_REPO",
            "bare (çıplak) depo desteklenmiyor · çalışma dizini olan bir repo aç",
        ));
    }
    Ok(ws)
}

async fn git_dir(root: &Path) -> Option<PathBuf> {
    let out = run_git(
        root,
        &["rev-parse", "--absolute-git-dir"],
        None,
        GitOpts::default(),
    )
    .await
    .ok()?;
    if !out.ok() {
        return None;
    }
    let raw = out.stdout.trim();
    if raw.is_empty() {
        None
    } else {
        Some(PathBuf::from(raw))
    }
}

fn detect_operation(git_dir: &Path) -> Option<String> {
    for (name, label) in [
        ("rebase-merge", "rebase"),
        ("rebase-apply", "rebase"),
        ("MERGE_HEAD", "merge"),
        ("CHERRY_PICK_HEAD", "cherry-pick"),
        ("REVERT_HEAD", "revert"),
        ("BISECT_LOG", "bisect"),
    ] {
        if git_dir.join(name).exists() {
            return Some(label.to_string());
        }
    }
    None
}

/* ─────────────────────────── Veri tipleri ─────────────────────────── */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepoInfo {
    pub installed: bool,
    pub version: Option<String>,
    pub is_repo: bool,
    /// Workspace dışındaki (üst) repo kökü — yalnızca yönlendirme için.
    pub repo_root: Option<String>,
    pub bare: bool,
    pub branch: Option<String>,
    pub detached: bool,
    pub head: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    /// merge/rebase/cherry-pick/revert/bisect
    pub operation: Option<String>,
    /// Workspace bir üst repo'nun altındaysa true (mutasyon kapalı).
    pub outside_repo: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum GitFileKind {
    Added,
    Modified,
    Deleted,
    Renamed,
    Untracked,
    Conflicted,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFile {
    pub path: String,
    pub orig_path: Option<String>,
    /// Index (staged) durum karakteri: M, A, D, R, C, U, ? veya '.'
    pub index_status: String,
    /// Worktree durum karakteri.
    pub worktree_status: String,
    pub staged: bool,
    pub unstaged: bool,
    pub kind: GitFileKind,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub branch: String,
    pub detached: bool,
    pub head: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<GitFile>,
    pub clean: bool,
    pub operation: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiff {
    pub path: Option<String>,
    pub staged: bool,
    pub text: String,
    pub binary: bool,
    pub truncated: bool,
    pub untracked: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub sha: String,
    pub short: String,
    pub author: String,
    pub email: String,
    pub timestamp: i64,
    pub subject: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitDetail {
    pub sha: String,
    pub text: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    pub name: String,
    pub full: String,
    pub sha: String,
    pub upstream: Option<String>,
    pub current: bool,
    pub remote: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemote {
    pub name: String,
    pub url: String,
}

/* ─────────────────────────── Porcelain v2 ayrıştırma ─────────────────────────── */

fn parse_ab(text: &str) -> (u32, u32) {
    // "# branch.ab +2 -1"
    let mut ahead = 0;
    let mut behind = 0;
    for part in text.split_whitespace() {
        if let Some(n) = part.strip_prefix('+') {
            ahead = n.parse().unwrap_or(0);
        } else if let Some(n) = part.strip_prefix('-') {
            behind = n.parse().unwrap_or(0);
        }
    }
    (ahead, behind)
}

fn kind_of(xy: &str, untracked: bool, conflicted: bool) -> GitFileKind {
    if untracked {
        return GitFileKind::Untracked;
    }
    if conflicted {
        return GitFileKind::Conflicted;
    }
    let x = xy.chars().next().unwrap_or('.');
    let y = xy.chars().nth(1).unwrap_or('.');
    if x == 'R' || y == 'R' || x == 'C' || y == 'C' {
        GitFileKind::Renamed
    } else if x == 'A' || y == 'A' {
        GitFileKind::Added
    } else if x == 'D' || y == 'D' {
        GitFileKind::Deleted
    } else {
        GitFileKind::Modified
    }
}

fn empty_status() -> GitStatus {
    GitStatus {
        branch: String::new(),
        detached: false,
        head: None,
        upstream: None,
        ahead: 0,
        behind: 0,
        files: Vec::new(),
        clean: true,
        operation: None,
    }
}

/// `git status --porcelain=v2 --branch -z` çıktısını ayrıştırır.
///
/// Kayıtlar NUL ile ayrılır. `2` (rename/copy) kaydından sonra gelen NUL
/// alanı **origPath**'tir; ayrı bir kayıt değildir.
fn parse_porcelain_v2(raw: &str) -> GitStatus {
    let mut st = empty_status();
    let fields: Vec<&str> = raw.split('\0').collect();
    let mut i = 0;
    while i < fields.len() {
        let line = fields[i];
        i += 1;
        if line.is_empty() {
            continue;
        }
        if let Some(header) = line.strip_prefix("# ") {
            let mut parts = header.splitn(3, ' ');
            let key = parts.next().unwrap_or("");
            let value = parts.next().unwrap_or("");
            let rest = parts.next();
            match key {
                "branch.oid" => {
                    st.head = if value.starts_with('(') || value.is_empty() {
                        None
                    } else {
                        Some(value.to_string())
                    };
                }
                "branch.head" => {
                    if value == "(detached)" {
                        st.detached = true;
                        st.branch = "HEAD".to_string();
                    } else {
                        st.branch = value.to_string();
                    }
                }
                "branch.upstream" => st.upstream = Some(value.to_string()),
                "branch.ab" => {
                    let text = match rest {
                        Some(r) => format!("{value} {r}"),
                        None => value.to_string(),
                    };
                    let (a, b) = parse_ab(&text);
                    st.ahead = a;
                    st.behind = b;
                }
                _ => {}
            }
            continue;
        }

        let entry = match line.chars().next() {
            Some('1') => {
                let parts: Vec<&str> = line.splitn(9, ' ').collect();
                if parts.len() < 9 {
                    continue;
                }
                let xy = parts[1];
                let path = parts[8].to_string();
                let x = xy.chars().next().unwrap_or('.').to_string();
                let y = xy.chars().nth(1).unwrap_or('.').to_string();
                GitFile {
                    path,
                    orig_path: None,
                    staged: x != "." && x != " ",
                    unstaged: y != "." && y != " ",
                    index_status: x,
                    worktree_status: y,
                    kind: GitFileKind::Modified,
                }
            }
            Some('2') => {
                let parts: Vec<&str> = line.splitn(10, ' ').collect();
                if parts.len() < 10 {
                    continue;
                }
                let xy = parts[1];
                let path = parts[9].to_string();
                let orig = fields.get(i).map(|s| (*s).to_string());
                if orig.is_some() {
                    i += 1;
                }
                let x = xy.chars().next().unwrap_or('.').to_string();
                let y = xy.chars().nth(1).unwrap_or('.').to_string();
                GitFile {
                    path,
                    orig_path: orig.filter(|s| !s.is_empty()),
                    staged: x != "." && x != " ",
                    unstaged: y != "." && y != " ",
                    index_status: x,
                    worktree_status: y,
                    kind: GitFileKind::Renamed,
                }
            }
            Some('u') => {
                // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
                let parts: Vec<&str> = line.splitn(11, ' ').collect();
                if parts.len() < 11 {
                    continue;
                }
                let xy = parts[1];
                let path = parts[10].to_string();
                let x = xy.chars().next().unwrap_or('U').to_string();
                let y = xy.chars().nth(1).unwrap_or('U').to_string();
                GitFile {
                    path,
                    orig_path: None,
                    staged: false,
                    unstaged: true,
                    index_status: x,
                    worktree_status: y,
                    kind: GitFileKind::Conflicted,
                }
            }
            Some('?') => {
                let path = line.get(2..).unwrap_or("").to_string();
                GitFile {
                    path,
                    orig_path: None,
                    staged: false,
                    unstaged: true,
                    index_status: "?".into(),
                    worktree_status: "?".into(),
                    kind: GitFileKind::Untracked,
                }
            }
            Some('!') => continue, // ignored: UI'da gösterilmez
            _ => continue,
        };

        // `1` ve `u` için tür XY'den, `?`/`2` yukarıda belirlendi.
        let entry = if entry.kind == GitFileKind::Modified {
            GitFile {
                kind: kind_of(
                    &format!("{}{}", entry.index_status, entry.worktree_status),
                    false,
                    false,
                ),
                ..entry
            }
        } else {
            entry
        };
        st.files.push(entry);
    }
    st.clean = st.files.is_empty();
    st
}

/* ─────────────────────────── Doğrulama ─────────────────────────── */

/// Repo-göreli yol doğrulaması. Git'e **her zaman** `--` sonrası verilir.
fn validate_repo_path(raw: &str) -> Result<String, GitError> {
    let p = raw.replace('\\', "/");
    if p.is_empty() {
        return Err(ge("E_INVALID_PATH", "boş dosya yolu"));
    }
    if p.len() > 4096 {
        return Err(ge("E_INVALID_PATH", "dosya yolu çok uzun"));
    }
    for ch in p.chars() {
        if ch == '\0' || ch == '\n' || ch == '\r' {
            return Err(ge("E_INVALID_PATH", "dosya yolunda kontrol karakteri"));
        }
    }
    if p.starts_with('-') {
        return Err(ge("E_INVALID_PATH", "yol '-' ile başlayamaz"));
    }
    if p.contains(':') {
        return Err(ge("E_INVALID_PATH", "yol ':' içeremez (pathspec magic)"));
    }
    // Mutlak yol, baştaki '/' kırpılmadan ÖNCE denetlenir.
    if Path::new(&p).is_absolute() || p.starts_with("//") {
        return Err(ge(
            "E_INVALID_PATH",
            "mutlak yol yasak · repo-göreli yol kullan",
        ));
    }
    let p = p.trim_matches('/');
    if p.is_empty() {
        return Err(ge("E_INVALID_PATH", "boş dosya yolu"));
    }
    let mut has_component = false;
    for comp in Path::new(&p).components() {
        match comp {
            Component::ParentDir => {
                return Err(ge("E_INVALID_PATH", "repo dışına çıkılamaz (../ yasak)"))
            }
            Component::Normal(seg) => {
                let seg = seg.to_string_lossy();
                if seg.is_empty() || seg == "." {
                    continue;
                }
                if fs::is_blocked_dir(&seg) {
                    return Err(ge("E_INVALID_PATH", format!("yasaklı dizin: {seg}")));
                }
                if fs::is_blocked_file_name(&seg) || fs::is_env_prefixed(&seg) {
                    return Err(ge("E_INVALID_PATH", format!("yasaklı dosya: {seg}")));
                }
                if fs::is_blocked_name_ext(&seg) {
                    return Err(ge(
                        "E_INVALID_PATH",
                        format!("yasaklı dosya uzantısı: {seg}"),
                    ));
                }
                has_component = true;
            }
            Component::CurDir => {}
            _ => return Err(ge("E_INVALID_PATH", "geçersiz yol bileşeni")),
        }
    }
    if !has_component {
        return Err(ge("E_INVALID_PATH", "boş dosya yolu"));
    }
    Ok(p.to_string())
}

fn validate_paths(paths: &[String]) -> Result<Vec<String>, GitError> {
    if paths.is_empty() {
        return Err(ge("E_INVALID_PATH", "en az bir dosya yolu gerekli"));
    }
    if paths.len() > MAX_PATHS {
        return Err(ge(
            "E_INVALID_PATH",
            format!("tek işlemde en fazla {MAX_PATHS} dosya"),
        ));
    }
    paths.iter().map(|p| validate_repo_path(p)).collect()
}

fn quick_branch_check(name: &str) -> Result<(), GitError> {
    if name.is_empty() || name.len() > 255 {
        return Err(ge("E_INVALID_BRANCH", "geçersiz branch adı"));
    }
    if name.starts_with('-') || name.starts_with('/') || name.ends_with('/') {
        return Err(ge(
            "E_INVALID_BRANCH",
            "branch adı '-' veya '/' ile başlayamaz/bitemez",
        ));
    }
    if name.ends_with('.') || name.ends_with(".lock") || name.contains("..") || name.contains("@{")
    {
        return Err(ge("E_INVALID_BRANCH", "geçersiz branch adı"));
    }
    for ch in name.chars() {
        if ch.is_control() || ch == ' ' || matches!(ch, '~' | '^' | ':' | '?' | '*' | '[' | '\\') {
            return Err(ge("E_INVALID_BRANCH", "branch adında yasak karakter"));
        }
    }
    if name.contains("//") {
        return Err(ge("E_INVALID_BRANCH", "branch adında '//' olamaz"));
    }
    Ok(())
}

async fn validate_branch(root: &Path, name: &str) -> Result<(), GitError> {
    quick_branch_check(name)?;
    let out = run_git(
        root,
        &["check-ref-format", "--branch", name],
        None,
        GitOpts::default(),
    )
    .await?;
    if !out.ok() {
        return Err(ge(
            "E_INVALID_BRANCH",
            format!("geçersiz branch adı: {name}"),
        ));
    }
    Ok(())
}

fn validate_message(msg: &str) -> Result<String, GitError> {
    let trimmed = msg.trim();
    if trimmed.is_empty() {
        return Err(ge("E_INVALID_MESSAGE", "commit mesajı boş olamaz"));
    }
    if trimmed.chars().count() > MAX_MESSAGE_CHARS {
        return Err(ge(
            "E_INVALID_MESSAGE",
            format!("commit mesajı en fazla {MAX_MESSAGE_CHARS} karakter"),
        ));
    }
    if trimmed.contains('\0') {
        return Err(ge("E_INVALID_MESSAGE", "commit mesajında NUL olamaz"));
    }
    Ok(trimmed.to_string())
}

fn validate_sha(sha: &str) -> Result<(), GitError> {
    if sha.len() < 4 || sha.len() > 40 || !sha.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(ge("E_INVALID_SHA", "geçersiz commit SHA"));
    }
    Ok(())
}

/* ─────────────────────────── Sorgular ─────────────────────────── */

async fn detect_info(root: &str) -> Result<GitRepoInfo, GitError> {
    let ws = canonical_workspace(root)?;

    let version = match run_git(&ws, &["--version"], None, GitOpts::default()).await {
        Ok(o) if o.ok() => Some(o.stdout.trim().to_string()),
        Ok(_) => None,
        Err(e) if e.code == "E_GIT_MISSING" => {
            return Ok(GitRepoInfo {
                installed: false,
                version: None,
                is_repo: false,
                repo_root: None,
                bare: false,
                branch: None,
                detached: false,
                head: None,
                upstream: None,
                ahead: 0,
                behind: 0,
                operation: None,
                outside_repo: false,
            });
        }
        Err(_) => None,
    };

    let strict = rev_parse_toplevel(&ws, true).await?;
    let (repo_root, outside) = match strict {
        Some(r) if r == ws => (Some(r), false),
        Some(r) => (Some(r), true),
        None => match rev_parse_toplevel(&ws, false).await? {
            Some(r) if r == ws => (Some(r), false),
            Some(r) => (Some(r), true),
            None => (None, false),
        },
    };

    let is_repo = !outside && repo_root.is_some();
    let bare = if is_repo {
        run_git(
            &ws,
            &["rev-parse", "--is-bare-repository"],
            None,
            GitOpts::default(),
        )
        .await
        .ok()
        .map(|o| o.stdout.trim() == "true")
        .unwrap_or(false)
    } else {
        false
    };

    let mut info = GitRepoInfo {
        installed: true,
        version,
        is_repo,
        repo_root: repo_root.map(|p| p.to_string_lossy().into_owned()),
        bare,
        branch: None,
        detached: false,
        head: None,
        upstream: None,
        ahead: 0,
        behind: 0,
        operation: None,
        outside_repo: outside,
    };

    if is_repo {
        if let Ok(st) = status_of(&ws).await {
            info.branch = Some(st.branch.clone());
            info.detached = st.detached;
            info.head = st.head;
            info.upstream = st.upstream;
            info.ahead = st.ahead;
            info.behind = st.behind;
            info.operation = st.operation;
        }
    }
    Ok(info)
}

async fn status_of(root: &Path) -> Result<GitStatus, GitError> {
    let out = run_ok(
        run_git(
            root,
            &["status", "--porcelain=v2", "--branch", "-z"],
            None,
            GitOpts::default(),
        )
        .await?,
    )?;
    let mut st = parse_porcelain_v2(&out.stdout);
    st.operation = git_dir(root).await.as_deref().and_then(detect_operation);
    Ok(st)
}

#[tauri::command]
pub async fn git_detect(root: String) -> Result<GitRepoInfo, GitError> {
    detect_info(&root).await
}

#[tauri::command]
pub async fn git_status(root: String) -> Result<GitStatus, GitError> {
    let ws = ensure_repo(&root).await?;
    status_of(&ws).await
}

#[tauri::command]
pub async fn git_diff(
    root: String,
    path: Option<String>,
    staged: Option<bool>,
    context_lines: Option<u32>,
) -> Result<GitDiff, GitError> {
    let ws = ensure_repo(&root).await?;
    let staged = staged.unwrap_or(false);
    let ctx = context_lines.unwrap_or(3).min(MAX_DIFF_CONTEXT);
    let rel = match path.as_deref() {
        Some(p) => Some(validate_repo_path(p)?),
        None => None,
    };

    let mut args: Vec<String> = vec![
        "diff".into(),
        "--no-color".into(),
        "--no-ext-diff".into(),
        "--no-textconv".into(),
        format!("-U{ctx}"),
    ];
    if staged {
        args.push("--staged".into());
    }
    if let Some(p) = &rel {
        args.push("--".into());
        args.push(p.clone());
    }
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let out = run_ok(run_git(&ws, &arg_refs, None, GitOpts::default()).await?)?;

    let mut text = out.stdout;
    let mut untracked = false;

    // Untracked dosya: git diff boş döner → güvenli (jail'li) sentetik diff.
    if text.is_empty() && !staged {
        if let Some(p) = &rel {
            let tracked = run_git(
                &ws,
                &["ls-files", "--error-unmatch", "--", p],
                None,
                GitOpts::default(),
            )
            .await
            .map(|o| o.ok())
            .unwrap_or(false);
            if !tracked {
                if let Ok(abs) = fs::resolve_rooted(&ws.to_string_lossy(), p) {
                    if abs.is_file() {
                        if let Ok(bytes) = std::fs::read(&abs) {
                            let truncated = bytes.len() > 256 * 1024;
                            let slice = &bytes[..bytes.len().min(256 * 1024)];
                            if slice.contains(&0) {
                                text = format!("Binary file {p} (yeni dosya)\n");
                            } else {
                                let body = String::from_utf8_lossy(slice);
                                // `str::lines` son satırı (trailing newline olsa da) doğru sayar.
                                let lines = body.lines().count();
                                let mut s = format!(
                                    "diff --git a/{p} b/{p}\nnew file mode 100644\n--- /dev/null\n+++ b/{p}\n"
                                );
                                if lines > 0 {
                                    s.push_str(&format!("@@ -0,0 +1,{lines} @@\n"));
                                    for line in body.split_inclusive('\n') {
                                        let line = line.trim_end_matches('\n');
                                        s.push('+');
                                        s.push_str(line);
                                        s.push('\n');
                                    }
                                }
                                text = s;
                            }
                            untracked = true;
                            return Ok(GitDiff {
                                path: rel,
                                staged,
                                binary: text.starts_with("Binary file"),
                                text,
                                truncated,
                                untracked,
                            });
                        }
                    }
                }
            }
        }
    }

    let binary = text.contains("Binary files ") || text.contains("GIT binary patch");
    Ok(GitDiff {
        path: rel,
        staged,
        text,
        binary,
        truncated: out.truncated,
        untracked,
    })
}

async fn log_of(root: &Path, limit: usize, skip: usize) -> Result<Vec<GitCommit>, GitError> {
    let format = "%H%x1f%h%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%b%x1e";
    let max = format!("--max-count={limit}");
    let skip_arg = format!("--skip={skip}");
    let out = run_git(
        root,
        &[
            "log",
            "--no-color",
            "--no-show-signature",
            &max,
            &skip_arg,
            &format!("--format={format}"),
        ],
        None,
        GitOpts::default(),
    )
    .await?;
    if !out.ok() {
        // Henüz commit'i olmayan repo: tarihçe boş kabul edilir.
        let lower = out.stderr.to_lowercase();
        if lower.contains("does not have any commits yet")
            || lower.contains("your current branch")
            || lower.contains("bad default revision")
        {
            return Ok(Vec::new());
        }
        return Err(fail(&out));
    }
    let mut commits = Vec::new();
    for rec in out.stdout.split('\x1e') {
        let rec = rec.trim_matches('\n');
        if rec.is_empty() {
            continue;
        }
        let f: Vec<&str> = rec.splitn(7, '\x1f').collect();
        if f.len() < 7 {
            continue;
        }
        commits.push(GitCommit {
            sha: f[0].to_string(),
            short: f[1].to_string(),
            author: f[2].to_string(),
            email: f[3].to_string(),
            timestamp: f[4].parse().unwrap_or(0),
            subject: f[5].to_string(),
            body: f[6].trim().to_string(),
        });
    }
    Ok(commits)
}

#[tauri::command]
pub async fn git_log(
    root: String,
    limit: Option<u32>,
    skip: Option<u32>,
) -> Result<Vec<GitCommit>, GitError> {
    let ws = ensure_repo(&root).await?;
    let limit = limit.unwrap_or(30).clamp(1, 100) as usize;
    let skip = skip.unwrap_or(0) as usize;
    log_of(&ws, limit, skip).await
}

#[tauri::command]
pub async fn git_show(root: String, sha: String) -> Result<GitCommitDetail, GitError> {
    let ws = ensure_repo(&root).await?;
    validate_sha(&sha)?;
    let out = run_ok(
        run_git(
            &ws,
            &[
                "show",
                "--no-color",
                "--no-ext-diff",
                "--no-textconv",
                "--stat",
                "--patch",
                &sha,
            ],
            None,
            GitOpts::default(),
        )
        .await?,
    )?;
    Ok(GitCommitDetail {
        sha,
        text: out.stdout,
        truncated: out.truncated,
    })
}

#[tauri::command]
pub async fn git_branches(root: String) -> Result<Vec<GitBranch>, GitError> {
    let ws = ensure_repo(&root).await?;
    let fmt =
        "%(refname:short)%x1f%(refname)%x1f%(objectname:short)%x1f%(upstream:short)%x1f%(HEAD)%x1e";
    let out = run_ok(
        run_git(
            &ws,
            &[
                "for-each-ref",
                &format!("--format={fmt}"),
                "refs/heads",
                "refs/remotes",
            ],
            None,
            GitOpts::default(),
        )
        .await?,
    )?;
    let mut list = Vec::new();
    for rec in out.stdout.split('\x1e') {
        let rec = rec.trim_matches('\n');
        if rec.is_empty() {
            continue;
        }
        let f: Vec<&str> = rec.splitn(5, '\x1f').collect();
        if f.len() < 5 {
            continue;
        }
        let full = f[1];
        if full.ends_with("/HEAD") {
            continue;
        }
        list.push(GitBranch {
            name: f[0].to_string(),
            full: full.to_string(),
            sha: f[2].to_string(),
            upstream: if f[3].is_empty() {
                None
            } else {
                Some(f[3].to_string())
            },
            current: f[4] == "*",
            remote: full.starts_with("refs/remotes/"),
        });
    }
    list.sort_by(|a, b| {
        b.current
            .cmp(&a.current)
            .then(a.remote.cmp(&b.remote))
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(list)
}

#[tauri::command]
pub async fn git_remotes(root: String) -> Result<Vec<GitRemote>, GitError> {
    let ws = ensure_repo(&root).await?;
    let out = run_ok(run_git(&ws, &["remote", "-v"], None, GitOpts::default()).await?)?;
    let mut map: Vec<GitRemote> = Vec::new();
    for line in out.stdout.lines() {
        let mut it = line.split_whitespace();
        let Some(name) = it.next() else { continue };
        let Some(url) = it.next() else { continue };
        let Some(kind) = it.next() else { continue };
        if kind != "(fetch)" {
            continue;
        }
        if !map.iter().any(|r| r.name == name) {
            map.push(GitRemote {
                name: name.to_string(),
                url: url.to_string(),
            });
        }
    }
    Ok(map)
}

/* ─────────────────────────── Mutasyonlar ─────────────────────────── */

/// Klasör pathspec'i verildiğinde içindeki dosyaları denetler.
///
/// `git add -- klasör` tek tek dosya doğrulamasını atlayarak klasör içindeki
/// `.env`/`*.pem` gibi dosyaları stage edebilirdi. Burada `git ls-files` ile
/// (tracked + untracked, ignore hariç) genişletip her yolu doğrularız.
async fn ensure_no_secret_inside_dirs(ws: &Path, paths: &[String]) -> Result<(), GitError> {
    for p in paths {
        if !ws.join(p).is_dir() {
            continue;
        }
        let out = run_ok(
            run_git(
                ws,
                &[
                    "ls-files",
                    "-z",
                    "--cached",
                    "--others",
                    "--exclude-standard",
                    "--",
                    p,
                ],
                None,
                GitOpts::default(),
            )
            .await?,
        )?;
        for entry in out.stdout.split('\0') {
            if entry.is_empty() {
                continue;
            }
            if let Err(e) = validate_repo_path(entry) {
                return Err(ge(
                    "E_INVALID_PATH",
                    format!("klasörde yasaklı dosya var ({entry}): {}", e.message),
                ));
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn git_stage(root: String, paths: Vec<String>) -> Result<GitStatus, GitError> {
    let ws = ensure_repo(&root).await?;
    let paths = validate_paths(&paths)?;
    ensure_no_secret_inside_dirs(&ws, &paths).await?;
    let mut args = vec!["add".to_string(), "--".to_string()];
    args.extend(paths);
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_ok(run_git(&ws, &refs, None, GitOpts::write()).await?)?;
    status_of(&ws).await
}

#[tauri::command]
pub async fn git_unstage(root: String, paths: Vec<String>) -> Result<GitStatus, GitError> {
    let ws = ensure_repo(&root).await?;
    let paths = validate_paths(&paths)?;
    let has_head = run_git(
        &ws,
        &["rev-parse", "--verify", "--quiet", "HEAD"],
        None,
        GitOpts::default(),
    )
    .await
    .map(|o| o.ok())
    .unwrap_or(false);

    let mut args: Vec<String> = if has_head {
        // `reset --` her git sürümünde vardır; `restore --staged` (2.23+)
        // yerine kullanılır ve rename'lerde origPath de aynı çağrıda çözülür.
        vec!["reset".into(), "--quiet".into(), "--".into()]
    } else {
        vec!["rm".into(), "--cached".into(), "--".into()]
    };
    args.extend(paths);
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_ok(run_git(&ws, &refs, None, GitOpts::write()).await?)?;
    status_of(&ws).await
}

#[tauri::command]
pub async fn git_discard(root: String, paths: Vec<String>) -> Result<GitStatus, GitError> {
    let ws = ensure_repo(&root).await?;
    let paths = validate_paths(&paths)?;
    let st = status_of(&ws).await?;
    for p in &paths {
        let entry = st.files.iter().find(|f| &f.path == p);
        match entry {
            None => {
                return Err(ge(
                    "E_INVALID_PATH",
                    format!("dosya değişiklik listesinde yok: {p}"),
                ))
            }
            Some(f) if f.kind == GitFileKind::Untracked => {
                return Err(ge(
                    "E_UNTRACKED_DISCARD",
                    format!("izlenmeyen dosya uygulamadan silinmez: {p} · elle sil"),
                ))
            }
            Some(f) if f.kind == GitFileKind::Conflicted => {
                return Err(ge(
                    "E_CONFLICT",
                    format!("çakışan dosya geri alınamaz: {p} · önce çakışmayı çöz"),
                ))
            }
            Some(_) => {}
        }
    }
    let mut args = vec![
        "restore".to_string(),
        "--worktree".to_string(),
        "--".to_string(),
    ];
    args.extend(paths);
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let out = run_git(&ws, &refs, None, GitOpts::write()).await?;
    if !out.ok() {
        // Eski git (<2.23) `restore` bilmez → checkout'a düş.
        let lower = out.stderr.to_lowercase();
        if lower.contains("not a git command") || lower.contains("'restore' is not") {
            let mut fallback = vec!["checkout".to_string(), "--".to_string()];
            fallback.extend(args.iter().skip(3).cloned());
            let frefs: Vec<&str> = fallback.iter().map(|s| s.as_str()).collect();
            run_ok(run_git(&ws, &frefs, None, GitOpts::write()).await?)?;
        } else {
            return Err(fail(&out));
        }
    }
    status_of(&ws).await
}

#[tauri::command]
pub async fn git_commit(
    root: String,
    message: String,
    amend: Option<bool>,
) -> Result<GitCommit, GitError> {
    let ws = ensure_repo(&root).await?;
    let msg = validate_message(&message)?;
    let amend = amend.unwrap_or(false);
    let st = status_of(&ws).await?;

    if st.files.iter().any(|f| f.kind == GitFileKind::Conflicted) {
        return Err(ge(
            "E_CONFLICT",
            "çakışan dosyalar var · önce çakışmayı çöz ve stage et",
        ));
    }
    let staged = st.files.iter().any(|f| f.staged);
    if !staged {
        // Amend, yalnızca mesajı düzeltmek için de yapılabilir; yine de HEAD şart.
        let has_head = amend
            && run_git(
                &ws,
                &["rev-parse", "--verify", "--quiet", "HEAD"],
                None,
                GitOpts::default(),
            )
            .await
            .map(|o| o.ok())
            .unwrap_or(false);
        if !has_head {
            return Err(ge(
                "E_NOTHING_STAGED",
                "commit için stage edilmiş değişiklik yok",
            ));
        }
    }

    let mut args: Vec<&str> = vec!["commit", "-F", "-"];
    if amend {
        args.push("--amend");
    }
    let out = run_git(&ws, &args, Some(&msg), GitOpts::write()).await?;
    if !out.ok() {
        let lower = out.stderr.to_lowercase();
        let code = if lower.contains("hook") && (lower.contains("fail") || lower.contains("exit")) {
            "E_HOOK_FAILED"
        } else {
            "E_GIT_FAILED"
        };
        let detail = if out.stderr.trim().is_empty() {
            out.stdout.trim().to_string()
        } else {
            out.stderr.trim().to_string()
        };
        return Err(ge(code, detail));
    }

    let short = run_git(
        &ws,
        &["rev-parse", "--short", "HEAD"],
        None,
        GitOpts::default(),
    )
    .await
    .ok()
    .filter(|o| o.ok())
    .map(|o| o.stdout.trim().to_string())
    .unwrap_or_default();
    let sha = run_git(&ws, &["rev-parse", "HEAD"], None, GitOpts::default())
        .await
        .ok()
        .filter(|o| o.ok())
        .map(|o| o.stdout.trim().to_string())
        .unwrap_or_default();

    let commits = log_of(&ws, 1, 0).await.unwrap_or_default();
    if let Some(c) = commits.into_iter().next() {
        return Ok(c);
    }
    Ok(GitCommit {
        sha,
        short,
        author: String::new(),
        email: String::new(),
        timestamp: 0,
        subject: msg.lines().next().unwrap_or("").to_string(),
        body: String::new(),
    })
}

#[tauri::command]
pub async fn git_switch(
    root: String,
    branch: String,
    create: Option<bool>,
) -> Result<GitStatus, GitError> {
    let ws = ensure_repo(&root).await?;
    validate_branch(&ws, &branch).await?;
    let create = create.unwrap_or(false);
    let args: Vec<&str> = if create {
        vec!["switch", "-c", &branch]
    } else {
        vec!["switch", &branch]
    };
    let out = run_git(&ws, &args, None, GitOpts::write()).await?;
    if !out.ok() {
        // Eski git (<2.23) `switch` bilmez → checkout'a düş.
        let lower = out.stderr.to_lowercase();
        if lower.contains("not a git command") || lower.contains("'switch' is not") {
            let fallback: Vec<&str> = if create {
                vec!["checkout", "-b", &branch]
            } else {
                vec!["checkout", &branch]
            };
            run_ok(run_git(&ws, &fallback, None, GitOpts::write()).await?)?;
        } else {
            return Err(fail(&out));
        }
    }
    status_of(&ws).await
}

async fn remotes_of(root: &Path) -> Result<Vec<GitRemote>, GitError> {
    let out = run_ok(run_git(root, &["remote", "-v"], None, GitOpts::default()).await?)?;
    let mut list: Vec<GitRemote> = Vec::new();
    for line in out.stdout.lines() {
        let mut it = line.split_whitespace();
        let Some(name) = it.next() else { continue };
        let Some(url) = it.next() else { continue };
        let Some(kind) = it.next() else { continue };
        if kind != "(fetch)" {
            continue;
        }
        if !list.iter().any(|r| r.name == name) {
            list.push(GitRemote {
                name: name.to_string(),
                url: url.to_string(),
            });
        }
    }
    Ok(list)
}

fn map_network_error(out: &GitOutput) -> GitError {
    let lower = out.stderr.to_lowercase();
    if lower.contains("authentication failed")
        || lower.contains("could not read username")
        || lower.contains("could not read password")
        || lower.contains("permission denied (publickey)")
        || lower.contains("terminal prompts disabled")
        || lower.contains("askpass")
    {
        return ge(
            "E_AUTH_REQUIRED",
            "kimlik doğrulama gerekli · terminalde `git push`/`git fetch` çalıştır veya credential helper yapılandır",
        );
    }
    if lower.contains("not possible to fast-forward")
        || lower.contains("not a fast-forward")
        || lower.contains("non-fast-forward")
        || lower.contains("fetch first")
        || lower.contains("would be overwritten")
    {
        return ge(
            "E_NOT_FAST_FORWARD",
            "hızlı ilerleme mümkün değil · manuel merge/rebase gerekli",
        );
    }
    if lower.contains("no tracking information")
        || lower.contains("no upstream configured")
        || lower.contains("has no upstream branch")
    {
        return ge("E_NO_UPSTREAM", "branch'ın upstream'i yok");
    }
    fail(out)
}

#[tauri::command]
pub async fn git_fetch(root: String) -> Result<GitStatus, GitError> {
    let ws = ensure_repo(&root).await?;
    if remotes_of(&ws).await?.is_empty() {
        return Err(ge("E_NO_REMOTE", "tanımlı git remote yok"));
    }
    let out = run_git(
        &ws,
        &["fetch", "--all", "--prune"],
        None,
        GitOpts::network(),
    )
    .await?;
    if !out.ok() {
        return Err(map_network_error(&out));
    }
    status_of(&ws).await
}

#[tauri::command]
pub async fn git_pull(root: String) -> Result<GitStatus, GitError> {
    let ws = ensure_repo(&root).await?;
    if remotes_of(&ws).await?.is_empty() {
        return Err(ge("E_NO_REMOTE", "tanımlı git remote yok"));
    }
    let out = run_git(&ws, &["pull", "--ff-only"], None, GitOpts::network()).await?;
    if !out.ok() {
        return Err(map_network_error(&out));
    }
    status_of(&ws).await
}

#[tauri::command]
pub async fn git_push(root: String, set_upstream: Option<bool>) -> Result<GitStatus, GitError> {
    let ws = ensure_repo(&root).await?;
    let remotes = remotes_of(&ws).await?;
    if remotes.is_empty() {
        return Err(ge("E_NO_REMOTE", "tanımlı git remote yok"));
    }

    let upstream = run_git(
        &ws,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
        None,
        GitOpts::default(),
    )
    .await
    .ok()
    .filter(|o| o.ok())
    .map(|o| o.stdout.trim().to_string())
    .filter(|s| !s.is_empty());

    let mut args: Vec<String> = vec!["push".into()];
    if upstream.is_none() || set_upstream.unwrap_or(false) {
        let branch = run_git(
            &ws,
            &["symbolic-ref", "--short", "HEAD"],
            None,
            GitOpts::default(),
        )
        .await
        .ok()
        .filter(|o| o.ok())
        .map(|o| o.stdout.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            ge(
                "E_DETACHED",
                "detached HEAD'de push edilemez · önce bir branch'e geç",
            )
        })?;
        let remote = remotes
            .iter()
            .find(|r| r.name == "origin")
            .map(|r| r.name.clone())
            .unwrap_or_else(|| remotes[0].name.clone());
        args.push("-u".into());
        args.push(remote);
        args.push(branch);
    }
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let out = run_git(&ws, &refs, None, GitOpts::network()).await?;
    if !out.ok() {
        return Err(map_network_error(&out));
    }
    status_of(&ws).await
}

#[tauri::command]
pub async fn git_init(root: String) -> Result<GitRepoInfo, GitError> {
    let ws = canonical_workspace(&root)?;
    if rev_parse_toplevel(&ws, true).await?.is_some() {
        return detect_info(&root).await;
    }
    // Üst dizinde repo varsa iç içe repo oluşturma (workspace read-only kalır).
    if rev_parse_toplevel(&ws, false).await?.is_some() {
        return Err(err_outside_repo());
    }
    let out = run_git(&ws, &["init"], None, GitOpts::write()).await?;
    if !out.ok() {
        return Err(fail(&out));
    }
    detect_info(&root).await
}

/* ─────────────────────────── Testler ─────────────────────────── */

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(parts: &[&str]) -> String {
        let mut s = String::new();
        for p in parts {
            s.push_str(p);
            s.push('\0');
        }
        s
    }

    #[test]
    fn porcelain_clean() {
        let st = parse_porcelain_v2(&raw(&[
            "# branch.oid abc123",
            "# branch.head main",
            "# branch.upstream origin/main",
            "# branch.ab +2 -3",
        ]));
        assert_eq!(st.branch, "main");
        assert_eq!(st.head.as_deref(), Some("abc123"));
        assert_eq!(st.upstream.as_deref(), Some("origin/main"));
        assert_eq!((st.ahead, st.behind), (2, 3));
        assert!(st.clean);
        assert!(!st.detached);
    }

    #[test]
    fn porcelain_detached() {
        let st = parse_porcelain_v2(&raw(&["# branch.oid deadbeef", "# branch.head (detached)"]));
        assert!(st.detached);
        assert_eq!(st.branch, "HEAD");
    }

    #[test]
    fn porcelain_initial_repo() {
        let st = parse_porcelain_v2(&raw(&["# branch.oid (initial)", "# branch.head main"]));
        assert_eq!(st.head, None);
        assert_eq!(st.branch, "main");
    }

    #[test]
    fn porcelain_modified_staged_and_unstaged() {
        let st = parse_porcelain_v2(&raw(&[
            "# branch.head main",
            "1 M. N... 100644 100644 100644 aaa bbb src/app.ts",
            "1 .M N... 100644 100644 100644 aaa aaa src/lib/x.ts",
        ]));
        assert_eq!(st.files.len(), 2);
        let a = &st.files[0];
        assert_eq!(a.path, "src/app.ts");
        assert!(a.staged && !a.unstaged);
        assert_eq!(a.kind, GitFileKind::Modified);
        let b = &st.files[1];
        assert!(!b.staged && b.unstaged);
    }

    #[test]
    fn porcelain_untracked_with_spaces_and_unicode() {
        let st = parse_porcelain_v2(&raw(&[
            "# branch.head main",
            "? foo bar/İstanbul dosya.txt",
        ]));
        assert_eq!(st.files.len(), 1);
        assert_eq!(st.files[0].path, "foo bar/İstanbul dosya.txt");
        assert_eq!(st.files[0].kind, GitFileKind::Untracked);
    }

    #[test]
    fn porcelain_rename_consumes_orig_path() {
        let st = parse_porcelain_v2(&raw(&[
            "# branch.head main",
            "2 R. N... 100644 100644 100644 aaa bbb R100 yeni ad.txt",
            "eski ad.txt",
            "? sonraki.txt",
        ]));
        assert_eq!(st.files.len(), 2);
        assert_eq!(st.files[0].path, "yeni ad.txt");
        assert_eq!(st.files[0].orig_path.as_deref(), Some("eski ad.txt"));
        assert_eq!(st.files[0].kind, GitFileKind::Renamed);
        assert_eq!(st.files[1].path, "sonraki.txt");
    }

    #[test]
    fn porcelain_conflict() {
        let st = parse_porcelain_v2(&raw(&[
            "# branch.head main",
            "u UU N... 100644 100644 100644 100644 aaa bbb ccc catisma.txt",
        ]));
        assert_eq!(st.files.len(), 1);
        assert_eq!(st.files[0].kind, GitFileKind::Conflicted);
        assert!(st.files[0].unstaged);
    }

    #[test]
    fn path_validation_blocks_escapes_and_secrets() {
        assert!(validate_repo_path("src/app.ts").is_ok());
        assert!(validate_repo_path("src/foo bar/İstanbul.ts").is_ok());
        assert!(validate_repo_path("/etc/passwd").is_err());
        assert!(validate_repo_path("../disari.txt").is_err());
        assert!(validate_repo_path("src/../../x").is_err());
        assert!(validate_repo_path("-rf").is_err());
        assert!(validate_repo_path(":(top)x").is_err());
        assert!(validate_repo_path(".git/config").is_err());
        assert!(validate_repo_path(".env").is_err());
        assert!(validate_repo_path("keys/server.pem").is_err());
        assert!(validate_repo_path("a\nb").is_err());
        assert!(validate_repo_path("a\0b").is_err());
    }

    #[test]
    fn branch_validation_quick_checks() {
        assert!(quick_branch_check("feature/git-panel").is_ok());
        assert!(quick_branch_check("fix-1").is_ok());
        assert!(quick_branch_check("-x").is_err());
        assert!(quick_branch_check("a..b").is_err());
        assert!(quick_branch_check("a@{b}").is_err());
        assert!(quick_branch_check("a b").is_err());
        assert!(quick_branch_check("a.lock").is_err());
        assert!(quick_branch_check("a\\b").is_err());
        assert!(quick_branch_check("a:b").is_err());
        assert!(quick_branch_check("a//b").is_err());
    }

    #[test]
    fn message_validation() {
        assert!(validate_message("  fix: bir şey  ").is_ok());
        assert!(validate_message("   ").is_err());
        assert!(validate_message(&"a".repeat(MAX_MESSAGE_CHARS + 1)).is_err());
        assert!(validate_message("a\0b").is_err());
    }

    #[test]
    fn sha_validation() {
        assert!(validate_sha("deadbeef").is_ok());
        assert!(validate_sha("HEAD").is_err());
        assert!(validate_sha("--output=/tmp/x").is_err());
        assert!(validate_sha("abc").is_err());
    }

    #[test]
    fn operation_error_mapping() {
        let out = GitOutput {
            stdout: String::new(),
            stderr: "error: rebase in progress; onto abc123".to_string(),
            code: 128,
            truncated: false,
        };
        assert_eq!(fail(&out).code, "E_OPERATION_IN_PROGRESS");

        let out = GitOutput {
            stdout: String::new(),
            stderr: "error: cannot switch branch while merging".to_string(),
            code: 128,
            truncated: false,
        };
        assert_eq!(fail(&out).code, "E_OPERATION_IN_PROGRESS");

        let out = GitOutput {
            stdout: String::new(),
            stderr: "fatal: not a git repository".to_string(),
            code: 128,
            truncated: false,
        };
        assert_eq!(fail(&out).code, "E_GIT_FAILED");
    }
}
