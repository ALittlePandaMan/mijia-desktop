<h1 align="center">米家Desktop</h1>

<p align="center">米家设备管理、桌面卡片与摄像机监控的 Windows 客户端</p>

<p align="center">
  <a href="https://github.com/ALittlePandaMan/mijia-desktop/actions/workflows/ci.yml"><img src="https://github.com/ALittlePandaMan/mijia-desktop/actions/workflows/ci.yml/badge.svg" alt="构建状态"></a>
  <a href="https://github.com/ALittlePandaMan/mijia-desktop/releases/latest"><img src="https://img.shields.io/github/v/release/ALittlePandaMan/mijia-desktop?label=version&amp;color=blue" alt="最新版本"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License"></a>
</p>

米家Desktop 通过小米账号扫码登录，提供家庭与房间管理、设备控制、桌面固定卡片和多路摄像机监控。基于 Tauri 2、Rust 与 TypeScript，使用 MiSans 字体，支持系统深浅色与减少动态效果。

**1.0.0 仅发布 Windows 10/11 x64。** 本项目为独立第三方客户端，与小米及米家没有隶属或背书关系。设备功能依赖型号、固件、账号权限与小米服务提供的能力。

## 下载与使用

从 [最新 Release](https://github.com/ALittlePandaMan/mijia-desktop/releases/latest) 下载：

| 文件 | 用途 |
| --- | --- |
| `mijia-desktop-v1.0.0-windows-x64-setup.exe` | 安装程序 |
| `mijia-desktop-v1.0.0-windows-x64-portable.zip` | 完整解压后运行 `mijia-desktop.exe` |
| `SHA256SUMS` / `SHA256.json` | 文件校验值 |
| `.sig` / `latest.json` | 应用内更新签名与清单 |

需要 WebView2 Runtime，安装程序按需引导安装。程序未使用 Windows Authenticode 证书签名，请从本仓库下载并核对校验值；Tauri 更新包另有签名校验。

1. 使用米家 App 或小米账号扫码确认登录。正常流程一次扫码同时登录米家并在后台连接智能家居助手；小米要求额外安全验证时按界面提示处理。
2. 选择家庭、房间和设备。点击卡片打开详情，右键切换卡片大小或管理显示。
3. 在“设置 → 监控”选择摄像头及当前家庭／全屋范围，再打开监控模式。切换范围本身不会开流。
4. 在“设置 → 桌面卡片”开启对应屏幕，再固定设备到桌面。桌面卡片默认关闭。

## 功能

- **设备控制**：按真实设备能力提供灯具、开关、空调、窗帘、扫地机器人、晾衣机、净水器、冰箱、传感器等页面及快捷操作。操作后立即显示本地目标，后台同步失败静默回退；实测读数与本地目标分开处理。
- **设备卡片**：小、中、大三档，支持按住移动拖拽、合法交换预览与右键切换尺寸。匹配模板的大卡显示设备快捷控件。
- **桌面卡片**：每屏独立开启，支持栅格、四边留白与已启用屏幕之间拖动；保留各屏布局和账号隔离。
- **摄像机**：支持型号的实时画面、画质选择、云台、对讲、看家助手及回看。截图和录像保存在本机。
- **多路监控**：单家庭或所有家庭的摄像头共用一面监控墙，保留各家庭勾选，支持全屏与启动监控。
- **智能家居 MCP**：本机 Streamable HTTP 与访问密钥，七个固定工具。Agent 分类与转述，米家云端负责设备匹配和执行；明确独立的操作可并行提交。
- **桌面运行**：系统托盘、可选开机自启、后台资源调度及手动触发的签名更新。

摄像机音视频还受 WebView2、系统解码器和麦克风权限影响；并非全部型号均可用。详见 [平台支持](docs/PLATFORMS.md)。

## 数据与安全

账号会话、助手凭据和 MCP 密钥由后端及系统凭据库管理，不随发布包分发。媒体默认保存在系统视频目录的“米家Desktop”下，可在设置中修改。更新程序保留账号、家庭选择、卡片偏好和桌面布局。

MCP 默认关闭，仅监听本机；接入客户端需配置 Bearer 请求头。家庭委托参数不代表已验证的云端强制隔离；云端回复不作为硬件实测确认。见 [MCP 接入](docs/MCP.md)。

## 开发

需要 Git、[Node.js](https://nodejs.org/)（版本见 [.node-version](.node-version)）、[Rust](https://rustup.rs/)（版本见 [rust-toolchain.toml](rust-toolchain.toml)）及 [Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)。

```bash
git clone https://github.com/ALittlePandaMan/mijia-desktop.git
cd mijia-desktop
npm ci
npm run tauri -- dev
```

| 命令 | 用途 |
| --- | --- |
| `npm run check` / `npm test` | 类型检查与前端回归 |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked --lib` | Rust 离线回归 |
| `node scripts/check-browser.mjs` | 浏览器 Mock 回归，需要 Chrome 或 Edge |
| `npm run source:check` / `npm run capabilities:check` | 源码资源与能力夹具检查 |
| `npm run mcp:docs:check` | MCP 文档一致性 |
| `npm run build` | 前端生产构建 |
| `npm run tauri -- build --target x86_64-pc-windows-msvc` | Windows 客户端构建 |

自动化使用模拟设备，不发送真实设备控制指令。浏览器模拟不等于原生鼠标、混合 DPI 或真实设备验收。

## 文档与许可

- [桌面卡片](docs/DESKTOP_WIDGETS.md)、[应用内更新](docs/APP_UPDATES.md)、[平台与数据](docs/PLATFORMS.md)
- [MCP 接入](docs/MCP.md)、[Skill](docs/skills/device-collaboration/SKILL.md)、[参数参考](docs/MCP_REFERENCE.md)
- [本地优先控制](docs/LOCAL_FIRST_CONTROLS.md)、[性能与资源管理](docs/PERFORMANCE.md)、[发布维护](docs/RELEASING.md)
- [更新日志](CHANGELOG.md)、[问题反馈](https://github.com/ALittlePandaMan/mijia-desktop/issues)

原创代码采用 [MIT](LICENSE)。第三方素材、字体、依赖、商标及服务数据保留各自权利，详见 [第三方声明](docs/THIRD_PARTY_NOTICES.md) 与 [依赖许可](docs/DEPENDENCY_LICENSES.md)。
