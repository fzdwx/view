use std::path::PathBuf;

pub(super) fn clipboard_text_file_list(text: &str) -> Vec<PathBuf> {
    text.lines()
        .filter_map(clipboard_text_line_path)
        .filter(|path| path.exists())
        .collect()
}

fn clipboard_text_line_path(line: &str) -> Option<PathBuf> {
    let trimmed = line.trim().trim_matches('"');
    if trimmed.is_empty()
        || trimmed.starts_with('#')
        || trimmed.eq_ignore_ascii_case("copy")
        || trimmed.eq_ignore_ascii_case("cut")
    {
        return None;
    }

    if let Some(raw_uri_path) = trimmed.strip_prefix("file://") {
        return file_uri_path_to_local_path(raw_uri_path);
    }

    let path = PathBuf::from(trimmed);
    path.is_absolute().then_some(path)
}

fn file_uri_path_to_local_path(raw_uri_path: &str) -> Option<PathBuf> {
    let mut decoded = percent_decode_utf8(raw_uri_path)?;
    if let Some(local_path) = decoded.strip_prefix("localhost/") {
        decoded = format!("/{local_path}");
    }
    normalize_windows_file_uri_path(&mut decoded);
    let path = PathBuf::from(decoded);
    path.is_absolute().then_some(path)
}

#[cfg(windows)]
fn normalize_windows_file_uri_path(path: &mut String) {
    let bytes = path.as_bytes();
    if bytes.len() >= 3 && bytes[0] == b'/' && bytes[2] == b':' {
        path.remove(0);
    }
}

#[cfg(not(windows))]
fn normalize_windows_file_uri_path(_path: &mut String) {}

fn percent_decode_utf8(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' {
            let high = hex_value(*bytes.get(index + 1)?)?;
            let low = hex_value(*bytes.get(index + 2)?)?;
            decoded.push((high << 4) | low);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }

    String::from_utf8(decoded).ok()
}

const fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}
