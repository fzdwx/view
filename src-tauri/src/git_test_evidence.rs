use std::env;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

const WRITE_TEST_EVIDENCE_ENV: &str = "VIEW_WRITE_TEST_EVIDENCE";

pub(crate) fn write_test_evidence(relative_path: &str, record: &[u8]) {
    if !write_test_evidence_enabled() {
        return;
    }

    let evidence = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("workspace root")
        .join(relative_path);
    let parent = evidence.parent().expect("evidence parent");
    fs::create_dir_all(parent).expect("create evidence directory");
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(evidence)
        .expect("open evidence");
    file.write_all(record).expect("write evidence");
}

pub(crate) fn write_test_evidence_enabled() -> bool {
    write_test_evidence_enabled_with(|name| env::var(name).ok())
}

pub(crate) fn write_test_evidence_enabled_with(
    read_env: impl FnOnce(&str) -> Option<String>,
) -> bool {
    read_env(WRITE_TEST_EVIDENCE_ENV).as_deref() == Some("1")
}
