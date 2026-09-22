# Weverse UI Shell · v0.3.0

本版把已确认的 Weverse UI 原型写进主源码，先用于真机/Netlify 上确认视觉和导航，不在这一版一次性塞完 AI 业务逻辑。

## 已写入

- 桌面新增 `Weverse` 原生 App 图标；旧桌面布局启动后也会自动补回该默认图标。
- 主导航精简为 `Feed / + / Community` 三栏悬浮 Dock。
- 移除原版 Weverse 里本项目暂不需要的底栏 Shop / DM / More。
- My Feed UI：Artist / Official / Fan 三种帖子表现、低调原文/翻译切换、成员回复粉丝展示。
- Community 列表与 Community 首页。
- Community 内 Official Account、成员头像列、Home / Artist / Fan 子页签。
- 成员主页：帖子 / 评论 / LIVE 的视觉骨架。
- user 发布 Sheet：当前可在会话内发布测试 Fan Post，用于确认交互手感。
- 右上角 user 抽屉：我的资料、帖子与评论、收藏、WVS 设置、返回桌面。
- Photos `usageHistory.channel` 预留 `wvs` 类型，后续接公开发图时无需再迁移旧相册结构。
- Service Worker cache version 升至 `v14`，避免部署后继续命中 v0.2.2 旧缓存。

## 当前还是 UI 测试数据

NCT WISH / RIIZE、帖子、成员资料均为 UI 演示。user 的测试发帖仅保存在当前 React 会话中，刷新后消失。

## 下一步建议

1. Community 持久化：创建 Community → 设置 Official Account → 从真实 Character 库勾成员。
2. 成员 WVS 显示资料独立覆盖（默认继承 Character，本 App 内修改不反改角色本体）。
3. WVS Store：帖子 / 评论 / 回复 / 点赞 / 通知。
4. AI 生成：Official / Artist / Fan 分身份规则。
5. Float Memory 双向接入。
6. Photos Resolver 接 `wvs` 公开发图和 usageHistory。
7. Official Schedule → 原生 Calendar → Chat 自动读取。
8. LIVE / 回放；最后再评估 Party / Spot。
