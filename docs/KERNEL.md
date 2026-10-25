# 官方 QQNT 内核适配与实机验证

## 实现

kernel 驱动在独立 Node 子进程中加载官方 wrapper.node。自研 QQNT.dll 位于专用宿主目录，仅提供 N-API 转发和环境退出状态；官方程序、内核和完整性校验代码没有修改。不使用 NapCat 或其它 QQ 机器人框架。

src/qq/kernel/bridge-image.mjs 是可复现的 Windows x64 PE 生成器，含少量固定 ABI 函数和导出转发表，支持 NX、ASLR 和初始化函数的展开信息。native/qq-host/bridge.c 描述其 C 语言语义。生产构建无需另外安装编译器。

构建记录 Node、桥接、wrapper.node、major.node 的 SHA256；启动再次验证程序清单。SDK 应用标识从该版本 major.node 中的 QQAppId/<数字> 提取，不使用平台公共应用标识代替。

## 登录与消息生命周期

1. 加载官方内核，初始化平台配置、隔离数据目录与持久设备标识。
2. 使用包内 SDK 标识、真实客户端版本和正确字段类型初始化登录服务。
3. 由官方服务返回二维码、有效期和扫码结果。
4. 扫码认证后固定账号，通过启动会话工厂的 nt 会话 ID 取得原生会话。
5. 等待真实初始化成功回调，退出该回调后再检查传输状态、取得消息接口并绑定监听。

SDK 在初始化回调返回前尚未安装好所有消息接口。直接在回调中读取会产生 Cannot convert undefined or null to object；现由 session-ready.mjs 延迟并限时等待，成功后才标记在线。这一时序已有回归测试。

发送消息的本地受理结果不等于发送成功。SendTracker 必须匹配会话、原生消息 ID 与终态确认。取消、超时和宿主退出均保留未知状态，不自动重发。原生消息键以账号、会话和 ID 组合映射到持久 OneBot int32。

## 2026-10-24 实机记录

| 项目 | 结果 |
| --- | --- |
| 旧安装 9.9.27-45758 | 可返回二维码，但手机提示登录失败，不计为认证成功 |
| 官网发布配置 | Windows 9.9.36，更新日期 2026-09-24 |
| 官方包 | QQ_9.9.36_260924_x64_01.exe，330446512 字节 |
| 安装包 SHA256 | 63255c70c7ff523e7eed7d52d9708ed7a77ea346ece6474c65dded406edb3155 |
| Authenticode | Valid；Tencent Technology (Shenzhen) Company Limited |
| 实际构建 / SDK 标识 | 9.9.36-53644 / 537391628 |
| 宿主接口 | 当前内核需要的 99 个导入均已检查 |
| 真实扫码认证 | 通过 |
| 真实消息服务 | 通过；已认证会话的接口延迟就绪后成功绑定 |
| 私聊文本发送 | 通过；向登录账号本人发送自测文本，终态确认后返回 OneBot ID 1 |
| 私聊文本接收 | 通过；另一账号发送“接收链路测试”，持久化为 OneBot ID 16 |
| 单元与集成测试 | 40 项通过 |
| 群聊、媒体、撤回、票据恢复、长期重连 | 尚未完成实机验收 |

上表的真实收发独立于模拟测试。validation.json 已记录 core_loaded、qr_received、authenticated、messages_received、messages_sent 为 true。消息正文只在本地消息数据库中；此说明不记录用户账号和凭据。

本机扫码页已检查：Token 不进入 HTML，跨站 POST 返回 403，二维码有倒计时与刷新。在线状态只表示本次已认证且消息接口和传输就绪，不承诺所有 SDK 功能均已验收。

## 运行和边界

QQ_RUNTIME_DIR 保存完整官方文件，QQ_KERNEL_DIR 保存自研桥接，QQ_KERNEL_DATA 保存内核数据。下载来源、签名和安装包哈希另存于安装包旁的 JSON。当前只支持 Windows x64。

宿主不会继承 OneBot Token、管理员 Token、AI API Key 或 SessionVault 密钥。账号凭据由官方内核自行管理，本项目不另行加密。logout 停止本地宿主，不删除凭据，不声明撤销所有远程授权。

当前支持已验证的私聊文本及本地消息查询；群聊文本已实现但未实测。2026-10-24 核查后增加 SDK UID 主动解析、好友与群列表、本地票据恢复、断线退避恢复与正常关闭流程。这些新增能力已做模拟回归，不能替代上表中的待验收项。

2026-10-25 新增图片发送、图片表情及有序图文混排。修复 SDK 媒体目录准备后，已在用户运行的 QQ 9.9.27-45758 上向登录账号本人发送一张真实 Base64 PNG，获得内核成功终态并确认本地消息查询保留图片段。只发送了自行验收图片，没有向好友或群发测试消息；群聊图片与 GIF/JPEG/WebP 的实机兼容性仍待验收。图片输入、限制、缓存与 AstrBot 接入见 [IMAGES.md](IMAGES.md)。语音、视频、普通文件、撤回和群管理仍不支持。

好友接口参数从当前官方 wrapper.node 内的签名断言提取：本机 9.9.36 的 getBuddyListV2 接收来源字符串、刷新开关和请求类型三个参数，旧两参数版本保留兼容。群列表同时支持返回值和 onGroupListUpdate 的多参数回调。内核数据和 stderr 均属于本地私有数据；分享时使用源码导出入口。

图片接收在 2026-10-25 补齐 SDK 原图下载完成回调、实际内容缓存和 `get_image`。已从 QQ 9.9.27 的保留消息读取真实 JPEG，并通过图片链接、`get_image` 与本机 AstrBot 4.28.2 的模型图片准备函数完成只读验收。历史消息不会被重放给 AstrBot；完整新消息对话和群聊仍需单独验收。详见 [IMAGES.md](IMAGES.md)。

## 参考

- [QQ 官网发布配置](https://qq-web.cdn-go.cn/im.qq.com_new/latest/rainbow/pcConfig.json)
- [Node-API](https://nodejs.org/api/n-api.html)
- [Microsoft PE 格式](https://learn.microsoft.com/en-us/windows/win32/debug/pe-format)
- [独立项目 Yui 的 SDK 参数说明](https://github.com/project-yui/Yui/blob/master/src/ntqq/store/config-platform.ts)及[接口声明](https://github.com/project-yui/Yui/blob/master/src/ntqq/types/wrapper.d.ts)：用于交叉核对字段含义，不是本项目运行依赖。
