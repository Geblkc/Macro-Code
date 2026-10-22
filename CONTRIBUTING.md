# CONTRIBUTING — MacroCode

## Kurulum

```bash
npm install
npm run build     # tsc + vite sorunsuz mu?
npm test          # testler yeşil mi?
```

`tauri dev/build` için Rust stable + sistem bağımlılıkları gerekir (bkz. `README.md`).
Ortamda Node yoksa `README.md`'deki taşınabilir Node v22 kurulumunu kullan.

## Test komutları

```bash
npm test                  # vitest, tek sefer (TS barı)
npx tsc --noEmit          # tip kontrolü
npm run build             # üretim derlemesi (smoke)
cargo test --lib          # Rust birim testleri (src-tauri altında)
cargo fmt && cargo fmt --check
```

## Faz kapanış kuralı

Bir faz yalnızca şunlar tamamsa kapanır:

1. Tüm testler yeşil (`npm test` + `cargo test --lib`).
2. Yol haritasındaki kabul kriterleri karşılanmış.
3. `docs/ARCHITECTURE.md` güncel (mimari sonucu) + `docs/DEVLOG.md`
   tarihli giriş eklenmiş. Sürüm politikası ayrıca belirtilmedikçe numara oynatılmaz.

## Allowlist değiştirme prosedürü (TS + Rust)

`exec` allowlist'in tek kaynağı `src/lib/engine/allowlist.json`'dur:

1. Değişikliği **yalnızca** `allowlist.json`'da yap (`rm` satırı eklenemez — `isRmSafe` kuralı sabittir).
2. `src/lib/engine/policy.test.ts` drift testini güncelle/koş (TS↔JSON birebirlik).
3. `src-tauri/src/commands/exec.rs` testlerini güncelle/koş (`cargo test --lib`).
4. `exec` her zaman manuel onaylıdır (O6) — `autoApproved` asla `true` yapılmaz.

## Kod uzlaşımları

- **UI metinleri `src/lib/i18n/locales/` altındadır** — bileşende doğrudan Türkçe
  metin yazma. `tr.ts` **kaynak gerçektir**; yeni anahtar eklendiğinde diğer 4
  sözlüğe (`en/de/fr/es`) de karşılığı eklenir (TS `Record` + bütünlük testi
  eksik anahtarı yakalar). React'te `useT()`, React dışı modüllerde
  `lib/i18n/core` → `t()` kullan.
- **Modele giden metinler** (`toolspec.ts` tool açıklamaları) İngilizce ve
  sabittir — dil değişiminden etkilenmez.
- Kod yorumları kısa; yeni renk eklenmez (`styles/global.css` token'ları kullanılır).
- `Message`/`Session` şema değişikliği = `normalizeSession` roundtrip testi zorunlu.
- Yeni invoke komutu = `mod.rs` + `lib.rs` kaydı + Rust testi.
