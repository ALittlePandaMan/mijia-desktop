# Local-first controls and Mi Home scene icons

The visible value belongs to the most recent local intent. Network requests and confirmation reads run behind that value; old responses cannot clear a newer intent. Requests are sent once, without automatic action retries. Context checks cancel unsent work after leaving a device or switching homes/accounts. Offline devices, shared read-only devices, missing protocol capabilities and real task-state restrictions remain enforced.

## Changed entry points

- Lighting and curtain room/all-home actions queue every local target synchronously through the same controllers used by device cards. Removed batch-wide cloud locks and separate cloud writes that cancelled card operations. Captions reflect the projected target immediately. The acn009 card pause now actually queues a pause command.
- Manual automation clicks remain enabled. Each explicit click gets a separate request ID; acknowledgements do not replace the pressed card DOM or display execution prose. Existing task ordering/hiding/room preferences are unchanged.
- Camera card power, detail sleep/wake, fill light and alarm use latest-intent projection and background confirmation. They accept reversal during an outstanding request. Delayed power and auxiliary reads are versioned, including independent alarm/light operations.
- Generic readable and write-only MIoT settings use property operations. Generic action buttons no longer lock all other controls, and action confirmations close immediately. Queued actions check the panel context again before dispatch, and stale action panels cannot overwrite later property settings.
- IR and MIoT TV remotes accept repeated deliberate keys while transport is pending. Each key is sent once and in order; unsent keys are cancelled on navigation. They display no success text.
- Vacuum start/pause/dock/station actions project local state and keep the next control available. Status codes follow the device contract (pause 3, return 5; cleaning 1/7/12). Private report controllers validate a new local choice against the projected UI, then validate the unmodified actual report again at dispatch.
- Washer runtime task and child-lock intents project independently; pause/continue use only actual action bindings from the device description. Old replies and refreshes cannot remove newer local intents. Confirmation modals do not wait for unrelated requests.
- Existing refrigerator, airer, dispenser, purifier DND, fryer, ceiling fan, bath heater, and speaker property/report controllers already accept new local values during confirmation. Refreshing a previously loaded real panel no longer makes these controls temporarily cached/disabled. Factory resets, configuration CRUD and protocol-required confirmations retain their own validation.

## Original icons

Source APK SHA-256: `18254c5abe2485a7f60150e5ed8cbddb1c88991f6076142e99a3740c9e88ba14`. Identity was verified using REA `open_binary`. Static paths/colors were exported from the existing decoded VectorDrawables; vendor JavaScript is not executed.

- Green selection disc/check: `res/drawable-night/gu.xml`; used on device, task and picker selections.
- Arrangement Done check: original `r/ab/bcd.webp` with a centered viewport.
- Solid bulb: `res/drawable/u_.xml`; slashed bulb: `res/drawable/azy.xml`.
- Curtain open/close/pause: `res/drawable/azw.xml`, `azu.xml`, `azx.xml`.
- Conversion and hashes: `.tools/scene-control-icon-provenance.json`.

## Verification

149 relevant unit tests (18 suites), TypeScript and the production frontend build. Browser checks cover 15 delayed-response control scenarios plus the existing 20 arrangement, task editing and narrow layout scenarios. All test transports are stubbed; no physical scene, light, camera power, alarm, curtain or appliance action is performed during validation. Native delivery checks are read-only.


Full frontend regression run: 82 suites passed, 1,167 tests passed. The same five pre-existing failing suites remain: camera-care/energy require a browser window in Node; camera-audio's fake audio context lacks event support; daily-scope and daily-remaining-contracts expect superseded capability mappings. Full output is recorded in `.tools/local-first-controls-full-tests.log`.

Signed installer and portable delivery completed. The current normal desktop process passed 16 read-only checks, including original green selection/Done artwork, bulb and curtain bindings, task arrangement/cancel, picker and hidden-by-default shortcuts. Temporary preview/debug ports 1421/9441/9442 are closed. Delivery receipt: `.tools/local-first-controls-delivery.json` (executable SHA-256 `e95ae5ffd6bfc60bb21f3d4537d424e4698d19f1386439a8ecd20ec49164d3ed`).


2026-11-10: Airer and curtain illustrations now share `PositionMotion`. A local lift or motor intent starts the drawing immediately, without deriving each frame from cloud position polls. Pause and reversal use the currently drawn position; delayed acknowledgements preserve the timeline. Rejected commands correct the preview, and completed local motion requests a position verification guarded against newer intents and context changes. Raw transport panels remain unmodified. The airer labels its local estimate as “预计位置”; its model exposes no travel-time property, so the 8-second full-travel preview is illustrative. Native position reports remain authoritative for final calibration. Removed the airer drawing's dark right-hand gradient and the per-frame CSS transition that delayed SVG movement. Non-target-position curtain motor buttons also start the same local timeline.


本次调整已完成本机签名包交付和正常重启：91 项相关单元测试、14 项隔离页面交互检查、8 项真实客户端只读检查通过。环境曲线按整点/半点显示半小时平均值；晾衣架去除右侧暗影，并和窗帘共用本地动画时间轴。未执行真实升降、窗帘或自动化任务。验证记录：`.tools/environment-half-hour-verification.json`。
