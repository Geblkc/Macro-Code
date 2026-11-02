# MacroCode — GitHub'a Yeni Sürüm Yükleme Kılavuzu

Bu doküman, MacroCode projesinin yeni bir sürümünü GitHub'a yüklemek için gereken tüm adımları sırayla açıklar. Tüm komutlar proje kök dizininde (`/home/efeb/Masaüstü/MacroCode`) çalıştırılmalıdır.

---

## 📋 Ön Koşullar

- [ ] `git` kurulu ve repo'ya erişim var
- [ ] `gh` (GitHub CLI) kurulu ve authenticated (`gh auth status`)
- [ ] `npm` ve `cargo` kurulu
- [ ] Linux build araçları kurulu (deb/rpm/appimage için)
- [ ] Tüm testler geçiyor (`npm test`, `cargo test`)
- [ ] Build başarılı (`npm run build`)
- [ ] Updater imzalama anahtarı hazır (`~/.tauri/macrocode.key`)
- [ ] GitHub secret'ları tanımlı: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

---

## 1. Sürüm Bump (Versiyon Güncelleme)

Yeni sürüm numarasını belirleyin (örn. `0.2.2`). Aşağıdaki dosyalarda sürümü güncelleyin:

### 1.1 `package.json`
```json
"version": "0.2.2"
```

### 1.2 `src-tauri/Cargo.toml`
```toml
version = "0.2.2"
```

### 1.3 `bundles/README.md` (varsa)
Dosya adlarındaki sürüm referanslarını güncelleyin (örn. `MacroCode_0.2.2_amd64.deb`).

### 1.4 Sürüm bump scripti (opsiyonel)
```bash
bash scripts/release.sh 0.2.2
```
> Bu script sürüm bump + tag + push işlemlerini otomatik yapar. Manuel yapmak isterseniz aşağıdaki adımları izleyin.

---

## 2. Test ve Build Doğrulaması

### 2.1 Frontend testleri
```bash
npm test
```
Beklenen: Tüm testler geçmeli (0 failed).

### 2.2 Rust testleri
```bash
cd src-tauri && cargo test && cd ..
```
Beklenen: Tüm testler geçmeli (0 failed).

### 2.3 Frontend build
```bash
npm run build
```
Beklenen: `✓ built in X.XXs` mesajı.

### 2.4 Tauri build (Linux paketleri)
```bash
npm run tauri build -- --bundles deb,rpm,appimage
```
Beklenen: `src-tauri/target/release/bundle/` altında `.deb`, `.rpm`, `.AppImage` dosyaları.

---

## 3. Bundles Klasörünü Hazırlama

### 3.1 Bundles klasörü oluştur (yoksa)
```bash
mkdir -p bundles
```

### 3.2 Paketleri bundles'a kopyala
```bash
cp src-tauri/target/release/bundle/deb/*.deb      bundles/
cp src-tauri/target/release/bundle/rpm/*.rpm      bundles/
# AppImage ile birlikte `.AppImage.sig` dosyası da kopyalanmalı (updater için).
cp src-tauri/target/release/bundle/appimage/*     bundles/
ls -lh bundles/
```
> `TAURI_SIGNING_PRIVATE_KEY` tanımlı değilse `tauri build` şu hatayı verir:
> `A public key has been found, but no private key`. Anahtar üretimi için
> bölüm **6.1**'e bakın.

### 3.3 SHA256SUMS oluştur
```bash
cd bundles && sha256sum -- * > SHA256SUMS && cat SHA256SUMS && cd ..
```

### 3.4 README.md güncelle (varsa)
`bundles/README.md` dosyasındaki sürüm referanslarını ve paket boyutlarını güncelleyin.

---

## 4. Release Notes Yazma

`bundles/releasenote.md` dosyasını oluşturun/güncelleyin. İçerik şunları içermelidir:

- Sürüm numarası ve tarih
- Önceki sürümden farklar (yeni özellikler, hata düzeltmeleri, güvenlik)
- Test ve doğrulama sonuçları
- Dağıtım paketleri listesi
- Notlar (varsa)

**Şablon:**
```markdown
# MacroCode vX.Y.Z — Release Notes

**Date:** <tarih>
**Previous Version:** vX.Y.(Z-1)

---

## 🎯 Overview
...

## 🔒 Security / Features / Fixes
...

## 🧪 Testing & Verification
...

## 📦 Distribution Packages
...

## 📝 Notes
...
```

---

