#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
root="$PWD"
work="${MIJIA_MEDIA_WORK:-$root/.tools/media-build-linux}"
dest="${MIJIA_MEDIA_DEST:-$root/src-tauri/media-decoder}"
mkdir -p "$work" "$dest"
archive="$work/ffmpeg-source.tar.xz"
IFS=$'\t' read -r version url sha < <(node -e 'const p=require("./native/media-decoder.json");console.log([p.version,p.sourceUrl,p.sourceSha256].join("\t"))')
if [[ ! -f "$archive" ]]; then
 echo "Fetching pinned FFmpeg $version source"
 curl --fail --silent --show-error --location --connect-timeout 15 --max-time 180 --retry 2 -o "$archive.partial" "$url"
 printf '%s  %s\n' "$sha" "$archive.partial" | sha256sum --check
 mv "$archive.partial" "$archive"
fi
printf '%s  %s\n' "$sha" "$archive" | sha256sum --check
# Work in a fresh directory so a cached image cannot supply stale native code.
build=$(mktemp -d "$work/build.XXXXXX")
tar -xJf "$archive" -C "$build"
export MIJIA_MEDIA_CROSS=1 MIJIA_MEDIA_SOURCE="$build/ffmpeg-$version" MIJIA_MEDIA_OUTPUT="$build/installed"
echo "Cross-compiling Windows x64 decoder ($(nasm -v))"
bash native/build-decoder.sh
prefix="$MIJIA_MEDIA_OUTPUT"
x86_64-w64-mingw32-gcc-win32 -O2 -std=c11 -static-libgcc -I "$prefix/include" native/media-decoder.c \
 -L "$prefix/lib" -lavformat -lavcodec -lswscale -lswresample -lavutil -o "$dest/mijia-media-decoder.exe"
for dll in avcodec-63 avformat-63 avutil-61 swscale-10 swresample-7; do
 cp "$prefix/bin/$dll.dll" "$dest/"
done
cp "$MIJIA_MEDIA_SOURCE/COPYING.LGPLv2.1" "$archive" native/build-decoder.sh native/media-decoder.json "$dest/"
node scripts/write-media-decoder-manifest.mjs "$dest"
for binary in "$dest"/*.exe "$dest"/*.dll; do
 # A fresh Windows machine does not carry MinGW's runtime DLLs.
 if x86_64-w64-mingw32-objdump -p "$binary" | grep -Ei 'DLL Name: (libgcc|libstdc\+\+|libwinpthread)'; then
  echo "Unexpected compiler runtime import in $binary" >&2; exit 1
 fi
done
