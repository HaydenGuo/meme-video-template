# Video Bridge 与执行引擎

站点继续使用 `VIDEO_PROVIDER=hypit` 调用现有 Hypit Bridge 协议，以兼容已部署的 Worker。这个变量表示 Bridge 协议，不表示 Hypit Runtime 正在执行任务。

生产默认由 Bridge 直接调用 NoToken 异步视频 API。健康接口中的 `mode=hypit` 表示兼容协议，`engine=notoken` 才表示实际执行器。Hypit Runtime 仅在运维者显式选择 `engine=hypit`（例如更新命令传入 `--engine hypit`）时启用；这条回退路径需要另行安装 Runtime 和配置对应工程。

## 本地开发

Bridge 源码和配置示例位于 [services/hypit-bridge](../services/hypit-bridge/README.md)。本地可用 `mode=mock` 和 loopback 地址验证 Worker 协议；mock 不调用模型，也不能代表真实生成效果。站点仍需配置 `HYPIT_BRIDGE_URL`、`HYPIT_SITE_ID` 和服务端 `HYPIT_BRIDGE_TOKEN`，不要把令牌写进页面代码。

## 生产配置

VPS 私有的 `provider.env` 配置 `NOTOKEN_API_KEY`，可选配置 `NOTOKEN_BASE_URL` 与 `NOTOKEN_VIDEO_MODEL`。新建和更新 Bridge 默认使用 NoToken；只有明确需要兼容 Hypit Runtime 工程时才选择 `--engine hypit`。Bridge 默认限制为 8 个远程任务、100 个等待任务、2 个本地 FFmpeg/FFprobe 操作；并发可配置，服务商账户限流仍会限制实际接受量。

本站点时长、参考素材和固定提示词见 [固定参考视频复刻流程](fixed-hypit-workflow.md)。VPS 配置、引擎检查和回滚步骤见 [共用 VPS 运维](hypit-vps.md)。健康检查不调用模型；真实生成还需单独确认站点模板、凭据、额度和服务商能力。
