import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
const platforms=['windows-x64','linux-x64','macos-arm64','macos-x64'];
const output=path.resolve('release-assets');fs.mkdirSync(output,{recursive:true});
const artifacts=[];
for(const platform of platforms){
 const folder=path.resolve('artifacts',platform),build=JSON.parse(fs.readFileSync(path.join(folder,'build.json'),'utf8'));
 if(build.version!==version||build.platform!==platform||build.commit!==process.env.GITHUB_SHA||build.artifacts.length!==2) throw Error(`Invalid build manifest: ${platform}.`);
 for(const record of build.artifacts){
  if(path.basename(record.file)!==record.file||!record.file.startsWith(`mijia-desktop-v${version}-${platform}`)) throw Error('Invalid artifact name.');
  const source=path.join(folder,record.file),bytes=fs.readFileSync(source);
  if(bytes.length!==record.bytes||createHash('sha256').update(bytes).digest('hex')!==record.sha256) throw Error(`Artifact mismatch: ${record.file}.`);
  fs.copyFileSync(source,path.join(output,record.file));artifacts.push({...record,platform});
 }
}
if(artifacts.length!==8||new Set(artifacts.map(a=>a.file)).size!==8) throw Error('Incomplete or duplicated release.');
artifacts.sort((a,b)=>a.file.localeCompare(b.file,'en'));
fs.writeFileSync(path.join(output,'SHA256SUMS'),artifacts.map(a=>`${a.sha256}  ${a.file}`).join('\n')+'\n');
fs.writeFileSync(path.join(output,'SHA256.json'),JSON.stringify({version,commit:process.env.GITHUB_SHA,artifacts},null,2)+'\n');
console.log(`Verified ${artifacts.length} packages from all four platforms.`);
