# Weverse · v0.3.2 Community UX

这一版基于 v0.3.1.1，重点不是继续加 AI，而是先把 Weverse 的真实页面层级、发布逻辑与基础交互做顺。

## 首页
- 底栏简化为 Feed / Community 两项，移除全局发布按钮。
- Feed 改成「艺人动态」，只展示 Artist / Official 内容；Fan Post 不进入首页。
- Community 列表继续负责进入和新建社区。

## Community
- 改为更接近真实 Weverse 的大 Hero 社区主页。
- 主导航：Home / Feed / LIVE·Media。
- Home：公告、Calendar 占位、About / 成员入口。
- Feed：Highlight / Fan / Artist 筛选。
- LIVE·Media：先完成 UI 与可点击占位，未实现功能统一提示“后续接入”。
- Fan 发布按钮只在 Community 内出现，发布目标锁定当前 Community。
- Official 发布只从右上角社区管理菜单进入，不与 Fan 发布混用。
- Community 头像与大背景拆分，可独立编辑。

## Artist
- 改为 Weverse 风格沉浸式成员主页，不再使用 X/Twitter 式资料页。
- 成员 WVS 头像、显示昵称、简介、主页背景均可独立修改，不影响角色本体。
- Tab：帖子 / 评论 / LIVE。
- Party 移除。
- LIVE 页先提供当前直播与历史回放占位；真实直播状态后续接入。

## 基础管理
- 所有 WVS 帖子右上角菜单都支持编辑 / 删除，不区分 user / Official / Artist 来源。
- Community 新建、编辑、删除与返回链继续可用。
- 未实现但已出现的入口统一弹出“后续接入”，避免死按钮。
- Service Worker 缓存版本升级到 v17。

## 后续
下一阶段再接 AI Artist/Fan 内容、Photos Resolver、现有翻译格式与 Float Memory；之后接 Schedule/Calendar 与 LIVE 真逻辑。
