# 发布维护

## 版本与检查

仅构建和发布 Windows x64。使用 `npm run version:set -- <SemVer>` 同步 package.json、package-lock.json、Cargo.toml、Cargo.lock 与 Tauri 配置，再运行 `npm run version:check`。

main 和 PR 的 CI 执行完整前端回归、Rust 回归与编译、浏览器 Mock、MCP 文档、能力夹具、源码资源、分发清单和轻量入口检查。自动化不使用真实账号或发送设备命令。

将通过验证的提交推送至 main，等待 CI 成功后推送对应 `v<版本>` 标签。标签必须与项目版本完全一致；不覆盖已经公开的同版本 Release。

## 分发内容

正式 Release 包含七个附件：

- `mijia-desktop-v<版本>-windows-x64-setup.exe`
- `mijia-desktop-v<版本>-windows-x64-portable.zip`
- 上述两份包各自的 `.sig`
- `latest.json`
- `SHA256SUMS`
- `SHA256.json`

源码由 GitHub 标签归档提供。便携包内含程序、便携标记、必要的用户文档及许可；安装资源使用同源文档清单，不分发开发审查、测试输出或私有备份。文件清单定义于 `scripts/distribution-files.mjs`。

发布工作流在 Windows runner 打包，核对 EXE 架构、ZIP 内程序、版本和签名；独立发布任务再核对提交、文件名、大小和 SHA-256，先创建草稿、上传全部附件后公开。普通 CI 只有读取权限，发布任务才授予 contents:write。

## 签名与构建

仓库 Secret `TAURI_SIGNING_PRIVATE_KEY` 必须与 Tauri 配置中的公钥匹配；有密码时还需 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。不要输出或提交私钥，不要随意更换既有更新公钥。

本地正式构建通过受保护环境提供私钥内容和可选密码，运行：

```bash
npm ci
npm run tauri -- build --target x86_64-pc-windows-msvc
node scripts/package-artifacts.mjs windows-x64
node scripts/release-artifacts.mjs
```

汇总和发布脚本还校验 `GITHUB_SHA`、标签及版本，应在相应发布环境运行。`TAURI_SIGNING_PRIVATE_KEY_PATH` 仅适用于独立 signer 命令，不能替代原生构建要求的私钥内容。

Tauri 更新签名与 Windows Authenticode 不同；当前没有商业代码签名证书。签名或校验失败应停止发布，不关闭安全校验来绕过错误。

## 更新与依赖

稳定版更新地址保持固定 GitHub 仓库。latest.json 为安装版和便携版分别提供签名包；预发布不替代稳定版。手动检查与更新行为见 [应用内更新](APP_UPDATES.md)。

依赖变动后执行 `cargo fetch --locked` 与 `npm run licenses`，核对锁文件、许可清单和来源。仅删除当前清单已不再引用的生成许可目录；保留素材、字体、协议参考、补充许可和需要随附的源码归档。

1.0.0 从新的单提交基线起步；后续版本正常保留增量提交与发布记录，不重复重置历史。
