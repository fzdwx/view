use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

pub(super) fn write_new_file(
    project_root: &Path,
    target: &Path,
    bytes: &[u8],
    write_error: &str,
) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| "Selected file has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("Failed to create directories: {error}"))?;
    ensure_existing_path_inside_root(project_root, parent)?;

    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)
        .map_err(|error| format!("Failed to create pasted file: {error}"))?;
    if let Err(error) = file.write_all(bytes) {
        let _ = fs::remove_file(target);
        return Err(format!("{write_error}: {error}"));
    }
    Ok(())
}

pub(super) fn copy_file_to_new_target(
    project_root: &Path,
    source: &Path,
    target: &Path,
) -> Result<(), String> {
    let mut source_file =
        fs::File::open(source).map_err(|error| format!("Failed to read pasted file: {error}"))?;
    let parent = target
        .parent()
        .ok_or_else(|| "Selected file has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("Failed to create directories: {error}"))?;
    ensure_existing_path_inside_root(project_root, parent)?;
    let mut target_file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)
        .map_err(|error| format!("Failed to create pasted file: {error}"))?;
    if let Err(error) = std::io::copy(&mut source_file, &mut target_file) {
        let _ = fs::remove_file(target);
        return Err(format!("Failed to copy pasted file: {error}"));
    }
    Ok(())
}

pub(super) fn unique_target_path(path: &Path) -> Result<PathBuf, String> {
    if !path_has_directory_entry(path)? {
        return Ok(path.to_path_buf());
    }
    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("file");
    let ext = path.extension().and_then(|value| value.to_str());
    let mut index = 1;

    loop {
        let candidate_name = match ext {
            Some(extension) => format!("{stem} ({index}).{extension}"),
            None => format!("{stem} ({index})"),
        };
        let candidate = parent.join(&candidate_name);
        if !path_has_directory_entry(&candidate)? {
            return Ok(candidate);
        }
        index += 1;
    }
}

pub(super) fn ensure_existing_path_inside_root(root: &Path, path: &Path) -> Result<(), String> {
    let resolved = path
        .canonicalize()
        .map_err(|error| format!("Failed to resolve paste target: {error}"))?;
    ensure_path_inside_root(root, &resolved)
}

pub(super) fn ensure_path_inside_root(root: &Path, path: &Path) -> Result<(), String> {
    if path.starts_with(root) {
        return Ok(());
    }
    Err("File is outside the project".to_string())
}

fn path_has_directory_entry(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("Failed to inspect paste target: {error}")),
    }
}
