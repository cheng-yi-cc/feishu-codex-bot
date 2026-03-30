# Feishu Codex Bot

把本机 `Codex CLI` 能力接到飞书私聊里的 TypeScript 服务。它适合单人私用开发机场景：你在飞书里自然对话或发工作台命令，机器人在这台 Windows 机器上实际读代码、跑命令、执行 Codex、回传日志和结果。

当前仓库已经按“混合型工作台”思路落地：

- 平时像聊天：私聊里直接说需求即可
- 需要时像 CLI：保留 `/mode`、`/cwd`、`/run`、`/test`、`/diff` 这类显式控制命令
- 长期在线：支持健康检查、状态持久化、启动前自检、Windows 开机自动拉起

## 项目适合什么场景

- 你想在飞书里随时和 Codex 对话，不必回到终端
- 你希望它真的能在本机仓库里开发，而不只是回复建议
- 你使用的是自己的开发机，接受本机高权限自动化
- 你更看重“持续可恢复的开发会话”，而不是一次性问答机器人

如果你要做团队级多人共享、复杂权限隔离、审计留痕或多工作区并发，这个仓库还不是那种产品化形态，它现在更偏“个人开发工作台”。

## 当前核心能力

- 飞书长连接收消息，处理 `im.message.receive_v1`
- 私聊自然语言直达 Codex，群聊可配合 `@bot` 和 `/ask`
- 会话级模型与思考强度切换：`/model`、`/think`
- 会话级工作区状态：模式、目录、分支、最近任务、错误摘要
- 工作台命令：
  - `/mode`
  - `/resume`
  - `/cwd`
  - `/run`
  - `/test`
  - `/diff`
  - `/files`
  - `/logs`
  - `/branch`
  - `/abort`
- 任务编排与串行队列，避免共享工作区被并发写坏
- SQLite 持久化聊天、任务、工作区状态
- 附件下载到本机工作区，支持把图片和文件继续交给 Codex
- Codex 可通过指令把图片或文件回传到飞书
- 健康检查端点：`GET /healthz`
- Windows 启动脚本 + 任务计划程序自启动 + 非管理员 fallback

说明：

- `/apply` 目前已接入命令入口，但还没有自动补丁落地流程，README 里按“占位能力”说明，不把它写成已完成功能

## 工作方式概览

整体链路如下：

1. 飞书私聊或群聊把消息发给 bot
2. 本服务通过长连接收消息
3. 消息解析器识别自然聊天、控制命令、附件
4. 会话/工作区状态从 SQLite 读取
5. 普通开发任务进入串行队列，交给 Codex 在本机工作目录执行
6. 执行中的进度、最终文本、附件产物再回发到飞书
7. 任务状态、进度事件、最近工作区上下文写回 SQLite

这样一来，机器人不是“每条消息都重新开始”，而是保留最近会话上下文和工作状态。

## 目录结构

```text
.
├─ src/
│  ├─ bot/                  消息解析、命令路由、响应渲染
│  ├─ codex/                Codex 执行与回复解析
│  ├─ feishu/               飞书客户端、监控、发送器、附件下载
│  ├─ health/               /healthz 服务
│  ├─ runtime/              supervisor、任务编排、工作区状态
│  ├─ session/              SQLite schema、迁移、存储
│  └─ workspace/            工作区路径策略与命令执行
├─ scripts/
│  └─ install-startup-task.ps1
├─ docs/
│  ├─ feishu-setup.md
│  ├─ ops-checklist.md
│  └─ test-report.md
├─ start-bot.ps1            Windows 启动入口
└─ README.md
```

## 环境要求

- Windows 开发机
- Node.js 与 `npm.cmd`
- 本机已安装并登录 `codex`
- 可访问飞书开放平台，并已创建企业自建应用
- 允许本机长期在线，供飞书长连接使用

建议先确认下面这条命令有结果：

```powershell
codex login status
```

## 快速开始

1. 安装依赖

```powershell
npm install
```

2. 准备环境变量

```powershell
Copy-Item .env.example .env
```

3. 填写 `.env`

