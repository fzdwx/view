set shell := ["bash", "-uc"]

run-dev:
    pnpm tauri dev

run-release:
    pnpm tauri:build
    ./src-tauri/target/release/view

run-realese: run-release
