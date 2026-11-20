import { invoke } from '@tauri-apps/api/core';
import type { CardSize } from './card-size';
import type { api } from './api';
import { developerSource, type DeveloperRuntime } from './developer-source';
import { cameraPageEligible } from './camera-eligibility';
import { isScale } from './scale';
import { isIrRemote } from './ir-remote';
import { vacuumModel } from './vacuum';
import { normalizeError } from './logic';
import type { Device, DevicePanel, HomeCardEntry, HomeCardPresentation, Json } from './types';
import { officialIcon } from './icons';
import { deviceArtwork } from './ui/device-artwork';
import { deviceCardView } from './ui/device-card-view';
import { sizeDeviceGrid } from './ui/device-grid';
import { dropdownMenu, dropdownSelect, hasOpenDropdown } from './ui/dropdown';
import { button, element } from './ui/dom';
import { bindScrollStrip } from './ui/scroll-strip';
import { settingsSwitch } from './ui/settings-content';
import { developerDetailPlaceholder, scenarios, type Scenario } from './ui/developer-detail';
import './ui/developer-mode.css';

type MountPreview = (root: HTMLElement, transport: typeof api, device: Device, generation: number, close: () => void) => () => void;

type Catalog = {
  session: number;
  total: number;
  categories: { id: number; name: string; rooms: string[] }[];
};
export type Product = { name: string; model: string; brand: string; room: string; icon: string | null; spec: string | null };
type Page = { products: Product[]; total: number; page: number; pageSize: number };
export type Preview = { device: Device; panel: DevicePanel; presentation: HomeCardPresentation | null; shortcut: HomeCardEntry | null };
export type Change =
  | { kind: 'property'; siid: number; piid: number; value: Json }
  | { kind: 'shortcut'; intent: string }
  | { kind: 'control'; templateId: string; controlId: string; value: Json };

function catalogDevice(product: Product): Device {
  return { did: `developer-preview:${product.model}`, name: product.name, model: product.model,
    roomId: '', roomName: product.room, online: true, specType: product.spec, productIcon: product.icon };
}

export class DeveloperMode {
  private readonly view = element('main', 'home-screen developer-home');
  readonly root = element('div', 'app-shell developer-mode', this.view);
  private readonly heading = button('开发者模式', 'home-title', () => this.toggleCategories());
  private readonly rooms = element('nav', 'room-tabs');
  private readonly search = element('input', 'developer-search');
  private readonly summary = element('span', 'developer-summary');
  private readonly grid = element('div', 'device-grid');
  private readonly status = element('div', 'developer-status');
  private readonly previous = button('上一页', 'developer-button', () => this.loadPage(this.page - 1));
  private readonly next = button('下一页', 'developer-button', () => this.loadPage(this.page + 1));
  private readonly lifetime = new AbortController();
  private catalog?: Catalog;
  private category?: Catalog['categories'][number];
  private room: string | null = null;
  private page = 0;
  private pageEpoch = 0;
  private previewEpoch = 0;
  private searchTimer?: ReturnType<typeof setTimeout>;
  private pendingOpen = false;
  private pendingPreview = false;
  private categoryMenu?: HTMLElement;
  private products: Product[] = [];
  private selected?: Product;
  private preview?: Preview;
  private stage?: HTMLElement;
  private scenarioByModel = new Map<string, Scenario>();
  private sizes = new Map<string, CardSize>();
  private scenario: Scenario = 'on';
  private detailLifetime?: AbortController;
  private releaseDevice?: () => void;
  private runtime = new Map<string, DeveloperRuntime>();
  private detailError = '';

