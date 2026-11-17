// Generates a reproducible inventory from lockfiles and the matching local package
// sources. No dependency code is executed and no license compatibility is inferred.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const licenses = path.join(root, 'licenses');
const cargoCandidate = path.join(os.homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo');
const cargo = process.env.CARGO || (fs.existsSync(cargoCandidate) ? cargoCandidate : 'cargo');
const cargoArgs = ['metadata', '--manifest-path', path.join(root, 'src-tauri', 'Cargo.toml'), '--locked', '--offline', '--format-version', '1'];
function metadata(extra = []) {
  try {
    return JSON.parse(execFileSync(cargo, [...cargoArgs, ...extra], { cwd: root, encoding: 'utf8', maxBuffer: 16_000_000 }));
  } catch {
    throw new Error('Cargo metadata failed. Run cargo fetch --locked first to populate the local registry, then rerun this script.');
  }
}
const all = metadata();
const windows = metadata(['--filter-platform', 'x86_64-pc-windows-msvc']);
const windowsIds = new Set(windows.packages.map(p => p.id));
const project = all.packages.find(p => all.workspace_members.includes(p.id));
const direct = new Map(project.dependencies.map(d => [d.name, d.kind || 'normal']));
const slash = text => text.split(path.sep).join('/');
const safe = text => text.replace(/[^a-zA-Z0-9_.-]/g, '_');
const relative = filename => slash(path.relative(root, filename));
const hash = content => createHash('sha256').update(content).digest('hex');
const licenseName = /^(licen[cs]e|copying|copyright|notice|unlicense|authors?)([._-]|$)|^third[-_]?party[-_]?notices?/i;
const supplementsPath = path.join(licenses, 'supplemental-sources.json');
const supplements = fs.existsSync(supplementsPath) ? JSON.parse(fs.readFileSync(supplementsPath, 'utf8')).sources : [];
function supplementalTexts(ecosystem, name, version) {
  return supplements.filter(s => s.ecosystem === ecosystem && s.name === name && s.version === version).map(s => {
    const filename = path.resolve(root, s.path);
    if (!filename.startsWith(`${licenses}${path.sep}`) || hash(fs.readFileSync(filename)) !== s.sha256) {
      throw new Error(`Supplemental license evidence does not match: ${name}@${version}`);
    }
    return { path: s.path, sha256: s.sha256, source: s.url, commit: s.commit };
  });
}
function copyTexts(source, destination, declaredFile = null) {
  const found = new Set();
  function add(filename) {
    const rel = path.relative(source, filename);
    if (rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel) || !fs.existsSync(filename)) return;
    const stat = fs.lstatSync(filename);
    if (stat.isSymbolicLink()) return;
    if (stat.isFile()) found.add(filename);
    else if (stat.isDirectory()) {
      for (const name of fs.readdirSync(filename)) add(path.join(filename, name));
    }
  }
  for (const name of fs.readdirSync(source)) {
    if (licenseName.test(name) || /^licen[cs]es?$/i.test(name)) add(path.join(source, name));
  }
  if (declaredFile) add(path.resolve(source, declaredFile));
  return [...found].sort().map(filename => {
    const target = path.join(destination, path.relative(source, filename));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const content = fs.readFileSync(filename);
    fs.writeFileSync(target, content);
    return { path: relative(target), sha256: hash(content) };
  });
}

