# 真人照片、提示词扫描与上线边界

## 默认素材规则

只接受已获授权的成年人照片，同时取得照片版权和当事人肖像使用许可。禁止明星、网红、政治人物及其他公众人物照片，禁止未经授权或侵犯版权的照片与受保护角色。已有合法授权的普通照片并非一律禁止。禁止虚构代言、冒充身份及把合成动作当作真实影像。

上传勾选声明、通用提示词和 AUP 同时说明这些限制。声明和模型提示词不能证明授权，也不能可靠识别照片中的人物；当前图片审核仍不提供公众人物身份识别或版权权属判定。

## Worker：扣积分前检查

`PROMPT_SCAN_PROVIDER=waffo` 使用服务端 `WAFFO_MERCHANT_ID`、`WAFFO_PRIVATE_KEY` 对 `POST /v1/actions/verification/scan-prompt` 签名。它与充值渠道开关独立，关闭购买不代表可以跳过扫描。私钥支持 PKCS#8、PKCS#1 PEM 和无头尾的 Base64 DER；API Key 按其注册环境认证，不传 `X-Environment`。

扫描固定生成意图、用户背景描述及照片限制合成的文本，`semantic=enforce`。YIR 使用当前配置的实际提示词；Hypit 的 Worker 预检只涵盖网站请求意图，完整模板由 Bridge 再次检查。fal 的接口不接受文本提示词，因此只有意图预检，不能声称它把限制文本传给了模型。

- `allow` 且语义状态为 `scored` 才继续创建任务及扣积分。
- `review`、`block` 均返回 422，不创建任务、不扣积分。`review` 暂停本次请求，用户稍后重试或联系客服；不承诺已经创建人工审核工单或自动恢复任务。
- 429 返回 `Retry-After`；客户端须按该时长等待再重试。
- 网络、超时、异常状态、非法响应或语义评分降级均不放行。
- 不在同步请求内循环重试。按官方建议，4xx 修正后再提交；5xx 的调用方重试应从 5 秒起指数退避，最多 3 次。不得通过重写或改用其他模型绕过拒绝。

允许的判定摘要（requestId、action、原因、语义状态及提示词哈希）写入任务元数据；所有已返回的有效判定记入服务端日志。不把原始提示词、私钥、签名或远端错误正文写进扫描日志。日志访问及保留需在各站上线时配置。

## 模型提交前再次检查

YIR 在队列实际提交前扫描当前完整提示词，防止排队期间配置改变。Hypit Bridge 在 `prepare` 阶段将固定模板、背景描述和共同素材限制合并，扫描通过后才编译和提交生成模型。Bridge 的 `.env` 也必须注入 Waffo 商户 ID 和私钥；不要放入公开模板 JSON。

Bridge 保存 `prompt-review.json` 判定摘要，不新增提示词原文记录。非 allow 或接口异常会阻止模型提交，本次准备失败；Worker 轮询到失败后沿用既有幂等退款流程退回积分。队列阶段已经扣过的积分与前端预检未扣费是不同情形。

`PROMPT_SCAN_PROVIDER=mock` 仅供本地开发，正式及 staging 禁止；真实 Hypit Bridge 没有绕过扫描的开关。展示站、停止生成的站点不需要为未运行的扫描填写密钥；开放生成前 doctor 要求具备凭据。

## 已知缺口

2026-10-25 实测：普通风景、虚构角色、已授权本人跳舞均 allow；欺骗性明星代言也被 allow，属于漏判；明确成人色情对照为 review。不能用扫描通过来宣称整体内容安全或业务准入通过。

模板尚未实现公众人物识别、版权数据库比对、交付前成片内容审核、自动人工复核及通知工作台。这些应作为各站实际上线前的独立工作，不以修改文案代替。被拒绝或不确定的素材不得交付；成片审核未接通时应保持人工复核或相应功能未开放。

真人照片生成动作是否属于支付商禁止的 Deepfake，仍需 Waffo 对具体流程书面确认。即使照片已获授权、提示词 allow、结果标注 AI，也不代表收款获批。

## 所有权验证与政策 URL

Waffo 给出专属 token 后，在 DNS TXT、首页 meta 或 well-known 文件中任选其支持的方式部署，并查验公网读回；不要生成假 token。用户的商户 ID、店铺 ID、验证 token 和私钥不属于通用模板内容。

各站可提交 `/terms-of-service`、`/privacy-policy`、`/refund-policy`、`/acceptable-use-policy` 和 `/report`。填写真实经营者法律全名、经营地区、实际模型、处理方、客服邮箱及数据保留期限；保持充值价格、退款与实际行为一致。模板政策的预览状态描述需在功能真正开放时修改。

官方参考：

- https://docs.waffo.ai/zh/api-reference/endpoints/content-safety/scan-prompt
- https://docs.waffo.ai/zh/mor/account-reviews/aigc-compliance
- https://docs.waffo.ai/zh/compliance/tos
- https://docs.waffo.ai/zh/mor/account-reviews/privacy-policy
