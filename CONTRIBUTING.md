# 贡献说明

欢迎提交问题报告、文档修订、错误修复和功能改动。提交前搜索已有 Issue；较大改动先通过 Issue 说明范围和实现方式。PR 应说明改动、实际验证和未验证范围，补充必要测试及文档，不把模拟页面或构建通过写成真实平台验收。

## 来源与许可

- 仅提交原创内容或已取得相应授权的内容。引入第三方代码、素材、字体或数据时，注明来源、版本和许可，并保留原始版权及许可声明。公开可下载或标注来源不代表已取得授权。
- 对拟按项目 Apache-2.0 及 TERMS 项目约定提供的新增原创贡献，请在 PR 中确认有权按 [LICENSE](LICENSE) 提供相应授权。提交 PR 不转让著作权，也不表示授予维护者任意重新许可第三方内容或外部贡献的权利；其他许可安排应在合并前说明并取得相关权利人同意。
- 保留历史 Apache-2.0 授权与第三方组件各自的许可范围，不将整个仓库或安装包笼统标成单一许可。
- 不提交真实账号、Cookie、会话、数据库、API Key、原始模型日志、受限题目或他人个人信息。问题复现使用模拟数据，截图及日志先脱敏。

## 自动化与验证

学习通和 U校园实验功能仅用于技术实现验证与参考，不得用于其他目的；行为与责任范围见[自动化边界](docs/legal/AUTOMATION_BOUNDARIES.md)。技术验证不构成平台授权或法律豁免，不能确认相关操作被允许时使用本地模拟页面或自行控制的测试环境。

不得删除视频弹题穷举、提交结果不明不重试、U校园每 5 分钟保活、普通超时继续、暂停和人工验证保护，也不得删除保护注释、入口、清单、测试或打包前校验。确需修改时保持受保护行为，同步保护清单及行为测试，详见[受保护学习逻辑](docs/guides/STUDY_PROTECTED_LOGIC.md)。

运行与改动相关的检查；涉及学习逻辑时执行 `npm run check:study-protection`、`npm run typecheck` 和 `npm test`。界面改动还应检查桌面与窄窗口、浅色与深色主题，记录真实验证范围。

## English

PRs may report issues, improve documentation, fix bugs or add features. Search existing issues first and discuss larger changes in an issue. Describe the change, actual validation and untested scope, with necessary tests and documentation. Do not describe mock-page checks or a successful build as validation against a real platform.

Only submit original material or material you are authorized to contribute. Identify third-party sources, versions and licenses, and retain their original notices. For new original contributions intended to use the project's Apache-2.0 license and additional Project Terms, confirm in the PR that you have authority to grant the rights in [LICENSE](LICENSE). A PR does not transfer copyright or grant unrestricted relicensing rights. Resolve alternative licensing arrangements before merging. Preserve historical Apache-2.0 grants and independent third-party licenses.

Do not submit credentials, sessions, databases, API keys, raw model logs, restricted questions or others' personal information. Use mock data and redact screenshots and logs. Experimental automation is solely for technical implementation verification and reference, and must not be used for other purposes. This does not establish platform authorization or a legal exemption.

Preserve the protected video-question enumeration, no retry on uncertain submissions, Unipus keepalive, ordinary timeout continuation, pause and human-verification protections, their call sites, notices, checks and behavior tests. See the [protected logic guide](docs/guides/STUDY_PROTECTED_LOGIC.md) (Chinese). Run relevant checks; study logic changes require protection checks, type checking and tests. UI changes also require desktop and narrow-window checks in both themes.