最少需要：

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`

推荐同时设置：

- `FEISHU_ALLOW_OPEN_IDS`
- `CODEX_WORKDIR`
- `LOG_DIR`
- `HEALTH_PORT`

4. 本地开发启动

```powershell
npm run dev
```

5. 生产式启动

```powershell
npm run typecheck
npm test
npm run build
npm run start
```

6. 检查服务状态

```powershell
Invoke-RestMethod http://127.0.0.1:8787/healthz
```

## 飞书开放平台配置

至少需要完成这些配置：

- 机器人能力已开启
- 事件订阅方式选择“长连接”
- 已订阅 `im.message.receive_v1`
- 如果你要感知 bot 被拉入或移出会话，补上：
  - `im.chat.member.bot.added_v1`
  - `im.chat.member.bot.deleted_v1`
- 权限里至少开通消息收发相关能力

如果已经按仓库里的默认行为联调，重点确认这几类权限：

- 读取会话/群组基础信息
- 读取单聊或群聊消息
- 机器人发送消息
- 机器人发送消息反应

更详细的飞书配置可以看 [docs/feishu-setup.md](./docs/feishu-setup.md)。

## `.env` 参数说明

### 飞书相关

- `FEISHU_APP_ID`
  - 飞书应用 App ID
- `FEISHU_APP_SECRET`
  - 飞书应用密钥
- `FEISHU_DOMAIN=feishu`
  - 飞书域，默认保持 `feishu`
- `FEISHU_ALLOW_OPEN_IDS=ou_xxx,ou_yyy`
  - 允许访问机器人的用户白名单
  - 留空表示不启用白名单
  - 私用部署强烈建议只放你自己的 `open_id`
- `FEISHU_REQUIRE_MENTION=true`
  - 群聊中是否要求 `@bot` 才响应
- `FEISHU_TRIGGER_PREFIX=/ask`
  - 兼容显式触发命令的前缀

### Codex 运行相关

- `CODEX_BIN=codex`
  - Codex 可执行文件路径
- `CODEX_WORKDIR=C:\Users\45057\.codex\feishu-codex-bot\workspace`
  - 机器人执行开发任务的默认工作目录
- `CODEX_SANDBOX_MODE=danger-full-access`
  - 当前仓库主打“自用开发机全自动”，默认就是高权限
- `CODEX_TIMEOUT_MS=120000`
  - 单次 Codex 任务超时
- `CODEX_HISTORY_TURNS=20`
  - 传给 Codex 的历史轮次
- `CODEX_DEFAULT_MODEL=gpt-5`
  - 默认模型
- `CODEX_DEFAULT_THINKING_LEVEL=medium`
  - 默认思考强度，可选 `low|medium|high`

### 存储与运维

- `DB_PATH=./data/bot.sqlite`
  - SQLite 数据库路径
- `LOG_DIR=./logs`
  - 日志目录
- `LOG_LEVEL=info`
  - 日志级别
- `HEALTH_PORT=8787`
  - 健康检查端口
- `SUPERVISOR_MAX_RESTARTS=5`
  - 应用内 supervisor 最大重试次数
- `SUPERVISOR_RESTART_DELAY_MS=3000`
  - 重试间隔

## 飞书里的使用方式

### 1. 直接聊天

在私聊里直接发：

- `帮我看下这个报错`
- `把登录页改成响应式`
- `帮我跑测试并修复失败用例`

这类消息会直接进入 Codex。对你来说，体验更像“和一个在本机工作的开发搭子聊天”。

### 2. 显式用 `/ask`

如果你想明确告诉机器人“这次就是走 Codex 执行”，可以继续用：

```text
/ask 帮我梳理当前仓库的启动链路
```

### 3. 发送附件

图片或文件会先下载到 `CODEX_WORKDIR` 下的会话目录，再作为上下文交给 Codex。

适合的场景：

- 发一张报错截图，让它分析
- 发一个日志文件，让它定位问题
- 发一张设计图，让它帮你实现

如果你只发附件、不写文字，机器人会先概述内容并追问下一步需求。

## 工作台命令

下面这些命令已经在当前仓库里落地。

### 会话与状态

- `/status`
  - 查看当前模式、工作目录、分支、队列长度、沙箱策略、超时和最近任务
- `/new`
  - 清空当前会话上下文，也会重置当前会话的模型与思考等级设置
- `/resume`
  - 返回最近可恢复或曾中断任务的摘要与进度

### 模式与会话参数

- `/mode`
  - 查看当前模式
- `/mode chat`
  - 切回聊天模式
- `/mode dev`
  - 切到开发模式，后续自然语言任务会按开发任务处理
- `/mode default`
  - 重置模式到默认值
- `/model`
  - 查看当前会话模型
- `/model <name>`
  - 设置当前会话模型
- `/model default`
  - 恢复默认模型
- `/think`
  - 查看当前思考强度
- `/think <low|medium|high>`
  - 设置当前思考强度
- `/think default`
  - 恢复默认思考强度

### 工作区控制

- `/cwd`
  - 查看当前工作目录
- `/cwd <path>`
  - 切换当前工作目录
- `/branch`
  - 查看当前分支
- `/branch <name>`
  - 尝试切换分支；不存在时会新建分支

### 命令执行与排障

- `/run <command>`
  - 在当前工作目录执行任意命令
- `/test`
  - 执行 `npm test`
- `/test <target>`
  - 执行 `npm test -- <target>`
- `/diff`
  - 查看 `git diff --stat --no-ext-diff`
- `/files`
  - 查看当前改动文件列表
- `/logs`
  - 查看 `app.log` 最近 80 行
- `/abort`
  - 中止当前工作区命令或当前活跃任务

### 暂未完整落地

- `/apply`
  - 当前只有入口与提示文本，尚未接通“自动把上一次建议的补丁真正落盘”流程

## 结果回传与附件指令

Codex 如果需要把图片或文件回传到飞书，可以在最终文本中输出：

```xml
<send_image path="relative/or/absolute/path/inside/workdir.png" />
<send_file path="relative/or/absolute/path/inside/workdir.ext" />
```

约束：

- 目标文件必须真实存在
- 路径必须位于 `CODEX_WORKDIR` 下
- 超出工作区的路径不会被发送

## 本地开发与验证

推荐在每次重要修改后跑：

```powershell
npm run typecheck
npm test
npm run build
```

然后检查：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/healthz
```

