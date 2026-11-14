# 开源选型与复用边界

调研日期：2026-11-12。选型分为“运行依赖”“源码移植候选”“外部服务”“参考与暂不采用”。本文保留调研阶段选型；0.1.0 的实际依赖以 package-lock.json 为准，实际许可见 THIRD_PARTY_NOTICES.md。截至 2026-11-13，雨课堂和学习通的只读接口与解析规则已参考 xxt-Tool 固定提交移植，具体归属和许可全文见 THIRD_PARTY_NOTICES.md。Drizzle 已因空闲内存开销从实现中移除，SQLite 直接使用 better-sqlite3。

修订后的选型范围：jsjks 与人卫为首批自有适配器验证目标；其他平台优先从现有明确许可的实现整合。所有整合都要在 macOS 与 Windows 验证，移动端或 Windows 项目的运行成功不能直接代表跨平台通过。

许可证依据固定提交的 LICENSE 与已阅读文件；仓库根许可证不能代替文件、嵌套依赖、字体和随包二进制的许可证检查。候选版本尚未锁定，开发时需选稳定发行版并生成 lockfile 与实际依赖清单。[固定来源索引](../research/README.md)

## 1. 平台相关项目

| 项目 | 许可证与维护快照 | 可利用内容 | 整合决定 |
| --- | --- | --- | --- |
| [siye4366/xxt-Tool](https://github.com/siye4366/xxt-Tool) | MIT；最后推送 2026-11-07；Kotlin | 学习通课程/作业/考试读取，雨课堂课程与活动读取 | 首选采集路径参考，移植只读部分为 TS，重新做错误、分页与时间规则 |
| [arrry-07/chaoxing-journal](https://github.com/arrry-07/chaoxing-journal) | MIT；最后推送 2026-11-12；Dart | 学习通解析、部分成功、截止可信度、人工验证分类 | 第二来源；选取纯解析和状态建模参考，逐文件保留归属 |
| [linpigeon/UniversityTodos](https://github.com/linpigeon/UniversityTodos) | AGPL-3.0；最后推送 2026-11-05；C# | 多源同步、雨课堂 API 文档、Windows 桌面集成经验 | 功能对照；本次不复制代码、文档或 UI 资产 |
| [Marshmellond/XuexitongJob](https://github.com/Marshmellond/XuexitongJob) | GPL-3.0；最后推送 2023-11-08；Python | 学习通作业提醒的历史实现 | 不作为首选移植源；时效与许可证路径不如前两项匹配 |
| [xsk666/xxt_work_notice](https://github.com/xsk666/xxt_work_notice) | 未发现根许可证；最后推送 2022-10-23 | 作业提醒方向 | 不导入代码；公开可读不代表获得复用许可 |
| [heyblackC/yuketangHelper](https://github.com/heyblackC/yuketangHelper) | 未发现根许可证；最后推送 2024-04-02 | 雨课堂相关历史脚本 | 不导入代码，且项目功能范围与任务监控不同 |

“最后推送”仅为 GitHub 元数据，不证明功能可用、代码质量或安全。前两项不是现成的 CourseWatch 插件，需要移植、许可归属整理和用户账号实测。

`xxt-Tool` 的 Android WebView、Keystore、WorkManager 与 `chaoxing-journal` 的 Flutter/Android 平台桥接不进入桌面后台；采用它们的只读采集与纯解析参考。`UniversityTodos` 使用的 Windows DPAPI、WebView2 与 WinRT 集成不能直接用于 macOS。跨平台替代路径见[系统适配方案](CROSS_PLATFORM.md)。

### xxt-Tool 源码核查：可借鉴什么，需要改什么

固定提交 `92e8870e9678b878de0b44ca964496a6a6a8e313`。

| 源文件 | 已读证据 | CourseWatch 的处理 |
| --- | --- | --- |
| `XtApi.kt` L97–110、L147–154 | 包含课程、作业、考试列表路径；课程请求异常可返回空列表 | 学习采集入口；异常必须作为失败结果向上传递 |
| `XtApi.kt` L276–284、L304–307 | 部分请求失败主要写日志；状态变化观察时间用于阶段时间 | 按课程/任务类型标记不完整；观察时间另存，不冒充提交时间 |
| `YtApi.kt` L164–183 | 固定 `page=0&offset=100`，失败/无效结构可能返回空数组 | 验证并实现分页终止规则；不能称该结果为完整快照 |
| `YtApi.kt` L201–215 | 无显式 DDL 时回退课程结束时间；部分类型由标题推断 | 保留 DDL 未知；任务类型依据平台明确字段或保持待核实 |
| `YtApi.kt` L237–246 | 某类作业以 `is_assessed` 及时间推断状态 | 未批阅不能直接等同未提交，提交状态缺证据时保持未知 |
| `YtApi.kt` L267–283 | 用观察时刻补历史任务阶段时间 | 仅记 `firstObservedAt` / `statusObservedAt` |
| `HtmlParsers.kt` | HTML 列表、详情、日期解析 | 可作为 TS 解析器输入；配套脱敏响应与边界用例重新验收 |

对应不可变源码链接见 [来源索引](../research/README.md)。上游关于某接口 403 的描述仅代表其实现背景；不能推广成所有学校和客户端均如此。

### chaoxing-journal 的补充价值

固定提交 `e6d8b53a81042a461935bd39e1e2aa4d9bcfc11a`。

`chaoxing_local_client.dart` L476–530 处理部分采集、部分截止未确认；L1159–1201 区分认证、登录页和可见验证提示。可借鉴其“未知信息保留”和分阶段错误处理，但不接入整套 Flutter、Android 平台桥接或账号密码登录流程。

`chaoxing_assignment_parser.dart` L345–346 明确标注部分格式来自 `xuexitong-cli`，Copyright (c) 2026 Wu Jiale，MIT；已核对嵌套许可证。将来如果移植此部分，必须同时保留 HY 和 Wu Jiale 对应的许可及归属，不能只保留外层仓库名。

### 许可证决策

优先用 MIT/Apache-2.0/BSD 等明确许可的依赖与移植来源。调研阶段尚未选择 CourseWatch 自身许可；当前从构建 32（0.2.32）起，有权许可的新版原创内容采用 [CourseWatch 非商业许可证 1.0](../../LICENSE)，禁止商用；历史已授予许可和第三方原许可继续适用，详见[项目协议](../../TERMS.md)。若未来要复制 GPL/AGPL 项目的实现，需要先确定整体分发与许可证义务；改写语言或改成子进程，不会自动消除衍生作品的许可要求。本方案不引入这些实现。

## 2. 通用开源依赖

| 能力 | 候选 | 核查许可证 | 方案 |
| --- | --- | --- | --- |
| 扩展工程 | [WXT](https://github.com/wxt-dev/wxt) + `@wxt-dev/module-vue` | MIT | 推荐；复用 Vite/Vue 生态，管理 MV3 入口与构建，替代手工维护完整构建流程 |
| 界面 | [Vue](https://github.com/vuejs/core)、[Naive UI](https://github.com/tusen-ai/naive-ui) | MIT | 沿用原需求，UI 只消费本地 API，不内置平台采集 |
| 本地 API | [Fastify](https://github.com/fastify/fastify) | MIT | 推荐；使用参数/响应校验、访问限制、请求日志脱敏 |
| 数据与迁移 | [Drizzle ORM](https://github.com/drizzle-team/drizzle-orm) | Apache-2.0 | 推荐；业务层与数据库 driver 分离 |
| SQLite driver | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | MIT | 首选待验证；重点验证 Node ABI、Windows/macOS 原生模块打包 |
| 数据校验 | [Zod](https://github.com/colinhacks/zod) | MIT | 推荐；用于采集结果、API 契约、配置验证，未知 schema 报错 |
| HTML 解析 | [Cheerio](https://github.com/cheeriojs/cheerio) | MIT | 推荐；只解析获取到的 HTML，不执行来源脚本 |
| 独立浏览器 | [Playwright](https://github.com/microsoft/playwright) | Apache-2.0 | 按需；官方登录窗口、上下文管理、必须渲染的读取 |
| 日志 | [Pino](https://github.com/pinojs/pino) | MIT | 推荐；默认不记录 headers、原始响应、URL 会话参数 |
| 时间显示 | [Day.js](https://github.com/iamkun/dayjs) | MIT | 沿用原需求；解析必须显式时区与格式，不能只靠本机时区 |
| 日历 | [FullCalendar](https://github.com/fullcalendar/fullcalendar) 标准功能 | MIT | 后置；月/周/日选择标准插件，Premium 另有许可，避免误用 |
| 测试 | [Vitest](https://github.com/vitest-dev/vitest) | MIT | 用于采集解析、变化与提醒等有业务意义的自动验证 |
| 重试 | [p-retry](https://github.com/sindresorhus/p-retry) | MIT | 可选；仅瞬态错误有限重试，不重试登录失效/人工验证 |
| 限流 | [Bottleneck](https://github.com/SGrondin/bottleneck) | MIT；最后推送 2024-01-23 | 暂缓；首版采用平台串行调度与并发限制，复杂限流另行评估 |

以上仅是候选依赖地图，不是已生成的安装清单。实际包版本、Node LTS 版本与兼容矩阵留到实现前锁定；不使用调研时的仓库 HEAD 作为默认生产依赖版本。

## 3. 通知、桌面宿主与可选服务

| 项目 | 复用方式 | 决定与限制 |
| --- | --- | --- |
| [node-notifier](https://github.com/mikaelbr/node-notifier) | Node 通知适配器 | 适合 PoC；根包 MIT，但随包 SnoreToast 是 LGPL-3，terminal-notifier 许可还包含图标例外，不能把整个分发物一概写成 MIT |
| [Electron](https://github.com/electron/electron) | 已研究，首版不采用 | MIT；长期运行需控制资源开销，首版不引入常驻 Electron 宿主，保留独立后台与按需界面 |
| [ntfy](https://github.com/binwiederhier/ntfy) | 通知渠道通过 HTTP 发布 | 后续可选；README 声明 Apache-2.0 / GPLv2 双许可，GitHub 自动识别为 NOASSERTION，已人工核对。无需捆绑 Go 服务，用户选择远端/自建地址与认证 |
| [Apprise](https://github.com/caronc/apprise) | 可选外部通知桥 | BSD-2-Clause；支持多渠道，但引入 Python/额外进程或远端服务，首版不作为必需依赖 |
| [changedetection.io](https://github.com/dgtlmoon/changedetection.io) | 网页变化监控参考或独立工具 | Apache-2.0；通用网页差异不是课程任务语义，不能直接解决任务 ID、完成状态、分页、撤回。首版不嵌入其 Python 服务 |

原生通知的可运行示例不能替代安装验收：Windows 要验证应用身份与点击回跳，macOS 要验证权限、签名/分发环境及后台通知。用户关闭浏览器后，扩展通知渠道不可用，应由操作系统渠道承担提醒。

## 4. “整合”具体指什么

1. **依赖复用**：WXT、Fastify、SQLite/Drizzle、Zod、Cheerio、Playwright 等分别承担通用能力。
2. **适配器移植**：从明确许可来源选取只读接口与解析参考，形成 CourseWatch 的 TypeScript 适配器；绝不将手机应用包当 Node 插件加载。
3. **通知渠道插件**：桌面通知首版必需，ntfy 等后续可选，通过统一渠道接口接收已持久化的提醒事件。
4. **不复用的核心**：扫描完整性、任务身份、字段差异、DDL 版本、事务历史、持久化调度与提醒去重由 CourseWatch 自己实现。

首版平台适配器采用随应用发布的内置模块。允许任意第三方运行时代码直接获得会话和数据库权限会带来额外隔离需求，因此“可扩展”先体现为明确接口与契约测试，暂不设计在线插件商店或动态远程脚本加载。

## 5. 移植与升级记录

实际开始移植时，为每项复用记录：上游仓库、固定提交、文件路径、原作者、原许可证、修改说明、CourseWatch 目标文件及相关测试。创建 `THIRD_PARTY_NOTICES`，随发行包附带必要许可，检查随包浏览器、通知二进制和字体等嵌套许可。

上游更新通过可审查的依赖/适配器变更进入，不自动下载远程适配器脚本；先回放脱敏 fixture，再做真实账号只读验证。2026-11-13 已移植 xxt-Tool 的只读路径与解析规则至 `packages/adapters/src/yuketang.ts`、`chaoxing.ts`；未引入它的 Android 依赖。来源索引不能作为最终发行物的完整 SBOM。
