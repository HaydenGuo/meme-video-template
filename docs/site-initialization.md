# 梗视频站自动初始化

参考 GameWebs Stage 4 的资料配置、模板基线、素材准备和初始化报告流程，为 ShrimpReel 提供独立入口。它不执行 GameWebs 的游戏研究、Stage 3 或 JEV，也不把初始化成功等同于内容/线上验收通过。

## 每个站只准备一份资料

从 `site-profile.example.json` 复制一份 JSON。填写：

- `keyword`：梗名称；`slug`：英文站点标识。
- `overview.zh` / `overview.en`：梗的实际介绍。可把中文资料交给 AI 整理成这份文件；脚本不调用翻译或研究 API，不编造起源和热度。
- `media.sourceVideo`：至少达到最长档位的原片，默认裁出开头 5/12/15 秒。可用 `durations: [5,12,14]` 等三个递增整数配置实际长度；需要不同起点时先提供剪好的原片。
- `heroVideo`（可选）：首页首屏展示的 YouTube 目标/官方视频，例如 `{ "videoId": "OPf0YbXqDm0", "playlistId": "RDOPf0YbXqDm0", "startAt": 17 }`。只填视频 ID、可选歌单 ID 与起始秒数；页面使用 YouTube 隐私增强型嵌入。它只影响展示，生成仍使用 `media.sourceVideo`，两者不可混为一谈。
- `trendArticle`（可选）：可同时提供 `en`/`zh` 的 `title`、`description`、`intro` 和 `sections`，每种语言 4–10 个不同主题的小节，每节 1–5 段。填写后初始化会使用这份文章；未填写时只生成待补充的四节草稿。上线前根据可信来源补全梗的来源/形式/传播和复刻方式，不要只改写 `overview` 或编造日期与热度。
- `trendSources`（可选）：来源列表，例如 `{ "url": "https://example.org/article", "name": { "en": "Article title", "zh": "文章标题" } }`。只接受 HTTPS URL；来源会显示在趋势指南下方，并写入文章结构化数据。
- `aspectRatio`：默认画幅，`16:9` 或 `9:16`。固定分镜/原声工程配置见 [固定 Hypit 流程](fixed-hypit-workflow.md)。
- `media.exampleVideo`：已制作的 AI 示例视频，不会以原片冒充 AI 成片。
- `media.photo`：示例成片使用的照片。
- 可选 `media.brandIcon`：至少 512×512 的正方形 AI PNG；统一派生整站品牌图标，见 [品牌图标流程](brand-assets.md)。
- `media.credit`：来源署名；确认可用后设 `authorized=true`。
- 可选品牌、域名、端口、平台、客服邮箱和生成提示词 `prompt`。域名不填时使用 `<slug>.example.com` 并列为待办。
- 可选 `launch`：默认 `local`；`showcase`（仅展示）、`accounts`（仅账户）、`generate`（账户与生成，暂不充值）、`full`（完整）。线上阶段写入 production 与 HTTPS 地址，并选用 Hypit、Waffo、OpenAI 配置名称；不会自动创建这些服务的资源或凭据，必须通过 doctor 后才能上线。

三个素材路径都相对于资料 JSON 所在目录，也支持绝对路径。当前为人物照片参考视频模板；宠物、多人、非人物梗需要另外适配模型与上传规则。

## 公共服务只配置一次

复制 `services-profile.example.json` 到模板仓库以外的本机目录，用于多个站复用管理员邮箱、Bridge origin 和凭据的环境变量名称。**不在 JSON 写 Secret 正文**。

支持现有 `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` 或标准 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`。可由终端或 Infisical 向进程注入环境变量。每个站自动生成独立 SESSION_SECRET，不跨站共用会话和积分。

Google 凭据可复用，但需在 Google 控制台 OAuth Web 客户端登记新站的 **Authorized JavaScript origins** 和准确的 **Authorized redirect URI**。来源只填写 origin（如 `https://example.com`、`https://www.example.com`），回调必须与本站 `SITE_URL` 完全一致：`${SITE_URL}/api/auth/google/callback`。初始化不会修改 Google 控制台。凭据存在只表示已配置，不表示授权回调已通过。

## 安装后运行

使用 Node.js 24.14 或以上、npm 11.19 或以上，并在 PATH 安装 FFmpeg/ffprobe（也可设置 `FFMPEG_PATH`、`FFPROBE_PATH` 为可执行文件绝对路径）。

在**新复制且跟踪文件未修改的模板站目录**先按锁文件安装依赖：

```powershell
npm ci
npm run site:init -- --profile "D:\MemeMaterials\moon-hop\site.json" --services "D:\PrivateConfig\meme-services.json"
```

