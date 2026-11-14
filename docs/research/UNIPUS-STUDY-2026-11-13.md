# U校园自动学习 MIT 候选核查

后续实施范围已调整，新增基于可见原生控件的独立执行流程，范围及未验证项见 [实现记录](../verification/UNIPUS-STUDY-2026-11-13.md)。以下保留此前候选核查结论。

核查日期：2026-11-13（Asia/Shanghai）。本次只读取公开仓库和选定源码，没有登录 U校园、调用学习接口、导入脚本或修改真实学习记录。搜索通过 agent-reach 的 GitHub 渠道，固定文件通过 GitHub API 读取。

该阶段优先评估 MIT 项目的复用，不新增独立执行器。候选中存在 MIT 项目，但尚未确认可适配 CourseWatch 宿主，并满足人工验证、凭据与学习记录要求的完整实现，因此当时未接入自动学习。原有课程与任务同步保留。候选范围与结论如下。

| 项目与固定版本 | 核查范围 | 判断 |
| --- | --- | --- |
| [lxbsdsg/Unipus-Helper](https://github.com/lxbsdsg/Unipus-Helper/tree/1e1bbff7fa06f5e98340a5b507b8fb819ff7080e) | README、LICENSE、config.py、api/client.py、core/unit_situation.py；根 MIT，Copyright 2025 Duster-Cule | Python/FastAPI 独立应用。学习链路包含本地构造访问令牌、答案读取、直接提交及计时上报，不作为可直接嵌入的执行器；没有复制这些模块 |
| [HONGHUTECHNOLOGY/honghueasystudy](https://github.com/HONGHUTECHNOLOGY/honghueasystudy/tree/ee40e2072b0066c4a19b6271ff52b206c83d035b) | 根 LICENSE、packages/scripts/src/projects/unipus.ts、unipus/exploration.ts；根 MIT，Copyright 2022 enncy | 依赖 easy-us、@honghu/core、脚本存储、RemotePage 宿主和外部题库。普通版跳过视频；另一学习路径包含随机应答视频弹题和倍速设置。移植需要另做宿主、配置、生命周期及任务范围改造，不能认定为已可用于 CourseWatch |
| [jianmo0904/UnipusAI](https://github.com/jianmo0904/UnipusAI/tree/18dd9b2b8055d88064c2c36c6b1f2c63baa3d8e5) | README、根 LICENSE、文件清单；根 MIT，Copyright 2026 jianmo0904 | README 明确依赖绕过防作弊检测，并包含复制他人讨论回答。未接入，未继续复现这些行为 |
| [chenad0/Unipusai](https://github.com/chenad0/Unipusai/tree/91d0cdf002c3bebd063b3219b05b56c2ae2b0d15) | README、根 LICENSE、约一万行脚本的元数据及选定录音处理；根 MIT，Copyright 2026 wenliu | 有模型答题功能，但同时带有示例音频替换录音／回放等处理，未作为整体脚本注入或复制；没有完成所有代码与当前页面的兼容核查 |

MIT 解决的是相应代码的许可问题，不代表学校或平台允许这些操作，也不能证明当前账号、教材或页面可用。没有因根许可而复制外部题库、平台内容或其他资产。

若后续找到可复用方案，应先限定为正常授权会话、正常播放和明确用户操作，验证暂停、停止、异常和进度来源，再决定是否纳入；本次没有实施这些后续工作。
