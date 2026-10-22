use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};

const MAX_READ_BYTES: u64 = 64 * 1024;
const MAX_GREP_FILES: usize = 500;
const MAX_GREP_HITS: usize = 50;

/// Faz 10 (D2c) — blok listelerinin **tek kaynağı**: `src/lib/engine/blocks.json`.
/// TS tarafı (policy.ts, context.ts) aynı dosyayı import eder → iki tarafın
/// kayması (eski D2 bulgusu) imkânsız.
const BLOCKS_JSON: &str = include_str!("../../../src/lib/engine/blocks.json");

#[derive(Debug, serde::Deserialize, Default)]
pub(crate) struct Blocks {
    #[serde(default)]
    dirs: Vec<String>,
    #[serde(default)]
    files: Vec<String>,
    #[serde(rename = "secretExts", default)]
    secret_exts: Vec<String>,
    #[serde(rename = "dataExts", default)]
    data_exts: Vec<String>,
}

static BLOCKS: std::sync::OnceLock<Blocks> = std::sync::OnceLock::new();

/// Blok listeleri (dosya bozuksa boş liste → engelleme yok, ama hata loglanır).
pub(crate) fn blocks() -> &'static Blocks {
    BLOCKS.get_or_init(|| match serde_json::from_str(BLOCKS_JSON) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("[fs] blok listesi okunamadi ({e}) — guvenlik duvari devre disi");
            Blocks::default()
        }
    })
}

/// Y1 (Faz 2) `exec.rs` ile paylaşılır (dosya argümanı jail'i).
pub(crate) fn is_blocked_dir(name: &str) -> bool {
    blocks().dirs.iter().any(|d| d == name)
}

/// Y1 (Faz 2) `exec.rs` ile paylaşılır (dosya argümanı jail'i).
pub(crate) fn is_blocked_file_name(name: &str) -> bool {
    blocks().files.iter().any(|f| f == name)
}

/// Faz 10 (D2b): gizli/veri uzantıları (`.pem`, `.key`, `.db` …) **her** fs
/// aracında kapalıdır (eskiden yalnızca walk/glob'da uygulanıyordu).
pub(crate) fn is_blocked_ext(path: &std::path::Path) -> bool {
    let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
    is_blocked_name_ext(name)
}

/// O7 — **ad-bazlı** uzantı denetimi (exec.rs `check_file_arg` de bunu kullanır).
/// Düzeltmeler: (1) `.pem` tarzı **dotfile**'lar — Rust `Path::extension()`
/// bunlarda `None` döndürür, kaçabiliyorlardı (TS `isBlockedExt` yakalıyordu);
/// (2) `CERT.PEM` — büyük/küçük harf farkı kaçıyordu. Son `.` sonrasını uzantı
/// sayar; sonuç küçük harfe indirilip `blocks.json` listelerinde aranır.
pub(crate) fn is_blocked_name_ext(name: &str) -> bool {
    let Some(dot) = name.rfind('.') else {
        return false;
    };
    if dot == name.len() - 1 {
        return false; // "foo." → boş uzantı
    }
    let ext = name.split_at(dot + 1).1.to_ascii_lowercase();
    let b = blocks();
    b.secret_exts.iter().any(|e| e == &ext) || b.data_exts.iter().any(|e| e == &ext)
}

fn err(msg: impl Into<String>) -> String {
    msg.into()
}

/// `root` + `rel` birleşimini jail içinde çözer.
/// Mutlak path, `..` kaçışı ve bloklu dosyalar reddedilir.
pub fn resolve_rooted(root: &str, rel: &str) -> Result<PathBuf, String> {
    let rel = rel.trim().replace('\\', "/");
    if rel.is_empty() || rel == "." {
        return canonical_root(root);
    }
    let p = PathBuf::from(&rel);
    if p.is_absolute() {
        return Err(err("mutlak yol yasak · workspace-relative yol kullan"));
    }
    for c in p.components() {
        if matches!(c, Component::ParentDir) {
            return Err(err("root dışına çıkılamaz (../ yasak)"));
        }
    }
    // Y1 (Faz 2): bloklu dizinler YALNIZCA listeleme filtresi değildi — tüm bileşenler
    // her fs aracı için (okuma dahil) reddedilir. `.git/config` gibi token içeren
    // dosyalar otomatik onaylı `read_file`/`grep` ile okunamaz.
    for c in p.components() {
        if let Component::Normal(s) = c {
            if is_blocked_dir(&s.to_string_lossy()) {
                return Err(err(format!("yasaklı dizin: {}", s.to_string_lossy())));
            }
        }
    }
    let base = canonical_root(root)?;
    let joined = base.join(p);
    // Final hedef mevcutsa symlink'i çöz ve jail'i tekrar denetle
    // (yalnızca parent kontrolü final-component symlink kaçışını yakalamaz).
    let full = match joined.canonicalize() {
        Ok(canon) => {
            if !canon.starts_with(&base) {
                return Err(err("root dışına çıkılamaz"));
            }
            canon
        }
        Err(_) => {
            // Henüz var olmayan dosya (örn. yeni patch hedefi):
            // parent canonicalize edilir ve kontrol edilir.
            let parent = joined.parent().unwrap_or(&base);
            let canon_parent = parent
                .canonicalize()
                .map_err(|e| err(format!("dizin okunamadı: {e}")))?;
            if !canon_parent.starts_with(&base) {
                return Err(err("root dışına çıkılamaz"));
            }
            canon_parent.join(
                joined
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or_default(),
            )
        }
    };
    let file_name = full
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_owned();
    if is_blocked_file_name(&file_name) || file_name.starts_with(".env.") {
        return Err(err(format!("yasaklı dosya: {file_name}")));
    }
    // Faz 10 (D2b): gizli/veri uzantıları da her yolda kapalı.
    if is_blocked_ext(&full) {
        return Err(err(format!("yasaklı dosya uzantısı: {file_name}")));
    }
    Ok(full)
}

