# 2026-11-12 安全审计

本次审计覆盖本地服务、采集适配器、会话存储、浏览器扩展与两端桌面壳。审计结果分为已确认问题和未发现问题的检查范围。

## 范围与方法

- 源码：`apps/local-service`、`packages/{adapters,contracts,core,storage,notifications}`、`apps/extension`、`apps/macos`、`apps/windows`、`scripts`、`.github/workflows`。
- 本地实测：用临时数据目录启动 `createServer({ test: true })`，以 `app.inject` 发请求，不触碰现有数据目录与真实账号。
- 基线：`npm test` 12 个文件 85 项通过；`npm run typecheck` 通过；`npm audit --omit=dev` 报告 0 个已知漏洞。
- 未执行：真实教学平台的登录与列表请求、真机界面操作、打包产物与源码的一致性核对、Chromium 沙箱开启后的启动验证。

## 结论

| 编号 | 级别 | 位置 | 问题 |
| --- | --- | --- | --- |
| A1 | 中 | `packages/adapters/src/browser.ts:30,39` | 登录与采集用 Chromium 实际以 `--no-sandbox` 启动 |
| A2 | 低 | `apps/local-service/src/main.ts:48` 等 | 固定回环端口承载明文令牌，存在本地端口抢占与令牌捕获 |
| A3 | 低 | `apps/local-service/src/server.ts:64,729` | 未授权静态请求可耗尽全局限流，界面暂时不可用 |
| A4 | 低 | `packages/contracts/src/index.ts:184-207` | 只读地址过滤不检查查询串 |
| A5 | 低 | `apps/local-service/src/server.ts:311-336` | 修改日程不校验时间是否在未来 |
| A6 | 低 | `packages/storage/src/index.ts:62` | 数据库备份文件权限为 0644 |
| A7 | 低 | `packages/adapters/src/manager.ts:23-28` | 采集子进程继承原生令牌 |
| A8 | 低 | `packages/contracts/src/index.ts:76` | 任务 URL 未限制协议，界面直接绑定到 `href` |
| A9 | 信息 | 多处 | 令牌生命周期、CORS 扩展放行、日志含配对码、CI 引用标签、密钥进入 argv |

## 详细

### A1 Chromium 以 `--no-sandbox` 启动

位置：`packages/adapters/src/browser.ts` 的 `browserLaunchOptions()` 只返回 `channel` 或 `executablePath`，`packages/adapters/src/index.ts:52` 把返回值原样传给 `chromium.launchPersistentContext()`。

依据：安装的 playwright-core 1.65.0 在构造启动参数时执行 `if (options.chromiumSandbox !== true) chromeArguments.push("--no-sandbox")`。项目没有传 `chromiumSandbox`，所以登录窗口和无头采集都带 `--no-sandbox`。

影响：登录窗口是普通 Chromium 窗口，可导航到任意站点，并使用独立 profile 保存平台会话；采集进程同样加载远程页面。缺少渲染进程沙箱后，页面的渲染进程漏洞直接变成用户权限的代码执行。采集子进程还继承原生令牌（见 A7）。

修复：在 `browserLaunchOptions()` 中加 `chromiumSandbox: true`，分别验证完整版（内置 Chromium）与精简版（本机 Chrome/Edge）的登录和采集。若个别组合无法启动，记录具体组合，不要默认关闭。

### A2 固定回环端口与令牌捕获

位置：`apps/local-service/src/main.ts:48` 固定监听 17321；`apps/extension/lib/api.ts:1-3`、`apps/macos/main.swift:5`、`apps/windows/LocalService.cs:11` 都写死同一地址。令牌保存在扩展页与 WebView 的 `localStorage`。

现象：客户端向 `http://127.0.0.1:17321` 发送 `Authorization: Bearer <token>`，令牌没有过期时间，也没有撤销接口。

影响：同一台机器上的其他本地用户可以在该端口空闲时先绑定（1024 以上端口无需特权），接收扩展或界面的请求，取得令牌与 `Origin`；真实服务恢复后可用该令牌读取任务、日程、变化记录和检查日志。同一用户的进程本来就能读数据目录，因此此项主要针对多用户机器。

