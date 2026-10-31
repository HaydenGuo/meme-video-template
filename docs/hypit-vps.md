# 梗视频生成共用 VPS

## 默认执行方式

模板 VPS 默认由 Bridge 直接调用 NoToken 的异步视频生成 API，不启动 Hypit Runtime。Bridge 保留旧 Worker 使用的 `mode=hypit` HTTP 协议字段；真实执行方式以健康接口返回的 `engine=notoken` 为准。旧站点无需因协议字段立即一起迁移。

`scripts/deploy-hypit-vps.py --revision <完整提交 SHA>` 默认安装 `notoken` 引擎；仅需兼容旧 Hypit 工程时才传 `--engine hypit`。脚本适用于 Debian 专用 VPS，以 root 执行，会安装系统包、配置 Node.js、FFmpeg、systemd 和日志限制。它不创建云资源、不改 DNS/防火墙，也不会调用模型。切换已有 VPS 的执行器前，脚本检查 Bridge 队列必须为空，并保留已登记站点及其他配置。

## 并发与资源边界

| 配置 | 默认值 |
| --- | ---: |
| 异步模型任务 | 最多 8 个 |
| 等待队列 | 最多 100 个 |
| VPS 上 FFmpeg/FFprobe 同时处理 | 最多 2 个 |
| 任务最长时间 | 35 分钟 |
| Bridge 成品目录 | 2GB 上限；结果保留 24 小时 |
| Bridge 服务 | 1.5 CPU 配额、1GB 内存上限 |

模型生成主要在 NoToken 服务端异步运行，Bridge 通过轮询管理任务；VPS 本地只下载/上传素材、准备媒体、抽取参考音轨并与结果合成。8 是这台 2 vCPU VPS 的保守起始上限，受账户/API 限流和带宽影响，可在 Bridge 配置中调整。增加模型并发不会增加 VPS CPU；FFmpeg 并发单独受限。该数值不代表模型账户保证接受 8 个请求。

## 目录与秘密

- `/opt/meme-video/releases/<sha>`：固定 GitHub 版本。
- `/opt/meme-video/current`：当前运行源码。
- `/var/lib/hypit/project`：Bridge 数据与队列；直接模式不依赖 Hypit npm 工程。
- `/etc/hypit-bridge/bridge.config.json`：站点、模板和并发设置。
- `/etc/hypit-bridge/bridge.env`：Bridge 访问/签名令牌。
- `/etc/hypit-bridge/provider.env`：服务商凭据环境变量。
- `/var/lib/hypit/deployment.json`：实际版本与待办。

直接模式在 VPS 私有的 `provider.env` 中配置 `NOTOKEN_API_KEY`。可选配置 `NOTOKEN_BASE_URL` 和 `NOTOKEN_VIDEO_MODEL`。凭据不进入 Git、Cloudflare 浏览器代码或日志。只有站点和模板已登记、API 凭据有效，且账户额度/限流允许时，才可真实生成。

## 复刻任务的音视频处理

Bridge 验证原视频哈希、时长、音视频轨道及人物图片，再从参考视频提取 WAV 音轨，并制作无声动作参考视频。NoToken 收到人物参考图、静音动作视频和模板固定提示词。生成完成后，Bridge 将输出画面与原参考音轨合成，检查成品画幅、时长及音视频轨道。任一素材校验或合成失败均停止交付；模型任务不因本地合成失败而盲目重复提交。

`/health` 中 `mode=hypit` 仅代表兼容旧 Worker 的协议；`engine=notoken` 才说明直接调用路径已启用。健康检查成功不代表 API Key、账号额度、第三方并发配额或真实生成已经验收。部署后应先确认空队列、健康接口的 engine 和 API 凭据变量存在；是否进行实际付费生成需单独确认。

## 站点配置与域名

每个梗站独立登记 `siteId`、模板、固定提示词、媒体 origin、参考视频哈希及工作流。通过 `scripts/update-hypit-bridge.py --site-fragment <bridge-site.json>` 合并站点片段，必须保留 VPS 上其他站点。不要仅凭 `/health` 推断站点模板已配置。

现有 VPS 从 Hypit 切到直接模式时，先确认 `NOTOKEN_API_KEY` 已配置且 Bridge 队列为空，再执行更新脚本。它会停用 Hypit Runtime、切换 `engine=notoken`、设置 8/100/2 并核对健康接口；失败时回滚代码、配置和 systemd 依赖：

```text
python3 scripts/update-hypit-bridge.py --revision <完整提交 SHA> --engine notoken --max-active 8 --max-queued 100 --ffmpeg-concurrency 2
```

若只更新代码而不切换执行器，省略 `--engine`。源码更新和执行器切换均先要求任务队列为空，不会发起模型生成。新建 VPS 使用 `deploy-hypit-vps.py`；它拒绝覆盖已有 Bridge 安装。

使用公网服务前配置 HTTPS 域名并将反向代理指向 loopback Bridge；不要直接开放公网 8788。
