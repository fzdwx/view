use super::files::{
    paste_clipboard_file_list, paste_project_file_paths, pasted_file, write_pasted_file_bytes,
};
use super::text_paths::clipboard_text_file_list;
use std::env;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn write_pasted_files_writes_bytes_under_dest_dir() {
    let repo = create_plain_workspace();
    fs::create_dir_all(repo.join("docs")).expect("create docs dir");

    let written = write_pasted_file_bytes(
        &repo,
        "docs",
        vec![pasted_file("notes.txt", b"hello paste\n")],
    )
    .expect("write pasted file");

    assert_eq!(written, vec!["docs/notes.txt".to_string()]);
    let content = fs::read(repo.join("docs").join("notes.txt")).expect("read pasted file");
    assert_eq!(content, b"hello paste\n");

    fs::remove_dir_all(repo).ok();
}

#[test]
fn write_pasted_files_appends_suffix_on_name_collision() {
    let repo = create_plain_workspace();
    fs::write(repo.join("img.png"), b"original").expect("write existing file");

    let written = write_pasted_file_bytes(&repo, "", vec![pasted_file("img.png", b"pasted")])
        .expect("write colliding pasted file");

    assert_eq!(written, vec!["img (1).png".to_string()]);
    assert_eq!(
        fs::read(repo.join("img (1).png")).expect("read pasted file"),
        b"pasted"
    );
    assert_eq!(
        fs::read(repo.join("img.png")).expect("read original"),
        b"original"
    );

    fs::remove_dir_all(repo).ok();
}

#[cfg(unix)]
#[test]
fn write_pasted_files_treats_dangling_target_symlink_as_collision() {
    use std::os::unix::fs::symlink;

    let repo = create_plain_workspace();
    let outside = unique_temp_path().join("outside.txt");
    symlink(&outside, repo.join("img.png")).expect("create dangling target symlink");

    let written = write_pasted_file_bytes(&repo, "", vec![pasted_file("img.png", b"pasted")])
        .expect("write pasted file around dangling symlink");

    assert_eq!(written, vec!["img (1).png".to_string()]);
    assert_eq!(
        fs::read(repo.join("img (1).png")).expect("read pasted file"),
        b"pasted"
    );
    assert!(!outside.exists());

    fs::remove_dir_all(repo).ok();
}

#[test]
fn clipboard_text_file_list_parses_file_uri_paths() {
    let workspace = create_plain_workspace();
    let source = workspace.join("copied app.txt");
    fs::write(&source, "copied\n").expect("write copied file");

    let uri = format!("file://{}", source.to_string_lossy().replace(' ', "%20"));
    let paths = clipboard_text_file_list(&uri);

    assert_eq!(paths, vec![source]);

    fs::remove_dir_all(workspace).ok();
}

#[test]
fn clipboard_text_file_list_parses_gnome_copied_file_text() {
    let workspace = create_plain_workspace();
    let source = workspace.join("copied desktop entry.desktop");
    fs::write(&source, "copied\n").expect("write copied file");

    let uri = format!("file://{}", source.to_string_lossy().replace(' ', "%20"));
    let paths = clipboard_text_file_list(&format!("copy\n{uri}\n"));

    assert_eq!(paths, vec![source]);

    fs::remove_dir_all(workspace).ok();
}

#[test]
fn clipboard_text_file_list_parses_localhost_file_uri_paths() {
    let workspace = create_plain_workspace();
    let source = workspace.join("copied app.txt");
    fs::write(&source, "copied\n").expect("write copied file");

    let uri = format!(
        "file://localhost{}",
        source.to_string_lossy().replace(' ', "%20")
    );
    let paths = clipboard_text_file_list(&uri);

    assert_eq!(paths, vec![source]);

    fs::remove_dir_all(workspace).ok();
}

#[test]
fn clipboard_text_file_list_parses_plain_absolute_paths() {
    let workspace = create_plain_workspace();
    let source = workspace.join("copied.bin");
    fs::write(&source, "copied\n").expect("write copied file");

    let paths = clipboard_text_file_list(&source.to_string_lossy());

    assert_eq!(paths, vec![source]);

    fs::remove_dir_all(workspace).ok();
}

#[test]
fn clipboard_text_file_list_ignores_non_path_text() {
    let paths = clipboard_text_file_list("not a path\nrelative.txt\n# comment\ncopy");

    assert!(paths.is_empty());
}

#[test]
fn paste_clipboard_file_list_copies_uri_path_into_dest_dir() {
    let project = create_plain_workspace();
    let source_root = create_plain_workspace();
    let source = source_root.join("copied app.txt");
    fs::write(&source, "copied\n").expect("write copied file");
    fs::create_dir_all(project.join("apps")).expect("create dest");

    let uri = format!("file://{}", source.to_string_lossy().replace(' ', "%20"));
    let file_list = clipboard_text_file_list(&uri);
    let written = paste_clipboard_file_list(&project, "apps", &file_list).expect("paste uri file");

    assert_eq!(written, vec!["apps/copied app.txt".to_string()]);
    assert_eq!(
        fs::read_to_string(project.join("apps").join("copied app.txt")).expect("read pasted file"),
        "copied\n"
    );

    fs::remove_dir_all(project).ok();
    fs::remove_dir_all(source_root).ok();
}

