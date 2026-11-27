export const project = 'ALittlePandaMan/mijia-desktop';
export const repository = `https://github.com/${project}`;
export const releasesPage = `${repository}/releases`;
export const latestReleasePage = `${releasesPage}/latest`;
export const latestReleaseEndpoint = `https://api.github.com/repos/${project}/releases/latest`;

export type WindowsRelease = {
  tag: string;
  installer: string | null;
  portable: string | null;
};

export function windowsRelease(release: unknown): WindowsRelease | null {
  if (!release || typeof release !== 'object') return null;
  const { tag_name, draft, prerelease, assets } = release as Record<string, unknown>;
  if (draft !== false || prerelease !== false || typeof tag_name !== 'string'
      || !/^v\d+\.\d+\.\d+$/.test(tag_name) || !Array.isArray(assets)) return null;

  const packageUrl = (suffix: string): string | null => {
    const name = `mijia-desktop-${tag_name}-windows-x64-${suffix}`;
    const url = `${releasesPage}/download/${tag_name}/${name}`;
    return assets.some(asset => asset?.name === name && asset.state === 'uploaded'
      && asset.browser_download_url === url) ? url : null;
  };

  return {
    tag: tag_name,
    installer: packageUrl('setup.exe'),
    portable: packageUrl('portable.zip'),
  };
}
