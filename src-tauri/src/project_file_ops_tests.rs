use super::{
    append_gitignore_pattern, create_project_directory, delete_project_directory,
    rename_project_path, reveal_project_path_target, AppendGitignorePatternRequest,
    CreateProjectDirectoryRequest, DeleteProjectDirectoryRequest, RenameProjectPathRequest,
};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

fn create_directory(request: CreateProjectDirectoryRequest) -> Result<String, String> {
    tauri::async_runtime::block_on(create_project_directory(request))
}

fn rename_path(request: RenameProjectPathRequest) -> Result<String, String> {
    tauri::async_runtime::block_on(rename_project_path(request))
}

fn delete_directory(request: DeleteProjectDirectoryRequest) -> Result<(), String> {
    tauri::async_runtime::block_on(delete_project_directory(request))
}

fn append_ignore(request: AppendGitignorePatternRequest) -> Result<String, String> {
    tauri::async_runtime::block_on(append_gitignore_pattern(request))
}

#[test]
fn creates_and_renames_directories_with_path_validation() {
    let project = TempProject::new("directory-create-rename");

    let created = create_directory(CreateProjectDirectoryRequest {
        path: project.path_string(),
        dir_path: "src/features".to_string(),
    })
    .expect("create directory");

    assert_eq!(created, "src/features");
    assert!(project.path().join("src/features").is_dir());

    let renamed = rename_path(RenameProjectPathRequest {
        path: project.path_string(),
        from_path: "src/features".to_string(),
        to_path: "src/modules".to_string(),
    })
    .expect("rename directory");

    assert_eq!(renamed, "src/modules");
    assert!(!project.path().join("src/features").exists());
    assert!(project.path().join("src/modules").is_dir());

    let error = create_directory(CreateProjectDirectoryRequest {
        path: project.path_string(),
        dir_path: "../escape".to_string(),
    })
    .expect_err("escape should fail");
    assert!(error.contains(".."));
}

#[test]
fn deleting_non_empty_directories_requires_recursive_flag() {
    let project = TempProject::new("directory-delete");
    fs::create_dir_all(project.path().join("docs")).expect("create docs");
    fs::write(project.path().join("docs/readme.md"), "docs\n").expect("write child file");

    let error = delete_directory(DeleteProjectDirectoryRequest {
        path: project.path_string(),
        dir_path: "docs".to_string(),
        recursive: false,
    })
    .expect_err("non-empty delete should fail");

    assert!(error.contains("not empty"));
    assert!(project.path().join("docs/readme.md").is_file());

    delete_directory(DeleteProjectDirectoryRequest {
        path: project.path_string(),
        dir_path: "docs".to_string(),
        recursive: true,
    })
    .expect("delete recursively");

    assert!(!project.path().join("docs").exists());
}

#[test]
fn appends_gitignore_patterns_without_duplicates() {
    let project = TempProject::new("gitignore");

    let first = append_ignore(AppendGitignorePatternRequest {
        path: project.path_string(),
        pattern: " dist/ ".to_string(),
    })
    .expect("append pattern");
    let second = append_ignore(AppendGitignorePatternRequest {
        path: project.path_string(),
        pattern: "dist/".to_string(),
    })
    .expect("append duplicate");

    assert_eq!(first, "dist/");
    assert_eq!(second, "dist/");
    let content = fs::read_to_string(project.path().join(".gitignore")).expect("read gitignore");
    assert_eq!(content.lines().filter(|line| *line == "dist/").count(), 1);
}

#[test]
fn reveal_target_validation_rejects_missing_and_escaped_paths() {
    let project = TempProject::new("reveal");
    fs::create_dir_all(project.path().join("src")).expect("create src");
    fs::write(project.path().join("src/main.rs"), "fn main() {}\n").expect("write file");

    let target = reveal_project_path_target(project.path(), Some("src/main.rs"))
        .expect("validate reveal target");

    assert!(target.ends_with("src/main.rs"));
    assert!(reveal_project_path_target(project.path(), Some("missing.txt")).is_err());
    assert!(reveal_project_path_target(project.path(), Some("../escape")).is_err());
}

struct TempProject {
    path: PathBuf,
}

impl TempProject {
    fn new(prefix: &str) -> Self {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "view-project-file-ops-{prefix}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("create temp project");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }

    fn path_string(&self) -> String {
        self.path.to_string_lossy().to_string()
    }
}

impl Drop for TempProject {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.path).ok();
    }
}
