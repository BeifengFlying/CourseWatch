**学习通助手接入 CourseWatch 的可行性评估**

核查日期：2026-11-13（Asia/Shanghai）。本次读取两个上游仓库的固定提交、许可证、选定源码和公开维护记录，并对照 CourseWatch 当前工作区。没有安装或执行上游脚本，没有登录教学平台、调用模型、提交学习任务或测量资源占用。以下属于源码层面的评估。

**后续范围变更**

本评估后，自动学习的实现范围确定为章节测验自动提交、课程作业仅生成答案、排除考试，并在设置中提供试验开关和开启前说明。后续实现以 [试验功能记录](../verification/STUDY-EXPERIMENT-2026-11-13.md) 为准；下文保留调研阶段的选型判断。

**结论**

如果目标是补全任务监控，这两个项目的直接收益有限，应继续完善现有学习通适配器。如果目标是增加用户主动打开的资料阅读、内容解释和复习功能，优先参考 `zhu-hailin/chaoxing-ai-assistant`，拆出独立模块后接入。两个项目都不适合原样嵌入后台。

自动播放、跨课程执行、自动答题和提交需要长期页面运行及业务写入，不能沿用现有只读监控的资源、权限和验证结论。调研时的 TERMS.md 第 6.2 条明确排除了代答、代交功能；后续条款已按确定的试验范围更新，这类接入仍不属于普通的平台适配。

**核查版本与范围**

