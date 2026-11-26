const project = 'ALittlePandaMan/mijia-desktop';
export const repository = `https://github.com/${project}`;
export const releasesPage = `${repository}/releases`;
export const latestReleaseEndpoint = `https://api.github.com/repos/${project}/releases/latest`;

export function windowsInstaller(release: unknown): string | undefined {
  if (!release || typeof release !== 'object') return;
  const { tag_name, draft, prerelease, assets } = release as Record<string, unknown>;
  if (draft !== false || prerelease !== false || typeof tag_name !== 'string'
      || !/^v\d+\.\d+\.\d+$/.test(tag_name) || !Array.isArray(assets)) return;

  const name = `mijia-desktop-${tag_name}-windows-x64-setup.exe`;
  const url = `${releasesPage}/download/${tag_name}/${name}`;
  if (assets.some(asset => asset?.name === name && asset.state === 'uploaded' && asset.browser_download_url === url)) {
    return url;
  }
}
