# 上游原始副本

完整保留固定版本的上游文件，不修改、格式化或裁剪其中的源文件。接入代码放在 `packages/study/src/`，不得写入这两个上游目录。原文件不适用 CourseWatch 的原创许可或补充协议。

| 原始目录 | 来源与固定提交 | 根许可证与版权 |
| --- | --- | --- |
| `xuexitong-llm-assistant` | [March-OwO/Xuexitong-LLM-Assistant](https://github.com/March-OwO/Xuexitong-LLM-Assistant/tree/1c9e31cdabf8a637f454c41e42b6567385320855)，6 个文件 | MIT，Copyright (c) 2026 March |
| `chaoxing-ai-assistant` | [zhu-hailin/chaoxing-ai-assistant](https://github.com/zhu-hailin/chaoxing-ai-assistant/tree/0d91475bfdf39c8e51031d96f0d658827aefd887)，278 个文件 | MIT，Copyright (c) 2026 zhu-hailin |

各目录中的原 `LICENSE` 与上游文件头完整保留。`UPSTREAM-MANIFEST.json` 记录固定提交、下载归档 SHA-256 和每个原文件的 SHA-256；运行 `node scripts/verify-upstreams.mjs` 检查文件集合及字节是否变化。清单和本说明属于接入层，不是上游原文件。

目录由宿主桥加载第二个项目完整的 `course_catalog.js`，调用其中的目录读取函数，再把结果转换为 CourseWatch 的进度结构。宿主提供文本规范化、页面类型判断及每次调用内的临时成绩存储，不启动上游侧栏、导航、播放、模型或提交函数。未知完成状态在 CourseWatch 中保持待确认。第一个项目目前完整保留，但没有运行接入。

上游根 MIT 不自动覆盖外部素材。第二个项目 `vendor/font/manifest.json` 将字体映射表标为 `upstream-not-specified`；此副本保留原文件及原说明，构建 25 在本机使用该表及固定的 Typr.js／Typr.U.js 解析题目字形，不向页面注入解码脚本；不使用其中的图标或完整 userscript。Typr 的 MIT 版权及许可保留在 vendor/font/Typr-LICENSE.txt。其进一步公开再分发依据仍需核对，不能因为根 MIT 就标为已完成许可核查。

U校园 [UnipusAIAutoPlayer](https://github.com/uxudjs/UnipusAIAutoPlayer) 为 GPL-3.0，不在本目录中。U校园实现没有复制或注入该脚本。
