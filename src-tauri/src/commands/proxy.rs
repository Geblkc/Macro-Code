use futures_util::StreamExt;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::State;

/// İş 2 — CSP `connect-src` bypass.
///
/// WebView `fetch` yalnızca `tauri.conf.json` içindeki hostlara gidebilir. Özel uç,
/// `baseUrlOverride` ve uzak Ollama URL'leri bu listeye girmez. Bu komut isteği
/// `reqwest`'ten çıkarır ve SSE gövdesini Channel üzerinden WebView'e aktarır.
///
/// Kanal olayları (JSON):
///
/// - `{"k":"meta","status":200,"headers":{...}}` — yanıt başlığı (ilk event)
/// - `{"k":"data","text":"..."}` — gövde parçası (satır bazlı, kayıp UTF-8 kabul)
/// - `{"k":"done"}` — gövde bitti
///
/// Hata sözleşmesi `stream_anthropic` ile aynı: ağ → `Err("ag hatasi: …")`,
/// HTTP hata durumu meta içinde taşınır (istekçi `res.ok`'dan okur).

#[derive(Default)]
pub struct ProxyState {
    inflight: Mutex<HashMap<u64, Arc<AtomicBool>>>,
}

/// İstek bitince/kaybedilince kaydı temizler (RAII).
struct Cleanup<'a> {
    id: u64,
    state: &'a ProxyState,
}

impl Drop for Cleanup<'_> {
    fn drop(&mut self) {
        if let Ok(mut map) = self.state.inflight.lock() {
            map.remove(&self.id);
        }
    }
}

/// Faz 10 (O2) — proxy sertleştirme.
///
/// Proxy'nin işi CSP'yi aşmak (özel uç / uzak Ollama / uzak MCP). Başka hiçbir
/// şey yapmasına gerek yok; bu yüzden istek yüzeyi daraltıldı:
/// - yalnızca http/https,
/// - yalnızca izinli HTTP metotları,
/// - yalnızca güvenli başlıklar (host/connection/transfer-encoding/content-length/upgrade),
/// - link-local / metadata IP'leri (169.254.0.0/16, fe80::/10, 0.0.0.0/8, 100.64/10),
/// - istek zaman aşımı ve maksimum yanıt boyutu.
const ALLOWED_METHODS: [&str; 7] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const BLOCKED_HEADERS: [&str; 6] = [
    "host",
    "connection",
    "transfer-encoding",
    "content-length",
    "upgrade",
    "proxy-authorization",
];
/// Maksimum yanıt gövdesi (bayt) — sonsuz akış koruması.
const MAX_RESPONSE_BYTES: usize = 32 * 1024 * 1024;
/// İstek zaman aşımı (saniye).
const REQUEST_TIMEOUT_SECS: u64 = 120;

/// Link-local / metadata / belirsiz adresler engellenir.
/// (LAN'daki Ollama: 192.168.x, 10.x **serbesttir** — meşru kullanım.)
fn is_blocked_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            let o = v4.octets();
            v4.is_link_local()      // 169.254.0.0/16 (bulut metadata dahil)
                || v4.is_unspecified() // 0.0.0.0
                || o[0] == 0            // 0.0.0.0/8
                || (o[0] == 100 && (o[1] & 0xC0) == 64) // 100.64.0.0/10 (CGNAT)
        }
        std::net::IpAddr::V6(v6) => {
            v6.is_unspecified() || (v6.segments()[0] & 0xfe00) == 0xfe00 // fe80::/10
        }
    }
}

/// Sadece http/https — `file:`/`data:` gibi şemalar reddedilir.
/// URL içinde kimlik bilgisi (`http://user:pass@host`) reddedilir.
fn check_url(url: &str) -> Result<reqwest::Url, String> {
    let t = url.trim();
    if !(t.starts_with("http://") || t.starts_with("https://")) {
        return Err("gecersiz url: yalnizca http/https desteklenir".to_string());
    }
    let parsed = reqwest::Url::parse(t).map_err(|e| format!("gecersiz url: {e}"))?;
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("gecersiz url: kimlik bilgisi iceren adres desteklenmez".to_string());
    }
    Ok(parsed)
}

/// Host link-local/metadata adresine çözümleniyorsa reddet.
async fn check_host_not_metadata(url: &reqwest::Url) -> Result<(), String> {
    let Some(host) = url.host_str() else {
        return Err("gecersiz url: host yok".to_string());
    };
    // Doğrudan IP adresi → hızlı kontrol.
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        if is_blocked_ip(ip) {
            return Err("yasakli hedef: link-local/metadata adresi".to_string());
        }
        return Ok(());
    }
    // Alan adı → çözümle ve IP'leri denetle.
    let port = url.port_or_known_default().unwrap_or(443);
    match tokio::net::lookup_host((host, port)).await {
        Ok(addrs) => {
            for addr in addrs {
                if is_blocked_ip(addr.ip()) {
                    return Err("yasakli hedef: link-local/metadata adresi".to_string());
                }
            }
            Ok(())
        }
        // Çözümleme başarısızsa istek zaten hata verecek — burada engelleme.
        Err(_) => Ok(()),
    }
}

