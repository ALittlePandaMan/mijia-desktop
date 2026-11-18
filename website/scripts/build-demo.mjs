import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),snapshot=path.join(root,'demo','desktop');
const manifest=JSON.parse(fs.readFileSync(path.join(snapshot,'provenance.json'),'utf8'));
for(const file of manifest.files){const hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(snapshot,file.path))).digest('hex');if(hash!==file.sha256)throw Error('Desktop snapshot changed without sync: '+file.path);}
await build({
  logLevel: 'warn',
  configFile: false,
  root: path.join(root, 'demo'),
  base: './',
  publicDir: false,
  plugins: [{
    name: 'isolated-desktop-presentation',
    enforce: 'pre',
    resolveId(id, importer) {
      if (id.startsWith('@tauri-apps/') || /\/(?:api|main|camera-page|camera-player|monitor)\.ts$/.test(id.replaceAll('\\', '/'))) {
        throw Error('Native/business dependency in browser demo: ' + id + ' from ' + importer);
      }
    }
  }],
  build: {
    outDir: path.join(root, 'public', 'demo'),
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1800,
    rolldownOptions: {
      output: {
        assetFileNames(asset) {
          // The site and both previews share one URL and one set of font bytes.
          return asset.names.includes('MiSansVF.ttf') ? 'fonts/MiSansVF.ttf' : 'assets/[name]-[hash][extname]';
        },
        manualChunks(id) {
          if (id.includes('/node_modules/echarts/') || id.includes('/node_modules/zrender/')) return 'history-engine';
        }
      }
    }
  }
});
