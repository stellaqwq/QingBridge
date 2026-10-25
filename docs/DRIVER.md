# 独立 QQ 驱动契约 v0.1

此文档定义**本项目内部接口**，不是 QQ 的网络协议说明。默认官方内核宿主 `kernel` 已完成本次真实扫码和私聊文本收发验收，见 [KERNEL.md](KERNEL.md)。自行封包的 `native` 研究驱动仍待真实账号验收，见 [NATIVE.md](NATIVE.md)。不要将内部命令名当作腾讯服务端命令。

## 模块入口

`QQ_DRIVER=./path/to/driver.mjs` 指向受信任的本机 ESM 模块，相对路径按进程工作目录解析。该模块是本机代码，具备 Node.js 进程权限。

```js
import { QQDriver } from '../src/qq/driver.mjs';

export function createDriver({ account, vault, ids, log }) {
  return new MyDriver({ account, vault, ids, log });
}
```

返回 `QQDriver` 子类实例。基类继承 `EventEmitter`。

| 属性/方法 | 要求 |
| --- | --- |
| `account` | 安全整数 QQ 号，未知可为 0；登录后设置正确值，单进程运行期间不得切换另一个账号 |
| `online` | 只有服务端确认认证成功且传输可用时才为 `true` |
| `mode` | 官方内核宿主返回 `kernel`，自行封包返回 `native`；`demo` 仅表示模拟 |
| `capabilities` | 已实现命令名字符串数组；图片/语音能力分别为 `media.image` / `media.record`；支持发送 @ 段时声明 `message.at` |
| `connect({signal})` | 建立或恢复底层连接；必须遵守取消信号，可在等待扫码时保持离线 |
| `invoke(command, params, {signal})` | 执行下表中的内部命令；不能悄悄重试变更类操作 |
| `close()` | 关闭所有连接、心跳、轮询和定时器，使 `online=false` |

驱动自身负责真实 QQ 连接的心跳和认证生命周期。可恢复网络错误必须将 `online=false`，发出 `state({online:false,reconnect:true})`；框架以 1–30 秒指数退避附加小幅抖动调用 `connect()`。`connect` 抛出带 `retryable:true` 的 `BotError` 也会重试。扫码等待、凭据失效、验证挑战不得无限重试登录。`connect` 必须幂等，不得创建并行连接。框架对 RPC 的超时取消不等于能够从网络撤销已经发出的消息。

不同会话的发送可以并发，驱动必须在配置的有界并发下正确匹配各自结果。同一会话保持串行，开始时间同时受全局和会话间隔约束。SDK 变更操作已提交后，即使取消等待，也必须保留结果未知的语义，不能自动重试。

## 内部命令与返回值