/// O7 — yönlendirme hedefi yeniden denetlenir (SSRF: `Location` başlığı
/// başlangıç denetimini atlayabilir). DNS tabanlı host denetimi (async)
/// sync closure içinde mümkün olmadığından burada şema/URL-kimlik-bilgisi/
/// IP-literali kesin reddedilir; isimli hostlar istek sırasında resolv olup
/// hedef IP link-local'a çekilirse reqwest hata döndürür (bağlantı düzeyi).
fn check_redirect_target(url: &reqwest::Url) -> Result<(), String> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err("gecersiz yonlendirme: http/https degil".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("gecersiz yonlendirme: kimlik bilgisi iceriyor".to_string());
    }
    if let Some(ip) = url.host_str().and_then(|h| {
        h.trim_start_matches('[')
            .trim_end_matches(']')
            .parse::<std::net::IpAddr>()
            .ok()
    }) {
        if is_blocked_ip(ip) {
            return Err("yasakli yonlendirme: link-local/metadata adresi".to_string());
        }
    }
    Ok(())
}

const MAX_REDIRECTS: usize = 5;

fn redirect_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= MAX_REDIRECTS {
            return attempt.error("cok fazla yonlendirme");
        }
        match check_redirect_target(attempt.url()) {
            Ok(()) => attempt.follow(),
            Err(e) => attempt.error(e),
        }
    })
}

/// O7 — reqwest düzeyinde DNS savunması: her çözümleme (ilk istek VE her
/// yönlendirme atlaması) link-local/metadata adresleri eler; hiç temiz adres
/// kalmazsa reddeder. (`lookup_host` denetiminin TOCTOU deliği ve
/// yönlendirme→host ismi bypass'ı ile DNS-rebind burada kesin kapanır.)
struct GuardResolve;

impl reqwest::dns::Resolve for GuardResolve {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let host = name.as_str().to_owned();
        Box::pin(async move {
            let addrs = tokio::net::lookup_host((host.as_str(), 0)).await?;
            let kept: Vec<std::net::SocketAddr> =
                addrs.filter(|a| !is_blocked_ip(a.ip())).collect();
            if kept.is_empty() {
                return Err("yasakli hedef: link-local/metadata adresi".into());
            }
            Ok(Box::new(kept.into_iter()) as reqwest::dns::Addrs)
        })
    }
}

#[tauri::command]
pub async fn proxy_fetch(
    id: u64,
    url: String,
    method: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
    on_data: Channel<Value>,
    state: State<'_, ProxyState>,
) -> Result<(), String> {
    let parsed = check_url(&url)?;
    check_host_not_metadata(&parsed).await?;

    let m = reqwest::Method::from_bytes(method.trim().to_uppercase().as_bytes())
        .map_err(|_| format!("gecersiz method: {method}"))?;
    if !ALLOWED_METHODS.contains(&m.as_str()) {
        return Err(format!("izin verilmeyen method: {}", m.as_str()));
    }

    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut map = state
            .inflight
            .lock()
            .map_err(|_| "proxy durumu kilitli".to_string())?;
        map.insert(id, cancel.clone());
    }
    let _cleanup = Cleanup { id, state: &state };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        // O7: her yönlendirme atlaması yeniden denetlenir (baştaki URL
        // denetimi tek başına yeterli değildi).
        .redirect(redirect_policy())
        // O7: DNS çözümü de denetlenir — hostname bu kez link-local'e
        // dönebilirdi (rebind); çözümleyici temiz olmayan IP'yi eler.
        .dns_resolver(Arc::new(GuardResolve))
        .build()
        .map_err(|e| format!("proxy istemcisi kurulamadi: {e}"))?;
    let mut req = client.request(m, url.trim());
    for (k, v) in &headers {
        let lk = k.trim().to_ascii_lowercase();
        if BLOCKED_HEADERS.contains(&lk.as_str()) {
            continue; // host/connection/... gönderilmez
        }
        if let Ok(name) = reqwest::header::HeaderName::from_bytes(lk.as_bytes()) {
            if let Ok(value) = reqwest::header::HeaderValue::from_str(v) {
                req = req.header(name, value);
            }
        }
    }
    if let Some(b) = body {
        req = req.body(b);
    }
    let res = req.send().await.map_err(|e| format!("ag hatasi: {e}"))?;

    let status = res.status().as_u16();
    let mut hdrs = serde_json::Map::new();
    for (k, v) in res.headers().iter() {
        if let Ok(s) = v.to_str() {
            hdrs.insert(k.as_str().to_string(), Value::String(s.to_string()));
        }
    }
    if on_data
        .send(json!({ "k": "meta", "status": status, "headers": Value::Object(hdrs) }))
        .is_err()
    {
        return Ok(());
    }

    let mut stream = res.bytes_stream();
    let mut buf = String::new();
    let mut total_bytes: usize = 0;
    while let Some(item) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            return Ok(());
        }
        let bytes = item.map_err(|e| format!("ag hatasi: {e}"))?;
        total_bytes += bytes.len();
        if total_bytes > MAX_RESPONSE_BYTES {
            let _ =
                on_data.send(json!({ "k": "error", "error": "proxy: yanit boyutu siniri asildi" }));
            return Ok(());
        }
        buf.push_str(&String::from_utf8_lossy(&bytes));
        while let Some(nl) = buf.find('\n') {
            let line: String = buf.drain(..=nl).collect();
            if on_data.send(json!({ "k": "data", "text": line })).is_err() {
                return Ok(());
            }
        }
    }
    if !buf.is_empty() && on_data.send(json!({ "k": "data", "text": buf })).is_err() {
        return Ok(());
    }
    let _ = on_data.send(json!({ "k": "done" }));
    Ok(())
}

