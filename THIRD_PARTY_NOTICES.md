# 第三方软件与素材

从构建 32（0.2.32）起，CourseWatch 有权许可的新版原创内容采用 [CourseWatch 非商业许可证 1.0](LICENSE)及[项目协议](TERMS.md)，禁止商用；此前已依法取得的版本继续按原许可处理。新许可及源码历史重建不撤回历史 Apache-2.0 授权，不改变下列组件、素材及平台内容的权利。具体版本以 `package-lock.json`、随包 `DEPENDENCIES.txt`、`UI-LICENSES/INDEX.txt` 为准；本表不是全部传递依赖的许可证全文。

## macOS 包内的软件

| 组件 | 许可与随包位置 |
| --- | --- |
| Node.js | MIT 及随 Node 分发的第三方许可；`Contents/Resources/NODE-LICENSE.txt`。 |
| Fastify 及插件、better-sqlite3、Cheerio、Zod | 主要为 MIT；各软件及传递依赖的原始许可／NOTICE 保留在 `Contents/Resources/app/node_modules/`，具体包以 `DEPENDENCIES.txt` 为准。SQLite 核心为公有领域，不代表 better-sqlite3 整体没有许可义务。 |
| Playwright、playwright-core | Apache-2.0；保留各包许可与 NOTICE。Playwright 的许可不覆盖它下载的全部浏览器内容。 |
| Nodemailer、qrcode | MIT；邮件发送和手机配对二维码生成，各包许可随 `node_modules` 保留。 |
| web-push | MPL-2.0；网页推送及消息加密，各包原始许可与未修改的源码随 `node_modules/web-push/` 保留。传递依赖许可分别适用。 |
| 浏览器 | 从构建 26 起均不分发浏览器，调用用户独立安装的 Chrome／Edge。历史带浏览器包曾包含 Google Chrome for Testing；其条款与本项目许可分别适用，参见下文历史说明。 |
| Vue、Naive UI | MIT；及其依赖的 MIT、BSD、Apache 等许可。打包脚本收集已安装依赖树的根目录许可／NOTICE 至 `Contents/Resources/UI-LICENSES/`，版本、原始路径及缺件见 `INDEX.txt`。清单保守包含可能被构建工具剔除的模块，不是全部代码均进入产物的证明。 |
| Lucide 图标 | ISC，另含源自 Feather 部分的 MIT 声明；完整文件保留在 `UI-LICENSES`。 |

`node-notifier` 及其辅助程序用于源码 CLI，不进入当前 macOS 应用包。Apple 的 AppKit、WebKit、UserNotifications、EventKit 等系统框架由 macOS 提供，不随包复制。雨课堂与学习通适配器的只读路径和解析规则参考下述 MIT 来源，归属与原许可全文随本文件分发。

## Windows 测试包的软件

Windows 复用上述 Node、后台、界面和浏览器组件，对应文件位于 `resources/`，不使用 macOS 的 `Contents/Resources/` 层级。另外包含自包含发布的 .NET 10 运行时、Microsoft WebView2 SDK 和 Microsoft.Toolkit.Uwp.Notifications 7.1.3。NuGet 及 SDK 下载依赖的原始许可、NOTICE 和元数据收集到 `resources/DOTNET-LICENSES/`；`INDEX.txt` 包含可能没有进入最终产物的构建依赖，不等于完整二进制许可审计。

Microsoft Edge WebView2 Runtime 使用微软相应条款，不能由本项目重新许可。安装程序在需要时调用微软官方引导程序下载运行时，打包时检查引导程序的 Authenticode 签名；该检查不代表本项目已取得额外再分发权利。Windows 系统 API 不作为项目原创内容授权。Inno Setup 用于构建安装程序，其许可及安装器分发条件仍适用。

## 历史带浏览器包的额外核查

以下核查仅适用于曾分发的历史带浏览器包。从构建 26 起全部新包均不包含浏览器二进制，仍保留 Playwright 及其他包内组件的许可说明；用户独立安装的浏览器适用其原有条款。

不能把浏览器简单标成“Chromium，BSD 许可”或将其视为 Playwright 的 Apache-2.0 内容。当前下载产物带有 Google Chrome for Testing 品牌，内部 `chrome://terms` 提供 Google 服务条款及 Chrome 附加条款，`chrome://credits` 提供开源组件的归属与许可。原有下载目录中的许可文件会随整个目录保留，但**这不足以证明全部通知、源码义务或再分发条件已经满足**。

公开分发前需对照实际浏览器版本取得并随包提供适用的完整条款、组件许可及必要源码材料，核对其再分发依据。组件是否需要提供源码或书面要约取决于具体许可及发布方式，不能仅靠保留一个网页链接代替。当前脚本不单独复制 Headless Shell 或 FFmpeg 下载包；完整浏览器内部仍可能含媒体编解码组件，不能据此声称不存在相关许可或专利问题。

