# 图片收发与 AstrBot

官方内核驱动的 `message.send` 现在接受 `text` 和 `image` 消息段，可发送单张图片或有序的图文混排。图片的 MD5、尺寸、格式和文件大小由本机实际读取后计算，交给官方 SDK 的图片元素处理上传，再等待同会话、同消息 ID 的终态确认。没有把不支持的图片丢弃或伪报成功。

## 输入与格式

支持 PNG、JPEG、GIF 和 WebP；GIF 保留原始字节，不转换为静态图片。支持以下 `image.data.file`：

| 来源 | 示例 |
| --- | --- |
| Base64 | `base64://<图片的 Base64>` |
| Data URL | `data:image/png;base64,<图片的 Base64>` |
| 本地绝对路径 | `D:/images/sticker.gif` |
| 本地文件 URL | `file:///D:/images/sticker.gif` |
| HTTP(S) | `https://example.com/sticker.png` |

本地路径必须存在于运行 QQ 机器人的主机。容器或远程 AstrBot 应使用 Base64 或机器人可访问的 HTTP(S) 图片地址；不能把容器内路径当作 Windows 主机路径。`file://远程主机/...` 不支持。

消息段可设置 `summary`、`sub_type`（0 普通图片、1 图片表情）及 `original`。GIF 默认按图片表情构造。闪照、商城表情专用消息段、语音、视频、普通文件及其他尚未实现的段仍明确失败；不能仅因 `can_send_image` 返回 true 就假定所有媒体均可用。

## AstrBot 配置

1. AstrBot 创建并启用 OneBot v11 实例，配置反向 WebSocket 监听端口与 Token。
2. 本项目“全部设置 → OneBot 与推送”填写地址。两者直接运行在同机时通常为 `ws://127.0.0.1:6199/ws`；Docker 或跨主机环境需填写实际可达地址。两端使用相同反向 WS Token，不能使用管理员 Token。
3. 保存并重启，连接 QQ。由 AstrBot 管理模型与回复时，关闭本项目内置 AI，避免重复回复。
4. `meme_manager` 可以使用普通 `image` 图片消息。如果 AstrBot 与机器人文件系统不同，在插件设置中启用“以 Base64 发送图片”。流式模式在文本之后独立发送图片也走同一发送链路。

这里的支持范围是图片传输，不代表实现了 AstrBot 全部插件可能调用的 OneBot API；例如群管理、引用回复、发送 @ 和文件消息仍受驱动能力限制。

## 接收图片与 AstrBot 识图

QQ 的 `sourcePath` 可能只是尚未下载的目标路径。收到图片后，宿主会先读取已有有效文件；文件不存在时，通过官方 SDK 按消息与图片元素 ID 下载原图，等待匹配的下载完成回调，再校验实际图片格式、尺寸和大小。不会将不存在的本机路径直接交给 AstrBot。SDK 元数据中的 MD5 可能对应压缩前图片，缓存校验使用实际下载内容计算的 MD5，避免误拒绝 QQ 已重新编码的图片。

接收图片缓存位于 `QQ_KERNEL_DATA/media-inbox`。OneBot 事件的 `image.data.file` 为缓存文件标识，`image.data.url` 为可下载链接；`get_image` 返回大小、文件名、本机路径和同一图片链接。链接只授权对应图片，不携带 OneBot 或管理员 Token，也不能选择任意文件路径。无效链接、被篡改的内容和已清理图片返回 404。缓存保留天数同时控制 inbox 与 outbox。

AstrBot 和机器人在同一 Windows 主机时，`MEDIA_BASE_URL` 留空即可。跨主机或容器时，在“全部设置 → OneBot 与推送 → 图片访问地址”填写 AstrBot 能访问的地址，例如 `http://192.168.1.10:5700`；同时将 OneBot 监听地址配置为实际网卡或 `0.0.0.0`。仅填写协议、主机和端口，不含账号密码、路径或查询参数。

同一会话的消息按顺序处理，其他会话可继续接收。某张图片下载失败或超时，会保留文字并使用明确的失败提示，不生成虚假的图片路径。旧历史中的路径型图片可通过 `get_msg` 重新下载读取，但不会重放给 AstrBot、触发模型回复或自动改写 AstrBot 已有的对话记录。更新后新收到的消息使用新链路，之前的对话预览不会自动补图。

## 大小、超时与缓存

