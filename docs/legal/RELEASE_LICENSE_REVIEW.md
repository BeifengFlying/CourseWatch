# 测试分发许可核查

许可变更日期：2026-11-15。当前分发自 0.2.32（构建 32）起采用下列许可。历史依赖核查始于 2026-11-12，本次不代表重新完成全部二进制组件的权利审计或法律审查。

## 当前许可证

从构建 32（0.2.32）起，新版有权许可的原创内容采用 [CourseWatch 非商业许可证 1.0](../../LICENSE)，使用与再分发要求见[中文项目协议](../../TERMS.md)和[英文项目协议](../../TERMS.en.md)。禁止商用范围包括收费分发、收费部署及代学代刷服务、集成到收费产品或服务，以及广告获利。非商业再分发须显著保留禁止商用标注。

这是自定义非商业许可，不属于标准 Apache-2.0，也不属于 OSI 定义的开源许可。`package.json` 与锁文件标注 `SEE LICENSE IN LICENSE`；中英文 README、NOTICE 和免责声明同步说明。

此前已授予的 Apache-2.0 等许可不追溯撤回。标准 Apache-2.0 文本逐字保留在 [licenses/Apache-2.0.txt](../../licenses/Apache-2.0.txt)，用于对应历史授权及适用组件的说明，不是对新版新增原创内容再次授予 Apache-2.0 许可。下架旧安装包、重建公开源码历史或删除旧分支和标签只处理分发入口，不撤销既有授权，也不能阻止已取得旧版的人按原许可商用旧版或原授权内容。GitHub 保留对象、提交哈希直达内容、缓存及外部副本不保证被清除。

非商业许可仅覆盖权利人有权按该条件许可的内容。第三方组件、外部贡献及已按其他许可公开的历史代码，应分别核实权利和许可范围；不能仅凭更换根 LICENSE 声称全部历史作品已受新限制保护。具体成立及可执行性需结合适用法律、版权归属及贡献授权审查。

## LX Music 参考核对

2026-11-15 核对 LX Music 桌面版固定提交 `323e4bac505da428adae8db6b58039fb2b36b86d` 的 [LICENSE](https://github.com/lyswhut/lx-music-desktop/blob/323e4bac505da428adae8db6b58039fb2b36b86d/LICENSE) 与 [README 项目协议](https://github.com/lyswhut/lx-music-desktop/blob/323e4bac505da428adae8db6b58039fb2b36b86d/README.md#项目协议)。其标准 LICENSE 为 Apache-2.0，项目协议第 8.1 条写明不接受商业合作及捐赠，没有明确规定一概禁止第三方商业使用。

CourseWatch 保留免费测试、不接受商业合作或捐赠的项目运营要求，但新版禁止商用来自独立的自定义非商业许可证，不将其归因为 LX Music 或 Apache-2.0 自带条款。项目未因参考协议结构取得 LX Music 的品牌或源码归属。

## 分发与验证边界

- macOS 和 Windows 使用同一分发文档复制入口，随包保留新 LICENSE、中英文项目协议、NOTICE、免责声明、隐私说明、第三方声明及历史 Apache-2.0 文本。
- 所有新安装包不附带浏览器，使用用户独立安装的 Chrome／Edge。历史浏览器许可核查仅适用于曾包含浏览器的旧包。
- 历史安装包及其校验文件在本地独立归档；GitHub 上旧 Releases 附件及旧 Actions 安装包产物另行下架，具体检查记录见[构建 32 验证](../verification/RELEASE-0.2.32.md)。
- `private: true` 只防止意外发布 npm 包，不是版权许可。公开源码、标注来源和声明侵权后删除均不能代替必要授权。
- 四项既有界面依赖缺少随包完整许可文本，仍须按下列未决事项处理。未把本机构建通过视为公开分发权利审计通过。

## 分发前仍需确认

1. **平台图标的再分发依据。** [来源记录](../../apps/extension/public/platforms/README.md) 记录素材获取来源，使用授权仍需另行确认。需要核对各平台标识使用规则、取得授权，或在分发版本中改用自有图标／文字标识。声明“侵权联系删除”不能代替授权。
2. **浏览器二进制条款与组件义务。** 当前下载实际为 Google Chrome for Testing，并非仅由 Chromium BSD 许可覆盖。本机版本 `158.0.8127.18` 的 `chrome://terms` 指向 Google 服务条款及 Chrome 附加条款；`chrome://credits` 提供组件归属和许可。需要核对当前版本的再分发条件、完整组件通知、适用源码提供义务及编解码器／专利条款，并保存与发布版本一致的依据。不能把 Playwright 的 Apache-2.0 当作整个浏览器的许可证。资料：[Chrome for Testing](https://github.com/GoogleChromeLabs/chrome-for-testing)、[Google 服务条款](https://policies.google.com/terms)、[Chrome 附加条款](https://www.google.com/chrome/terms/)。
3. **部分 npm 包缺少完整许可文本。** 本机依赖中 `css-render@0.15.14`、`@css-render/plugin-bem@0.15.14`、`@css-render/vue3-ssr@0.15.14` 和 `vdirs@0.1.8` 的包元数据标明 MIT，但发布包根目录未带许可文本。需要按实际使用版本从上游取得完整许可及版权声明，或证明对应代码未进入最终产物；不能用自行填写的 MIT 模板冒充原始声明。打包后的 `UI-LICENSES/INDEX.txt` 标记这些缺件；更新依赖后应重新核对。
4. **平台访问规则。** 持有本人账号不自动获得自动采集许可。需核对学校和平台规则；如果平台禁止，应停止相关适配或另行取得许可。开源许可证和免责声明都不能约束第三方平台。
5. **发布者与联系渠道。** 当前源码仓库为 [BeifengFlying/CourseWatch](https://github.com/BeifengFlying/CourseWatch)，README 使用提供测试包的原有渠道反馈；尚未确认独立的维护者邮箱或隐私联系人。公开发布前应确认长期可用的反馈渠道及 NOTICE 的权利人署名。
6. **安装前告知与免责效力。** DMG 中可读文件提供告知入口，但本次没有实现安装前确认、应用首次启动提示或条款版本留存。是否需要这些流程、免责条款的提示方式与法律效力，应结合分发地区、对象和收费方式审查，不能仅靠“使用即同意”。

上述事项尚有未决项，完整分发许可核查尚未完成。旧 DMG 不会因仓库文件更新而自动包含这些文件；重新构建后仍需检查实际产物。

## 发布包核对

- 确认版本、构建号、架构及本次真实验证范围，重新构建对应架构；不要把早期 Intel 包当成本次版本。
- 检查 `CourseWatch.app/Contents/Resources/` 与 DMG 根目录的 LICENSE、TERMS.md、NOTICE、DISCLAIMER.md、PRIVACY.md、THIRD_PARTY_NOTICES.md、README.md 和平台来源记录；查阅 `UI-LICENSES/INDEX.txt`，处理缺失许可。
- 检查 Node 的 `NODE-LICENSE.txt`、服务端依赖内许可／NOTICE、浏览器组件许可与源码义务；记录所用浏览器版本和来源。需要附源码、书面要约或其他材料的组件应按其具体条款处理。
- 确认安装包不含真实账号、Cookie、会话、数据库、日志、签名密钥或个人文件。此步骤需要针对实际发布产物执行。
- 连同安装包提供 SHA256、测试版说明和已知限制。Apple 开发者签名／公证属于另一个发布事项，临时签名不代表经过 Apple 审核。
