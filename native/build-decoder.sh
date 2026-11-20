#!/usr/bin/env bash
set -euo pipefail
: "${MIJIA_MEDIA_SOURCE:?}" "${MIJIA_MEDIA_OUTPUT:?}"
if [[ "${MIJIA_MEDIA_CROSS:-}" == 1 ]]; then
 tools=(--enable-cross-compile --cross-prefix=x86_64-w64-mingw32- --cc=x86_64-w64-mingw32-gcc-win32 --ld=x86_64-w64-mingw32-gcc-win32)
 build=(make)
else
 : "${MIJIA_MEDIA_TOOLCHAIN:?}" "${MIJIA_MEDIA_NASM:?}"
 export PATH="$(cygpath -u "$MIJIA_MEDIA_TOOLCHAIN"):$(cygpath -u "$MIJIA_MEDIA_NASM"):$PATH"
 tools=(--cc=gcc --cxx=g++ --ld=gcc)
 build=(mingw32-make.exe "SHELL=$(cygpath -m /usr/bin/sh.exe)")
fi
cd "$MIJIA_MEDIA_SOURCE"
./configure --target-os=mingw32 --arch=x86_64 "${tools[@]}" \
 --disable-autodetect --disable-everything --enable-shared --disable-static \
 --disable-programs --disable-doc --disable-debug --enable-small --disable-network --disable-avdevice --disable-avfilter \
 --enable-avcodec --enable-avformat --enable-avutil --enable-swscale --enable-swresample \
 --enable-decoder=h264,hevc,aac,opus,pcm_s16le,pcm_alaw,pcm_mulaw \
 --enable-parser=h264,hevc,aac,opus --enable-demuxer=mpegts,mov \
 --extra-cflags=-O2 --extra-ldflags=-static-libgcc --prefix="$MIJIA_MEDIA_OUTPUT"
"${build[@]}" -j4
"${build[@]}" install
