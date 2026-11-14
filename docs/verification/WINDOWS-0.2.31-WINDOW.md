# Windows 0.2.31 窗口检查

这是此前本地试包的历史记录。当前版本已按用户要求恢复为 0.2.30；后续底板、白框及显示模式修复见 [Windows 0.2.30 修订 2](WINDOWS-0.2.30-R2.md)。

日期：2026-11-14。基于 0.2.30，按用户要求移除窗口后方白色背景的材质承载层，并改为固定窗口尺寸。

## 修改

- 关闭 DWM 整窗 Mica，将 `DwmExtendFrameIntoClientArea` 的四边设为 0；WebView2 使用不透明底色，随浅深主题切换。侧栏保留页面内的磨砂样式与圆角。
- 主窗口固定 1060×720，平台窗口固定 660×700；按系统 DPI 换算，工作区不足时缩小并锁定。移除八向调整尺寸区域、原生缩放命中和缩放消息处理；保留拖动位置、最小化、关闭与托盘操作。
- Windows 设置面板固定 680×600px，受窗口可用范围限制；分类内容内部滚动。
- 经用户明确指定，删除 dist 中的 0.2.0 安装包、便携包及两份 SHA256 文件；保留 0.2.30 和用户已安装的版本，课程及设置数据不变。
- 新产物使用 0.2.31／构建 31，不覆盖 0.2.30。

## 验证

| 检查 | 结果与范围 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `dotnet build apps/windows/CourseWatch.csproj -c Release` | 通过，0 警告、0 错误 |
| `npm test` | 302 项通过、1 项版本元数据不一致；同步 macOS plist 与 Windows manifest 后，`tests/desktop-version.test.ts` 的 2 项复测通过，共覆盖 303 项 |
| `dotnet run --project tests/windows/PreferencesChecks.csproj -c Release` | 16 项通过；使用启动注册替身 |
| `node --import tsx scripts/check-windows-ui.mjs` | 18 组通过，含浅深主题、桌面和窄页面、设置分类切换尺寸不变及底部按钮可见 |
| Windows 11 原生 WebView2，150% DPI | 主窗口托盘分支 42 项、退出分支 40 项、平台窗口 33 项通过；含固定尺寸、禁止拉伸和最大化、首次设置、最小化恢复、关闭确认 |
| 原生窗口外部区域 | 主窗口和平台窗口的浅深主题使用蓝色测试底窗；四角和底部中点保持蓝色或原生阴影，没有出现白色矩形 |

原生宿主链接当前窗口代码的副本，仅将本地测试端口替换为 17329，使用虚构课程、启动注册替身及临时数据目录。检查结果保存在 `.cache/ui-review/native31-lifecycle-*.json`；测试不会登录平台、启动学习或写入用户启动项。

## 截图

- [主窗口浅色外部边界](../screenshots/windows31-exterior-main-light.png)
- [主窗口深色外部边界](../screenshots/windows31-exterior-main-dark.png)
- [平台窗口深色外部边界](../screenshots/windows31-exterior-platform-dark.png)
- [设置面板](../screenshots/windows31-settings-light.png)

## 分发文件

`npm run build:win` 已完成。安装包 85,030,287 字节，便携包 117,146,083 字节；均位于 dist，附带 SHA256 文件。包内构建信息为 0.2.31／31，ZIP 共 3440 项，完整性与当前前端资源核对通过，没有分发浏览器程序。

- 安装包：`CourseWatch-0.2.31-build31-win-x64-setup.exe`，SHA256 `ae618328c1304ea97031f64ede08db8e90f0ea982ebe277f9ec148c2d40228ed`。
- 便携包：`CourseWatch-0.2.31-build31-win-x64.zip`，SHA256 `450b5b6eeeb0436cbc90977163d6a25f6019b78828e43244912b8850eb5b76ff`。

打包检查通过：284 个上游文件校验、5 个受保护文件和 9 处入口校验、PE x64、包内 SQLite／网页／本地 API、原生认证、DPAPI 虚构会话、本机 Chrome／Edge 独立资料目录启动，以及后台通过命令与 stdin EOF 退出。当前已安装的 0.2.30 未替换，课程与设置数据未删除。

构建日志继续报告四个界面依赖的 npm 包缺少原始许可文件：`@css-render/plugin-bem@0.15.14`、`@css-render/vue3-ssr@0.15.14`、`css-render@0.15.14`、`vdirs@0.1.8`；包内 `resources/UI-LICENSES/INDEX.txt` 保留其许可声明及缺项记录。

## 尚未验证

未验证跨显示器 DPI 切换、真实账号、实际开机启动、完整安装／升级／卸载和真实系统通知；原生独立窗口检查不能替代这些验证。
