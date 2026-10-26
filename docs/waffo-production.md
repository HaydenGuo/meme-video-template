# Waffo 正式收款启用

这份清单用于已有模板站接入 Waffo 正式收款。生产开关默认关闭；只有站点负责人明确要求开通并确认正式商品、凭据和回调后，才打开新购买。支付测试始终使用 test 环境，不使用真实银行卡或真实收款验证。

## 正式开通前

在 [Waffo Dashboard](https://pancake.waffo.ai/) 完成以下准备，并确认商户及站点审核状态允许正式收款：

1. 在正式环境创建或确认店铺，并记录 **Store ID**（`STO_...`）。Store ID 和 Merchant ID 是不同字段。
2. 在正式环境创建 API Key，安全保存正式环境的 **Merchant ID** 与 **Private Key**。test 和 prod 凭据不能混用；不要提交到 Git、粘贴到聊天、放进前端变量或写入日志。
3. 为每个 `site.packages[].id` 创建正式的一次性商品。商品显示名称可以与代码里的套餐名不同，但后台商品价格/币种必须和 `src/config/site.ts` 相同；代码映射使用套餐 `id`，不是商品显示名称。
4. 从正式商品页取得每个商品的 `PROD_...` 商品 ID。`scripts/waffo-setup.mjs` 可依据当前 `site.ts` 生成商品；只有确认要创建正式商品后才以正式 Merchant 凭据运行 `node scripts/waffo-setup.mjs --store STO_xxx --prod --apply`。重复创建前先检查 Dashboard；脚本仅在 `WAFFO_PRODUCTS` 已包含对应套餐 key 时跳过。
5. 在正式环境的 Webhooks 设置添加 `https://<正式域名>/api/webhooks/waffo`，启用 `order.completed`、`refund.succeeded`、`refund.failed`；启用订阅时还要添加 `subscription.activated`、`subscription.payment_succeeded`、`subscription.renewed`、`subscription.recovered`、`subscription.canceling`、`subscription.uncanceled`、`subscription.canceled`、`subscription.past_due`。确认是 Production webhook（`testMode: false`）并使用 Dashboard 为此 webhook 提供的正式验签公钥/配置。

可先用 Dashboard 的 **Send Test Event** 验证正式 Webhook URL 可达及站点返回 2xx。此操作只发送测试事件，不创建付款。模板的 `scripts/waffo-setup.mjs --webhook ...` 会按当前 `WAFFO_ENVIRONMENT` 添加 webhook；使用 `--prod` 时才会请求生产模式。切勿把测试 webhook 当作正式验收。

## 把正式配置写入项目

先在代码仓库修改 `wrangler.jsonc` 的非敏感变量，并对照代码套餐 ID 和 Waffo Dashboard 中的正式商品：

```jsonc
"PAYMENT_PROVIDER": "waffo",
"PAYMENTS_ENABLED": "true",
"WAFFO_ENVIRONMENT": "prod",
"WAFFO_PRODUCTS": "{\"starter\":\"PROD_...\",\"party\":\"PROD_...\"}"
```

这只是结构示例。必须使用当前站点 `site.packages[].id` 对应的全部正式商品 ID；不能照抄其他站点的 ID。正式商品在 Dashboard 的实际价格和币种要与 `site.ts` 一致。启用订阅时，还需将每个 `site.plans[].id` 映射至正式订阅商品，并设置 `WAFFO_STORE_ID`。

将正式 `WAFFO_MERCHANT_ID`、`WAFFO_PRIVATE_KEY` 设置为 Cloudflare Worker 的生产 Secrets（或使用已批准的 `scripts/sync-secrets.mjs` 安全流程）。若该站点的部署前 `doctor` 需要读取正式 secrets，也按项目的安全流程配置 `.dev.vars.production` 并确保文件被 Git 忽略。不得把 secret 写进 `wrangler.jsonc`、GitHub Variables、客户端代码或仓库提交。Github Actions 的 Cloudflare deploy token/account ID 是部署凭据，与 Waffo 运行时凭据分开管理。

不要只在 Cloudflare Dashboard 手工改 Worker variables：`wrangler.jsonc` 是部署配置源，后续 GitHub 部署会重新发布代码及其变量。先将配置提交到该站点分支，再开 PR/合并至部署分支；确认精确提交的 CI 通过后，由仓库既有 GitHub Actions 工作流部署 Cloudflare Worker。若工作流因配置停用，先修复 GitHub Actions 自动部署配置，再发布；不以本机 `wrangler deploy` 取代 Git 流程。

## 安全验收

1. `npm run doctor` 检查部署配置、套餐映射、迁移和所需 secrets 是否齐备。不要输出或复制 secret 值。
2. 测试付款只用 `WAFFO_ENVIRONMENT=test`、test Merchant 凭据及 test 商品；`npm run test:sandbox` 会进入真实测试收银台，但只允许使用 Waffo 测试卡。用户要求避免真实付款时，不运行任何 live checkout、扣款或退款测试。
3. 正式部署完成后，核对 GitHub Actions 的确切 SHA、Cloudflare Worker 版本/部署记录及生产 `/pricing` 页面。开启后检查套餐价格、币种、积分和购买按钮。
4. 可用管理员 `/admin` 的付款连接探测做无扣款检查：确认商户凭据及商品映射可用。该探测不能证明 Dashboard 商品价格正确，也不能替代商品逐项比价、Webhook Send Test Event 或线上页面核验。
5. 任何一步失败，保持或恢复 `PAYMENTS_ENABLED=false`，查明原因后通过 Git 修复和重新部署；不要通过真实扣款确认功能。

## 官方资料

- [Waffo Pancake 官方 Skill](https://docs.waffo.ai/zh/integrate/skill)
- [Waffo Webhooks](https://docs.waffo.ai/zh/api-reference/webhooks)
- [Waffo 文档全文](https://docs.waffo.ai/llms-full.txt)
- [支付实现约定](payments.md)
- [环境变量与 Secrets](env.md)
- [GitHub Actions 自动部署 Cloudflare](cloudflare-auto-deploy.md)
