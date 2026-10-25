# 模板通用 Google 登录

Google 登录模块随模板供各热词站复用。OAuth 配置与 Hypit Bridge、VPS 地址无关，不向 Halloween 网站转发登录请求。

## 每个站点的配置

| 配置 | 用途 |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Google OAuth Web 客户端 ID |
| `GOOGLE_CLIENT_SECRET` | 仅供服务端读取的客户端密钥 |
| `SESSION_SECRET` | 本站独立、稳定的随机密钥，至少 32 字符；不要用 Google Secret 代替 |
| `SITE_URL` | 本站完整地址，部署时与正式域名一致 |

在 Google Cloud 对应 OAuth Web 客户端登记两项：每个实际提供登录页面的 **Authorized JavaScript origins**（只填写 origin，不带路径），以及精确的 **Authorized redirect URI** `${SITE_URL}/api/auth/google/callback`。Google 登录入口会先把别名域名跳转到 `SITE_URL`，再设置 state cookie；授权请求与 token 交换都使用这个规范回调地址。

- 当前本地：`http://127.0.0.1:3016/api/auth/google/callback`
- 若用 localhost：`http://localhost:3016/api/auth/google/callback`
- 正式站 Authorized redirect URI：`https://<本站规范域名>/api/auth/google/callback`

例如，页面同时支持 `https://example.com` 与 `https://www.example.com` 时，两者都要登记为 Authorized JavaScript origins；Authorized redirect URI 只登记规范 `SITE_URL` 对应的回调。需要本地 Google 登录时，另外登记本地 origin，例如 `http://127.0.0.1:3016`。JavaScript origin 不得带路径或回调地址。

回调地址、端口和路径必须完全一致。Halloween 的 Auth.js 路径 `/api/auth/callback/google` 与本模板不同，需另外登记。同一运营方可在同一 Web 客户端登记多个站点；不同品牌的同意屏幕需求可使用各自客户端。

各站点使用独立数据库和会话；Google 与邮箱密码登录在本站按已验证的规范化邮箱复用用户 ID、积分、订单及视频。复用 OAuth 客户端不会让不同站点共享积分或会话。

## 本地文件方式

继续使用 `npm run dev`。Client ID 可配置在 `wrangler.jsonc` 的 vars，Secret 和 SESSION_SECRET 放在被 Git 忽略的 `.dev.vars`。真实 Secret 不写入源码或 wrangler vars。

## Infisical 方式

1. 为本站准备专属目录，保存上述配置及启用服务商所需密钥；可用 Infisical 引用复用 OAuth 凭据。
2. 根目录不能有 `.dev.vars` 或 `.dev.vars.local`，否则 Cloudflare 不会按预期读取进程环境。脚本会拒绝启动，不会移动或覆盖现有文件。
3. 登录 Infisical 后，在项目目录用 PowerShell 启动（占位参数需替换）：

```powershell
infisical run --domain http://localhost/api --projectId <项目ID> --env dev --path /<本站目录> -- npm run dev:infisical -- --port 3016
```

启动器兼容 Halloween 的 `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`，仅在子进程中映射为标准变量；已有 `GOOGLE_CLIENT_*` 优先。不写 dotenv 文件，不打印密钥。仅注入本站目录。

环境加载规则见 [Cloudflare 官方文档](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/)。此入口只启动开发服务，正常生产构建不使用它。

## 部署和当前状态

Cloudflare 部署沿用 `GOOGLE_CLIENT_ID` vars 与 `wrangler secret put GOOGLE_CLIENT_SECRET`。Infisical 是配置源，线上 Worker 不依赖本机 Infisical 或 Halloween VPS 在线。修改部署配置前核对目标站点。

模板不附带 Google 凭据。每次派生新站，需从自己的私有配置源提供凭据并登记本站回调；现有站点的回调应保留。

2026-10-24 已在内置浏览器完成实际验证：退出演示账户，点击 Google 登录，选择已有 Google 账号并继续授权，成功返回 `/zh/dashboard`。页面显示真实邮箱及该账户的 0 积分；刷新后仍保持登录。截图保存在本地忽略目录 `.tmp/google-auth/google-login-success.png`。此次验证不包含正式域名、One Tap 或真实邮件投递。

复用客户端时，Google 授权页仍会显示原项目的应用名称。独立品牌上线前应确认 Google 项目的品牌配置；单独创建同项目客户端不会自动变更项目级应用名称。