上述命令只读资料、核验素材存在性并预览计划，不生成文件。确认资料后：

```powershell
npm run site:init -- --profile "D:\MemeMaterials\moon-hop\site.json" --services "D:\PrivateConfig\meme-services.json" --apply --local
npm run dev
```

未使用公共服务配置时省略 `--services`。`--local` 应用本地 D1 迁移并将本次生成的三个源视频导入本地 R2；不带它则只生成文件。Vite 使用资料指定端口且禁止静默换端口，保证 OAuth 回调地址一致。

## 自动完成的内容

- 调用已有 `new-site.mjs` 设置品牌、slug、文章路径、资源名称、日期，清空旧站分析和验证标识；不再删除原有 staging 配置。
- 将梗介绍写入配置、首屏和趋势指南；如 profile 提供完整双语 `trendArticle`，按其写入；否则生成梗的可见形式、复刻方式、本站 AI 流程和发布前检查四节草稿。趋势指南上线前必须补充经来源核实的梗背景与传播原因，避免仅保留初始化草稿或改写同一段简介。通用 FAQ、法律和场景文案沿用模板，事实/翻译/SEO 仍需审阅。
- 转码原片和真实 AI 示例，生成视频封面、照片、1200×630 OG 图和通用播放图标；展示均引用 `public/site-init/` 的本次素材。三个创意场景暂复用同一真实示例，不伪造额外样片。
- 当 profile 提供 `heroVideo` 时，首屏用 YouTube 嵌入展示目标视频；本地裁切原片仍供生成流程使用，生成案例单独展示，不在每条案例视频上重复叠加“AI version”徽标。
- 生成 5/12/15 秒参考视频；固定每秒 1 积分，积分包 $9.90/25、$19.90/60 和 $29.90/100，关闭新订阅。
- 按 `launch` 设置功能开关、环境和 URL，同时写入管理员邮箱、Google 配置和 Bridge 站点 ID；私有密钥仅写入已被 Git 忽略的 `.dev.vars`。默认 `local` 使用 mock，不产生生成费用；线上阶段不使用 mock，尚缺的服务通过 doctor 检查。
- 输出 `bridge-site.json`，包含站点必需工作流和每档参考片 SHA-256。通过 Bridge 更新脚本 `--site-fragment bridge-site.json` 应用，脚本会在服务空闲时备份配置、合并单站点片段并健康检查；不再手工复制字段。上线验证需读回 VPS 中的工作流和哈希配置。
- 输出 `.site-initialized.json`：模板 commit、输入指纹、生成素材哈希、本地导入状态及待办；状态固定为待审阅，不宣称生产可用。

初始化后可用 `npm run site:mode -- generate` 在本地预览下一阶段，追加 `--apply` 修改本地功能开关，不会部署或覆盖凭据。该命令不替换环境和 URL；正式上线前另行设置 `APP_ENV` 与 HTTPS `SITE_URL`。详见 [环境配置](env.md)。

## 防止覆盖与失败恢复

`--apply` 拒绝已有私有配置、运行状态或跟踪文件修改的目录。同一输入已完成时不重复覆盖；修改资料后请在新模板副本初始化。重复调用不会重置账户、余额或会话密钥。

所有媒体和源码在 `.tmp/site-init/<随机目录>/` 准备完成后才写入。媒体错误不会改动当前配置，落盘失败会尝试回滚本轮文件；保留原模板素材，不批量删除用户文件。并发调用由 `.site-init.lock` 阻止；若进程被强制终止，确认没有初始化进程运行后再移除残留锁。

若 `--local` 在迁移或 R2 导入阶段失败，文件初始化状态保留且 `localSeeded=false`。修复本地服务后运行 `npm run seed:local` 补齐；它会导入目录中所有源片，包括未引用的原模板素材，随后人工更新导入记录。不要删除数据库或重新初始化来解决导入问题。

原模板的 `wrangler.staging.jsonc` 保留，但不是新站的预发配置。正式部署前必须重新配置或移除，不能直接部署它。

## 需要另外接通的服务

本地可以自动准备；线上还需要已授权账号及各站真实资源 ID：Cloudflare D1/KV/R2/Queue、正式域名、Google 回调、邮件域名、审核、Turnstile 和支付商品/webhook。初始化报告逐项列出。Bridge 真实模式、模型能力和预算需先确认，再切换 `VIDEO_PROVIDER=hypit`。这些不会因为复制模板或复用 Google 凭据而自动创建。

此入口不会发布网站、修改 DNS、创建支付商品、发送邮件或发起真实付费生成。实际登录、充值和生成仍需单独验证。