查询命令返回 OneBot v11 相应 API 的 `data` 内容，不要包裹 `status/retcode`。映射字段含义见 [官方 API](https://github.com/botuniverse/onebot-11/blob/master/api/public.md)。

| 内部命令 | 参数 | 返回 |
| --- | --- | --- |
| `account.get` | `{}` | `{user_id,nickname}` |
| `friend.list` | `{}` | `[{user_id,nickname,remark}]` |
| `group.list` | `{}` | OneBot 群列表 |
| `user.get` | `{userId,noCache}` | OneBot 陌生人信息 |
| `group.get` | `{groupId,noCache}` | OneBot 群信息 |
| `group.members` | `{groupId}` | OneBot 群成员列表 |
| `group.member` | `{groupId,userId,noCache}` | OneBot 群成员信息 |
| `message.send` | `{kind:'private'\|'group',target,message:[segments]}` | `{message_id}`，必须收到明确发送确认 |
| `message.get` | `{messageId}` | OneBot 消息详情 |
| `message.delete` | `{messageId}` | `null`，必须收到明确确认 |
| `auth.start` | `{}` | 建议 `{handle,qrcode,mime,expires_at}`；二维码为真实服务器结果 |
| `auth.poll` | `{handle}` | 建议 `{state,expires_at}`；认证成功才更新账号和在线状态 |
| `auth.logout` | `{}` | 明确完成注销后返回 `null`；仅本地退出时必须返回操作边界（见下文） |

登录接口是项目扩展，不属于 OneBot v11。二维码字段建议使用 `data:image/png;base64,...`；不允许返回虚构可用二维码。驱动必须把服务端返回的过期、取消、确认、额外验证和失败分别映射为明确状态。

内置 `native` 的 `auth.logout` 返回 `{disconnected:true,credentials_removed:true,remote_revocation:false}`，明确只关闭连接、删除本地加密票据，不声称远程票据已撤销。原生二维码 `expires_at:null` 表示服务器响应没有提供有效期限，不能填写猜测的服务器过期时间。

## 事件

认证完成：先设置 `driver.account` 和 `driver.online`，再 `emit('state', {online:true,account})`。断开时先置 `online=false`。

消息事件采用此内部结构：

```js
this.emit('message', {
  id: ids.allocate(this.account, '稳定且包含会话信息的原生消息键'),
  kind: 'private',                     // 或 group
  sender: { user_id: 10001, nickname: '昵称' },
  message: [{ type: 'text', data: { text: '消息内容' } }],
  time: Math.floor(Date.now() / 1000),  // 应使用原始消息服务端时间
  // groupId: 20000,                   // group 时必填
  // subType: 'friend',                // 必须是对应 OneBot 合法子类型
});
```

框架转换为 OneBot `message` 事件；发送者为当前账号时转换为 `message_sent`，避免 AI 自循环。消息段数组遵循 [OneBot 消息段规范](https://github.com/botuniverse/onebot-11/blob/master/message/segment.md)。任何未支持的段在发送前明确失败，不能悄悄丢弃。

`emit('notice', fields)` 和 `emit('request', fields)` 中 `fields` 由驱动按 OneBot 对应事件规范构造。框架固定 `self_id/post_type`，这些事件不会自动进入 AI。

不要给一次 QQ 消息的每次重投生成新 ID。`ids.allocate(account,nativeId)` 分配持久稳定的正 int32，`ids.resolve(account,messageId)` 找回原生键。建议用原生会话、序列和唯一标识的组合，真实组合规则必须由真实协议验证。映射在当前 SQLite 数据库长期保留，备份时需要保留该表。

## 错误与发送语义

```js
import { BotError } from '../src/errors.mjs';

// 明确知道没有发出，且仅网络恢复后可以安全重试：
throw new BotError('Connection unavailable before write', 1501, { retryable: true });

// 已写入连接，ACK 缺失，无法确定是否已送达：
throw new BotError('Send result unknown', 1502, { uncertain: true });

// 服务端明确拒绝；不要自动重试：
throw new BotError('Send rejected', 1500);
```

| retcode | 本项目含义 |
| --- | --- |
| `0` | 明确成功 |
| `1400` | 参数错误 |
| `1401` | 接口鉴权失败 |
| `1404` | API 或驱动命令未支持 |
| `1500` | 执行失败 |
| `1501` | 未实现、未登录或连接不可用 |
| `1502` | 超时/取消，变更操作可能已经生效 |
| `1503` | 客户端并发超限 |

`150x` 是实现扩展错误码。驱动异常文本不得包含口令、票据或原始消息。未分类的发送异常按结果未知处理。只有明确 `retryable=true` 且 `uncertain=false` 才能重试 AI 发送任务。外部 OneBot API 调用不进入 AI 持久化队列，客户端必须自行管理请求结果，超时后也不能假设未送达。

## 会话保存

`vault.save(account, jsonSession)` 以 AES-256-GCM 保存并原子替换会话。`vault.load(account)` 返回解密后的对象，文件不存在返回 `null`，认证标签、密钥或版本不正确时抛出错误。会话与账号绑定为附加认证数据。

`SESSION_KEY` 是随机 32 字节十六进制密钥，不是 QQ 密码。不要自动从失效密钥恢复成空会话，不要在加密失败时回退到明文。Windows 文件权限仍由本地用户 ACL 管理；`mode` 参数主要用于 Unix 权限。会话加密不会加密消息数据库。

## 原生核心验收门槛

验收应区分真实认证、实际消息编解码和确认、离线同步、重连重复消息、消息 ID 稳定性、取消关闭及媒体边界。`kernel` 已有本次真实扫码和私聊文本收发记录，其余项目仍按实际验证进度披露。不要仅修改 `online=true` 就宣称驱动可用。
