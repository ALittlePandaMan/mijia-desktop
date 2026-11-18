# 米家Desktop 宣传页

[项目网站与交互演示](https://alittlepandaman.github.io/mijia-desktop/)使用 Next.js 静态导出。这里维护首页、MCP 介绍、设备界面演示和监控示例。设备演示使用模拟数据，监控演示使用项目所有者授权展示的四张静态图片。

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

Website 工作流在 PR 中执行检查，合并到 main 后发布到 GitHub Pages。发布构建刷新公开项目统计，每日再构建一次。读取统计失败时使用仓库中的有效数据快照。可用 npm run stats:sync 更新随源码保存的快照。

原创代码采用项目的 [MIT 许可证](../LICENSE)。图片、字体和依赖的权利说明见[第三方声明](public/licenses/THIRD_PARTY_NOTICES.md)及[监控素材声明](public/licenses/demo-media-NOTICE.md)。
