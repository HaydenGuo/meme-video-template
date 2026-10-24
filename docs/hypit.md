# 自托管 Hypit 接入

制作区可选竖版 9:16 或横版 16:9。站点将 `aspectRatio` 保存到任务元数据并传给 Bridge，Bridge 校验后写入 Seedance 的 `aspect-ratio`；未传时兼容旧模板配置。修改 Bridge 代码后需重启服务。mock/passthrough 不改变源视频尺寸；真实模型的比例支持仍需实际生成验证。

`VIDEO_PROVIDER=hypit` 会复用现有生成队列、积分扣除/失败退款和 R2 成品保存路径，通过自用 Bridge 异步执行 Hypit Build。

## 本地

Bridge 源码随模板提供，位于 [services/hypit-bridge](../services/hypit-bridge/README.md)。可独立复制到 VPS 运行；Hypit 本身另行安装。先使用 mock 模式；本地 Vite/Worker 能访问 Bridge 时直接使用 loopback，无需预先开启隧道。

1. Bridge 配置站点 `shrimpreel`、模板 `reference-video`，媒体 origin 必须与当前 `SITE_URL` 一致，例如 `http://127.0.0.1:3000`。
2. `wrangler.jsonc` 中设置 `VIDEO_PROVIDER=hypit`、`HYPIT_BRIDGE_URL=http://127.0.0.1:8788`、`HYPIT_SITE_ID=shrimpreel`。
3. `.dev.vars` 写入 `HYPIT_BRIDGE_TOKEN`（与 Bridge 相同，至少 32 字符）。不要将令牌写入 `site.ts` 或页面代码。
4. `site.video.hypit.templateId` 对应 Bridge 的模板；`costCentsPerSecond` 为后台成本估算，默认 0 表示尚未填写，不能据此判断真实毛利。

当前站点时长为 5、12、15 秒，Bridge 的模板 `durations` 应同步设为 `[5, 12, 15]`。对应源视频在 `seed/templates`；修改后运行 `npm run seed:local`，并重启 Bridge 加载配置。最长 15 秒，每秒扣 1 积分。

## 上线前

正式/预发必须使用 HTTPS Bridge origin 和真实 `mode=hypit`；不能带 URL 凭据、路径或查询参数。先明确 Provider 的参考视频能力、时长限制和预算，再验证一次真实生成。当前本地自动检查不代表真实 Provider 已接受或计费正常。

多站共用 Bridge 的 `maxActive`（初始为 1）限制生成并发，站点 Queue 的 `max_concurrency=2` 限制 HTTP 消费调用。排队满返回 429；任务执行在 Bridge 中独立推进，HTTP 提交立即返回，不占住 Worker 等待视频生成。仍遵守网站原有 45 分钟生成超时，流量过大时需要控制准入并监控积压。

Bridge 成品下载只允许同一 Bridge 的签名路径；网站流式写入 R2 后，用户仍从网站获取成片。Bridge 的令牌、Hypit 凭据、原始错误正文均不返回浏览器。网站后台视频服务检查只检查 Bridge 健康和模式，不调用模型。

新增热词时，配置对应 Bridge 模板、允许的站点 origin 和 `site.video.hypit.templateId`，然后按模板原有流程创建站点仓库。Hypit 核心代码无需 fork。
