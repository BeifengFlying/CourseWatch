# Windows 0.2.36 验证

日期：2026-11-15，Asia/Shanghai。应用版本：0.2.36；内部字段：36；Windows 修订号：0。

## 范围

- 合入 0.2.36 的 U校园教程目录读取、运行中目录刷新和分阶段诊断；保留学习逻辑保护清单及入口。
- 纳入[学习通登录修复](CHAOXING-LOGIN-2026-11-15.md)：移动接口失败后读取同会话官方网页课程，登录失败提示区分网络、超时、格式及认证错误。
- 合并登录诊断时统一使用 `login-confirm-failed` 事件，保留阶段、请求事实及内部错误原因；导出不包含凭据、原始响应及课程正文。
- LICENSE 使用标准 Apache-2.0 全文，项目补充约定见中英文 TERMS；协议确认修订为 `2026-11-15.2`，旧修订需重新确认。
- 生成独立的 Windows 安装程序及便携 ZIP，不覆盖历史文件，不附带浏览器及文档展示图。

## 验证记录

环境：Windows 11、Node.js 24.22.3、.NET SDK 10.0.404。检查使用临时数据及模拟课程，不启动真实学习任务。

- `npm run typecheck` 通过。
- Windows 协议记录检查通过；启动与关闭设置 16 项检查通过，不修改实际开机启动注册。
- 协议弹窗 100%／150% 缩放各 4 种布局、120 项检查通过，覆盖浅深主题、正文滚动、文字边界与明确同意／退出操作。
- `npm test -- --maxWorkers=2`：57 个文件、382 项测试通过；学习逻辑保护检查覆盖 5 个文件、9 处入口。
- 实验用途确认界面 12 组检查通过，覆盖两平台、1060／390／320px 和浅深主题；仅使用模拟数据，无外部请求或学习任务。协议正文及窄窗口截图已检查。
- 最终 `npm run build:win` 通过；包内认证边界、令牌撤销、来源过滤、本地 API、SQLite、DPAPI 虚构会话、系统浏览器独立资料目录、更新提醒渠道隔离、后台 command／EOF 正常退出检查通过。
- 上游 284 个原文件及受保护逻辑校验通过。ZIP 完整性检查通过，共 3455 项；每个文件与解压目录逐字节核对，后台与构建输出一致。
- 包内版本、内部字段和修订号正确，许可与协议原文和构建源一致，LICENSE 与标准 Apache-2.0 副本一致；不含浏览器、文档展示图、本地 AGENTS.md 或 NEXT_RELEASE.local.md。
- 20 个历史安装包及校验文件的大小与 SHA256 保持不变。未发布的首轮产物单独保存在本机 `build/release36-unpublished-first-pass/`。

## 最终产物

构建输入提交：`538b8e5b0236c1a9b09b4ef158affa273f2aaa58`。包内本文为构建前快照，源码记录补入构建结果及摘要后不再重建自身。

| 文件 | 字节数 | SHA256 |
| --- | ---: | --- |
| `CourseWatch-0.2.36-win-x64-setup.exe` | 82662979 | `ab2e802634351fd080b14fc8ad50d32dac442c3527d577f89c0ce6e78244c8e2` |
| `CourseWatch-0.2.36-win-x64.zip` | 114842627 | `ed750f47b627bf5a980c7aa7e99cb2559e10e6fb3f559a41f99eca6e6632e683` |

两份同名 `.sha256` 已核对。

## 验证边界

本轮未使用真实教学平台账号验证登录及课程同步，未执行安装程序或替换已安装应用。Windows 10、完整安装／升级／卸载、实际开机启动、系统通知投递、长期休眠及跨屏 DPI 切换未实测。既有界面依赖许可文本缺件见[许可核查](../legal/RELEASE_LICENSE_REVIEW.md)。

Windows 附件与 macOS 附件使用同一个 `v0.2.36` Release；macOS 构建输入及检查范围见[0.2.36 验证](RELEASE-0.2.36.md)，其安装包不含本轮追加的学习通登录修复。

## 发布检查

Windows 四个附件已追加到 [v0.2.36 发布页](https://github.com/BeifengFlying/CourseWatch/releases/tag/v0.2.36)。Release ID 保持 `445956899`，合计 8 个附件；原四个 macOS 附件的 ID、字节数与 SHA256 保持不变。标签仍指向 macOS 构建提交 `309e9deac2ec9ad825ef4f8e9fd6c24565a026c6`，未移动标签或创建替代 Release。

- Windows 安装程序、便携 ZIP 及两份校验文件的 GitHub 字节数、SHA256 与本地一致。
- 使用 Node.js、不携带登录凭据，从公开下载链接取回四个附件；大文件使用 HTTP 范围请求按顺序计算完整 SHA256，全部匹配。Python 首次请求因本机证书链无法验证而失败，未作为下载通过记录，未关闭 TLS 校验。
- 源码已合并到 `main`，中英文 README 和 Windows 下载说明指向同一个版本；Release 说明补充 Windows 安装方式、追加修复和验证边界。
- 发布账号为 `BeifengFlying`。原 Release 元数据保存在本机 `build/release-archives/v0.2.36-before-windows/release.json`，产物与公开下载证据保存在 `.cache/release36/`。
