---
name: new-hot-site
description: 从 meme-video-template 初始化或更新梗视频站，核实素材角色、补齐有来源的中英文趋势介绍、校准价格与服务开关并完成本地检查。用户说“上新词”“建新站”“用模板做一个 XX 站”时使用。
---

# 新建梗视频站

## 开始前

1. 先读当前仓库 `AGENTS.md` 和 `docs/site-initialization.md`，确认这是模板的新副本、目标目录与当前模板 SHA。
2. 检查 `git status`、远端和已有初始化状态。不要在用户修改过的目录里运行会覆盖文件的初始化；不要 reset、删除私有运行状态或复制别站资源 ID、密钥、账户数据。
3. 使用 `site-profile.example.json` 与 `services-profile.example.json` 的当前字段，不沿用旧 `new-site.mjs` 流程。`site:init` 先预览，审阅输出后再 `--apply`；仅在本机验证确有需要时添加 `--local`。
4. 秘密不写进 profile、代码、聊天或 Git。公共服务 profile 只存环境变量名，不存密钥值。

## 资料和页面内容

- 先核实梗的来源、原视频、标志动作、传播时间线和参与方式。当前或可变事实必须查可靠来源；在 `site.ts` 文章条目保存可打开的来源 URL。来源不足时标为未知或不写，不编造日期、播放量、爆红原因或人物信息。
- 初始化生成的趋势指南是草稿。补成可独立阅读的文章：梗的定义/来源、视频形式和笑点、传播机制或不同版本、AI 复刻如何工作、制作限制与分享注意事项。每部分提供具体信息，避免同一简介改写成多段；中英文事实一致。没有可靠证据支持的历史叙述应省略。
- 用户提供的 YouTube MV/目标片段可在 `heroVideo` 配视频 ID、歌单 ID、起始秒数，作为首屏观看参考；它只负责展示。
- `media.sourceVideo` 是 Hypit/Bridge 实际使用的生成参考，仍需按最长时长制作裁片；不要把 `heroVideo` 与生成源片混为一谈。
- `media.exampleVideo` 和对应 `media.photo` 是实际生成结果与输入照片，配对后放入案例区。没有真实成片时如实标为缺失，不把目标 MV 或源片称为本站 AI 成果。
- 只在需要且有明确含义时加视频徽标；不要在每个案例上重复“AI version”“user-supplied”这类标签。素材署名与授权信息放在合适的 caption/credit，不用误导性叠层代替。
- 修改英文、中文时同步更新标题、描述、正文和 article `updatedAt`；首屏可简短，趋势指南承担完整解释。

## 价格和登录

- `packages` 的积分数与价格按用户确认配置。只要有可售产品定义，就显示包数和价格；`PAYMENTS_ENABLED=false` 时保留价格信息、禁用充值按钮，并明确说明购买尚未开放。关闭充值不能清空或隐藏价格，也不能影响已有余额生成。
- Google OAuth Web 客户端分别配置每个实际登录 origin 的 Authorized JavaScript origins（只填协议、主机和必要端口，不带路径）与准确的 Authorized redirect URI：`${SITE_URL}/api/auth/google/callback`。
- `origin_mismatch` 检查 JavaScript origins；`redirect_uri_mismatch` 对比完整回调 URI；回调 `oauth_state` 失败时检查 apex/www 是否在设 state cookie 前规范到主域。验证 One Tap/登录页、apex 与 www 入口和 callback token exchange URI。不要为绕过配置错误另建 OAuth 客户端或客户端密钥。

## 素材和初始化

- profile 中 `media.authorized` 必须由用户确认后才设为 true。原片用于生成模板，AI 示例必须有对应照片和授权署名。
- 有目标 YouTube 视频时，写入 `heroVideo`；视频 ID 为 11 位，`startAt` 使用整数秒数。使用隐私增强型嵌入。没有时保留本地原片播放器。
- 按 `docs/site-initialization.md` 执行预览、审阅、应用和本地导入。初始化状态是待审阅，不等于上线验收；不在用户未授权时配置云资源、支付商品、真实付费生成、推送或部署。

## 检查与交付

- 检查首屏目标视频、案例身份、案例播放、两种语言、价格包与禁用状态、移动版排版、文章来源、账户/生成/支付开关和法律文案。
- 按仓库 `AGENTS.md` 与初始化文档运行适用的 typecheck、单元测试、build、SEO 检查和 doctor。不要为了通过 E2E 改生产定价、支付开关或真实资源。
- 汇报模板 SHA、profile 关键字段、真实素材对应关系、检查命令结果、未完成的事实来源/授权/生产资源。明确区分页面可用、Google 登录、生成任务、充值和 SEO 验收。
- 推送、合并、部署需要明确授权；本站的发布授权不自动覆盖模板主分支或其它站点。
