MacroCode is in active early development.

I am the sole developer and maintainer of this project, so there may be vulnerabilities I have missed.
I am actively working on further development. Thank you for your understanding.

## Git entegrasyonu (2026-11-05)

Git, Rust tarafında **git CLI** ile çalışır; shell kullanılmaz.

- Repo kökü workspace köküne eşit değilse mutasyon reddedilir; bare repo desteklenmez.
- Yollar repo-göreli ve `--` sonrası verilir; mutlak yol, `..`, baştaki `-`, `:`,
  NUL/satır sonu ve `.git`/secret/bloklu dosyalar reddedilir.
- Branch adı `git check-ref-format --branch` ile otoriter doğrulanır.
- Commit mesajı stdin (`git commit -F -`) ile gider; komut satırına gömülmez.
- Kimlik istemi kapatılmıştır (`GIT_TERMINAL_PROMPT=0`, `SSH_ASKPASS_REQUIRE=never`);
  uygulama parola/credential saklamaz. Kimlik gereken işlem `E_AUTH_REQUIRED` döner.
- Diff `--no-ext-diff --no-textconv`, `core.fsmonitor=false`,
  `core.quotepath=false` ile alınır; çıktı boyutu ve süre sınırlıdır.
- Stage/unstage onaysızdır; discard/commit/amend/push/pull/switch/init onay ister.
  Onay diyalogları Git hook'larının çalışabileceğini bildirir.
- `pull` yalnızca `--ff-only`; merge/rebase/force-push v1 kapsamı dışındadır.
- AI commit mesajı yalnızca açık onayla üretilir; secret dosyalar diff'ten çıkarılır,
  diff 12 KB'a kısaltılır ve **hiçbir zaman otomatik commit yapılmaz**.

Ayrıntılar: `docs/GIT.md`.


