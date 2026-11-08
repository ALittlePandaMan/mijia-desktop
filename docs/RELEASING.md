# 发布维护

普通 `main` 提交和 PR 执行源码／资源静态检查、前端构建与四种平台组合的 Rust 编译检查；默认不运行测试或使用真实账号和设备。

版本由 `npm run version:set -- <SemVer>` 同步到 package.json、package-lock.json、Cargo.toml、Cargo.lock 和 Tauri 配置。该命令不自动提交或打标签。完成提交并等待 CI 后，推送 `v<版本>` 标签。

发布工作流分别在 Windows x64、Linux x64、macOS ARM64 和 macOS x64 runner 上构建；每个任务只上传本平台包及构建清单到 Actions。全部成功后，由单独的发布任务校对版本、架构和文件哈希，创建带完整附件的草稿，再将其公开。失败时不会发布缺少平台的正式版本。已公开的同版本不自动覆盖；草稿可在修复后重新上传。

文件名包含软件名、版本、系统和架构。Windows 提供安装 EXE 与含许可的便携 ZIP；Linux 提供 AppImage、DEB；macOS 每种架构提供 DMG 与 APP 的 tar.gz。Release 附 SHA256SUMS 和 SHA256.json。GitHub 自带的标签源码归档即为源码下载。

普通构建只有读取权限，只有发布任务拥有 contents:write，使用内置 GITHUB_TOKEN。Actions 使用完整提交 SHA 固定，Node 与 Rust 使用项目记录的版本。依赖使用 npm ci 和 Cargo.lock 的 locked 构建。

首版 Windows 未做证书签名，macOS signingIdentity 为 `-`，不需要上传私人证书。需要正式证书签名、公证或应用内升级时另行配置；不要把证书、私钥或凭据提交到仓库。

更新依赖后先运行 cargo fetch --locked，再运行 npm run licenses；许可生成器不会执行依赖代码。当前平台未取得的许可原文会在清单中标明，不冒充已补齐。不要删除适用的原始许可、NOTICE 或需要随附的依赖源码归档。
