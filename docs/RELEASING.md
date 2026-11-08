# 发布维护

当前仅构建和发布 Windows x64。普通 `main` 提交和 PR 在 Windows runner 上执行源码／资源静态检查、前端构建与 Rust 编译检查；默认不运行测试或使用真实账号和设备。Linux/macOS 的编译和打包任务暂不启用。

版本由 `npm run version:set -- <SemVer>` 同步到 package.json、package-lock.json、Cargo.toml、Cargo.lock 和 Tauri 配置。该命令不自动提交或打标签。完成提交并等待 CI 后，推送 `v<版本>` 标签。

发布工作流在 Windows x64 runner 上构建 NSIS 安装程序和便携 ZIP，并校对 EXE 架构及 ZIP 内文件。构建任务只上传包和构建清单到 Actions；单独的发布任务核对版本、提交、文件名、大小和 SHA-256，再创建草稿、上传完整附件并公开。安装程序或便携包缺失、损坏时均不会发布。已公开的同版本不自动覆盖；草稿可在修复后重新上传。

每个正式版本包括以下四个附件：

- `mijia-desktop-v<版本>-windows-x64-setup.exe`
- `mijia-desktop-v<版本>-windows-x64-portable.zip`（包含程序、许可和文档）
- `SHA256SUMS`
- `SHA256.json`

GitHub 自带的标签源码归档即为源码下载。预发布标签（如 `v0.2.0-beta.1`）标为预发布，不替换最新稳定版。

普通构建只有读取权限，只有发布任务拥有 contents:write，使用内置 GITHUB_TOKEN。Actions 使用完整提交 SHA 固定，Node 与 Rust 使用项目记录的版本。依赖使用 npm ci 和 Cargo.lock 的 locked 构建。发布任务使用 Linux runner 汇总文件，不构建或发布 Linux 软件。

首版 Windows 未做证书签名，不需要上传私人证书。需要正式证书签名或应用内升级时另行配置；不要把证书、私钥或凭据提交到仓库。

更新依赖后先运行 cargo fetch --locked，再运行 npm run licenses；许可生成器不会执行依赖代码。当前平台未取得的许可原文会在清单中标明，不冒充已补齐。不要删除适用的原始许可、NOTICE 或需要随附的依赖源码归档。
