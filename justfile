set shell := ["bash", "-uc"]

run-dev:
    bun run tauri dev

run-release:
    bun run tauri:build
    ./src-tauri/target/release/view

run-realese: run-release

# Download the Windows binary (view.exe) from the latest CI build to the desktop.
fetch-windows:
    #!/usr/bin/env bash
    set -euo pipefail
    run_id="$(gh run list --branch main --workflow build --status success --limit 1 --json databaseId --jq '.[0].databaseId')"
    if [ -z "$run_id" ]; then
      echo "no successful build run found on main" >&2
      exit 1
    fi
    echo "downloading view-windows artifact from run $run_id..."
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    gh run download "$run_id" --name view-windows --dir "$tmp"
    binary="$(find "$tmp" -type f -name 'view.exe' | head -1)"
    if [ -z "$binary" ]; then
      echo "no view.exe found in artifact" >&2
      find "$tmp" -type f >&2
      exit 1
    fi
    desktop="${USERPROFILE:-$HOME}/Desktop"
    mkdir -p "$desktop"
    cp -f "$binary" "$desktop/view.exe"
    echo "saved -> $desktop/view.exe"
