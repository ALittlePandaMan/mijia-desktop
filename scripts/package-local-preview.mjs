import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {copyDistributionFiles} from './distribution-files.mjs';
import {copyMediaDecoder} from './media-decoder-files.mjs';

const output=path.resolve(process.argv[2]??'artifacts/windows-x64/local-preview');
const target=path.resolve('src-tauri/target/x86_64-pc-windows-msvc/release');
const sourceBinary=path.join(target,'mijia-desktop.exe');
const installerDirectory=path.join(target,'bundle','nsis');
const installers=fs.readdirSync(installerDirectory).filter(name=>/ Preview_.+_x64-setup\.exe$/.test(name));
if(installers.length!==1)throw Error('Expected exactly one Windows x64 Preview installer.');
const sourceInstaller=path.join(installerDirectory,installers[0]);
const machine=file=>{const data=fs.readFileSync(file),pe=data.readUInt32LE(0x3c);if(data.toString('ascii',pe,pe+4)!=='PE\0\0')throw Error('Invalid Windows executable: '+file);return data.readUInt16LE(pe+4);};
if(machine(sourceBinary)!==0x8664||![0x14c,0x8664].includes(machine(sourceInstaller)))throw Error('Unexpected Windows preview architecture.');
if(fs.existsSync(output))throw Error('Choose an unused output directory for the preview.');
const portable=path.join(output,'portable');
fs.mkdirSync(portable,{recursive:true});
fs.copyFileSync(sourceBinary,path.join(portable,'mijia-desktop.exe'));
fs.writeFileSync(path.join(portable,'.mijia-desktop-portable'),'1\n');
copyDistributionFiles(portable);
copyMediaDecoder(portable);
const setup='mijia-desktop-local-preview-windows-x64-setup.exe';
const archive='mijia-desktop-local-preview-windows-x64-portable.zip';
fs.copyFileSync(sourceInstaller,path.join(output,setup));
const zip=`$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($env:MIJIA_PREVIEW_STAGE,$env:MIJIA_PREVIEW_ARCHIVE,[IO.Compression.CompressionLevel]::Optimal,$false)
$archive=[IO.Compression.ZipFile]::OpenRead($env:MIJIA_PREVIEW_ARCHIVE)
$sha=[Security.Cryptography.SHA256]::Create()
try {
  $expected=@(Get-ChildItem -File -Force -Recurse -LiteralPath $env:MIJIA_PREVIEW_STAGE)
  $entries=@($archive.Entries | Where-Object { $_.Name })
  if($entries.Count -ne $expected.Count){throw 'Unexpected portable archive members'}
  $paths=@{}
  foreach($entry in $entries){
    $normalized=$entry.FullName.Replace([char]92,[char]47)
    if($paths.ContainsKey($normalized)){throw "Duplicate portable archive entry: $normalized"}
    $paths[$normalized]=$entry
  }
  foreach($file in $expected){
    $name=$file.FullName.Substring($env:MIJIA_PREVIEW_STAGE.Length+1).Replace([char]92,[char]47)
    $entry=$paths[$name]
    if(!$entry -or $entry.Length -ne $file.Length){throw "Archive entry missing or invalid: $name"}
    $stream=$entry.Open()
    $original=$file.OpenRead()
    try{if([BitConverter]::ToString($sha.ComputeHash($stream)) -ne [BitConverter]::ToString($sha.ComputeHash($original))){throw "Archive hash mismatch: $name"}}
    finally{$stream.Dispose();$original.Dispose()}
  }
}finally{$archive.Dispose();$sha.Dispose()}`;
execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',zip],{env:{...process.env,MIJIA_PREVIEW_STAGE:portable,MIJIA_PREVIEW_ARCHIVE:path.join(output,archive)},stdio:'inherit'});
const artifacts=[setup,archive,'portable/mijia-desktop.exe'].map(file=>{
 const bytes=fs.readFileSync(path.join(output,file));
 return {file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
});
fs.writeFileSync(path.join(output,'SHA256SUMS'),artifacts.map(({file,sha256})=>`${sha256}  ${file}`).join('\n')+'\n');
console.log(JSON.stringify({output,artifacts,officialUpdateSignature:false},null,2));
