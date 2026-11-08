import {isTauri} from '@tauri-apps/api/core';
import {getCurrentWindow} from '@tauri-apps/api/window';

const system = matchMedia('(prefers-color-scheme: dark)');
let nativeQueue = Promise.resolve();

function apply(): void {
  const theme = system.matches ? 'dark' : 'light';
  const root = document.documentElement;
  root.dataset.appearance = 'system';
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  root.style.backgroundColor = theme === 'dark' ? '#141719' : '#f6f8f7';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#141719' : '#ffffff');
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
  // Serialize native updates; theme changes never call App.render.
  if (isTauri()) {
    nativeQueue = nativeQueue.catch(() => {}).then(async () => {
      if (root.dataset.theme !== theme) return;
      const native = getCurrentWindow();
      await native.setTheme(null);
      await native.setBackgroundColor(theme === 'dark' ? '#141719' : '#f6f8f7');
    }).catch(error => console.warn('Native appearance update failed', error));
  }
  window.dispatchEvent(new Event('appearance-change'));
}
const changed = () => apply();
system.addEventListener('change', changed);
window.addEventListener('pagehide', () => system.removeEventListener('change', changed), {once:true});
apply();

export async function showThemedWindow(): Promise<void> {
  if (!isTauri()) return;
  try { await nativeQueue; } finally { await getCurrentWindow().show(); }
}
