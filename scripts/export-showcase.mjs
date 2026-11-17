import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const destination=process.argv[2];
if(!destination)throw Error('Usage: node scripts/export-showcase.mjs <website/demo/desktop>');
const target=path.resolve(destination);
if(!target.endsWith(path.join('demo','desktop'))||target===root||target.startsWith(root+path.sep))throw Error('Destination must be a separate website/demo/desktop directory.');
const entries=['src/home-grid.ts','src/ui/curtain-view.ts','src/ui/device-presenters.ts','src/ui/device-card-view.ts','src/ui/television-page.ts','src/ui/camera-control-view.ts','src/ui/device-surfaces.ts','src/ui/dialog-dismiss.ts','src/ui/history-chart.ts','src/fixtures/television-sample.ts','src/style.css','src/theme.css','src/ui/quiet-feedback.css','src/ui/monitor-wall.css','src/camera-player.css'];
entries.push('src/ui/airer-page.ts','src/ui/washer-page.ts','src/ui/washer-runtime-page.ts','src/ui/washer-records-page.ts','src/fixtures/laundry-sample.ts');
entries.push('src/ui/camera-toolbar-motion.css');
const seen=new Set(),files=[];
function visit(relative){
 relative=relative.replaceAll('\\','/');if(seen.has(relative))return;seen.add(relative);
 const absolute=path.resolve(root,relative);if(!absolute.startsWith(root+path.sep)||!fs.statSync(absolute).isFile())throw Error('Invalid dependency: '+relative);
 if(/(^|\/)(api|main|camera-page|camera-player|monitor|account|desktop-frame)\.ts$/.test(relative))throw Error('Native/business entry is forbidden in showcase: '+relative);
 const bytes=fs.readFileSync(absolute);files.push({path:relative,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
 const out=path.join(target,relative);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,bytes);
 if(!/\.(?:ts|css)$/.test(relative))return;
 const text=bytes.toString('utf8'),references=new Set();
 for(const expression of [/(?:\bfrom\s*|\bimport\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g,/@import\s+['"]([^'"]+)['"]/g,/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g])for(const match of text.matchAll(expression)){if(match[1].startsWith('.'))references.add(match[1].split('?')[0]);}
 for(const dependency of references){let candidate=path.resolve(path.dirname(absolute),dependency);if(!fs.existsSync(candidate))candidate+='.ts';visit(path.relative(root,candidate));}
}
for(const entry of entries)visit(entry);
for(const license of ['LICENSE','docs/THIRD_PARTY_NOTICES.md','licenses/mijia-assets/NOTICE.txt','licenses/fonts/MiSans/LICENSE.zh-CN.txt','licenses/fonts/MiSans/provenance.json','src/assets/mijia/library-manifest.json','licenses/npm/echarts-6.1.0/LICENSE','licenses/npm/echarts-6.1.0/NOTICE','licenses/npm/zrender-6.1.0/LICENSE'])if(fs.existsSync(path.join(root,license)))visit(license);
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
fs.writeFileSync(path.join(target,'provenance.json'),JSON.stringify({repository:'https://github.com/ALittlePandaMan/mijia-desktop',baseCommit:commit,workingTreeSnapshot:true,entries,files:files.sort((a,b)=>a.path.localeCompare(b.path))},null,2)+'\n');
console.log(`Exported ${files.length} source, style, asset, and license files.`);