fn canonical_root(root: &str) -> Result<PathBuf, String> {
    let r = root.trim();
    if r.is_empty() {
        return Err(err("workspace root boş olamaz · /root ile seç"));
    }
    PathBuf::from(r)
        .canonicalize()
        .map_err(|e| err(format!("workspace kökü geçersiz: {e}")))
}

/// K1 (Faz 1) — manifest alanı `backup_file` **güvenilmez girdidir**: manifest
/// workspace içinde yaşar ve 3. taraf bir repo ile birlikte gelebilir.
/// Yalnızca tek bileşenli, `[A-Za-z0-9._-]` karakter setinde ad kabul edilir
/// (`..`, mutlak yol ve dizin ayracı reddedilir) — aksi halde `PathBuf::join`
/// mutlak tarafta tam yolu alır ve keyfi dosya silinip hedefe kopyalanabilir.
fn safe_backup_name(name: &str) -> Result<(), String> {
    let n = name.trim();
    if n.is_empty() || n == "." || n == ".." {
        return Err(err("yedek adı geçersiz"));
    }
    if n.contains('/') || n.contains('\\') {
        return Err(err("yedek adı geçersiz (yol içeremez)"));
    }
    if !n
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
    {
        return Err(err("yedek adı geçersiz karakterler içeriyor"));
    }
    Ok(())
}

/// K1 (Faz 1) — güvenilen yedek dosyasının son adımı: `backup_dir` ve dosyanın
/// canonical hali workspace altında olmalı (dosya adı güvenli olsa da
/// symlink dışarıyı gösterebilir).
fn resolve_backup_inside(
    root_canon: &Path,
    backup_dir: &Path,
    rel: &str,
) -> Result<PathBuf, String> {
    safe_backup_name(rel)?;
    let canon_dir = backup_dir
        .canonicalize()
        .map_err(|e| err(format!("yedek dizini okunamadı: {e}")))?;
    if !canon_dir.starts_with(root_canon) {
        return Err(err("yedek dizini workspace dışında"));
    }
    let candidate = canon_dir.join(rel.trim());
    match candidate.canonicalize() {
        Ok(canon) => {
            if !canon.starts_with(&canon_dir) {
                return Err(err("yedek dosyası yedek dizini dışında"));
            }
            Ok(canon)
        }
        // Dosya henüz yok: geri-alma zaten "bulunamadı" hatası verecek;
        // yine de aday yolu döndür ki varlık kontrolü şaşırtmasın.
        Err(_) => Ok(candidate),
    }
}

#[derive(Debug, Serialize)]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
}

#[tauri::command]
pub async fn list_dir(root: String, path: String) -> Result<Vec<DirEntry>, String> {
    let dir = resolve_rooted(&root, &path)?;
    let rd = std::fs::read_dir(&dir).map_err(|e| err(format!("dizin okunamadı: {e}")))?;
    let mut out = Vec::new();
    for e in rd {
        let e = e.map_err(|e| err(format!("girdi okunamadı: {e}")))?;
        let name = e.file_name().to_string_lossy().to_string();
        if name == ".DS_Store" {
            continue;
        }
        let ft = e
            .file_type()
            .map_err(|e| err(format!("tip okunamadı: {e}")))?;
        if ft.is_dir() && is_blocked_dir(&name) {
            continue;
        }
        out.push(DirEntry {
            name,
            is_dir: ft.is_dir(),
        });
    }
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });
    Ok(out)
}

#[derive(Debug, Serialize)]
pub struct ReadOut {
    pub content: String,
    pub truncated: bool,
}

