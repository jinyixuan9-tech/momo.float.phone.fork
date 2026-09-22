# Weverse · v0.3.3 AI Community Core

这一版基于 v0.3.2，把 WVS 从“可编辑 UI 壳”继续推进到可实际生成内容、读写 Photos 与 Float Memory 的阶段。

## Community / UI 修正
- Community 图标、Community 顶部背景、Official 官号头像彻底分工。
- Community 图标未单独设置时，仅继承 Official 头像；不再拿背景图冒充图标。
- 隐藏浏览器原生 file input，上传入口只保留自定义按钮。
- Community Feed：Highlight = Official + Artist；Fan = user + AI fan；Artist = 仅 Artist。
- Feed 首页继续只显示 Artist / Official。

## AI Community
- Community 右上角管理菜单新增「生成一轮 AI 社区动态」。
- 每轮优先选择该 Community 里发帖较少的成员生成 1 条 Artist Post，再生成少量 AI Fan Post / Fan Comment。
- Artist Post 通过 Float 原有 Prompt / 人设 / 世界书 / 核心记忆 / 长期记忆 / 近期事件 / Calendar 生成。
- 明确约束公开平台语境：不得把只存在于私人关系或私聊里的秘密直接公开。
- 所有 AI 内容仍可通过 `•••` 人工编辑或删除。

## Photos
- Artist Post 有自然发图意图时调用现有 Photos Resolver，channel = `wvs`。
- WVS 暂时沿用朋友圈的公开发图来源策略。
- 相册命中后保存 `asset://` 引用和 photoLibraryId，不复制整张图片到 WVS 数据。
- 同一角色已在 WVS 用过的照片默认排除再次作为新图发布；已公开照片也不会再被聊天当“新照片”主动私发。

## 翻译
- AI Artist Post 保存 original + 简体中文译文。
- WVS 默认显示中文，存在不同原文时可点击「查看原文 / 查看翻译」切换。
- user / Official 手工输入内容不强制翻译。

## Memory
- 新增 Weverse 原生 projection source。
- Artist Post 会写入角色的近期 Weverse 事件流，并参与 Float 原生短期上下文与长期总结。
- 编辑 Artist Post 会同步更新 projection；删除帖子或 Community 会清理对应 projection，避免“幽灵记忆”。
- 普通 AI Fan Post / 评论不会灌进角色长期记忆。
- 记忆来源设置新增「Weverse」开关。

## User WVS 身份
- 右上角「我的」抽屉接入真正可编辑的 WVS 粉丝资料：昵称、头像、简介。
- 默认继承当前 User Identity；WVS 内可单独覆盖，不修改全手机 User Identity。
- 可一键恢复继承 User Identity。

## 仍留待后续
- Artist 主动翻牌 / 回复 user 的概率逻辑。
- Official AI 自动运营。
- Schedule ↔ Calendar 真联动。
- 个人 LIVE / Official LIVE 真逻辑与回放。
- WVS 独立图片来源策略开关；本版先继承朋友圈公开发图策略。
