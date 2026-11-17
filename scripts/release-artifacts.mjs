import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {verifyUpdateSignature} from './updater-signatures.mjs';
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
const platforms=['windows-x64'];
const packages=['setup.exe','portable.zip'].map(suffix=>`mijia-desktop-v${version}-windows-x64-${suffix}`);
const expectedFiles=new Set(packages.flatMap(file=>[file,file+'.sig']));
const output=path.resolve('release-assets');fs.mkdirSync(output,{recursive:true});
const artifacts=[];
for(const platform of platforms){
 const folder=path.resolve('artifacts',platform),build=JSON.parse(fs.readFileSync(path.join(folder,'build.json'),'utf8'));
 if(build.version!==version||build.platform!==platform||build.commit!==process.env.GITHUB_SHA||build.artifacts.length!==4) throw Error(`Invalid build manifest: ${platform}.`);
 for(const record of build.artifacts){
  if(path.basename(record.file)!==record.file||!expectedFiles.has(record.file)) throw Error('Invalid artifact name.');
  const source=path.join(folder,record.file),bytes=fs.readFileSync(source);
  if(bytes.length!==record.bytes||createHash('sha256').update(bytes).digest('hex')!==record.sha256) throw Error(`Artifact mismatch: ${record.file}.`);
  fs.copyFileSync(source,path.join(output,record.file));artifacts.push({...record,platform});
 }
}
if(artifacts.length!==4||new Set(artifacts.map(a=>a.file)).size!==4) throw Error('Incomplete or duplicated Windows release.');
const platformsForUpdate={};
for(const [index,file] of packages.entries()){
 const signature=fs.readFileSync(path.join(output,file+'.sig'),'utf8').trim();
 verifyUpdateSignature(path.join(output,file),signature,version);
 platformsForUpdate[index===0?'windows-x86_64':'windows-x86_64-portable']={url:`https://github.com/ALittlePandaMan/mijia-desktop/releases/download/v${version}/${file}`,signature};
}
const changelog=fs.readFileSync('CHANGELOG.md','utf8');
const notes=changelog.split(/^## /m).find(section=>section.startsWith(version)||section.startsWith(`[${version}]`))?.trim().slice(0,16000)??`米家Desktop ${version}`;
fs.writeFileSync(path.join(output,'latest.json'),JSON.stringify({version,notes,pub_date:new Date().toISOString(),platforms:platformsForUpdate},null,2)+'\n');
artifacts.sort((a,b)=>a.file.localeCompare(b.file,'en'));
fs.writeFileSync(path.join(output,'SHA256SUMS'),artifacts.map(a=>`${a.sha256}  ${a.file}`).join('\n')+'\n');
fs.writeFileSync(path.join(output,'SHA256.json'),JSON.stringify({version,commit:process.env.GITHUB_SHA,artifacts},null,2)+'\n');
console.log('Verified two signed Windows x64 packages and generated updater metadata.');
