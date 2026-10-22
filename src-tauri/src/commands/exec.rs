use serde::Serialize;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;

const TIMEOUT_SECS: u64 = 15;
const MAX_OUTPUT_BYTES: usize = 8192;

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
        if crate::commands::fs::is_blocked_file_name(seg) || seg.starts_with(".env.") {
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

fn err(msg: impl Into<String>) -> String {
    msg.into()
}

#[derive(Debug, Serialize)]
pub struct ExecOut {
    pub stdout: String,
    pub stderr: String,
    pub code: i32,
    pub truncated: bool,
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
    if !FILE_ARG_CMDS.contains(&cmd) && cmd != "rm" {
        return Ok(());
    }
    for a in args.iter().filter(|a| !a.starts_with('-')) {
        let v = a.trim().replace('\\', "/");
        if v.is_empty() {
            continue;
        }
        let joined = dir.join(&v);
        let Ok(canon) = joined.canonicalize() else {
            continue; // yok — string jail zaten desen/missing yoluna izin verir
        };
        if !canon.starts_with(jail_base) {
            return Err(err(format!(
                "argüman workspace dışına çıkıyor (symlink?): {a}"
            )));
        }
        // Çözülen gerçek yoldaki dosya/dizin adları da blok listesinden geçmeli.
        let rel = canon
            .strip_prefix(jail_base)
            .unwrap_or(&canon)
            .to_string_lossy()
            .to_string();
        for comp in rel.split('/').filter(|c| !c.is_empty()) {
            let cl = comp.to_ascii_lowercase();
            if crate::commands::fs::is_blocked_dir(&cl) {
                return Err(err(format!("yasaklı dizin argümanda: {a}")));
            }
            if crate::commands::fs::is_blocked_file_name(&cl) || cl.starts_with(".env.") {
                return Err(err(format!("yasaklı dosya argümanda: {a}")));
            }
            if crate::commands::fs::is_blocked_name_ext(&cl) {
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
            // Dosya argümanı jail'i prefix'ten BAĞIMSIZ: boş listede (cat/find/…)
            // args serbest olsa da mutlak yol / ../ / bloklu dosya reddedilir.
            if FILE_ARG_CMDS.contains(&c) {
                for a in args.iter().filter(|a| !a.starts_with('-')) {
                    check_file_arg(a)?;
                }
            }
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

#[tauri::command]
pub async fn exec_cmd(
    cmd: String,
    args: Vec<String>,
    cwd: String,
    timeout_ms: Option<u64>,
    root: Option<String>,
    // Faz 8 L3: kullanıcı allowlist uzantısı (TS `parseCustomAllowList` çıktısı).
    extra_allow: Option<ExtraAllow>,
) -> Result<ExecOut, String> {
    let extra = extra_allow.unwrap_or_default();
    check_cmd(&cmd, &args, &extra)?;
    let cwd_trimmed = cwd.trim();
    if cwd_trimmed.is_empty() {
        return Err(err("cwd boş olamaz"));
    }
    let dir = PathBuf::from(cwd_trimmed)
        .canonicalize()
        .map_err(|e| err(format!("cwd geçersiz: {e}")))?;

    // Workspace jail: root verildiyse cwd onun altında olmalı.
    // Frontend her zaman root gönderir; doğrudan invoke edenlere karşı backend sınırı.
    let base_canon = match root.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(r) => {
            let base = PathBuf::from(r)
                .canonicalize()
                .map_err(|e| err(format!("workspace kökü geçersiz: {e}")))?;
            if !dir.starts_with(&base) {
                return Err(err("cwd workspace dışına çıkamaz"));
            }
            Some(base)
        }
        None => None,
    };

    // O7 (Y2) — exec dosya argümanlarında **symlink çözümü**:
    // `check_file_arg` string düzeyinde çalışır; "creds -> ~/.ssh/id_ed25519"
    // gibi workspace içi symlink'i göremez (fs araçları bu kontrolü
    // `resolve_rooted` içinde yapar, exec deliyordu). Var olan hedef burada
    // canonicalize edilip workspace (root yoksa cwd) altında kalmak zorundadır.
    let jail_base = base_canon.as_deref().unwrap_or(dir.as_path());
    guard_file_args(&dir, jail_base, cmd.trim(), &args)?;

    let timeout =
        Duration::from_millis(timeout_ms.unwrap_or(TIMEOUT_SECS * 1000).clamp(1000, 30000));

    let mut child_cmd = tokio::process::Command::new(cmd.trim());
    child_cmd.args(&args).current_dir(&dir).kill_on_drop(true);
    let output_fut = child_cmd.output();
    let output = match tokio::time::timeout(timeout, output_fut).await {
        Ok(res) => res.map_err(|e| err(format!("komut çalıştırılamadı: {e}")))?,
        Err(_) => return Err(err("komut zaman aşımına uğradı")),
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
    })
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
