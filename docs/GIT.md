# Git entegrasyonu

MacroCode'un Git entegrasyonu, repo'yu **uygulama içinden** görmek ve küçük
günlük işlemleri yapmak için tasarlandı. Git istemcisinin tamamı değildir:
tarihçe, diff, stage/unstage, commit, branch değiştirme ve fast-forward
push/pull/fetch vardır.

> **Tasarım ilkesi:** Yeni bağımlılık yok. Git, Rust tarafında **git CLI**
> üzerinden çalıştırılır (`src-tauri/src/commands/git.rs`); frontend yalnızca
> tipli `invoke` komutları görür (`src/lib/git/api.ts`).

## 1. Güvenlik modeli

Mevcut workspace jail'i Git için de geçerlidir.

| Konu | Kural |
|---|---|
| Repo sınırı | Repo kökü **workspace köküne eşit** olmalı. Workspace bir üst repo'nun alt klasörüyse tüm mutasyonlar `E_REPO_OUTSIDE_WORKSPACE` ile reddedilir; panel yalnızca yönlendirme gösterir. |
| Bare repo | Reddedilir (`E_BARE_REPO`). |
| Shell | **Yok.** `Command::new("git").args([...])`; hiçbir argüman `sh -c` içinden geçmez. |
| Yol doğrulama | Repo-göreli yol zorunlu; mutlak yol, `..`, baştaki `-`, `:`, NUL/satır sonu ve `.git` reddedilir. Pathspec'ler **her zaman** `--` sonrasında verilir. |
| Bloklu/secret dosyalar | `engine/blocks.json` listeleri (dizin, dosya, `secretExts`, `dataExts`) stage/diff/discard'da reddedilir; UI bu satırları eylemsiz gösterir. |
| Branch adı | Hızlı kontrol + otoriter `git check-ref-format --branch`. |
| Commit mesajı | Boş/NUL/5.000+ karakter reddedilir; mesaj **stdin** (`git commit -F -`) ile gider, komut satırına gömülmez. |
| SHA | `git show` yalnızca 4–40 hex karakter kabul eder. |
| Kimlik istemi | `GIT_TERMINAL_PROMPT=0`, `SSH_ASKPASS_REQUIRE=never`; uygulama asla parola sormaz. Kimlik doğrulama gerekiyorsa `E_AUTH_REQUIRED` döner ve terminalde çalıştırma önerilir. |
| Ortam | Dış ortamdan gelen `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_NAMESPACE`, `GIT_ASKPASS`, `SSH_ASKPASS` temizlenir; başka bir depoya yönlendirme engellenir. |
| Klasör stage | `git add -- <klasör>` verilirse `git ls-files` ile (tracked + untracked, ignore hariç) genişletilir; içinde secret/bloklu dosya varsa tüm işlem `E_INVALID_PATH` ile reddedilir. |
| Ağ | `fetch`/`pull`/`push` 90 sn, diğer komutlar 15 sn timeout; çıktı 4 MB'ta kesilir. |
| Salt okunur | Okuma komutlarında `GIT_OPTIONAL_LOCKS=0`, `GIT_PAGER=cat`, `LC_ALL=C`, `GIT_CEILING_DIRECTORIES=<parent>`. |
| Diff | `--no-ext-diff`, `--no-textconv`, `core.fsmonitor=false`, `core.quotepath=false`. |

### Onay gerektiren işlemler

- Stage/unstage: **onay istemez** (geri alınabilir).
- Discard, commit/amend, push, pull, branch değiştirme/oluşturma, init:
  **onay ister**. Diyalog, Git hook'larının çalışabileceğini açıkça söyler.
- `pull` yalnızca `--ff-only`; merge/rebase otomatik başlatılmaz.

## 2. v1 kapsamı

**Var:** status, diff (staged/unstaged/untracked), log, commit detayı, branch
listesi, stage/unstage, discard, commit/amend, branch switch/create, fetch,
pull, push, init, uzak işlemler.

**Yok (bilinçli):** merge, rebase, cherry-pick, revert, `reset --hard`,
force push, remote ekleme/silme, untracked dosya silme, credential saklama.

## 3. Arayüz

- **Sağ dock paneli** (`components/git/GitPanel.tsx`): Değişiklikler / Geçmiş /
  Branch'ler sekmeleri; yeniden boyutlandırılabilir; 6 sn'de bir yoklama.
- **Durum çubuğu rozeti**: branch, ahead/behind ve kirli dosya sayısı; tıklayınca
  panel açılır.
- **`/git` komutları** (`lib/git/commands.ts`): `status`, `diff`, `log`,
  `branch`, `switch [-c] <ad>`, `add`, `unstage`, `commit`, `push`, `pull`,
  `fetch`, `init`, `help`. `commit --amend` mesajsız verilirse son commit
  mesajı yeniden kullanılır.
- **AI commit mesajı**: yalnızca kullanıcı onayından sonra; stage edilmiş diff
  secret dosyalardan arındırılır, 12 KB'a kısaltılır ve **otomatik commit
  yapılmaz**. Mesaj commit kutusuna yazılır.

Tüm metinler beş dilde (TR/EN/DE/FR/ES) çevrilidir.

## 4. Veri akışı

```
React (zustand: store/git.ts)
  → lib/git/api.ts (invoke)
    → src-tauri/src/commands/git.rs
      → git CLI (shell yok, jail'li cwd)
```

`git status --porcelain=v2 --branch -z` çıktısı Rust'ta katı bir ayrıştırıcıdan
geçer; rename kaydının ikinci NUL alanı `origPath` olarak tüketilir. Frontend
`lib/git/diff.ts` ile unified diff'i dosya → hunk → satır ağacına çevirir.

## 5. Hata kodları

`GitError { code, message }` döner. Frontend `lib/git/errors.ts` ile kodu
i18n anahtarına eşler. Başlıca kodlar:

`E_GIT_MISSING`, `E_NOT_REPO`, `E_REPO_OUTSIDE_WORKSPACE`, `E_BARE_REPO`,
`E_INVALID_ROOT`, `E_INVALID_PATH`, `E_INVALID_BRANCH`, `E_INVALID_MESSAGE`,
`E_INVALID_SHA`, `E_NOTHING_STAGED`, `E_CONFLICT`, `E_OPERATION_IN_PROGRESS`,
`E_HOOK_FAILED`, `E_AUTH_REQUIRED`, `E_NO_REMOTE`, `E_NO_UPSTREAM`,
`E_NOT_FAST_FORWARD`, `E_DETACHED`, `E_UNTRACKED_DISCARD`, `E_TIMEOUT`,
`E_OUTPUT_TOO_LARGE`, `E_GIT_FAILED`, `E_TAURI_ONLY`.

## 6. Doğrulama

```bash
npm test
npx tsc --noEmit
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

Git'e özel testler:

- Rust: `commands::git::tests::*` (porcelain parser, path/branch/message/SHA
  doğrulaması).
- TS: `src/lib/git/{diff,policy,commitMessage,commands}.test.ts`.
