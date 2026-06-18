use std::path::{Path, PathBuf};

pub(crate) fn validate_existing_pathspecs(
    root: &Path,
    paths: &[String],
) -> Result<Vec<String>, String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve repository root: {error}"))?;
    let mut validated = Vec::with_capacity(paths.len());

    for path in paths {
        validate_pathspec_string(path)?;
        validate_pathspec_containment(&canonical_root, path)?;
        validated.push(path.clone());
    }

    Ok(validated)
}

pub(crate) fn git_args_with_pathspecs(prefix: &[&str], pathspecs: &[String]) -> Vec<String> {
    prefix
        .iter()
        .map(|argument| (*argument).to_string())
        .chain(std::iter::once("--".to_string()))
        .chain(pathspecs.iter().map(|pathspec| literal_pathspec(pathspec)))
        .collect()
}

fn literal_pathspec(pathspec: &str) -> String {
    format!(":(literal){pathspec}")
}

fn validate_pathspec_string(path: &str) -> Result<(), String> {
    if path.is_empty() {
        return Err("File path is required".to_string());
    }
    if path.contains('\0') {
        return Err("File path cannot contain NUL bytes".to_string());
    }
    if Path::new(path).is_absolute() || looks_like_windows_absolute_path(path) {
        return Err("Use a path relative to the repository root".to_string());
    }
    if path.split(['/', '\\']).any(|component| component == "..") {
        return Err("File path cannot contain ..".to_string());
    }

    Ok(())
}

fn validate_pathspec_containment(root: &Path, path: &str) -> Result<(), String> {
    let candidate = root.join(path);
    let existing = deepest_existing_path(&candidate);
    let resolved = existing
        .canonicalize()
        .map_err(|error| format!("Failed to resolve file path: {error}"))?;

    if !resolved.starts_with(root) {
        return Err("File is outside the repository".to_string());
    }

    Ok(())
}

fn deepest_existing_path(path: &Path) -> PathBuf {
    let mut current = path;
    loop {
        if current.exists() {
            return current.to_path_buf();
        }

        match current.parent() {
            Some(parent) => current = parent,
            None => return path.to_path_buf(),
        }
    }
}

fn looks_like_windows_absolute_path(path: &str) -> bool {
    let mut chars = path.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    let Some(':') = chars.next() else {
        return false;
    };
    let Some(separator) = chars.next() else {
        return false;
    };

    first.is_ascii_alphabetic() && matches!(separator, '/' | '\\')
}

#[cfg(test)]
mod tests {
    use super::{git_args_with_pathspecs, literal_pathspec, validate_existing_pathspecs};
    use std::env;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn pathspec_rejects_absolute_paths() {
        let repo = unique_temp_dir();
        fs::create_dir_all(&repo).expect("create repo");

        let error =
            validate_existing_pathspecs(&repo, &[repo.join("file.txt").display().to_string()])
                .expect_err("absolute path should be rejected");

        assert!(error.contains("relative"));
        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn pathspec_rejects_parent_directory_escape() {
        let repo = unique_temp_dir();
        fs::create_dir_all(&repo).expect("create repo");

        let error = validate_existing_pathspecs(&repo, &[String::from("../escape")])
            .expect_err("parent escape should be rejected");

        assert!(error.contains(".."));
        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn pathspec_rejects_empty_path() {
        let repo = unique_temp_dir();
        fs::create_dir_all(&repo).expect("create repo");

        let error = validate_existing_pathspecs(&repo, &[String::new()])
            .expect_err("empty path should be rejected");

        assert!(error.contains("required"));
        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn pathspec_rejects_nul_bytes() {
        let repo = unique_temp_dir();
        fs::create_dir_all(&repo).expect("create repo");

        let error = validate_existing_pathspecs(&repo, &[String::from("bad\0path")])
            .expect_err("NUL should be rejected");

        assert!(error.contains("NUL"));
        fs::remove_dir_all(repo).ok();
    }

    #[cfg(unix)]
    #[test]
    fn pathspec_accepts_existing_unix_filename_rejected_by_create_validation() {
        let repo = unique_temp_dir();
        fs::create_dir_all(&repo).expect("create repo");
        fs::write(repo.join("bad:name.txt"), "unix-valid\n").expect("write unix filename");

        let pathspecs =
            validate_existing_pathspecs(&repo, &[String::from("bad:name.txt")]).expect("pathspec");
        let args = git_args_with_pathspecs(&["add"], &pathspecs);

        assert_eq!(pathspecs, vec![String::from("bad:name.txt")]);
        assert_eq!(args, vec!["add", "--", ":(literal)bad:name.txt"]);
        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn pathspec_args_use_literal_magic_for_glob_and_magic_filenames() {
        let pathspecs = vec![String::from("*.txt"), String::from(":(top)literal.txt")];
        let args = git_args_with_pathspecs(&["add"], &pathspecs);

        assert_eq!(
            args,
            vec![
                "add",
                "--",
                ":(literal)*.txt",
                ":(literal):(top)literal.txt"
            ]
        );
        assert_eq!(
            literal_pathspec(":(literal)name.txt"),
            ":(literal):(literal)name.txt"
        );
    }

    fn unique_temp_dir() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        env::temp_dir().join(format!("view-pathspec-test-{}-{nanos}", std::process::id()))
    }
}
