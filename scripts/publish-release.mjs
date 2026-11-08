import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version,tag=`v${version}`;
if(process.env.GITHUB_REF_TYPE!=='tag'||process.env.GITHUB_REF_NAME!==tag) throw Error('Publishing requires the matching version tag.');
const prerelease=version.includes('-'),args=['release','view',tag,'--json','isDraft'];
let existing;
try{existing=JSON.parse(execFileSync('gh',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}));}
catch(error){if(!/not found|HTTP 404/i.test(String(error.stderr))) throw error;}
if(existing&&!existing.isDraft) throw Error('This version is already public; publish a new version instead of overwriting it.');
const directory=path.resolve('release-assets'),files=fs.readdirSync(directory).sort().map(name=>path.join(directory,name));
if(files.length!==10) throw Error('Expected eight packages and two checksum files.');
if(!existing)execFileSync('gh',['release','create',tag,'--verify-tag','--draft','--title',`米家Desktop ${tag}`,'--generate-notes',...(prerelease?['--prerelease']:[])],{stdio:'inherit'});
execFileSync('gh',['release','upload',tag,...files,'--clobber'],{stdio:'inherit'});
execFileSync('gh',['release','edit',tag,'--draft=false',`--prerelease=${prerelease}`,`--latest=${!prerelease}`],{stdio:'inherit'});
console.log(`Published ${tag} with all platform downloads.`);
