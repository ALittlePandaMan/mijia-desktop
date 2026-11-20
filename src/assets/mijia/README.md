# 界面静态素材

只保留当前源码、绑定表和动态加载所引用的静态图形。包哈希、成员路径和文件哈希保存在 library-manifest.json，语义绑定保存在 bindings.json；修改绑定时同步维护源码中的静态导入，并运行 `npm run source:check`。

图片保持原始字节；矢量和字形按原始路径转换。应用不执行插件代码，不依赖开发时使用的 APK、反编译器或素材导入工具。第三方作品不适用本项目 MIT 许可，来源记录不授予额外再分发权。具体声明见根目录 docs/THIRD_PARTY_NOTICES.md 及 licenses/mijia-assets/NOTICE.txt。
