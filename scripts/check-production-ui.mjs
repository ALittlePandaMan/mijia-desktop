import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { connect, pages, until } from './perf/cdp.mjs';

const browser = await connect((await pages(9444))[0]);
const checks = [];
const check = (name, passed) => {
  checks.push({ name, passed: !!passed });
  assert.ok(passed, name);
};

try {
  await browser.call('Page.enable');
  await browser.call('Page.addScriptToEvaluateOnNewDocument', { source: `
    const loggedIn = new URLSearchParams(location.search).has('signed-in');
    const listeners = new Map(), callbacks = new Map();
    const snapshot = { homeId: 'fixture-home', generation: 1, devices: [] };
    const mocks = {
      session: { loggedIn, region: 'cn', userId: loggedIn ? 'fixture-account' : null },
      list_homes: [{ id: snapshot.homeId, name: '回归家庭', rooms: [] }],
      select_home: snapshot, refresh_devices: snapshot,
      home_preferences: { cardSizes: {}, roomOrders: {}, hiddenDeviceIds: [], homeHiddenDeviceIds: [], monitor: { enabled: false, excludedDeviceIds: [] } },
      home_scenes: { ...snapshot, scenes: [] }, home_cards: { ...snapshot, cards: [], statuses: [] },
      home_card_presentations: { ...snapshot, presentations: [] },
      desktop_resource_snapshot: { version: 1, revision: 1, visible: true },
      desktop_widget_support: { supported: false, enabledDisplays: 0, pins: [] },
      application_settings: { scope: loggedIn ? 'fixture-account' : null, autostart: false, mcpStatus: { state: 'stopped' },
        settings: { startupMonitor: false, startupHome: null, closeToTray: true, keepAwake: false, mcp: { enabled: false, localPort: 8765, excludedHomes: [] } },
        desktopOptions: { autoCheckUpdates: false, monitorSeparateWindow: false },
        update: { state: 'idle', revision: 0, currentVersion: 'fixture', supported: false } },
    };
    let next = 0;
    window.isTauri = true;
    window.checkReleaseCalls = [];
    window.openReleaseSettings = () => callbacks.get(listeners.get('desktop-action'))?.({ event: 'desktop-action', id: 1, payload: 'settings' });
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback(callback) { callbacks.set(++next, callback); return next; },
      unregisterCallback(id) { callbacks.delete(id); },
      async invoke(command, args = {}) {
        checkReleaseCalls.push(command);
        if (command === 'plugin:event|listen') { listeners.set(args.event, args.handler); return args.handler; }
        return Object.hasOwn(mocks, command) ? structuredClone(mocks[command]) : null;
      },
    };
  ` });
  const developerUi = `!!document.querySelector('.developer-mode,.account-developer-mode,[data-focus-key="developer-mode-entry"]') || /开发者模式|设备组件库/.test(document.querySelector('#app').innerText)`;
  for (const loggedIn of [false, true]) {
    const query = loggedIn ? '?signed-in' : '';
    await browser.call('Page.navigate', { url: `http://127.0.0.1:1421/${query}` });
    await until(browser, `typeof window.openReleaseSettings==='function'&&!!document.querySelector('${loggedIn ? '.home-screen' : '.login-screen .login-action'}')`);
    check(loggedIn ? 'Signed-in home has no development UI' : 'QR login has no development UI', !await browser.evaluate(developerUi));
    await browser.evaluate('openReleaseSettings()');
    await until(browser, '!!document.querySelector("[data-focus-key=app-autostart]")');
    check(loggedIn ? 'Signed-in settings have no development UI' : 'Signed-out settings have no development UI', !await browser.evaluate(developerUi));
    check('No development IPC is invoked by the production entry points', await browser.evaluate('checkReleaseCalls.every(command=>!command.startsWith("developer_"))'));
  }
} finally {
  browser.close();
  await writeFile(process.argv[2], JSON.stringify({ checks, mockOnly: true }, null, 2));
}
