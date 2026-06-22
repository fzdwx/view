use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use super::target::{
    copy_file_to_new_target, ensure_existing_path_inside_root, ensure_path_inside_root,
    unique_target_path, write_new_file,
};
use crate::{normalize_user_repo_path, resolve_new_repo_child_path};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PastedFile {
    relative_path: String,
    bytes: Vec<u8>,
}

#[cfg(test)]
pub(super) fn pasted_file(relative_path: &str, bytes: &[u8]) -> PastedFile {
    PastedFile {
        relative_path: relative_path.to_string(),
        bytes: bytes.to_vec(),
    }
}

pub(super) fn write_pasted_file_bytes(
    root: &Path,
    dest_dir: &str,
    files: Vec<PastedFile>,
) -> Result<Vec<String>, String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve project root: {error}"))?;
    let mut written = Vec::with_capacity(files.len());

    for file in files {
        let relative = match file.relative_path.split('/').next_back() {
            Some(name) if !name.is_empty() => name,
            _ => return Err("Pasted file name is empty".to_string()),
        };
        let normalized_name = normalize_user_repo_path(relative)?;
        let combined = if dest_dir.is_empty() {
            normalized_name
        } else {
            format!("{dest_dir}/{normalized_name}")
        };
        let normalized = normalize_user_repo_path(&combined)?;
        let full_path = resolve_new_repo_child_path(root, &normalized)?;
        let target = unique_target_path(&full_path)?;
        write_new_file(
            &canonical_root,
            &target,
            &file.bytes,
            "Failed to write pasted file",
        )?;
        written.push(project_relative_path(&canonical_root, &target)?);
    }

    Ok(written)
}

pub(super) fn paste_clipboard_file_list(
    root: &Path,
    dest_dir: &str,
    file_list: &[PathBuf],
) -> Result<Vec<String>, String> {
    let project_root = root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve project root: {error}"))?;
    let destination_root = resolve_paste_destination_root(&project_root, dest_dir)?;
    let mut written = Vec::new();

    for source_path in file_list {
        let file_name = normalized_source_file_name(source_path)?;
        let target = unique_target_path(&destination_root.join(&file_name))?;
        reject_directory_copy_into_itself(source_path, &target)?;
        copy_pasted_path_into_project(&project_root, source_path, &target, &mut written)?;
    }

    Ok(written)
}

pub(super) fn write_clipboard_image_file(
    root: &Path,
    dest_dir: &str,
    image_bytes: &[u8],
) -> Result<Vec<String>, String> {
    let project_root = root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve project root: {error}"))?;
    let destination_root = resolve_paste_destination_root(&project_root, dest_dir)?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let target =
        unique_target_path(&destination_root.join(format!("pasted-image-{timestamp}.png")))?;
    write_new_file(
        &project_root,
        &target,
        image_bytes,
        "Failed to write clipboard image",
    )?;

    Ok(vec![project_relative_path(&project_root, &target)?])
}

fn resolve_paste_destination_root(root: &Path, dest_dir: &str) -> Result<PathBuf, String> {
    if dest_dir.is_empty() {
        return Ok(root.to_path_buf());
    }

    let destination = resolve_new_repo_child_path(root, dest_dir)?;
    fs::create_dir_all(&destination)
        .map_err(|error| format!("Failed to create paste destination: {error}"))?;
    let resolved = destination
        .canonicalize()
        .map_err(|error| format!("Failed to resolve paste destination: {error}"))?;
    ensure_path_inside_root(root, &resolved)?;
    Ok(resolved)
}

fn normalized_source_file_name(source_path: &Path) -> Result<String, String> {
    let file_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Pasted item has no valid file name".to_string())?;
    normalize_user_repo_path(file_name)
}

fn copy_pasted_path_into_project(
    project_root: &Path,
    source: &Path,
    target: &Path,
    written: &mut Vec<String>,
) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source)
        .map_err(|error| format!("Failed to read pasted item metadata: {error}"))?;
    if metadata.file_type().is_symlink() {
        return Ok(());
    }

    if metadata.is_dir() {
        fs::create_dir_all(target)
            .map_err(|error| format!("Failed to create pasted directory: {error}"))?;
        ensure_existing_path_inside_root(project_root, target)?;
        let mut entries = fs::read_dir(source)
            .map_err(|error| format!("Failed to read pasted directory: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Failed to read pasted directory: {error}"))?;
        entries.sort_by_key(|entry| entry.path());

        for entry in entries {
            let child_source = entry.path();
            let child_name = normalized_source_file_name(&child_source)?;
            let child_target = target.join(child_name);
            copy_pasted_path_into_project(project_root, &child_source, &child_target, written)?;
        }
        return Ok(());
    }

    if !metadata.is_file() {
        return Ok(());
    }

    copy_file_to_new_target(project_root, source, target)?;
    written.push(project_relative_path(project_root, target)?);
    Ok(())
}

fn reject_directory_copy_into_itself(source: &Path, target: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source)
        .map_err(|error| format!("Failed to read pasted item metadata: {error}"))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Ok(());
    }

    let source = source
        .canonicalize()
        .map_err(|error| format!("Failed to resolve pasted directory: {error}"))?;
    if target.starts_with(&source) {
        return Err("Cannot paste a directory into itself".to_string());
    }
    Ok(())
}

fn project_relative_path(root: &Path, target: &Path) -> Result<String, String> {
    target
        .strip_prefix(root)
        .map_err(|error| format!("Failed to resolve pasted file path: {error}"))
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
}
