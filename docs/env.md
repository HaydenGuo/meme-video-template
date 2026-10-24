# 环境变量与站点配置

Google 通用配置、回调地址和 Infisical 本地启动方式见 [Google 配置](google-auth.md)。

配置分三处，生效方式不同：

| 位置 | 内容 | 什么时候生效 |
| --- | --- | --- |
| `wrangler.jsonc` 的 `vars`（预发用 `wrangler.staging.jsonc`） | 非敏感的运行参数 | 构建时写进 `dist/server/wrangler.json`，`wrangler deploy` 读的是这份。改完要重新构建再部署（`npm run deploy` 会先构建）；只跑 `wrangler deploy` 会沿用上次构建的值 |
| Secret：本地写在 `.dev.vars`，线上用 `wrangler secret put <NAME>` 或 `node scripts/sync-secrets.mjs --apply`（读 `.dev.vars.production`）写入 | 密钥 | 运行时读取；写入会立即发布一个新版本 |
| `src/config/site.ts` | 关键词、品牌、域名、价格、统计 ID、站长验证等 | 编译进代码，改完要重新部署 |

浏览器拿不到任何环境变量：Google Client ID、Turnstile 站点密钥等前端需要的值由 `/api/me` 返回。项目里没有 `VITE_*` 变量。

`npm run doctor`（部署前）和后台概览的“上线配置检查”卡片（运行时）共用 `src/server/config-health.ts` 的规则：`APP_ENV` 为 production 或 staging 时，下表标为“上线必填”的缺了会报错。

## vars

Hypit 可选接入：`VIDEO_PROVIDER=hypit`，新增 `HYPIT_BRIDGE_URL`（Bridge origin，正式/预发必须 HTTPS）、`HYPIT_SITE_ID`（Bridge 已登记的站点）和服务端密钥 `HYPIT_BRIDGE_TOKEN`（至少 32 字符）。本地可用 loopback HTTP。完整步骤见 [Hypit 接入](hypit.md)；每个站点的模板标识和估算成本在 `site.video.hypit`。

| 名称 | 取值 | 上线必填 | 说明 |
| --- | --- | --- | --- |
| `APP_ENV` | `development`、`staging`、`production` | 是 | production 和 staging 下禁用 mock 服务商、开发登录和 `/api/dev/*`，Cookie 加 `Secure`。只有 production 允许搜索引擎抓取 |
| `SITE_URL` | `https://<domain>` | 是 | 用于 canonical、sitemap、邮件链接、视频服务商回调地址和 CSRF 同源校验。production 下要和 `site.domain` 是同一个站点 |
| `PAYMENT_PROVIDER` | `waffo`、`dodo`、`mock` | 是 | 新订单用哪个支付商。旧订单的退款和查单仍找原来的支付商。`mock` 只能在本地使用 |
| `WAFFO_ENVIRONMENT` | `test`、`prod` | 用 Waffo 时 | 决定 API 地址和验签公钥；webhook 里的 `mode` 和它不一致时拒收 |
| `WAFFO_PRODUCTS` | JSON，如 `{"starter":"PROD_xxx"}` | 用 Waffo 时 | 每个积分包和订阅套餐（`site.packages[].id`、`site.plans[].id`）对应的商品 ID，缺任何一个都报错（关掉订阅开关时不检查套餐，但已有订阅续费还要用，别删）。`scripts/waffo-setup.mjs` 可以生成 |
| `WAFFO_STORE_ID` | Waffo 的店铺 ID，如 `STO_xxx` | 用 Waffo 且开了订阅时 | 账单页“管理付款”的客户门户要用，空着时扣款失败的用户没法换卡。`waffo-setup.mjs --write-dev-vars` 会一起写入 |
| `DODO_ENVIRONMENT` | `test`、`live` | 用 Dodo 时 | 决定 API 地址 |
| `DODO_PRODUCTS` | 同上 | 用 Dodo 时 | `scripts/dodo-setup.mjs` 可以生成 |
| `VIDEO_PROVIDER` | `fal`、`yir`、`mock` | 是 | 模型和单价在 `site.video` 里配置，yir 的配置在 `site.video.yir` |
| `MODERATION_PROVIDER` | `openai`、`none`、`mock` | 是 | 上传图片的审核方式。`none` 不审核，检查时给出警告 |
| `GOOGLE_CLIENT_ID` | OAuth Client ID | 使用 Google 时 | 可留空，用户仍可通过邮箱密码登录；邮箱注册需要发件服务 |
| `TURNSTILE_SITE_KEY` | 站点密钥 | 否 | 留空则留言和举报表单不做人机校验，检查时给出警告 |
| `ADMIN_EMAILS` | 逗号分隔的邮箱 | 是 | 这些邮箱登录时自动成为管理员，同时接收举报、留言提醒和系统告警。从列表里删掉不会撤销管理员角色 |
| `EMAIL_FROM` | 发件地址 | 邮箱注册/找回密码时必需 | 域名要先在 Cloudflare Email Service 完成 Onboard，并配置 `EMAIL` binding；留空则邮箱注册及找回密码不可用，交易邮件记为 skipped |