修复：改用随机端口并把端口写入 0700 数据目录；或在客户端发送令牌前，用数据目录中每次启动生成的随机值确认服务身份。macOS 可改用 unix socket，Windows 可使用命名管道。保留固定端口时，至少缩短令牌有效期并提供撤销。

### A3 未授权静态请求耗尽全局限流

位置：`server.ts:64` 注册 `{ max: 120, timeWindow: "1 minute" }`，按 IP 计数、所有路由共用；`server.ts:729` 注册静态根目录；`server.ts:125-178` 的认证钩子对未授权 `/api/*` 直接返回，不进入路由级限流钩子，而静态请求会进入。

实测（临时数据目录）：连续 130 次 `GET /`，无令牌、无 Origin，得到 120 次 200、10 次 429；随后带有效令牌的 `GET /api/health` 返回 429“请求过于频繁”。

影响：任意网页可用不携带 Origin 的 GET 子资源请求（如 `<img src="http://127.0.0.1:17321/">`）反复请求静态首页，约 120 次/分钟的请求可使界面持续收到 429，直到限流时间窗结束。浏览器对公网页面访问回环地址的策略不同（Chrome 的本地网络访问限制会拦截一部分），因此列为低。

修复：把 Host/Origin 校验放到限流之前，或只对 `/api/*` 限流、静态资源单独计数；同时可结合 `Sec-Fetch-Site` 拒绝跨站 GET。

### A4 只读地址过滤未覆盖查询串

位置：`packages/contracts/src/index.ts` 的 `decodedPlatformPath()` 只拼接 `pathname` 与 `hash`，`safePlatformReadUrl()` 与 `safeMonitorUrl()` 都基于该结果。

实测：`safeMonitorUrl("renwei", "https://tk.ipmph.com/exam/a/exam/examTask/myExamTaskList?method=submit")` 返回 `true`；`PATCH /api/platforms/renwei` 接受并保存该来源，返回 200。

影响：平台若把动作放在查询参数里（如 `?action=delete`、`?method=submit`），带会话的 GET 仍会被发出，`submit|delete|logout` 等词过滤失效。触发条件是用户配置该地址，或官方页面重定向到该地址。

修复：把 `url.search` 纳入检查；或对监控来源统一拒绝非空查询串，确需保留时使用参数白名单。

### A5 修改日程不校验未来时间

位置：`server.ts:311-336` 的 `dueAt` 只有 `z.number().int().positive()`；创建接口在 `server.ts:295-296` 拒绝过去时间。

实测：创建未来日程后，`PATCH /api/schedules/:id` 把 `dueAt` 改为昨天，返回 200 并写入。

影响：与创建规则不一致；会立即触发 0 小时提醒并产生过期项，没有数据破坏。

修复：PATCH 复用与创建一致的 `dueAt > Date.now()` 校验。

### A6 备份文件权限 0644

位置：`packages/storage/src/index.ts:62-64` 直接调用 `db.backup(path)`；`server.ts:477-487` 把备份写进数据目录。

实测：在已存在且权限为 0755 的数据目录中创建 Store 并备份，`coursewatch.db` 为 600、`-wal`/`-shm` 为 600、`backup-test.db` 为 644。

影响：数据目录已存在时 `mkdirSync(..., mode: 0o700)` 不会收紧权限（`main.ts:6`、`storage/index.ts:18`），此时同机其他用户可读备份中的任务、日程和历史。正常安装的数据目录是 0700，不构成泄露。

修复：备份完成后 `chmod 0600`；启动时对数据目录执行 `chmod 0700`，失败则提示。

### A7 采集子进程继承原生令牌

位置：`packages/adapters/src/manager.ts:23-28` 用 `env: { ...process.env, COURSEWATCH_WORKER_DIR: this.dir }` 启动采集进程。

影响：承载 Chromium、加载远程页面的 worker 持有 `COURSEWATCH_NATIVE_TOKEN`，可调用 `/api/native/*` 与全部业务接口。该进程是攻击面最大的进程，令牌对它不是必需。

