# Windows 桌面版

目标为 Windows 10+ x64，最低 Windows 10 2004（内部版本 19041），建议使用 22H2 或更新版本。Windows 10／11 均待实机验收，不能把交叉编译或 CI 构建成功作为桌面功能已通过验收的结论。

外壳的 `SupportedOSPlatformVersion` 与安装器的 `MinVersion` 均以 19041 为最低内部版本。此安装门槛自当前源码构建生效；历史安装包仍使用各自的系统限制。

## 界面与操作

当前源码版本为 0.2.33／构建 33，Windows 修订号为 0。新包使用独立构建号文件名，不覆盖原安装包。本次发布尚未构建 Windows 安装包；以下文件名用于源码构建。合并检查见 [Windows 0.2.31](../verification/WINDOWS-0.2.31-MERGE.md)；此前原生窗口与安装包检查见 [Windows 0.2.30 修订 2](../verification/WINDOWS-0.2.30-R2.md)，该历史包不包含合并后的全部改动。

Windows 与 macOS 使用同一个 `Desktop.vue`、表单和样式文件。Windows 右上角的最小化与关闭按钮相邻排列；横线最小化到任务栏，叉号请求关闭。窗口可以拖动位置，不能拖动边缘调整大小，不提供最大化按钮。

首次打开时询问后台运行与开机启动，两项分别选择，开机启动默认关闭。保存后生效，可在“设置 → 通用 → 启动与后台”修改。开启开机启动后，登录 Windows 时启动 CourseWatch；同时开启后台运行时进入托盘，否则打开主窗口。

首次关闭主窗口时询问“隐藏到系统托盘”还是“退出 CourseWatch”，可取消或记住选择。隐藏后继续检查任务和提醒，退出后停止后台。在“设置 → 通用 → 关闭窗口时”可改为每次询问、隐藏或退出。平台设置窗口直接关闭，不退出应用。

平台设置继续使用独立窗口。通知、托盘与系统设置使用 Windows 对应接口，相关说明按系统显示。窗口关闭整窗原生背景材质及框架，使用页面内的磨砂样式；系统字体与边缘显示结果仍需在目标系统核对。

主窗口固定 1060×720，平台窗口固定 660×700，单位为 96 DPI 下的逻辑像素；系统缩放时按比例转换。屏幕工作区不足时缩小到可用范围，再锁定尺寸。设置面板宽 680px、高 600px，受窗口可用范围限制；切换分类时尺寸不变，正文内部滚动。

窗口按侧栏和内容区的实际圆角轮廓裁切；外边距和两栏间隙直接显示桌面，不绘制整窗底板、原生描边或矩形阴影。窗口内部使用不透明 WebView2 背景，保留页面内的磨砂样式与圆角。

“设置 → 通用 → 主题”可选择跟随系统、浅色、深色。选择自动保存到应用设置，重新打开后保留；原生 WebView2 首选配色同时控制网页媒体查询和表单控件。

## 运行与数据

- 外壳：C# / WinForms / WebView2。业务后台仍是 Node / Fastify / SQLite，不在 C# 中复制采集或提醒逻辑。
- 默认包包含 x64 Node 24.22.1、对应 SQLite 模块和 .NET 10 运行时，不附带浏览器；平台操作使用已安装的 Chrome／Edge 和独立资料目录。从构建 26 起移除带浏览器的打包选项。可在“设置 → 通用”选择自动、Chrome 或 Edge。
- 界面还需要 Microsoft Edge WebView2 Runtime。安装程序会检测并在缺失时调用微软引导程序联网安装；便携包用户需先安装该运行时。WebView2 用于本地界面，本机 Chrome／Edge用于平台登录和采集，两者用途不同。
- 默认安装到 `%LOCALAPPDATA%\Programs\CourseWatch`，数据放在 `%LOCALAPPDATA%\CourseWatch`。安装目录和数据目录分离，卸载默认保留数据。
- 平台会话快照使用当前 Windows 用户的 DPAPI；数据库和浏览器资料目录不承诺整体加密。DPAPI 文件不能直接当作跨系统或跨账号的登录迁移包。
- `webview2` 子目录保存界面运行数据，包括本地配对状态；平台登录使用另外的独立资料目录，不读取日常 Chrome / Edge 的 profile。
- 默认不注册登录自启动。用户保存“开机启动”后，写入当前用户 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 下的 `CourseWatch` 值，指向当前可执行文件；关闭该选项或卸载时移除此值。便携版移动路径后需重新保存设置。源码 `scripts/autostart.ts` 的计划任务仍为开发用途。
- `desktop-preferences.json` 保存首次设置状态、后台运行、开机启动及关闭方式；这些设置不上传。
- 当前没有自动更新和 Windows 发布者签名。升级前退出应用；安装程序会请求退出旧实例。旧的 CLI 后台需自行停止。