#[tauri::command]
pub async fn read_file(
    root: String,
    path: String,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<ReadOut, String> {
    let full = resolve_rooted(&root, &path)?;
    let meta = std::fs::metadata(&full).map_err(|e| err(format!("dosya bulunamadı: {e}")))?;
    if meta.is_dir() {
        return Err(err("dizin okunamaz · list_dir kullan"));
    }
    if meta.len() > MAX_READ_BYTES * 4 {
        return Err(err("dosya çok büyük (256KB+)"));
    }
    let text = std::fs::read(&full).map_err(|e| err(format!("dosya okunamadı: {e}")))?;
    // Binary sezgisi: ilk 8KB içinde NUL varsa reddet.
    let head = &text[..text.len().min(8192)];
    if head.contains(&0) {
        return Err(err("binary dosya okunamaz"));
    }
    let content = String::from_utf8_lossy(&text).to_string();
    // Faz 3: satır aralıklı okuma — offset 1-tabanlı, limit sayfa büyüklüğü.
    let max_lines = limit.unwrap_or(200).clamp(1, 1000);
    let start = offset.map(|o| o.max(1) - 1).unwrap_or(0);
    let lines: Vec<&str> = content.lines().collect();
    if start >= lines.len() {
        return Ok(ReadOut {
            content: String::new(),
            truncated: start > 0,
        });
    }
    let end = (start + max_lines).min(lines.len());
    let kept = lines[start..end].join("\n");
    if end < lines.len() {
        let truncated_text = format!("{kept}\n…[truncated: {} satır]", lines.len() - end);
        let bytes: Vec<u8> = truncated_text
            .bytes()
            .take(MAX_READ_BYTES as usize)
            .collect();
        Ok(ReadOut {
            content: String::from_utf8_lossy(&bytes).to_string(),
            truncated: true,
        })
    } else if content.len() as u64 > MAX_READ_BYTES {
        Ok(ReadOut {
            content: String::from_utf8_lossy(&text[..MAX_READ_BYTES as usize]).to_string(),
            truncated: true,
        })
    } else {
        Ok(ReadOut {
            content,
            truncated: false,
        })
    }
}

#[derive(Debug, Serialize)]
pub struct GrepHit {
    pub path: String,
    pub line: usize,
    pub text: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BackupEntry {
    pub id: String,
    pub rel_path: String,
    pub backup_file: String,
    pub timestamp: u64,
}

#[tauri::command]
pub async fn apply_patch(root: String, path: String, content: String) -> Result<(), String> {
    if content.len() as u64 > 512 * 1024 {
        return Err(err("yeni içerik çok büyük (512KB+)"));
    }
    let base = canonical_root(&root)?;
    let full = resolve_rooted(&root, &path)?;
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).map_err(|e| err(format!("dizin oluşturulamadı: {e}")))?;
    }
    // Backup: .macrocode/backups altına zaman damgalı kopyala ve manifest güncelle.
    if full.exists() {
        let backup_dir = base.join(".macrocode").join("backups");
        std::fs::create_dir_all(&backup_dir)
            .map_err(|e| err(format!("yedek dizini oluşturulamadı: {e}")))?;
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let id = ts.to_string();
        let safe_name = full.file_name().and_then(|s| s.to_str()).unwrap_or("file");
        let backup_file = format!("{id}_{safe_name}");
        let backup_path = backup_dir.join(&backup_file);
        std::fs::copy(&full, &backup_path).map_err(|e| err(format!("yedek alınamadı: {e}")))?;

        let manifest_path = backup_dir.join("manifest.json");
        let mut entries: Vec<BackupEntry> = if manifest_path.exists() {
            std::fs::read_to_string(&manifest_path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        let rel_str = path.trim().replace('\\', "/");
        entries.push(BackupEntry {
            id,
            rel_path: rel_str,
            backup_file,
            timestamp: ts,
        });
        if let Ok(json_str) = serde_json::to_string_pretty(&entries) {
            let _ = std::fs::write(&manifest_path, json_str);
        }
    }
    // Atomic write: tmp + rename.
    let tmp = full.with_extension("tmp-macrocode");
    std::fs::write(&tmp, content).map_err(|e| err(format!("yazılamadı: {e}")))?;
    std::fs::rename(&tmp, &full).map_err(|e| err(format!("taşınamadı: {e}")))?;
    Ok(())
}

#[tauri::command]
pub async fn undo_patch(root: String, backup_id: Option<String>) -> Result<String, String> {
    let base = canonical_root(&root)?;
    let backup_dir = base.join(".macrocode").join("backups");
    let manifest_path = backup_dir.join("manifest.json");
    if !manifest_path.exists() {
        return Err(err("geri alınacak yama bulunamadı"));
    }
    let raw_str = std::fs::read_to_string(&manifest_path)
        .map_err(|e| err(format!("manifest okunamadı: {e}")))?;
    let mut entries: Vec<BackupEntry> =
        serde_json::from_str(&raw_str).map_err(|e| err(format!("manifest bozuk: {e}")))?;
    if entries.is_empty() {
        return Err(err("geri alınacak yama bulunamadı"));
    }

    let target_idx = match backup_id {
        Some(ref id) => entries
            .iter()
            .rposition(|e| e.id == *id || e.id.starts_with(id)),
        None => Some(entries.len() - 1),
    };

    let Some(idx) = target_idx else {
        return Err(err("belirtilen yama id'si bulunamadı"));
    };

    let entry = entries.remove(idx);
    // K1 (Faz 1): manifest'ten gelen `backup_file` asla doğrulanmadan join edilmez —
    // mutlak yol / `..` / symlink kaçışı reddedilir.
    let backup_file_path = resolve_backup_inside(&base, &backup_dir, &entry.backup_file)?;
    if !backup_file_path.exists() {
        return Err(err(format!(
            "yedek dosyası bulunamadı: {}",
            entry.backup_file
        )));
    }

    let target_file_path = resolve_rooted(&root, &entry.rel_path)?;
    let tmp = target_file_path.with_extension("tmp-restore");
    std::fs::copy(&backup_file_path, &tmp).map_err(|e| err(format!("geri yüklenemedi: {e}")))?;
    std::fs::rename(&tmp, &target_file_path)
        .map_err(|e| err(format!("dosya değiştirilemedi: {e}")))?;
    let _ = std::fs::remove_file(&backup_file_path);

    let _ = std::fs::write(
        &manifest_path,
        serde_json::to_string_pretty(&entries).unwrap_or_default(),
    );

    Ok(format!("/// geri alındı: {}", entry.rel_path))
}

fn walk(dir: &PathBuf, out_files: &mut Vec<PathBuf>) {
    if out_files.len() >= MAX_GREP_FILES {
        return;
    }
    let rd = match std::fs::read_dir(dir) {
        Ok(r) => r,
        Err(_) => return,
    };
    for e in rd.flatten() {
        if out_files.len() >= MAX_GREP_FILES {
            break;
        }
        let name = e.file_name().to_string_lossy().to_string();
        if name == ".DS_Store" {
            continue;
        }
        let Ok(ft) = e.file_type() else { continue };
        let p = e.path();
        if ft.is_dir() {
            if is_blocked_dir(&name) {
                continue;
            }
            // Symlink döngüsüne karşı derinlik: içe doğru ilerle.
            walk(&p, out_files);
        } else if ft.is_file() {
            if is_blocked_file_name(&name) || name.starts_with(".env.") {
                continue;
            }
            if is_blocked_ext(&p) {
                continue;
            }
            // 256KB üstünü atla.
            if e.metadata().map(|m| m.len() > 256 * 1024).unwrap_or(true) {
                continue;
            }
            out_files.push(p);
        }
    }
}

#[tauri::command]
pub async fn grep_files(
    root: String,
    pattern: String,
    path: Option<String>,
    regex: Option<bool>,
) -> Result<Vec<GrepHit>, String> {
    let pat = pattern.trim().to_owned();
    if pat.is_empty() {
        return Err(err("arama deseni boş olamaz"));
    }
    if pat.len() > 200 {
        return Err(err("arama deseni çok uzun"));
    }
    // Faz 3: regex modu (default literal).
    let re = if regex.unwrap_or(false) {
        Some(regex::Regex::new(&pat).map_err(|e| err(format!("geçersiz regex: {e}")))?)
    } else {
        None
    };
    let start = resolve_rooted(&root, &path.unwrap_or_default())?;
    let base = canonical_root(&root)?;
    // start bir dosyaysa tek dosya tara.
    let mut files = Vec::new();
    if start.is_file() {
        files.push(start);
    } else {
        walk(&start, &mut files);
    }
    let mut hits = Vec::new();
    for f in files {
        if hits.len() >= MAX_GREP_HITS {
            break;
        }
        let Ok(bytes) = std::fs::read(&f) else {
            continue;
        };
        if bytes[..bytes.len().min(8192)].contains(&0) {
            continue;
        }
        let text = String::from_utf8_lossy(&bytes);
        for (i, line) in text.lines().enumerate() {
            let hit = match &re {
                Some(re) => re.is_match(line),
                None => line.contains(&pat),
            };
            if hit {
                let rel = f
                    .strip_prefix(&base)
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|_| f.to_string_lossy().to_string());
                hits.push(GrepHit {
                    path: rel,
                    line: i + 1,
                    text: line.chars().take(240).collect(),
                });
                if hits.len() >= MAX_GREP_HITS {
                    break;
                }
            }
        }
    }
    Ok(hits)
}

const MAX_GLOB_HITS: usize = 100;

/// Faz 3 — glob desenine göre dosya keşfi (ignore + secret filtreli, jail korumalı).
#[tauri::command]
pub async fn glob_files(
    root: String,
    pattern: String,
    path: Option<String>,
) -> Result<Vec<DirEntry>, String> {
    let pat = pattern.trim().replace('\\', "/");
    if pat.is_empty() {
        return Err(err("glob deseni boş olamaz"));
    }
    if pat.len() > 200 {
        return Err(err("glob deseni çok uzun"));
    }
    if pat.starts_with('/') || pat.split('/').any(|s| s == "..") {
        return Err(err(
            "root dışına çıkılamaz · workspace-relative desen kullan",
        ));
    }
    let start = resolve_rooted(&root, &path.unwrap_or_default())?;
    let base = canonical_root(&root)?;
    if !start.is_dir() {
        return Err(err("dizin değil · desen alt dizinde aranır"));
    }
    let abs_pat = start.join(&pat).to_string_lossy().to_string();
    let opts = glob::MatchOptions {
        case_sensitive: true,
        require_literal_separator: false,
        require_literal_leading_dot: false,
    };
    let mut out = Vec::new();
    let paths = glob::glob_with(&abs_pat, opts).map_err(|e| err(format!("geçersiz desen: {e}")))?;
    for entry in paths {
        if out.len() >= MAX_GLOB_HITS {
            break;
        }
        let p = match entry {
            Ok(p) => p,
            Err(_) => continue,
        };
        // Jail: symlink kaçışına karşı canonical + starts_with.
        let canon = match p.canonicalize() {
            Ok(c) => c,
            Err(_) => continue,
        };
        if !canon.starts_with(&base) {
            continue;
        }
        let name = match canon.file_name().and_then(|s| s.to_str()) {
            Some(n) => n.to_owned(),
            None => continue,
        };
        if name == ".DS_Store" {
            continue;
        }
        let is_dir = canon.is_dir();
        if is_dir {
            if is_blocked_dir(&name) {
                continue;
            }
        } else {
            if is_blocked_file_name(&name) || name.starts_with(".env.") {
                continue;
            }
            if is_blocked_ext(&p) {
                continue;
            }
        }
        let rel = canon
            .strip_prefix(&base)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| canon.to_string_lossy().to_string());
        // Ara dizinler de ignore listesine takılır (örn. node_modules/…).
        if rel.split('/').any(is_blocked_dir) {
            continue;
        }
        out.push(DirEntry { name: rel, is_dir });
    }
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });
    Ok(out)
}