修复：只传 `COURSEWATCH_WORKER_DIR` 与必要的 `PATH`、`HOME` 等，去掉原生令牌相关变量。

### A8 任务 URL 未限制协议

位置：`packages/contracts/src/index.ts:76` 的 `url: z.string().url()`；`apps/extension/components/Desktop.vue:1117-1122` 把 `t.task?.url` 绑定到 `href`。

实测：zod 的 `z.string().url()` 接受 `javascript:alert(1)` 与 `data:text/html,...`。

现状：两个适配器写入前都用 `safePlatformUrl()`（https、官方域名、无凭据）过滤，当前没有可达的注入路径。契约本身不保证这一点，后续新增采集路径或手工修改数据库时会把 `javascript:` 交给 `href`。

修复：契约层只接受 `https:`；界面绑定 `href` 前再校验一次。点击处理已有 `safePlatformUrl`，但中键和右键菜单走原生 `href`。

### A9 信息项

- 配对令牌写入后长期有效，没有撤销接口（`server.ts:207-213`，`clients` 表）。
- CORS 放行任意 `chrome-extension://[a-p]{32}`（`server.ts:123-124`）。令牌仍是唯一控制，构建扩展时写入固定 key 后可缩到单一 ID。
- 打包版后台 stdout 写入 `desktop-service.log`，其中包含一次性配对码（`main.swift:400-426`、`main.ts:52-54`）；文件权限 0600，原生模式实际不需要配对码。
- CI 的 action 使用 `@v4` 标签而非提交 SHA（`.github/workflows/ci.yml`、`windows.yml`）；工作流已设只读权限。
- macOS 会话密钥通过 `/usr/bin/security ... -w <key>` 写入，密钥出现在进程参数中（`packages/adapters/src/vault.ts:36-44`）。可改用 Security framework 或交互式输入。

## 已核对未发现问题

- 认证边界：`req.routeOptions.url` 判断已覆盖 `/api`、`/%61pi`、`a%70i` 等编码形式；缺少令牌、错误令牌返回 401，普通配对令牌访问 `/api/native/*` 返回 403，Host 或 Origin 不符返回 403。预检请求返回 204 但不读写数据。2026-11-12 修复在源码与 `dist/server` 编译产物中均存在，测试未发现回归。
- 路径遍历：`/../../package.json`、`%2e%2e`、`..%5c` 等请求未读到 `dist/web` 之外的文件。
- SQL：39 处查询均为参数化，没有把外部字符串拼进 SQL。
- SSRF 与重定向：`safePlatformUrl()` 校验 https、精确主机名、无凭据、默认端口；`getPlatformPage()` 不自动跟随重定向，逐跳校验、最多 5 跳、共享超时，并限制 4 MB 响应体。
- XSS：Vue 模板没有 `v-html`、`innerHTML`、`dangerouslyUseHTMLString`；`TextLinks` 只识别 http(s) 且拒绝带凭据的 URL；CSP 没有脚本 `unsafe-inline` 或 `unsafe-eval`。
- 原生桥：macOS 校验主框架、`securityOrigin` 与端口；Windows 校验 `e.Source` 与 `IsLocal()`；导航只放行本地地址或 https 官方域名；通知与待办参数经 JSON 序列化传入。
- 桌面壳：WebView2 关闭 host objects、DevTools、权限请求与下载，跨源导航被拦截；macOS 使用非持久化数据存储。
- 安装器：`PrivilegesRequired=lowest`，安装到 `%LOCALAPPDATA%`，不请求管理员权限。
- 其余：请求体上限 64 KB、请求超时 30 秒、错误响应不返回内部细节、配对码 10 分钟有效且失败 12 次后锁定、比较使用 `timingSafeEqual`。

## 未覆盖

- 未向真实平台发送任何请求，不判断具体平台页面是否会触发上述 URL 过滤缺口。
- 本机环境无法完成 Chromium 启动（进程未返回），因此没有验证加 `chromiumSandbox: true` 后两种打包方式都能启动。
- 未做真机 macOS 14 与 Windows 11 的界面、通知投递与长时间运行测试。
- `dist/*.dmg` 未重新打包，本次不核对现有安装包与当前源码的逐字节一致性。
