import fs from 'node:fs';
import process from 'node:process';
const json = name => JSON.parse(fs.readFileSync(name, 'utf8'));
const files = ['package.json', 'package-lock.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/tauri.conf.json'];
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;
const cargoVersion = text => text.match(/\[package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/)?.[1];
const lockVersion = text => text.match(/\[\[package\]\]\nname = "mijia-desktop"\nversion = "([^"]+)"/)?.[1];
const [arg] = process.argv.slice(2);
if (arg === '--check') {
  const version = json('package.json').version, lock = json('package-lock.json');
  const versions = [lock.version, lock.packages[''].version, cargoVersion(fs.readFileSync(files[2], 'utf8')), lockVersion(fs.readFileSync(files[3], 'utf8')), json(files[4]).version];
  if (!semver.test(version) || versions.some(value => value !== version)) throw Error('Project versions differ. Run npm run version:set -- <version>.');
  if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${version}`) throw Error('Release tag must exactly match the project version.');
  console.log(`Version ${version}: all manifests and lockfiles match.`);
} else {
  if (!arg || !semver.test(arg)) throw Error('Usage: npm run version:set -- 0.1.1 (or 0.2.0-beta.1)');
  const pkg = json(files[0]), lock = json(files[1]), tauri = json(files[4]);
  pkg.version = lock.version = lock.packages[''].version = tauri.version = arg;
  const cargo = fs.readFileSync(files[2], 'utf8'), cargoLock = fs.readFileSync(files[3], 'utf8');
  if (!cargoVersion(cargo) || !lockVersion(cargoLock)) throw Error('Cannot locate Cargo package version.');
  const outputs = [JSON.stringify(pkg, null, 2) + '\n', JSON.stringify(lock, null, 2) + '\n', cargo.replace(/(\[package\][\s\S]*?\nversion\s*=\s*")[^"]+/, (_, prefix) => prefix + arg), cargoLock.replace(/(\[\[package\]\]\nname = "mijia-desktop"\nversion = ")[^"]+/, (_, prefix) => prefix + arg), JSON.stringify(tauri, null, 2) + '\n'];
  for (let i = 0; i < files.length; i++) fs.writeFileSync(files[i], outputs[i]);
  console.log(`Set version ${arg}; no commit or tag was created.`);
}
