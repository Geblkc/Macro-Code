use serde::Serialize;

/// Otomatik güncelleme desteği (Hakkında sekmesi + `/update`).
///
/// Tauri updater'ın platform sınırları:
/// - Windows: NSIS/MSI kurulumları → desteklenir.
/// - macOS: uygulama paketi → desteklenir.
/// - Linux: **yalnızca AppImage** otomatik güncellenebilir; deb/rpm paketleri
///   paket yöneticisiyle kurulduğu için kendini değiştiremez.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct UpdateSupport {
    pub supported: bool,
    /// `appimage` | `package` | `windows` | `macos` | `unknown`
    pub kind: String,
}

/// Saf yardımcı — test edilebilir (ortam değişkenine dokunmaz).
pub fn support_for(os: &str, appimage: bool) -> UpdateSupport {
    match os {
        "linux" => UpdateSupport {
            supported: appimage,
            kind: if appimage { "appimage" } else { "package" }.to_string(),
        },
        "windows" => UpdateSupport {
            supported: true,
            kind: "windows".to_string(),
        },
        "macos" => UpdateSupport {
            supported: true,
            kind: "macos".to_string(),
        },
        _ => UpdateSupport {
            supported: false,
            kind: "unknown".to_string(),
        },
    }
}

/// Çalışan kurulumun otomatik güncellenebilir olup olmadığını döndürür.
#[tauri::command]
pub fn update_support() -> UpdateSupport {
    support_for(std::env::consts::OS, std::env::var_os("APPIMAGE").is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linux_appimage_destekler() {
        assert_eq!(
            support_for("linux", true),
            UpdateSupport {
                supported: true,
                kind: "appimage".to_string()
            }
        );
    }

    #[test]
    fn linux_deb_rpm_manuel() {
        assert_eq!(
            support_for("linux", false),
            UpdateSupport {
                supported: false,
                kind: "package".to_string()
            }
        );
    }

    #[test]
    fn windows_ve_macos_destekler() {
        assert!(support_for("windows", false).supported);
        assert!(support_for("macos", false).supported);
    }

    #[test]
    fn bilinmeyen_platform_desteklemez() {
        assert!(!support_for("freebsd", false).supported);
    }
}
