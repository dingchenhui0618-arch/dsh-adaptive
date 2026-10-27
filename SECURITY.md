# 安全模型 / Security model

这份文档说明 **dsh-adaptive** 信任什么、读什么、能让你的一台机器上发生什么。
它从实现里读出来：`index.js`（版本识别、Profile 定位、5 条 HTTP 路由、agent 工具）、
`src/scan.js`（只读扫描与上限）、`src/compat.js`（判定规则）、`src/rules.js`（迁移提示的正则表）、
`client.js`（面板与两个按钮）。**如果文档和代码不一致，以代码为准。**

> 一句话：**扫描本身是只读的**——不写文件、不联网、不改插件、不安装。
> 但面板上的「适配到当前版本」按钮会把一条任务**投进你已有的某个会话**，让那个 agent 去改代码；
> 那条 HTTP 路由没有鉴权。所以「只读」说的是插件自己，不是它触发的后续动作。

## 信任边界

插件跑在 DSH 宿主进程里（`export const inject = []`，服务全部软读 `ctx.get`），对外有三个面：

| 面 | 谁碰得到 | 能做什么 |
| --- | --- | --- |
| `GET /dsh-adaptive/state`、`GET /dsh-adaptive/report.md` | 能连上 DSH web server 的人 | 读扫描报告（含绝对路径、版本、源码行号与片段） |
| `GET /dsh-adaptive/sessions?dir=&name=` | 同上 | 列出候选会话（id / 标题 / cwd / 是否在跑） |
| `POST /dsh-adaptive/scan` | 同上 | 触发一次重新扫描（读盘） |
| `POST /dsh-adaptive/dispatch?name=&session=` | 同上 | **写**：把一条适配任务 queue 进某个已有会话 |
| 工具 `adaptive_report` | 模型（本会话的 agent） | 同一份报告，只读参数（`refresh` / `format` / `includeHints`） |

**五条路由都没有令牌、没有 `remoteAddress` 判断**（`index.js` 里搜不到 `isLoopback` 或
`Authorization`）。能不能碰到它们，取决于 DSH web server 绑在哪、前面有没有代理。

**视为不可信输入的：**

- **Profile 里的第三方包**：`package.json` 的 `dependencies`、每个依赖的 `package.json`、
  以及这些包里 `.js/.mjs/.cjs/.ts/.tsx/.jsx/.json/.yml/.yaml` 的**源码文本**。
  它们会被读、被正则匹配、被截断后进报告——不是被信任的；
- **`pluginManager.listVersionExemptions()` 的返回值**：当作「已授权的例外」使用，
  但只用于判定展示，不改任何东西；
- **`sessionController.list()` 的返回值**：会话 id/标题/cwd，用于候选排序；
- **HTTP 查询参数**：`refresh`、`dir`、`name`、`session` 都只当字符串用；
  `/dispatch` 的 `name` 必须命中报告里的依赖名，`session` 必须命中候选清单——
  不命中就报错，不会「猜一个」。

## 它读什么（以及读不到什么）

- **Profile 目录**：显式配置 `profileDir` → `DSH_PROFILE_DIR` → `profileContext.packageManager.env`
  → `$DSH_HOME/profiles/*` 里**装了本插件**的那个（多个候选按 `cordis.patch.yml` / `package.json`
  的 mtime 取最新，并在报告里注明来源）。
- **每个依赖的包目录**：`<profile>/node_modules/<name>` 经 `realpathSync` 解析——
  所以 `link:` 安装（README 推荐的 junction 方式）会一路读到**你本机那个源码仓库**。
  这正是它要扫的东西，也意味着**报告里会出现你本机源码的绝对路径与代码片段**。
- **硬上限**（`src/scan.js`）：每个包最多 **300 个文件**、单文件 ≤ **400 KB**、合计 ≤ **2 MB**；
  只读上面列的扩展名；跳过 `node_modules`、`.git`、`.github`、`test(s)`、`__tests__`、`coverage`、
  `dist`、`build`、`tmp`、`_tmp`、`.tmp`、`.cache`、`debug`、`out`。
