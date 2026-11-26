// Public documentation shared by the installer and portable distribution.
import fs from 'node:fs';
import path from 'node:path';

export const distributionDocuments = Object.freeze([
  'LICENSE', 'README.md', 'CHANGELOG.md',
  'docs/screenshots/home.webp', 'docs/screenshots/monitor.webp',
  'docs/APP_UPDATES.md', 'docs/PLATFORMS.md', 'docs/DESKTOP_WIDGETS.md', 'docs/DEVICE_COVERAGE.md',
  'docs/PERFORMANCE.md', 'docs/LOCAL_FIRST_CONTROLS.md',
  'docs/VIDEO_PLAYBACK.md',
  'docs/MCP.md', 'docs/MCP_REFERENCE.md', 'docs/mcp-guide.json',
  'docs/skills/device-collaboration/SKILL.md', 'docs/CLOUD_ASSISTANT.md',
  'docs/THIRD_PARTY_NOTICES.md', 'docs/DEPENDENCY_LICENSES.md',
]);

export function copyDistributionFiles(destination, source = process.cwd()) {
  for (const name of distributionDocuments) {
    const target = path.join(destination, name);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.copyFileSync(path.join(source, name), target);
  }
  fs.cpSync(path.join(source, 'licenses'), path.join(destination, 'licenses'), {recursive: true});
}
