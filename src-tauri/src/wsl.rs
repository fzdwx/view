use std::path::Path;
use std::process::Command;

const REG_EXE: &str = "/mnt/c/Windows/System32/reg.exe";
const BASE_DPI: f64 = 96.0;

fn is_wsl() -> bool {
    std::fs::read_to_string("/proc/version")
        .map(|content| content.to_ascii_lowercase().contains("microsoft"))
        .unwrap_or(false)
}

fn windows_dpi_scale() -> Option<f64> {
    if !Path::new(REG_EXE).exists() {
        return None;
    }
    let output = Command::new(REG_EXE)
        .args([
            "query",
            r"HKCU\Control Panel\Desktop\WindowMetrics",
            "/v",
            "AppliedDPI",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let dpi = stdout
        .lines()
        .find(|line| line.to_ascii_lowercase().contains("applieddpi"))
        .and_then(|line| line.split_whitespace().last())
        .and_then(|value| u32::from_str_radix(value.trim_start_matches("0x"), 16).ok())?;
    if dpi == 0 {
        return None;
    }
    Some(dpi as f64 / BASE_DPI)
}

/// When running under WSL with WSLg, the Weston compositor reports
/// `wl_output.scale = 1` even when Windows is configured for HiDPI
/// (e.g. 150%).  GDK_SCALE/GDK_DPI_SCALE are unreliable here because
/// the Wayland backend ignores GDK_SCALE when wl_output.scale is set.
///
/// Instead, this returns the detected Windows DPI scale factor so the
/// caller can apply it via Tauri's webview zoom, which calls
/// WebKitGTK `set_zoom_level` directly.
pub fn display_scale_factor() -> Option<f64> {
    if !is_wsl() {
        return None;
    }
    let scale = windows_dpi_scale()?;
    (scale > 1.0).then_some(scale)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scale_from_dpi() {
        assert_eq!(144.0 / BASE_DPI, 1.5);
        assert_eq!(96.0 / BASE_DPI, 1.0);
        assert_eq!(192.0 / BASE_DPI, 2.0);
    }
}
