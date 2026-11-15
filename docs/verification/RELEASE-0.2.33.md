# 0.2.33（构建 33）验证

日期：2026-11-15，Asia/Shanghai。

## 许可及文档

- LICENSE 逐字保留 Apache-2.0 正文，TERMS.md／TERMS.en.md 第零、八部分集中列出自定义非商业条款、与 Apache 条款的对应关系及冲突处理顺序。
- 只在有权按本组条款许可的适用内容范围内，明确冲突按 TERMS 处理，未冲突部分仍按 Apache 正文处理。冲突规则不覆盖第三方独立许可、有效历史授权或法律强制规定，不保证司法上必然可执行。
- 禁止商用要求自构建 32 起实施；构建 33 起采用本组组合形式。构建 32 原独立非商业许可逐字保存在 `licenses/CourseWatch-Noncommercial-1.0.txt`，既有源码和安装包不追溯换约。
- 中英文 README 的徽章、版本、下载链接和许可说明、NOTICE、免责声明、第三方声明、许可核查、依赖元数据和随包复制清单同步。整体不能仅标为标准 Apache-2.0，也不属于 OSI 定义的开源许可。
- 版本统一为 0.2.33／构建 33，Windows 修订号为 0；不覆盖历史包。两个系统的新安装包均不附带浏览器。

## 验证结果

- `npm run typecheck` 通过。
- `npm test`：52 个测试文件、335 项测试通过；受保护学习逻辑校验覆盖 5 个文件、9 个入口。
- `npm run build`：网页、扩展及后台构建通过。
- `git diff --check` 通过；README 与 TERMS 的本地文件链接存在。
- LICENSE 与标准 Apache 原文逐字一致；构建 32 许可归档与原版本 LICENSE 逐字一致。
- 本次仅修改许可、文档、版本及随包文档清单，未修改学习逻辑实现。

## 首次发布的安装包

- `npm run build:mac:all` 通过；arm64 与 x64 的运行时、SQLite、本机 Chrome 有窗口／无头启动及包内集成检查通过。x64 通过 Rosetta 执行。
- 两个 DMG 的 `hdiutil verify`、只读挂载及 `codesign --verify --deep --strict` 通过，版本均为 0.2.33／33。
- 包内中英文 README、LICENSE、TERMS、NOTICE、免责声明、隐私和第三方文件、构建 32 许可归档与构建源码逐字一致；后台学习模块、前端与展示图一致。未发现浏览器可执行文件、用户数据库或密钥文件。
- GitHub 草稿附件共 4 个，远端 size／SHA256 digest 与本地文件逐项一致后发布；构建 32 文件未覆盖。构建源码提交为 `206bdc8339f8758e3bf5fcedfe1d4944ba7c9d0d`，标签 `v0.2.33`。

| 架构 | DMG 字节数 | SHA256 |
| --- | --- | --- |
| arm64 | 99051885 | `9d4defc953801b2d187de400acb829c6e102e6d95d817266d735f9a86a508c31` |
| x64 | 101243381 | `ae7df2c551ff93374501a89ee842220a75b654cb8442af29528bda6383349f83` |

上述最终结果在打包后补录；包内同名验证记录保留打包时已完成的检查范围，不包含自引用的最终摘要。

## 同版本重新打包

当前附件的去图范围、体积及 SHA256 见[重新打包记录](REPACK-0.2.33.md)。上表保留首次发布摘要，旧附件已在本地归档。

## CI 状态

- 源码提交的 [macOS CI](https://github.com/BeifengFlying/CourseWatch/actions/runs/43625041971) 中，arm64 的 `study-chapter-tests-runtime.test.ts` 与 `study-empty-answer-runtime.test.ts` 各有一项超过默认 5000ms，结果为 333 通过、2 失败；因此不能声称全部 CI 通过。本机 335 项通过与此结果分别记录。
- 补录时 Intel CI 与 [Windows CI](https://github.com/BeifengFlying/CourseWatch/actions/runs/43625041968) 仍在运行，未将其视为通过。此次 Release 附件仅含 macOS 安装包。


本记录中最终文件摘要由打包后在仓库补录，实际校验值以旁置 `.sha256` 及 GitHub Release 附件摘要为准。macOS 临时签名不代表 Apple 公证；本机及模拟课程检查不代表真实模型、真实课程提交或其他系统的实机验收。既有第三方分发许可未决项见[许可核查](../legal/RELEASE_LICENSE_REVIEW.md)。
