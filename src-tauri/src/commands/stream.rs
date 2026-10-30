use futures_util::StreamExt;
use serde::Serialize;
use std::collections::HashMap;
use tauri::ipc::Channel;

#[derive(Debug, Clone, Serialize)]
pub struct UsageEvent {
    pub input: u32,
    pub output: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolUseEvent {
    pub id: String,
    pub name: String,
    pub input: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct ThinkingEvent {
    pub thinking: String,
    pub signature: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct StreamEvent {
    pub text: String,
    pub done: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<UsageEvent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolUseEvent>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking: Option<Vec<ThinkingEvent>>,
}

fn text_ev(text: String) -> StreamEvent {
    StreamEvent {
        text,
        done: false,
        error: None,
        usage: None,
        reasoning: None,
        tool_calls: None,
        thinking: None,
    }
}

fn usage_ev(input: u32, output: u32) -> StreamEvent {
    StreamEvent {
        text: String::new(),
        done: false,
        error: None,
        usage: Some(UsageEvent { input, output }),
        reasoning: None,
        tool_calls: None,
        thinking: None,
    }
}

fn reasoning_ev(reasoning: String) -> StreamEvent {
    StreamEvent {
        text: String::new(),
        done: false,
        error: None,
        usage: None,
        reasoning: Some(reasoning),
        tool_calls: None,
        thinking: None,
    }
}

fn done_ev() -> StreamEvent {
    StreamEvent {
        text: String::new(),
        done: true,
        error: None,
        usage: None,
        reasoning: None,
        tool_calls: None,
        thinking: None,
    }
}

/// Faz 4 — tur içi birikim: tool_use blokları + imzalı thinking blokları.
/// Metin/reasoning anlık event'lerle akar; bunlar turun final listesidir.
#[derive(Debug, Default)]
struct StreamAcc {
    tool_ids: HashMap<usize, (String, String)>,
    tool_json: HashMap<usize, String>,
    thinking_text: HashMap<usize, String>,
    thinking_sig: HashMap<usize, String>,
}

impl StreamAcc {
    fn feed(&mut self, json: &serde_json::Value) {
        let kind = json.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let index = json.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
        if kind == "content_block_start" {
            let block_type = json
                .get("content_block")
                .and_then(|b| b.get("type"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if block_type == "tool_use" {
                let id = json
                    .get("content_block")
                    .and_then(|b| b.get("id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let name = json
                    .get("content_block")
                    .and_then(|b| b.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                self.tool_ids.insert(index, (id, name));
                self.tool_json.entry(index).or_default();
            }
            return;
        }
        if kind != "content_block_delta" {
            return;
        }
        let delta = match json.get("delta") {
            Some(d) => d,
            None => return,
        };
        let delta_type = delta.get("type").and_then(|v| v.as_str()).unwrap_or("");
        match delta_type {
            "input_json_delta" => {
                if let Some(part) = delta.get("partial_json").and_then(|v| v.as_str()) {
                    self.tool_json.entry(index).or_default().push_str(part);
                }
            }
            "thinking_delta" => {
                if let Some(t) = delta.get("thinking").and_then(|v| v.as_str()) {
                    self.thinking_text.entry(index).or_default().push_str(t);
                }
            }
            "signature_delta" => {
                if let Some(s) = delta.get("signature").and_then(|v| v.as_str()) {
                    self.thinking_sig.entry(index).or_default().push_str(s);
                }
            }
            _ => {}
        }
    }

    fn tool_calls(&self) -> Vec<ToolUseEvent> {
        let mut idx: Vec<usize> = self.tool_ids.keys().copied().collect();
        idx.sort_unstable();
        idx.into_iter()
            .filter_map(|i| {
                let (id, name) = self.tool_ids.get(&i)?;
                if name.is_empty() {
                    return None;
                }
                let raw = self.tool_json.get(&i).map(String::as_str).unwrap_or("");
                let input = if raw.trim().is_empty() {
                    serde_json::Value::Object(serde_json::Map::new())
                } else {
                    serde_json::from_str(raw)
                        .unwrap_or(serde_json::Value::Object(serde_json::Map::new()))
                };
                Some(ToolUseEvent {
                    id: if id.is_empty() {
                        format!("call-{i}")
                    } else {
                        id.clone()
                    },
                    name: name.clone(),
                    input,
                })
            })
            .collect()
    }

    fn thinking(&self) -> Vec<ThinkingEvent> {
        let mut idx: Vec<usize> = self.thinking_text.keys().copied().collect();
        idx.sort_unstable();
        idx.into_iter()
            .map(|i| ThinkingEvent {
                thinking: self.thinking_text.get(&i).cloned().unwrap_or_default(),
                signature: self.thinking_sig.get(&i).cloned().unwrap_or_default(),
            })
            .collect()
    }
}

/// O7 — istek gövdesinin kurulumu (saf fonksiyon, test edilebilir).
/// `system` değer bütünlüğü korunur: TS tarafı eşik kararı verir ve düz
/// string YA DA `[{type:'text', text, cache_control:{type:'ephemeral'}}]`
/// dizisi gönderir; Rust passthrough olur. Boş string/Null → alan hiç
/// konmaz (API 400 koruması ile işaretlenmiş boş blok göndermemek için).
#[allow(clippy::too_many_arguments)]
fn build_request_body(
    model: &str,
    max_tokens: Option<u32>,
    system: Option<serde_json::Value>,
    messages: Vec<serde_json::Value>,
    tools: Option<serde_json::Value>,
    thinking: Option<serde_json::Value>,
    temperature: Option<f64>,
    top_p: Option<f64>,
) -> serde_json::Value {
    let mut body = serde_json::json!({
        "model": model,
        "max_tokens": max_tokens.unwrap_or(4096),
        "stream": true,
        "messages": messages,
    });
    if let Some(sp) = system {
        let empty_text = sp.as_str().is_some_and(|s| s.trim().is_empty());
        if !sp.is_null() && !empty_text {
            body["system"] = sp;
        }
    }
    if let Some(t) = tools {
        if !t.is_null() {
            body["tools"] = t;
        }
    }
    if let Some(th) = thinking {
        if !th.is_null() {
            body["thinking"] = th;
        }
    }
    if let Some(temp) = temperature {
        body["temperature"] = serde_json::json!(temp);
    }
    if let Some(tp) = top_p {
        body["top_p"] = serde_json::json!(tp);
    }
    body
}

/// Anthropic SSE proxy: WebView CORS'una takilmamak icin istek Rust'tan cikar,
/// token'lar Tauri IPC Channel uzerinden istemciye akar.
/// Faz 4 (K7): tool-use + vision + thinking destekler; istek gövdesi frontend'de
/// (`buildAnthropicMessages`) kurulur, Rust saf proxy'dir.
///
/// O7 cache düzeltmesi: `system` artık `serde_json::Value` (string YA DA
/// cache_control'lu blok dizisi). Eşik kararı TS'te (`promptCache.ts`
/// `cacheableBySize`) verilir ve fetch/Rust İKİ yolu da aynı gövdeyi kurar —
/// eskiden Rust yolu system önekini asla işaretlemiyordu (cacheWrite hep 0).
///
/// Hata sozlesmesi: HTTP hata -> `Err("http {status}: {snippet}")`
/// (frontend status'u parse edip ProviderError'a cevirir).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn stream_anthropic(
    api_key: String,
    model: String,
    system: Option<serde_json::Value>,
    messages: Vec<serde_json::Value>,
    tools: Option<serde_json::Value>,
    thinking: Option<serde_json::Value>,
    temperature: Option<f64>,
    top_p: Option<f64>,
    max_tokens: Option<u32>,
    on_chunk: Channel<StreamEvent>,
) -> Result<(), String> {
    if api_key.trim().is_empty() {
        return Err("http 401: api anahtarı eksik".to_string());
    }
    let body = build_request_body(
        &model,
        max_tokens,
        system,
        messages,
        tools,
        thinking,
        temperature,
        top_p,
    );

    // L2: yönlendirme TAMAMEN kapalı — reqwest varsayılan politikası (10 hops)
    // `Authorization`'ı cross-host'ta düşürür ama `x-api-key` DÜŞÜRMEZ; API
    // zaten redirect kullanmadığından 3xx yanıtı `http 3xx` hatası olarak döner.
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("istemci kurulamadı: {e}"))?;
    let res = client
        .post("https://api.anthropic.com/v1/messages")
        .header("content-type", "application/json")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("ag hatasi: {e}"))?;

    let status = res.status();
    if !status.is_success() {
        let text = res.text().await.unwrap_or_default();
        let snippet: String = text.chars().take(300).collect();
        let msg = if snippet.is_empty() {
            format!("http {}", status.as_u16())
        } else {
            format!("http {}: {}", status.as_u16(), snippet)
        };
        return Err(msg);
    }

    let mut acc = StreamAcc::default();
    let mut stream = res.bytes_stream();
    let mut buf = String::new();

    macro_rules! pump {
        ($line:expr, $acc:expr, $on_chunk:expr) => {{
            for ev in handle_sse_line($line, $acc)? {
                // Kanal kapandıysa istemci abort etmiş/gitmiş demektir:
                // akışı sessizce bitir, boşa indirme yapma.
                if $on_chunk.send(ev).is_err() {
                    return Ok(());
                }
            }
        }};
    }

    while let Some(item) = stream.next().await {
        let bytes = item.map_err(|e| format!("ag hatasi: {e}"))?;
        buf.push_str(&String::from_utf8_lossy(&bytes));
        while let Some(nl) = buf.find('\n') {
            let line: String = buf.drain(..=nl).collect();
            pump!(&line, &mut acc, on_chunk);
        }
    }
    if !buf.trim().is_empty() {
        for line in buf.split('\n') {
            pump!(line, &mut acc, on_chunk);
        }
    }

    // Final birikmiş listeler (thinking önce: Anthropic sıra kuralı).
    let thinking = acc.thinking();
    if !thinking.is_empty()
        && on_chunk
            .send(StreamEvent {
                text: String::new(),
                done: false,
                error: None,
                usage: None,
                reasoning: None,
                tool_calls: None,
                thinking: Some(thinking),
            })
            .is_err()
    {
        return Ok(());
    }
    let calls = acc.tool_calls();
    if !calls.is_empty()
        && on_chunk
            .send(StreamEvent {
                text: String::new(),
                done: false,
                error: None,
                usage: None,
                reasoning: None,
                tool_calls: Some(calls),
                thinking: None,
            })
            .is_err()
    {
        return Ok(());
    }

    let _ = on_chunk.send(done_ev());
    Ok(())
}

/// Tek SSE satirindan cikan olaylar (text/reasoning ve/veya usage).
/// Bos vec = atlanan satir; hata event'i `Err` doner.
/// Başarıyla parse edilen her payload ayrıca `acc` birikimine beslenir
/// (tool_use + thinking final listeleri için).
fn handle_sse_line(line: &str, acc: &mut StreamAcc) -> Result<Vec<StreamEvent>, String> {
    let t = line.trim();
    if t.is_empty() || t.starts_with(':') || t.starts_with("event:") {
        return Ok(vec![]);
    }
    let payload = if let Some(rest) = t.strip_prefix("data:") {
        rest.trim_start()
    } else {
        return Ok(vec![]);
    };
    if payload == "[DONE]" {
        return Ok(vec![]);
    }
    // Bozuk satır tüm akışı öldürmez: atla (fetch yolundaki parseJsonPayload ile aynı).
    let Ok(json) = serde_json::from_str::<serde_json::Value>(payload) else {
        return Ok(vec![]);
    };
    if json.get("type").and_then(|v| v.as_str()) == Some("error") {
        let msg = json
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("anthropic hata");
        return Err(msg.to_string());
    }
    acc.feed(&json);
    let mut out = Vec::new();
    let kind = json.get("type").and_then(|v| v.as_str()).unwrap_or("");
    // message_start usage (input) / message_delta usage (output, kumulatif)
    let start_usage = json.get("message").and_then(|m| m.get("usage"));
    let delta_usage = if kind == "message_delta" {
        json.get("usage")
    } else {
        None
    };
    for u in [start_usage, delta_usage].into_iter().flatten() {
        let input = u.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
        let output = u.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
        if input > 0 || output > 0 {
            out.push(usage_ev(input, output));
        }
    }
    let is_delta = kind == "content_block_delta";
    let delta_type = json
        .get("delta")
        .and_then(|d| d.get("type"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if is_delta && delta_type == "text_delta" {
        if let Some(text) = json
            .get("delta")
            .and_then(|d| d.get("text"))
            .and_then(|v| v.as_str())
        {
            if !text.is_empty() {
                out.push(text_ev(text.to_string()));
            }
        }
    }
    // Faz 4: extended thinking anlık akışı (dim blok).
    if is_delta && delta_type == "thinking_delta" {
        if let Some(t) = json
            .get("delta")
            .and_then(|d| d.get("thinking"))
            .and_then(|v| v.as_str())
        {
            if !t.is_empty() {
                out.push(reasoning_ev(t.to_string()));
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn acc_of(lines: &[&str]) -> StreamAcc {
        let mut acc = StreamAcc::default();
        for l in lines {
            let _ = handle_sse_line(l, &mut acc);
        }
        acc
    }

    fn body_with_system(sys: Option<serde_json::Value>) -> serde_json::Value {
        build_request_body(
            "claude-sonnet-5",
            Some(64),
            sys,
            vec![],
            None,
            None,
            None,
            None,
        )
    }

    /// O7 (Faz 11 paritesi) — `system` passthrough: fetch yolu ile Rust yolu
    /// AYNI gövdeyi kurmalı; eşik kararı TS'te, passthrough Rust'ta.
    #[test]
    fn o7_system_passthrough_cache_dizisi() {
        // 1) Düz string aynen gider.
        let b = body_with_system(Some(serde_json::json!("yönergeler")));
        assert_eq!(b["system"], serde_json::json!("yönergeler"));

        // 2) Asıl düzelme: cache_control'lu blok dizisi birebir geçer.
        let marked = serde_json::json!([
            {"type": "text", "text": "uzun sistem metni", "cache_control": {"type": "ephemeral"}}
        ]);
        let b2 = body_with_system(Some(marked.clone()));
        assert_eq!(b2["system"], marked);
        assert_eq!(
            b2["system"][0]["cache_control"]["type"],
            serde_json::json!("ephemeral")
        );
    }

    #[test]
    fn o7_system_bos_string_alan_konmaz() {
        // Boş string (beyaz boşluk dahil) → system alanı hiç konmaz.
        assert!(body_with_system(Some(serde_json::json!("")))
            .get("system")
            .is_none());
        assert!(body_with_system(Some(serde_json::json!("  ")))
            .get("system")
            .is_none());
        // None (invoke'tan taşınmadı) ve Null → alan yok.
        assert!(body_with_system(None).get("system").is_none());
        assert!(body_with_system(Some(serde_json::Value::Null))
            .get("system")
            .is_none());
        // Temel alanlar her durumda korunur.
        let b = body_with_system(Some(serde_json::json!("meta")));
        assert_eq!(b["model"], "claude-sonnet-5");
        assert_eq!(b["max_tokens"], 64);
        assert_eq!(b["stream"], true);
        assert!(b["messages"].as_array().unwrap().is_empty());
    }

    #[test]
    fn o7_diger_sog_vde_alanlari_korunur() {
        let tools = serde_json::json!([{"name": "read_file"}]);
        let thinking = serde_json::json!({"type": "enabled", "budget_tokens": 1024});
        let b = build_request_body(
            "claude-opus-5-5",
            Some(256),
            None,
            vec![serde_json::json!({"role": "user", "content": "selam"})],
            Some(tools.clone()),
            Some(thinking.clone()),
            Some(0.7),
            None,
        );
        assert_eq!(b["tools"], tools);
        assert_eq!(b["thinking"], thinking);
        assert_eq!(b["temperature"], 0.7);
        assert!(b.get("top_p").is_none());
        // max_tokens verilmezse 4096 default.
        let b2 = build_request_body("m", None, None, vec![], None, None, None, None);
        assert_eq!(b2["max_tokens"], 4096);
    }

    #[test]
    fn skip_lines_atlanir() {
        let mut acc = StreamAcc::default();
        assert!(handle_sse_line("", &mut acc).unwrap().is_empty());
        assert!(handle_sse_line(": yorum", &mut acc).unwrap().is_empty());
        assert!(handle_sse_line("event: message_start", &mut acc)
            .unwrap()
            .is_empty());
        assert!(handle_sse_line("data: [DONE]", &mut acc)
            .unwrap()
            .is_empty());
        // Bozuk satır akışı öldürmez, atlanır.
        assert!(handle_sse_line("data: {bozuk", &mut acc)
            .unwrap()
            .is_empty());
        assert!(handle_sse_line("data: 42", &mut acc).unwrap().is_empty());
    }

    #[test]
    fn text_delta_cikarilir() {
        let mut acc = StreamAcc::default();
        let evs = handle_sse_line(
            r#"data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"merhaba"}}"#,
            &mut acc,
        )
        .unwrap();
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].text, "merhaba");
    }

    #[test]
    fn usage_cikarilir() {
        let mut acc = StreamAcc::default();
        let evs = handle_sse_line(
            r#"data: {"type":"message_start","message":{"usage":{"input_tokens":12,"output_tokens":0}}}"#,
            &mut acc,
        )
        .unwrap();
        assert_eq!(evs.len(), 1);
        let u = evs[0].usage.as_ref().unwrap();
        assert_eq!((u.input, u.output), (12, 0));
    }

    #[test]
    fn error_tipi_hata_doner() {
        let mut acc = StreamAcc::default();
        let err = handle_sse_line(
            r#"data: {"type":"error","error":{"message":"kota bitti"}}"#,
            &mut acc,
        )
        .unwrap_err();
        assert_eq!(err, "kota bitti");
    }

    #[test]
    fn tool_use_akisi_birikilir() {
        let acc = acc_of(&[
            r#"data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"read_file"}}"#,
            r#"data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"path\":"}}"#,
            r#"data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\"a.ts\"}"}}"#,
        ]);
        let calls = acc.tool_calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].id, "toolu_1");
        assert_eq!(calls[0].name, "read_file");
        assert_eq!(
            calls[0].input.get("path").and_then(|v| v.as_str()),
            Some("a.ts")
        );
        // İsimsiz bloklar elenir.
        let acc2 = acc_of(&[
            r#"data: {"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"x"}}"#,
        ]);
        assert!(acc2.tool_calls().is_empty());
    }

    #[test]
    fn thinking_akisi_imzali_birikilir() {
        let acc = acc_of(&[
            r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"önce "}}"#,
            r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"sonra"}}"#,
            r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig-abc"}}"#,
        ]);
        let th = acc.thinking();
        assert_eq!(th.len(), 1);
        assert_eq!(th[0].thinking, "önce sonra");
        assert_eq!(th[0].signature, "sig-abc");
    }

    #[test]
    fn thinking_delta_anlik_reasoning_eventi_uretir() {
        let mut acc = StreamAcc::default();
        let evs = handle_sse_line(
            r#"data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hmm"}}"#,
            &mut acc,
        )
        .unwrap();
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].reasoning.as_deref(), Some("hmm"));
    }
}
