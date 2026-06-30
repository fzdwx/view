use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::{
    blocking_command, normalize_user_repo_path, resolve_new_repo_child_path,
    resolve_repo_child_path, workspace_root,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateProjectDirectoryRequest {
    pub(crate) path: String,
    pub(crate) dir_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RenameProjectPathRequest {
    pub(crate) path: String,
    pub(crate) from_path: String,
    pub(crate) to_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteProjectDirectoryRequest {
    pub(crate) path: String,
    pub(crate) dir_path: String,
    pub(crate) recursive: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RevealProjectPathRequest {
    pub(crate) path: String,
    pub(crate) file_path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppendGitignorePatternRequest {
    pub(crate) path: String,
    pub(crate) pattern: String,
}

#[tauri::command]
pub(crate) async fn create_project_directory(
    request: CreateProjectDirectoryRequest,
) -> Result<String, String> {
    blocking_command("create_project_directory", move || {
        let root = workspace_root(&request.path)?;
        create_directory(&root, &request.dir_path)
    })
    .await
}

#[tauri::command]
pub(crate) async fn rename_project_path(
    request: RenameProjectPathRequest,
) -> Result<String, String> {
    blocking_command("rename_project_path", move || {
        let root = workspace_root(&request.path)?;
        rename_path(&root, &request.from_path, &request.to_path)
    })
    .await
}

#[tauri::command]
pub(crate) async fn delete_project_directory(
    request: DeleteProjectDirectoryRequest,
) -> Result<(), String> {
    blocking_command("delete_project_directory", move || {
        let root = workspace_root(&request.path)?;
        delete_directory(&root, &request.dir_path, request.recursive)
    })
    .await
}

#[tauri::command]
pub(crate) async fn reveal_project_path(request: RevealProjectPathRequest) -> Result<(), String> {
    blocking_command("reveal_project_path", move || {
        let root = workspace_root(&request.path)?;
        let target = reveal_project_path_target(&root, request.file_path.as_deref())?;
        spawn_reveal_project_path(&target)
    })
    .await
}

#[tauri::command]
pub(crate) async fn append_gitignore_pattern(
    request: AppendGitignorePatternRequest,
) -> Result<String, String> {
    blocking_command("append_gitignore_pattern", move || {
        let root = workspace_root(&request.path)?;
        append_ignore_pattern(&root, &request.pattern)
    })
    .await
}

fn create_directory(root: &Path, dir_path: &str) -> Result<String, String> {
    let normalized = normalize_user_repo_path(dir_path)?;
    let full_path = resolve_new_repo_child_path(root, &normalized)?;
    if full_path.exists() {
        return Err("Directory already exists".to_string());
    }
    fs::create_dir_all(&full_path).map_err(|error| format!("Failed to create folder: {error}"))?;
    Ok(normalized)
}

fn rename_path(root: &Path, from_path: &str, to_path: &str) -> Result<String, String> {
    let (_normalized_from, source, source_metadata) =
        resolve_existing_project_path(root, from_path)?;
    let normalized_to = normalize_user_repo_path(to_path)?;
    let destination = resolve_repo_child_path(root, &normalized_to)?;
    if destination.exists() {
        return Err("Destination already exists".to_string());
    }
    let destination_parent = destination
        .parent()
        .ok_or_else(|| "Selected path has no parent directory".to_string())?;
    if !destination_parent.exists() {
        return Err("Destination directory does not exist".to_string());
    }
    if source_metadata.is_dir() {
        let canonical_parent = destination_parent
            .canonicalize()
            .map_err(|error| format!("Failed to resolve destination directory: {error}"))?;
        if canonical_parent.starts_with(&source) {
            return Err("Cannot move a directory inside itself".to_string());
        }
    }

    fs::rename(&source, &destination).map_err(|error| format!("Failed to rename path: {error}"))?;
    Ok(normalized_to)
}

fn delete_directory(root: &Path, dir_path: &str, recursive: bool) -> Result<(), String> {
    let (_normalized, directory, metadata) = resolve_existing_project_path(root, dir_path)?;
    if !metadata.is_dir() {
        return Err("Selected path is not a directory".to_string());
    }
    if recursive {
        return fs::remove_dir_all(&directory)
            .map_err(|error| format!("Failed to delete folder: {error}"));
    }

    let has_children = fs::read_dir(&directory)
        .map_err(|error| format!("Failed to read folder: {error}"))?
        .next()
        .is_some();
    if has_children {
        return Err("Directory is not empty".to_string());
    }
    fs::remove_dir(&directory).map_err(|error| format!("Failed to delete folder: {error}"))
}

pub(crate) fn reveal_project_path_target(
    root: &Path,
    file_path: Option<&str>,
) -> Result<PathBuf, String> {
    let Some(file_path) = file_path.map(str::trim).filter(|value| !value.is_empty()) else {
        return root
            .canonicalize()
            .map_err(|error| format!("Failed to resolve project root: {error}"));
    };
    let normalized = normalize_user_repo_path(file_path)?;
    let target = resolve_repo_child_path(root, &normalized)?;
    if !target.exists() {
        return Err("Selected path does not exist".to_string());
    }
    target
        .canonicalize()
        .map_err(|error| format!("Failed to resolve selected path: {error}"))
}

fn append_ignore_pattern(root: &Path, pattern: &str) -> Result<String, String> {
    let normalized = normalize_gitignore_pattern(pattern)?;
    let gitignore_path = root.join(".gitignore");
    let existing = match fs::read_to_string(&gitignore_path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(format!("Failed to read .gitignore: {error}")),
    };

    if existing.lines().any(|line| line.trim() == normalized) {
        return Ok(normalized);
    }

    let mut next = existing;
    if !next.is_empty() && !next.ends_with('\n') {
        next.push('\n');
    }
    next.push_str(&normalized);
    next.push('\n');
    fs::write(&gitignore_path, next)
        .map_err(|error| format!("Failed to update .gitignore: {error}"))?;
    Ok(normalized)
}

fn normalize_gitignore_pattern(pattern: &str) -> Result<String, String> {
    let normalized = pattern.trim().replace('\\', "/");
    if normalized.is_empty() {
        return Err("Enter a .gitignore pattern".to_string());
    }
    if normalized.contains('\0') || normalized.chars().any(char::is_control) {
        return Err(".gitignore pattern contains invalid control characters".to_string());
    }
    if normalized
        .split('/')
        .next()
        .is_some_and(|part| part.len() == 2 && part.ends_with(':'))
    {
        return Err("Use a .gitignore pattern relative to the project root".to_string());
    }
    Ok(normalized)
}

fn resolve_existing_project_path(
    root: &Path,
    file_path: &str,
) -> Result<(String, PathBuf, fs::Metadata), String> {
    let normalized = normalize_user_repo_path(file_path)?;
    let full_path = resolve_repo_child_path(root, &normalized)?;
    let canonical = full_path
        .canonicalize()
        .map_err(|error| format!("Failed to open path: {error}"))?;
    let metadata = fs::metadata(&canonical)
        .map_err(|error| format!("Failed to read path metadata: {error}"))?;
    if !metadata.is_file() && !metadata.is_dir() {
        return Err("Selected path is not a file or directory".to_string());
    }
    Ok((normalized, canonical, metadata))
}

fn spawn_reveal_project_path(target: &Path) -> Result<(), String> {
    let mut command = reveal_command(target)?;
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Failed to reveal path: {error}"))
}

fn reveal_command(target: &Path) -> Result<Command, String> {
    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("open");
        command.arg("-R").arg(target);
        Ok(command)
    }
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("explorer.exe");
        command.arg(format!("/select,{}", target.display()));
        Ok(command)
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let reveal_target = if target.is_dir() {
            target
        } else {
            target
                .parent()
                .ok_or_else(|| "Selected path has no parent directory".to_string())?
        };
        let mut command = Command::new("xdg-open");
        command.arg(reveal_target);
        Ok(command)
    }
}

#[cfg(test)]
#[path = "project_file_ops_tests.rs"]
mod tests;
