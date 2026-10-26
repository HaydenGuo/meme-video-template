# Waffo 站点审核与正式开通清单

此文档用于把 Waffo Pancake 接入一个视频站。支付代码、网站合规介绍和商户审核是三项不同工作：模板通过审核或 K/DA Firestarter 获准收款，不代表 Uptown Funk 或其他站点也已获准。每个品牌都要在 Waffo Dashboard 确认适用的商户、店铺、商品和站点审核状态。

## 先准备网站介绍和公开政策

在申请或开通支付前，以访客身份直接打开站点，确认 HTTPS、价格页、客服入口和页脚政策都能访问。当前模板会生成以下法律页面：

- `/terms-of-service`：服务范围、年龄要求、素材权利和同意、AI 结果使用、积分与支付、责任限制。
- `/privacy-policy`：账户数据、上传照片和生成视频用途、处理服务商、保留期限、删除方式及用户隐私请求。
- `/refund-policy`：生成失败自动退积分、未使用积分包退款条件、质量问题处理、现金退款方式及联系途径。
- `/acceptable-use-policy`：未成年人、未经同意的真人合成、色情、暴力、骚扰、版权侵权和举报处理规则。
- `/contact`：账单、退款、隐私和内容举报的可用联系地址。

逐项确认以下内容与该站真实实现一致：

1. 在 `src/config/site.ts` 填写已核实的 `business.operatorName`、`business.videoModel`、`business.videoProcessor`、`business.paymentProcessor` 和 `supportEmail`。不要照抄其他站的域名、客服邮箱、主体、模型或资源 ID。经营主体未知时保留空值并先确认，不能用品牌名冒充法律主体。
2. `business.paymentProcessor` 写实际准备使用的支付处理商（例如 `Waffo Pancake`）。页面应说明支付只在开放后由该处理商处理，并以支付商收银台披露的法定销售方和税费为准；不得写成站点已获批准。
3. 公开服务说明要与实际产品一致：用户提交有权使用的成年人物照片，选择视频长度并消费积分生成 AI 视频；明确示例为合成内容、输出可能不同，并说明禁止用途与举报方式。
4. `site.packages` 的积分、价格和币种必须与 Waffo 商品完全一致。说明每秒视频的积分规则、购买积分是否过期、是否为一次性购买及是否自动续费。只在确实开通时展示可购买状态。
5. 退款政策必须由站点负责人确认并与后台实际退款能力相符。模板政策分别说明失败生成退积分、未使用积分包的退款请求、质量问题、原路退款和消费者法定权利。不要把其他站的期限或承诺自动当作本站政策。
6. 隐私政策须准确点名本站的托管、视频生成、邮件和支付服务商及实际保留期限。不得声称 Waffo 收集提示词、审核照片或执行视频内容审核，除非本站确实调用相应服务。

### Waffo 审核资料描述范本

以下英文只作逐站改写的起稿；方括号内容须替换，删掉不适用的句子，并与网站及 Waffo Dashboard 保持一致：

> **[Brand]** is a browser-based AI video creation service. Customers upload a photo they own or have permission to use, choose a supported video length, and spend credits to request a short AI-generated video. Credit packs are one-time digital purchases in [currency]; [credits per second] credits are used per second of output, and [state the actual expiry and renewal terms]. We do not sell physical goods. Checkout and applicable tax are handled by Waffo Pancake; the checkout identifies the legal seller. Failed renders automatically return the credits used for that render. Customers can contact [support email] about billing, refunds, privacy, or content reports. User media is processed by [actual generation provider] and retained for [actual retention periods]. Our Terms of Service, Privacy Policy, Refund Policy, and Acceptable Use Policy are available at [policy URLs].

不得声称审核已通过、所有请求都会成功、AI 结果有固定质量、拥有第三方音乐/舞蹈/商标权，或没有实际证据支持的数据处理保证。Waffo Merchant of Record 对应的法律销售方与税务信息，以当前收银台和商户协议为准。

## 为单个站点配置 Waffo

先读 [Waffo 官方 Skill](https://docs.waffo.ai/zh/integrate/skill) 与 [官方 Webhook 说明](https://docs.waffo.ai/zh/api-reference/webhooks)。当前模板实现使用 `WAFFO_MERCHANT_ID`、`WAFFO_PRIVATE_KEY`、`WAFFO_ENVIRONMENT`、`WAFFO_PRODUCTS`；`WAFFO_STORE_ID` 仅在启用订阅、需要客户门户时使用。**Merchant ID 不等于 Store ID。**

### Test 环境

1. 在 Dashboard 选择 Test 环境，使用 Test Merchant ID、Private Key、Store ID 和 Test 商品；不能混用 Production 凭据或商品。
2. 将每个 `site.packages[].id` 映射到对应的 `PROD_...` 或测试商品 ID（依环境而定）。ID 键是代码套餐 ID，不是商品显示名称。Waffo `scripts/waffo-setup.mjs` 可以按当前站点套餐生成 dry-run 计划；创建商品或 webhook 前先检查 Dashboard，避免重复创建。
3. 注册 test webhook 到 `https://<测试域名>/api/webhooks/waffo`，设置 `testMode: true`。按 Dashboard 当前 Test 公钥核对模板内置的 Test 验签公钥。
4. 用测试卡运行 `SANDBOX_PROVIDER=waffo npm run test:sandbox`，验证测试收银台、成功回跳/查单与积分只入账一次；用 Dashboard 的 Send Test Event 验证 webhook 可达。Test 流程不得使用真实银行卡。

### Production 环境

1. 为目标站点确认商户/品牌审核已覆盖该网站，再创建或核对正式店铺、正式商品和 `PROD_...` ID。K/DA Firestarter 的批准记录不能直接视为其他站点批准。
2. 逐项核对每个商品的实际价格、币种、一次性/订阅类型和代码套餐定义；代码映射必须覆盖全部在售 `site.packages[].id`。不把其他站点的商品 ID 复制进来。
3. 将正式 `WAFFO_MERCHANT_ID`、`WAFFO_PRIVATE_KEY` 放入目标 Cloudflare Worker 的 Production Secrets；按目标仓库的 GitHub Actions 部署流程管理。秘密值不得写进 Wrangler 变量、Git、日志或聊天。Test 与 Production 凭据严格分开。
4. 在生产店铺登记 `https://<正式域名>/api/webhooks/waffo`，至少订阅 `order.completed`、`refund.succeeded`、`refund.failed`，并设 `testMode: false`。对照 Dashboard 的 Production 公钥与模板内置 Production 验签公钥；官方说明 Test 和 Production 公钥不同，不能混用。
5. Production `wrangler.jsonc` 需明确配置 `PAYMENT_PROVIDER=waffo`、`WAFFO_ENVIRONMENT=prod`、准确的 `WAFFO_PRODUCTS`；只有站点负责人明确批准开放收款，并且审核、商品、凭据、Webhook 和最终 SHA 的 CI/部署均已核实后，才把 `PAYMENTS_ENABLED` 设为 `true`。
6. 先做不会扣款的验收：Waffo Dashboard 的 Send Test Event、站点 `/admin` 支付连接探测、部署记录的确切源码 SHA/Worker 版本，以及生产价格和政策页面。不要用真实付款证明集成成功；没有清晰授权时不做任何 live checkout。

## 交付记录

为每站记录非敏感状态：站点 URL、负责人/支持邮箱是否核实、审核适用范围、套餐 ID→商品 ID 映射是否齐全（只记脱敏标识）、Test/Production webhook 状态、支付开关状态、精确源码 SHA 和 Worker 版本。不要记录 Merchant Private Key、用户支付资料或其他站的资源 ID。
