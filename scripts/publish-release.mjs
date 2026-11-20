import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version,tag=`v${version}`;
const stage=process.argv.includes('--stage-replacement');
const commit=process.env.GITHUB_SHA??'';
if(stage){
 if(version!=='1.0.0'||process.env.GITHUB_EVENT_NAME!=='workflow_dispatch'||process.env.GITHUB_REF!=='refs/heads/main'||!/^[a-f0-9]{40}$/.test(commit))
  throw Error('Replacement drafts can only be built by manual v1.0.0 main runs.');
}else if(process.env.GITHUB_REF_TYPE!=='tag'||process.env.GITHUB_REF_NAME!==tag) throw Error('Publishing requires the matching version tag.');
const destination=stage?`staging-${version}-${commit.slice(0,10)}`:tag;
const prerelease=version.includes('-'),args=['release','view',destination,'--json','isDraft'];
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
  const intro=stage?'Windows x64 重新构建版。已安装 1.0.0 的用户可手动下载安装包，或完整替换便携程序目录。\n\n':'';
  fs.writeFileSync(filename,intro+'## '+notes.trim().replaceAll('(docs/PLATFORMS.md)',`(https://github.com/ALittlePandaMan/mijia-desktop/blob/${commit||tag}/docs/PLATFORMS.md)`)+'\n');
  execFileSync('gh',['release','create',destination,...(stage?['--target',commit]:['--verify-tag']),'--draft','--title',`米家Desktop ${tag}`,'--notes-file',filename,...(prerelease?['--prerelease']:[])],{stdio:'inherit'});
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}
execFileSync('gh',['release','upload',destination,...files,'--clobber'],{stdio:'inherit'});
if(stage){
 const draft=JSON.parse(execFileSync('gh',['release','view',destination,'--json','isDraft,assets,targetCommitish'],{encoding:'utf8'}));
 if(!draft.isDraft||draft.targetCommitish!==commit||draft.assets.length!==files.length)throw Error('Staged release identity does not match.');
 for(const file of files){
  const actual=draft.assets.find(asset=>asset.name===path.basename(file));
  const bytes=fs.readFileSync(file),digest='sha256:'+createHash('sha256').update(bytes).digest('hex');
  if(actual?.size!==bytes.length||actual.digest!==digest)throw Error(`Staged checksum mismatch: ${path.basename(file)}`);
 }
 console.log(`Verified private replacement draft: ${destination} (${commit})`);
 process.exit(0);
}
execFileSync('gh',['release','edit',tag,'--draft=false',`--prerelease=${prerelease}`,`--latest=${!prerelease}`],{stdio:'inherit'});
console.log(`Published ${tag} with Windows x64 downloads.`);
