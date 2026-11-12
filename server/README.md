# 方案内容助手：服务端

此目录是静态工作台的模型网关。API 密钥只放在服务端；浏览器只提交本次点击生成的企业资料、推广方向与服务配置，并使用单独的访问口令。接口不保存输入、结果或历史，不记录请求正文，也不会自动切换到另一家模型。

当前代码和测试不等于已部署服务。启用生成仍需部署 Worker、设置模型 API 密钥与访问口令，并在内容助手页面填写实际服务网址。

## Cloudflare Workers 部署

Cloudflare Workers 是默认部署方式，现有 GitHub Pages 工作台网址可以保留。

### 方式一：网页粘贴打包文件

全方案分区版与网页共用仓库中的 `assets/plan-schema.js`，入口已含 `import`。Quick Edit **必须使用完整打包产物**，不能只复制 `src/worker.mjs` 源码，否则缺少共享结构文件会启动失败。Secret 名称和原服务地址均可沿用。

先在完整仓库的 `server` 目录用 Node.js 22 或更新版本生成单文件：

```sh
npx wrangler@4.157.0 deploy --dry-run --outdir dist
```

此命令只打包，不发布；将输出的 `dist/worker.js` 全部内容用于下面步骤。不方便本机打包时，使用后文的 GitHub 仓库部署方式，由 Cloudflare 自动打包共享文件。

1. 登录自己的 Cloudflare 账号，进入 **Workers & Pages**，创建一个 **Worker**。可以先选择 Hello World，名称自行填写，然后完成首次部署。
2. 打开这个 Worker 的 **Edit code / Quick Edit**。选中入口文件，删除示例代码。
3. 打开刚生成的 `dist/worker.js`，复制全部打包代码到编辑器，保留其导出部分。选择模块 Worker 模式，不要改成旧式 Service Worker 模式。不要用 [入口源码 src/worker.mjs](src/worker.mjs) 替代打包文件。
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

### 方式二：连接 GitHub 仓库（无需手动打包）

在 Cloudflare 的 Workers 创建流程中连接完整仓库，由部署命令自动打包入口及共享结构文件：

- 根目录：`server`
- Worker 名称：`geo-plan-assistant`，与 `wrangler.toml` 中的名称保持一致
- Worker 入口：`src/worker.mjs`
- 部署命令：`npx wrangler@4.157.0 deploy`
- 构建环境：Node.js 22 或更新版本
- 无前端构建步骤；`wrangler.toml` 中已声明入口和非敏感配置。
- 保留完整仓库中的 `assets/plan-schema.js`；不要只上传或检出 `server` 子目录。

现有服务也可原样沿用已成功部署的仓库根目录配置：根目录为 `/`，部署命令为 `npx wrangler@4.157.0 deploy --config server/wrangler.toml`。这种方式同样会打包入口和共享结构文件，无需改成 `server` 根目录；更新同一个 Worker 时，原有 Secrets 和服务地址无需重新配置。

首次部署时，按方式一的 Secret 表添加三项值，再把实际服务地址填入助手；已有配置的服务可直接沿用。Cloudflare 的账号授权应在其界面完成，不要把账号令牌、模型密钥或访问口令提交到 GitHub。

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

打包产物不包含 Secret，`dist` 是被忽略的本机临时输出。升级已经部署的旧版 Worker 时，需要重新打包发布；新页面会通过 `/config` 的 `planVersion` 识别分区协议。原有三项 Secret 不需要改名。

## 接口

`GET /config` 和 `POST /generate` 均要求：

```text
Authorization: Bearer 服务访问口令
```

文档中的说明不是可直接使用的访问凭据。前端连接配置中应填写已部署 Worker 的真实根地址。

`GET /config` 仅返回模型标识、名称、是否配置、`planVersion: 2`、四个分区的标识与名称、输入字段长度限制，不返回密钥或访问口令。

所有响应均带非敏感版本头 `X-GEO-Plan-Version: 2`，可用于确认已更新的代码版本；这个响应头不授予访问权限，未鉴权请求仍返回401，不能读取模型配置或生成内容。

`POST /generate` 的共用请求字段：

- `provider`：`deepseek` 或 `gemini`
- `companyInfo`：企业资料，非空，最多12000字符
- `promotionDirection`：推广方向，非空，最多4000字符
- `constraints`：可选补充约束，最多2000字符

