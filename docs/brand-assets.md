# 同源 AI 品牌图标

参照游戏站的品牌资源流程：先用 AI 生成一张正方形 PNG，至少 512×512；使用与热梗相关的清晰单一图形，检查 16px/32px 下仍可识别，不以字母色块代替品牌图。

新站资料可提供 `media.brandIcon`，初始化自动生成全部尺寸并写入 `site.branding`。不提供时保留模板回退图标，不能宣称该回退图标是 AI 生成的。

现有站替换源图时运行：

```powershell
node scripts/generate-brand-assets.mjs --source <AI源图.png> --brand "站点名称"
```

将命令返回的 branding 配置写入 `src/config/site.ts`。`public/brand/source.png` 为唯一源图；脚本从归一化 512px 图派生 16/32/48/96/180/192px PNG 和多尺寸 ICO，同时输出 Web Manifest 和哈希记录。导航 Logo、favicon、Apple 图标、Manifest 及组织/文章结构化数据均引用这套资源。

生成后查看小尺寸，并确认本地首页的 icon 链接及图片可读取。页面不再声明旧 SVG；保留旧文件以免已缓存地址失效。

Google 搜索使用首页声明的稳定 96px PNG/ICO 地址；正式域名的首页及图标需要可抓取。上线后等待 Google 重新抓取，不保证立即展示。参见 [Google 官方 favicon 说明](https://developers.google.com/search/docs/appearance/favicon-in-search)。
