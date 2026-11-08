# 第三方声明

本项目原创代码采用根目录 MIT LICENSE。第三方依赖、字体、图标、图片、商标和服务数据保留原有权利与许可，不因本仓库开源而转为 MIT。

## 原版静态素材

界面使用米家 APK、设备插件及明确标记的原版页面截图中的静态图形。图片保持原始字节，Android 矢量和 MiSymbol 字形按原始路径转换；不包含或执行插件 JavaScript、APK 或固件。

当前只保留实际引用的素材。包哈希、成员路径、转换来源与文件哈希见 `src/assets/mijia/library-manifest.json`、`bindings.json`、相关 provenance.json 以及 `licenses/mijia-assets/NOTICE.txt`。截图素材只包括界面图形，不包含家庭画面。权利归各自权利人；来源记录不声明额外的再分发授权或小米背书。

## MiSans

内置未经修改的 MiSans VF 4.009，来自小米官方字体下载包。适用许可和来源哈希见 `licenses/fonts/MiSans/`。项目 MIT 不覆盖字体，字体仅作为本应用的组成部分提供。

## 协议实现参考

认证和 MIoT 协议由 Rust 编写，开发中参考公开实现核对协议，不是隔离式 clean-room 开发：

- Xiaomi-cloud-tokens-extractor，MIT，固定提交 `c4db715dace9806e905153c2977608873e8ab7c9`，参考二维码、STS 和 RC4 云信封；许可见 `licenses/references/xiaomi-cloud-tokens-extractor/`。
- go2rtc，MIT，固定提交 `7c05066c90ab6ad1fccb506d5f0408aa31ebe60f`，参考签名顺序、认证及摄像机协议；许可见 `licenses/references/go2rtc/` 和 `licenses/camera/`。
- hass-xiaomi-miot，Apache-2.0，固定提交 `f78158257e19a21902adaf6bcc8440c3ba172a91`，参考家庭设备查询和 MIoT 接口；许可见 `licenses/references/hass-xiaomi-miot/`。该固定版本没有独立 NOTICE。
- 摄像机 CS2/MISS 还参考 MIT 的 Xiaomi Camera Viewer；许可见 `licenses/camera/`。不分发 Go、Java 或 FFmpeg 运行时。

研究中接触过 GPL 的 mijia-api 和采用受限许可证的官方 Home Assistant 项目，仅用于识别接口和许可边界；产品没有复制、移植或链接它们的代码，也没有使用官方 Home Assistant OAuth 客户端凭据。原始研究克隆、反编译材料、账号资料与历史记录不属于本仓库发布资源。

## 依赖

锁定依赖清单、许可原文和声明见 [DEPENDENCY_LICENSES.md](DEPENDENCY_LICENSES.md) 与 `licenses/`。许可证表达式来自对应版本，不同平台可选依赖也在清单中披露。MPL-2.0 单一许可依赖的同版本原始源码归档保存在 `licenses/sources/cargo/`，未修改这些第三方源码。更新依赖后应同步许可和来源记录。

本软件是独立第三方客户端，与小米及各参考项目没有隶属或背书关系。