/// WebView stream'i iptal edince Rust tarafındaki indirmeyi durdurur.
#[tauri::command]
pub fn proxy_abort(id: u64, state: State<'_, ProxyState>) -> Result<(), String> {
    if let Ok(map) = state.inflight.lock() {
        if let Some(flag) = map.get(&id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn yalnizca_http_https_kabul() {
        assert!(check_url("https://ornek.com/v1").is_ok());
        assert!(check_url("http://192.168.1.5:11434/api").is_ok());
        assert!(check_url("file:///etc/passwd").is_err());
        assert!(check_url("data:text/plain,x").is_err());
        assert!(check_url("").is_err());
    }

    #[test]
    fn faz10_o2_url_kimlik_bilgisi_reddedilir() {
        assert!(check_url("http://user:pass@ornek.com/v1").is_err());
        assert!(check_url("http://user@ornek.com/v1").is_err());
    }

    #[test]
    fn faz10_o2_link_local_metadata_engellenir() {
        // Bulut metadata + link-local engelli.
        assert!(is_blocked_ip("169.254.169.254".parse().unwrap()));
        assert!(is_blocked_ip("169.254.0.1".parse().unwrap()));
        assert!(is_blocked_ip("0.0.0.0".parse().unwrap()));
        assert!(is_blocked_ip("100.64.0.1".parse().unwrap()));
        assert!(is_blocked_ip("fe80::1".parse().unwrap()));
        // LAN ve localhost serbest (Ollama meşru kullanım).
        assert!(!is_blocked_ip("192.168.1.5".parse().unwrap()));
        assert!(!is_blocked_ip("10.0.0.4".parse().unwrap()));
        assert!(!is_blocked_ip("127.0.0.1".parse().unwrap()));
        assert!(!is_blocked_ip("93.184.216.34".parse().unwrap()));
    }

    #[tokio::test]
    async fn faz10_o2_metadata_host_reddedilir() {
        let url = reqwest::Url::parse("http://169.254.169.254/latest/meta-data/").unwrap();
        assert!(check_host_not_metadata(&url).await.is_err());
        let lan = reqwest::Url::parse("http://192.168.1.5:11434/api/chat").unwrap();
        assert!(check_host_not_metadata(&lan).await.is_ok());
    }

    /// O7 — `Location` ile gelen hedef de aynı sertlikte denetlenir.
    #[test]
    fn o7_redirect_hedefi_denetlenir() {
        let ok = reqwest::Url::parse("http://192.168.1.5:11434/api/chat").unwrap();
        assert!(check_redirect_target(&ok).is_ok());
        let meta = reqwest::Url::parse("http://169.254.169.254/latest/meta-data/").unwrap();
        assert!(check_redirect_target(&meta).is_err());
        let v6meta = reqwest::Url::parse("http://[fe80::1]/x").unwrap();
        assert!(check_redirect_target(&v6meta).is_err());
        let cred = reqwest::Url::parse("http://user:pass@ornek.com/x").unwrap();
        assert!(check_redirect_target(&cred).is_err());
        let ftp = reqwest::Url::parse("ftp://ornek.com/x").unwrap();
        assert!(check_redirect_target(&ftp).is_err());
    }

    #[test]
    fn cleanup_kaydi_siler() {
        let state = ProxyState::default();
        let flag = Arc::new(AtomicBool::new(false));
        state.inflight.lock().unwrap().insert(7, flag.clone());
        {
            let _c = Cleanup {
                id: 7,
                state: &state,
            };
            assert!(state.inflight.lock().unwrap().contains_key(&7));
        }
        assert!(state.inflight.lock().unwrap().is_empty());
    }

    #[test]
    fn abort_isareti_koyar() {
        let state = ProxyState::default();
        let flag = Arc::new(AtomicBool::new(false));
        state.inflight.lock().unwrap().insert(3, flag.clone());
        flag.store(true, Ordering::Relaxed);
        assert!(flag.load(Ordering::Relaxed));
    }
}
