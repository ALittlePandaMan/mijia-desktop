// Package and inspect build files only. Never launches the built application.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const targets = {'windows-x64':'x86_64-pc-windows-msvc','linux-x64':'x86_64-unknown-linux-gnu','macos-arm64':'aarch64-apple-darwin','macos-x64':'x86_64-apple-darwin'};
const platform = process.argv[2], target = targets[platform];
if (!target) throw Error('Expected a supported platform identifier.');
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const release = path.resolve('src-tauri', 'target', target, 'release'), bundle = path.join(release, 'bundle');
const output = path.resolve('artifacts', platform); fs.mkdirSync(output, {recursive:true});
const prefix = `mijia-desktop-v${version}-${platform}`, files = [];
function walk(directory) { return fs.readdirSync(directory, {withFileTypes:true}).flatMap(entry => entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]); }
function one(list, description) { if(list.length !== 1) throw Error(`Expected one ${description}, found ${list.length}.`); return list[0]; }
function copy(source, suffix) { const name=prefix+suffix; fs.copyFileSync(source, path.join(output,name)); files.push(name); return name; }
function machine(binary, expected, kind) {
 const buffer=fs.readFileSync(binary);
 let actual;
 if(kind==='pe'){ if(buffer.toString('ascii',0,2)!=='MZ') throw Error('Invalid Windows executable.'); const pe=buffer.readUInt32LE(0x3c); if(buffer.toString('ascii',pe,pe+4)!=='PE\0\0') throw Error('Invalid PE header.'); actual=buffer.readUInt16LE(pe+4); }
 else if(kind==='elf'){ if(buffer.toString('hex',0,4)!=='7f454c46') throw Error('Invalid ELF file.'); actual=buffer.readUInt16LE(18); }
 else { if(buffer.readUInt32LE(0)!==0xfeedfacf) throw Error('Expected a thin 64-bit Mach-O file.'); actual=buffer.readUInt32LE(4); }
 if(actual!==expected) throw Error(`Wrong ${kind} architecture: ${actual}.`);
}
if(platform==='windows-x64') {
 const binary=path.join(release,'mijia-desktop.exe'); machine(binary,0x8664,'pe');
 const installer=one(walk(path.join(bundle,'nsis')).filter(name=>name.endsWith('-setup.exe')),'NSIS installer'); copy(installer,'-setup.exe');
 const stage=path.join(output,'.portable'); fs.mkdirSync(stage,{recursive:true});
 fs.copyFileSync(binary,path.join(stage,'mijia-desktop.exe')); fs.copyFileSync('LICENSE',path.join(stage,'LICENSE'));
 fs.cpSync('licenses',path.join(stage,'licenses'),{recursive:true}); fs.cpSync('docs',path.join(stage,'docs'),{recursive:true});
 const archive=prefix+'-portable.zip', archivePath=path.join(output,archive);
 const script=`$ErrorActionPreference='Stop';Add-Type -AssemblyName System.IO.Compression.FileSystem;[IO.Compression.ZipFile]::CreateFromDirectory($env:MIJIA_RELEASE_STAGE,$env:MIJIA_RELEASE_ZIP,[IO.Compression.CompressionLevel]::Optimal,$false);$zip=[IO.Compression.ZipFile]::OpenRead($env:MIJIA_RELEASE_ZIP);try{$stream=$zip.GetEntry('mijia-desktop.exe').Open();$sha=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}finally{$stream.Dispose();$sha.Dispose()}}finally{$zip.Dispose()}`;
 const zipHash=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',env:{...process.env,MIJIA_RELEASE_STAGE:stage,MIJIA_RELEASE_ZIP:archivePath}}).trim();
 if(zipHash!==createHash('sha256').update(fs.readFileSync(binary)).digest('hex')) throw Error('Portable EXE mismatch.');
 files.push(archive);
} else if(platform==='linux-x64') {
 machine(path.join(release,'mijia-desktop'),62,'elf');
 const appImage=one(walk(path.join(bundle,'appimage')).filter(name=>name.endsWith('.AppImage')),'AppImage'); machine(appImage,62,'elf'); copy(appImage,'.AppImage');
 const deb=one(walk(path.join(bundle,'deb')).filter(name=>name.endsWith('.deb')),'Debian package');
 if(execFileSync('dpkg-deb',['--field',deb,'Architecture'],{encoding:'utf8'}).trim()!=='amd64') throw Error('Incorrect Debian architecture.'); copy(deb,'.deb');
} else {
 const app=one(fs.readdirSync(path.join(bundle,'macos')).filter(name=>name.endsWith('.app')),'macOS app');
 const appPath=path.join(bundle,'macos',app); machine(path.join(appPath,'Contents','MacOS','mijia-desktop'),platform==='macos-arm64'?0x0100000c:0x01000007,'macho');
 execFileSync('codesign',['--verify','--deep','--strict',appPath],{stdio:'inherit'});
 copy(one(walk(path.join(bundle,'dmg')).filter(name=>name.endsWith('.dmg')),'DMG'),'.dmg');
 const archive=prefix+'.app.tar.gz'; execFileSync('tar',['-czf',path.join(output,archive),'-C',path.dirname(appPath),path.basename(appPath)]); files.push(archive);
}
const artifacts=files.map(file=>{const bytes=fs.readFileSync(path.join(output,file));return {file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};});
fs.writeFileSync(path.join(output,'build.json'),JSON.stringify({version,platform,target,commit:process.env.GITHUB_SHA??null,artifacts,scope:'static build/package inspection only; no application/UI/device execution'},null,2)+'\n');
console.log(JSON.stringify({platform,artifacts},null,2));
