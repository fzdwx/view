mod files;
mod target;
mod text_paths;

#[cfg(test)]
mod tests;

use arboard::Clipboard;
use image::ImageEncoder;
use std::io::Cursor;
use std::path::PathBuf;

use crate::{normalize_user_repo_path, workspace_root};
pub(crate) use files::PastedFile;
use files::{
    paste_clipboard_file_list, paste_project_file_paths, write_clipboard_image_file,
    write_pasted_file_bytes,
};

#[tauri::command]
pub(crate) fn write_pasted_files(
    path: String,
    dest_dir: Option<String>,
    files: Vec<PastedFile>,
) -> Result<Vec<String>, String> {
    let root = workspace_root(&path)?;
    let dest_dir = normalize_optional_dest_dir(dest_dir)?;
    write_pasted_file_bytes(&root, &dest_dir, files)
}

#[tauri::command]
pub(crate) fn paste_clipboard_into_project(
    path: String,
    dest_dir: Option<String>,
) -> Result<Vec<String>, String> {
    let root = workspace_root(&path)?;
    let dest_dir = normalize_optional_dest_dir(dest_dir)?;
    let mut clipboard =
        Clipboard::new().map_err(|error| format!("Failed to access clipboard: {error}"))?;

    let file_list = read_clipboard_file_list(&mut clipboard);
    if !file_list.is_empty() {
        return paste_clipboard_file_list(&root, &dest_dir, &file_list);
    }

    let text_file_list = read_clipboard_text_file_list(&mut clipboard);
    if !text_file_list.is_empty() {
        return paste_clipboard_file_list(&root, &dest_dir, &text_file_list);
    }

    if let Some(image_bytes) = read_clipboard_image_png(&mut clipboard)? {
        return write_clipboard_image_file(&root, &dest_dir, &image_bytes);
    }

    Err("No clipboard files or image found".to_string())
}

#[tauri::command]
pub(crate) fn paste_project_files(
    path: String,
    source_path: String,
    source_files: Vec<String>,
    dest_dir: Option<String>,
) -> Result<Vec<String>, String> {
    let root = workspace_root(&path)?;
    let source_root = workspace_root(&source_path)?;
    let dest_dir = normalize_optional_dest_dir(dest_dir)?;
    paste_project_file_paths(&source_root, &root, &dest_dir, &source_files)
}

fn normalize_optional_dest_dir(dest_dir: Option<String>) -> Result<String, String> {
    dest_dir
        .map(|value| normalize_user_repo_path(&value))
        .transpose()
        .map(Option::unwrap_or_default)
}

fn read_clipboard_file_list(clipboard: &mut Clipboard) -> Vec<PathBuf> {
    clipboard
        .get()
        .file_list()
        .map(|paths| paths.into_iter().collect())
        .unwrap_or_default()
}

fn read_clipboard_text_file_list(clipboard: &mut Clipboard) -> Vec<PathBuf> {
    clipboard
        .get()
        .text()
        .map(|text| text_paths::clipboard_text_file_list(&text))
        .unwrap_or_default()
}

fn read_clipboard_image_png(clipboard: &mut Clipboard) -> Result<Option<Vec<u8>>, String> {
    let image = match clipboard.get().image() {
        Ok(image) => image,
        Err(_) => return Ok(None),
    };
    let rgba_bytes = image.bytes.into_owned();
    let mut encoded = Cursor::new(Vec::new());
    image::codecs::png::PngEncoder::new(&mut encoded)
        .write_image(
            &rgba_bytes,
            image.width as u32,
            image.height as u32,
            image::ColorType::Rgba8.into(),
        )
        .map_err(|error| format!("Failed to encode clipboard image: {error}"))?;
    Ok(Some(encoded.into_inner()))
}