参考：[Chrome for Testing](https://github.com/GoogleChromeLabs/chrome-for-testing)、[Google 服务条款](https://policies.google.com/terms)、[Chrome 附加条款](https://www.google.com/chrome/terms/)。

## 平台标识及内容

平台名称、图标及平台页面内容属于各自权利人；图标来源见 [平台图标来源](apps/extension/public/platforms/README.md)，打包时另存为 `PLATFORM_ASSET_SOURCES.md`。这些标识用于识别对应网站，不表示平台授权、合作或推荐本软件。来源记录和权利归属声明不等于获得再分发许可。

目前尚未确认平台图标的完整再分发依据，以及部分界面传递依赖缺少的原始许可文本。当前待办和证据范围见[分发许可核查](docs/legal/RELEASE_LICENSE_REVIEW.md)。第三方内容不能由本项目单方面改为非商业许可或 Apache-2.0，也不能以“侵权联系删除”替代事前授权核查。

## 教学平台采集参考

`packages/adapters/src/yuketang.ts`、`packages/adapters/src/chaoxing.ts` 的只读接口路径、响应字段及列表选择器移植参考 [siye4366/xxt-Tool](https://github.com/siye4366/xxt-Tool/tree/92e8870e9678b878de0b44ca964496a6a6a8e313)，固定提交 `92e8870e9678b878de0b44ca964496a6a6a8e313`，文件 `app/src/main/java/com/xxkg/board/YtApi.kt`、`XtApi.kt`、`HtmlParsers.kt`，作者 siye4366，MIT 许可。

CourseWatch 将对应只读逻辑改写为 TypeScript，增加响应校验、部分失败记录、分页上限、会话验证、官方地址限制和回归测试。任务按平台 ID 与课程／班级隔离；没有明确截止时间时保持未知，不使用课程结束时间代替，不依据标题推断考试类型。不移植上游的 Android 运行时、账号密码登录、作答、修改作业或官方 App 身份构造逻辑。本次没有移植 chaoxing-journal 或 GPL／AGPL 项目代码。

原许可全文：

```text
MIT License

Copyright (c) 2026 siye4366

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 试验性学习通页面适配参考

`packages/study/src/page.ts` 的章节目录、栏目、题目和文档原生控件选择器参考 zhu-hailin/chaoxing-ai-assistant，固定提交 `0d91475bfdf39c8e51031d96f0d658827aefd887`，MIT。参考文件包括 `course_catalog.js`、`sources/course-page-adapter.js` 和 `sources/question-parser.js`。CourseWatch 独立实现 Playwright 执行与模型请求、暂停和结果核验，早期实现没有打包上游脚本；后续完整保留固定版本的原始副本，见下节。运行接入仍不注入完整脚本，不使用其图标、UI、播放保护或解锁功能。构建 25 的字体还原使用固定副本中的 Typr.js、Typr.U.js（Photopea，MIT）及 table.json；MD5 使用 Node 内置 crypto。Typr 原版权及完整许可保留在 vendor/font/Typr-LICENSE.txt。

上游许可全文：

```text
MIT License

Copyright (c) 2026 zhu-hailin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 完整保留的学习通上游源码

保留以下两个固定提交的完整原始副本，原文件未经修改，根 LICENSE、文件头版权和上游说明均保留：

- `third_party/xuexitong-llm-assistant`：March-OwO/Xuexitong-LLM-Assistant，提交 `1c9e31cdabf8a637f454c41e42b6567385320855`，MIT，Copyright (c) 2026 March。6 个原文件，目前未接入执行。
- `third_party/chaoxing-ai-assistant`：zhu-hailin/chaoxing-ai-assistant，提交 `0d91475bfdf39c8e51031d96f0d658827aefd887`，MIT，Copyright (c) 2026 zhu-hailin。278 个原文件，目录读取经独立宿主桥调用完整的 `course_catalog.js`。

原文件与逐文件 SHA-256 位于应用包的 `Contents/Resources/app/third_party/`（Windows 为 `resources/app/third_party/`）；源码工作区位于根目录 `third_party/`。随分发文档保留两份原 LICENSE 和[接入说明](third_party/README.md)。CourseWatch 的原创代码条款不改变上述 MIT 权利。

完整副本包括上游保留的素材许可说明，其中字体映射表标记为 `upstream-not-specified`；保留副本不代表已核实该素材的独立再分发依据。构建 25 在本机加载该表用于题干及选项字形匹配；该表的独立素材许可仍未核实，本次仅本机构建。运行接入不执行上游完整 userscript、自动更新、播放保护或解锁功能。U校园 GPL-3.0 参考项目未复制到本目录，未作为 MIT 组件引入。
