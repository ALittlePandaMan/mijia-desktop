import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version,tag=`v${version}`;
const commit=process.env.GITHUB_SHA??'';
if(process.env.GITHUB_REF_TYPE!=='tag'||process.env.GITHUB_REF_NAME!==tag) throw Error('Publishing requires the matching version tag.');
const prerelease=version.includes('-'),args=['release','view',tag,'--json','isDraft'];
let existing;
try{existing=JSON.parse(execFileSync('gh',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}));}
catch(error){if(!/not found|HTTP 404/i.test(String(error.stderr))) throw error;}
if(existing&&!existing.isDraft) throw Error('This version is already public; publish a new version instead of overwriting it.');
const directory=path.resolve('release-assets'),files=fs.readdirSync(directory).sort().map(name=>path.join(directory,name));
const packages=[`mijia-desktop-v${version}-windows-x64-setup.exe`,`mijia-desktop-v${version}-windows-x64-portable.zip`];
const expectedFiles=new Set([...packages,...packages.map(file=>file+'.sig'),'latest.json','SHA256SUMS','SHA256.json']);
if(files.length!==expectedFiles.size||files.some(file=>!expectedFiles.has(path.basename(file)))) throw Error('Expected two signed Windows packages, updater metadata and checksum files.');
if(!existing){
 const notes=fs.readFileSync('CHANGELOG.md','utf8').split(/^## /m).find(section=>section.startsWith(version+' ')||section.startsWith(version+'\n')||section.startsWith(`[${version}]`));
 if(!notes)throw Error('Missing changelog entry for this release.');
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'mijia-release-'));
 try{
  const filename=path.join(temporary,'notes.md');
  fs.writeFileSync(filename,'## '+notes.trim().replaceAll('(docs/PLATFORMS.md)',`(https://github.com/ALittlePandaMan/mijia-desktop/blob/${commit||tag}/docs/PLATFORMS.md)`)+'\n');
  execFileSync('gh',['release','create',tag,'--verify-tag','--draft','--title',`米家Desktop ${tag}`,'--notes-file',filename,...(prerelease?['--prerelease']:[])],{stdio:'inherit'});
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}
execFileSync('gh',['release','upload',tag,...files,'--clobber'],{stdio:'inherit'});
execFileSync('gh',['release','edit',tag,'--draft=false',`--prerelease=${prerelease}`,`--latest=${!prerelease}`],{stdio:'inherit'});
console.log(`Published ${tag} with Windows x64 downloads.`);
