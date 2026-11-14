# 平台入口核查记录

核查日期：2026-11-12（Asia/Shanghai）。证据包括公开入口获取、人卫页面的授权截图、已登录 Chrome 中 jsjks 教学班及编程作业列表的只读观察。没有输入账号、提交登录表单或进入作答流程。本文件只保存脱敏观察，不保存原始账号页面、截图、用户/班级/任务的真实标识、Cookie、响应头或会话参数。

## 人卫中国医学教育题库

已确认的登录入口：<https://tk.ipmph.com/exam/a/adminlogin>。

| 检查项 | 观察 |
| --- | --- |
| 登录页 GET | HTTP 200，标题“人民卫生出版社中国医学教育题库” |
| 未登录 GET `/exam/a/exam/examTask` | 重定向至 `/exam/a/adminlogin`，最终 HTTP 200 |
| 登录页表单 | 页面包含人卫账号登录表单与用户名输入 |
| 公开源码依赖 | `sso.ipmph.com` 的登录状态/SSO 路径、腾讯验证码脚本、设备相关脚本 |
| 登录后作业页面 | 页面截图显示作业名称、所属学科、开始时间、结束时间、状态、创建人等列 |
| 登录后考试、分页、采集接口 | 未验证 |

重定向 URL 包含服务器生成的会话参数，记录时已经去除。未认证请求被重定向至登录页，HTTP 200 对应登录页面响应。作业接口仍需在登录后验证。

加载验证码或设备脚本不证明每次登录都会触发验证，也不证明平台必然拒绝 Playwright。需要用户在官方页面正常登录后，验证会话、只读数据与浏览器关闭后的复用行为。

原需求的 `examTask` 路径仅为入口线索，不推断所有考试也由同一路径提供。公开页的 SSO 域名可以作为后续登录域名核查线索，不能将整个 `ipmph.com` 下的域名自动列为采集白名单。

页面截图进一步确认 `/exam/a/exam/examTask` 对应“我的作业 → 作业列表”，侧栏另有“我的考试”。表格“结束时间”是截止字段候选，“开始时间”不能直接映射为发布时间；序号不能当作稳定任务 ID。截图中的可见样例为已完成任务，其他状态映射、考试字段、分页与 ID 仍需响应数据验证。

## 云南省高校计算机等级考试报名

经公开资料核对，报名模块地址为：<https://jsjks.ynjy.cn/yncre/>。

| 检查项 | 观察 |
| --- | --- |
| GET `/yncre/` | 最终到 `/yncre/student/`，HTTP 200 |
| 页面可见标题 | “云南省高校计算机等级考试报名” |
| HTML `<title>` | 初始为空白；页面脚本设置上述标题 |
| 登录表单 | 学校选择、账号登录、校验字段 |
| 本人报名、缴费状态、考试安排 | 未验证 |

