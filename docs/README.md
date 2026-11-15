# 文档目录

当前安装与使用以[项目 README](../README.md)为入口。历史方案与旧版记录仅适用于各自注明的版本和验证范围。

- [English README](../README.en.md) · [逐次构建更新](guides/BUILD_HISTORY.md) · [构建 30 验证](verification/RELEASE-0.2.30.md)

- [0.2.36 打包验证](verification/RELEASE-0.2.36.md) · [U校园目录与诊断](verification/UNIPUS-CHAPTERS-AND-DIAGNOSTICS-2026-11-15.md)

## 使用与开发

- [手机通知与 iCloud 日历](guides/MOBILE_NOTIFICATIONS.md)：双邮箱 SMTP、HTTPS 手机订阅页和 macOS 日历授权。

- [Windows 桌面版](guides/WINDOWS.md)：安装、数据目录、Mac 交叉编译、Windows 打包。
- [资源占用、能耗与后台运行](guides/RESOURCE_USAGE.md)：Mac／Windows 的页面与进程生命周期、调度频率、统计范围与方法和待测项。
- [文案规范](guides/WRITING_GUIDELINES.md)：界面、通知和项目文档的写法。
- [界面与交互规范](guides/INTERFACE_DESIGN.md)：按钮、表单、课程状态、材质、动效及验收要求。
- [数据与隐私](../PRIVACY.md)、[测试版限制](../DISCLAIMER.md)、[变更记录](../CHANGELOG.md)。

- [Mac 性能与芯片功率实测](verification/MACOS-PERFORMANCE-2026-11-14.md)：M1 Max、100 条模拟日程、三种窗口状态及独立功率读数。

## 验证记录

- [应用更新检查](verification/APP-UPDATES-2026-11-15.md)：公开版本比较、通知去重、手动下载入口和桌面／网页宽窄窗口验证。
- [实验功能用途与告知](verification/AUTOMATION-NOTICE-2026-11-15.md)：用途限制、数据发送、重新确认及本机记录。
- [0.2.34：首次打开协议与免费声明](verification/RELEASE-0.2.34.md)：原生弹窗、版本命名、打包及旧包下架。

- [构建 33 许可、文档与打包验证](verification/RELEASE-0.2.33.md)：Apache 原文与 TERMS 的组合形式、历史许可边界及实际验证范围。

- [README 原生桌面截图](verification/README-DESKTOP-2026-11-15.md)：模拟数据、壁纸来源、拍摄范围与复现入口。

- [手机通知验证](verification/MOBILE-NOTIFICATIONS-2026-11-13.md)：通知渠道隔离、配对、界面与尚未完成的真实设备验证。

- [U校园学习与本机计时](verification/UNIPUS-STUDY-2026-11-13.md)：独立执行器、默认关闭的练习自动提交、本机观察计时与模拟验证范围。

- [选课与学习界面修复](verification/STUDY-COURSE-UI-2026-11-13.md)：固定保存区、实验开关、学习通配置与只读进度。

- [课程管理与自动学习本机合并更新](verification/COURSES-STUDY-LOCAL-2026-11-13.md)：选课、移除恢复、提醒规则、设计及安装验证范围。

- [Windows 构建与验证](verification/VERIFICATION-WINDOWS.md)：云端检查与 Windows 10／11 实机缺项。
- macOS [构建 8 精简包](verification/VERIFICATION-BUILD8.md)、[构建 7 认证修复](verification/VERIFICATION-BUILD7.md)、[构建 6 平台和界面](verification/VERIFICATION-BUILD6.md)。
- [2026-11-12 页面与后台检查](verification/VERIFICATION-2026-11-12.md)、[认证修复说明](verification/SECURITY-FIX-2026-11-12.md)。
- 历史记录：[0.2.0 初版](verification/VALIDATION-0.2.0.md)、[0.1.1](verification/VALIDATION-0.1.1.md)、[初始验证](verification/VALIDATION.md)、[0.1.1 实验](verification/EXPERIMENT-0.1.1.md)。

## 方案与研究

- [0.2.34 计划](planning/RELEASE-0.2.34.md)：首次打开的用户协议、免费声明、项目地址及付费渠道退款举报提示；已实现，发布及检查范围见[0.2.34 验证](verification/RELEASE-0.2.34.md)。

- [原始需求](planning/PRD.md)、[整合方案](planning/INTEGRATION_PLAN.md)、[跨系统研究](planning/CROSS_PLATFORM.md)。
- [可行性](planning/FEASIBILITY.md)、[开源选型](planning/OPEN_SOURCE.md)、[待验收资源预算](planning/RESOURCE_BUDGET.md)。
- [平台来源与证据](research/README.md)、[U校园自动学习候选核查](research/UNIPUS-STUDY-2026-11-13.md)。

## 许可与素材

- [实验功能用途与自动化边界](legal/AUTOMATION_BOUNDARIES.md)：仅用于技术实现验证与参考、视频弹题真实提交、U校园保活、数据发送及确认记录。
- [分发许可核查](legal/RELEASE_LICENSE_REVIEW.md)、[第三方许可](../THIRD_PARTY_NOTICES.md)、[项目协议](../TERMS.md)（[English](../TERMS.en.md)）。
- 界面截图位于 `screenshots/`，文档插图位于 `images/`；源码仓库的图标设计与候选稿位于 `design/icon/`。

## 仓库与本机产物

源码位于 `apps/`、`packages/`，构建及检查脚本位于[脚本目录](../scripts/README.md)，测试和虚构样例位于 `tests/`。

`build/` 保存装配中间文件及检查输出，`dist/` 保存网页／后台编译结果与安装包，`.cache/` 保存下载缓存和临时预览，`node_modules/` 保存开发依赖；这些目录均不进入 Git。应用运行数据放在系统用户数据目录，详见[隐私说明](../PRIVACY.md)，不放进源码或文档目录。安装包与缓存的清理独立于文档归档；账号和数据库位于系统用户数据目录。

- [平台移除验证](verification/PLATFORM-REMOVAL-2026-11-13.md)：到梦空间归档、旧数据保留及显示／通知退出。

- [学习设置、章节与 U校园修复](verification/STUDY-FIXES-2026-11-14.md)：构建 23 的设置保留、模型检查、章节跳过、滚动及会话恢复。

- [构建 25：题目读取、完成状态与窗口布局](verification/STUDY-READING-2026-11-14.md)
