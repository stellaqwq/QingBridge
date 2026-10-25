# 自研原生 QQ 驱动

`QQ_DRIVER=native` 加载 `src/qq/native-driver.mjs`。运行时只依赖 Node.js 内置模块与现有 `ws`，不加载其它 QQ 协议库或官方 QQ 客户端。默认离线，只有认证及会话注册都明确成功后才上线。

实现是实验性的。代码已通过合成协议测试；当前没有真实账号登录和收发成功的记录。

## 本机配置

```dotenv
QQ_DRIVER=native
# 0 表示首次扫码确定账号；已确定账号后当前进程不允许切换。
QQ_ACCOUNT=0
QQ_SIGN_URL=http://127.0.0.1:8081/sign
QQ_SIGN_TOKEN=
# 留空使用内置 Linux 3.2.26-46494 研究参数。
QQ_PROFILE=
QQ_SERVER_HOST=msfwifi.3g.qq.com
QQ_SERVER_PORT=8080
```

签名地址只是本机配置示例，本项目不附带该服务。签名需要版本匹配的 NTQQ 签名实现，不能用随机字节代替。签名请求包含包体与账号信息，其中登录包体含敏感认证材料；只填写你信任的服务。没有默认公共签名站，不跟随 HTTP 重定向。

签名接口使用 `POST` JSON：`{command,seq,body,uin,guid,qua}`，其中 `body` 是十六进制。支持响应 `{code:0,value:{sec_sign,sec_token,sec_extra}}`，以及 `value` 内的 `sign/token/extra` 别名；三个字段都为十六进制字符串。非零错误码、空签名和格式错误均明确失败。首批需签名命令为 `wtlogin.trans_emp`、`wtlogin.login`、`MessageSvc.PbSendMsg`。

`QQ_PROFILE` 可指向自备 JSON，字段包括 `os/kernel/vendor_os/current_version/build_version/misc_bitmap/pt_version/pt_os_version/package_name/wtlogin_sdk/package_sign/app_id/sub_app_id/app_client_version/main_sigmap/sub_sigmap`。定义和示例见 `src/qq/native/profile.mjs`。参数必须整体匹配服务端与签名服务，不应只修改版本字符串。

## 扫码与文本收发

```powershell
npm start
# 另一终端：
npm run cli -- status
npm run cli -- login --wait
```

CLI 从服务端返回的 PNG 保存 `data/qrcode.png`，不自己生成登录二维码，不把 Base64 大块输出到终端。手机 QQ 扫码确认后每两秒查询状态，最长等待三分钟。也可单独 `login`，再用输出的 `handle` 执行 `poll HANDLE`。句柄关联当前进程的扫码会话，重启或新建扫码后失效。

状态包括 `waiting_scan`、`waiting_confirm`、`expired`、`cancelled`、`failed`；确认后继续认证，成功注册才进入 `online`。错账号返回 `account_mismatch`，认证挑战返回 `verification_required`（目前不支持提交挑战），断线使未完成二维码进入 `connection_lost`。后两种情况需完成验证或重新申请扫码。

服务器响应没有提供可信过期时间，返回 `expires_at:null`，以服务端轮询状态为准。

```powershell
npm run cli -- friends
npm run cli -- groups
npm run cli -- watch 60
npm run cli -- send 好友QQ号 "你好"
npm run cli -- send-group 群号 "你好"
npm run cli -- get 消息ID
npm run cli -- logout
```

私聊发送需要 NT UID；驱动先使用已收到消息的 UID，再查询好友列表。未知的陌生人不会猜测 UID。群 @ 支持全体成员及已知 UID，无法解析的目标明确失败。暂不支持的媒体组合消息整条拒绝交给 AI，避免截断后回复。临时私聊、图片、语音、撤回、群成员查询与离线同步尚未实现。

发送必须有明确成功 ACK；写入后断线、超时、ACK 缺少消息标识或本地保存失败均按结果未知处理，不自动重发。自身推送使用与发送 ACK 相同的会话/发送者/序列键分配持久 OneBot ID；仍需真实数据验证对应关系。

## 会话与运行

`data/native-device.json` 保存设备标识和最近账号，不含票据。票据通过 AES-256-GCM vault 保存到 `data/sessions/账号.session`。保留 `.env` 的 `SESSION_KEY`、设备文件、SQLite ID 映射和会话文件。设备、账号、密钥或会话损坏时不会悄悄清空重试。

启动时使用保存的 D2 票据注册；被服务器拒绝后要求重新扫码。在线连接丢失由框架退避重连；`KickNT` 立即离线、停止自动抢登。心跳间隔 270 秒。尚未实现 NT EasyLogin 刷新，过期票据需要重新扫码。

`logout` 关闭连接、删除本机票据，返回 `remote_revocation:false`。如需撤销其它设备或服务器授权，应在手机 QQ 的设备管理中操作。消息查询缓存按 `HISTORY_RETENTION_DAYS` 清理，默认七天；它不查询服务器历史。

## 验证记录：2026-10-24（北京时间）

| 项目 | 结果与证据范围 |
| --- | --- |
| 测试 | `npm test` 通过，使用本地合成协议端与签名服务 |
| 原生集成 | TCP 加密封包、HTTP 登录和发送、WS 收消息、稳定 ID、加密保存、重启恢复 |
| QQ 网关 | `native:check --connect`：`tcp_reachable:true` |
| 签名服务 | 本机未配置，`signer_configured:false` |
| 真实二维码 | 未取得，待版本匹配签名服务 |
| 真实认证及收发 | 未验证，`authenticated_test:false` |
| Docker / 长期运行 | 未验证 |

`native:check` 不登录或发消息。TCP 可达只证明网络连通，不证明握手、签名、版本、账号登录或收发可用。

## 公开研究资料

根据公开协议结构独立编写；以下用于核对字段、常量与状态，不作为运行依赖：

- [LagrangeGo 扫码与注册流程](https://github.com/LagrangeDev/LagrangeGo/blob/master/client/client.go)。
- [SSO 传输字段](https://github.com/LagrangeDev/LagrangeGo/blob/master/client/internal/network/transport.go)和[返回包](https://github.com/LagrangeDev/LagrangeGo/blob/master/client/internal/network/response.go)。
- [OICQ/ECDH 结构](https://github.com/LagrangeDev/LagrangeGo/tree/master/client/internal/oicq)和[TLV 字段](https://github.com/LagrangeDev/LagrangeGo/tree/master/client/packets/tlv)。
- [应用参数](https://github.com/LagrangeDev/LagrangeGo/blob/master/client/auth/app.go)和[签名字段](https://github.com/LagrangeDev/LagrangeGo/blob/master/client/sign/provider.go)。
- [消息字段](https://github.com/LagrangeDev/LagrangeGo/tree/master/client/packets/pb/message)、[发送 ACK](https://github.com/LagrangeDev/LagrangeGo/blob/master/client/packets/pb/action/action.proto)、[联系人字段](https://github.com/LagrangeDev/LagrangeGo/tree/master/client/packets/pb/service/oidb)。
- [QQ TEA 公开互操作测试向量](https://github.com/fumiama/gofastTEA/blob/main/tea_test.go)：用于验证自研解密与独立实现兼容。

社区研究不是腾讯公开承诺的稳定接口。密钥轮换兼容性、真实 ACK 关联、离线同步和长期运行仍是未完成项。
