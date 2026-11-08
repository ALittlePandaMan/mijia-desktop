# 米家Desktop

[![构建](https://github.com/ALittlePandaMan/mijia-desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/ALittlePandaMan/mijia-desktop/actions/workflows/ci.yml)

基于 Tauri 2、Rust 和 TypeScript 的非官方米家桌面客户端，支持 Windows、Linux 和 macOS。通过小米账号扫码登录，查看家庭与房间，管理支持的米家设备。

## 下载

在 [GitHub Releases](https://github.com/ALittlePandaMan/mijia-desktop/releases) 下载对应系统版本：

| 系统 | 下载文件 |
| --- | --- |
| Windows x64 | 安装程序 `.exe` 或便携 `.zip` |
| Linux x64 | `.AppImage` 或 `.deb` |
| macOS Apple Silicon | `macos-arm64.dmg` 或对应 `.app.tar.gz` |
| macOS Intel | `macos-x64.dmg` 或对应 `.app.tar.gz` |

首版 Windows 未做证书签名，macOS 使用临时签名；系统可能要求额外确认。安装步骤和系统依赖见 [平台说明](docs/PLATFORMS.md)。各文件的 SHA-256 校验值随版本提供。

## 功能

- 家庭、房间与设备列表，设备排序、隐藏和显示偏好。
- 按设备能力提供灯具、开关、空调、窗帘、晾衣机、净水器、冰箱、传感器、路由器等控制页面。
- 支持型号的摄像头实时画面、监控墙、画质选择、云台、对讲、看家助手及回看。
- 截图和录像仅保存在本机，默认位于系统视频／影片目录中的“米家Desktop”，可在设置中更改。
- MiSans 字体、系统自动深浅色，以及键盘操作和减少动态效果支持。

设备功能以型号、固件和云端实际提供的能力为准。Linux/macOS 首版适配核心功能，Windows 专有路由器本机网络检测仍受限；音视频能力取决于系统 WebView 和编解码器。[平台支持与待验收范围](docs/PLATFORMS.md)。

## 本地开发

需要 Git、[Node.js](https://nodejs.org/)（版本见 `.node-version`）、[Rust](https://rustup.rs/)（版本见 `rust-toolchain.toml`），以及 [Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)。

```bash
git clone https://github.com/ALittlePandaMan/mijia-desktop.git
cd mijia-desktop
npm ci
npm run dev
# 完整桌面窗口
npm run tauri -- dev
```

| 命令 | 用途 |
| --- | --- |
| `npm run build` | TypeScript 检查和前端生产构建 |
| `npm run source:check` | 源码、资源、引用和提交范围静态检查 |
| `npm run tauri -- build` | 构建本机安装包 |
| `npm run version:set -- 0.1.1` | 同步项目版本和锁文件 |
| `npm run version:check` | 检查所有项目版本一致 |
| `npm run licenses` | 从锁文件和已下载依赖更新许可清单 |
| `npm test` | 现有离线单元测试，仅在明确选择运行时使用 |

默认 CI 只做静态检查和编译，不运行测试或操作真实设备。生产构建不启用调试端点。

## 发布版本

```bash
npm run version:set -- 0.1.1
git add .
git commit -m "Release v0.1.1"
git push origin main
# 等待普通 CI 成功后
git tag v0.1.1
git push origin v0.1.1
```

标签触发四种平台组合的原生构建，全部成功后统一发布安装包和校验值。`v0.2.0-beta.1` 这类标签发布为预发布版本。[发布维护](docs/RELEASING.md)。

## 数据与许可证

会话保存在操作系统安全凭据存储中，偏好和缓存保存在当前用户数据目录。不要向 Issue、日志或提交中加入账号会话、设备 token、录像及家庭资料。

原创代码采用 [MIT](LICENSE)。第三方字体、图标、图片和依赖适用各自的原有权利与许可，项目 MIT 不覆盖这些作品；来源及许可范围见 [第三方声明](docs/THIRD_PARTY_NOTICES.md)。本项目与小米及米家没有隶属或背书关系。
