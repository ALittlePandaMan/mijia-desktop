# 平台支持与安装

| 平台 | 架构 | 格式 | 凭据存储 |
| --- | --- | --- | --- |
| Windows 10/11 | x64 | NSIS 安装程序、便携 ZIP | 当前用户凭据管理器 |
| Linux 桌面 | x64 | AppImage、Debian 包 | 当前用户 D-Bus Secret Service |
| macOS 12+ | Apple Silicon / Intel | DMG、APP 压缩包 | 当前用户 Keychain |

## 安装与运行

Windows 需要 WebView2 Runtime，安装程序按 Tauri 的引导方式处理。便携版应完整解压，保留许可和文档。首版未提供商业代码签名，请从本项目 Releases 下载并核对校验值。

Linux 需要 GTK 3、WebKitGTK 4.1、桌面 D-Bus 会话和 Secret Service 密钥环（例如 GNOME Keyring）。打开目录需要 `xdg-open`；目录选择由系统原生窗口／桌面 portal 提供。Debian/Ubuntu 用户可使用 DEB，其他兼容发行版可使用 AppImage，并按系统要求允许执行。部分环境需要 FUSE 2；也可使用 AppImage 自带的解包运行方式。WebKit 的媒体支持取决于 GStreamer 插件和系统已安装的编码器／解码器。

macOS 按处理器选择下载，打开 DMG 后把应用拖入“应用程序”，或解压 APP 包。当前是临时签名、未经 Apple 公证的版本；必要时在系统“隐私与安全性”中对本次应用明确允许打开。开启对讲时由系统申请麦克风权限。不要全局关闭系统安全保护。

## 数据与媒体

Windows 数据目录保持 `%LOCALAPPDATA%/io.mijiadesktop.client`；macOS 使用用户 Application Support，Linux 使用 XDG 用户数据目录，应用子目录均为 `io.mijiadesktop.client`。会话使用系统安全存储，不回退到明文文件；Linux 未提供可用的 Secret Service 时需要先配置桌面密钥环。

三端默认保存到系统“视频／影片”目录下的“米家Desktop”，不存在标准视频目录时使用用户主目录下的 `Videos`。程序创建“截图”和“录制”，使用本地时间戳文件名。已有自定义路径继续使用；旧媒体文件不会因为默认值变化自动搬迁或删除。恢复默认使用新的视频目录规则。

## 支持边界

- 登录、设备页面和云端控制共用 Rust 逻辑；具体能力仍由设备和服务返回值决定。
- Linux/macOS 的本机路由器连接检测尚未适配，相关高风险网络更改继续沿用保守限制。
- 摄像机视频、Opus 音频和对讲受系统 MediaSource、WebCodecs 和麦克风权限支持限制，编译成功不表示所有型号的音视频都可用。
- 监控进入／退出保存窗口大小和位置；Wayland 窗口位置由合成器管理时，客户端位置恢复可能受限。

本轮仅静态审查、编译和包文件检查，没有运行自动化测试、实机界面验收、开麦、观看摄像头、保存新媒体或控制设备。四端安装、登录保持、目录窗口、监控几何、媒体解码和系统权限的实际行为均待验收。