const cargoRecords = all.packages.filter(p => !all.workspace_members.includes(p.id)).sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)).map(p => {
  const source = path.dirname(p.manifest_path);
  const record = {
    name: p.name,
    version: p.version,
    license: p.license,
    dependencyKind: direct.get(p.name) || 'transitive',
    windowsMetadata: windowsIds.has(p.id),
    source: `https://crates.io/api/v1/crates/${encodeURIComponent(p.name)}/${encodeURIComponent(p.version)}/download`,
    texts: [...copyTexts(source, path.join(licenses, 'cargo', `${p.name}-${p.version}`), p.license_file), ...supplementalTexts('cargo', p.name, p.version)],
  };
  // Preserve complete original source for crates with an unconditional MPL license.
  // Other SPDX alternatives are recorded verbatim, never silently rewritten.
  if (p.license === 'MPL-2.0') {
    const registryName = path.basename(path.dirname(source));
    const registryRoot = path.resolve(source, '..', '..', '..');
    const archive = path.join(registryRoot, 'cache', registryName, `${p.name}-${p.version}.crate`);
    if (fs.existsSync(archive)) {
      const target = path.join(licenses, 'sources', 'cargo', path.basename(archive));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(archive, target);
      record.sourceArchive = { path: relative(target), sha256: hash(fs.readFileSync(target)) };
    }
  }
  return record;
});
const lockPath = path.join(root, 'package-lock.json');
const npmLock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
const npmDirect = new Set([...Object.keys(npmLock.packages[''].dependencies || {}), ...Object.keys(npmLock.packages[''].devDependencies || {})]);
const npmRecords = Object.entries(npmLock.packages).filter(([location]) => location).map(([location, record]) => {
  const name = location.split('node_modules/').at(-1);
  const source = path.join(root, location);
  const manifest = path.join(source, 'package.json');
  const installed = fs.existsSync(manifest) && JSON.parse(fs.readFileSync(manifest, 'utf8')).version === record.version;
  return {
    name,
    version: record.version,
    location,
    license: record.license || null,
    dependencyKind: npmDirect.has(name) ? (record.dev ? 'direct-development' : 'direct-runtime') : 'transitive',
    optional: Boolean(record.optional),
    installed,
    source: record.resolved || null,
    texts: [...(installed ? copyTexts(source, path.join(licenses, 'npm', `${safe(name)}-${safe(record.version)}`)) : []), ...supplementalTexts('npm', name, record.version)],
  };
}).sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const inventory = {
  schemaVersion: 1,
  inputs: {
    cargoLock: hash(fs.readFileSync(path.join(root, 'src-tauri', 'Cargo.lock'))),
    packageLock: hash(fs.readFileSync(lockPath)),
    platform: 'x86_64-pc-windows-msvc',
  },
  limitations: [
    'Declared license expressions are package metadata, not a legal compatibility audit.',
    'Cargo includes all locked platforms and development/build dependencies; Windows metadata membership does not mean a crate is linked into the final EXE.',
    'npm includes all locked optional platforms; uninstalled optional packages have declarations only and no copied original texts.',
    'Copied root license/notice directories can contain bundled third-party notices. This script does not scan every source file for additional notices. Supplemental upstream texts have separate pinned provenance in supplemental-sources.json.',
    'Existing protocol-reference disclosures and original license copies are preserved, not replaced by this inventory.',
  ],
  cargo: cargoRecords,
  npm: npmRecords,
};
fs.mkdirSync(licenses, { recursive: true });
fs.writeFileSync(path.join(licenses, 'dependency-inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`);
const escape = text => String(text ?? '未声明').replaceAll('|', '\\|').replaceAll('\n', ' ');
const textLinks = record => record.texts.length ? record.texts.map(f => `[${escape(path.basename(f.path))}](../${f.path})`).join('，') : '未取得原文';
const lines = [
  '# 锁定依赖许可清单', '',
  '此文件由 `node scripts/generate-notices.mjs` 从当前 Cargo.lock、package-lock.json、Cargo metadata 及相同版本的本地软件包生成。声明许可表达式保持上游原样，不等同于许可证兼容性法律审计。机器可读清单、输入 SHA-256 和原文 SHA-256 见 [dependency-inventory.json](../licenses/dependency-inventory.json)。既有来源披露与许可选择见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。', '',
  `Rust：${cargoRecords.length} 个第三方锁定软件包；Windows 目标 metadata 含 ${cargoRecords.filter(r => r.windowsMetadata).length} 个。npm：${npmRecords.length} 个锁定软件包，其中 ${npmRecords.filter(r => r.installed).length} 个与本地安装版本匹配。包含其他平台可选包及构建/测试工具，不表示全部进入 EXE。`, '',
  `原文缺口：${cargoRecords.filter(r => !r.texts.length).map(r => `\`${r.name}@${r.version}\``).join('、') || 'Cargo 无缺口'}。Windows MSVC 目标 metadata 中有 ${cargoRecords.filter(r => r.windowsMetadata && !r.texts.length).length} 个包缺许可原文；本地已安装 npm 有 ${npmRecords.filter(r => r.installed && !r.texts.length).length} 个包缺许可原文。另有 ${npmRecords.filter(r => !r.installed).length} 个未安装 npm 平台可选包仅记录声明。`, '',
  '未安装的 npm 平台可选包仅记录 lockfile 的许可声明，明确标为“未安装”；没有从另一个包借用许可原文。脚本复制包根目录的 LICENSE/COPYING/COPYRIGHT/NOTICE 等文件及 license 目录；包内其他来源声明仍需在发布审查中核对。', '',
  '个别发布包没有附带独立许可文件，其补充原文优先按 `.cargo_vcs_info.json` 的固定提交、同提交工作区根许可或 npm 对应发布提交取得；selectors 使用其源码声明的 MPL 2.0 官方原文。补充文件的来源 URL、依据、提交与 SHA-256 见 [supplemental-sources.json](../licenses/supplemental-sources.json)，生成时重新核对哈希；未取得原文的条目不会冒充已补齐。', '',
  '对声明仅为 MPL-2.0 的 crate，随附本地 Cargo cache 中同版本的完整原始 `.crate` 源码归档，并保留源下载链接；这些 crate 未作源码修改。双许可/多许可包的表达式原样保留。更新依赖或修改这些 crate 后须重新核对适用义务。', '',
  '## Cargo 全部锁定依赖', '',
  '| 软件包 | 版本 | 声明许可 | 用途 / Windows metadata | 原文 / 源码 |',
  '|---|---|---|---|---|',
  ...cargoRecords.map(r => `| ${escape(r.name)} | ${escape(r.version)} | ${escape(r.license)} | ${escape(r.dependencyKind)} / ${r.windowsMetadata ? '包含' : '不包含'} | ${textLinks(r)}；[上游源码](${r.source})${r.sourceArchive ? `；[随附源码](../${r.sourceArchive.path})` : ''} |`), '',
  '## npm 全部锁定依赖', '',
  '| 软件包 | 版本 | 声明许可 | 用途 / 本地状态 | 原文 |',
  '|---|---|---|---|---|',
  ...npmRecords.map(r => `| ${escape(r.name)} | ${escape(r.version)} | ${escape(r.license)} | ${escape(r.dependencyKind)} / ${r.installed ? '已安装' : '未安装'}${r.optional ? '（可选）' : ''} | ${textLinks(r)} |`), '',
];
fs.writeFileSync(path.join(root, 'docs', 'DEPENDENCY_LICENSES.md'), lines.join('\n'));
console.log(JSON.stringify({ cargo: cargoRecords.length, npm: npmRecords.length, cargoWithoutTexts: cargoRecords.filter(r => !r.texts.length).map(r => `${r.name}@${r.version}`), installedNpmWithoutTexts: npmRecords.filter(r => r.installed && !r.texts.length).map(r => `${r.name}@${r.version}`), mplSourceArchives: cargoRecords.filter(r => r.sourceArchive).length }));