- **符号链接**：包根目录会被 `realpath` 解析（junction 安装是常态）；子目录里的符号链接
  **不会**被跟随——`dirent.isDirectory()` 对链接返回 `false`，`listFiles` 直接跳过。
- **读不到就算**：任何 `readdir`/`stat`/`read` 失败都静默跳过并把该依赖标成 `unreadable`，
  不把异常抛给面板。

## 数据与副作用

- **写**：**没有**。整份代码里没有 `writeFile` / `mkdir` / `rm` / `rename`。缓存只在内存
  （默认 15 秒，`cacheSeconds` 可配，上限 3600）。
- **网络**：宿主半边不发请求；`client.js` 的 `fetch` 只打同源的 `/dsh-adaptive/*`。
- **遥测**：无。
- **唯一的间接副作用**：`POST /dispatch`（或面板按钮）把一条**由插件自己生成**的任务文本
  通过 `sessionController.prompt({mode:'queue'})` 投进候选会话。它只对 `link:` 安装的本地包生效，
  外部 npm 包直接 `EEXTERNAL` 拒绝；它不新建会话、不在当前对话里改代码；但**任务一旦进队，
  那个会话的 agent 就会按自己的权限去改文件**——写代码的不是这个插件，是它叫醒的那个 agent。
- **报告去哪了**：面板可以「复制 Markdown」到剪贴板；报告本身也可能被任何能访问 `/report.md`
  的一方读到（见上）。

## 已知限制（真实取舍，不是 bug）

1. **路由没有鉴权，`/dispatch` 是写入口**：能连上 DSH 端口的人可以让你已有的某个会话开始改代码。
   这是本插件最该被认真对待的一条。DSH GUI 本身也没有认证，所以这不是新引入的边界，
   但「只读插件」的描述容易让人低估这条路由。
2. **`/sessions` 会给出会话 id、标题与工作目录**；`/report.md` 会给出你本机源码的路径与片段。
3. **扫描是启发式**：`src/rules.js` 是一张正则表（`agent/session-start`、`ptc` 包改名、
   `workflow-engine`、`settings.yaml`、`readText`、`maxInlineBytes`、`appendPluginRecord`、
   `chat/completions` 等）。**会漏也会误报**，它给的是「去看一眼」的线索，不是判决。
4. **文件上限会静默截断**：包大到 300 文件 / 2 MB 之后的部分不扫，报告不会为此报警。
5. **判定规则是 DSH 自己的规则的复刻**（`src/compat.js` 对齐 `engines.dsh` 优先、
   否则查 `@deepseek-ai/dsh*` peer、预发布参与比较）。DSH 改了规则，这里就过时。
6. **Profile 定位是启发式**：多 Profile 都装了本插件时按 mtime 选一个，并在报告里写明来源；
   定位不到就报错，不猜。
7. **运行时版本识别有两条路**（`pluginManager.listBundles` → `@deepseek-ai/dsh-app-boot`
   的 `package.json`），都拿不到就显示「未识别」，不编一个版本号。
8. **面板依赖宿主 slot 契约**（`conversation.view`）与同源路由；宿主大改时会退化。
9. **`link:` 才可派发**：外部包只能看，不能一键适配（因为改不到它的源码）。

## 明确不算漏洞的

- 报告里有你本机源码的路径与片段（这是它的输出，见限制第 2 条）；
- 扫描读了你本机仓库的源码（junction 安装 + 只读扫描 = 设计，见上）；
- 正则漏报/误报（见限制第 3 条）；
- 大仓库只扫了一部分（见限制第 4 条）；
- 点「适配」之后 agent 改了文件（那是 agent 的行为，用户显式点的按钮）。

## 报告漏洞

用 GitHub 的私密渠道：<https://github.com/dingchenhui0618-arch/dsh-adaptive/security/advisories/new>

个人项目，**不承诺响应时限**；会读、会修，修完写进 [CHANGELOG](CHANGELOG.md)。
请不要把还在生效的问题直接发到公开 issue 里。

## 支持范围

只维护最新版 `0.2.x`（`package.json` 为 `0.2.0`）。没有发布到 npm，
所以「最新版」= 默认分支 `master` 的最新提交。
