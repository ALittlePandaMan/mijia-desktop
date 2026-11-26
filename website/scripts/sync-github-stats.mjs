// Public repository metadata only. --use-gh uses the existing CLI login without
// reading, exporting or storing its credentials in the website or snapshot.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
const run=promisify(execFile),repository='ALittlePandaMan/mijia-desktop';
const headers={Accept:'application/vnd.github+json','User-Agent':'mijia-desktop-website','X-GitHub-Api-Version':'2026-03-10'};
const signal=AbortSignal.timeout(20_000);
async function api(path){
 const response=await fetch('https://api.github.com/repos/'+repository+path,{headers,signal});
 if(!response.ok)throw new Error('GitHub metadata request failed: '+response.status);
 return response.json();
}
async function publicReleases(){
 const releases=[];
 for(let page=1;;page++){
  const batch=await api('/releases?per_page=100&page='+page);
  if(!Array.isArray(batch))throw new Error('Invalid release response');
  releases.push(...batch);if(batch.length<100)return releases;
 }
}
let repo,releases;
if(process.argv.includes('--use-gh')){
 const options={windowsHide:true,maxBuffer:20*1024*1024,timeout:20_000};
 const [info,pages]=await Promise.all([run('gh',['api','repos/'+repository],options),run('gh',['api','repos/'+repository+'/releases?per_page=100','--paginate','--slurp'],options)]);
 repo=JSON.parse(info.stdout);releases=JSON.parse(pages.stdout).flat();
}else [repo,releases]=await Promise.all([api(''),publicReleases()]);
if(repo.full_name!==repository||!Number.isSafeInteger(repo.stargazers_count)||repo.stargazers_count<0||!Array.isArray(releases))throw new Error('Invalid GitHub repository metadata');
let downloads=0;const assets=new Set();
for(const release of releases){
 if(release.draft)continue;
 if(!Array.isArray(release.assets))throw new Error('Missing release assets');
 for(const asset of release.assets){
  if(!Number.isSafeInteger(asset.id)||!Number.isSafeInteger(asset.download_count)||asset.download_count<0)throw new Error('Invalid asset count');
  if(!assets.has(asset.id)){assets.add(asset.id);downloads+=asset.download_count;}
 }
}
if(!Number.isSafeInteger(downloads))throw new Error('Download total exceeds the safe integer range');
const stats={repository,stars:repo.stargazers_count,downloads,updatedAt:new Date().toISOString()};
await mkdir(new URL('../data/',import.meta.url),{recursive:true});
await writeFile(new URL('../data/github-stats.json',import.meta.url),JSON.stringify(stats,null,2)+'\n');
console.log(JSON.stringify(stats));
