# Windows 0.2.30 界面检查

日期：2026-11-14。基准：`origin/main` 的 `298ff3d`，0.2.30／构建 30。界面审核后，按用户要求生成 Windows x64 安装程序和便携包，历史安装包及校验文件保留。

## 文字对齐与打包补查

- 学习方式标题与选项容器分离，保留 8px 间隔；课程选择框统一为 44px，工具栏标题和数量按基线对齐。18 组界面检查增加按钮文字边界、标题与选项间隔、三项选择等高对齐的断言，均通过。
- Windows 11、150% 缩放的 WebView2 独立宿主再次检查通过，更新下方原生截图。49 个测试文件、303 项测试及 16 项 Windows 设置检查通过。
- `npm run build:win` 已生成 `dist/CourseWatch-0.2.30-build30-win-x64-setup.exe`、`dist/CourseWatch-0.2.30-build30-win-x64.zip` 和各自的 SHA256 文件。安装包不附带浏览器，调用本机 Chrome／Edge。
- 包内认证边界、令牌撤销、来源过滤、API、SQLite、网页、通知队列、采集子进程、当前用户 DPAPI 虚构数据往返，以及本机浏览器有窗口／无头启动检查通过。后台使用临时目录和空闲端口，命令与管道关闭两种退出检查通过；未中断现有应用。
- 上游 284 个文件按原始字节校验通过。Git 对整个上游目录禁用换行转换，原版权、许可文件及校验清单保持不变。
- 构建日志提示 4 项界面依赖缺少随 npm 包分发的原始许可文本，名称及已声明许可记录在包内 `resources/UI-LICENSES/INDEX.txt`。未据此声明完成依赖许可审计。

## 修改

- Windows 复用当前 macOS 的课程管理、学习任务、章节目录、模型面板和五类设置；没有保留旧版设置面板。
- 左栏与内容区独立显示，圆角 18px，中间间隔 10px，外边距 12px。背景使用 Mica 并加深底色；Mica 采样壁纸，任务、设置及表单使用不透明背景。系统材质不可用、减少透明度或高对比偏好下使用实底。
- 多平台侧栏使用 44px 图标、56px 平台按钮和 6px 间距；导航可以滚动，通知与设置固定在底部。主区、章节、课程列表和表单使用相同的细滚动条。
- 最小化和关闭按钮相邻，移除额外的系统标题栏，保留原生八向缩放；长平台名与操作分行显示，文字完整保留。
- 首次打开分别询问后台运行和开机启动，首次关闭询问隐藏或退出，可记住选择；入口位于“设置 → 通用 → 窗口与启动”。开机启动默认关闭，保存成功后才注册。
- 平台窗口初始 660×700，最小 480×520；主窗口初始 1060×720，最小 820×600。尺寸以 CSS 客户区为准，首次显示不超出屏幕可用区域。
- 为带 SHA256 校验的源码和上游目录文件指定 LF 换行，保留原始代码和校验清单。修正服务端编译脚本在 Windows 将 `/D:/…` 误作文件路径的问题，使用 `fileURLToPath`。

## 已执行

| 检查 | 结果与范围 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | 49 个文件、303 项通过；含 5 个受保护文件及 9 处入口校验 |
| `npm run build:web`、`npm run build:server` | 通过；只编译代码，不装配分发包 |
| `dotnet build apps/windows/CourseWatch.csproj -c Release` | 通过，0 警告、0 错误 |
| `dotnet run --project tests/windows/PreferencesChecks.csproj -c Release` | 16 项通过；使用临时目录及启动注册替身 |
| `node --import tsx scripts/check-windows-ui.mjs` | 18 组通过：Windows 主界面 1060／820／390／320px，macOS 桥接替身 1060px，Windows 平台窗口 660／480／390／320px，均含浅深主题 |
| 补充页面交互 | 24 组既有布局检查、8 组启动与关闭检查通过：保存失败重试、焦点范围、取消关闭、记住与不记住、恢复设置、相邻按钮和八向缩放消息 |
| Windows 11 WebView2 独立宿主，150% 缩放 | 生产窗口和设置存储代码通过首次设置、最小化草稿恢复、八向边缘命中、820×600 调整、取消关闭、托盘与退出分支；平台窗口通过 480×520 调整，底部按钮可见 |

新增页面脚本使用临时数据库和虚构课程，检查根页面及表单溢出、长标题与工具栏操作分离、课程列表固定保存区、五类设置、嵌套启动对话框、两平台学习卡片与目录上下对齐、模型面板底部操作和窄窗口平台编辑。macOS 对照运行于 Chromium，不是本轮 macOS 实机截图。

原生宿主使用生产 `DesktopWindow.cs` 的副本，仅替换测试服务端口；后台、通知和启动注册使用替身。实际开机启动项及用户数据库未修改，未登录平台、启动真实课程或请求模型。

## 截图

以下 Windows 原生截图来自上述独立 WebView2 宿主，课程标有“模拟”。

| 界面 | 截图 |
| --- | --- |
| 主窗口 | [浅色](../screenshots/windows30-main-light.png) |
| 学习任务与章节 | [浅色](../screenshots/windows30-study-light.png)、[浅色滚动后](../screenshots/windows30-study-details-light.png)、[深色](../screenshots/windows30-study-dark.png) |
| 设置 | [通用](../screenshots/windows30-settings-light.png)、[手机通知深色](../screenshots/windows30-notifications-dark.png) |
| 启动与关闭 | [首次启动](../screenshots/windows30-startup.png)、[关闭选择](../screenshots/windows30-close-dark.png) |
| 平台窗口 480×520 | [浅色](../screenshots/windows30-platform-small-light.png)、[深色](../screenshots/windows30-platform-small-dark.png) |

浏览器中补查的截图：[课程管理](../screenshots/windows30-courses-light.png)、[320px 设置](../screenshots/windows30-settings-320.png)。完整页面截图及结果 JSON 输出在 `.cache/windows-ui30/`。

## 尚未验证

本轮在本机构建，未运行完整安装包 CI、安装、升级或卸载，未实测登录 Windows 后自动启动、真实通知展示、真实账号采集、真实学习运行及跨显示器 DPI 切换。系统字体和原生材质在 Windows 与 macOS 上由各自系统渲染；本轮检查确认共用布局与交互，不据此宣称像素完全相同。