公开来源：[云南工商学院关于做好2026年上半年云南省计算机等级考试报名工作的通知](https://www.ytbu.edu.cn/2026/0414/c42a31898/page.htm)，正文列出 `https://jsjks.ynjy.cn/yncre/`，并说明报名与缴费流程。该通知中的时间只属于其对应学校与考试批次，不能作为 CourseWatch 中其他用户的默认截止时间。

上述 `/yncre/` 仅是此前检查的报名模块。主站截图及已登录浏览器的只读观察，已确认教学业务使用主站的 `/users/{userId}/classrooms` 与 `/classrooms/{classroomId}/…` 路由。CourseWatch 的目标是 **教学班内作业和考试的新发布、截止时间与截止时间变化**，不使用报名模块代替教学任务。

### 已登录教学班页面观察

以下均为浏览器 UI 只读证据，路由参数以占位符脱敏；不是已验证的 HTTP API。

| 页面/内容 | 观察与采集含义 |
| --- | --- |
| `/users/{userId}/classrooms` | 教学课堂列表，有学习/管理与进行/结束等筛选，显示分页与每页条数；不能只扫描第一页或只取进行中 |
| `/classrooms/{classroomId}/announcement` | 教学班页，显示当前学生身份、所在分班，并提供课堂实验、图文作业、编程作业、在线考试等分类 |
| `/classrooms/{classroomId}/program_homework` | 已读取真实编程作业列表；卡片有标题、作者、绝对时间区间、阶段标签与独立进度 |
| `/classrooms/{classroomId}/program_homework/{taskId}/detail?tabs=1` | 从列表链接观察到详情路由和来源 ID 候选，未打开学习或作答流程；稳定性与 ID 作用域待验证 |
| `/classrooms/{classroomId}/exercise` | 由在线考试菜单导航观察到路由；当前可访问内容仍显示上一作业列表，不能将其当考试时间证据 |
| 图文作业、课堂实验 | 菜单存在；列表字段与完整覆盖范围未验证，不能用编程作业的结果代表全部作业 |

编程作业的“提交中 / 已截止”描述开放阶段，旁边同时存在完成进度；必须与用户提交/完成状态分别建模。列表时间区间可作为开始/截止字段候选，未显示的发布时间不能凭开始时间补齐。相对倒计时不作为权威时间来源。

下一步验证各分类的响应数据、列表/详情完整性、分页、时间语义及独立会话。Windows 测试系统已确认是 Windows 11，CPU 架构待核实。

## 尚需真实环境验证

1. 已观察的学生身份与分班如何映射到接口身份、账号隔离与采集作用域。
2. 平台实际提供哪些列表与详情；合法零条与错误页如何区分。
3. ID、时间单位、时区、状态码、分页边界与任务撤回证据。
4. 普通浏览器退出、后台重启、系统休眠恢复后的会话行为。
5. 是否存在单点登录冲突、设备验证或影响用户正常使用的行为。

当前状态：jsjks 为“已登录教学班与编程作业列表已观察，接口与独立后台采集未验证”；人卫为“作业列表截图已观察，接口及考试未验证”。两者都尚未完成适配。


## 普通雨课堂与学习通接入（2026-11-13）

普通雨课堂入口为 `https://www.yuketang.cn/web`，已核对的课程入口路径包含 `/v2/web/studentLog/{classroomId}`。本记录不保存真实班级 ID。

本次读取固定提交 `92e8870e9678b878de0b44ca964496a6a6a8e313` 的 xxt-Tool `YtApi.kt`、`XtApi.kt`、`HtmlParsers.kt` 及 MIT LICENSE，参考其中的只读接口路径、响应字段和列表选择器，实现 TypeScript 适配器。该项为源码核查，尚未核对真实课程、任务、状态与截止时间。具体实现及验证边界见[接入记录](../verification/COURSE-PLATFORMS-2026-11-13.md)。


## U校园 AI 版（2026-11-13）

U校园入口为 `https://uai.unipus.cn/`。读取该官网加载的公开前端文件 `https://res.unipus.cn/production/portal-platform/portal/static/js/main.406c6ae1.js`，以及首页、作业和考试对应的分块脚本；REA 对本地 JS 文件进行静态分析。该证据说明前端使用的契约，不证明用户账号响应、分页或完整覆盖。

| 只读路径 | 已观察的字段及处理 |
| --- | --- |
| `/api/cmgt/course/my/bookshelf` | 成功码 1，`value.groups` 内的 `resourceId`、`name`；按资源 ID 保留同名教程 |
| `/api/portal/v1/homework/student-aggregation` | `data.homework.total/items`，`assignmentId/platform/title/classes.className/startTime/endTime/publishTime`；汇总可能只提供部分任务，提交状态未证明 |
| `/api/portal/v1/exam/student-exams` | `data.totalCount/items`，`examId/examName/examStatus/examStartTime/examEndTime`；前端将状态 2 显示为进行中，其他状态保留未知 |

官网从 `PORTAL_STATE_PERSISTENT` 中读取 `tokenInfo.jwt`（或 `Authorization`）及院校信息。采集使用用户保存的官方会话；登录确认读取受保护书架接口。未知响应、失败及认证失效不当作空列表；汇总只标记部分覆盖。未证明书架资源与任务班级的关联，无法关联的任务使用明确命名的分组，由用户选择。详情单点登录链接可能携带临时凭证，因此任务只保留官网入口。真实账号登录、课程关联、任务时间和汇总范围尚待核对。