  constructor(exit: () => void, private mountPreview: MountPreview) {
    this.heading.setAttribute('aria-haspopup', 'menu');
    this.heading.setAttribute('aria-expanded', 'false');
    this.heading.setAttribute('aria-label', '切换产品大类');
    this.heading.disabled = true;
    this.heading.addEventListener('keydown', event => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      if (!this.categoryMenu) this.toggleCategories();
    });
    const back = element('div','developer-mode-switch',element('span','','开发者模式'),
      settingsSwitch('开发者模式',true,exit));
    this.rooms.setAttribute('aria-label', '产品子类');
    bindScrollStrip(this.rooms);
    this.search.type = 'search';
    this.search.maxLength = 120;
    this.search.placeholder = '搜索商品名、品牌或型号';
    this.search.setAttribute('aria-label', this.search.placeholder);
    this.search.disabled = this.previous.disabled = this.next.disabled = true;
    this.search.addEventListener('input', () => {
      clearTimeout(this.searchTimer);
      this.releasePage();
      this.setStatus('正在搜索…');
      this.searchTimer = setTimeout(() => void this.loadPage(0), 140);
    });
    this.summary.setAttribute('role', 'status');
    this.status.setAttribute('role', 'status');
    this.view.append(element('div', 'home-topbar', this.heading, back), this.rooms,
      element('div', 'home-content',
        element('div', 'developer-tools', this.search, this.summary,
          element('div', 'developer-pagination', this.previous, this.next)),
        this.status, this.grid));
    document.addEventListener('pointerdown', event => {
      if (this.categoryMenu && event.target instanceof Node &&
        !this.categoryMenu.contains(event.target) && !this.heading.contains(event.target)) this.closeCategories();
    }, { signal: this.lifetime.signal, capture: true });
    this.root.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !event.defaultPrevented && !hasOpenDropdown()) {
        if (this.categoryMenu) this.closeCategories(true);
        else if (this.stage) (this.stage.querySelector<HTMLButtonElement>('.confirm-dialog .button-secondary') ??
          this.stage.querySelector<HTMLButtonElement>('.device-page-header .page-icon-button'))?.click();
        else return;
        event.preventDefault();
        event.stopPropagation();
      }
    });
  }

  async start(): Promise<void> {
    if (this.pendingOpen || this.catalog || this.lifetime.signal.aborted) return;
    this.pendingOpen = true;
    this.setStatus('正在打开产品目录…');
    try {
      const catalog = await invoke<Catalog>('developer_catalog_open');
      if (this.lifetime.signal.aborted) {
        void invoke('developer_catalog_close', { session: catalog.session }).catch(() => {});
        return;
      }
      this.catalog = catalog;
      this.heading.disabled = this.search.disabled = false;
      this.changeCategory(catalog.categories.find(category => category.id >= 0) ?? catalog.categories[0]);
    } catch (error) {
      if (!this.lifetime.signal.aborted) this.setStatus(normalizeError(error).message, () => void this.start());
    } finally {
      this.pendingOpen = false;
    }
  }

  dispose(): void {
    this.lifetime.abort();
    this.closeCategories();
    this.releasePage();
    this.scenarioByModel.clear();
    this.sizes.clear();
    this.runtime.clear();
    const catalog = this.catalog;
    this.catalog = undefined;
    if (catalog) void invoke('developer_catalog_close', { session: catalog.session }).catch(() => {});
    this.root.remove();
  }

  private setStatus(message = '', retry?: () => void): void {
    this.status.replaceChildren(message);
    if (retry) this.status.append(button('重试', 'developer-button', retry));
    this.status.hidden = !message;
  }

  private closeCategories(focus = false): void {
    this.categoryMenu?.remove();
    this.categoryMenu = undefined;
    this.heading.setAttribute('aria-expanded', 'false');
    this.heading.removeAttribute('aria-controls');
    if (focus) this.heading.focus();
  }

  private toggleCategories(): void {
    if (this.categoryMenu) { this.closeCategories(true); return; }
    if (!this.catalog) return;
    this.categoryMenu = dropdownMenu({
      label: '切换产品大类', className: 'home-menu developer-category-menu', selection: true,
      items: this.catalog.categories.map(c => ({ value: String(c.id), label: c.name, selected: c === this.category })),
      choose: id => {
        const category = this.catalog?.categories.find(c => String(c.id) === id);
        this.closeCategories(true);
        if (category) this.changeCategory(category);
      },
      dismiss: () => this.closeCategories(true),
    });
    this.heading.setAttribute('aria-expanded', 'true');
    this.heading.setAttribute('aria-controls', this.categoryMenu.id);
    this.view.insertBefore(this.categoryMenu, this.rooms);
    this.categoryMenu.querySelector<HTMLElement>('.chosen,.dropdown-item')?.focus();
  }

  private changeCategory(category: Catalog['categories'][number]): void {
    this.category = category;
    this.room = null;
    this.search.value = '';
    this.heading.replaceChildren(category.name, officialIcon('home:dropdown'));
    this.updateRooms();
    void this.loadPage(0);
  }

  private updateRooms(): void {
    const offset = this.rooms.scrollLeft;
    this.rooms.replaceChildren(...[null, ...(this.category?.rooms ?? [])].map(room => {
      const tab = button(room ?? '全部', `room-tab${room === this.room ? ' active' : ''}`, () => {
        this.room = room;
        this.search.value = '';
        this.updateRooms();
        this.rooms.querySelector<HTMLElement>('.active')?.focus({ preventScroll: true });
        void this.loadPage(0);
      });
      tab.setAttribute('aria-pressed', String(room === this.room));
      return tab;
    }));
    this.rooms.scrollLeft = offset;
  }

  private releasePage(): void {
    clearTimeout(this.searchTimer);
    ++this.pageEpoch;
    this.closeDetail(false, true);
    this.products = [];
    this.grid.replaceChildren();
    this.previous.disabled = this.next.disabled = true;
  }

  private async loadPage(page: number): Promise<void> {
    if (!this.catalog || !this.category) return;
    this.releasePage();
    const epoch = this.pageEpoch;
    const keyword = this.search.value.trim();
    this.rooms.hidden = !!keyword;
    this.summary.textContent = '';
    this.setStatus('正在读取型号…');
    try {
      const result = await invoke<Page>('developer_catalog_page', {
        session: this.catalog.session, query: { category: this.category.id, room: this.room, keyword, page: Math.max(0, page) },
      });
      if (epoch !== this.pageEpoch) return;
      this.products = result.products;
      this.page = result.page;
      const pages = Math.ceil(result.total / result.pageSize);
      this.summary.textContent = `${keyword ? '搜索结果 · ' : ''}${result.total} 个型号${pages > 1 ? ` · ${result.page + 1} / ${pages}` : ''}`;
      this.previous.disabled = result.page === 0;
      this.next.disabled = result.page + 1 >= pages;
      this.setStatus(result.total ? '' : '没有符合条件的型号');
      this.view.scrollTop = 0;
      this.grid.replaceChildren(...this.products.map(product => this.card(product)));
      sizeDeviceGrid(this.grid);
    } catch (error) {
      if (epoch === this.pageEpoch) this.setStatus(normalizeError(error).message, () => void this.loadPage(page));
    }
  }

  private card(product: Product): HTMLElement {
    const preview = product === this.selected ? this.preview : undefined;
    const device = preview?.device ?? catalogDevice(product);
    const storedSize = this.sizes.get(product.model);
    const size = storedSize === 'large' && !preview?.presentation ? 'medium' : storedSize;
    const card = deviceCardView({
      size, device, shortcut: preview?.shortcut ?? undefined, pending: false,
      artwork: deviceArtwork(device), caption: preview && !device.online ? `${product.room} | 离线` : product.room,
      selected: false, open: () => this.openDetail(product),
      activate: intent => void this.readPreview({ kind: 'shortcut', intent }),
      presentation: preview?.presentation ?? undefined,
      activateControl: (controlId, value) => {
        if (preview?.presentation) void this.readPreview({ kind: 'control', controlId, value, templateId: preview.presentation.templateId });
      },
    });
    card.dataset.developerModel = product.model;
    return card;
  }

  private refreshCard(product: Product): void {
    const current = this.grid.querySelector<HTMLElement>(`[data-developer-model="${CSS.escape(product.model)}"]`);
    if (!current) return;
    const focused = current.contains(document.activeElement);
    const next = this.card(product);
    next.dataset.layoutOrder = current.dataset.layoutOrder;
    current.replaceWith(next);
    sizeDeviceGrid(this.grid);
    if (focused) next.querySelector<HTMLButtonElement>('.device-shortcut,.device-card-open')?.focus({ preventScroll: true });
  }

  private openDetail(product: Product): void {
    const previous = this.selected;
    this.closeDetail(false);
    this.selected = product;
    this.preview = undefined;
    this.detailError = '';
    this.scenario = this.scenarioByModel.get(product.model) ?? 'on';
    if (previous && previous !== product) this.refreshCard(previous);
    this.view.inert = true;
    void this.readPreview();
  }

  private closeDetail(focus = true, release = false): void {
    this.detailLifetime?.abort();
    this.detailLifetime = undefined;
    this.releaseDevice?.();
    this.releaseDevice = undefined;
    ++this.previewEpoch;
    this.pendingPreview = false;
    if (release) {
      this.selected = undefined;
      this.preview = undefined;
    }
    this.stage?.remove();
    this.stage = undefined;
    this.view.inert = false;
    if (focus && this.selected) {
      this.grid.querySelector<HTMLElement>(`[data-developer-model="${CSS.escape(this.selected.model)}"] .device-card-open`)?.focus({ preventScroll: true });
    }
  }

  private async readPreview(change?: Change): Promise<void> {
    const selected = this.selected;
    if (!selected || !this.catalog || this.pendingPreview) return;
    if (selected.spec == null) { this.showDetail(); return; }
    const epoch = ++this.previewEpoch;
    this.pendingPreview = true;
    this.detailError = '';
    if (!change && this.view.inert) this.showDetail();
    try {
      const preview = await invoke<Preview | null>('developer_catalog_preview', {
        session: this.catalog.session, model: selected.model, scenario: this.scenario, change: change ?? null,
      });
      if (epoch !== this.previewEpoch) return;
      if (preview && (preview.device.model !== selected.model || preview.panel.did !== preview.device.did)) throw Error('预览型号不匹配。');
      this.preview = preview ?? undefined;
      this.refreshCard(selected);
    } catch (error) {
      if (!change && epoch === this.previewEpoch && !this.modelOnlyPreview(selected)) this.detailError = normalizeError(error).message;
    } finally {
      if (epoch === this.previewEpoch) {
        this.pendingPreview = false;
        if (this.view.inert && !change) this.showDetail();
      }
    }
  }

  private showDetail(): void {
    const product = this.selected;
    if (!product || !this.catalog) return;
    const preview = this.preview ?? this.modelOnlyPreview(product);
    if (!this.stage) {
      this.stage = element('div', 'developer-detail-overlay');
      this.stage.setAttribute('role', 'dialog');
      this.stage.setAttribute('aria-modal', 'true');
      this.stage.setAttribute('aria-label', product.name + '预览');
      this.stage.addEventListener('keydown', event => {
        if (event.key !== 'Tab' || event.defaultPrevented) return;
        const scope = this.stage?.querySelector('.confirm-dialog') ?? this.stage;
        const items = [...scope?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? []]
          .filter(node => node.getClientRects().length);
        if (!items.length) return;
        if (document.activeElement === (event.shiftKey ? items[0] : items.at(-1)) ||
            !items.includes(document.activeElement as HTMLElement)) {
          event.preventDefault();
          (event.shiftKey ? items.at(-1) : items[0])?.focus();
        }
      });
      this.root.append(this.stage);
    }
    const focusKey = this.stage.contains(document.activeElement) ? (document.activeElement as HTMLElement)?.dataset.focusKey : undefined;
    const state = dropdownSelect({
      label: '模拟状态', value: this.scenario, className: 'control-field',
      options: Object.entries(scenarios).map(([value, label]) => ({ value, label })),
      change: value => {
        if (this.pendingPreview) return;
        this.closeDetail(false);
        this.view.inert = true;
        this.scenario = value as Scenario;
        this.scenarioByModel.set(product.model, this.scenario);
        this.preview = undefined;
        void this.readPreview();
      },
    });
    state.disabled = this.pendingPreview || !preview;
    state.dataset.focusKey = 'developer-scenario';
    const size = dropdownSelect({
      label: '卡片尺寸', value: this.sizes.get(product.model) ?? 'medium', className: 'control-field',
      options: [{ value: 'small', label: '小卡片' }, { value: 'medium', label: '中卡片' },
        ...(preview?.presentation ? [{ value: 'large', label: '大卡片' }] : [])],
      change: value => { this.sizes.set(product.model, value as CardSize); this.refreshCard(product); },
    });
    size.dataset.focusKey = 'developer-size';
    size.disabled = this.pendingPreview;
    const layout = element('span', 'developer-preview-layout', this.pendingPreview ? '正在读取布局' : '商品信息');
    const close = button('关闭预览', 'developer-button', () => this.closeDetail());
    const tools = element('aside', 'developer-preview-tools',
      element('div', 'developer-product-model', product.brand, element('code', '', product.model)),
      element('div', 'developer-preview-selectors', state, size),
      element('div', 'developer-preview-layout-row', layout, close));
    const host = element('div', 'developer-device-host');
    this.stage.replaceChildren(host, tools);
    host.addEventListener('click', event => {
      if (event.target instanceof HTMLElement && event.target.matches('.device-stage')) this.closeDetail();
    });
    if (this.pendingPreview || this.detailError || !preview) {
      host.append(developerDetailPlaceholder(product, this.pendingPreview, this.detailError,
        () => this.closeDetail(), () => void this.readPreview()));
      host.querySelector<HTMLElement>('.device-page')?.focus({ preventScroll: true });
      return;
    }

    const lifetime = this.detailLifetime = new AbortController();
    const generation = this.previewEpoch;
    const catalog = this.catalog;
    const selectedScenario = this.scenario;
    const context = { homeId: 'developer-preview', generation, did: preview.device.did };
    const key = JSON.stringify([product.model, selectedScenario]);
    const runtime = this.runtime.get(key) ?? {};
    this.runtime.set(key, runtime);
    if (preview.device.online && runtime.awake === undefined) runtime.awake = selectedScenario !== 'off';
    const transport = developerSource(context, preview, runtime, lifetime.signal, async change => {
      lifetime.signal.throwIfAborted();
      const next = await invoke<Preview>('developer_catalog_preview', {
        session: catalog.session, model: product.model, scenario: selectedScenario, change,
      });
      lifetime.signal.throwIfAborted();
      if (next?.panel.did !== context.did || next.device.model !== product.model) throw Error('预览型号不匹配。');
      this.preview = next;
      this.refreshCard(product);
      return next;
    });
    const unmount = this.mountPreview(host, transport, preview.device, generation, () => this.closeDetail());
    const describe = () => {
      const page = host.querySelector<HTMLElement>('.device-page');
      if (!page) return;
      const template = page.dataset.presentationTemplate ?? [...page.classList].find(name => name.startsWith('page-'))?.slice(5);
      const captions: Record<string, string> = {
        camera: '摄像机', 'doorbell-cloud': '门铃事件', 'doorbell-player': '门铃录像', vacuum: '扫地机器人',
        washer: '洗衣机', purifier: '净水器', 'air-conditioner': '空调', light: '灯光', 'light-group': '灯组',
        dispenser: '净饮机', router: '路由器', airer: '晾衣架', fridge: '冰箱', generic: '标准能力',
        'doorbell-live': '门铃实时画面', 'bath-heater': '浴霸', fryer: '空气炸锅', 'ceiling-fan': '吊扇',
        'ir-remote': '红外遥控器', scale: '体脂秤', outlet: '插座', switch: '开关', curtain: '窗帘',
        'temperature-humidity-sensor': '温湿度计', fan: '风扇', 'fan-p69': '风扇', 'fan-standard': '风扇', television: '电视',
      };
      layout.textContent = page.classList.contains('device-page-loading') ? '正在读取布局' :
        page.dataset.visualAdapter === 'standard-capability' ? '标准能力页' : `布局：${captions[template ?? ''] ?? template ?? '设备详情'}`;
    };
    const observer = new MutationObserver(describe);
    observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-presentation-template'] });
    describe();
    this.releaseDevice = () => { observer.disconnect(); unmount(); };
    if (focusKey) this.stage.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  }

  private modelOnlyPreview(product: Product): Preview | undefined {
    const device = catalogDevice(product);
    if (!cameraPageEligible(device) && !isScale(device.model) && !isIrRemote(device.model) && device.model !== vacuumModel) return;
    device.online = this.scenario !== 'offline';
    device.sharedReadOnly = this.scenario === 'readonly';
    return { device, panel: { did: device.did, model: device.model, specType: device.specType, services: [] },
      shortcut: null, presentation: null };
  }
}