#[cfg(unix)]
#[test]
fn paste_clipboard_file_list_rejects_cross_platform_invalid_source_names() {
    let project = create_plain_workspace();
    let source_root = create_plain_workspace();
    let invalid_names = [
        ("COM1", "File path contains a Windows reserved name"),
        (
            "bad:name.txt",
            "File path contains characters that are invalid on Windows",
        ),
    ];

    for (name, expected_error) in invalid_names {
        let source = source_root.join(name);
        fs::write(&source, "copied\n").expect("write source file");

        let error =
            paste_clipboard_file_list(&project, "apps", &[source]).expect_err("reject file name");

        assert_eq!(error, expected_error);
        assert!(!project.join("apps").join(name).exists());
    }

    fs::remove_dir_all(project).ok();
    fs::remove_dir_all(source_root).ok();
}

#[cfg(unix)]
#[test]
fn paste_clipboard_file_list_rejects_cross_platform_invalid_nested_names() {
    let project = create_plain_workspace();
    let source_root = create_plain_workspace();
    let source_dir = source_root.join("copied-dir");
    fs::create_dir_all(&source_dir).expect("create copied dir");
    fs::write(source_dir.join("COM1"), "reserved\n").expect("write reserved child");
    fs::write(source_dir.join("bad:name.txt"), "invalid\n").expect("write invalid child");

    let error = paste_clipboard_file_list(&project, "apps", &[source_dir])
        .expect_err("reject nested invalid file names");

    assert!(
        matches!(
            error.as_str(),
            "File path contains a Windows reserved name"
                | "File path contains characters that are invalid on Windows"
        ),
        "unexpected error: {error}"
    );
    assert!(!project.join("apps/copied-dir/COM1").exists());
    assert!(!project.join("apps/copied-dir/bad:name.txt").exists());

    fs::remove_dir_all(project).ok();
    fs::remove_dir_all(source_root).ok();
}

#[cfg(unix)]
#[test]
fn paste_clipboard_file_list_skips_symlinks_inside_source_directories() {
    use std::os::unix::fs::symlink;

    let project = create_plain_workspace();
    let source_root = create_plain_workspace();
    let source_dir = source_root.join("copied-dir");
    let outside = create_plain_workspace();
    fs::create_dir_all(&source_dir).expect("create copied dir");
    fs::write(source_dir.join("keep.txt"), "copied\n").expect("write copied file");
    fs::write(outside.join("secret.txt"), "secret\n").expect("write outside file");
    symlink(
        outside.join("secret.txt"),
        source_dir.join("linked-secret.txt"),
    )
    .expect("create file symlink");
    symlink(&source_dir, source_dir.join("loop")).expect("create directory symlink loop");
    fs::create_dir_all(project.join("apps")).expect("create dest");

    let written = paste_clipboard_file_list(&project, "apps", &[source_dir])
        .expect("paste directory with symlinks");

    assert_eq!(written, vec!["apps/copied-dir/keep.txt".to_string()]);
    assert_eq!(
        fs::read_to_string(project.join("apps/copied-dir/keep.txt")).expect("read pasted file"),
        "copied\n"
    );
    assert!(!project.join("apps/copied-dir/linked-secret.txt").exists());
    assert!(!project.join("apps/copied-dir/loop").exists());

    fs::remove_dir_all(project).ok();
    fs::remove_dir_all(source_root).ok();
    fs::remove_dir_all(outside).ok();
}

#[test]
fn paste_clipboard_file_list_rejects_directory_paste_into_itself() {
    let project = create_plain_workspace();
    let source_dir = project.join("copied-dir");
    fs::create_dir_all(source_dir.join("nested")).expect("create nested copied dir");
    fs::write(source_dir.join("keep.txt"), "copied\n").expect("write copied file");

    let error = paste_clipboard_file_list(&project, "copied-dir/nested", &[source_dir])
        .expect_err("reject recursive self paste");

    assert_eq!(error, "Cannot paste a directory into itself");
    assert!(!project.join("copied-dir/nested/copied-dir").exists());

    fs::remove_dir_all(project).ok();
}

#[test]
fn paste_project_file_paths_copies_selected_dotfile_with_suffix() {
    let project = create_plain_workspace();
    fs::write(project.join(".gitignore"), "target\n").expect("write selected file");

    let written = paste_project_file_paths(&project, &project, "", &[".gitignore".to_string()])
        .expect("paste copied project file");

    assert_eq!(written, vec![".gitignore (1)".to_string()]);
    assert_eq!(
        fs::read_to_string(project.join(".gitignore (1)")).expect("read pasted dotfile"),
        "target\n"
    );
    assert_eq!(
        fs::read_to_string(project.join(".gitignore")).expect("read original dotfile"),
        "target\n"
    );

    fs::remove_dir_all(project).ok();
}

#[test]
fn paste_project_file_paths_rejects_source_paths_outside_project() {
    let project = create_plain_workspace();
    fs::write(project.join("note.txt"), "note\n").expect("write selected file");

    let error = paste_project_file_paths(&project, &project, "", &["../note.txt".to_string()])
        .expect_err("reject escaped source path");

    assert_eq!(error, "File path cannot contain ..");
    assert!(!project.join("note (1).txt").exists());

    fs::remove_dir_all(project).ok();
}

fn create_plain_workspace() -> PathBuf {
    let workspace = unique_temp_path();
    fs::create_dir_all(&workspace).expect("create plain workspace");
    workspace
}

fn unique_temp_path() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    env::temp_dir().join(format!(
        "view-clipboard-paste-{}-{nanos}",
        std::process::id()
    ))
}