| 项目 | 固定提交与脚本版本 | 已读范围 |
| --- | --- | --- |
| [March-OwO/Xuexitong-LLM-Assistant](https://github.com/March-OwO/Xuexitong-LLM-Assistant/tree/1c9e31cdabf8a637f454c41e42b6567385320855) | `1c9e31cdabf8a637f454c41e42b6567385320855`；`1.2.10` | README、LICENSE、完整脚本的元数据、配置、模型请求及主要运行入口 |
| [zhu-hailin/chaoxing-ai-assistant](https://github.com/zhu-hailin/chaoxing-ai-assistant/tree/0d91475bfdf39c8e51031d96f0d658827aefd887) | `0d91475bfdf39c8e51031d96f0d658827aefd887`；`1.33.4` | README、LICENSE、package、构建清单、源码结构、选定题目／资料／模型／调度／凭据模块及字体依赖清单 |

第一项固定提交的提交时间为 2026-11-05，第二项为 2026-11-04，均按北京时间表述。第二项公开发行版 v1.33.4 发布于 2026-11-04。日期仅说明维护记录，不能证明当前学校页面兼容。Issue 与发行版信息是本次查询时的状态。

**两个项目的区别**

| 对比项 | March-OwO 项目 | zhu-hailin 项目 |
| --- | --- | --- |
| 运行方式 | 油猴脚本，在章节、作业或考试页面执行 | 油猴脚本，课程列表、章节和作业等页面协作 |
| 主要能力 | 文本题模型请求、视频／文档处理、任务切换和自动提交，包含考试逻辑 | 图文题解析、结果展示与原生预填、课程目录／队列、资料上下文和播放处理；README 明确不提供考试答题 |
| 源码组织 | 仓库主要提供一个约 217 KB 的构建后脚本，未见对应模块源码和测试工程 | 有 sources、构建清单及 DOM 模拟测试；构建脚本约 1.67 MB，含内置资源 |
| 模块迁移 | 需要先拆解构建产物 | 文件划分便于定位，但仍拼接进共享闭包，不是可直接导入的 ESM／SDK |
| 运行依赖 | CDN 提供 Vue、Pinia、Element Plus、jQuery 等，另有外部字体映射资源 | 代码、字体映射和图标内置；仍需平台页面、油猴 API，模型调用联网 |
| 模型适配 | 主要是文本消息请求，自定义值作为完整请求 URL 使用 | 模型列表、服务商配置、图文请求、取消和限流重试；地址按基础 URL 使用 |
| 选型 | 不作为主要集成基础 | 作为选定模块的参考来源 |

可参考不等于整个模块已完成审计。上游 DOM 模拟测试的存在不能证明 CourseWatch 的 macOS／Windows 宿主可直接运行这些功能。

第一项还有一个静态可见问题：调用 `_callAI` 时将超时和思考配置作为第七个参数传入，但函数签名只有六个参数，内部从第六个 `options` 读取配置。此处需要修正并验证，不能仅按 README 认定配置均已生效。第一项公开未关闭 Issue 包括[作业提交不了](https://github.com/March-OwO/Xuexitong-LLM-Assistant/issues/3)和[切换章节响应慢](https://github.com/March-OwO/Xuexitong-LLM-Assistant/issues/1)；本次未复现这些 Issue 记录的问题。

**与 CourseWatch 的关系**

本次工作区已有未提交的平台接入改动。以下针对读到的工作区文件，不代表所有内容已进入发布包。

| 当前实现 | 接入影响 |
| --- | --- |
| packages/adapters/src/chaoxing.ts 已有课程发现、作业／考试列表和明确时间读取 | 无需为了基础列表引入完整脚本；当前明确保留 partial，全课程及分页完整性仍待真实账号核对 |
| packages/adapters/src/index.ts 使用独立浏览器登录，完成后保存会话并关闭浏览器；学习通扫描使用 HTTP 请求上下文 | 可以复用正常授权会话；题目 DOM、课件阅读器和播放器不是后台现成存在的对象 |
| packages/adapters/src/course-http.ts 限制单轮时间和请求数，区分失效会话、人工验证、限流和部分结果 | 页面执行器不能直接替代扫描契约，识别失败或跳过不能记成已完成 |
| packages/contracts/src/index.ts 中 SourceTask 保存任务身份、状态、时间和入口 | 题干、图片、模型结果及资料需要独立结构 |
| Vue 界面配合 AppKit／WebKit 和 Windows WebView2 外壳 | 可以沿用现有界面，无需增加 Electron；油猴面板不能直接作为 Vue 组件使用 |
| WXT 配置目前仅提供本地服务的主机权限 | 现有扩展没有平台注入和 GM 接口，需要另行开发并验收页面采集能力 |
| Vault 已使用 Keychain／DPAPI 等系统能力 | 可参考凭据保护方式，但当前没有独立模型 Key 管理接口；不能复用平台 ID 覆盖会话记录 |

**按功能判断**

工作量为结构性判断，不是排期承诺。

| 功能 | 可行性与工作量 | 建议 |
| --- | --- | --- |
| 作业／考试提醒、截止变化 | 现有框架已具备；两个脚本不是主要补充，仍需真实字段和分页验证 | 完善现有适配器 |
| 章节目录、未完成任务点展示 | 中等；第二项有目录和页面识别规则，需要新增章节状态结构 | 可作为只读扩展，验证页面访问是否改变学习记录，区分未知、不可访问和已完成 |
| 课件、已加载字幕、笔记的整理与解释 | 中到较高；有资料规范化和章节归属实现，但依赖当前网页和阅读器 | 用户主动打开后按需读取，不承诺完整课程资料均可获取 |
| 用户选定内容的图文解释、练习解析 | 中到较高；需要内容与图片读取、模型服务、用量控制及结果展示 | 独立学习辅助功能，不自动填入或提交平台答案 |
| 原生答案预填 | 高；涉及控件、编辑器、题目身份校验和写操作，与当前产品约定不一致 | 不纳入推荐范围 |
| 视频／文档自动执行、跨课程队列 | 高；依赖长期页面、iframe、播放器及执行状态 | 不并入常驻监控链路 |
| 考试自动答题或自动提交 | 第一项包含相关逻辑，第二项不提供考试答题；与项目约定冲突 | 不作为接入方案 |

**推荐实现方式**

保留现有任务与提醒链路，增加按需启动的资料采集和内容解释模块：

1. 监控继续使用现有适配器，仅交换课程、任务、时间和来源状态。
2. 用户打开学习辅助功能后，才读取其选择的内容。第一版可从粘贴文字或选择本地资料开始，先验证模型链路，再连接平台页面。
3. 页面采集器输出带课程／章节身份的可序列化快照。DOM 节点、编辑器对象及带会话参数的资源 URL 不直接进入长期任务存储。
4. 本地服务负责模型请求、取消、限流、用量记录和凭据读取。平台 Cookie 不发送给模型服务，只有用户选择的正文及必要图片进入请求。
5. 结果使用现有 Vue 界面、字体、表单和底部操作区，标明读取来源、内容截断、模型失败及未知状态。
6. 结束读取后释放浏览器，结束或取消请求后回收任务。普通后台提醒不加载页面执行器，也不启动本地模型。

该方案无需新增开发者云服务器。使用云模型时，选定内容由本地应用发送至配置的模型服务商，并可能产生 API 费用。本机模型需另立资源方案，不属于当前轻量后台范围。

第二项可优先参考的文件：

| 文件 | 可参考部分 | 迁移前处理 |
| --- | --- | --- |
| sources/model-providers.js | 服务商、地址规范化、响应适配 | 从脚本存储解耦，迁移到后端请求，保留地址变化后重新绑定凭据的行为 |
| sources/analysis-scheduler.js | 有限并发、取消、失败分类和退避 | 与采集调度分别限流，增加用户可见的请求及费用上限 |
| sources/question-parser.js、sources/question-media.js | 内容／图片结构、题目及共用材料身份 | 分离只读数据和写入绑定，补充真实页面 fixture，限制图片尺寸和数量 |
| sources/course-context.js、sources/course-context-collector.js | 字幕／讲义规范化、章节归属 | 仅能读取页面已开放或已加载材料，完整课程下载范围尚待确认 |
| course_catalog.js、sources/course-home-launch.js | 目录和当前章节识别规则 | 仅抽取读取规则；导航和执行行为另行判断，不整文件注入监控 |

不直接把完整脚本注入登录窗口。登录完成后窗口会关闭，原脚本还会装配课程执行、页面监听、设置和更新功能。补齐 GM 兼容层也不能因此满足当前生命周期与产品约定。

**许可与分发**

两仓库根 LICENSE 均为 MIT。移植其受许可覆盖的代码可以保留 CourseWatch 现有许可结构，但必须保留原版权、MIT 许可和相应第三方声明，分别记录新增原创改动及上游来源。

第二项有明确的许可缺口：vendor/font/manifest.json 第 39–46 行将 table.json 标为 upstream-not-specified，对应 README 说明上游响应没有单列许可。Typr 和 MD5 的 MIT 不能自动覆盖此表。建议首版不复制它；需要时先取得授权或确认可分发来源。第一项也使用同源外部映射资源，原样嵌入不能消除这个问题。

第一项的 UI CDN 依赖和第二项内置的字体、图标仍需按选定资产核对。建议复用 CourseWatch 已有 Vue／Naive UI，移除上游品牌图标及更新入口，只随 CourseWatch 经过核查的版本发包。根 MIT 不代表平台内容、商标和所有外部资源均获再分发授权。

**最小验证顺序**

1. 独立模型请求：用虚构文字检查成功、无效 Key、超时、限流、取消和地址变化，不接平台提交。
2. 脱敏页面快照：核对跨章节身份、重复条目、图片、截断和失败保留，再与本人正常授权的真实页面逐项比对。
3. macOS／Windows：核对页面读取及凭据处理；关闭、取消和结束采集后检查进程回收，再测量全进程树资源变化。
4. 界面：检查桌面、390px 和 320px 的对齐、完整文字、图片和操作区溢出。类型检查不能替代视觉验收。

当前结论限于模块迁移的架构可行性。学校与题型覆盖、运行稳定性、资源预算及模型答案质量仍需分别验证。

**源码依据**

- 第一项：[元数据与配置](https://github.com/March-OwO/Xuexitong-LLM-Assistant/blob/1c9e31cdabf8a637f454c41e42b6567385320855/chaoxing-ai-llm.user.js#L1-L79)、[模型请求与参数传递](https://github.com/March-OwO/Xuexitong-LLM-Assistant/blob/1c9e31cdabf8a637f454c41e42b6567385320855/chaoxing-ai-llm.user.js#L124-L280)、[MIT](https://github.com/March-OwO/Xuexitong-LLM-Assistant/blob/1c9e31cdabf8a637f454c41e42b6567385320855/LICENSE)。
- 第二项：[源码装配](https://github.com/zhu-hailin/chaoxing-ai-assistant/blob/0d91475bfdf39c8e51031d96f0d658827aefd887/build_script.py#L57-L105)、[模型配置](https://github.com/zhu-hailin/chaoxing-ai-assistant/blob/0d91475bfdf39c8e51031d96f0d658827aefd887/sources/model-providers.js#L40-L92)、[请求层](https://github.com/zhu-hailin/chaoxing-ai-assistant/blob/0d91475bfdf39c8e51031d96f0d658827aefd887/sources/assistant-core.js#L148-L182)、[调度](https://github.com/zhu-hailin/chaoxing-ai-assistant/blob/0d91475bfdf39c8e51031d96f0d658827aefd887/sources/analysis-scheduler.js#L1-L65)。
- 第二项：[内容解析](https://github.com/zhu-hailin/chaoxing-ai-assistant/blob/0d91475bfdf39c8e51031d96f0d658827aefd887/sources/question-parser.js#L697-L727)、[章节资料](https://github.com/zhu-hailin/chaoxing-ai-assistant/blob/0d91475bfdf39c8e51031d96f0d658827aefd887/sources/course-context-collector.js)、[字体表许可记录](https://github.com/zhu-hailin/chaoxing-ai-assistant/blob/0d91475bfdf39c8e51031d96f0d658827aefd887/vendor/font/manifest.json#L39-L46)、[字体依赖说明](https://github.com/zhu-hailin/chaoxing-ai-assistant/blob/0d91475bfdf39c8e51031d96f0d658827aefd887/vendor/font/README.md)、[MIT](https://github.com/zhu-hailin/chaoxing-ai-assistant/blob/0d91475bfdf39c8e51031d96f0d658827aefd887/LICENSE)。

本次只新增本评估文档，没有移植上游代码或改变 CourseWatch 功能。
