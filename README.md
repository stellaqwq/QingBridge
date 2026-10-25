# QQ AI Bot

基于官方 QQNT 内核的本地 QQ 机器人，提供 OneBot v11 兼容接口、扫码登录工作台和可选的 AI 自动回复。项目通过自研 N-API 宿主加载官方内核，不依赖 NapCat 或其他 QQ 机器人框架。

默认运行环境为 **Windows x64 + Node.js 24 或更高版本**。当前仍属于实验性适配，功能范围与验证状态见下表。

[快速开始](#快速开始) · [AI 配置](#配置-ai-回复) · [日常使用](#日常使用) · [接口认证](#onebot-与管理员接口) · [任务恢复](#任务重试与恢复) · [故障排查](#数据与故障排查)

## 功能与验证状态

| 功能 | 当前状态 |
| --- | --- |
| 手机 QQ 扫码登录 | 已完成实机验证 |
| 私聊文本发送、接收及本地消息查询 | 已完成实机验证；发送成功需匹配内核终态确认 |
| 群聊文本 | 已实现，尚未完成实机验收 |
| 好友列表、群列表、QQ 号到 UID 的主动解析 | 已接入 SDK 并有模拟回归，待补充实机验收 |
| 本地登录恢复、断线重连、宿主恢复 | 已实现并有模拟回归，待长期实机验证 |
| AI 回复 | 支持兼容 Chat Completions 的模型服务、会话白名单和持久化任务队列 |
| Web 管理台 | 全量分组配置、密钥管理、扫码与退出、保存后重启、消息监听、日志检索和任务核对 |
| OneBot 接入 | HTTP、正向 / 反向 WebSocket、webhook；具体动作受驱动能力限制 |
| 图片与表情包收发 | 发送支持 PNG / JPEG / GIF / WebP、Base64 / 本地路径 / HTTP(S) 和图文混排；接收先下载再推送可访问链接，支持 get_image；验收状态见 docs/IMAGES.md |
| 语音、文件、撤回、群管理 | 默认内核驱动尚不支持 |

文本收发实机验证使用 **QQ 9.9.36-53644，日期为 2026-10-24**；2026-10-25 在用户运行的 **QQ 9.9.27-45758** 上完成向机器人自身发送 Base64 PNG 的实机验证。版本、发送确认与接收记录见 [官方内核适配与实机验证](docs/KERNEL.md)和[图片与 AstrBot](docs/IMAGES.md)。这些记录不代表其他图片格式或后续 QQ 版本已完成实机验证。

## 快速开始

以下命令在项目根目录的 PowerShell 中执行。

### 1. 安装依赖并生成配置

```powershell
npm ci
npm run init
```

`init` 会创建 `.env`，生成独立的 OneBot Token、管理员 Token 和会话加密密钥。再次执行会保留已有有效配置；旧配置中缺失、过短或与其他接口复用的管理员 Token 会单独更新。

### 2. 准备官方 QQ 运行时

首次使用源码时，需要准备官方程序和宿主桥接。源码 ZIP 不包含 QQ 官方程序，`runtime/kernel/adapter.json` 由当前电脑生成，无需手工创建或从其他电脑复制。已准备好运行时的工作区可以跳过这一步。

如果本机已经安装 QQ，`start.cmd` 会尝试自动查找安装目录并准备独立运行时；也可指定 QQ 程序位置：

```powershell
npm run qq:prepare -- --from "C:/Program Files/Tencent/QQNT/QQ.exe"
```

上面的路径需替换为实际 `QQ.exe`。此过程不修改已安装的 QQ，也不复制账号数据。运行时已准备、仅缺失宿主或更换了 Node.js / 项目位置时，启动入口自动重新生成宿主文件。

没有可用 QQ 安装时，安装 7-Zip 后执行：

```powershell
npm run qq:download -- --prepare --activate
```

脚本读取 QQ 官网发布配置，下载安装包，验证腾讯 Authenticode 签名，然后解包、构建桥接并更新 `.env` 中的运行目录。它不会运行安装器或替换系统已安装的 QQ。自研桥接由项目内的 PE 生成器构建，无需额外安装 C/C++ 编译器。

7-Zip 不在默认位置时，先指定可执行文件：

```powershell
$env:QQ_7ZIP = 'D:/Tools/7-Zip/7z.exe'
npm run qq:download -- --prepare --activate
```

也可以从本机已安装的 QQ 准备运行时，见下文的[运行时维护](#运行时维护)。

### 3. 启动并扫码

```powershell
npm run launch
```

也可以双击根目录的 [start.cmd](start.cmd)。启动入口会初始化缺失的配置、启动机器人，并在默认浏览器中打开本机工作台。

使用手机 QQ 扫描页面上的二维码，再在手机上确认登录。管理台提供运行概览、消息监听、运行日志、任务队列和全部设置；二维码过期后最多连续自动刷新三次，也可手动刷新。

打开“全部设置”即可管理 AI 模型、系统提示词、好友与群白名单、QQ 驱动和运行目录、接口 Token、反向 WS、Webhook、并发与发送限制、数据目录和保留周期。支持搜索、读取模型列表、配置导入导出，密钥默认隐藏。保存后点击“重启生效”；详情见 [Web 管理台使用说明](docs/WEB.md)。

- 默认 OneBot 地址：`http://127.0.0.1:5700`。
- 工作台使用另一个随机本机端口和随机访问路径，以启动窗口打印的地址为准。
- 已有服务使用相同管理员凭据运行时，启动入口会复用该服务。
- 按 `Ctrl+C` 安全退出；只关闭浏览器标签页不会停止服务。复用已有服务时，退出启动入口仅关闭本次工作台。

通过 Web 保存配置或手动修改 `.env` 后都需要重启机器人服务。由当前工作台管理的服务可直接点击“重启生效”，工作台地址保持可用；若启动入口复用了其他进程的服务，应在原服务窗口停止它，再重新启动。环境变量覆盖的配置会标为不可编辑。

### 只体验界面或模拟流程

```powershell
# 工作台演示：不使用真实 QQ 账号，不调用模型服务
npm run launch -- --demo

# 不自动打开浏览器，手动访问打印的地址
npm run launch -- --demo --no-open

# 自动执行一次模拟消息 → 模拟 AI → 模拟回复流程，完成后退出
npm run demo
```

两个演示入口都使用独立临时数据；正常退出后清理演示数据。`--demo` 与 `--no-open` 可同时使用。

## 配置 AI 回复

推荐在 Web“全部设置 → AI 与回复”填写模型地址、模型标识和 API Key，再在“回复范围”填写实际的好友或群号，保存并重启。也可编辑 `.env`，将下面的模型标识和示例 QQ 号替换为实际值：

```dotenv
AI_ENABLED=true
AI_BASE_URL=http://127.0.0.1:11434/v1
AI_MODEL=your-model-id
AI_API_KEY=
AI_ALLOWED_USERS=10001,10002
AI_ALLOWED_GROUPS=
AI_GROUP_REQUIRE_AT=true
```

`AI_BASE_URL` 填写模型服务的基础地址，程序会追加 `/chat/completions`；项目本身不提供模型服务。服务要求认证时填写 `AI_API_KEY`。

AI 默认关闭。启用时必须填写模型标识，并至少配置一个允许回复的好友或群聊。白名单使用逗号分隔的正整数 QQ 号；群聊默认还要求 @机器人。自身发送的消息不会再次触发 AI，模型输出始终按纯文本发送。

默认内核驱动尚不支持发送 @ 消息段。群 webhook 快速回复默认发送纯文本；显式要求 `at_sender=true` 会返回未支持错误。

常用模型配置：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `AI_CONCURRENCY` | `4` | 不同会话的处理并发数，范围 1–16；同一会话保持顺序 |
| `AI_TIMEOUT_MS` | `45000` | 单次模型请求超时，包含响应正文读取 |
| `AI_MAX_ATTEMPTS` | `3` | 生成尝试总次数，范围 1–10；可重试错误采用指数退避 |
| `AI_CONTEXT_TURNS` | `10` | 每个会话保留的上下文轮数 |
| `AI_MAX_INPUT_CHARS` | `8000` | 单条 AI 输入长度上限 |
| `AI_MAX_REPLY_CHARS` | `1800` | 模型回复长度上限 |
| `AI_SYSTEM_PROMPT` | 见配置示例 | 模型系统提示词 |

完整配置见 [.env.example](.env.example)，实际默认值和校验范围以 [src/config.mjs](src/config.mjs) 为准。

### AstrBot 与表情包

在 AstrBot 创建 OneBot v11 机器人，本项目“全部设置 → OneBot 与推送”填写对应反向 WS 地址（同机通常为 `ws://127.0.0.1:6199/ws`）及相同 Token，保存后重启。由 AstrBot 负责回复时关闭本项目内置 AI。

图片发送支持 `image` 消息段、Base64、本机绝对路径、`file://` 和 HTTP(S) URL；GIF 保留原始字节。AstrBot 与 QQ 机器人不共享文件系统时，表情插件应启用 Base64 图片发送。图片读取、SDK 上传和终态确认完成后才返回成功，结果未知时不会自动重发。详情及限制见 [图片与 AstrBot 接入](docs/IMAGES.md)。

## 日常使用

以下命令连接已运行的机器人服务，并从 `.env` 读取对应接口凭据：

```powershell
# 查看运行状态与最近任务
npm run cli -- status
npm run cli -- jobs

# 查看联系人和群列表
npm run cli -- friends
npm run cli -- groups

# 发送文本；示例目标需替换为实际 QQ 号或群号
npm run cli -- send 10001 "你好"
npm run cli -- send-group 20001 "群聊测试"

# 查看消息与监听事件
npm run cli -- get 123
npm run cli -- watch 60
```

`get` 使用本项目返回的 OneBot 消息 ID。`watch` 的时长单位为秒，范围 1–3600。群聊发送命令已接入，但仍属于待实机验收能力。

### 分开运行服务与工作台

需要分别管理两个进程时：

```powershell
# 终端一：只启动机器人服务
npm start

# 终端二：只启动本机工作台
npm run login
```

也可不用网页，通过 CLI 申请二维码：

```powershell
npm run cli -- login --wait
npm run cli -- poll HANDLE
npm run cli -- logout
```

CLI 会把二维码写入 `DATA_DIR/qrcode-<标识>.png` 并打印文件路径。`poll` 的 `HANDLE` 使用登录接口返回的句柄。

默认内核驱动的 `logout` 会停止本地宿主并取消重连，**不会删除内核凭据，也不代表撤销远程授权**。

## OneBot 与管理员接口

默认监听 `127.0.0.1:5700`，由 `HOST` 和 `PORT` 配置。CLI 和独立工作台通过本机回环地址及 `PORT` 访问服务；一般保留默认 `HOST` 即可。

### 凭据分工

| 凭据 | 用途 |
| --- | --- |
| `ONEBOT_ACCESS_TOKEN` | 普通 OneBot HTTP 与正向 WebSocket 接入 |
| `ADMIN_ACCESS_TOKEN` | 运行状态、任务管理、扫码与本地退出 |
| `REVERSE_WS_TOKEN` | 反向 WebSocket 认证；留空时使用 OneBot Token |
| `WEBHOOK_SECRET` | webhook 的 OneBot v11 HMAC 签名 |
| `SESSION_KEY` | 实验性 native 驱动的本地票据加密；需为 64 位十六进制字符串 |

OneBot Token 和管理员 Token 均至少 24 个字符。管理员 Token 必须与 OneBot Token、反向 WS Token 不同，并且只接受 `Authorization` 请求头；不能用 URL 查询参数传入。管理员 Token 也不能作为普通 OneBot 接口凭据使用。

外部插件使用 OneBot 或反向 WS 凭据。工作台在本机服务端使用管理员凭据，不将其嵌入网页。默认内核驱动的账号凭据由官方 QQ 内核管理，不经过 `SESSION_KEY` 二次加密。

### 接口入口

| 入口 | 说明 |
| --- | --- |
| `GET /healthz` | 无需认证；检查进程存活 |
| `GET /readyz` | 无需认证；消息会话在线时返回 200，离线时返回 503 |
| `GET/POST /:action` | OneBot 动作，如 `/get_status`、`/send_private_msg` |
| `WS /` | OneBot API 与事件共用连接 |
| `WS /api`、`WS /event` | 分别用于 API 调用和事件接收 |
| `GET /admin/status` | 运行状态、账号、能力及任务概况 |
| `GET /admin/jobs` | 最近 50 条任务，包含生成次数、发送次数和下一次执行时间 |
| `POST /admin/login/{start,poll,logout}` | 分别申请二维码、轮询状态和本地退出 |
| `POST /admin/jobs/:id/resolve` | 人工核对未知发送结果 |

普通 OneBot 请求使用 `Authorization: Bearer <ONEBOT_ACCESS_TOKEN>`。例如，将占位符替换为实际 Token 后执行：

```powershell
curl.exe "http://127.0.0.1:5700/get_status" -H "Authorization: Bearer <ONEBOT_ACCESS_TOKEN>"
```

OneBot 动作采用 `status/retcode/data` 响应结构；`/admin/status` 直接返回对象，`/admin/jobs` 直接返回数组。接口存在不代表当前驱动支持该动作，具体能力可通过 `status` 查看。

设置 `REVERSE_WS_URLS` 可连接逗号分隔的反向 WebSocket 地址；设置 `WEBHOOK_URL` 可推送事件。协议与驱动扩展说明见 [驱动契约](docs/DRIVER.md)。

## 任务、重试与恢复

AI 任务与上下文保存在 SQLite 中。Worker 由消息入库、任务状态变化和连接状态变化唤醒；空闲时不循环查询任务，有延迟重试或等待任务将要过期时，按最早期限唤醒。即使关闭 AI 或 QQ 离线，`queued` / `ready` 任务仍按 `JOB_MAX_AGE_MS` 转为 `failed / expired`，释放容量和同会话阻塞；正在执行的生成、发送及 `uncertain` 不被此过期流程改写。

| 状态 | 含义 |
| --- | --- |
| `queued` | 等待生成回复 |
| `generating` | 正在请求模型 |
| `ready` | 已保存回复，等待发送或安全重试 |
| `sending` | 发送处理中，可能仍在限流器中排队 |
| `done` | 已确认发送成功 |
| `uncertain` | 发送结果未知，等待人工核对 |
| `failed` | 永久失败、重试耗尽、任务过期或人工丢弃 |
| `ignored` | 不符合 AI 策略或入队时容量已满 |

生成与发送分别限制尝试次数。`/admin/jobs` 中的 `attempts` 表示生成次数，`send_attempts` 表示发送次数，`next_at` 为下一次执行时间的毫秒时间戳。

发送侧只重试明确未送达且允许重试的错误，间隔为 1、2、4、8…秒，最高 30 秒。达到 `SEND_MAX_ATTEMPTS` 后记录为 `failed / send_attempts_exhausted`。同一会话串行，不同会话可并发，发送开始时间同时受全局与会话间隔约束。

优雅停机时，明确尚未提交的排队回复回到 `ready`，保留原回复且不消耗发送预算，重启后继续发送。已提交但结果不明的任务保持 `uncertain`，不会因超时、停机或重启自动重发。进程异常退出时遗留的 `sending` 也会保守恢复为 `uncertain`。

### 人工核对未知发送

先查看真实 QQ 记录，再选择处理结果：

```powershell
npm run cli -- jobs

# 已确认送达：标记完成并写入上下文
npm run cli -- resolve 123 sent

# 放弃这条回复：标记失败
npm run cli -- resolve 123 discard
```

`123` 为任务 ID。接口不提供自动重发选项，避免因确认丢失造成重复消息。

### 容量与保留期

| 配置项 | 默认值 | 作用 |
| --- | --- | --- |
| `MAX_PENDING_JOBS` | `1000` | AI 未完成任务容量，包含 `uncertain` |
| `MAX_PENDING_SENDS` | `1000` | 发送限流器的等待队列上限 |
| `SEND_CONCURRENCY` | `4` | 并行发送上限，范围 1–16 |
| `SEND_INTERVAL_MS` | `1500` | 全局发送开始间隔 |
| `SESSION_INTERVAL_MS` | `3000` | 同一会话的发送开始间隔 |
| `SEND_MAX_ATTEMPTS` | `5` | 每条回复的发送尝试总次数，范围 1–16 |
| `JOB_MAX_AGE_MS` | `600000` | 等待任务的有效期，默认 10 分钟；关闭 AI、QQ 离线或延迟重试时仍按时过期 |
| `HISTORY_RETENTION_DAYS` | `7` | 已完成、忽略、失败任务，以及上下文和消息缓存的保留天数 |
| `RETAIN_IGNORED_JOB_CONTENT` | `false` | 是否保留 ignored 任务正文；关闭时只保留防重和任务身份信息，并在启动时脱敏旧 ignored 记录 |
| `UNCERTAIN_RETENTION_DAYS` | `30` | 未知发送记录的保留天数，范围 1–3650 |

未知任务积累到容量上限时，新 AI 任务会以 `queue_full` 忽略，直到人工处理或清理释放容量。

清理在服务启动时和此后每小时执行。`uncertain` 按进入未知状态的更新时间保留；异常退出后恢复的任务从恢复时间起获得完整核对周期。**超期清理会删除记录中的消息与回复正文，不会补发。** 活跃任务不会被历史保留期清理直接删除。

旧数据库会自动补充发送计数字段，已有生成次数、回复和重试时间保留；历史发送次数无法追溯，新字段从 0 开始。

### 未回复消息如何保存

任务防重使用独立的 `event_key`，不需要保留消息正文。默认 `RETAIN_IGNORED_JOB_CONTENT=false` 时，`ignored` 任务的 `event` 只保存账号、会话、消息 ID、时间等身份字段及 `content_retained:false`；不保存 `message`、`raw_message`、昵称、附件，也清空 `input` / `reply`。容量不足而忽略的输入、策略变更后转为 ignored 的任务同样处理。事件仍会完整推送到 OneBot 和进程内消息监听页。

**升级后首次启动会按此默认值脱敏已有 ignored 任务正文，不能通过重新开启开关恢复。** 如需保留原有全文，应在启动新版前设置 `RETAIN_IGNORED_JOB_CONTENT=true`；开启后按 `HISTORY_RETENTION_DAYS`（默认 7 天）保留全文。开关可在 Web“数据与保留 → 保留忽略任务正文”修改，重启生效。脱敏保留事件键、状态、原因和时间，不影响防重；防重记录自身在保留期结束后删除。

这个开关只控制 `jobs` 表中 ignored 任务的正文。待处理、失败等其他任务、上下文及 OneBot 查询缓存仍可能保存原文；其中查询缓存独立于 AI 是否启用，同样默认保留 7 天。管理台消息监听只保存在进程内，QQ 官方 SDK、AstrBot 的数据由各自管理。数据库脱敏不等同于擦除已有备份或 WAL 中的旧内容。

管理台任务详情会分别解释筛选原因、正文未记录、正文已脱敏、原消息无文本等状态。脱敏改写条数、时间和环节会与改写操作一起写入持久审计表，并输出不含正文的运行日志；可在“任务队列 → 正文脱敏记录”查看。新记录从未保存正文时不算一次脱敏删除，旧版本未留下的审计不能补造。

## 运行时维护

官方运行时、桥接和账号数据分开保存：

| 配置项 | 默认路径 | 内容 |
| --- | --- | --- |
| `QQ_RUNTIME_DIR` | `./runtime/qq` | 官方 QQ 程序文件 |
| `QQ_KERNEL_DIR` | `./runtime/kernel` | 自研宿主桥接及构建元数据 |
| `QQ_KERNEL_DATA` | `./data/qq-kernel` | 官方内核管理的账号数据和诊断信息 |
| `DATA_DIR` | `./data` | 消息数据库、任务队列与本地运行锁 |

下载脚本通常使用带版本的运行目录；`--activate` 会更新 `.env` 中的实际路径并保留已有密钥。停止服务后可再次执行准备命令获取官网发布的版本，更新后重新启动。新版本是否兼容仍需验证。

使用本机已安装的 QQ 时：

```powershell
npm run qq:setup -- --from "C:/Program Files/Tencent/QQNT/QQ.exe" --to ./runtime/qq
npm run qq:build
```

将示例路径替换为实际位置，并确保 `.env` 的 `QQ_RUNTIME_DIR` 指向目标目录。`qq:setup` 不覆盖已有目标目录，也不复制账号数据或日志。

宿主桥接绑定构建时使用的 Node 可执行文件和 QQ 运行时。更换 Node 或移动运行目录后，需要停止服务并重新执行 `npm run qq:build`。官方程序和原始 `wrapper.node` 保持不变，启动时会校验运行文件与构建元数据。

`QQ_ACCOUNT=0` 表示由扫码确定账号；指定 QQ 号后会拒绝其他账号。启动时会尝试恢复唯一可快速登录的本地账号，有多个候选账号时需指定账号或重新扫码。

## 数据与故障排查

同一个 `DATA_DIR` 只允许一个机器人实例，以防重复消费和发送。正常停机释放运行锁；不要通过删除运行中的锁文件来启动第二个实例。

备份前先停止服务，再备份 `.env`、`DATA_DIR` 和自定义位置的 `QQ_KERNEL_DATA`。这些目录可能包含密钥、登录凭据和消息正文。

常见现象：

| 现象 | 检查方式 |
| --- | --- |
| Node 版本不符或缺少依赖 | 确认使用 Node.js 24+；在项目根目录执行 `npm ci` |
| 缺少运行时或桥接校验失败 | 检查 `QQ_RUNTIME_DIR`、`QQ_KERNEL_DIR` 和 `QQ_KERNEL_DATA`；按需重新准备运行时或构建桥接 |
| 端口被占用或管理员凭据不一致 | 查看原服务窗口；确认 `PORT` 与 `.env` 一致，重启旧服务后再试 |
| `/healthz` 正常但 `/readyz` 返回 503 | 服务存活但消息会话未在线，查看工作台扫码和连接状态 |
| QQ 已连接但 AI 不回复 | 检查 `AI_ENABLED`、模型服务、白名单、群聊 @ 条件及任务队列 |
| 任务以 `queue_full` 忽略 | 查看 `jobs`，核对积累的未知发送记录或调整容量 |
| `login_required` | 本地凭据无法继续恢复，需要重新扫码 |
| 宿主退出或初始化失败 | 查看内核数据目录的 `validation.json` 与 `host-stderr.log` |

`validation.json` 记录登录和消息链路的里程碑，不包含消息正文、二维码或票据。`host-stderr.log` 最多保留 256 KiB，重连前保留上一份为 `host-stderr.previous.log`；这些仍属于本地诊断数据。

宿主默认有 5 秒完成正常关闭，超时后才强制终止，可通过 `QQ_SHUTDOWN_TIMEOUT_MS` 调整。网络或宿主异常的恢复采用 1–30 秒退避；凭据失效时等待扫码，不无限重试认证。

## 测试与源码导出

```powershell
npm run check
npm test

# 只运行调度与停机回归文件
npm test -- test/worker-scheduling.test.mjs test/worker-shutdown.test.mjs

# 导出可分享的源码目录
npm run source:export
```

最近一次完整回归为 **105 项全部通过**。测试包含模拟驱动、合成协议端和宿主状态机，覆盖认证隔离、消息确认、AI 队列、重试、停机、数据库迁移与数据保留；它们不替代实机验证。

`npm test` 将严格结果写入 `dist/test-results.json`。只有所有选中测试完成且全部通过，失败、取消、跳过及待办数均为 0，才返回成功。每次运行会先将旧报告标记为未完成；CI 应同时检查退出码和报告的 `success/complete`。

源码导出会创建新的 `dist/source-<时间戳>` 目录及 SHA256 清单。导出范围按白名单选择，排除 `.env`、账号数据、运行时、数据库、票据和日志，并拒绝源码中的符号链接。分享时压缩导出目录，不要直接打包原始工作目录。

### Docker 与其他驱动

默认 `kernel` 驱动仅支持 Windows x64，不能放入仓库提供的 Linux 镜像中运行。Compose 要求显式设置 `QQ_DOCKER_DRIVER=native`、`demo` 或 `scaffold`；容器使用独立数据卷，通过 `/readyz` 做健康检查。

`native` 是仍需匹配签名服务的实验性协议研究路线，尚无真实账号验收；`demo` 是模拟驱动，`scaffold` 仅提供离线骨架。Docker 构建和真实 QQ 容器运行尚未验收。

## 项目文档

- [官方内核适配与实机验证](docs/KERNEL.md)
- [驱动接口契约](docs/DRIVER.md)
- [研发进度与待验收项目](docs/ROADMAP.md)
- [native 协议研究](docs/NATIVE.md)
- [历史 OneBot / AI 运维说明](docs/LEGACY_PROTOCOL.md)
- 历史问题核查：[第一轮](docs/REVIEW-2026-10-24.md)、[第二轮](docs/REVIEW-2026-10-24-ROUND2.md)、[第三轮](docs/REVIEW-2026-10-24-ROUND3.md)。
