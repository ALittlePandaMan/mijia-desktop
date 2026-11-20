// Rebuild project branding from one master. Original vendor assets stay untouched.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
const masterFile='src/assets/brand/app-icon-blue.svg',master=fs.readFileSync(path.join(root,masterFile));
const markup=master.toString('utf8');
if(!markup.includes('viewBox="0 0 512 512"')||!markup.includes('flood-color="#3a83f7"'))throw Error('Expected the 512px blue brand master.');
const original=markup.match(/href="data:image\/png;base64,([^"]+)"/);
if(!original)throw Error('The master must retain its original embedded mark.');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const targetRoot=path.join(root,'src-tauri','target');fs.mkdirSync(targetRoot,{recursive:true});
const staging=fs.mkdtempSync(path.join(targetRoot,'brand-icons-'));
const cli=path.join(path.dirname(require.resolve('@tauri-apps/cli/package.json')),'tauri.js');
execFileSync(process.execPath,[cli,'icon',path.join(root,masterFile),'--output',staging],{cwd:root,stdio:'inherit'});
function list(directory,prefix=''){
 return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
  const relative=prefix+entry.name;
  return entry.isDirectory()?list(path.join(directory,entry.name),relative+'/'):[relative];
 }).sort();
}
const iconRoot=path.join(root,'src-tauri','icons'),generated=list(staging);
// Refuse a partial update if a future CLI omits one of our existing formats.
for(const file of list(iconRoot))if(file!=='mijia.ico'&&!generated.includes(file))throw Error('Missing existing platform icon: '+file);
for(const file of generated){
 const destination=path.join(iconRoot,file);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(path.join(staging,file),destination);
}
fs.copyFileSync(path.join(iconRoot,'icon.ico'),path.join(iconRoot,'mijia.ico'));
const aliases=['src/mark.svg','src-tauri/icon.svg'];
for(const file of aliases)fs.writeFileSync(path.join(root,file),master);
const files=list(iconRoot).map(file=>{
 const bytes=fs.readFileSync(path.join(iconRoot,file));
 return {path:'src-tauri/icons/'+file,sha256:hash(bytes),bytes:bytes.length};
});
const provenance={color:'#3A83F7',rgb:[58,131,247],width:512,height:512,
 source:{description:'Original application mark embedded without changing its bytes',sha256:hash(Buffer.from(original[1],'base64'))},
 master:{path:masterFile,sha256:hash(master)},generator:'@tauri-apps/cli '+require('@tauri-apps/cli/package.json').version,
 aliases:aliases.map(file=>({path:file,sha256:hash(master)})),files};
fs.writeFileSync(path.join(root,'src/assets/brand/provenance.json'),JSON.stringify(provenance,null,2)+'\n');
console.log(JSON.stringify({master:masterFile,color:provenance.color,platformFiles:files.length,aliases:aliases.length,scope:'brand resources only; no application build or installation'}));