/// Faz 9 (P9.1) — repo haritası: workspace'teki dosyaların **göreli** yolları.
/// `walk` ile aynı filtreleri kullanır (bloklu dizinler, secret dosyalar, 256KB üstü).
#[derive(Debug, Serialize)]
pub struct TreeEntry {
    /// Workspace-relative yol (ör. `src/lib/engine/agent.ts`).
    pub path: String,
    /// Dosya boyutu (bayt) — 0 ise bilinmiyor.
    pub size: u64,
}

#[tauri::command]
pub async fn list_tree(root: String, max_entries: Option<usize>) -> Result<Vec<TreeEntry>, String> {
    let base = canonical_root(&root)?;
    let mut files: Vec<PathBuf> = Vec::new();
    walk(&base, &mut files);
    let max = max_entries.unwrap_or(400).clamp(1, 5000);
    let mut out: Vec<TreeEntry> = Vec::new();
    for p in files {
        if out.len() >= max {
            break;
        }
        let rel = p
            .strip_prefix(&base)
            .map(|r| r.to_string_lossy().to_string())
            .unwrap_or_default();
        if rel.is_empty() {
            continue;
        }
        let size = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
        out.push(TreeEntry { path: rel, size });
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

/// Faz 9 (P9.3) — kalıcı proje hafızası: `.macrocode/context.md`.
///
/// Notlar kullanıcı tarafından `/note` komutuyla yazılır ve sonraki oturumlarda
/// agent'ın system prompt'una eklenir. Yol **sabit** (göreli `context.md`), bu
/// yüzden traversal riski yoktur; yine de workspace içinde kaldığı doğrulanır.
const MEMORY_REL: &str = ".macrocode/context.md";
const MEMORY_MAX_BYTES: u64 = 64 * 1024;

fn memory_path(root: &str) -> Result<(PathBuf, PathBuf), String> {
    let base = canonical_root(root)?;
    let file = base.join(MEMORY_REL);
    Ok((base, file))
}

#[tauri::command]
pub async fn memory_read(root: String) -> Result<String, String> {
    let (_base, file) = memory_path(&root)?;
    match std::fs::read_to_string(&file) {
        Ok(txt) => Ok(txt),
        Err(_) => Ok(String::new()),
    }
}

#[tauri::command]
pub async fn memory_append(root: String, text: String) -> Result<String, String> {
    let clean = text.trim();
    if clean.is_empty() {
        return Err(err("not boş olamaz"));
    }
    if clean.len() as u64 > 8192 {
        return Err(err("not çok uzun (8KB sınır)"));
    }
    let (base, file) = memory_path(&root)?;
    // Dosya workspace içinde kalmalı (sabit yol + canonical kontrol).
    if !file.starts_with(&base) {
        return Err(err("hafıza dosyası workspace dışında"));
    }
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| err(format!("hafıza dizini oluşturulamadı: {e}")))?;
    }
    // Mevcut boyut sınırı aşılıyorsa reddet.
    if let Ok(meta) = std::fs::metadata(&file) {
        if meta.len() + clean.len() as u64 + 1 > MEMORY_MAX_BYTES {
            return Err(err("hafıza dosyası dolu (64KB sınır)"));
        }
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let line = format!("- [{stamp}] {clean}\n");
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file)
        .map_err(|e| err(format!("hafıza yazılamadı: {e}")))?;
    f.write_all(line.as_bytes())
        .map_err(|e| err(format!("hafıza yazılamadı: {e}")))?;
    Ok(line)
}

