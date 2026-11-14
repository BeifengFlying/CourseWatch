# README 原生桌面截图记录

日期：2026-11-15。界面版本：0.2.31（构建 31）。拍摄环境：MacBook Pro、macOS 15.7.4、原生 AppKit 外壳与 WKWebView。截图中的 macOS 27 Golden Gate 壁纸不代表拍摄系统版本。

## 数据与验证范围

截图使用独立应用身份 `top.mcsog.coursewatch.readme`、本机端口 17402 和全新临时数据库。雨课堂、学习通、U校园课程与任务、个人日程、章节状态、播放位置、通知记录和模型输出均为模拟数据，无真实账号、会话或模型 Key。设置页面不填写邮箱凭据，不连接真实设备或日历。

网页资源、原生主窗口和菜单栏预览采用项目代码；学习状态、模型输出和原生摘要由本地 fixture 返回。截图用于展示界面，不构成真实平台同步、课程学习、模型调用、通知投递或跨设备日历同步的验证。README 中的手机测试邮件照片为已有素材，不属于本次桌面拍摄。

## 桌面与取景

拍摄在独立 macOS Space 中进行。演示应用自己的无边框背景窗口显示壁纸，覆盖该 Space 中的桌面图标与组件，不修改全局组件开关、Dock 或系统菜单栏设置。未重置用户日常桌面，也未关闭正常运行的 CourseWatch。

使用 ScreenCaptureKit 的显示器捕获，仅包含隔离演示应用及其壁纸背景窗口；系统菜单栏、Dock、其他应用和光标不进入图片。主窗口取景保留四周壁纸，不沿软件边缘紧裁。菜单栏预览图保留原生浮层及周围壁纸，排除主窗口与状态栏图标。原生预览沿用系统外观，网页深色主题仅在临时数据库中切换。

图片为本机原生窗口的实时捕获，无网页截图替换、窗口内容拼接或 AI 生成。部分学习页滚动到卡片区域，以展示完整学习控制和章节目录。拍摄结束已退出演示应用及背景窗口；进程检查未发现残留演示进程，Space 记录显示当前桌面为原桌面 ID 1。独立 Space 保留。

## 壁纸来源

- 来源：[Basic Apple Guy — macOS Golden Gate Wallpaper](https://basicappleguy.com/haberdashery/macosgoldengate)，页面标注为 macOS 27 Golden Gate Beta 1 壁纸提取。
- 下载：[GoldenGate_6k.png](https://basicappleguy.com/s/GoldenGate_6k.png)。下载原图为 6016 × 4147；本地缓存名为 `.cache/readme-desktop/macos27-golden-gate.png`。
- 背景窗口按显示器尺寸铺满；原始壁纸缓存不进入仓库。壁纸为 Apple 素材，项目许可不覆盖该素材，未单独分发原图。

## 复现入口

1. 在 macOS 安装 Xcode Command Line Tools 与项目依赖，执行 `npm run build:web`、`npm run build:server`。
2. 将上述壁纸保存到 `.cache/readme-desktop/macos27-golden-gate.png`。
3. 执行 `python3 scripts/prepare-readme-desktop.py`。该脚本编译隔离应用与截图工具，不启动应用，不创建 Space，也不修改系统桌面设置。
4. 在专用 Space 打开 `.cache/readme-desktop/CourseWatch Demo.app`。主窗口尺寸约 1200 × 843 逻辑像素，左上角位置为 `{156,75}`；本次显示器为 1512 × 982 逻辑像素。
5. 通过界面切换页面，执行 `.cache/readme-desktop/capture-readme-desktop OUTPUT.png`。主窗口固定取景为 `{56,48,1400,910}`；不同显示器需调整取景。
6. 打开隔离应用的原生菜单栏预览，执行 `.cache/readme-desktop/capture-readme-desktop OUTPUT.png --preview`。工具按浮层位置取景，并排除主窗口及状态栏图标。
7. 退出演示应用；临时数据路径由准备脚本输出，确认应用退出后可移除。

模拟数据入口：[`scripts/preview-readme-desktop.mjs`](../../scripts/preview-readme-desktop.mjs)。编译入口：[`scripts/prepare-readme-desktop.py`](../../scripts/prepare-readme-desktop.py)。截图源码：[`scripts/capture-readme-desktop.swift`](../../scripts/capture-readme-desktop.swift)。

## 文件与检查

共 16 张 PNG，目录为 `docs/screenshots/desktop-build31/`。已目视检查模拟内容、窗口边缘及壁纸留边；已检查 README 本地图片路径。网页与服务构建完成；新增 fixture 通过 Node 语法检查，准备脚本通过 Python 语法检查，截图工具通过 Swift 编译。未以这些检查替代平台或通知实测。

| 文件 | 像素尺寸 | SHA-256 |
| --- | --- | --- |
| `courses-light.png` | 2800 × 1820 | `a4150107219dfadc70f4609a988b120ca4245a52108a1feac2ea4aaa30ca794b` |
| `main-light.png` | 2800 × 1820 | `986bb4267d57b3cdb3ddd1b6b0d712e19b52ed2957a117b844dd1ced7fd819a2` |
| `native-preview-light.png` | 1000 × 1380 | `31f029ca98490a1310d2896b258edfa6a032b85c9ce79ad1f704545c9975c141` |
| `notifications-light.png` | 2800 × 1820 | `ac08d63e6947260d5c54ee2f5a714645944d827fd7cefb9980c7ee045995bc99` |
| `reminder-editor-light.png` | 2800 × 1820 | `70dd0a88d4b668a7ec5ed77236ef867c27d11e4e53220fd785e6aa729b6ee33e` |
| `schedule-editor-light.png` | 2800 × 1820 | `56b00b67c6302ee2c80713a0687b07feafb802fd53bc8a83d1f42a3fdf8c1046` |
| `schedules-light.png` | 2800 × 1820 | `8e707bd1994d6bd6b66c1c95d91ff2f6d4f2efa8da45ea0e145fde428d5b907b` |
| `settings-calendar-light.png` | 2800 × 1820 | `b042ecc86649e43dcfa7678aa0571a4d6294a86e8a7d531bbf51a74c87eb72d0` |
| `settings-data-light.png` | 2800 × 1820 | `92e2905dfdacc0db68dfecdd19e04b142a7fa731e39ce5e6255dc62a3e2f770c` |
| `settings-general-light.png` | 2800 × 1820 | `89c9e05f35e54a9fbdebdabff471bda0b2dd292c76b7dc6767ae05ff227f492f` |
| `settings-mobile-light.png` | 2800 × 1820 | `ea7e118d6249e242af362660a8e2918c1f5c7373e71ea0f6a4390788193f8359` |
| `settings-reminders-light.png` | 2800 × 1820 | `ae79386e4df84e6caddf8394aaf8a6abe1c2b88ae8c1326da2ade8b998de8dc6` |
| `settings-study-light.png` | 2800 × 1820 | `208d35c334a6d736834ec1f0a6d2dd771401a26bde810ece63f35f0af88e5e8a` |
| `study-chaoxing-dark.png` | 2800 × 1820 | `99ea41541303f25e59b88d239b1e860c767f1a72bd84f9420a7a9e7fdfda04cf` |
| `study-chaoxing-light.png` | 2800 × 1820 | `f4b94f09763bb12b88aa0e6a0193fcefe3966e7722eda39520561bba2a25f874` |
| `study-unipus-light.png` | 2800 × 1820 | `7f229a80018d137b46fe68d70f7a326b45feb7090eb4129a3d7738978a2322eb` |
