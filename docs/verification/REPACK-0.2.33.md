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

- 双架构 macOS 打包通过，284 个第三方原文件与受保护学习逻辑（5 个文件、9 个入口）校验通过。
- arm64 与 x64 的运行时、SQLite、本机 Chrome 有窗口／无头启动、渲染、关闭及包内集成检查通过；x64 通过 Rosetta 执行。
- 两个最终 DMG 的 `hdiutil verify`、只读挂载及 `codesign --verify --deep --strict` 通过，包内版本均为 0.2.33／33。
- 包内 `docs/screenshots/`、`docs/images/` 均不存在，文档目录未包含 PNG、JPEG、WebP 或 GIF。68 个图片引用均指向在线文件；中英文 README 的安装包链接均指向 `v0.2.33-repack`。
- 包内后台、网页和第三方文件逐项与构建目录一致；许可文件原文与源码逐字一致。相对原 `v0.2.33`，应用源码、仓库截图和文档图标未修改。
- 构建输入提交为 `540fe116fae67ed51ee29f68996e1ae71b37ada0`；包内本记录保留构建时已完成的范围，最终包摘要在仓库补录，避免自引用。

| 架构 | 原 DMG（MiB） | 当前 DMG（MiB） | 字节数 | SHA256 |
| --- | ---: | ---: | ---: | --- |

| arm64 | 94.46 | 60.39 | 63325331 | `44b5a6174acf124a470edfc9d06ebd86c55142d72327df458dcddcb0201cc891` |
| x64 | 96.55 | 64.39 | 67522375 | `e35ae442e30615f1c033b5fa7bde061f18fbb2838fb5e23178b2894d894ff0ce` |

本次未修改应用界面或学习逻辑；Windows 的共用文档复制函数已验证，Windows 原生安装包未在 macOS 构建。本次未重复运行本机完整单元测试。macOS 临时签名不代表 Apple 公证；Rosetta 运行检查不代表 Intel Mac 实机验收。

## 发布核验

- [当前去图包](https://github.com/BeifengFlying/CourseWatch/releases/tag/v0.2.33-repack) 已发布，标签指向构建输入提交 `540fe116fae67ed51ee29f68996e1ae71b37ada0`，应用版本仍为 0.2.33／33。
- 发布前后共 4 个远端附件的 size／SHA256 digest 与本地逐项一致；两个旁置校验文件均通过匿名下载并与本地逐字比较。
- 原 `v0.2.33` 的 4 个附件大小及摘要未变；原发布说明已添加当前去图包入口，中英文 README 下载链接已同步。
- 项目主工作目录 `dist/` 中的两个同名 DMG 和校验文件已换成上述新包，原包及校验文件保留在本地归档目录。

## 源码 CI

- [macOS CI](https://github.com/BeifengFlying/CourseWatch/actions/runs/43668237224) 未通过：arm64 为 332 项通过、3 项 5000ms 超时，涉及 `study-chapter-tests-runtime`、`study-empty-answer-runtime`、`unipus-window`；Intel 为 333 项通过、前两项超时。
- [Windows CI](https://github.com/BeifengFlying/CourseWatch/actions/runs/43668237180) 未通过：334 项通过，`study-catalog-tasks.test.ts` 的目录查询测试出现 `locator.evaluateAll: Frame was detached`，未进入 Windows 打包步骤。
- 本次未改动上述学习模块或测试，不将本机包内核验通过写成全部 CI 通过。
- 本机针对上述 4 个文件执行 `npx vitest run tests/study-chapter-tests-runtime.test.ts tests/study-empty-answer-runtime.test.ts tests/unipus-window.test.ts tests/study-catalog-tasks.test.ts`：4 个文件、8 项测试通过。该复查不代表远端 CI 已通过。
