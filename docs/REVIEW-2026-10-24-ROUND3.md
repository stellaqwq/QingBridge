# 外部复查核验：测试取消与管理员凭据

本轮以用户提供的 1.txt 为待验证清单。附件中的严重等级和推断均作为核查对象，不直接当作已确认事实。

## 1. 合成流超时测试与取消计数

核查前，在本机 Windows、Node.js 24.20.0 下，将 AI body timeouts 回归独立运行 10 次均通过，没有直接复现附件中的 11 项取消。因此无法确认该运行记录在本机也会发生，不能据此把以前观察到的完整通过记录判为伪造。

但测试原先只等待 AbortSignal.timeout() 驱动的合成 ReadableStream，没有自有的引用定时器；本机 Node 实现确认该超时定时器调用 unref。这会使隔离运行依赖额外句柄，属于应修复的不稳定写法。已加入 1 秒、保持事件循环且在结束时清理的测试守卫。模型本身仍在 30ms 超时，断言仍验证重试状态，没有用守卫代替被测超时。

另外用可控取消夹具验证：Node 可以报告 fail=0、cancelled=1，但退出码为 1。标准退出码判定并不会把它当成功；只解析 fail 数量的自定义 CI 才可能误判。

为消除统计歧义，npm test 现使用 scripts/test.mjs：

- 根据每个文件的实际声明测试汇总计数，空文件或过滤后没有测试不能算通过。
- 只有全部选中测试通过，且断言失败、取消、跳过、TODO 均为 0，才返回 0。
- dist/test-results.json 的 fail 合并断言失败与取消；success、complete 明确标记整次执行结果。开始执行时先覆盖旧绿报告为 running/未完成。
- 回归夹具证实：取消 1 项且断言失败为 0 时，报告 fail=1、cancelled=1、success=false，进程退出 1；跳过和空运行同样拒绝判绿。

统计事件使用 [Node TestsStream 的 test:summary](https://nodejs.org/docs/latest-v24.x/api/test.html#event-testsummary)。测试运行器的标准终态计数和原始 runnerCounts 均保留，避免从控制台某一个数字推断结果。

## 2. 管理接口共用 OneBot Token

属实，而且不只在 HOST 改为外网地址时有风险：本机持有 OneBot 凭据的第三方插件同样可以调用原来的 /admin/login/logout、登录和任务确认接口。回环监听不能提供插件与管理员之间的权限隔离。

修复如下：

- 所有 /admin/* 路由只接受独立 ADMIN_ACCESS_TOKEN 的请求头认证；管理密钥不支持 URL 查询参数。
- 公共 HTTP/WS 继续使用 ONEBOT_ACCESS_TOKEN；反向 WS 默认使用它或显式 REVERSE_WS_TOKEN。管理员密钥必须与这两种对外凭据不同，缺少或复用时启动失败，不退回旧凭据。
- CLI 按命令角色选用凭据，扫码页只在服务器端使用管理员凭据，HTML 不含密钥。
- npm run init 可升级已有配置，只生成/修正管理员密钥；原 OneBot Token、SESSION_KEY 和其他设置保持不变，已有效的独立管理员密钥不会重复生成。

本项目现有 .env 已完成该升级，并以不输出值的方式验证其他键值不变。没有重启现有 QQ 实例，代码及认证切换需下次重启后生效。

## 最终验证

- npm run check：通过。
- 完整回归：tests=85、pass=85、fail=0、cancelled=0、skipped=0、todo=0，严格报告 success=true、complete=true。
- 修复后的 AI 超时测试：脱离整套测试，使用原生 node --test 连续单跑 10 次，全部通过，取消数为 0。
- 新增 11 项回归覆盖配置校验、全体管理路由的拒绝访问、WS 权限、CLI、扫码页、配置生成/迁移、超时守卫、取消失败判定及单测独立执行。
- 所有验证使用模拟账号、临时密钥和本机服务，没有真实 QQ 发送或重新登录。

机器结果见 dist/test-results.json；单跑记录见 dist/recheck-20261024/isolated-runs.json。旧的 74 项是历史运行结果，当前应以这份包含完整终态计数的报告作为验收依据。