以下参数均可在 Web 设置中修改，保存后重启生效：

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `MEDIA_MAX_BYTES` | 10485760 | 单张图片以及一条消息内所有图片总量上限，默认 10 MiB |
| `MEDIA_TIMEOUT_MS` | 90000 | 图片读取/下载、上传与发送确认的总超时，默认 90 秒 |
| `MEDIA_CACHE_DAYS` | 7 | 图片发送缓存保留天数 |
| `ONEBOT_MAX_REQUEST_BYTES` | 16777216 | HTTP 与正向/反向 WS 请求大小上限，默认 16 MiB |
| `MEDIA_BASE_URL` | 空 | 接收图片链接的 HTTP(S) 访问地址；同机自动选择，跨主机或容器时填写 AstrBot 可访问的 OneBot 地址与端口 |

Base64 通常占原图约 4/3 的空间，需给 JSON 消息留出余量。旧的 1 MiB WS 限制已移除；超过新上限仍会明确失败或按 WS 协议关闭超大帧。

本项目缓存位于 `QQ_KERNEL_DATA/media-outbox`，按文件内容命名、校验已有内容并自动清理到期文件；使用中的图片不会被清理。提交前通过 SDK 的 `getRichMediaFilePathForGuild` 获取媒体目录，并将已校验图片放入其中，解决旧版 QQ 内核直接读取通用缓存时出现的 `rich media transfer failed`。SDK 返回的路径必须在 `QQ_KERNEL_DATA` 内，不能指向外部符号链接。

`MEDIA_CACHE_DAYS` 控制本项目的 outbox；SDK 自身媒体目录由官方内核管理，避免误删收发消息共用的文件。更改缓存保留天数不会删除原始图片。管理台消息记录省略 Base64 二进制负载，日志不记录图片字节、凭据或消息正文。

图片尺寸限制为单边最多 32768、总像素最多一亿，一条消息最多 20 张。网络下载限制重定向次数、实际读取字节数与总超时。错误路径不会调用 SDK 发送部分消息。

## 验证状态

自动回归覆盖文件与 Base64 解析、PNG/GIF 字节保留、JPEG/WebP 头信息、网络取消与大小限制、并发缓存、图文顺序、大于 1 MiB 的 AstrBot 格式请求、终态确认、结果未知和缓存释放。Web 回归覆盖新增参数在桌面及手机设置页的显示与保存。

2026-10-25 已在用户运行的 Windows QQ 9.9.27-45758 上完成真实验收：通过 OneBot `send_private_msg` 将 Base64 PNG（320 × 180）发送给机器人自身账号，收到相同消息 ID 与会话的成功终态，并通过 `get_msg` 确认图片段保留。没有向好友或群发送验收消息。报告只记录确认状态、格式、尺寸、版本和本地消息 ID，不记录 QQ 号或凭据。

接收修复已在同一运行副本完成只读实机验收：从保留的真实图片消息下载 JPEG（168 × 164，9061 字节），验证 OneBot 图片链接返回实际图片字节，且 `get_image` 大小一致。此验收不向好友或群发送消息，也不将历史消息重放给 AstrBot。

进一步使用本机 AstrBot 4.28.2 自带 Python 与真实的 `MediaResolver.to_path`、`prepare_model_image` 函数读取同一链接，成功生成本地图片及可供模型使用的图片文件（168 × 164），未出现 `FileNotFoundError`。该检查使用工作区内独立临时配置，不读写真实 AstrBot 数据库、不调用模型、不发送聊天消息；它验证取图和模型输入准备，不代表已执行插件完整对话。

完整自动测试 135 项通过，Web 检查 53 项通过。GIF 动图保留和图文顺序已有自动测试；群聊图片、GIF/JPEG/WebP 的真实 QQ 端到端发送、AstrBot 插件完整对话流程仍需分别验收，不将单张图片验收扩展为这些场景的实测结论。

需要手动向机器人自身账号发一张真实 PNG 验收图时，在已运行且登录的项目根目录执行：

```powershell
npm run image:selftest -- --send
```

不带 `--send` 只显示说明。命令从登录接口取得机器人自身 QQ 号并与管理员状态交叉核对，没有指定好友或群号的参数。确认报告写入本机 `dist/image-self-test.json`。发送超时或结果未知后先核对 QQ，不要盲目再次执行。

## 接口资料

- [OneBot v11 图片消息段](https://github.com/botuniverse/onebot-11/blob/master/message/segment.md)
- [AstrBot OneBot v11 接入](https://docs.astrbot.app/platform/aiocqhttp.html)
- [QQ SDK 图片元素字段交叉核对](https://github.com/project-yui/Yui/blob/master/src/ntqq/message/interfaces.d.ts)

项目通过自研宿主调用本机官方 QQ SDK，不引入其他 QQ 机器人框架作为运行依赖。
