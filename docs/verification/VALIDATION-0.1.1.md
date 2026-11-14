# macOS 0.1.1 验证记录

2026-11-12，Apple Silicon、macOS 15.7.4、Swift 6.1.2、Node 24.22.1。

## 安装包体积

| 安装包                     |      字节 |    MiB |   相对旧包 |
| -------------------------- | --------: | -----: | ---------: |
| 0.1.0 Apple Silicon        | 406720621 | 387.88 |          — |
| 0.1.1 Apple Silicon 精简版 |  70258229 |  67.00 | 减少 82.7% |
| 0.1.1 Intel 精简版         |  71134565 |  67.84 | 减少 82.5% |

以上为 DMG 文件体积，不是运行内存或能耗指标。精简包不再内置 Chromium／Headless Shell／FFmpeg，只复用已安装的 Chrome 或 Edge 程序，以 CourseWatch 独立资料目录启动。不读取日常浏览器资料，也不自动下载浏览器。升级后首次使用需要重新登录。

另裁剪其他系统／架构的 SQLite 模块、SQLite 编译源文件、依赖测试／示例／源码映射和 CLI 通知助手。Mac 通知仍由原生 UserNotifications 投递。可选 `--bundle-browser` 构建只复制一套完整 Chromium，前台登录与无头采集共用；本次交付并验收的是两份精简包。

## 检查结果

- `npm run typecheck` 通过；`npm test`：6 个文件、32 项测试通过，新增 Chrome／Edge 路径选择、缺少浏览器提示、离线版单浏览器模式检查。
- `npm run build:mac:all` 通过。分别生成 arm64 和 x64 包；`lipo` 确认每个包内的原生外壳、Node、SQLite 模块均含目标架构。Intel Node 从 nodejs.org 下载并与官方 SHA256 清单核对。
- 两份包内 Node 均实际执行 SQLite 查询；Intel 运行通过 Rosetta。两份安装包均通过严格签名校验、DMG 校验，附 SHA256 文件。签名仍为 ad-hoc，未完成 Apple 开发者签名与公证。
- 逐个只读挂载最终 DMG，从 `/Volumes/CourseWatch` 内直接运行集成检查，避免依赖源码目录的 node_modules：API、SQLite、静态页面、本地实验基线／新增／清理、原生通知队列、采集子进程均通过。检查数据使用临时目录，结束后清除。
- Apple Silicon 主窗口和平台管理正常显示 0.1.1；独立 Chrome 登录窗口启动成功，取消后登录状态清空、独立浏览器及采集进程退出。没有输入真实凭据。后台挂起时 AX 树只保留静态 image，回前台恢复界面。
- 从最终 Intel DMG 启动的原生窗口在 Rosetta 下正常加载 0.1.1 主界面与平台管理，保留原生窗口按钮、加宽侧栏、左右分离材质和菜单栏。
- 双架构 GitHub CI 配置已更新；没有推送或触发远端 CI，不能将本机结果表述为远端 CI 已通过。

## 边界

两个包均要求 macOS 14+。Intel 版已交叉编译，并在 Apple Silicon 上用 Rosetta 运行，**尚未在 Intel 实机验证**；Intel 平台登录流程本次未确认完成端到端操作，仍需实机核对。Edge 备用路径通过测试，本机实际打开的是 Chrome。

真实平台全量分页、完整课程／考试覆盖、系统通知横幅、长期稳定性和整机功耗仍待实测。源代码 CLI 通知路径保留，未纳入本次 Mac 包验收。0.1.0 的历史验证和资源采样见 [旧版记录](VALIDATION.md)。
