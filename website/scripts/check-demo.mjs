// Static build/source checks only; this file never executes the browser demo.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { releasesPage, windowsInstaller } from '../app/windows-installer.ts';
const files=[];
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const name=path.join(dir,entry.name);if(entry.isDirectory())walk(name);else files.push(name);}}
walk('demo');
for(const name of files){
 if(!/\.(ts|css|html|json)$/.test(name))continue;const text=fs.readFileSync(name,'utf8');
 if(/\b(?:gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,})|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))throw Error('Credential pattern in '+name);
 if(/[A-Za-z]:[\\/](?:Users|agent)[\\/]/.test(text))throw Error('Personal absolute path in '+name);
 if(/\.ts$/.test(name)&&/\b(?:from\s*|import\s*\(?\s*)['"](?:@tauri-apps\/|[^'"]*\/api(?:\.ts)?)['"]/.test(text))throw Error('Forbidden native import in '+name);
 for(const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.[^'"]+)['"]/g)){const ref=path.resolve(path.dirname(name),match[1].split('?')[0]);if(!['','.ts','.css','.json'].some(ext=>fs.existsSync(ref+ext)))throw Error('Broken import: '+name+' -> '+match[1]);}
}
const hash=name=>crypto.createHash('sha256').update(fs.readFileSync(name)).digest('hex');
const brand=JSON.parse(fs.readFileSync('public/brand-icon-provenance.json','utf8'));
if(brand.color!=='#3A83F7'||brand.master.width!==512||brand.master.height!==512)throw Error('Unexpected blue brand master');
for(const file of brand.files)for(const base of ['public','out']){
 const name=path.join(base,file.path),bytes=fs.readFileSync(name);
 if(hash(name)!==file.sha256||bytes.length!==file.bytes)throw Error('Brand resource mismatch: '+name);
 if(name.endsWith('.png')&&(bytes.readUInt32BE(16)!==file.width||bytes.readUInt32BE(20)!==file.height))throw Error('Brand PNG dimensions mismatch: '+name);
}
if(hash('public/app-icon-blue.svg')!==brand.master.sha256)throw Error('Website differs from the desktop brand master');
if(hash('public/demo/fonts/MiSansVF.ttf')!==hash('demo/desktop/src/assets/fonts/MiSansVF.ttf'))throw Error('MiSans original bytes differ');
const productImages=JSON.parse(fs.readFileSync('public/devices/provenance.json','utf8'));
const products=JSON.parse(fs.readFileSync('demo/products.json','utf8'));
if(productImages.assets.length!==Object.keys(products).length||new Set(productImages.assets.map(asset=>asset.id)).size!==Object.keys(products).length)throw Error('Expected all selected Mi Home product icons');
for(const asset of productImages.assets){
 if(products[asset.id]?.model!==asset.model||products[asset.id]?.iconSource!==asset.assetSource)throw Error('Desktop product model/image mismatch: '+asset.id);
 for(const base of ['public','out']){const file=path.join(base,'devices',asset.file),bytes=fs.readFileSync(file);if(hash(file)!==asset.sha256||bytes.length!==asset.bytes||bytes.readUInt32BE(16)!==asset.width||bytes.readUInt32BE(20)!==asset.height)throw Error('Product image hash/size mismatch: '+file);}
}
const manifest=JSON.parse(fs.readFileSync('demo/desktop/provenance.json','utf8'));for(const file of manifest.files)if(hash('demo/desktop/'+file.path)!==file.sha256)throw Error('Snapshot hash mismatch: '+file.path);
for(const entry of ['src/ui/airer-page.ts','src/ui/washer-page.ts','src/ui/washer-runtime-page.ts','src/fixtures/laundry-sample.ts'])if(!manifest.entries.includes(entry))throw Error('Desktop page missing from shared export: '+entry);
for(const entry of ['src/ui/device-grid.ts','src/ui/card-size-menu.ts','src-tauri/src/fixtures/home_card_presentations.json'])if(!manifest.entries.includes(entry))throw Error('Desktop card sizing/template export missing: '+entry);
const cards=fs.readFileSync('demo/cards.ts','utf8');for(const binding of ['deviceCardView(','sizeDeviceGrid(','cardSizeMenu(','updateCardControls('])if(!cards.includes(binding))throw Error('Shared desktop card behavior not connected: '+binding);
const laundry=fs.readFileSync('demo/laundry.ts','utf8'),showcase=fs.readFileSync('demo/showcase.ts','utf8'),embeddingCss=fs.readFileSync('demo/showcase.css','utf8');
for(const renderer of ['airerPage','washerPage','washerRuntimePage'])if(!laundry.includes(renderer+'('))throw Error('Desktop laundry renderer not connected: '+renderer);
for(const renderer of ['renderSwitchPage','renderFanPage','renderLightPage','renderAirConditionerPage','renderTemperatureHumidityPage'])if(!showcase.includes('views.'+renderer+'.call('))throw Error('Desktop device renderer not connected: '+renderer);
if(/renderLaundry|showcase-laundry/.test(laundry+showcase+embeddingCss)||/\.showcase-device-dialog\s+\.device-page-(?:header|title)|\.showcase-device-dialog\s+\.outlet-hero/.test(embeddingCss))throw Error('Website device styling override remains');
const media=JSON.parse(fs.readFileSync('public/demo-media/provenance.json','utf8'));
if(media.schemaVersion!==4||media.sourceKind!=='synthetic-scene'||media.images.length!==4||new Set(media.images.map(entry=>entry.id)).size!==4)throw Error('Expected four synthetic camera still images');
// Read JPEG dimensions from the file header; no browser or application execution.
function inspectJpeg(name){
 const bytes=fs.readFileSync(name);if(bytes.readUInt16BE(0)!==0xffd8)throw Error('Invalid JPEG: '+name);let offset=2;
 while(offset+8<bytes.length){if(bytes[offset]!==0xff)throw Error('Invalid JPEG marker');while(bytes[offset]===0xff)offset++;const marker=bytes[offset++];if(marker===0xd9||marker===0xda)break;const size=bytes.readUInt16BE(offset);if(size<2||offset+size>bytes.length)throw Error('Invalid JPEG segment');if([0xc0,0xc1,0xc2].includes(marker))return {width:bytes.readUInt16BE(offset+5),height:bytes.readUInt16BE(offset+3)};offset+=size;}
 throw Error('Missing JPEG dimensions: '+name);
}
let imageBytes=0;
for(const entry of media.images){
 if(!entry.title||entry.source?.kind!==media.sourceKind||entry.processing?.outputKind!=='static-image')throw Error('Incomplete camera still provenance: '+entry.id);
 const asset=entry.image;if(asset.format!=='JPEG'||asset.width<640||asset.width>1920||asset.height<360||asset.height>1920||asset.path!=='/demo-media/'+entry.id+'.jpg'||!/^(?:entryway|courtyard|workshop|garage)$/.test(entry.id))throw Error('Unexpected image format: '+entry.id);
 for(const base of ['public','out']){const name=base+asset.path;if(!fs.existsSync(name)||hash(name)!==asset.sha256||fs.statSync(name).size!==asset.bytes)throw Error('Image hash/size mismatch: '+name);const size=inspectJpeg(name);if(size.width!==asset.width||size.height!==asset.height)throw Error('Actual JPEG dimensions mismatch: '+name);}
 imageBytes+=asset.bytes;
}
if(imageBytes!==media.totalImageBytes)throw Error('Image size mismatch');
const expectedMedia=new Set(['provenance.json',...media.images.map(entry=>path.basename(entry.image.path))]);
for(const base of ['public/demo-media','out/demo-media'])if(fs.readdirSync(base).some(file=>!expectedMedia.has(file)))throw Error('Unexpected files in image-only demo: '+base);
for(const notice of ['public/licenses/demo-media-NOTICE.md','out/licenses/demo-media-NOTICE.md','public/licenses/THIRD_PARTY_NOTICES.md'])if(!fs.existsSync(notice))throw Error('Missing image license: '+notice);
for(const name of ['app/promo.tsx','demo/showcase.ts','demo/monitor-demo.ts'])if(/RoomRenderer|from ['"]\.\/room['"]|\/scenes\//.test(fs.readFileSync(name,'utf8')))throw Error('Old room source reference: '+name);
const cameraSource=fs.readFileSync('demo/camera-source.ts','utf8');for(const entry of media.images)if(!cameraSource.includes("'"+entry.id+"'")||!cameraSource.includes(entry.title))throw Error('Camera image/name not wired: '+entry.id);
if(/HTMLVideoElement|createElement\(['"]video|\.mp4/.test(cameraSource))throw Error('Unexpected video source');
const catalog=fs.readFileSync('demo/catalog.ts','utf8'),catalogDevices=[...catalog.matchAll(/\{id:'([^']+)',kind:'([^']+)',name:'[^']+',room:'([^']+)'\}/g)];
if(catalogDevices.length!==15||new Set(catalogDevices.map(match=>match[1])).size!==15||new Set(catalogDevices.map(match=>match[3])).size!==5)throw Error('Incomplete room/device catalog');
if(catalogDevices.some(device=>['kitchen-outlet','bathroom-outlet'].includes(device[1])))throw Error('Removed outlet remains in catalog');
if(products.ac?.model!=='xiaomi.airc.h55h00'||products['ac-standing']?.model!=='xiaomi.airc.frlysj')throw Error('Requested AC artwork missing');
const cardStatus=JSON.parse(fs.readFileSync('demo/card-status-config.json','utf8')),cardSource=new URL(cardStatus.source.url);
if(cardSource.origin!=='https://api.mijia.tech'||cardSource.pathname!=='/app/service/getappconfig'||!/^[a-f0-9]{64}$/.test(cardStatus.source.sha256)||Object.keys(cardStatus.entries).length!==8)throw Error('Invalid public desktop card configuration');
for(const [category,entry] of Object.entries(cardStatus.entries))if(!entry.types.includes(category)||!entry.card_items?.length||!entry.card_instance?.some(layout=>[5,6].includes(layout.instance_type)))throw Error('Incomplete desktop card category: '+category);
const balcony=catalogDevices.filter(device=>device[3]==='balcony');if(balcony.length!==2||!balcony.some(device=>device[2]==='airer')||!balcony.some(device=>device[2]==='washer'))throw Error('Expected balcony airer and washer');
for(const device of catalogDevices)if(!productImages.assets.some(asset=>asset.id===device[2]))throw Error('Missing catalog product art: '+device[1]);
for(const entry of ['public/demo/index.html','out/index.html','out/demo/index.html','out/demo/fonts/MiSansVF.ttf'])if(!fs.existsSync(entry))throw Error('Missing build output: '+entry);
for(const index of ['public/demo/index.html','out/demo/index.html']){
 const hrefs=[...fs.readFileSync(index,'utf8').matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+)"/g)];
 if(!hrefs.length)throw Error('Missing relative demo bundles: '+index);
 for(const [,href] of hrefs)if(!fs.existsSync(path.resolve(path.dirname(index),href)))throw Error('Missing demo asset: '+href);
}
const base=process.env.NEXT_PUBLIC_SITE_BASE_PATH||'';
const page=fs.readFileSync('out/index.html','utf8');
assert.ok(page.includes(`href="${releasesPage}"`), 'Static downloads link to Releases while metadata loads');
const releaseTag='v0.1.0', installerName=`mijia-desktop-${releaseTag}-windows-x64-setup.exe`;
const installerUrl=`${releasesPage}/download/${releaseTag}/${installerName}`;
const asset={name:installerName,state:'uploaded',browser_download_url:installerUrl};
const release={tag_name:releaseTag,draft:false,prerelease:false,assets:[asset]};
assert.equal(windowsInstaller(release),installerUrl);
assert.equal(windowsInstaller({...release,prerelease:true}),undefined);
assert.equal(windowsInstaller({...release,assets:[{...asset,browser_download_url:`${releasesPage}/download/v1.0.0/${installerName}`}]}),undefined);
for(const asset of ['demo/index.html','demo/fonts/MiSansVF.ttf','app-icon-blue.svg','licenses/THIRD_PARTY_NOTICES.md','_next/static/']){
 if(!page.includes(base+'/'+asset))throw Error('Missing Pages asset URL: '+asset);
}
if(page.includes('/api/github-stats')||fs.existsSync('out/api'))throw Error('Server-only stats endpoint in static website');
console.log(JSON.stringify({sourceFiles:files.length,snapshotFiles:manifest.files.length,originalFont:true,rooms:5,devices:15,cameraStills:4,imageBytes,outputs:'static Pages homepage and browser demo'}));