## 只使用 Mac 开发

Mac 可以编辑全部代码、构建共享网页、执行类型检查和单元测试，也可以交叉发布 Windows 外壳：

```sh
npm ci
npm run typecheck
npm test
npm run build:web
dotnet publish apps/windows/CourseWatch.csproj -c Release -r win-x64 --self-contained true -o build/windows-cross-check
```

需要 .NET 10 SDK。最后一条只发布外壳，不会装配 Node、SQLite 或生成安装程序；产物不能当作完整应用交付。

完整 Windows 包使用 `.github/workflows/windows.yml`，可通过推送 `codex/windows-*` 分支、相关拉取请求生成；手动触发需工作流已存在于默认分支。Windows runner 执行：

1. 安装 Node 24.22.1、.NET 10 SDK 和项目依赖。
2. 类型检查、单元测试；测试用 Chromium 单独下载，不进入安装包。
3. 构建共享前端、后台和 Windows 外壳；装配目标系统原生依赖。
4. 检查 PE x64 架构、包内 SQLite、本地 API、认证、DPAPI、本机 Chrome／Edge 启动和后台退出。
5. 使用 Inno Setup 6 生成用户级安装包，再生成 ZIP、SHA256 并上传 Actions artifact。

在 GitHub Actions 的 **Windows desktop package → coursewatch-win-x64** 中下载产物：

- `CourseWatch-0.2.34-win-x64-setup.exe`：安装程序。
- `CourseWatch-0.2.34-win-x64.zip`：便携包，解压后运行其中的 `CourseWatch.exe`。
- 对应的 `.sha256`：文件一致性校验值。同渠道校验文件不能独立证明发布者身份。

请选择包含本轮修改的成功运行；产物以该运行实际上传的文件为准，旧运行的文件名和功能可能不同。

在 Windows 开发环境中构建：

```powershell
npm ci
npm run browser:install
npm run build:win
```

需要 .NET 10 SDK、Inno Setup 6；可通过 `COURSEWATCH_ISCC` 指定 `ISCC.exe`。`npm run build:win -- --skip-installer` 只生成便携包。当前不提供 Windows ARM64；默认构建不附带浏览器。

## 实现边界

外壳只允许本地页面调用列出的消息操作；界面不能通过消息执行任意命令。浏览器弹窗只允许官方 HTTPS 平台地址，通用外链限制为 HTTPS。启动时生成原生令牌，通过环境传给后台并在本地页面初始化，沿用后台的原生 API 认证。

单实例通过当前用户互斥体和用户限定命名管道处理。通知点击向运行实例传递事项 ID，冷启动时保留待定位事项。后台由外壳通过私有标准输入管道关闭，外壳管道断开时后台也退出；超时才终止进程树。没有新增 HTTP 退出接口。

窗口失去前台后停止界面轮询并请求 WebView2 低内存模式，保留可见页面以减少切换时重新加载。最小化或隐藏后保存草稿并释放控件，恢复时还原草稿；关闭主窗口也释放页面。忙碌或无法取得快照时暂时保留页面。资源统计范围、后台工作和能耗限制见[资源占用说明](RESOURCE_USAGE.md)。

## 验证范围

最新窗口检查见 [Windows 0.2.30 修订 2](../verification/WINDOWS-0.2.30-R2.md)，历史记录见 [Windows 构建与验证记录](../verification/VERIFICATION-WINDOWS.md)。Windows 10 的原生界面仍待实测；首次安装、WebView2 缺失安装、真实通知展示与点击、托盘悬停、跨显示器 DPI 切换、休眠恢复、真实平台登录采集、升级及卸载仍需实测。没有执行的项目不能标为通过。
