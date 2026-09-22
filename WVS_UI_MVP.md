# Weverse · v0.3.4 Community Interaction + Media Resolver

这一版以 v0.3.3 为稳定基线，重点补齐评论生态、AI 生成入口、用户自己的 WVS 使用闭环，以及统一媒体解析的第一版。

## 评论生态
- Artist / Official / Fan Post 都可进入同一套持久化评论树。
- AI 生成评论不再固定两条；数量由 WVS「社区活跃度」决定，并允许这一轮没有新评论。
- 粉丝评论默认明显以韩语为主，少量混入日语 / 英语 / 中文；每条 AI 内容都保存原文 + 简体中文译文。
- 评论支持「查看原文 / 查看翻译」，与正文使用同一种切换逻辑。
- AI 粉丝可以回复已有评论，也可以在同一批生成里互相接话。
- 艺人回复不是必出：先按活跃度做概率判断，再由角色模型根据人设和语境决定是否真的回复。
- user 可以发表评论 / 回复；后续再次生成评论时，AI fan 或 Artist 可以回复 user。
- 「再生成一批评论」只追加，不覆盖已有评论。
- 评论不提供编辑；删除有子回复的父评论时保留「此评论已删除」占位，避免整条讨论树断裂。
- Artist reply 会投影进 Float Weverse memory；删除该回复时同步清掉对应 projection。

## 我的 WVS
- 右上角「我的」新增：我的帖子 / 我的评论 / 收藏。
- WVS 粉丝资料继续默认继承 User Identity，也可以只在 WVS 内覆盖昵称、头像和简介。
- 帖子收藏、评论、个人资料和设置均保存在原有 Weverse state 中，刷新后不丢。

## AI 星星
- 顶部蓝绿色星星不再是 Ask 占位，而是 AI 生成入口。
- Community 内可：生成一轮混合社区动态 / 只生成 Artist Post / 只刷新粉丝内容 / 生成 Official 内容。
- Post 详情可直接「再生成一批评论」。
- 多 Community 时可以从全局菜单选择刷新哪个 Community，或依次刷新全部。

## 韩国社区语言规则
- AI Fan Post / 评论默认约 75%~90% 使用自然韩语。
- 少量内容可以自然出现日语、英语、简体中文或混合表达，不强行平均分配。
- Artist 仍以角色本人最自然的语言为准，不因为平台是韩国 App 就把所有角色写成同一种韩语口吻。
- Official AI 默认采用韩国 Weverse 官号语境，并同时保存中文翻译。

## 统一 Media Resolver v1
- Photos 不再为 Chat / 朋友圈 / WVS 分别维护图片来源策略；改成一个全局媒体策略：
  - 强制仅相册（测试匹配）
  - 强制仅生图（测试生成）
  - 智能混合（正常使用）
- 智能混合永远先查已有素材池；不是「食物=生图」。用户上传过的食物 / 风景 / 物品素材同样会先参与匹配。
- 自拍 / 人像 / 合照属于强相册优先；智能模式匹配不到时宁可不挂图，不偷偷生成一张人物图。
- 食物 / 风景 / 物品 / 宠物 / 官方视觉等，在素材池找不到时才允许进入生图。
- WVS Artist 继续以 characterId 使用角色素材池，并记录 `wvs` 公开使用历史。

## Official Media Pool
- WVS 官号仍然只是 WVS 的独立主体，不会伪装成 Character，也不会污染 Photos People。
- Community 自己只保存 `officialMediaPhotoIds`，引用 Photos 中已有的 photoId。
- Community 管理 →「管理官方媒体」可把 Photos 素材加入 / 移出当前官号媒体池。
- 手工 Official Post 可以直接从该媒体池选图。
- AI Official Post 也已接入：有发图意图时先匹配当前官号媒体池；匹配不到时再由统一 Media Resolver 根据全局策略决定是否生图。
- 已被当前官号公开用过的 photoId 会在下一次 AI 官号匹配时排除，避免把同一张旧图反复当新图发。

## Community / Feed 修正继续保持
- Community 图标、Hero 背景、Official 头像彼此独立；Community 图标未单设时只继承 Official 头像，绝不拿 Hero 背景兜底。
- Highlight = Official + Artist；Fan = user + AI fan；Artist = Artist only。
- 全局 My Feed 继续只显示 Artist / Official。
- 同一角色允许同时加入多个 Community，底层仍共享同一个 Character / Memory / Calendar / Photos。

## WVS 设置
- 默认显示：中文翻译 / 原文。
- 评论自动翻译开关。
- 社区活跃度：安静 / 普通 / 热闹。
- 粉丝语言规则固定为 KR MIX（韩语为主，少量日 / 英 / 中）。
- 预留通知偏好：艺人回复、粉丝回复、Artist 新帖、Official 公告、LIVE。

## 仍留待后续
- Schedule ↔ Calendar 的正式管理 UI 与冲突流程。
- 个人 LIVE / Official LIVE 真逻辑与回放。
- 通知页本体。
- Fan Post 直接从 Photos 选择素材的手工选择器。