健康接口会返回：

- `ok`
- `queueLength`
- `lastErrorAt`
- `codexWorkdir`
- `logDir`
- `supervisor.restartCount`

## Windows 开机自启动

### 启动链路

正式启动入口是 [start-bot.ps1](./start-bot.ps1)：

- 自动解析 `node.exe` 和 `npm.cmd`
- 如 `dist/index.js` 缺失，会先执行构建
- 前台承载 `node dist/index.js`，适合被任务计划程序托管
- 自动写入：
  - `logs/start-bot.log`
  - `logs/app.log`
  - `logs/app.err.log`
- 通过互斥锁和进程探测避免重复拉起

### 安装方式

使用管理员 PowerShell 执行：

```powershell
Set-Location "D:\My Project\feishu-codex-bot"
PowerShell.exe -ExecutionPolicy Bypass -File .\scripts\install-startup-task.ps1
```

脚本会优先安装正式的 `Task Scheduler` 开机任务：

- 任务名：`FeishuCodexWorkspaceBot`
- 触发器：`AtStartup`
- 重复实例策略：`IgnoreNew`
- 默认无执行时长上限
- 失败时按策略重试

如果没有管理员权限，脚本会自动回退到当前用户的 Startup 快捷方式。

### 验证方式

```powershell
Get-ScheduledTask -TaskName "FeishuCodexWorkspaceBot"
Get-ScheduledTaskInfo -TaskName "FeishuCodexWorkspaceBot"
Invoke-RestMethod http://127.0.0.1:8787/healthz
```

## 日志与排障

常看这几个文件：

- `logs/start-bot.log`
  - 记录启动脚本是否成功解析命令、是否触发 build、是否重复启动
- `logs/app.log`
  - 应用主日志
- `logs/app.err.log`
  - 应用标准错误输出

常见问题排查思路：

### 飞书发了消息但机器人没回

- 检查 `FEISHU_ALLOW_OPEN_IDS` 是否包含自己的 `open_id`
- 检查群聊时是否满足 `@bot`
- 检查 `logs/app.log` 里是否收到了消息
- 检查 Codex 是否登录有效

### 启动了但健康检查失败

- 手动执行 `.\start-bot.ps1`
- 看 `logs/start-bot.log`
- 看 `logs/app.err.log`
- 检查 `CODEX_BIN`、`CODEX_WORKDIR`、`.env`

### 启动任务存在但没真正拉起

- 打开任务计划程序看历史
- 检查任务动作是否仍指向当前仓库的 `start-bot.ps1`
- 确认运行账号对仓库目录、日志目录、Node 和 Codex 都有访问权

更完整的运维检查单见 [docs/ops-checklist.md](./docs/ops-checklist.md)。

## 安全建议

这个项目默认面向“你自己的开发机 + 你自己的飞书账号”，当前又启用了 `danger-full-access`，所以一定要把边界收住：

- 开启 `FEISHU_ALLOW_OPEN_IDS`
- 只放你自己的 `open_id`
- 非私聊场景建议保留 `FEISHU_REQUIRE_MENTION=true`
- `CODEX_WORKDIR` 尽量指向受控目录，而不是系统根目录
- 不要把包含密钥的 `.env` 提交到 Git

## 相关文档

- [docs/feishu-setup.md](./docs/feishu-setup.md)
- [docs/ops-checklist.md](./docs/ops-checklist.md)
- [docs/test-report.md](./docs/test-report.md)