## Secret

| 名称 | 什么时候需要 | 说明 |
| --- | --- | --- |
| `SESSION_SECRET` | 始终需要 | 用来签名交给视频服务商的图片地址和视频服务商回调 token，用 `openssl rand -hex 32` 生成。production 和 staging 下，少于 32 个字符或仍是 `.dev.vars.example` 里的示例值时，生成任务提交不出去，`/media/uploads/*` 返回 503 |
| `GOOGLE_CLIENT_SECRET` | 配了 `GOOGLE_CLIENT_ID` | |
| `WAFFO_MERCHANT_ID`、`WAFFO_PRIVATE_KEY` | `PAYMENT_PROVIDER=waffo` | 私钥支持 PKCS1 和 PKCS8，可以写成一行，换行用 `\n`。验签公钥已内置在代码里 |
| `DODO_API_KEY`、`DODO_WEBHOOK_SECRET` | `PAYMENT_PROVIDER=dodo` | API 密钥需要的权限见 README 的“第三方回调地址”；卖订阅还要 Subscriptions 读写和 Customers 写入，见 [subscriptions.md](subscriptions.md) |
| `FAL_KEY` | `VIDEO_PROVIDER=fal` | |
| `YIR_API_KEY` | `VIDEO_PROVIDER=yir` | 可选 secret，类型声明在 `src/env.d.ts`。建议在 yir Console 给这个 Key 设月度额度，见 README 的“视频服务商” |
| `OPENAI_API_KEY` | `MODERATION_PROVIDER=openai` | 可选 secret，类型声明在 `src/env.d.ts` |
| `TURNSTILE_SECRET_KEY` | 配了 `TURNSTILE_SITE_KEY` | 同上 |
| `PAYMENT_NOTIFY_WEBHOOK_URL` | 可选 | 每笔订单首次入账（含后台补单）时往聊天群发一条付款消息：金额、套餐、积分、来源和订单号。按域名识别：Telegram 填 `https://api.telegram.org/bot<token>/sendMessage?chat_id=<id>`；飞书 / Lark 填自定义机器人地址（不要开“签名校验”，可以用关键词“新付款”）；Discord 填频道 webhook；其他地址（如 Slack Incoming Webhook）发 `{"text": ...}`。发送失败只记日志，不影响入账。地址里带 token，所以放 secret。可选 secret，类型声明在 `src/env.d.ts` |

切换支付商后，只要旧支付商还有订单可能退款或需要查单，就保留它的 secret。

## site.ts 中和上线有关的字段

- `domain`：正式域名，要和 `SITE_URL` 一致。production 下仍是占位值时 doctor 报错。
- `packages`：积分包。`id` 要在 `*_PRODUCTS` 里有对应的商品，页面上的价格要和支付商后台一致。
- `subscriptionsEnabled`、`plans`：订阅开关和套餐（`interval` 为 `month` 或 `year`，`credits` 是每月发放量）。套餐同样要在 `*_PRODUCTS` 里有商品；不卖订阅时把开关设为 `false`。用法见 [subscriptions.md](subscriptions.md)，入账规则见 [payments.md](payments.md) 的“订阅”。
- `video`：模型、源视频帧率和每视频秒的成本，用于估算毛利。
- `analytics.ga4Id`、`analytics.cfBeaconToken`：统计。只有填了 `ga4Id` 才会显示 Cookie 同意横幅，此时归因 Cookie `vt_attr` 也等访客同意后才写入。
- `share.enabled`：成片公开分享页，默认开启。换脸、真人类站点风险高时设为 `false`，个人中心的分享按钮和 `/v/<id>` 页面都不出现。
- `seo.googleVerification`、`seo.bingVerification`、`seo.indexNowKey`：站长验证和 IndexNow。用 `new-site.mjs` 派生新站时会被清空。

## 仅脚本和测试使用的变量

| 名称 | 用在哪里 |
| --- | --- |
| `E2E_PORT` | `npm run test:e2e`，dev server 端口，默认 3000 |
| `SMOKE_BASE_URL`、`SMOKE_EXPECT`、`SMOKE_ALLOW_MOCK` | `npm run test:smoke`，见 README 的“部署后巡检” |
| `BRAND_NAME` | `scripts/generate-placeholder-media.mjs`，占位素材上的品牌名 |

