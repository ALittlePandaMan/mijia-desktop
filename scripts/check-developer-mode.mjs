// Run after npm run build. The production WebView entry uses a loopback-only
// mock IPC transport. The native catalog/preview implementation has Rust tests.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { connect, pages, delay, until } from './perf/cdp.mjs';

const browser = process.env.MIJIA_TEST_BROWSER ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const catalog = JSON.parse(await readFile('src-tauri/src/developer-catalog.json', 'utf8'));
const source = 'src-tauri/src/fixtures/';
const fixtureFiles = {
  'cuco.acpartner.cp6': 'catalog/air-condition-outlet--cuco.acpartner.cp6.json',
  'yeelink.light.bslamp2': 'compatibility/light--yeelink.light.bslamp2.json',
  'yeelink.switch.sw1': 'compatibility/switch--yeelink.switch.sw1.json',
  'cleargrass.sensor_ht.dk1': 'compatibility/temperature-humidity-sensor--cleargrass.sensor_ht.dk1.json',
};
const fixtures = Object.fromEntries(await Promise.all(Object.entries(fixtureFiles).map(async ([model, file]) =>
  [model, JSON.parse(await readFile(source + file, 'utf8'))],
)));
const productSamples = new Map();
for (const [model, file, like] of [
  ['midjd8.washer.42', 'washer-panel.json', 'midjd8.washer.42a'],
  ['xiaomi.waterpuri.lx32', 'purifier-panel.json', 'xiaomi.waterpuri.lx32'],
]) {
  const panel = JSON.parse(await readFile(source + file, 'utf8'));
  const sample = catalog.products.find(p => p.model === like);
  const product = { ...sample, model, spec: panel.specType, featured: false };
  productSamples.set(model, { panel, product });
  if (like !== model) catalog.products.push(product);
}
const fakeIcon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSfcAAAAASUVORK5CYII=';
const labels = new Map(catalog.categories.flatMap(c => c.types.map(t => [t.id, t.name])));
const room = product => labels.get(product.typeId) ?? '其他';
const categories = catalog.categories.map(c => ({
  id: c.id, name: c.name, rooms: [...new Set(c.id === -10000
    ? catalog.products.filter(p => p.featured).map(room) : c.types.map(t => t.name))],
}));
const sessions = new Map();
let sequence = 0;
const requests = [];

function demoPreview(session, model, scenario, change) {
  const spec = fixtures[model];
  if (!spec) {
    const sample = productSamples.get(model);
    if (!sample) return null;
    const { product } = sample;
    const did = 'developer-preview:' + model;
    return { device: { did, model, name: product.name, roomId: 'mock', roomName: room(product),
      online: scenario !== 'offline', sharedReadOnly: scenario === 'readonly', specType: product.spec, productIcon: fakeIcon },
      panel: { ...sample.panel, did }, presentation: null, shortcut: null };
  }
  const row = catalog.products.find(p => p.model === model);
  const did = 'developer-preview:' + model;
  const key = [model, scenario].join(':');
  const stored = session.get(key) ?? new Map();
  const name = type => type.split(':')[3];
  const online = scenario !== 'offline';
  const device = { did, model, name: row.name, roomName: room(row), roomId: 'mock',
    online, sharedReadOnly: scenario === 'readonly', specType: spec.type, productIcon: fakeIcon };
  const services = spec.services.map(s => ({
    siid: s.iid, name: name(s.type), description: s.description, actions: [],
    properties: (s.properties ?? []).map(p => {
      const property = { siid: s.iid, piid: p.iid, name: name(p.type), format: p.format,
        description: p.description, unit: p.unit, access: p.access,
        valueRange: p['value-range'], valueList: p['value-list'] };
      const id = `${s.iid}:${p.iid}`;
      const value = stored.get(id) ?? (property.name === 'on' ? scenario !== 'off' :
        (p['value-list']?.[0]?.value ?? p['value-range']?.[0] ?? (p.format === 'bool' ? false : 0)));
      const missing = !online || scenario === 'missing' && property.name !== 'on';
      return { ...property, code: missing ? -1 : 0, value: missing ? undefined : value };
    }),
  }));
  if (change?.kind === 'property' && online && !device.sharedReadOnly) {
    const target = services.find(s => s.siid === change.siid)?.properties.find(p => p.piid === change.piid);
    assert(target?.access.includes('write'));
    stored.set(`${change.siid}:${change.piid}`, change.value);
    session.set(key, stored);
    return demoPreview(session, model, scenario);
  }
  const panel = { did, model, specType: spec.type, services };
  const on = services.find(s => s.name === 'air-conditioner')?.properties.find(p => p.name === 'on');
  const canWrite = online && !device.sharedReadOnly;
  const range = { min: 16, max: 30, step: 1, unit: '℃' };
  const presentation = on ? { did, templateId: 'climate', revision: 1, observedAt: 1, headerControl: 'power',
    rows: [['temp']], projections: [], controls: [
      { id: 'power', fieldId: '3:1', kind: 'toggle', label: '电源', value: on.value, enabled: canWrite, options: [] },
      { id: 'temp', fieldId: '3:4', kind: 'stepper', appearance: 'temperature', label: '目标温度', range,
        value: services.find(s => s.siid === 3)?.properties.find(p => p.piid === 4)?.value,
        enabled: canWrite && on.value === true, options: [] },
    ] } : null;
  return { device, panel, presentation, shortcut: null };
}

