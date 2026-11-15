# 0.2.33 安装包去除展示图

日期：2026-11-15，Asia/Shanghai。版本 0.2.33，构建号 33。

## 打包范围

- macOS 与 Windows 共用的文档复制函数不再复制 `docs/screenshots/` 和 `docs/images/`。仓库中的图片、界面运行资源、第三方文件与许可文本保留。
- 随包 Markdown 中指向上述目录的 Markdown 图片、普通链接和 HTML 图片地址改为 `v0.2.33` 标签下的在线地址；仓库原文仍使用相对地址。离线时可阅读文字，展示图片需要联网。
- macOS arm64、x64 新附件及 SHA256 保持原文件名，应用版本号和构建号不变，发布标签为 `v0.2.33-repack`；中英文 README 的当前下载入口同步切换。原文件及校验记录在本地独立归档。
- 原 `v0.2.33` 已启用 GitHub 不可变发布；覆盖附件请求返回 HTTP 422，原 4 个附件未改变。该发布的附件和标签不能修改，删除后也不能重用标签名，因此保留原发布，另用重新打包标签提供当前安装包。规则见 [GitHub 不可变发布说明](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)。
- 打包脚本的同名文件保护与受保护学习逻辑校验保留。

## 验证及附件

- `npm run typecheck`、`git diff --check` 通过。
- 在全新临时目录调用两端共用的 `copyDistributionDocs`：输出 87 个目录／文件条目，未包含截图或文档图片目录；68 个在线图片链接均能对应仓库中的文件，没有残留指向被移除图片的本地链接。
- LICENSE、中英文 TERMS、NOTICE、免责声明、隐私、第三方声明及两份历史许可原文与源码逐字一致。
- 首次发布的两个 DMG 及校验文件已归档至本机 `build/release-archives/0.2.33-before-image-removal-20261115-102608/`。

构建完成后补录安装包字节数、摘要及包内检查范围。本次未修改应用界面或学习逻辑；Windows 的共用复制函数已验证，Windows 原生安装包未在 macOS 构建。