请求体最大96 KiB，按实际字节流检查，不依赖请求头声明。单次生成总超时60秒，包括一次可能的结构修复。

全方案分区协议额外提交：

- `version`：数字 `2`
- `section`：`profile` 客户资料与目标、`service` 服务内容与报价、`schedule` 首月与全期排期、`operations` 工作说明与反馈，单次只生成一个分区。
- `serviceFacts`：已知的我方服务配置对象；可省略或填空对象，未知内容按待确认处理。

`serviceFacts` 字段：

| 字段 | 格式与上限 |
| --- | --- |
| `provider` | 服务方，最多120字符 |
| `date` | 有效的 `YYYY-MM-DD` 日期或空字符串 |
| `durationMonths` | 1至120个月的整数或纯数字字符串；未知填空字符串 |
| `platforms` | 拟关注 AI 平台，最多1000字符 |
| `scope` | 已确认服务范围，最多6000字符 |
| `fee` | 已知费用与费用口径，最多2000字符；未知可空 |
| `resources` | 数量与资源说明，最多4000字符 |
| `resourceType` | `unspecified` 口径待确认、`execution_quota` 执行资源额度、`deliverables` 已明确交付数量 |

成功响应保留 `result`、`provider`、`model`、`requestId`，并带 `version: 2` 和 `section`。`result` 为 `{fields: {...}, copy: {...}}`，字段与 [共享结构定义](../assets/plan-schema.js) 中对应分区精确一致，空分组保留空对象；每个字段是字符串，`fields.questions` 为5行不同提问的字符串。一次生成不返回其他分区，避免整套输出过长。

服务分区的服务方、日期、周期、平台、范围和费用由用户服务配置规范化覆盖，不由模型改价、改量或改周期。空日期和空费用保留；资源额度明确区分于同量成稿、成片或发布交付。模型额外字段先拒绝，再覆盖锁定事实，不能借覆盖过程混入未知键。其他AI正文若含明显报价金额，会按结构错误修复一次；用户原始范围与费用不做这项扫描。短周期不适用的后续阶段统一为“本服务周期不另设此阶段。”；13个月及更长周期按实际期末展开。周期未知时仅给参考阶段，不默认签订年度合同。

兼容旧页面：未提交 `version` 或使用 `version: 1` 时仍返回原十字段对象，`questions` 仍是5个不同提问组成的数组。

Gemini 分区协议使用 `generationConfig.responseJsonSchema`，与 Google 官方 SDK 的 `GenerateContentConfig` 定义一致，并用 `additionalProperties` 限制额外字段。已核对官方 SDK 类型定义；实际模型账号、权限与生成结果仍需部署后验证。

提示词建议使用适合人工核对及A4排版的简洁段落，字数仅为建议，不截断真实名称、不为凑长度增加事实。服务端会校验 JSON、字段类型、问题数量及明显的未替换占位内容。模型输出结构错误时只对同一家模型修复重试一次；鉴权、额度等错误不重试，不向客户端回传模型原始错误正文。结构校验不代表业务事实已审核，输出仍须由销售和客户检查。

## 测试与本地运行

后端没有第三方运行依赖：

```sh
node --test test/*.test.mjs
```

测试使用注入的模拟传输，不会调用真实模型或消耗额度。

测试覆盖两种模型的四个分区、旧版十字段协议、锁定服务事实、输入边界、周期阶段、结构修复与错误脱敏。入口导出兼容性有回归测试；实际 Worker 打包应使用上述 dry-run 命令。所有测试和本地验证均不表示已部署到线上，也不表示已验证真实模型账号。

分区版已通过 Wrangler 4.157.0 dry-run 打包及本地 workerd 运行验证：未鉴权请求返回401并带版本头；鉴权后配置返回四个分区；允许来源的预检返回204，未知来源返回403；未设模型密钥的分区生成返回503。没有发起真实模型调用。

Cloudflare 本地开发可将 `.dev.vars.example` 复制为被忽略的 `.dev.vars`，在自己机器中填值，再运行 `npx wrangler@4.157.0 dev --local`。

也提供 Node 适配器 `src/node-server.mjs`。使用进程环境变量注入 Secret 后，执行 `npm start`；默认仅监听本机 `127.0.0.1` 的8787端口。公网部署需由管理员配置 HTTPS 和相应反向代理，前端网址加入 `ALLOWED_ORIGINS`。不要把本机 HTTP 开发地址当作已上线服务网址。