async function mock(command, args) {
  requests.push({ command, args });
  if (command === 'developer_catalog_open') {
    const session = ++sequence;
    sessions.set(session, new Map());
    return { session, total: catalog.products.length, categories };
  }
  if (command === 'developer_catalog_close') { sessions.delete(args.session); return null; }
  assert(sessions.has(args.session), 'preview IPC must carry an active session');
  if (command === 'developer_catalog_preview') {
    if (args.model === 'cuco.acpartner.cp6' && !args.change) await delay(65);
    return demoPreview(sessions.get(args.session) ?? new Map(), args.model, args.scenario, args.change);
  }
  assert.equal(command, 'developer_catalog_page');
  const { keyword, category, room: subcategory, page } = args.query;
  const matching = catalog.products.filter(p => keyword ?
    [p.name, p.brand, p.model].some(text => text.toLowerCase().includes(keyword.toLowerCase())) :
    (category === -10000 ? p.featured : p.category === category) && (!subcategory || room(p) === subcategory));
  return { page, pageSize: 48, total: matching.length, products: matching.slice(page * 48, (page + 1) * 48)
    .map(p => ({ ...p, room: room(p), icon: p.icon ? fakeIcon : null })) };
}

const dist = resolve('dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webm': 'video/webm' };
let browserFixture;
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'POST' && url.pathname === '/ipc-test') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const { command, args } = JSON.parse(body);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(await mock(command, args)));
      return;
    }
    const file = resolve(dist, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    assert(file.startsWith(dist + sep));
    response.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
    const contents = await readFile(file);
    response.end(extname(file) === '.html'
      ? contents.toString('utf8').replace('<head>', `<head><script>(()=>{${browserFixture}})()</script>`)
      : contents);
  } catch (error) {
    response.statusCode = 404;
    response.end(String(error));
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

const profile = await mkdtemp(resolve('.tools/developer-browser-'));
const chromium = spawn(browser, [
  '--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore', windowsHide: true });
let launchError;
chromium.on('error', error => { launchError = error; });
const report = { checks: [], measurements: [] };
let client;
try {
  let targets;
  for (let attempt = 0; attempt < 60 && !targets?.length; attempt++) {
    if (launchError) throw launchError;
    const debuggerPort = await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')
      .then(contents => Number(contents.split('\n')[0]), () => 0);
    targets = debuggerPort ? await pages(debuggerPort).catch(() => []) : [];
    if (!targets.length) await delay(200);
  }
  assert(targets?.length, 'isolated test browser did not start');
  client = await connect(targets[0]);
  const evaluate = expression => client.evaluate(expression);
  const wait = expression => until(client, expression, 80);
  const check = async (label, expression) => {
    assert(await evaluate(expression), label);
    report.checks.push(label);
  };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const clickText = (selector, text) => evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)}).click()`);
  const search = query => evaluate(`(()=>{const input=document.querySelector('.developer-search'); input.value=${JSON.stringify(query)}; input.dispatchEvent(new Event('input'));})()`);
  const cardCount = count => wait(`document.querySelectorAll('.developer-home .device-card').length===${count}`);
  const snapshot = async name => {
    await client.call('HeapProfiler.collectGarbage');
    const heap = await client.call('Runtime.getHeapUsage');
    const counters = await client.call('Memory.getDOMCounters');
    const count = await evaluate('document.querySelectorAll(".developer-home .device-card").length');
    report.measurements.push({ name, heapBytes: heap.usedSize, nodes: counters.nodes, cards: count, requests: requests.length });
  };
  browserFixture = `
    const loggedIn = new URLSearchParams(location.search).has('account');
    const camera = new URLSearchParams(location.search).has('camera');
    const device={did:'private-sample',model:camera?'xiaomi.camera.069a03':'mock.device',name:'本地回归设备',online:true,roomId:'private-room',roomName:'回归房间'};
    const panel={did:device.did,model:device.model,specType:'urn:miot-spec-v2:device:camera:0000A01C:xiaomi-069a03:2',services:[]};
    const values = {
      session:{loggedIn,region:'cn',userId:loggedIn?'local-test':null},
      desktop_resource_snapshot:{version:1,revision:1,visible:true},
      desktop_widget_support:{supported:false,enabledDisplays:0,pins:[]},
      account_profile:{displayName:'模拟'},
      list_homes:[{id:'private-home',name:'回归家庭',rooms:[{id:'private-room',name:'回归房间'}]}],
      select_home:{homeId:'private-home',generation:1,devices:[device]},
      home_preferences:{cardSizes:{'private-sample':'small'},roomOrders:{},hiddenDeviceIds:[],homeHiddenDeviceIds:[],monitor:{enabled:false,excludedDeviceIds:[]}},
      home_scenes:{homeId:'private-home',generation:1,scenes:[]},
      home_cards:{homeId:'private-home',generation:1,cards:[],statuses:[]},
      home_card_large_available:true,
      device_panel:panel, read_properties:panel,
      camera_features:{qualities:[{id:'auto',label:'自动'},{id:'sd',label:'流畅'}],listen:true,ptz:true,talk:false,playback:true,care:true,lenses:[{id:0,label:'主镜头',ptz:true}]},
      camera_power:{awake:false,supported:true,writable:true,reason:null},
      camera_auxiliary:{alarm:{supported:false},light:{supported:false}},
      application_settings:{
        scope:loggedIn?'local-test':null,autostart:false,mcpStatus:{state:'stopped'},
        settings:{startupMonitor:false,startupHome:null,closeToTray:true,keepAwake:false,mcp:{enabled:false,localPort:8765,excludedHomes:[]}},
        update:{state:'idle',revision:0,currentVersion:'test',supported:false},
      },
    };
    window.deviceTestCalls=[];window.deviceTestErrors=[];
    window.savedCardSizes=[];
    addEventListener('error',e=>deviceTestErrors.push(e.message));
    addEventListener('unhandledrejection',e=>deviceTestErrors.push(String(e.reason)));
    let callback=0;
    window.isTauri=true;
    window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
      transformCallback(){return ++callback;},unregisterCallback(){},
      async invoke(command,args={}){
        deviceTestCalls.push(command);
        if(command.startsWith('developer_catalog_')){
          const result=await fetch('/ipc-test',{method:'POST',body:JSON.stringify({command,args})});
          return result.json();
        }
        if(command==='change_home_preferences'&&args.change.operation==='setCardSize'){
          const {roomId,did,size}=args.change;
          await new Promise(resolve=>setTimeout(resolve,100));
          const byRoom=values.home_preferences.roomCardSizes??={};
          (byRoom[roomId]??={})[did]=size;
          savedCardSizes.push({roomId,did,size});
          return structuredClone(values.home_preferences);
        }
        if(command in values)return structuredClone(values[command]);
        if(command==='plugin:event|listen')return args.handler;
        return null;
      },
    };
  `;
  new Function(browserFixture);
  const address = `http://127.0.0.1:${server.address().port}`;
  await client.call('Emulation.setDeviceMetricsOverride', { width: 1100, height: 820, deviceScaleFactor: 1, mobile: false });
  const started = Date.now();
  await client.call('Page.navigate', { url: address });
  await wait('!!document.querySelector(".login-screen")');
  report.loginReadyMs = Date.now() - started;
  await snapshot('normal-login');
  assert.equal(requests.length, 0, 'normal startup loads no catalog');
  await check('normal startup leaves the developer chunk unloaded',
    'performance.getEntriesByType("resource").every(r=>!r.name.includes("developer-mode-"))');
  const enter = () => click('.login-screen [role=switch][aria-checked=false][aria-label="开发者模式"]');
  const exit = () => click('.developer-home [role=switch][aria-checked=true][aria-label="开发者模式"]');
  const open = async () => { await enter(); await cardCount(48); };
  const first = Date.now();
  await open();
  report.firstPageMs = Date.now() - first;
  await check('developer switch shows the shared blue active track', `(() => {
    const track=document.querySelector('.developer-home [role=switch][aria-checked=true]');
    const style=getComputedStyle(track);
    return style.backgroundColor==='rgb(36, 100, 216)'&&style.borderRadius==='12px';
  })()`);
  await snapshot('first-catalog-page');
  await check('logged-out catalog uses lazy images', '[...document.querySelectorAll(".developer-home img")].length>0&&[...document.querySelectorAll(".developer-home img")].every(n=>n.loading==="lazy")');
  await click('.developer-home .home-title');
  await clickText('.developer-home .home-menu button', '插座开关');
  await cardCount(48);
  await check('largest category paginates 3144 models', 'document.querySelector(".developer-summary").textContent.includes("3144")');
  const next = Date.now();
  await clickText('.developer-pagination button', '下一页');
  await wait('document.querySelector(".developer-summary")?.textContent.includes("2 / 66")');
  report.nextPageMs = Date.now() - next;
  await snapshot('second-page-largest-category');
  if (process.env.MIJIA_DEVELOPER_TEST_IMAGE) {
    const { data } = await client.call('Page.captureScreenshot', { format: 'png' });
    await writeFile(process.env.MIJIA_DEVELOPER_TEST_IMAGE, Buffer.from(data, 'base64'));
  }
  assert.equal(requests.filter(r => r.command === 'developer_catalog_preview').length, 0);
  await click('.developer-home .home-title');
  await clickText('.developer-home .home-menu button', '环境电器');
  await clickText('.developer-home .room-tab', '空调');
  await wait('document.querySelector(".developer-summary")?.textContent.includes("396")');
  report.checks.push('official category and Chinese room filtering');

  const opens = async (model, selector) => {
    await search(model);
    const card = `[data-developer-model="${model}"] .device-card-open`;
    await wait(`!!document.querySelector(${JSON.stringify(card)})`);
    await click(card);
    await wait(`!!document.querySelector(${JSON.stringify(selector)})`);
  };
  await opens('cuco.acpartner.cp6', '.air-conditioner-content');
  await check('climate shows model and shared temperature controls', 'document.querySelector(".developer-product-model code").textContent==="cuco.acpartner.cp6"&&!!document.querySelector(".air-temperature-card")');
  await click('.air-conditioner-power');
  await wait('document.querySelector(".air-conditioner-content")?.classList.contains("device-is-off")');
  assert(requests.some(r => r.args.change?.siid === 3 && r.args.change?.value === false));
  await click('[data-focus-key=developer-size]');
  await clickText('.dropdown-popup button', '大卡片');
  await check('dedicated preview enables the large card', 'document.querySelector(".developer-home .device-card").dataset.cardSize==="large"');
  await click('[data-focus-key=developer-scenario]');
  await clickText('.dropdown-popup button', '共享只读');
  await wait('document.querySelector(".air-conditioner-power")?.disabled===true');
  await click('[data-focus-key=developer-scenario]');
  await clickText('.dropdown-popup button', '离线');
  await wait('document.querySelector(".developer-device-host .device-page")?.textContent.includes("设备离线")');
  await click('[data-focus-key=developer-scenario]');
  await clickText('.dropdown-popup button', '部分读取失败');
  await wait(`(()=>{const temp=document.querySelector('.developer-device-host [data-property-name=target-temperature]');
    return temp?.textContent.includes('未读取')&&!temp.querySelector('input:not(:disabled),button:not(:disabled)');})()`);
  report.checks.push('read-only, offline and partial-read states');
  await clickText('.developer-preview-tools button', '关闭预览');
  for (const [model, selector] of [
    ['yeelink.light.bslamp2', '.light-page-content'],
    ['yeelink.switch.sw1', '.switch-page-content'],
    ['cleargrass.sensor_ht.dk1', '.sensor-page-content'],
    ['ows.heater.pdeh1a', '.developer-device-host .native-unavailable'],
  ]) {
    await opens(model, selector);
    report.checks.push(model);
    await clickText('.developer-preview-tools button', '关闭预览');
  }
  const previewClose = () => clickText('.developer-preview-tools button', '关闭预览');
  await opens('xiaomi.camera.069a03', '.developer-device-host [data-presentation-template=camera]');
  await wait(`document.querySelector('.developer-device-host .device-stage[data-video-state=playing] video')?.videoWidth===640`);
  const cameraShape = `JSON.stringify([...document.querySelectorAll('.page-camera video,.page-camera button[aria-label]:not(.camera-lens-swap)')].map(e=>[e.tagName,e.className.split(' ')[0]]))`;
  const singleCameraLayout = await evaluate(cameraShape);
  if (process.env.MIJIA_DEVELOPER_CAMERA_TEST_IMAGE) {
    const { data } = await client.call('Page.captureScreenshot', { format: 'png' });
    await writeFile(process.env.MIJIA_DEVELOPER_CAMERA_TEST_IMAGE, Buffer.from(data, 'base64'));
  }
  await check('camera uses the production page and developer tools are outside it',
    `!!document.querySelector('.page-camera .camera-playback-entry')&&!document.querySelector('.page-camera .developer-preview-tools')`);
  await click('.page-camera .camera-playback-entry:not(.camera-care-entry)');
  await wait(`!!document.querySelector('.developer-device-host [data-video-mode=playback][data-video-state=playing]')`);
  await click('.page-camera .device-page-header .page-icon-button');
  await wait(`!!document.querySelector('.developer-device-host [data-video-mode=live][data-video-state=playing]')`);
  await click('.page-camera .camera-care-entry');
  await wait(`document.querySelectorAll('[data-care-event]').length===2`);
  await wait(`document.querySelector('[data-event-id]')?.src.startsWith('data:image/')`);
  await click('[data-care-event=motion]');
  await wait(`!!document.querySelector('.developer-device-host [data-video-mode=cloud][data-video-state=playing]')`);
  await evaluate(`window.releasedPreviewVideos=[...document.querySelectorAll('.developer-device-host video')]`);
  await previewClose();
  await check('camera live, SD review, cloud event and thumbnails stay offline and release video',
    `releasedPreviewVideos.every(video=>!video.isConnected&&!video.getAttribute('src'))`);
  await opens('xiaomi.camera.cw701', '.developer-device-host [data-presentation-template=camera]');
  await wait(`[...document.querySelectorAll('.developer-device-host video')].filter(video=>video.videoWidth===640).length===2`);
  report.checks.push('dual-lens cameras decode both distinct local samples');
  await previewClose();
  await opens('xiaomi.vacuum.d103cn', '.developer-device-host .vacuum-map:not(.vacuum-map-empty)');
  await wait(`!!document.querySelector('[data-vacuum-action=start]:not(:disabled)')`);
  await click('[data-vacuum-action=start]');
  await wait(`!!document.querySelector('[data-vacuum-action=pause]')`);
  report.checks.push('vacuum map and simulated cleaning use the production page');
  await previewClose();
  await opens('midjd8.washer.42', '.washer-home-status');
  await click('.washer-home-status');
  await wait(`document.querySelectorAll('.washer-runtime-steps li').length===4`);
  await click('[data-runtime-control=pause]');
  await wait(`document.querySelector('.washer-runtime-page')?.dataset.runtimeState==='paused'`);
  report.checks.push('washer programs and running timeline use the production pages');
  await previewClose();
  await opens('xiaomi.waterpuri.lx32', '.developer-device-host .page-purifier:not(.device-page-loading)');
  report.checks.push('purifier uses the production dedicated page');
  await previewClose();
  await exit();
  await wait('!!document.querySelector(".login-screen")');
  await open();
  await search('cuco.acpartner.cp6');
  await cardCount(1);
  const oldReads = requests.filter(r => r.command === 'developer_catalog_preview').length;
  await click('.developer-home .device-card-open');
  await clickText('.developer-preview-tools button', '关闭预览');
  await search('cleargrass.sensor_ht.dk1');
  await wait('!!document.querySelector(\'[data-developer-model="cleargrass.sensor_ht.dk1"]\')');
  await check('late detail response cannot reopen a closed page', '!document.querySelector(".developer-detail-overlay")');
  assert.equal(requests.filter(r => r.command === 'developer_catalog_preview').length, oldReads + 1);
  await exit();
  await wait('!!document.querySelector(".login-screen")');
  for (let round = 0; round < 24; round++) {
    await open();
    await exit();
    await wait('!!document.querySelector(".login-screen")');
    if (round === 11) await snapshot('after-12-open-close-cycles');
  }
  await snapshot('after-24-open-close-cycles');
  await check('mode frees cards and produces no client errors', 'deviceTestErrors.length===0&&!document.querySelector(".developer-mode")');
  assert(await evaluate('deviceTestCalls.every(c=>c.startsWith("developer_catalog_")||c.startsWith("plugin:")||["session","application_settings","app_update_result","desktop_resource_snapshot","desktop_frontend_idle","desktop_widget_support"].includes(c))'));

  await client.call('Page.navigate', { url: address + '?account' });
  await wait('!!document.querySelector(".home-screen .device-card")');
  await clickText('.home-screen .room-tab', '回归房间');
  await click('.home-account');
  await click('[data-focus-key=account-menu-settings]');
  await wait('!!document.querySelector(".settings-page")');
  await click('.settings-page [role=switch][aria-checked=false][aria-label="开发者模式"]');
  await cardCount(48);
  await exit();
  await wait('document.querySelector(".home-screen .device-card")?.dataset.cardSize==="small"');
  await check('settings entry preserves previously selected home, room and size', 'document.querySelector(".home-title").textContent.includes("回归家庭")&&document.querySelector(".room-tab.active").textContent==="回归房间"');
  const changeSize = async size => {
    await evaluate('document.querySelector(".home-screen .device-card").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:100,clientY:120}))');
    const selector = `.device-context-menu [data-card-size-choice="${size}"]:not([hidden])`;
    await wait(`!!document.querySelector(${JSON.stringify(selector)})`);
    await click(selector);
    await wait(`document.querySelector('.home-screen .device-card')?.dataset.cardSize==='${size}'`);
  };
  await changeSize('large');
  await clickText('.home-screen .room-tab', '全屋');
  await wait('savedCardSizes.length===1');
  await check('room size and its acknowledgement leave whole-home size intact',
    'document.querySelector(".home-screen .device-card")?.dataset.cardSize==="small"&&savedCardSizes[0].roomId==="private-room"');
  await changeSize('medium');
  await clickText('.home-screen .room-tab', '回归房间');
  await wait('savedCardSizes.length===2');
  await check('whole-home size changes preserve the room large card',
    'document.querySelector(".home-screen .device-card")?.dataset.cardSize==="large"&&savedCardSizes[1].roomId==="*"');
  await client.call('Page.navigate', { url: address + '?account&camera' });
  await wait('!!document.querySelector(".home-screen .device-card-open")');
  await click('.home-screen .device-card-open');
  await wait('!!document.querySelector("[data-presentation-template=camera]")');
  const normalCameraLayout = await evaluate(cameraShape);
  assert.deepEqual(JSON.parse(normalCameraLayout), JSON.parse(singleCameraLayout));
  report.checks.push('normal and developer modes mount the same camera page and controls');
  assert.equal(sessions.size, 0);
} catch (error) {
  if (client) report.failure = await client.evaluate(`({
    text:document.querySelector('#app')?.innerText.slice(0,600),
    toast:document.querySelector('.camera-media-toast')?.textContent,
    calls:window.deviceTestCalls,
    errors:window.deviceTestErrors,
  })`).catch(() => undefined);
  throw error;
} finally {
  report.ipcCounts = Object.fromEntries([...new Set(requests.map(r => r.command))]
    .map(command => [command, requests.filter(r => r.command === command).length]));
  const output = JSON.stringify(report, null, 2);
  if (process.env.MIJIA_DEVELOPER_TEST_REPORT) await writeFile(process.env.MIJIA_DEVELOPER_TEST_REPORT, output + '\n');
  console.log(output);
  client?.close();
  chromium.kill();
  server.closeAllConnections();
  server.close();
}
