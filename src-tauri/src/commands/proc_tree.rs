//! P0.2 — exec süreç ağacı yönetimi.
//!
//! İptal/timeout yalnızca doğrudan child'ı değil, onun başlattığı alt
//! süreçleri de sonlandırmalı. Platform farkı:
//!
//! - Unix: child kendi process group'unda başlatılır (`process_group(0)`);
//!   iptalde `kill(-pgid, SIGKILL)` tüm grubu öldürür.
//! - Windows: child bir Job Object'e atanır; iptalde `TerminateJobObject`
//!   job içindeki tüm süreçleri öldürür.
//!
//! `ProcTree` normal tamamlanmada `disarm` edilir. Beklenmedik bir dönüşte
//! (hata/erken `?`/future drop) guard drop olurken ağacı temizler.
//!
//! Windows Job Object `KILL_ON_JOB_CLOSE` ile kurulduğundan, normal
//! tamamlanmada job handle kapanınca job içinde kalmış torun süreçler de
//! temizlenir. Unix'te normal çıkışta `disarm` torunlara dokunmaz; yalnız
//! iptal/timeout/hata yolunda grup öldürülür.

/// Spawn öncesi platforma özel hazırlık. Unix'te yeni process group.
pub fn configure_command(cmd: &mut tokio::process::Command) {
    #[cfg(unix)]
    cmd.process_group(0);
    #[cfg(not(unix))]
    let _ = cmd;
}

/// Çalışan bir child'ın süreç ağacını temsil eder.
pub struct ProcTree {
    pid: u32,
    armed: bool,
    #[cfg(windows)]
    job: Option<windows_impl::JobHandle>,
}

impl ProcTree {
    /// Spawn sonrası çağrılır. Windows'ta Job Object kurulamazsa yine de
    /// `armed` kalır; `kill` bu durumda `taskkill /T` ile yedek yol dener.
    pub fn attach(child: &mut tokio::process::Child) -> Self {
        let pid = child.id().unwrap_or(0);
        #[cfg(windows)]
        let job = if pid > 0 {
            windows_impl::JobHandle::create(child)
        } else {
            None
        };
        Self {
            pid,
            armed: pid > 0,
            #[cfg(windows)]
            job,
        }
    }

    /// Süreç ağacını hemen sonlandırır. Birden fazla çağrı güvenlidir.
    pub fn kill(&self) {
        if self.pid == 0 {
            return;
        }
        #[cfg(unix)]
        unix_impl::kill_tree(self.pid);
        #[cfg(windows)]
        {
            match &self.job {
                Some(job) => job.terminate(),
                None => windows_impl::taskkill(self.pid),
            }
        }
    }

    /// Normal tamamlanmada drop sırasında açık `kill` çağrısını engeller.
    /// Windows'ta job handle'ın `KILL_ON_JOB_CLOSE` davranışı yine geçerlidir.
    pub fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for ProcTree {
    fn drop(&mut self) {
        if self.armed {
            self.kill();
        }
    }
}

#[cfg(unix)]
mod unix_impl {
    /// Yalnızca çocuk gerçekten kendi process group'undaysa grup sinyali
    /// gönderilir; aksi halde uygulamanın kendi grubunu öldürme riski vardır.
    pub(super) fn kill_tree(pid: u32) {
        unsafe {
            let p = pid as libc::pid_t;
            let pgid = libc::getpgid(p);
            let rc = if pgid == p && p > 0 {
                libc::kill(-p, libc::SIGKILL)
            } else if pgid > 0 {
                libc::kill(p, libc::SIGKILL)
            } else {
                return;
            };
            if rc != 0 {
                let e = std::io::Error::last_os_error();
                if e.raw_os_error() != Some(libc::ESRCH) {
                    eprintln!("[exec] süreç ağacı öldürülemedi (pid {pid}): {e}");
                }
            }
        }
    }
}

#[cfg(windows)]
mod windows_impl {
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle, RawHandle};
    use std::process::Stdio;
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    /// Job handle'ı `OwnedHandle` ile sarar; drop'ta `CloseHandle` çalışır.
    /// `KILL_ON_JOB_CLOSE` sayesinde uygulama çökse bile job kapanınca
    /// içindeki süreçler ölür.
    pub(super) struct JobHandle(OwnedHandle);

    impl JobHandle {
        pub(super) fn create(child: &tokio::process::Child) -> Option<Self> {
            unsafe {
                let raw = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if raw.is_null() {
                    return None;
                }
                let job = OwnedHandle::from_raw_handle(raw as RawHandle);

                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let ok = SetInformationJobObject(
                    job.as_raw_handle() as HANDLE,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const _,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                if ok == 0 {
                    return None;
                }

                let child_handle = child.raw_handle()?;
                if AssignProcessToJobObject(job.as_raw_handle() as HANDLE, child_handle as HANDLE)
                    == 0
                {
                    return None;
                }
                Some(Self(job))
            }
        }

        pub(super) fn terminate(&self) {
            unsafe {
                TerminateJobObject(self.0.as_raw_handle() as HANDLE, 1);
            }
        }
    }

    /// Job Object kurulamazsa (ör. nested job kısıtı) best-effort ağaç öldürme.
    pub(super) fn taskkill(pid: u32) {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::process::Stdio;
    use std::time::{Duration, Instant};
    use tokio::io::{AsyncBufReadExt, BufReader};

    /// En az bir alt süreç doğuran komut: alt süreç 0.5 sn sonra marker
    /// dosyası oluşturur. Ağaç öldürülmezse marker ortaya çıkar.
    #[test]
    fn p02_surec_agaci_torunlari_da_oldurur() {
        tauri::async_runtime::block_on(async {
            let marker = std::env::temp_dir().join(format!(
                "macrocode-tree-{}-{}.tmp",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0)
            ));
            let _ = std::fs::remove_file(&marker);

            let mut cmd = tokio::process::Command::new("/bin/sh");
            cmd.arg("-c")
                .arg("(sleep 0.5; touch \"$1\") & echo $!; wait")
                .arg("sh")
                .arg(&marker)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .kill_on_drop(true);
            configure_command(&mut cmd);
            let mut child = cmd.spawn().expect("sh başlatılamadı");
            let mut tree = ProcTree::attach(&mut child);

            let child_pid = child.id().expect("child pid yok") as libc::pid_t;
            unsafe {
                assert_eq!(
                    libc::getpgid(child_pid),
                    child_pid,
                    "child yeni process group'da değil"
                );
            }

            let stdout = child.stdout.take().expect("stdout yok");
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            reader
                .read_line(&mut line)
                .await
                .expect("torun pid okunamadı");
            let grandchild = line.trim().parse::<libc::pid_t>().expect("pid parse");

            tree.kill();
            let status = child.wait().await.expect("child reaping");
            assert!(
                !status.success(),
                "SIGKILL sonrası başarılı çıkış beklenmez"
            );
            tree.disarm();

            // Marker 0.5 sn sonra oluşacaktı; torun öldüyse hiç oluşmaz.
            let start = Instant::now();
            while start.elapsed() < Duration::from_millis(900) {
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
            assert!(
                !marker.exists(),
                "torun süreç yaşıyor (marker oluşturdu): {grandchild}"
            );
            let _ = std::fs::remove_file(&marker);
        });
    }
}
