<h1 align="center">米家Desktop</h1>

<p align="center">米家设备管理与摄像机监控的桌面客户端</p>

<p align="center">
  <a href="https://github.com/ALittlePandaMan/mijia-desktop/actions/workflows/ci.yml"><img src="https://github.com/ALittlePandaMan/mijia-desktop/actions/workflows/ci.yml/badge.svg" alt="构建状态"></a>
  <a href="https://github.com/ALittlePandaMan/mijia-desktop/releases/latest"><img src="https://img.shields.io/github/v/release/ALittlePandaMan/mijia-desktop?label=version&amp;color=blue" alt="最新发布版本"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License"></a>
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#核心功能">核心功能</a> ·
  <a href="#开发与文档">开发与文档</a> ·
  <a href="#版本发布">版本发布</a> ·
  <a href="https://github.com/ALittlePandaMan/mijia-desktop/issues">问题反馈</a>
</p>

米家Desktop 将家庭设备查看、设备控制和摄像机监控整合在一个桌面窗口中。通过小米账号扫码登录，按家庭和房间查看设备，打开对应控制页面，也可以将多台摄像机集中到监控墙中查看。

客户端基于 Tauri 2、Rust 和 TypeScript，沿用米家风格与 MiSans 字体，随系统切换深浅色。登录与设备信息获取需要连接小米服务，截图和录像仅保存在本机；会话使用 Windows 凭据管理器保存。

**当前仅发布 Windows x64 版本。** Linux 和 macOS 的构建与发布暂缓。本项目为独立第三方客户端，与小米及米家没有隶属或背书关系。

## 核心功能

- **家庭与房间**：查看账号下的家庭、房间和设备，按使用习惯调整设备排列与显示。
- **设备控制**：按设备能力提供灯具、开关、空调、窗帘、晾衣机、净水器、冰箱、传感器、路由器等控制页面。
- **摄像机功能**：支持型号的实时画面、画质选择、云台控制、语音对讲、看家助手及回看，画质档位按设备能力显示。
- **多路监控**：选择参与监控的摄像机，在监控墙中集中查看，进入和退出监控时恢复窗口位置与大小。
- **本机截图与录像**：自动创建“截图”和“录制”目录，按本地时间戳命名，可在设置中更改保存位置或打开目录。
- **界面与偏好**：MiSans 字体、系统自动深浅色、设备排序与隐藏管理，以及键盘操作和减少动态效果支持。

具体功能取决于设备型号、固件和云端提供的能力。摄像机音视频还受 WebView2、系统编解码器与麦克风权限影响，支持边界和待验收范围见 [平台说明](docs/PLATFORMS.md)。

## 快速开始

### 1. 下载与安装