## 5. Git İşlemleri

### 5.1 Değişiklikleri stage'le
```bash
git add -A
```
> **Not:** `Security.md` dosyası kullanıcıya ait untracked dosyadır; commit'e dahil edilmemelidir. Gerekirse:
> ```bash
> git reset HEAD Security.md
> ```

### 5.2 Commit oluştur
```bash
git commit -m "feat: vX.Y.Z — <kısa açıklama>"
```

### 5.3 Tag oluştur
```bash
git tag vX.Y.Z
```

### 5.4 Push (commit + tag)
```bash
git push origin main vX.Y.Z
```

> **Dikkat:** Remote'da yeni commit'ler varsa önce `git pull origin main --no-rebase --no-edit` yapın, merge commit oluşturun, sonra push edin.

---

## 6. GitHub Actions Workflow (Otomatik)

Tag push edildiğinde (`.github/workflows/release.yml`) otomatik olarak:

1. **Linux job** (ubuntu-22.04):
   - Testler çalıştırılır (`tsc --noEmit`, `npm test`, `npm run build`, `cargo test`)
   - Linux paketleri derlenir (deb, rpm, appimage)
   - Artifact olarak yüklenir

2. **Windows job** (windows-latest):
   - Windows paketleri derlenir (NSIS .exe, .msi)
   - Artifact olarak yüklenir

3. **Release job** (linux + windows tamamlandıktan sonra):
   - Tüm artifact'lar indirilir
   - `SHA256SUMS` yeniden üretilir (tüm dosyalar dahil)
   - GitHub Release oluşturulur (`softprops/action-gh-release@v2`)
   - Tüm paketler release'e yüklenir

---

## 6.1 Otomatik Güncelleme (updater) — İmzalama ve `latest.json`

Uygulama içi `/update` komutu ve açılış kontrolü, Tauri updater'ın imzalı
`latest.json` dosyasını okur. Bu dosya **release job'unda otomatik üretilir**;
elle müdahale gerekmez. Ancak imzalama anahtarı ve GitHub secret'ları doğru
olmalıdır.

### 6.1.1 İmzalama anahtarı (yalnızca bir kez)

```bash
mkdir -p ~/.tauri
# Parolayı güvenli bir yerde saklayın — kaybedilirse yeni sürümler
# eski kurulumlar tarafından doğrulanamaz.
npx tauri signer generate --ci \
  -p "$(openssl rand -hex 24)" \
  -w ~/.tauri/macrocode.key
cat ~/.tauri/macrocode.key.pub
```
> Genel anahtar (`*.key.pub`) `src-tauri/tauri.conf.json` →
> `plugins.updater.pubkey` alanına yazılır. Özel anahtar **asla** repoya
> commit edilmez.

### 6.1.2 GitHub secret'ları

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/macrocode.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD <<< '<parola>'
gh secret list
```

### 6.1.3 `latest.json` biçimi ve platform sınırları

Release job'u aşağıdaki yapıyı üretir ve `bundles/latest.json` olarak yükler:

```json
{
  "version": "X.Y.Z",
  "notes": "...",
  "pub_date": "2026-01-01T00:00:00Z",
  "platforms": {
    "linux-x86_64":   { "signature": "<.AppImage.sig içeriği>", "url": "...AppImage" },
    "windows-x86_64": { "signature": "<.exe.sig içeriği>",      "url": "...-setup.exe" }
  }
}
```

Endpoint: `https://github.com/Geblkc/Macro-Code/releases/latest/download/latest.json`

- **Linux:** yalnızca **AppImage** otomatik güncellenir. `.deb` / `.rpm` ile
  kurulan sürümlerde `/update` kullanıcıyı release sayfasına yönlendirir
  (`update_support` → `kind: "package"`).
- **Windows:** NSIS `*-setup.exe` otomatik kurulur (`installMode: passive`).
- **macOS:** kod olarak desteklenir; CI'da macOS build'i yok.

### 6.1.4 İlk updater sürümü

Updater kodu **bu sürümden önceki** kurulumlarda yoktur. Bu nedenle ilk
updater'lı sürüm (örn. `v0.3.0`) kullanıcılar tarafından **bir kez elle**
kurulmalıdır; sonraki sürümler otomatik güncellenebilir.

### 6.1.5 Elle (workflow'suz) release'de updater

`gh release create` kullanıyorsanız `latest.json` otomatik oluşmaz. Şunları
yapın:

