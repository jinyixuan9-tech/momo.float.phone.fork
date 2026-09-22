# ii-phone custom baseline v0.1

这是在原始 `momo.float.phone.fork` 源码上制作的第一版精简基线。目标是先移除确认不会使用的玩法，再从这个干净基线继续开发 Photos、Wallet、SMS 等功能。

## 本版移除的用户功能

- 独家特调（Mixology）
- 筑境（World Builder / 3D）
- iOS 现实桥的桌面 App 与前台调度 UI
- 漫卷（VN / Visual Novel）
- 共创（CoCreate）

同时清理了这些功能对应的桌面入口、主壳渲染、专属样式、资源库入口、设置绑定入口、资源集市入口、内置 Prompt/工具入口，以及不再被其他功能使用的 3D 模型与 HDRI 资源。

## 兼容性保留

为避免旧备份、旧记忆和仍被其它基础设施引用的代码突然失效，本版刻意保留了少量不可见兼容层：

- 旧漫卷/共创的历史事件与解析类型，可继续读取既有记忆数据，但不再提供桌面入口或现役绑定项。
- 现实桥部分底层 bridge/push 兼容代码仍被推送、自定义 App、快捷动作等共享模块引用，因此没有粗暴删除；iOS 现实桥的独立 App、UI 和调度器已移除。

## 旧数据迁移

- 已删除 App 的旧桌面、Dock、文件夹图标会在桌面布局归一化时自动过滤，避免出现幽灵图标。
- 设置绑定中遗留的 `forum/cocreate/vn` override/default 会在加载时清理。
- 内置预设中与漫卷/共创专属的 Prompt 会被定向过滤，不会重置用户其它自定义预设内容。

## 本版刻意没有做

本版只做精简，不加入新功能。Photos、Wallet、SMS、外卖、Bubble 二改，以及“在场/手记”双语补全都留到后续版本。

## 校验状态

- 全仓内部 `@/` 与相对 import 路径静态扫描：0 个缺失引用。
- 用本机 TypeScript 对原版与精简版做了差异检查；当前环境没有安装完整 React/Next 依赖，因此无法把这里的 `tsc` 结果当成正式 Next build，但未发现由本轮删除新增的本地引用/语法断裂。
- 当前执行环境无法稳定完成项目依赖安装，因此没有宣称完整 `next build` 已通过；建议先提交到测试分支，让 Netlify Deploy Preview 做最终构建验证，再合并 `main`。

## 建议部署流程

1. 把本版提交到 GitHub 的 `dev`（或其他测试）分支。
2. 用 Netlify Deploy Preview / Branch Deploy 打开测试站。
3. 重点检查桌面、聊天、朋友圈、角色、设置、资源库、阅读、冒险、栖所、剧情、查手机、小红书、在场、手记、购物、游戏、资源集市。
4. 确认无误后再合并到 `main`。

## v0.1.1 packaging fix
- Restored Chinese static-asset filenames that had been escaped as `#Uxxxx` during archive extraction.
- This fixes Netlify deployment rejection for `#` characters in deployed filenames.
- Code references remain unchanged because they already point to the original Chinese filenames.

## v0.2.0 · Photos MVP

在 v0.1.1 精简基线上新增原生 Photos App。当前只完成相册管理层：图库、人物、char×char Shared、批量上传、角色关联、AI 可调用标记与持久化。自动识图和聊天/朋友圈 Photo Resolver 尚未接入，详见 `PHOTOS_MVP.md`。

## v0.2.1 Photos Vision + Resolver
- Photos 新增自动识图（每批最多 4 张）、人工可编辑识图字段、多人槽位映射、角色“当前特征”。
- 新增聊天/朋友圈三档图片来源策略，并接入统一 Photo Resolver。
- “仅相册”未命中时不会偷跑生图；聊天会按角色人设自然化解，朋友圈仅发布文字。
- 相册图前端不显示来源标签，仅在图片详情显示“来自照片库”。
- 修复 v0.2.0 Photos 设置卡片 toggle 轻微错位。

## v0.2.2 Photos 导入与聊天显示小修
- 角色从 Photos 发到聊天的相册图片不再显示导入时的原始文件名；文件名仍保留在后台和保存图片时使用。
- 导入照片预览支持逐张移除。
- 导入弹窗支持继续追加选择照片；相同文件不会重复加入。
- Service Worker 缓存版本升级为 v13，部署更新后会淘汰旧静态缓存。
- 保持 v0.2.1 的识图批次、Resolver、朋友圈和三档发图策略不变。

## v0.3.0 · Weverse UI Shell
- 在 v0.2.2 Photos 基线上加入原生 Weverse 桌面 App 与桌面图标。
- 第一刀先写入已确认的 UI 骨架：`Feed / + / Community` 三栏悬浮 Dock，DM / Shop / More 不占底栏。
- 加入 My Feed、Community 列表、Community 首页、成员主页、发布 Sheet、右上角“我的”抽屉与原文/翻译切换示意。
- 当前内置 NCT WISH / RIIZE 为 UI 测试数据；user 可在本次会话中发布测试 Fan Post。
- 新建 Community、绑定真实 char、官号接管、AI 内容生成、记忆回写、Schedule/Calendar、LIVE 与 Photos Resolver 将在后续 WVS 迭代接入。
- Photos 使用渠道类型预留 `wvs`，方便后续 WVS 公开发图记录复用。


## v0.3.1 · Weverse Community Core
- 修复 WVS 内部返回：按实际访问栈逐级返回，根页返回桌面。
- Community 改为真实持久化数据，可新建/编辑/删除。
- 创建流程支持 Community 名称、简介、封面、Official 昵称/头像/简介，并从现有角色勾选成员。
- 成员 WVS 显示昵称/头像/简介可独立覆盖，不修改角色本体。
- Feed / Community / Artist 页面读取真实 Community 数据。
- user Fan Post 与 Official Post 可实际发布并持久化；支持本地图片、点赞、收藏、帖子详情与 user 评论。
- WVS 状态纳入社交内容备份：ai_phone_weverse_state_v1。
- AI 自动运营、翻译、Photos Resolver、Memory、Schedule/Calendar、LIVE 留待后续版本。
- Service Worker cache version 升至 v15。