#[derive(Debug, Serialize)]
pub struct WriteOut {
    pub created: bool,
}

/// Faz 3 — yeni dosya oluşturma (create-only, O_EXCL).
/// Mevcut dosya varsa hata verir (`edit_file` kullan).
#[tauri::command]
pub async fn write_file(root: String, path: String, content: String) -> Result<WriteOut, String> {
    if content.len() as u64 > 512 * 1024 {
        return Err(err("içerik çok büyük (512KB+)"));
    }
    let full = resolve_rooted(&root, &path)?;
    if full.is_dir() {
        return Err(err("dizin üzerine yazılamaz"));
    }
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&full)
    {
        Ok(mut f) => {
            use std::io::Write;
            f.write_all(content.as_bytes())
                .map_err(|e| err(format!("yazılamadı: {e}")))?;
            Ok(WriteOut { created: true })
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            let rel = path.trim().replace('\\', "/");
            Err(err(format!("dosya zaten var: {rel} · edit_file kullan")))
        }
        Err(e) => Err(err(format!("yazılamadı: {e}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parent_dir_reddedilir() {
        assert!(resolve_rooted("/tmp", "../etc/passwd").is_err());
    }

    #[test]
    fn mutlak_yol_reddedilir() {
        assert!(resolve_rooted("/tmp", "/etc/passwd").is_err());
    }

    #[test]
    fn secret_dosya_reddedilir() {
        let tmp = std::env::temp_dir().to_string_lossy().to_string();
        assert!(resolve_rooted(&tmp, ".env").is_err());
        assert!(resolve_rooted(&tmp, "keys.json").is_err());
    }

    #[tokio::test]
    async fn faz10_d2b_gizli_uzanti_read_file_reddedilir() {
        // D2b: uzantı blokajı walk/glob'da vardı ama read_file'da yoktu.
        let kok = benzersiz_tmp("uzanti");
        std::fs::write(kok.join("sertifika.pem"), "x").unwrap();
        std::fs::write(kok.join("veri.db"), "x").unwrap();
        std::fs::write(kok.join("normal.ts"), "x").unwrap();
        let kok_s = kok.to_str().unwrap().to_string();

        let err = read_file(kok_s.clone(), "sertifika.pem".to_string(), None, None)
            .await
            .err()
            .unwrap();
        assert!(
            err.contains("yasaklı dosya uzantısı"),
            "beklenmeyen hata: {err}"
        );

        let err = read_file(kok_s.clone(), "veri.db".to_string(), None, None)
            .await
            .err()
            .unwrap();
        assert!(
            err.contains("yasaklı dosya uzantısı"),
            "beklenmeyen hata: {err}"
        );

        // Normal dosya okunabilir.
        let ok = read_file(kok_s, "normal.ts".to_string(), None, None)
            .await
            .unwrap();
        assert_eq!(ok.content, "x");
        let _ = std::fs::remove_dir_all(&kok);
    }

    #[test]
    fn faz10_d2c_tek_kaynak_dosyalari_iceriyor() {
        // Blok listeleri blocks.json'dan gelir (sabit tablo yok → kayma imkânsız).
        let b = blocks();
        assert!(b.dirs.contains(&"node_modules".to_string()));
        assert!(b.dirs.contains(&".git".to_string()));
        assert!(b.files.contains(&".env".to_string()));
        assert!(b.secret_exts.contains(&"pem".to_string()));
        assert!(b.data_exts.contains(&"db".to_string()));
        assert!(is_blocked_dir("node_modules"));
        assert!(!is_blocked_dir("src"));
        assert!(is_blocked_file_name("keys.json"));
        assert!(!is_blocked_file_name("a.ts"));
    }

    #[tokio::test]
    async fn faz9_liste_agaci_goreli_yol_verir() {
        let kok = benzersiz_tmp("tree");
        std::fs::write(kok.join("a.ts"), "x").unwrap();
        std::fs::create_dir_all(kok.join("src")).unwrap();
        std::fs::write(kok.join("src/b.ts"), "x").unwrap();
        // Bloklu dizin ve secret dosya listede olmamalı.
        std::fs::create_dir_all(kok.join("node_modules")).unwrap();
        std::fs::write(kok.join("node_modules/x.js"), "x").unwrap();
        std::fs::write(kok.join(".env"), "SECRET=1").unwrap();

        let out = list_tree(kok.to_str().unwrap().to_string(), Some(100))
            .await
            .unwrap();
        let paths: Vec<&str> = out.iter().map(|e| e.path.as_str()).collect();
        assert!(paths.contains(&"a.ts"));
        assert!(paths.contains(&"src/b.ts"));
        assert!(!paths.iter().any(|p| p.contains("node_modules")));
        assert!(!paths.iter().any(|p| p.contains(".env")));
        // Göreli yol (mutlak değil).
        assert!(paths.iter().all(|p| !p.starts_with('/')));
        let _ = std::fs::remove_dir_all(&kok);
    }

    #[tokio::test]
    async fn faz9_liste_agaci_limit_uygular() {
        let kok = benzersiz_tmp("tree-limit");
        for i in 0..10 {
            std::fs::write(kok.join(format!("f{i}.ts")), "x").unwrap();
        }
        let out = list_tree(kok.to_str().unwrap().to_string(), Some(3))
            .await
            .unwrap();
        assert_eq!(out.len(), 3);
        let _ = std::fs::remove_dir_all(&kok);
    }

    fn benzersiz_tmp(altdizin: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "macrocode-test-{}-{}-{}",
            std::process::id(),
            altdizin,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.subsec_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    #[cfg(unix)]
    fn disari_symlink_reddedilir() {
        use std::os::unix::fs::symlink;
        let dis = benzersiz_tmp("dis");
        let kok = benzersiz_tmp("kok");
        std::fs::write(dis.join("gizli.txt"), "gizli").unwrap();
        symlink(dis.join("gizli.txt"), kok.join("kacis")).unwrap();
        assert!(resolve_rooted(kok.to_str().unwrap(), "kacis").is_err());
        let _ = std::fs::remove_dir_all(&dis);
        let _ = std::fs::remove_dir_all(&kok);
    }

    #[test]
    #[cfg(unix)]
    fn iceri_symlink_kabul_edilir() {
        use std::os::unix::fs::symlink;
        let kok = benzersiz_tmp("kok2");
        std::fs::write(kok.join("hedef.txt"), "veri").unwrap();
        symlink(kok.join("hedef.txt"), kok.join("bag")).unwrap();
        let cikti = resolve_rooted(kok.to_str().unwrap(), "bag").unwrap();
        assert_eq!(cikti, kok.canonicalize().unwrap().join("hedef.txt"));
        let _ = std::fs::remove_dir_all(&kok);
    }

    #[test]
    fn var_olmayan_dosya_parent_kontrolunden_gecer() {
        let kok = benzersiz_tmp("kok3");
        let cikti = resolve_rooted(kok.to_str().unwrap(), "yeni/alt/dosya.txt");
        // parent yoksa hata (create_dir_all apply_patch'te yapılır, burada değil).
        assert!(cikti.is_err());
        std::fs::create_dir_all(kok.join("yeni/alt")).unwrap();
        assert!(resolve_rooted(kok.to_str().unwrap(), "yeni/alt/dosya.txt").is_ok());
        let _ = std::fs::remove_dir_all(&kok);
    }

    #[test]
    fn bloklu_dizin_tum_araclar_reddedilir() {
        let kok = benzersiz_tmp("kok_blocked");
        let r = kok.to_str().unwrap().to_string();
        // Y1 (Faz 2): bloklu dizin artık listede değil — okuma da yazma da reddedilir.
        assert!(resolve_rooted(&r, ".git/config").is_err());
        assert!(resolve_rooted(&r, ".git").is_err());
        assert!(resolve_rooted(&r, "alt/.git/hooks/pre-commit").is_err());
        assert!(resolve_rooted(&r, "node_modules/x.js").is_err());
        assert!(resolve_rooted(&r, ".macrocode/backups/manifest.json").is_err());
        // Normal yol etkilenmez (parent'ın var olması gerekir — jail testi değil).
        std::fs::create_dir_all(kok.join("src")).unwrap();
        assert!(resolve_rooted(&r, "src/app.ts").is_ok());
        let _ = std::fs::remove_dir_all(&kok);
    }

    #[tokio::test]
    async fn git_ici_okuma_ve_yazma_reddedilir() {
        let kok = benzersiz_tmp("kok_git_blocked");
        let r = kok.to_str().unwrap().to_string();
        std::fs::create_dir_all(kok.join(".git")).unwrap();
        std::fs::write(kok.join(".git").join("config"), "token = gizli").unwrap();

        // Okuma: doğrudan invoke bile olsa reddedilir.
        assert!(read_file(r.clone(), ".git/config".to_string(), None, None)
            .await
            .is_err_and(|e| e.contains("yasaklı dizin")));
        // Grep/glob/liste de reddedilir.
        assert!(
            grep_files(r.clone(), "token".to_string(), Some(".git".into()), None)
                .await
                .is_err()
        );
        assert!(list_dir(r.clone(), ".git".to_string()).await.is_err());
        // Yazma: `.git` altına yama yazılamaz.
        assert!(apply_patch(
            r.clone(),
            ".git/hooks/pre-commit".to_string(),
            "#!/bin/sh".to_string()
        )
        .await
        .is_err());
        assert!(
            write_file(r.clone(), ".git/deneme".to_string(), "x".to_string())
                .await
                .is_err()
        );

        let _ = std::fs::remove_dir_all(&kok);
    }

    #[tokio::test]
    async fn apply_patch_ve_undo_calisir() {
        let kok = benzersiz_tmp("kok_patch");
        let dosya = kok.join("ornek.txt");
        std::fs::write(&dosya, "versiyon 1").unwrap();

        // 1. apply_patch uygula
        apply_patch(
            kok.to_str().unwrap().to_string(),
            "ornek.txt".to_string(),
            "versiyon 2".to_string(),
        )
        .await
        .unwrap();
        assert_eq!(std::fs::read_to_string(&dosya).unwrap(), "versiyon 2");

        // .macrocode/backups/manifest.json varlığını kontrol et
        let manifest = kok.join(".macrocode").join("backups").join("manifest.json");
        assert!(manifest.exists());

        // 2. undo_patch ile geri al
        let res = undo_patch(kok.to_str().unwrap().to_string(), None)
            .await
            .unwrap();
        assert!(res.contains("ornek.txt"));
        assert_eq!(std::fs::read_to_string(&dosya).unwrap(), "versiyon 1");

        let _ = std::fs::remove_dir_all(&kok);
    }

    #[tokio::test]
    async fn macrocode_dizini_listelemede_gorunmez() {
        let kok = benzersiz_tmp("kok_macrocode");
        std::fs::create_dir_all(kok.join(".macrocode")).unwrap();
        std::fs::write(kok.join("kod.rs"), "fn main() {}").unwrap();

        let entries = list_dir(kok.to_str().unwrap().to_string(), "".to_string())
            .await
            .unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "kod.rs");

        let _ = std::fs::remove_dir_all(&kok);
    }

    #[tokio::test]
    async fn grep_literal_ve_regex_ayrimi() {
        let kok = benzersiz_tmp("kok_grep");
        let r = kok.to_str().unwrap().to_string();
        std::fs::write(kok.join("a.txt"), "foo bar\nfoo123\nbaz\n").unwrap();
        // Literal: nokta normal karakter.
        let lit = grep_files(r.clone(), "foo.".to_string(), None, None)
            .await
            .unwrap();
        assert!(lit.is_empty());
        // Regex: `foo.` eşleşir, geçersiz regex Türkçe hata verir.
        let re = grep_files(r.clone(), "foo.".to_string(), None, Some(true))
            .await
            .unwrap();
        assert_eq!(re.len(), 2);
        let bad = grep_files(r, "(".to_string(), None, Some(true)).await;
        assert!(bad.is_err_and(|e| e.contains("geçersiz regex")));
        let _ = std::fs::remove_dir_all(&kok);
    }

    #[tokio::test]
    async fn kotu_niyetli_manifest_red() {
        // K1 (Faz 1) regresyon: manifest'teki `backup_file` alanı doğrulanmadan
        // kullanılmamalı — mutlak yol / ../ ile workspace dışına çıkılamaz.
        let kok = benzersiz_tmp("kok_undo_k1");
        let dis = benzersiz_tmp("dis_undo_k1");
        let dis_file = dis.join("gizli.txt");
        std::fs::write(&dis_file, "hem-oku-hem-sil").unwrap();
        let r = kok.to_str().unwrap().to_string();

        let backup_dir = kok.join(".macrocode").join("backups");
        std::fs::create_dir_all(&backup_dir).unwrap();
        std::fs::write(kok.join("hedef.txt"), "orijinal").unwrap();

        let yaz_manifest = |backup_file: &str| {
            let entries = vec![BackupEntry {
                id: "1".into(),
                rel_path: "hedef.txt".into(),
                backup_file: backup_file.into(),
                timestamp: 1,
            }];
            std::fs::write(
                backup_dir.join("manifest.json"),
                serde_json::to_string_pretty(&entries).unwrap(),
            )
            .unwrap();
        };

        // 1. Mutlak yol: reddedilir, hedef değişmez, kaynak dosya silinmez.
        yaz_manifest(dis_file.to_str().unwrap());
        let res = undo_patch(r.clone(), None).await;
        assert!(res.is_err_and(|e| e.contains("yedek adı geçersiz")));
        assert_eq!(
            std::fs::read_to_string(kok.join("hedef.txt")).unwrap(),
            "orijinal"
        );
        assert!(dis_file.exists(), "kaynak dosya silinmemeli");

        // 2. ../ kaçışı: reddedilir.
        yaz_manifest("../..//kacis.txt");
        assert!(undo_patch(r.clone(), None).await.is_err());

        // 3. Dizin ayracı içeren ad: reddedilir.
        yaz_manifest("alt/dosya.txt");
        assert!(undo_patch(r.clone(), None).await.is_err());

        // 4. Geçersiz karakter: reddedilir.
        yaz_manifest("boşluklu.txt");
        assert!(undo_patch(r, None).await.is_err());

        assert!(dis_file.exists());
        let _ = std::fs::remove_dir_all(&kok);
        let _ = std::fs::remove_dir_all(&dis);
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn kotu_niyetli_symlink_yedek_red() {
        use std::os::unix::fs::symlink;
        // K1 (Faz 1): dosya adı güvenli olsa bile symlink dışarıyı gösteremez.
        let kok = benzersiz_tmp("kok_undo_sym");
        let dis = benzersiz_tmp("dis_undo_sym");
        let dis_file = dis.join("sirl.txt");
        std::fs::write(&dis_file, "sirli-icerik").unwrap();
        let r = kok.to_str().unwrap().to_string();

        let backup_dir = kok.join(".macrocode").join("backups");
        std::fs::create_dir_all(&backup_dir).unwrap();
        std::fs::write(kok.join("hedef.txt"), "orijinal").unwrap();
        // Güvenli ada sahip ama dışarıyı gösteren symlink.
        symlink(&dis_file, backup_dir.join("1_guvenli-adi.txt")).unwrap();

        let entries = vec![BackupEntry {
            id: "1".into(),
            rel_path: "hedef.txt".into(),
            backup_file: "1_guvenli-adi.txt".into(),
            timestamp: 1,
        }];
        std::fs::write(
            backup_dir.join("manifest.json"),
            serde_json::to_string_pretty(&entries).unwrap(),
        )
        .unwrap();

        let res = undo_patch(r, None).await;
        assert!(res.is_err_and(|e| e.contains("yedek dizini dışında")));
        assert_eq!(
            std::fs::read_to_string(kok.join("hedef.txt")).unwrap(),
            "orijinal"
        );
        assert!(dis_file.exists(), "symlink kaynağı silinmemeli");

        let _ = std::fs::remove_dir_all(&kok);
        let _ = std::fs::remove_dir_all(&dis);
    }

    #[test]
    fn safe_backup_name_kontrolleri() {
        assert!(safe_backup_name("123_dosya.txt").is_ok());
        assert!(safe_backup_name("").is_err());
        assert!(safe_backup_name("..").is_err());
        assert!(safe_backup_name("../x").is_err());
        assert!(safe_backup_name("/etc/passwd").is_err());
        assert!(safe_backup_name("a\\b").is_err());
        assert!(safe_backup_name("boş").is_err());
        assert!(safe_backup_name("a b").is_err());
    }

    #[tokio::test]
    async fn read_offset_limit_sayfalar() {
        let kok = benzersiz_tmp("kok_offset");
        let r = kok.to_str().unwrap().to_string();
        let icerik = (1..=10)
            .map(|i| format!("satır{i}"))
            .collect::<Vec<_>>()
            .join("\n");
        std::fs::write(kok.join("b.txt"), icerik).unwrap();
        let sayfa = read_file(r.clone(), "b.txt".to_string(), Some(3), Some(4))
            .await
            .unwrap();
        assert!(sayfa.content.starts_with("satır4\nsatır5\nsatır6"));
        assert!(sayfa.truncated);
        let son = read_file(r.clone(), "b.txt".to_string(), Some(5), Some(9))
            .await
            .unwrap();
        assert!(son.content.contains("satır10"));
        assert!(!son.truncated);
        let _ = std::fs::remove_dir_all(&kok);
    }

    #[tokio::test]
    async fn glob_ignore_filtreler() {
        let kok = benzersiz_tmp("kok_glob");
        let r = kok.to_str().unwrap().to_string();
        std::fs::write(kok.join("a.ts"), "x").unwrap();
        std::fs::write(kok.join("b.ts"), "y").unwrap();
        std::fs::create_dir_all(kok.join("node_modules")).unwrap();
        std::fs::write(kok.join("node_modules/c.ts"), "z").unwrap();
        let hits = glob_files(r, "**/*.ts".to_string(), None).await.unwrap();
        let adlar: Vec<&str> = hits.iter().map(|e| e.name.as_str()).collect();
        assert!(adlar.contains(&"a.ts"));
        assert!(adlar.contains(&"b.ts"));
        assert!(!adlar.iter().any(|n| n.contains("node_modules")));
        let _ = std::fs::remove_dir_all(&kok);
    }

    #[tokio::test]
    async fn write_file_o_excl_korur() {
        let kok = benzersiz_tmp("kok_write");
        let r = kok.to_str().unwrap().to_string();
        let out = write_file(r.clone(), "yeni.txt".to_string(), "merhaba".to_string())
            .await
            .unwrap();
        assert!(out.created);
        assert_eq!(
            std::fs::read_to_string(kok.join("yeni.txt")).unwrap(),
            "merhaba"
        );
        // Mevcut dosya reddedilir.
        let again = write_file(r.clone(), "yeni.txt".to_string(), "başka".to_string()).await;
        assert!(again.is_err_and(|e| e.contains("dosya zaten var") && e.contains("edit_file")));
        assert_eq!(
            std::fs::read_to_string(kok.join("yeni.txt")).unwrap(),
            "merhaba"
        );
        // Jail korunur.
        assert!(write_file(r, "../kacis.txt".to_string(), "x".to_string())
            .await
            .is_err());
        let _ = std::fs::remove_dir_all(&kok);
    }

    #[test]
    fn windows_ayiraci_donusturulur() {
        let kok = benzersiz_tmp("kok_winsep");
        std::fs::create_dir_all(kok.join("alt")).unwrap();
        let r = kok.to_str().unwrap().to_string();
        // `\` ayracı `/` sayılır: mevcut parent altında çözülür.
        assert!(resolve_rooted(&r, "alt\\dosya.txt").is_ok());
        assert!(resolve_rooted(&r, "..\\..\\etc").is_err());
        let _ = std::fs::remove_dir_all(&kok);
    }

    #[test]
    #[cfg(unix)]
    fn git_ici_symlink_baskini_reddedilir() {
        use std::os::unix::fs::symlink;
        let dis = benzersiz_tmp("dis_git");
        let kok = benzersiz_tmp("kok_git");
        std::fs::create_dir_all(kok.join(".git")).unwrap();
        std::fs::write(dis.join("gizli.txt"), "gizli").unwrap();
        symlink(dis.join("gizli.txt"), kok.join(".git").join("kacis")).unwrap();
        assert!(resolve_rooted(kok.to_str().unwrap(), ".git/kacis").is_err());
        let _ = std::fs::remove_dir_all(&dis);
        let _ = std::fs::remove_dir_all(&kok);
    }

    #[tokio::test]
    async fn glob_ust_dizin_desenleri_reddedilir() {
        let kok = benzersiz_tmp("kok_glob2");
        let r = kok.to_str().unwrap().to_string();
        assert!(glob_files(r.clone(), "../*.ts".to_string(), None)
            .await
            .is_err());
        assert!(glob_files(r, "/mutlak/*.ts".to_string(), None)
            .await
            .is_err());
        let _ = std::fs::remove_dir_all(&kok);
    }
}
