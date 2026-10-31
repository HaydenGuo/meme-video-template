# 模板通用 Google 登录

Google 登录模块随模板供各热词站复用。OAuth 配置与 Hypit Bridge、VPS 地址无关，不向 Halloween 网站转发登录请求。

## Google Cloud 配置顺序

1. 优先在用户已登录的 Google Cloud Console 中打开已经批准的 **OAuth Web 客户端**。核对客户端 ID 与本站 `GOOGLE_CLIENT_ID` 一致；保留其它站点现有条目，只添加本次站点实际使用的 origins 和回调。不要为绕过 origin/callback 错误而创建另一个客户端。
2. **Authorized JavaScript origins** 填每个实际显示 Google 登录按钮的 origin，例如 `https://example.com`、`https://www.example.com`；只填 scheme、host、port，不加路径。
3. **Authorized redirect URIs** 填规范 `SITE_URL` 加 `/api/auth/google/callback`。本地开发用 `http://127.0.0.1:<port>/api/auth/google/callback`，正式和预发分别使用对应的站点地址。
4. 在品牌页核对授权网域包含本站的根域名。受众群体必须允许外部用户；正式使用时确认发布状态。客户端条目、来源和回调是客户端级设置；同意页名称、主页、隐私政策和支持邮箱是项目级设置，会影响同项目内所有使用者。共享客户端尚未确认多站品牌方案前，不修改这些项目级品牌字段。
5. Google Cloud 创建后的客户端密钥不能再次查看或下载；每个客户端最多保留 2 个 Secret。优先从本站授权的私密配置源读取 `GOOGLE_CLIENT_SECRET`。确实缺失时，先取得用户明确授权，再在同一已批准客户端添加 Secret；名额已满时，仅在用户授权后删除确认无使用方的已停用 Secret，保留仍启用的旧 Secret直到新值完成部署和真实登录验证。用 Playwriter 将新值直接传入本地忽略的 `.dev.vars` 或目标 Cloudflare Worker Secret；不要把密钥显示给操作者、写入剪贴板、日志、wrangler vars、初始化报告、源码、终端输出或聊天。

以 Playwriter 操作 Google Cloud Console 时，每次仅执行一个保存动作；保存后重新打开同一客户端读回来源、回调和客户端 ID，确认旧站条目仍在。未经授权不要删除、覆盖或重命名其它站点的条目。

### 初始化和发布门禁

- `site-profile.example.json` 的 `googleAuthRequired` 表示 Google 登录是否属于本站上线必需项。用户要求 Google 登录时设为 `true`；初始化脚本会打印精确的 origins 与回调，并在缺少凭据时保留待办。
- `GOOGLE_AUTH_REQUIRED=true` 时，生产和预发的 `npm run doctor` 必须同时读到 `GOOGLE_CLIENT_ID` 与 `GOOGLE_CLIENT_SECRET`，否则阻止部署。默认 `false` 允许邮箱密码登录站点不启用 Google；Google 按钮在两项配置齐备前仍不可用。
- 若已提供 alias（如 `www`），还要从每个 alias 实际打开一次登录页；请求必须回到规范 `SITE_URL` 并使用相同的回调 URI。不能只凭控制台表单保存或 HTTP 200 判定登录成功。
- 生产验收至少核对登录按钮启用、授权请求中的 client ID 与获批客户端一致、redirect URI 与 Google Console 条目逐字符一致、回调成功返回本站。不要输出 state、nonce、cookie、授权码、token 或 Secret。

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

回调地址、端口和路径必须完全一致。Halloween 的 Auth.js 路径 `/api/auth/callback/google` 与本模板不同，需另外登记。同一运营方可在已批准的 Web 客户端登记多个站点，并保留已有条目；不要为了不同品牌的新同意屏幕擅自另建客户端。应用名称和同意屏幕属于 Google Cloud 项目级配置，共享客户端时修改会影响同项目内的其它站点，需先获得明确决定。

### 常见错误

| 错误 | 应检查的位置 |
| --- | --- |
| `origin_mismatch` 或提示 origin 不允许 | Google Identity Services 的 **Authorized JavaScript origins**；逐一核对实际打开登录页的 scheme、host 和 port。这里仅填 origin，不填路径。 |
| `redirect_uri_mismatch` | **Authorized redirect URIs** 是否逐字符匹配授权请求中的 `redirect_uri`，包括 scheme、host、port 和 `/api/auth/google/callback` 路径。 |
| 回到本站后出现 `oauth_state` | 登录是否在设置 cookie 后跨 apex / www 域名；从 `SITE_URL` 规范域名重新开始，并检查 state cookie 是否被浏览器接收。 |

缺少 JavaScript origin 或回调 URI 时，修正对应白名单即可；不要创建额外 OAuth 客户端或密钥来绕过配置错误。

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

Cloudflare 部署使用 `GOOGLE_CLIENT_ID` vars 与 `GOOGLE_CLIENT_SECRET` Worker Secret。更新任一项后确认生产部署进入 Ready；再从线上 `/api/me` 核对 auth 开启且返回的 Client ID 正确，登录页按钮启用，点击后授权请求的 `client_id` 与 `redirect_uri` 正确，完成回调后 `/api/me.user` 存在。只看到 Secret 名称、按钮启用或部署 Ready 均不足以证明登录成功。Infisical 是配置源，线上 Worker 不依赖本机 Infisical 或 Halloween VPS 在线。修改部署配置前核对目标站点。

模板不附带 Google 凭据。每次派生新站，需从自己的私有配置源提供凭据并登记本站回调；现有站点的回调应保留。

2026-10-24 已在内置浏览器完成实际验证：退出演示账户，点击 Google 登录，选择已有 Google 账号并继续授权，成功返回 `/zh/dashboard`。页面显示真实邮箱及该账户的 0 积分；刷新后仍保持登录。截图保存在本地忽略目录 `.tmp/google-auth/google-login-success.png`。此次验证不包含正式域名、One Tap 或真实邮件投递。

复用客户端时，Google 授权页仍会显示原项目的应用名称。独立品牌需要不同应用名称时，应先处理项目级品牌配置的共享影响；新建同项目客户端不会自动变更项目级应用名称。