从 [最新 Release](https://github.com/ALittlePandaMan/mijia-desktop/releases/latest) 下载 Windows 10/11 x64 版本，无需克隆源码或安装开发环境。

| 下载文件 | 使用方式 |
| --- | --- |
| 安装版 `*-windows-x64-setup.exe` | 运行安装程序，按向导完成安装 |
| 便携版 `*-windows-x64-portable.zip` | 完整解压后运行 `mijia-desktop.exe`，保留随包许可与文档 |
| `SHA256SUMS` / `SHA256.json` | 核对安装程序和便携包的 SHA-256 校验值 |

运行需要 WebView2 Runtime，安装程序按需引导安装。首版未做代码签名，Windows 可能要求额外确认；详细步骤见 [安装与运行](docs/PLATFORMS.md#安装与运行)。

### 2. 扫码登录并选择设备

1. 打开客户端，使用米家 App 或小米账号扫码确认登录。
2. 选择家庭与房间，查看设备列表。
3. 点击设备卡片进入控制页面；摄像机页面可查看画面、选择画质及使用设备支持的控制功能。

多台摄像机可在“设置 → 监控”中选择参与设备，再开启监控模式。设备排序、显示偏好和隐藏设备也在设置页管理。

### 3. 设置媒体保存位置

截图和录像默认保存到系统“视频”目录下的“米家Desktop”，分别存放在“截图”和“录制”子目录。可在“设置 → 截图与录制”中更改位置、打开目录或恢复默认。

已有自定义路径继续有效，更新程序保留用户配置。默认目录规则变化不会自动搬迁或删除旧媒体，数据位置见 [数据与媒体](docs/PLATFORMS.md#数据与媒体)。

## 开发与文档

前端使用 TypeScript 和 Vite，桌面端使用 Tauri 2 与 Rust。开发环境需要 Git、[Node.js](https://nodejs.org/)（版本见 [.node-version](.node-version)）、[Rust](https://rustup.rs/)（版本见 [rust-toolchain.toml](rust-toolchain.toml)），以及 [Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)。

```bash
git clone https://github.com/ALittlePandaMan/mijia-desktop.git
cd mijia-desktop
npm ci
npm run tauri -- dev
```

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动前端开发服务 |
| `npm run build` | TypeScript 检查和前端生产构建 |
| `npm run source:check` | 源码、资源、引用和提交范围静态检查 |
| `npm run tauri -- build` | 构建 Windows 安装包 |
| `npm run version:check` | 检查项目版本与锁文件一致 |
| `npm run licenses` | 从锁文件和已下载依赖更新许可清单 |
| `npm test` | 按需运行保留的离线单元测试 |

默认 CI 只做静态检查和编译，不运行测试或操作真实设备。生产构建不启用调试端点。

| 文档 | 内容 |
| --- | --- |
| [平台说明](docs/PLATFORMS.md) | Windows 安装、数据目录、系统依赖与支持范围 |
| [发布维护](docs/RELEASING.md) | 版本同步、标签发布、打包与校验流程 |
| [更新日志](CHANGELOG.md) | 各版本的功能与调整记录 |
| [第三方声明](docs/THIRD_PARTY_NOTICES.md) | 字体、界面素材、协议参考与来源说明 |
| [依赖许可](docs/DEPENDENCY_LICENSES.md) | 锁定依赖、许可证与随包声明 |

## 版本发布

使用统一命令同步 npm、Cargo、Tauri 配置及锁文件中的版本。以下以 `0.1.1` 为例：

```bash
npm run version:set -- 0.1.1
git add .
git commit -m "Release v0.1.1"
git push origin main
# 等待普通 CI 成功后
git tag v0.1.1
git push origin v0.1.1
```

`v*` 标签触发 Windows x64 自动构建。安装程序与便携包均通过文件检查后，统一发布到 GitHub Releases，并附 SHA-256 校验值。`v0.2.0-beta.1` 这类标签发布为预发布版本，不替换最新稳定版。完整流程见 [发布维护](docs/RELEASING.md)。

## 常见问题

- **设备缺少某项功能**：先确认型号和固件是否提供该能力；客户端按设备返回的能力显示控制项，不同型号的画质档位和控制功能可能不同。
- **摄像机没有画面、声音或无法对讲**：检查设备在线状态、网络、WebView2 Runtime 和系统麦克风权限；具体限制见 [平台说明](docs/PLATFORMS.md#支持边界)。
- **找不到截图或录像**：在“设置 → 截图与录制”点击“打开目录”；使用过自定义路径时，文件仍保存在该路径下。
- **更新后是否保留配置**：偏好与缓存位于当前用户数据目录，会话保存在 Windows 凭据管理器中；安装版和便携版都使用当前用户配置。

其他问题请提交包含客户端版本、设备型号、复现步骤及脱敏日志的 [Issue](https://github.com/ALittlePandaMan/mijia-desktop/issues)。不要上传账号会话、设备 token、家庭资料、截图或录像中的私人内容。

## 致谢与许可证

感谢 MiSans、Tauri、Rust 及相关开源依赖的作者，也感谢 Xiaomi-cloud-tokens-extractor、go2rtc、hass-xiaomi-miot 和 Xiaomi Camera Viewer 等项目提供的公开实现参考。素材、字体及协议参考的来源记录见 [第三方声明](docs/THIRD_PARTY_NOTICES.md)。

原创代码采用 [MIT License](LICENSE)。第三方代码、字体、图标、图片及商标遵循各自条款，项目 MIT 不替代这些上游条款或授予额外的再分发许可。
