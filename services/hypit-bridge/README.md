# 自托管 Hypit Bridge

模板附带独立 Bridge 源码，用于站点 Worker 调用 VPS 上的 Hypit。需要 Node.js 24.14 或以上；Bridge 本身只使用 Node 内置模块，无需安装 npm 依赖。

## 本地启动

在本目录运行：

```powershell
Copy-Item bridge.config.example.json bridge.config.json
Copy-Item .env.example .env
```

在私有 `.env` 中分别填写随机的 `BRIDGE_TOKEN` 和 `BRIDGE_OUTPUT_SECRET`（均至少 32 字符，建议各用独立的 32 字节随机值）。前者与站点的 `HYPIT_BRIDGE_TOKEN` 相同，后者仅供 Bridge 签名成品下载 URL。

```powershell
npm start
```

示例为 `mode=mock`，只允许 loopback 访问，不调用模型；输出沿用源视频，不能用于判断真实生成效果或横竖比例。站点和 Bridge 的媒体 origin、`siteId`、`templateId` 必须一致，详见 [站点接入说明](../../docs/hypit.md)。

## VPS 真实生成

另行安装 Hypit 并配置其运行时和模型凭据；Hypit 不包含在这个模板中。将 `projectRoot` 和 `runtimeProfile` 指向已安装的 Hypit 项目，`dataDir` 必须位于该项目内。核验 Bridge 与所安装 Hypit CLI 的兼容性。

将初始化生成的 `bridge-site.json` 合并到 `bridge.config.json` 的 `sites` 属性，保留已有站点。生产媒体白名单只填写本站 HTTPS origin。设置公网 HTTPS `publicUrl`，反向代理至 loopback 服务；配置访问限流，确认模型能力和费用后才切换 `mode=hypit`。

初始 `maxActive=1`、`maxQueued=20`，限制模型并发与排队；配置同时限制任务时间、媒体大小和磁盘用量。不要将数据目录或 Hypit 凭据提交到 Git。模式切换前处理已有任务；代码及配置更新后重启服务。

当前只声明源码已集成，不声明 VPS 部署、第三方模型或付费生成已验收。

## 本地合成资源

VPS 初始化运行 `configure-render-limits.py`：媒体 Endpoint 并发为 1，HTML 固定一个浏览器，通过 `ffmpeg-bounded.py` 将 FFmpeg 自动 CPU 探测限制为 2、滤镜线程限制为 1。Runtime 的 `TasksMax=512` 为 Chrome、Node 和 FFmpeg 的线程留出名额，CPU、内存及模型并发上限保持不变。既有 VPS 更新时，先确认没有活动 Build，再以 root 执行该脚本、`systemctl daemon-reload` 并重启 `hypit-runtime`。首次配置备份保存在私有配置目录中。

如果只在最终合成失败，不要重新提交原始生成 Run。新建 Run，用 `build-record` 和 `satisfy` 复用失败 Build 的 `generated.video`，目标仍为 `final.video`；先检查 `hypit plan` 的 `providerRequestCount=0`、`unresolvedRequestCount=0`，然后只重跑本地合成。已退款的站点记录不因此重新扣费。
