# 方案内容助手：服务端

此目录是静态工作台的模型网关。API 密钥只放在服务端；浏览器只提交本次点击生成的企业资料，并使用单独的访问口令。接口不保存输入、结果或历史，不记录请求正文，也不会自动切换到另一家模型。

当前代码和测试不等于已部署服务。启用生成仍需部署 Worker、设置模型 API 密钥与访问口令，并在内容助手页面填写实际服务网址。

## Cloudflare Workers 部署

Cloudflare Workers 是默认部署方式，现有 GitHub Pages 工作台网址可以保留。

### 方式一：网页粘贴单文件（推荐，无需终端）

此入口文件没有第三方依赖或 `import`，可以直接粘贴到 Cloudflare 的模块 Worker 编辑器，不需要先下载项目、安装 Node.js 或在本机打包。

1. 登录自己的 Cloudflare 账号，进入 **Workers & Pages**，创建一个 **Worker**。可以先选择 Hello World，名称自行填写，然后完成首次部署。
2. 打开这个 Worker 的 **Edit code / Quick Edit**。选中入口文件，删除示例代码。
3. 打开仓库中的 [完整入口代码 src/worker.mjs](src/worker.mjs)，复制全部内容到编辑器。应包含文件末尾的 `export default createWorker();`。选择模块 Worker 模式，不要改成旧式 Service Worker 模式。
4. 点击 **Deploy / Save and deploy** 保存代码，等待部署成功。
5. 进入该 Worker 的 **Settings → Variables and Secrets**，将下表三项以 **Secret** 类型添加。填写自己的真实值后保存，并按界面要求重新部署使其生效。
6. 从这个 Worker 的详情页复制 Cloudflare 实际分配的 HTTPS 访问地址，通常以 `workers.dev` 结尾。复制真实地址，不自行拼接域名；在内容助手中使用根地址，不在末尾添加 `/config` 或 `/generate`。
7. 回到“方案内容助手”页面，打开 **连接设置**，填写“生成服务地址”和“服务访问口令”，点击 **连接并检查**。连接成功后选择 DeepSeek 或 Gemini，再填写企业资料生成内容建议。

需要配置的 Secret：

| 名称 | 填写内容 | 使用范围 |
| --- | --- | --- |
| `ASSISTANT_ACCESS_TOKEN` | 自己设置的至少16字符独立访问口令，建议使用密码管理器生成 | 在内容助手页面连接服务时使用 |
| `DEEPSEEK_API_KEY` | 自己的 DeepSeek API 密钥 | 仅由 Worker 调用 DeepSeek |
| `GEMINI_API_KEY` | 自己的 Gemini API 密钥 | 仅由 Worker 调用 Gemini |

模型密钥只填在 Cloudflare 的 Secret 中；页面的“服务访问口令”填独立口令，不填模型密钥或 GitHub 密码。不要把这些值写进公开仓库或聊天消息。

Worker 地址是接口服务地址。直接在浏览器打开其根地址时可能显示“未找到该接口”；请通过助手页面的“连接并检查”验证连接。连接检查核对服务口令和配置状态，真正生成还需要对应模型的账号权限、额度及服务地区可用。

某家模型尚未配置密钥时会显示不可用，不会自动改用另一家模型。可先配置一家使用，另一家后续再补；需要两家都可选时，两项模型 Secret 都应配置。

### 方式二：连接 GitHub 仓库

熟悉仓库自动部署的用户，也可以在 Cloudflare 的 Workers 创建流程中连接此仓库：

- 根目录：`server`
- Worker 名称：`geo-plan-assistant`，与 `wrangler.toml` 中的名称保持一致
- Worker 入口：`src/worker.mjs`
- 部署命令：`npx wrangler@4.157.0 deploy`
- 构建环境：Node.js 22 或更新版本
- 无前端构建步骤；`wrangler.toml` 中已声明入口和非敏感配置。

