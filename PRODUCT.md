# QQ AI Bot

<!-- impeccable:product-schema 1 -->

## Platform
web

## Users
在 Windows 本机运行 QQ 机器人的中文用户，通过浏览器管理账号、AI 回复、OneBot 接入、消息与任务。

## Product Purpose
基于官方 QQNT 内核提供本地机器人与可选 AI 回复。此次用户确认：完整实现本机中文管理台、所有运行配置、日志、消息监听、页面重启，并额外打包源码。

## Operating Context
Windows x64、Node.js 24+。`npm run launch` 管理服务并打开随机本机地址；`npm run login` 可连接现有服务。支持 demo 模拟驱动。

## Capabilities and Constraints
保留 OneBot v11、独立管理员认证、扫码、持久化 AI 队列和发送不确定性处理。官方内核目前以文本为主；群聊及部分联系人能力尚待实机验收。Web 管理端只监听本机。配置保存后通过重启生效；复用外部服务时重启须由原进程完成。日志不记录消息正文或凭据；消息监听为有界进程内历史。

## Evidence on Hand
README.md、src/config.mjs、.env.example、现有测试、docs/KERNEL.md。模拟数据必须明确标记。

## Product Principles
配置完整可找、运行状态真实、保存与生效分明、秘密默认隐藏、发送结果未知时由人核对。
