use serde::Deserialize;
use std::cmp::Ordering;
use std::path::Path;
use std::process::Command;

const WINDOWS_REG_EXE: &str = "/mnt/c/Windows/System32/reg.exe";
const WINDOWS_POWERSHELL_EXE: &str =
    "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";
const BASE_DPI: f64 = 96.0;
const POWERSHELL_MONITOR_LIST_SCRIPT: &str = r#"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class ViewDpi {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT {
    public int X;
    public int Y;
  }

  [DllImport("user32.dll")]
  public static extern IntPtr MonitorFromPoint(POINT point, uint flags);

  [DllImport("Shcore.dll")]
  public static extern int GetDpiForMonitor(
    IntPtr monitor,
    int dpiType,
    out uint dpiX,
    out uint dpiY
  );
}
"@ | Out-Null

$screens = [System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
  $bounds = $_.Bounds
  $point = New-Object ViewDpi+POINT
  $point.X = [int]($bounds.X + [math]::Floor($bounds.Width / 2))
  $point.Y = [int]($bounds.Y + [math]::Floor($bounds.Height / 2))
  $monitor = [ViewDpi]::MonitorFromPoint($point, 2)

  $dpiX = 0
  $dpiY = 0
  $result = 1
  if ($monitor -ne [IntPtr]::Zero) {
    $result = [ViewDpi]::GetDpiForMonitor($monitor, 0, [ref]$dpiX, [ref]$dpiY)
  }

  [PSCustomObject]@{
    x = $bounds.X
    y = $bounds.Y
    width = $bounds.Width
    height = $bounds.Height
    primary = $_.Primary
    dpi = $(if ($result -eq 0 -and $dpiX -gt 0) { $dpiX } else { 0 })
  }
}

$screens | ConvertTo-Json -Compress
"#;

fn is_wsl() -> bool {
    std::fs::read_to_string("/proc/version")
        .map(|content| content.to_ascii_lowercase().contains("microsoft"))
        .unwrap_or(false)
}

fn scale_from_dpi(dpi: u32) -> Option<f64> {
    (dpi > 0).then_some(dpi as f64 / BASE_DPI)
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowsMonitorInfo {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    primary: bool,
    dpi: u32,
}

fn windows_monitor_list() -> Option<Vec<WindowsMonitorInfo>> {
    if !Path::new(WINDOWS_POWERSHELL_EXE).exists() {
        return None;
    }

    let output = Command::new(WINDOWS_POWERSHELL_EXE)
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            POWERSHELL_MONITOR_LIST_SCRIPT,
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return None;
    }

    if trimmed.starts_with('[') {
        let mut monitors = serde_json::from_str::<Vec<WindowsMonitorInfo>>(trimmed).ok()?;
        sort_windows_monitors(&mut monitors);
        return Some(monitors);
    }

    let monitor = serde_json::from_str::<WindowsMonitorInfo>(trimmed).ok()?;
    let mut monitors = vec![monitor];
    sort_windows_monitors(&mut monitors);
    Some(monitors)
}

fn windows_default_dpi() -> Option<u32> {
    if !Path::new(WINDOWS_REG_EXE).exists() {
        return None;
    }

    let output = Command::new(WINDOWS_REG_EXE)
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

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .find(|line| line.to_ascii_lowercase().contains("applieddpi"))
        .and_then(|line| line.split_whitespace().last())
        .and_then(|value| u32::from_str_radix(value.trim_start_matches("0x"), 16).ok())
}

pub fn display_scale_factor_for_monitor(
    monitor_index: usize,
    monitor_count: usize,
    monitor_width: u32,
    monitor_height: u32,
) -> Option<f64> {
    if !is_wsl() {
        return None;
    }

    let monitors = windows_monitor_list()?;

    if monitor_count > 0 && monitors.len() == monitor_count && monitor_index < monitors.len() {
        if let Some(scale) = scale_from_dpi(monitors[monitor_index].dpi) {
            return (scale > 1.0).then_some(scale);
        }
    }

    let exact_matches = monitors
        .iter()
        .filter(|monitor| monitor.width == monitor_width && monitor.height == monitor_height)
        .collect::<Vec<_>>();
    if exact_matches.len() == 1 {
        if let Some(scale) = scale_from_dpi(exact_matches[0].dpi) {
            return (scale > 1.0).then_some(scale);
        }
    }

    let primary_monitor = monitors.iter().find(|monitor| monitor.primary)?;
    let scale = scale_from_dpi(primary_monitor.dpi)
        .or_else(|| windows_default_dpi().and_then(scale_from_dpi))?;
    (scale > 1.0).then_some(scale)
}

#[tauri::command]
pub fn wsl_display_scale_for_monitor(
    monitor_index: usize,
    monitor_count: usize,
    monitor_width: u32,
    monitor_height: u32,
) -> Option<f64> {
    display_scale_factor_for_monitor(monitor_index, monitor_count, monitor_width, monitor_height)
}

fn sort_windows_monitors(monitors: &mut [WindowsMonitorInfo]) {
    monitors.sort_by(|left, right| match left.x.cmp(&right.x) {
        Ordering::Equal => match left.y.cmp(&right.y) {
            Ordering::Equal => match left.width.cmp(&right.width) {
                Ordering::Equal => left.height.cmp(&right.height),
                ordering => ordering,
            },
            ordering => ordering,
        },
        ordering => ordering,
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scale_from_known_dpi_values() {
        assert_eq!(scale_from_dpi(96), Some(1.0));
        assert_eq!(scale_from_dpi(144), Some(1.5));
        assert_eq!(scale_from_dpi(192), Some(2.0));
        assert_eq!(scale_from_dpi(0), None);
    }
}