部署后，仍需按方式一的 Secret 表添加三项值，再把实际服务地址填入助手。Cloudflare 的账号授权应在其界面完成，不要把账号令牌、模型密钥或访问口令提交到 GitHub。

### 方式三：终端部署

需要 Node.js 22 或更新版本以及自己的 Cloudflare 登录授权。在本目录依次运行：

```sh
npx wrangler@4.157.0 login
npx wrangler@4.157.0 deploy
npx wrangler@4.157.0 secret put ASSISTANT_ACCESS_TOKEN
npx wrangler@4.157.0 secret put DEEPSEEK_API_KEY
npx wrangler@4.157.0 secret put GEMINI_API_KEY
```

每个 `secret put` 命令会在终端单独提示输入，不要将密钥追加在命令中。部署后复制终端或 Cloudflare 界面实际显示的访问地址，在助手中完成“连接并检查”。

### 可选非敏感变量

| 名称 | 默认值 | 用途 |
| --- | --- | --- |
| `ALLOWED_ORIGINS` | `https://harunli05.github.io` | 允许的网页来源，多个完整 origin 用英文逗号分隔；不支持星号或路径 |
| `DEEPSEEK_MODEL` | `deepseek-chat` | DeepSeek 模型名称 |
| `GEMINI_MODEL` | `gemini-flash-latest` | Gemini 模型名称，可按账号实际支持的模型调整 |

Google 官方 SDK 的 README 当前使用 `gemini-flash-latest` 别名，因此默认采用该别名。模型可用性可能变化，可在服务端改为账号支持的型号；不得把地址、密钥或任意代理 URL 填入模型名称。

开发者可用 `npx wrangler@4.157.0 deploy --dry-run --outdir dist` 检查打包；网页粘贴部署不需要这一步。打包产物不包含 Secret，`dist` 是被忽略的本机临时输出。

## 接口

`GET /config` 和 `POST /generate` 均要求：

```text
Authorization: Bearer 服务访问口令
```

文档中的说明不是可直接使用的访问凭据。前端连接配置中应填写已部署 Worker 的真实根地址。

`GET /config` 仅返回模型标识、名称、是否配置和字段长度限制，不返回密钥或访问口令。

`POST /generate` 的请求字段：

- `provider`：`deepseek` 或 `gemini`
- `companyInfo`：企业资料，非空，最多12000字符
- `promotionDirection`：推广方向，非空，最多4000字符
- `constraints`：可选补充约束，最多2000字符

请求体最大64 KiB。成功响应包含 `result`、`provider`、`model`、`requestId`；`result` 为约定的十字段对象，`questions` 恰为5个不同的提问。

提示词建议使用适合人工核对及A4排版的简洁段落，字数仅为建议，不截断真实名称、不为凑长度增加事实。服务端会校验 JSON、字段类型、问题数量及明显的未替换占位内容。模型输出结构错误时只对同一家模型修复重试一次；鉴权、额度等错误不重试，不向客户端回传模型原始错误正文。结构校验不代表业务事实已审核，输出仍须由销售和客户检查。

## 测试与本地运行

后端没有第三方运行依赖：

```sh
node --test test/*.test.mjs
```

测试使用注入的模拟传输，不会调用真实模型或消耗额度。

当前版本也已通过 Wrangler 打包及本地 workerd 运行验证：未配置访问口令时返回503，允许来源的预检返回204，未知来源返回403。入口导出兼容性已加入回归测试。这些是本地验证记录，不表示已部署到线上，也不表示已验证真实模型账号。

Cloudflare 本地开发可将 `.dev.vars.example` 复制为被忽略的 `.dev.vars`，在自己机器中填值，再运行 `npx wrangler@4.157.0 dev --local`。

也提供 Node 适配器 `src/node-server.mjs`。使用进程环境变量注入 Secret 后，执行 `npm start`；默认仅监听本机 `127.0.0.1` 的8787端口。公网部署需由管理员配置 HTTPS 和相应反向代理，前端网址加入 `ALLOWED_ORIGINS`。不要把本机 HTTP 开发地址当作已上线服务网址。
