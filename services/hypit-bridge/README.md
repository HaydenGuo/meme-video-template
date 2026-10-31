# 自托管视频生成 Bridge

Bridge 为网站 Worker 提供统一的异步任务协议。生产默认使用 `engine=notoken`，在 VPS 直接调用 NoToken 视频 API，不启动 Hypit Runtime；仍保留旧版 Worker 需要的 `mode=hypit` 协议字段。健康接口分别返回 `mode` 与实际 `engine`，不能把这两个值混为一谈。

## 本地启动

要求 Node.js 24.14 或以上；Bridge 本身只使用 Node 内置模块，无需安装 npm 依赖。

```powershell
Copy-Item bridge.config.example.json bridge.config.json
Copy-Item .env.example .env
```

在私有 `.env` 中分别填写随机的 `BRIDGE_TOKEN` 和 `BRIDGE_OUTPUT_SECRET`（均至少 32 字符，且使用不同值）。前者与站点的 `HYPIT_BRIDGE_TOKEN` 相同，后者仅供 Bridge 签名成品下载 URL。

示例 `mode=mock` 只允许 loopback 访问，不调用模型；输出沿用源视频，不能用于判断真实生成效果或画幅。生产站点的媒体 origin、`siteId` 和 `templateId` 必须一致，详见 [站点接入说明](../../docs/hypit.md)。

## NoToken 直接生成

在 VPS 私有的 `provider.env` 配置 `NOTOKEN_API_KEY`，可选配置 `NOTOKEN_BASE_URL`、`NOTOKEN_VIDEO_MODEL`。模板固定提示词、人物参考图、动作参考视频、时长、比例和分辨率构成 API 请求；服务不调用 Hypit，也不自行做提示词分析。

Bridge 下载白名单媒体，验证参考片 SHA-256、时长及音视频轨道后，抽取原片 48 kHz PCM WAV 音轨并生成 H.264 无声动作参考视频。只有无声视频交给模型，原 WAV 在生成完成后与新画面合成。成品检查包含尺寸、时长及音视频轨道；失败时不交付，也不会自动重新提交模型任务。

VPS 默认最多同时维护 8 个异步模型任务，队列最多 100 项；本地 FFmpeg/FFprobe 同时最多 2 项。模型并发可在 `bridge.config.json` 的 `maxActive` 调整，媒体处理由 `ffmpegConcurrency` 限制。服务商账户限流仍可能拒绝请求，VPS 队列容量不等于服务商接受额度。

## Hypit 兼容模式

如必须运行已有 Hypit 工程，可部署时显式选择 `--engine hypit`。该模式需要另行安装 Hypit Runtime、配置模型凭据和对应工程；任务并发默认为 1。不要因为 `mode=hypit` 字段而误判成 Hypit Runtime 正在执行。

## 更新已有 VPS

使用 `scripts/update-hypit-bridge.py --revision <完整提交 SHA>` 更新 Bridge。脚本停止接收新任务、检查任务队列为空、验证 Node 源码语法、备份配置并检查鉴权健康接口；失败时恢复旧代码和配置，不发起模型调用。站点片段使用 `--site-fragment <bridge-site.json>` 原子合并并检查本站登记；不得覆盖其他站点。

运行 `scripts/deploy-hypit-vps.py` 仅用于新建专用 VPS；它默认 NoToken，并拒绝覆盖已有 Bridge 安装。首次真实付费生成前应独立核实 API 凭据、账户额度和服务商并发策略。

## 存储与本地媒体资源

Bridge 任务文件位于配置的 `dataDir`，代码和持久配置分离。Bridge 成品目录大小有限额，结果会过期清理；还需监控全盘磁盘空间与网络流量。FFmpeg 使用有限线程，本地媒体处理并发与远程模型任务并发分别配置。

提交 NoToken 任务前先完成两份媒体上传；只有即将调用创建任务接口时才进入 `submitting`。上传阶段错误会单独标记并走网站退款路径。若创建回执不确定，Bridge 保留 `attention` 并禁止盲目重提，站点会提示用户且暂停自动超时退款，直到核实结果。已获得的 NoToken 任务号会同步写入站点任务元数据，便于排查。