1. `.sig` dosyalarını da yükleyin (`bundles/*` zaten dahil eder).
2. Bölüm 6.1.3'teki `latest.json`'u üretip release'e ekleyin:
   ```bash
   gh release upload vX.Y.Z bundles/latest.json --clobber
   ```
3. `latest.json` içindeki `url` alanları o release'in **gerçek** asset
   adreslerini göstermelidir.

### Workflow durumunu kontrol etme:
```bash
gh run list --workflow=release.yml --limit 5
```

### Workflow'u elle tetikleme (gerekirse):
```bash
gh workflow run release.yml --ref vX.Y.Z
```

---

## 7. Manuel Release (Workflow yerine)

Workflow çalışmazsa veya elle release oluşturmak isterseniz:

### 7.1 Release oluştur
```bash
gh release create vX.Y.Z \
  --title "MacroCode vX.Y.Z" \
  --notes-file bundles/releasenote.md \
  bundles/*
```

### 7.2 Release'i doğrula
```bash
gh release view vX.Y.Z --json assets --jq '.assets[].name'
```

Beklenen çıktı:
```
MacroCode-X.Y.Z-1.x86_64.rpm
MacroCode_X.Y.Z_amd64.AppImage
MacroCode_X.Y.Z_amd64.AppImage.sig
MacroCode_X.Y.Z_amd64.deb
MacroCode_X.Y.Z_x64-setup.exe
MacroCode_X.Y.Z_x64-setup.exe.sig
MacroCode_X.Y.Z_x64_en-US.msi
latest.json
releasenote.md
SHA256SUMS
```
> `latest.json` yoksa uygulama içi otomatik güncelleme çalışmaz; bölüm
> **6.1.5**'e bakın.

---

## 8. Doğrulama Checklist

- [ ] `npm test` — tüm testler geçti
- [ ] `cargo test` — tüm testler geçti
- [ ] `npm run build` — başarılı
- [ ] `bundles/` klasöründe güncel paketler var
- [ ] `bundles/SHA256SUMS` güncellendi
- [ ] `bundles/releasenote.md` yazıldı
- [ ] `.sig` dosyaları ve `latest.json` release'de mevcut (updater)
- [ ] `latest.json` sürümü/URL'leri release ile eşleşiyor
- [ ] Git commit oluşturuldu
- [ ] Tag `vX.Y.Z` oluşturuldu ve push'landı
- [ ] GitHub Actions workflow tamamlandı (linux + windows)
- [ ] GitHub Release'de tüm paketler (Linux + Windows) var
- [ ] Release notes doğru görünüyor

---

## 9. Sorun Giderme

### Push reddedilirse (remote ahead)
```bash
git pull origin main --no-rebase --no-edit
git push origin main vX.Y.Z
```

### Tag zaten varsa
```bash
git tag -d vX.Y.Z
git tag vX.Y.Z
git push origin vX.Y.Z --force
```

### Workflow başarısız olursa
```bash
# Logları kontrol et
gh run view <run-id> --log

# Tekrar tetikle
gh workflow run release.yml --ref vX.Y.Z
```

### Windows paketleri eksikse
Workflow'un `windows` job'unu kontrol edin. `windows-latest` runner'da NSIS/MSI build hatası olabilir. `npm ci` ve `npm run tauri build -- --bundles nsis,msi` adımlarını kontrol edin.

---

## 📌 Hızlı Referans (Tek Komut)

Tüm adımları tek seferde çalıştırmak için (manuel release, workflow olmadan):

```bash
# 1. Test + Build
npm test && cargo test --manifest-path src-tauri/Cargo.toml && npm run build

# 2. Paketleri topla
mkdir -p bundles
cp src-tauri/target/release/bundle/deb/*.deb bundles/
cp src-tauri/target/release/bundle/rpm/*.rpm bundles/
cp src-tauri/target/release/bundle/appimage/* bundles/
cd bundles && sha256sum -- * > SHA256SUMS && cd ..

# 3. Commit + Tag + Push
git add -A && git commit -m "feat: vX.Y.Z — release" && git tag vX.Y.Z
git push origin main vX.Y.Z

# 4. Release oluştur (workflow tamamlanana kadar bekle veya manuel)
gh release create vX.Y.Z --title "MacroCode vX.Y.Z" --notes-file bundles/releasenote.md bundles/*
```

---

**MacroCode Release Guide** — Bu doküman her yeni sürüm yüklemede referans olarak kullanılır.
