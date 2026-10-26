# GitHub 推送后部署 Cloudflare

`.github/workflows/deploy.yml` 在 `main` 的 CI 成功后发布该次检查对应的提交，也允许从 `main` 手动触发。模板默认关闭，站点完成配置后开启。

Waffo 正式收款需先按 [正式收款清单](waffo-production.md) 配好站点源码与正式凭据，再走本 GitHub → Cloudflare 发布流程。

1. 在 Cloudflare 建立该站独立的 D1、R2、KV 和队列，将实际绑定写入 `wrangler.jsonc`。
2. 配置生产环境、实际服务商和站点地址，并按 [分阶段发布](env.md#分阶段发布) 选择开放程度。可先用 `SHOWCASE_MODE=true` 发布新站介绍与案例，或关闭 `PAYMENTS_ENABLED` 延后充值；运行 `npm run doctor -- --offline`。不要关闭已有订单需要的回调与凭据。
3. 用 `scripts/sync-secrets.mjs` 将运行时密钥直接传给 Worker，密钥文件不要提交 Git。
4. 在 GitHub 的 `production` environment 设置 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`。API token 限定目标账户，包含 Workers、D1、KV、R2、Queues 的必要编辑权限；不要使用本机 Wrangler OAuth 登录令牌代替 CI token。
5. 将仓库变量 `CLOUDFLARE_AUTO_DEPLOY` 设为 `true`。
6. 推送 `main`，等待 CI 成功，再检查部署摘要中的 Source SHA 与 Worker 部署记录。发布流程检出 CI 的确切提交，依次安装依赖、类型检查、离线配置检查、数据库迁移和完整部署；CI 失败或取消不会自动发布。

同站部署串行排队。配置检查失败不会继续迁移或发布。数据库迁移不会随 Worker 回滚自动撤销。

域名仍可在 Spaceship 注册。Worker 自定义域名需要已激活的 Cloudflare zone，委派 nameserver 前应核对现有 DNS，取得授权。仅推送代码不会自动完成域名委派、API 服务商开户或 OAuth 回调授权。
