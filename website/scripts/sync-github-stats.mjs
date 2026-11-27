// Read public GitHub data. --use-gh uses the existing CLI authentication.
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { project, windowsRelease } from '../app/windows-release.ts';

const run = promisify(execFile);
const useGh = process.argv.includes('--use-gh');
const repositoryPath = 'repos/' + project;
const latestPath = '/releases/latest';
const headers = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'mijia-desktop-website',
  'X-GitHub-Api-Version': '2026-03-10',
};
const signal = AbortSignal.timeout(20_000);
const cliOptions = { windowsHide: true, maxBuffer: 20 * 1024 * 1024, timeout: 20_000 };

async function api(path, paginate = false) {
  if (useGh) {
    try {
      const args = ['api', repositoryPath + path];
      if (paginate) args.push('--paginate', '--slurp');
      const { stdout } = await run('gh', args, cliOptions);
      return JSON.parse(stdout);
    } catch (error) {
      if (path === latestPath && /\(HTTP 404\)/.test(error.stderr ?? '')) return null;
      throw error;
    }
  }

  const response = await fetch('https://api.github.com/' + repositoryPath + path, { headers, signal });
  if (path === latestPath && response.status === 404) return null;
  if (!response.ok) throw new Error('GitHub metadata request failed: ' + response.status);
  return response.json();
}

async function publicReleases() {
  const path = '/releases?per_page=100';
  if (useGh) {
    const pages = await api(path, true);
    if (!Array.isArray(pages) || !pages.every(Array.isArray)) throw new Error('Invalid release response');
    return pages.flat();
  }

  const releases = [];
  for (let page = 1; ; page++) {
    const batch = await api(path + '&page=' + page);
    if (!Array.isArray(batch)) throw new Error('Invalid release response');
    releases.push(...batch);
    if (batch.length < 100) return releases;
  }
}

const [repo, releases, latest] = await Promise.all([api(''), publicReleases(), api(latestPath)]);
if (repo?.full_name !== project || !Number.isSafeInteger(repo.stargazers_count) || repo.stargazers_count < 0) {
  throw new Error('Invalid GitHub repository metadata');
}

let downloads = 0;
const counted = new Set();
for (const release of releases) {
  const windows = windowsRelease(release);
  if (!windows) continue;
  for (const asset of release.assets) {
    const url = asset?.browser_download_url;
    if (typeof url !== 'string' || (url !== windows.installer && url !== windows.portable)) continue;
    if (!Number.isSafeInteger(asset.id) || !Number.isSafeInteger(asset.download_count) || asset.download_count < 0) {
      throw new Error('Invalid package download count');
    }
    if (counted.has(asset.id)) continue;
    counted.add(asset.id);
    downloads += asset.download_count;
  }
}
if (!Number.isSafeInteger(downloads)) throw new Error('Download total exceeds the safe integer range');

const stats = {
  repository: project,
  stars: repo.stargazers_count,
  downloads,
  latestRelease: windowsRelease(latest),
  updatedAt: new Date().toISOString(),
};
await writeFile(new URL('../data/github-stats.json', import.meta.url), JSON.stringify(stats, null, 2) + '\n');
console.log(JSON.stringify(stats));
