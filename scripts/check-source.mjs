// Static source/package boundary checks. Does not run application code or tests.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root = process.cwd(), errors = [];
const listed = args => execFileSync('git', ['ls-files', '-z', ...args], {encoding: 'utf8', maxBuffer: 20_000_000}).split('\0').filter(Boolean);
const names = [...new Set([...listed(['--cached']), ...listed(['--others', '--exclude-standard'])])];
const fail = (name, reason) => errors.push(`${name}: ${reason}`);
const resolveReference = (name, reference) => {
  const clean = reference.split(/[?#]/)[0];
  if (!clean.startsWith('.')) return;
  const base = path.resolve(path.dirname(name), clean);
  if (!['', '.ts', '.tsx', '.js', '.mjs', '.json', '.css', '/index.ts'].some(ext => fs.existsSync(base + ext))) fail(name, `missing reference ${clean}`);
};
for (const name of names) {
  if (!fs.existsSync(name)) { fail(name, 'tracked file is missing'); continue; }
  if (fs.lstatSync(name).isSymbolicLink()) { fail(name, 'source symlinks are not distributed'); continue; }
  if (/^(?:research|deliverables|\.tools|dist|node_modules|artifacts|release-assets)\//.test(name) || /^src-tauri\/(?:target|examples)\//.test(name)) fail(name, 'private/generated material in source set');
  if (/\.(?:apk|mp4|pfx|p12|key|pem|mobileprovision|log)$/i.test(name) || /(?:^|\/)\.env(?:\.|$)/.test(name)) fail(name, 'private/exported file type in source set');
  if (fs.statSync(name).size > 50 * 1024 * 1024) fail(name, 'file exceeds the source size budget');
  if (!/\.(?:ts|rs|mjs|cjs|json|md|toml|yml|yaml|css|html|txt)$/.test(name) && !['README.md','LICENSE'].includes(name)) continue;
  const text = fs.readFileSync(name, 'utf8');
  if (/(?:gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(text)) fail(name, 'credential/private-key pattern; value omitted');
  if (/[A-Za-z]:[\\/](?:Users|agent)[\\/](?!Public[\\/])/.test(text)) fail(name, 'personal absolute path; value omitted');
  if (/\.(?:ts|mjs|cjs)$/.test(name)) {
    for (const match of text.matchAll(/\b(?:from\s*|import\s*\(?\s*)['"](\.[^'"\n]+)['"]/g)) resolveReference(name, match[1]);
  }
  if (/\.rs$/.test(name)) for (const match of text.matchAll(/include_(?:str|bytes)!\(\s*"([^"]+)"/g)) {
    if (!fs.existsSync(path.resolve(path.dirname(name), match[1]))) fail(name, `missing Rust fixture ${match[1]}`);
  }
  if (/\.css$/.test(name)) for (const match of text.matchAll(/url\(\s*['"]?(\.[^'"\)]+)['"]?\s*\)/g)) resolveReference(name, match[1]);
  if (/\.md$/.test(name)) for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const link = match[1].split('#')[0];
    if (!link || /^[a-z]+:|^\//i.test(link)) continue;
    if (!fs.existsSync(path.resolve(path.dirname(name), decodeURIComponent(link)))) fail(name, `missing documentation link ${link}`);
  }
}
const assetRoot = 'src/assets/mijia';
const manifest = JSON.parse(fs.readFileSync(`${assetRoot}/library-manifest.json`, 'utf8'));
const rows = new Map(manifest.images.map(row => [row.file, row]));
const bindings = JSON.parse(fs.readFileSync(`${assetRoot}/bindings.json`, 'utf8')).bindings;
for (const row of [...rows.values(), ...Object.values(bindings)]) {
  const name = `${assetRoot}/${row.file}`;
  if (!fs.existsSync(name)) fail(name, 'missing bound image');
  else if (createHash('sha256').update(fs.readFileSync(name)).digest('hex') !== row.sha256) fail(name, 'image differs from provenance hash');
}
if (!names.length) throw Error('No Git source files found.');
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(JSON.stringify({files: names.length, boundAssets: Object.keys(bindings).length, provenanceFiles: rows.size, scope: 'static files only; no tests/UI/devices executed'}));
