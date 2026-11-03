#!/usr/bin/env bash
# The whole history against gitleaks, for the local gate and the quick check.
set -euo pipefail
cd "$(dirname "$0")/.."

# The gitleaks release binary for this machine, checked against hashes pinned here from the
# release's checksums file (the Linux one is CI's). The Docker image does not start on Windows.
version=8.30.1
cache=node_modules/.cache/gitleaks
mkdir -p "$cache"
case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*)
    archive="gitleaks_${version}_windows_x64.zip"
    sha=d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e
    binary="$cache/gitleaks.exe"
    ;;
  *)
    archive="gitleaks_${version}_linux_x64.tar.gz"
    sha=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
    binary="$cache/gitleaks"
    ;;
esac
if [ ! -x "$binary" ]; then
  curl -fsSL -o "$cache/$archive" \
    "https://github.com/gitleaks/gitleaks/releases/download/v${version}/${archive}"
  (cd "$cache" && echo "${sha}  ${archive}" | sha256sum --check --strict)
  case "$archive" in
    *.zip) unzip -oq "$cache/$archive" gitleaks.exe -d "$cache" ;;
    *) tar -xzf "$cache/$archive" -C "$cache" gitleaks ;;
  esac
fi
"$binary" git . --redact --no-banner --exit-code 1
