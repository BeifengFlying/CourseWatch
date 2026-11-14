# 构建 26：浏览器权限与浏览器切换

日期：2026-11-14。版本 0.2.0，构建 26。本机打包，保留 Applications 中的旧应用与已有安装包，不发布线上版本。包含构建 25 的全部当前源码改动。

## 权限原因与处理

截图对应 14:14:21 的系统记录中，实际访问者为本机 Chrome，责任应用为 CourseWatch；AppBundles 实际授权请求被拒绝。临时签名与旧授权记录不匹配也出现在同一记录中。

Chromium 的 MacAppCodeSignClone 功能为更新保留应用签名副本。受管浏览器启动时增加 `--disable-features=MacAppCodeSignClone`，覆盖登录、无头采集、目录、会话检查及学习窗口；不修改系统权限，不改写本机 Chrome 或 Edge。参考 [Chromium 源码](https://github.com/chromium/chromium/blob/main/chrome/browser/mac/code_sign_clone_manager.mm)。系统记录没有给出原始被修改文件路径，因此不将具体目标文件作为已证实结论。

使用全新临时原生 app 身份 `top.mcsog.coursewatch.browsercheck26`，经 Launch Services 启动当前 Node、Playwright 及修复后的参数。用临时 profile 和本地 HTML 分别检查无头、登录窗口、可恢复的最小化学习窗口，三种均完成启动、渲染及关闭。测试期间 14:54:42–14:54:52 的系统日志仅有一次 AppBundles `preflight=yes` 查询，没有实际请求 `preflight=no`，也没有该权限的拒绝记录。未读取真实课程或提交答案。此验证仅适用于本机当前 Chrome，不保证未来浏览器版本均不再触发其他维护行为。

## 浏览器选择与包策略

- 主界面设置的通用分类、普通网页设置均提供原生选择框：自动选择（优先 Chrome）、Google Chrome、Microsoft Edge。
- 设置保存在本机数据库，服务重启后保留。旧设置默认自动选择；明确指定而未安装时提示安装或切换，不静默回退。自动选择会检查系统和用户安装目录。
- 登录／扫描、课程目录、学习三个子进程入口分别读取当前选择，既有窗口不被关闭或重载。切换后可能需要重新登录，始终使用应用独立 profile。
- macOS 和 Windows 移除复制浏览器的分支与构建参数，包内检查拒绝 browsers 目录。开发测试安装的 Chromium 不进入安装包。规则同步项目 AGENTS.md，CI 仅生成不带浏览器的包。
- 新安装包使用 desktopBuild 及独立文件名；保留先前 DMG 及 SHA256，不替换正在运行的旧应用。

## 检查记录

- 类型检查通过；完整测试 44 文件、288 项通过，随后新增的登录／采集／目录子进程选择回归与相关设置、学习窗口测试共 5 文件 46 项通过。
- 主设置五分类、1060／820／390／320px、浅深主题、键盘及保存失败重试检查通过。
- 浏览器选择在桌面与普通网页中逐项保存为 Edge、Chrome、自动；1060／320px、浅深主题均无横向溢出。原生选择框与底部操作可见，查看桌面浅色及 320px 深色截图，文字完整。
- 带浏览器构建参数已实测拒绝；包内 Node／SQLite、本机浏览器有窗口与无头启动、本地 API 认证及应用深度签名检查通过。
- 受保护的学习逻辑及入口校验保持，不修改视频弹题、U校园保活实现或其保护清单。

## 限制

本机没有 Edge，Edge 与 Windows 的路径选择及子进程传递使用模拟验证，未做这两种浏览器的真实平台登录。未执行真实课程提交、模型调用、U校园官网学时核对或长时间后台运行。安装包仍使用本地临时签名，未完成 Apple 公证。

## 安装包结果

- macOS Apple Silicon：`dist/CourseWatch-0.2.0-build26-mac-arm64.dmg`，66,690,570 字节（63.60 MiB）。
- DMG CRC32 与应用深度签名检查通过；只读挂载核对根目录仅含 CourseWatch.app 和 Applications，构建号 26，无 browsers 目录。
- SHA256：`4bee0c1dbc1fb855bd7ff5f7f8d299b8e6b0568babc4de7ac62ffd9bf4c1af22`。
- 构建前记录的 8 个旧安装包及校验文件逐个 SHA256 比对相同。未替换 Applications 中的旧应用。
- Windows 打包脚本与 CI 已修改，本次仅生成本机 macOS arm64 安装包，未生成 Windows 或 Intel 安装包。