`waffo-setup.mjs` 和 `dodo-setup.mjs` 从 `.dev.vars` 或同名环境变量读取凭据，不会打印密钥。

## 新增变量

新增变量时要同时改这些地方（`AGENTS.md` 有同样的清单）：

1. `wrangler.jsonc` 和 `wrangler.staging.jsonc` 的 `vars`。两份的键必须一致，`tests/unit/staging.test.ts` 会检查。
2. 如果是 secret，加进 `.dev.vars.example`。`sync-secrets.mjs` 会拒绝没登记的键，站点同步模板时也靠它发现新增的密钥。
3. 运行 `npm run cf:types`，重新生成 `worker-configuration.d.ts`。没写进 `.dev.vars` 的可选 secret，在 `src/env.d.ts` 里手动补上类型。
4. 在 `src/server/config-health.ts` 里加上线检查规则，在 `tests/unit/config-health.test.ts` 里加用例。
5. 更新本文件。
## 分阶段发布

| 环境变量 | 关闭时的行为 |
| --- | --- |
| `AUTH_ENABLED=false` | 关闭新的登录、注册和密码重置；既有会话与退出仍可用 |
| `GENERATION_ENABLED=false` | 关闭新上传和提交；已有任务继续处理，查看、下载与失败退款照常 |
| `PAYMENTS_ENABLED=false` | 关闭新结账；已有订单回调、对账、退款与订阅管理照常 |
| `SHOWCASE_MODE=true` | 关闭生成和购买；默认也关闭账户，可用 `SHOWCASE_AUTH_ENABLED=true` 开放账户，但仍受 `AUTH_ENABLED` 控制 |

新开关未设置时兼容旧站默认开放。配置值只支持字符串 `true` / `false`；拼写错误时 doctor 报错、运行时关闭对应入口。前台按 `/api/me` 返回的开关控制按钮，服务端在读取业务数据和调用服务商前再次拦截。

`npm run site:mode -- generate` 预览“登录和生成开放、充值关闭”，追加 `--apply` 写入本地 `wrangler.jsonc`。`accounts` 只开放账户，`full` 全部开放，`showcase` 仅展示，`local` 用于本地开发。可在开发环境准备各阶段的开关；`local` 只接受 development 环境。命令不部署，不修改 `APP_ENV`、URL 或凭据；正式上线仍需设置正确的生产/预发环境，并通过 `npm run doctor`。

doctor 只要求开启功能对应的服务商凭据。关闭开关不会删除已有密钥；有历史订单、订阅或任务时必须保留原服务商凭据，才能继续处理后台业务。

### 展示发布

`SHOWCASE_MODE=true` 可先上线介绍和案例。API 开放 `/api/me`、`/api/health` 及 POST `/api/contact`、`/api/takedowns`，客服与举报仍执行 CSRF、字段及限流校验；其它业务 API 返回 503（调试接口返回 404）。不运行队列业务和定时任务；没有发信配置时记录保存到数据库，邮件渠道请直接使用页面公布的客服邮箱。前端默认隐藏登录并禁用上传、生成与购买。此时 doctor 不要求未启用业务的服务商凭据，但仍检查 HTTPS、会话密钥、资源绑定和迁移。不要将它当作完整生成服务的验收。

展示站可额外设置 `SHOWCASE_AUTH_ENABLED=true` 且保持 `AUTH_ENABLED=true`，开放正式登录、退出、账户删除及账户页所需的只读接口。此时需要正常配置 Google OAuth 或真实邮箱验证发信服务；Google 回调为当前 origin 的 `/api/auth/google/callback`。生成、充值、兑换、调试接口和后台仍关闭，会话密钥保持本站独立且稳定。

阶段命令会将 `SHOWCASE_AUTH_ENABLED` 重置为 `false`，使预设结果确定；需要展示站登录时再显式开启它。同步模板到现有站点时保留本站开关，不用模板默认值覆盖。

离开展示模式时，设回 `false` 并按阶段开启其它三个开关，通过 doctor 再发布。已有队列消息会每小时重试且可能耗尽重试次数，切换前应确认无历史任务；展示模式不适合暂停已有活跃订单的站点，应使用独立开关。

## 提示词扫描

`PROMPT_SCAN_PROVIDER=waffo`：正式生成必需，使用 `WAFFO_MERCHANT_ID`、`WAFFO_PRIVATE_KEY`，与充值开关独立。`mock` 仅允许本地开发。关闭生成时不运行扫描，doctor 不要求该功能凭据。Hypit Bridge 的服务进程也要注入这两个密钥，详情见 [内容安全](content-safety.md)。
