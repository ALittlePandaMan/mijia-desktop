# 米家Desktop 宣传页

[项目网站与交互演示](https://alittlepandaman.github.io/mijia-desktop/)使用 Next.js 静态导出。这里维护首页、MCP 介绍、设备界面演示和监控示例。设备演示使用模拟数据，监控演示使用与[主项目 README](../README.md#多路摄像机监控)相同的四幅合成场景。

## 本地开发

使用仓库 .node-version 指定的 Node.js 版本，在 website 目录运行：

    npm ci
    npm run dev

开发地址为 [http://localhost:3000/](http://localhost:3000/)。构建和类型检查会从同仓桌面源码生成所需组件，并验证导出文件的 SHA-256。生成的 demo/desktop、public/demo 和 out 目录由构建管理。

    npm run check
    npm run build
    npm run demo:check
    npm run demo:cards:check
    npm run preview

要验证 Pages 子路径，为构建及静态检查设置 NEXT_PUBLIC_SITE_BASE_PATH=/mijia-desktop，然后运行 npm run preview -- --base /mijia-desktop/。静态产物位于 out。

## 发布与素材

Website 工作流在 PR 中执行检查，合并到 main 后发布到 GitHub Pages。正式版发布工作流完成后自动刷新网站，手动发布或编辑 GitHub Release 也会排队刷新。站点每日重建，采集 GitHub 星标和正式版 Windows 安装包、便携包的累计下载次数。

下载区在静态页面中提供发布构建时的版本与下载链接，浏览器加载后向 GitHub 查询当前最新正式版。可用 `npm run stats:sync` 更新源码中的回退快照。网盘入口位于 `app/promo.tsx` 的下载区，各网盘文件由维护者更新。

原创代码采用项目的 [MIT 许可证](../LICENSE)。图片、字体和依赖的权利说明见[第三方声明](public/licenses/THIRD_PARTY_NOTICES.md)及[监控素材声明](public/licenses/demo-media-NOTICE.md)。
