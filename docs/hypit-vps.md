# 模板站共用 Hypit VPS

## 一次部署、多个站复用

`scripts/deploy-hypit-vps.py --revision <完整提交 SHA>` 面向 Debian VPS，以 root 执行。从 GitHub 拉取准确源码版本，安装经 SHA256 校验的 Node.js 24.14.0、FFmpeg 和固定版本 Hypit。它不创建云资源、不改 DNS/防火墙，不发送生成请求。

适用新建专用 VPS。不要直接用于已有其他业务的主机：它会安装系统包、配置 Node 路径和专用 systemd 服务，并限制本机 journal 日志容量。升级前备份持久数据，脚本保留已有密钥和配置。

## 可以提前设置的公共部分

| 部分 | 预设 |
| --- | --- |
| 运行环境 | Node.js、FFmpeg、Hypit CLI、Seedance 模型定义 |
| 进程 | `hypit-runtime` 和 `hypit-bridge`，开机启动、失败重启 |
| 资源 | Hypit 2GB 内存上限、Bridge 1GB 上限，各 CPU 配额 150% |
| 模型并发 | Bridge 同时 1 个任务，排队最多 20 个 |
| 超时清理 | 任务 35 分钟上限、Bridge 文件保留 24 小时、Bridge 存储 2GB 上限 |
| 安全 | 专用非登录用户、loopback 监听、独立随机令牌及下载签名密钥、受限文件权限 |
| 日志 | systemd journal，本机最大 128MB、保留 7 天 |
| 更新 | 以 commit 分目录部署，`current` 指向当前版本，持久配置/数据分离 |

Bridge 的 2GB 限额不等于整个 Hypit 项目/磁盘配额；开启真实生成后还需监控 `.hypit` 运行数据、模型缓存及全盘使用量。CPU/内存上限防止单个进程无限占用，不保证高流量吞吐量。

## 服务路径

- `/opt/meme-video/releases/<sha>`：GitHub 版本。
- `/opt/meme-video/current`：当前运行源码。
- `/var/lib/hypit/project`：Hypit npm 项目、锁文件、Build 数据。
- `/etc/hypit-bridge/bridge.config.json`：Bridge 配置。
- `/etc/hypit-bridge/hypit.runtime.json`：模型服务路由。
- `/etc/hypit-bridge/bridge.env`：Bridge 访问/签名令牌，不向网页公开。
- `/etc/hypit-bridge/provider.env`：模型服务商凭据环境变量。
- `/var/lib/hypit/deployment.json`：实际部署版本与待办。

首次部署 `sites={}`，没有任何获准提交任务的站点。Runtime 只连接本地媒体处理，没有自动选择付费模型账号。`/health` 返回成功仅表示 Bridge 服务正常，不代表模型 API、账户余额或真实生成可用。

## 你需要提供的 API 信息

1. 模型服务商名称和 API 地址（如 HypiHub，或已有服务商）；必须支持“图片人物参考 + 视频动作参考”。Google OAuth 凭据不是视频模型 API。
2. 支持的模型名称、5/12/15 秒和 9:16/16:9 能力，以及定价/用量限制。
3. 通过私有渠道配置的 API Key 或授权凭据，不粘贴到公开仓库。
4. 允许的生成费用范围；部署授权本身不等于无限制付费生成授权。

API Key 只有在兼容的 Hypit Provider 中才能使用，不能把任意服务商 Key 填进同一个配置字段。选定服务商后再安装相应 Provider、写入 CredentialRef 和绑定；首次真实生成单独确认费用。

## 每个梗站的专属部分

梗介绍、原视频、AI 示例及照片；独立 `siteId`、模板/提示词及允许的媒体 origin；网站自己的数据库、积分/支付商品、Google 回调、邮件及审核配置。`site:init` 会生成待合并的 `bridge-site.json`。

HTTPS 域名可以稍后确定。在域名和 TLS 配好前，仅在 VPS 内部或 IAP 转发访问 Bridge，暂不开放公网 8788。不要把内网健康检查通过说成 Cloudflare 已接通。
