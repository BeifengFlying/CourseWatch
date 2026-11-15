# 脚本入口

| 用途 | 入口 |
| --- | --- |
| macOS 打包 | `npm run build:mac` → `build-macos.ts`，运行时辅助为 `macos-runtime.ts` |
| Windows 打包 | `npm run build:win` → `build-windows.ts`，图标为 `build-windows-icon.ps1` |
| 包内运行检查 | `check-desktop-bundle.mjs`，由两端打包脚本调用 |
| Windows 后台生命周期 | `check-windows-lifecycle.mjs`，由 Windows 打包脚本调用 |
| Windows 原生启动及资源采样 | `check-windows-host.ps1`，仅允许全新 GitHub Actions runner；输出 `build/windows-diagnostics/resources.json` |
| 分发文档与依赖许可 | `distribution-docs.ts`，由两端打包脚本复制文档、中英文项目协议与许可 |
| 图标处理 | `npm run build:icon` → `build-icon.ts` |
| README 原生桌面截图 | `python3 scripts/prepare-readme-desktop.py` 编译独立 AppKit 副本与 `capture-readme-desktop.swift`；端口 17402、临时数据库、全部模拟数据，详见[截图记录](../docs/verification/README-DESKTOP-2026-11-15.md) |
| 临时学习界面预览 | `node --import tsx scripts/preview-study-ui.mjs`，先构建网页；模拟数据，无账号或模型 Key |
| 手机通知界面检查 | `node --import tsx scripts/check-mobile-notifications.mjs`，先构建网页；使用内存凭据和模拟推送 API，不发邮件或访问真实账号 |
| 选课与学习界面检查 | `node --import tsx scripts/check-study-course-ui.mjs`，先执行 `npm run build:web`；仅使用临时数据库与模拟进度 |
| U校园学习界面检查 | `node --import tsx scripts/check-unipus-study-ui.mjs`，先构建网页；独立确认、播放配置、计时查询，不启动学习进程 |
| 主设置分类检查 | `node --import tsx scripts/check-main-settings.mjs`，先构建网页；五组分类、浅深主题、窄窗口、键盘和保存失败重试，仅使用临时数据 |
| 本地模拟实验 | `npm run experiment` → `experiment.ts`，使用临时数据库 |
| 源码后台 | `npm run background`／`npm run stop` → `background.ts` |
| 开发用自启动 | `autostart.ts`；不用于安装包登录自启动 |

测试入口为 `npm run typecheck`、`npm test`。完整构建命令与系统要求见[项目 README](../README.md)和[Windows 说明](../docs/guides/WINDOWS.md)。脚本与配置路径保持稳定，历史文档移至 `docs/verification/` 和 `docs/planning/`。

- `distribution-docs.ts`：两端安装包保留文档及许可文本，不复制 `docs/screenshots/` 和 `docs/images/`；仅在随包 Markdown 副本中将图片链接改为对应版本标签的在线地址，仓库原文保持相对链接。
- `build-server.mjs`：清理生成目录后编译服务端，防止移除模块残留在安装包。
- `check-platform-removal.mjs`：使用虚构数据检查平台移除后的普通任务及五个平台入口。

- `node --import tsx scripts/check-study-playback.mjs`：虚构数据验证主界面的当前播放进度、暂停／继续及上下节请求，截图覆盖 1060／820／390／320px 两种主题。
- `node scripts/check-native-study-preview.mjs`：在 macOS 编译生产悬浮窗视图的隔离测试入口，以虚构课程检查单／双平台布局、控件回调及状态更新。不会启动真实后台或读取账号。

- `node --import tsx scripts/check-study-model-ui.mjs`：验证模型独立面板、外部点击、关闭重开草稿、模型列表、错误保留输入、本地 Skill 确认，以及 1060／820／390／320px 浅深主题。
- `node --import tsx scripts/check-study-chapters.mjs`：验证章节展开／收起、嵌套小节、起点、暂停时切换、锁定状态、学习卡片与目录顶部对齐、主区域更宽，以及嵌套列表上下边缘的主窗口滚动。

- `node --import tsx scripts/check-study-tasks-model-ui.mjs`：使用模拟状态验证直接检测、视频／检测状态、实时输出、思考滑杆键盘操作、最高档渐变、运行中保存及浅深主题和窄屏边界。


- `npx tsx scripts/check-study-focus-keepalive.mjs`：隔离检查登录与免责确认的焦点样式、U校园无需模型的后台保活请求，覆盖 1060／820／390／320px 浅深主题；不连接真实平台或模型。
- `npx tsx scripts/check-study-chapters.mjs`：包含桌面学习卡片与目录上下等高断言、窄窗口堆叠、层级展开及滚动传递。
- `npx tsx scripts/check-study-tasks-model-ui.mjs`：检查视频与检测状态、直接检测、实时输出以及思考强度控件已移除。

