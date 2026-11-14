# Windows 0.2.31 合并检查

日期：2026-11-14。合并基线：Windows 分支 `4812545` 与 `main` 的 `2b49ea6`。源码版本为 0.2.31、构建 31，Windows 修订号 2。

## 合并范围

- 保留 main 的默认点缀色、共用主题设置、模型空答案重做及 Windows 10 2004 最低安装版本。
- 保留 Windows 独立圆角窗口区域、无底板及白框、固定尺寸、相邻窗口按钮、启动与托盘关闭设置。
- 合并两处主题实现为“设置 → 通用 → 主题”。使用 `theme` 字段；旧 Windows `appearance` 设置在读取时转换为主题，已有 `theme` 优先。非法旧值回退至跟随系统。
- 保留 Windows WebView2 首选配色和原生深色模式同步，不恢复整窗背景材质。
- 中英文 README 与构建说明区分当前源码和已打包的 0.2.30 r2。

## 本地验证

环境：Windows 11、Node.js 24、.NET 10。测试使用临时数据和虚构课程。

- `npm run typecheck` 通过。
- `npm test -- --maxWorkers=2`：51 个文件、316 项通过，包含版本一致性、旧主题字段迁移、设置保存及 main 的学习回归测试。
- `npm run build:web` 通过。
- `node --import tsx scripts/check-windows-ui.mjs`：18 组 Windows／macOS 页面检查通过，覆盖浅深主题、1060／820／390／320px、设置分类、课程与学习面板、平台窗口和窗口按钮间距。
- `dotnet run --project tests/windows/PreferencesChecks.csproj -c Release`：16 项通过，未修改真实开机启动注册。
- `dotnet build apps/windows/CourseWatch.csproj -c Release`：0 个警告、0 个错误。
- 上游文件校验：284 个通过；受保护学习逻辑校验：5 个文件、9 处入口通过。

页面截图输出至本地 `.cache/windows-ui30-r2/`。目录名沿用检查脚本，截图使用合并后的 0.2.31 网页资源。

## 验证边界

本次未生成 0.2.31 Windows 安装包，未运行合并后的原生交互检查，也未替换已安装的应用。README 展示的 Windows 原生边界截图来自 [0.2.30 r2 检查](WINDOWS-0.2.30-R2.md)，不能作为合并后安装包验收结果。

Windows 10、完整安装／升级／卸载、实际开机启动、真实账号及通知、跨显示器 DPI 切换仍待实测。GitHub 构建与下载产物以对应 Actions 的实际结果为准。
