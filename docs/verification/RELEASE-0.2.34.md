# 0.2.34 验证

日期：2026-11-15，Asia/Shanghai。

## 变更范围

- macOS 与 Windows 首次打开时先显示原生用户协议弹窗，直接标明完全免费、项目源码地址及付费渠道退款举报提示；协议全文可滚动阅读。
- 同意并成功保存本机记录后才启动后台。退出、关闭、缺失协议或保存失败均不视为同意；已有资料无记录时也提示，已确认后重启跳过弹窗。
- 对外仅展示 0.2.34，34 为补丁版本。安装包不再附加构建号；内部平台字段保留，历史命名按原记录处理。
- 安装包继续排除浏览器、截图及文档图片。学习逻辑与第三方原文件未修改。

## 本机检查

- macOS 原生弹窗隔离检查通过：首次拒绝、关闭、同意、已确认重启及缺失协议；不访问真实用户的偏好域、账号或后台。
- 原生视图覆盖 492×566 与 352×580 逻辑像素、浅色／深色；完整协议可滚动，底部操作位于可见范围。截图位于 `.cache/first-run34/`，不进入安装包。
- Windows 确认记录检查通过：新目录只读、同意后重启、损坏记录、旧协议修订及保存失败；只使用临时目录。
- Windows .NET 10 交叉编译通过，0 个警告、0 个错误；该结果不等于 Windows 实机启动检查。
- `npm test`：52 个文件、336 项测试通过；保护校验覆盖 5 个文件、9 个入口。
- `npm run typecheck`、版本元数据与新旧文件名的 5 项测试、`git diff --check` 通过。
- macOS 独立原生测试应用目视检查标题、免费声明、退款举报提示、项目链接、全文区域与按钮均可见，点击“退出软件”后测试进程退出；不修改正式应用的确认状态。
- macOS 双架构 `npm run build:mac:all` 通过：Node／SQLite、包内 Playwright 调用本机浏览器的有窗口／无头检查、认证边界、令牌撤销、来源过滤、API、网页、通知队列及采集子进程检查通过。
- 两个最终 DMG 均只读挂载检查通过：版本为 0.2.34，内部平台字段为 34；签名有效。后台、网页与第三方文件同构建源一致，协议和许可证原文一致；不存在浏览器、`docs/screenshots`、`docs/images` 或本地 `AGENTS.md`。每包 68 处展示图引用改为版本标签的在线地址。
- macOS 包采用临时签名，未通过 Apple 公证。Intel 包通过 Rosetta 运行检查，未完成 Intel Mac 实机界面验证。

## 安装包

构建输入提交：`3dc511316598b875663e06e48529f113c7d37ce3`。版本标签：`v0.2.34`。发布附件仅包含下列 macOS 安装包及同名 `.sha256` 文件。

| 文件 | 字节数 | SHA256 |
| --- | ---: | --- |
| `CourseWatch-0.2.34-mac-arm64.dmg` | 61,478,282 | `1bcef79d0ecd10b7d5ed81e6a8dc1b14c800c3981660a9c8902385aad1a8f62d` |
| `CourseWatch-0.2.34-mac-x64.dmg` | 66,490,426 | `6dff804f629e8f73e6d38c6afdb494f393f5d50a9928993fd2e5b138512e3cce` |

README、协议与许可证位于应用的 `Contents/Resources/`。DMG 卷根目录仅包含应用和 Applications 快捷方式。

## 持续集成

[macOS 检查 43671960750](https://github.com/BeifengFlying/CourseWatch/actions/runs/43671960750) 未通过：arm64 的 `study-chapter-tests-runtime`、`study-empty-answer-runtime`，以及 x64 的上述两项和 `unipus-window` 测试达到默认 5 秒超时。该结果不记为通过；本机 336 项测试与包内集成检查的通过范围分别记录。

## 发布及旧包

[CourseWatch 0.2.34](https://github.com/BeifengFlying/CourseWatch/releases/tag/v0.2.34) 已发布为测试版。四个附件的远端字节数及 SHA256 与本地一致；未携带登录凭据访问两个 DMG 下载入口成功，两个 `.sha256` 文件与本地逐字节一致。版本标签指向上述构建输入提交，随包展示图的版本地址可访问。

旧版 macOS Releases 的 12 个附件及 2 个 Actions 安装包已完成本地归档和摘要／ZIP 完整性校验。归档清单为本地 `build/release-archives/before-0.2.34/manifest-macos.json`。

新版本下载核验后，已删除 `v0.2.33-repack`、`v0.2.33`、`v0.2.32` 三个不可变 Release，及旧版 macOS Actions 安装包 `14124382448`、`14124137607`。三个 Release API、12 个原附件下载地址及两个 Actions 附件 API 均返回 HTTP 404；源码标签与提交保留。已下载的第三方副本不在此操作范围内。
