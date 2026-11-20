param([string]$Bash=$env:MIJIA_MEDIA_BASH,[string]$Toolchain=$env:MIJIA_MEDIA_TOOLCHAIN_BIN,[switch]$Rebuild)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$work=Join-Path $root '.tools/media-build'
$destination=Join-Path $root 'src-tauri/media-decoder'
New-Item -ItemType Directory -Force -Path $work,$destination | Out-Null
$source=Join-Path $work 'ffmpeg-9.0.2'
$archive=Join-Path $work 'ffmpeg-source.tar.xz'
$pin=Get-Content (Join-Path $root 'native/media-decoder.json') -Raw | ConvertFrom-Json
function Get-PinnedFile([string]$Url,[string]$Hash,[string]$Path) {
 if (!(Test-Path -LiteralPath $Path)) {
  $temporary=$Path+'.download'
  & curl.exe --silent --show-error --fail -L --connect-timeout 15 --max-time 900 -o $temporary $Url
  if ($LASTEXITCODE -or (Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Hash) { throw 'Pinned media build download failed verification.' }
  Move-Item -LiteralPath $temporary -Destination $Path
 }
 if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Hash) { throw 'Cached media build input hash mismatch.' }
}
Get-PinnedFile $pin.sourceUrl $pin.sourceSha256 $archive
$assembler=Join-Path $work 'nasm.zip'
Get-PinnedFile $pin.assemblerUrl $pin.assemblerSha256 $assembler
if (!(Test-Path (Join-Path $work 'nasm/nasm-2.16.03/nasm.exe'))) { Expand-Archive -LiteralPath $assembler -DestinationPath (Join-Path $work 'nasm') -Force }
if (!$Bash) { $git=Get-Command git.exe; $Bash=Join-Path (Split-Path (Split-Path $git.Source -Parent) -Parent) 'bin/bash.exe' }
if (!$Toolchain) { $gcc=Get-Command gcc.exe -ErrorAction Stop; $Toolchain=Split-Path $gcc.Source -Parent }
$nasm=Get-ChildItem (Join-Path $work 'nasm') -Filter nasm.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (!$nasm) { throw 'Provide NASM 2.16.03 under .tools/media-build/nasm (official nasm.us build).' }
if (!(Test-Path -LiteralPath $archive)) { throw 'Download the pinned FFmpeg source using native/media-decoder.json first.' }
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pin.sourceSha256) { throw 'FFmpeg source hash mismatch.' }
if (!(Test-Path -LiteralPath $source)) { & tar.exe -xf $archive -C $work; if ($LASTEXITCODE) { throw 'Source extraction failed.' } }
$prefix=Join-Path $work 'installed'
if ($Rebuild -or !(Test-Path (Join-Path $prefix 'bin/avcodec-63.dll'))) {
 $env:MIJIA_MEDIA_SOURCE=$source.Replace('\','/');$env:MIJIA_MEDIA_OUTPUT=$prefix.Replace('\','/');$env:MIJIA_MEDIA_TOOLCHAIN=$Toolchain.Replace('\','/');$env:MIJIA_MEDIA_NASM=$nasm.DirectoryName.Replace('\','/')
 & $Bash (Join-Path $root 'native/build-decoder.sh');if ($LASTEXITCODE) { throw 'FFmpeg build failed.' }
}
$gcc=Join-Path $Toolchain 'gcc.exe'
& $gcc -O2 -std=c11 -static-libgcc -I (Join-Path $prefix 'include') (Join-Path $root 'native/media-decoder.c') -L (Join-Path $prefix 'lib') -lavformat -lavcodec -lswscale -lswresample -lavutil -o (Join-Path $destination 'mijia-media-decoder.exe')
if ($LASTEXITCODE) { throw 'Preview worker build failed.' }
foreach ($file in @('avcodec-63.dll','avformat-63.dll','avutil-61.dll','swscale-10.dll','swresample-7.dll')) { Copy-Item -LiteralPath (Join-Path $prefix ('bin/'+$file)) -Destination $destination }
Copy-Item -LiteralPath (Join-Path $source 'COPYING.LGPLv2.1') -Destination (Join-Path $destination 'COPYING.LGPLv2.1')
Copy-Item -LiteralPath $archive -Destination (Join-Path $destination 'ffmpeg-source.tar.xz')
Copy-Item -LiteralPath (Join-Path $root 'native/build-decoder.sh') -Destination $destination
Copy-Item -LiteralPath (Join-Path $root 'native/media-decoder.json') -Destination $destination
$files=Get-ChildItem -LiteralPath $destination -File | Where-Object Name -NE 'manifest.json' | Sort-Object Name | ForEach-Object { @{file=$_.Name;bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()} }
@{schemaVersion=1;source=$pin;files=@($files)} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $destination 'manifest.json') -Encoding utf8
Write-Output ('Preview decoder built: '+$destination)