- `node --import tsx scripts/check-browser-settings.mjs`：检查桌面与普通网页浏览器选择、保存、1060／320px 浅深主题；仅使用本地虚构数据，不启动平台窗口。
- 从构建 26 起所有分发包均不带浏览器，不接受 `--bundle-browser`。0.2.33 及之前的安装包文件名带构建号；0.2.34 起只使用版本号，旧包在本地归档保留。

- `node --import tsx scripts/check-automation-notice.mjs`：检查两平台新版用途说明、未勾选禁用、旧确认失效、模型保留、本机确认记录及 1060／390／320px 浅深主题；仅使用临时数据库，不连接教学平台、不调用模型、不启动任务。截图位于 `docs/screenshots/automation-notice-2026-11-15/`。
- `node --import tsx scripts/check-app-updates.mjs`：使用模拟 Release 元数据检查桌面与普通网页的自动检查开关、保存失败恢复、手动检查、下载地址、更新说明纯文本及 1060／390／320px 浅深主题；不下载、安装或连接外部服务。

### 桌面版本号

0.2.34 起，`version` 使用主版本、次版本和补丁版本，界面、发布名及安装包不附加构建号。例如 `CourseWatch-0.2.34-mac-arm64.dmg`、`CourseWatch-0.2.34-win-x64-setup.exe`。`desktopBuild` 仅用于系统内部包元数据，与补丁版本不再强制相等。更新时同步 macOS Info.plist、Windows 项目与 manifest、package-lock.json。`tests/desktop-version.test.ts` 检查元数据、当前文件名和历史文件名。已有同名安装包或校验文件仍会阻止打包，修订须递增补丁版本，不覆盖旧包。

`node scripts/check-first-run-macos.mjs` 使用生产协议弹窗代码和独立偏好域，检查确认、拒绝、关闭、重启及缺失协议，并输出桌面／紧凑、浅色／深色原生截图。`dotnet run --project tests/windows/AgreementChecks.csproj -c Release` 使用临时目录检查 Windows 协议确认记录；不写真实用户数据。

Windows 启动与关闭设置另有 `dotnet run --project tests/windows/PreferencesChecks.csproj -c Release`，使用临时目录和启动项替身，不修改当前用户的开机启动项。

`dotnet run --project tests/windows/ConsentLayoutChecks.csproj -c Release` 检查原生协议弹窗的普通／窄尺寸、浅深配色、文字边界、正文滚动与明确同意／退出操作。加 `-- --dpi96` 检查 100% 缩放，默认使用系统 DPI。截图和结果写入 `.cache/windows-consent34/`；确认记录位于临时目录，不启动后台。

历史 Windows 修订支持 `windowsRevision` 和 `-rN`；0.2.34 起修订递增补丁版本，不再追加该后缀。

`npm run build:web` 后运行 `node --import tsx scripts/check-windows-ui.mjs`，使用临时数据库、虚构课程与原生通信替身检查 Windows 主设置、课程管理、学习任务、模型面板和平台窗口，同时对照 macOS 共用页面。另检查 Windows 设置分类切换尺寸不变、主题选择后的网页模式及原生通信。截图输出到 `.cache/windows-ui30-r2/`；不会登录平台、启动学习或修改开机启动项。

Windows 后台生命周期检查使用临时数据目录及空闲端口，通过 `COURSEWATCH_SERVICE_PORT` 指定后台端口，不占用已运行应用的 17321 端口；Windows 外壳始终为自己的后台固定该端口为 17321。

## Mac 资源与功耗采样

`python3 scripts/measure-macos.py`：先完成网页及服务构建，创建独立应用身份、端口 17401、临时数据库和 100 条模拟日程。用生产 AppKit 代码测前台、最小化及关闭窗口，每状态预热 15 秒后采样 120 秒。普通用户权限读取进程责任归属，纳入 WebKit／视频解码辅助进程。加 `--with-power` 时才通过系统授权运行有限次数的 `powermetrics`；不修改 sudoers、账户或应用权限。原始系统诊断留在 `.cache/macos-performance`，公开 JSON 只含汇总值。完成后诊断退出并清除 sudo 缓存；不会停止已运行的用户课程任务。重复测量前移走旧缓存目录，保留历史结果。`COURSEWATCH_MEASURE_SECONDS` 可设 30–600 秒。
