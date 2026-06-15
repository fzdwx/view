set shell := ["bash", "-uc"]

run-release:
    pnpm tauri:build
    ./src-tauri/target/release/view

run-realese: run-release
