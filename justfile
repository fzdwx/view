set shell := ["bash", "-uc"]

run-dev:
    bun run tauri dev

run-release:
    bun run tauri:build
    ./src-tauri/target/release/view

run-realese: run-release
