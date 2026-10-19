use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_store::{Store, StoreExt};

// Tum anahtarlar tek dosyada: app_data_dir/keys.json (tauri-plugin-store)
// Deger formati: { "<provider>": { "key": "<secret-or-url>" } }
// Asla anahtar DEGERI frontend'e toplu dondurulmez; sadece var/yok bilgisi verilir.

const STORE_PATH: &str = "keys.json";

const VALID_PROVIDERS: [&str; 7] = [
    "anthropic",
    "openai",
    "gemini",
    "ollamaUrl",
    "openrouter",
    "deepseek",
    "xai",
];

/// "Ollama" / "ollamaurl" gibi varyantlari kanonik forma cevirir.
/// `custom_<slug>` adlari özel uçlara aittir (harf/rakam/`-`/`_`, en fazla 48 karakter).
fn normalize_provider(raw: &str) -> Result<String, String> {
    let lowered = raw.trim().to_lowercase();
    let canonical = if lowered == "ollama" || lowered == "ollamaurl" {
        "ollamaUrl".to_string()
    } else {
        lowered
    };
    if VALID_PROVIDERS.contains(&canonical.as_str()) {
        return Ok(canonical);
    }
    if let Some(rest) = canonical.strip_prefix("custom_") {
        if !rest.is_empty()
            && rest.len() <= 48
            && rest
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Ok(canonical);
        }
    }
    Err(format!(
        "bilinmeyen saglayici: {raw} · anthropic/openai/gemini/ollama/openrouter/deepseek/xai kullan"
    ))
}

fn open_store(app: &AppHandle) -> Result<Arc<Store<Wry>>, String> {
    app.store(STORE_PATH)
        .map_err(|e| format!("depolama acilamadi: {e} · uygulamayi yeniden baslatmayi dene"))
}

/// Faz 10 (D1) — anahtar dosyasını yalnızca sahibi okuyabilsin (`0600`).
///
/// `keys.json` düz metin; tipik umask ile diğer yerel kullanıcılar okuyabiliyordu.
/// Unix'te izinler `0600` yapılır (Windows'ta ACL gerekir, atlanır).
/// Hata **kullanıcıya gösterilmez** (yazma başarılı olur) ama günlüğe düşer.
fn harden_store_file(app: &AppHandle) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let Ok(dir) = app.path().app_data_dir() else {
            return;
        };
        let path = dir.join(STORE_PATH);
        if !path.exists() {
            return;
        }
        if let Err(e) = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)) {
            eprintln!("[keystore] izinler daraltilamadi (0600): {e}");
        }
    }
    #[cfg(not(unix))]
    {
        let _ = app;
    }
}

fn read_key(store: &Arc<Store<Wry>>, provider: &str) -> String {
    store
        .get(provider)
        .and_then(|v| v.get("key").and_then(|k| k.as_str()).map(|s| s.to_owned()))
        .unwrap_or_default()
}

#[tauri::command]
pub async fn set_api_key(provider: String, key: String, app: AppHandle) -> Result<(), String> {
    let provider = normalize_provider(&provider)?;
    let key = key.trim().to_owned();
    if key.is_empty() {
        return Err("api anahtari bos olamaz".to_string());
    }
    let store = open_store(&app)?;
    store.set(provider, serde_json::json!({ "key": key }));
    store
        .save()
        .map_err(|e| format!("anahtar kaydedilemedi: {e} · disk yazma iznini kontrol et"))?;
    // Faz 10 (D1): dosya yalnızca sahibine açık olsun.
    harden_store_file(&app);
    Ok(())
}

#[tauri::command]
pub async fn get_api_key(provider: String, app: AppHandle) -> Result<String, String> {
    let provider = normalize_provider(&provider)?;
    let store = open_store(&app)?;
    Ok(read_key(&store, &provider))
}

#[tauri::command]
pub async fn delete_api_key(provider: String, app: AppHandle) -> Result<(), String> {
    let provider = normalize_provider(&provider)?;
    let store = open_store(&app)?;
    store.delete(provider);
    store
        .save()
        .map_err(|e| format!("anahtar silinemedi: {e} · disk yazma iznini kontrol et"))?;
    // Faz 10 (D1): silme sonrası dosya izinleri korunur.
    harden_store_file(&app);
    Ok(())
}

/// Boot sequence icin: hangi saglayicilar bagli? (degerler degil, sadece var/yok)
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyStatus {
    pub anthropic: bool,
    pub openai: bool,
    pub gemini: bool,
    pub ollama_url: bool,
    pub openrouter: bool,
    pub deepseek: bool,
    pub xai: bool,
}

#[tauri::command]
pub async fn key_status(app: AppHandle) -> Result<KeyStatus, String> {
    let store = open_store(&app)?;
    let has = |p: &str| !read_key(&store, p).trim().is_empty();
    Ok(KeyStatus {
        anthropic: has("anthropic"),
        openai: has("openai"),
        gemini: has("gemini"),
        ollama_url: has("ollamaUrl"),
        openrouter: has("openrouter"),
        deepseek: has("deepseek"),
        xai: has("xai"),
    })
}

/// Hic anahtar yoksa boot mesaji uyarı gosterecek.
#[tauri::command]
pub async fn has_any_key(app: AppHandle) -> Result<bool, String> {
    let status = key_status(app).await?;
    Ok(status.anthropic
        || status.openai
        || status.gemini
        || status.ollama_url
        || status.openrouter
        || status.deepseek
        || status.xai)
}

/// Maskeli ipucu (`••••a1b2`): tam değer ASLA dönmez.
/// Boş/kayıtsız anahtarda boş string döner.
#[tauri::command]
pub async fn key_hint(provider: String, app: AppHandle) -> Result<String, String> {
    let provider = normalize_provider(&provider)?;
    let store = open_store(&app)?;
    let trimmed = read_key(&store, &provider).trim().to_owned();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    let last4: String = trimmed
        .chars()
        .rev()
        .take(4)
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    Ok(format!("••••{last4}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn yerlesik_saglayicilar_kabul_edilir() {
        assert_eq!(normalize_provider("anthropic").unwrap(), "anthropic");
        assert_eq!(normalize_provider("Ollama").unwrap(), "ollamaUrl");
        assert_eq!(normalize_provider("ollamaurl").unwrap(), "ollamaUrl");
    }

    #[test]
    fn custom_oneki_kabul_edilir() {
        assert_eq!(
            normalize_provider("custom_benim-proxy").unwrap(),
            "custom_benim-proxy"
        );
        assert_eq!(
            normalize_provider("CUSTOM_ABC123").unwrap(),
            "custom_abc123"
        );
    }

    #[test]
    fn custom_kurallari_reddedilir() {
        assert!(normalize_provider("custom_").is_err());
        assert!(normalize_provider("custom_a b").is_err());
        assert!(normalize_provider("custom_çokbaytlı").is_err());
        assert!(normalize_provider("custom_x").is_ok());
        assert!(normalize_provider("bilinmeyen").is_err());
    }
}
