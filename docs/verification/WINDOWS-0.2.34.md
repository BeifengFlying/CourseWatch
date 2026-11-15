# Windows 0.2.34 验证

日期：2026-11-15，Asia/Shanghai。基线：`4b10cc4` 的 0.2.34 源码，加入 Windows 协议弹窗适配。应用版本为 0.2.34，内部平台字段为 34，文件名不附加构建号。

## 界面与行为

- 主窗口固定 1060×720，平台窗口固定 660×700，按 DPI 换算。侧栏与内容区保持独立圆角，原生窗口区域裁掉外边距及两栏间隙，不绘制整窗底板和白框。
- 协议弹窗使用固定边框，尺寸受工作区限制；支持系统浅深配色，使用同一文字、正文和按钮区域布局。高对比度时保留系统颜色，未实测高对比度显示。
- 协议正文可滚动，免费声明、退款举报提示与项目地址保持直接可见，底部退出和同意按钮不随正文滚动。Enter 不默认同意，Escape 退出。接受、退出及布局检查只使用临时确认记录。
- 保留主题设置、首次后台与开机启动设置、首次关闭询问；启动项检查使用替身，不修改实际注册表。

## 本地检查

环境：Windows 11，实际桌面缩放 150%，Node.js 24，.NET 10。

- `npm run typecheck` 通过。
- `npm test -- --maxWorkers=2`：52 个文件、336 项通过。
- Windows 协议确认记录检查通过；启动／关闭设置 16 项通过。
- `ConsentLayoutChecks`：100% 与 150% 缩放各 4 个普通／窄尺寸、浅／深配色组合，每组 DPI 共 120 项检查通过。100% 使用 DPI unaware 测试进程，150% 使用实际 PerMonitorV2 桌面 DPI；不代表跨屏 DPI 切换已验证。
- `check-windows-ui.mjs`：18 组通过，覆盖浅深主题、1060／820／390／320px、设置、课程、学习、模型及平台面板。
- 当前 `DesktopWindow.cs` 的原生隔离宿主：主窗口托盘分支 64 项、退出分支 54 项、平台窗口 43 项通过。仅替换隔离端口和服务接口，使用虚构课程及启动项替身。检查固定大小、无最大化／拉伸、原生区域、白框及底板边界、浅深主题、重载保留选择和关闭选择。
- 窗口边界截图使用蓝色测试背景；边缘和栏间隙可见后方颜色。截图与原始结果保留在本地 `.cache/release34/` 和 `.cache/windows-consent34/`。
- 首次打包已通过 PE x64、SQLite、本地 API、认证边界、DPAPI 虚构会话、本机 Chrome／Edge 和后台 command／EOF 退出检查。上游 284 个文件及受保护的 5 个文件／9 处入口校验通过。

## 分发与验证边界

最终构建输入为 `e9dbededa1e59c9374b8079551b9cc711c64cd35`，发布标签 `v0.2.34-desktop` 指向该提交。原生程序文件版本为 0.2.34.0，产品版本包含该源码提交。

| 文件 | 字节数 | SHA256 |
| --- | ---: | --- |
| `CourseWatch-0.2.34-win-x64-setup.exe` | 82,634,971 | `dacd3e83cdff6625dc5af6b841bd4a23de3350e52177b0f6256d2fe5ffeb1cb7` |
| `CourseWatch-0.2.34-win-x64.zip` | 114,790,760 | `f89b5767f3935c16190fe0e96ea71ba20f9c377b0bf2b1d0b9128aed0cf81562` |

两份同名 `.sha256` 与最终产物匹配。ZIP 完整性检查通过，共 3438 项；包内协议与许可原文一致。最终 `npm run build:win` 及其包内集成检查通过，未执行安装程序。

安装包不附带浏览器、文档展示图或本地项目说明。第三方上游原文件保持完整，包含其自身文档与许可。当前四项界面依赖许可缺件继续记录于 `UI-LICENSES/INDEX.txt`：`css-render`、`@css-render/plugin-bem`、`@css-render/vue3-ssr`、`vdirs`。

本轮未替换已安装应用，未使用真实账号，未完成完整安装／升级／卸载、实际开机启动、真实通知、Windows 10、跨显示器 DPI 和休眠恢复检查。原生隔离宿主使用当前窗口源码，不等同于最终安装后的完整流程验收。

macOS 安装包沿用原 0.2.34 发布附件，摘要与原记录一致，未在 Windows 上重新构建 macOS。新发布标签为 `v0.2.34-desktop`；原不可变标签不能复用，软件显示版本仍为 0.2.34。

## 发布与原附件归档

[CourseWatch 0.2.34](https://github.com/BeifengFlying/CourseWatch/releases/tag/v0.2.34-desktop) 已发布为测试版，包含两个 macOS DMG、Windows 安装程序及便携 ZIP，以及四个对应的 `.sha256`，共 8 个附件。全部附件均完成未携带登录凭据的公开下载，字节数与 SHA256 和本地一致。新 Release 的 `immutable` 为 `false`。

原 `v0.2.34` Release 的 `immutable` 为 `true`，追加附件返回 HTTP 422；关闭仓库设置不解除既有 Release 的锁定。原四个 macOS 附件先归档至本地 `build/release-archives/v0.2.34-before-windows/` 并校验摘要，再在新 Release 下载核验通过后删除原 Release。原 Release 及四个附件 API 均返回 HTTP 404，源码标签 `v0.2.34` 保留以供追溯及随包展示图引用。
