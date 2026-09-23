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


## Weverse v0.3.2
- Feed 仅保留 Artist / Official 动态。
- Fan 发布入口移动到 Community 内。
- Community / Artist 页面改为 Weverse 风格，Party 移除，LIVE·Media 预留。
- 帖子支持统一编辑/删除；Community 与成员 WVS 资料可独立维护头像/背景。

## Weverse v0.3.3 · AI Community Core
- 修正 Community 图标 / 背景 / Official 头像的职责与 fallback；Community 图标默认继承官号头像，不再继承背景。
- Highlight 仅 Official + Artist；Fan 与 Artist 独立筛选。
- 接入 AI 社区一轮生成：Artist Post + 少量 Fan Post / Fan Comment。
- Artist 生成读取 Float 人设、世界书、核心/长期/近期记忆与 Calendar，并限制私人秘密公开。
- Artist 发图接 Photos Resolver（wvs channel），WVS 暂沿用朋友圈公开发图策略。
- Artist Post 支持原文 + 中文翻译切换。
- 新增 Weverse memory projection，并加入原生短期时间线 / 长期总结来源；编辑删除同步清理。
- 右上角接入 WVS 专属 user 粉丝身份编辑，默认继承 User Identity，可独立覆盖。
- Service Worker cache version 升至 v18。

## Weverse v0.3.4 · Community Interaction + Media Resolver
- 评论升级为持久化树状互动：AI Fan 评论数量不固定，可粉丝互回、艺人概率回复、user 参与、追加生成不覆盖、原文/中文切换、删除占位保留子回复。
- 右上角「我的」新增我的帖子 / 我的评论 / 收藏；WVS 设置保存翻译、社区活跃度、KR MIX 粉丝语言与通知偏好。
- 蓝绿色星星改为 AI 生成入口；Community 可生成 Artist / Fan / Official 内容，Post 详情可追加评论。
- AI Fan 默认 75%~90% 韩语，少量日语 / 英语 / 中文；Artist 保持角色本人自然语言。
- Photos 图片策略改为全局统一：强制仅相册 / 强制仅生图 / 智能混合；Chat、朋友圈、WVS 以及未来 Bubble / SMS 共用。
- 新增统一 Media Resolver：所有类型都先查素材池；自拍/人像/合照智能模式不匹配则不偷偷生人物图，食物/风景/物品等匹配失败后可生图。
- WVS Official 不创建 Character；Community 只维护 Photos photoId 引用作为官号媒体池。AI Official 已接入该池并支持智能回退生图。
- Service Worker cache version 升至 v19。

## v0.3.5 · WVS Living Community
- WVS 评论页改为固定底部回复栏 + 独立评论滚动区；底部加载更多评论，Artist Reply 楼优先。
- Artist 主页评论页保留被回复上下文并可跳回原楼。
- Community 新增粉丝数、模拟点赞/总体评论快照，以及历史社区初始化/加载更早动态。
- WVS Artist / Official / Fan / Reply 加入真实时间感知；历史生成不会写入当前近期记忆。
- Official AI 可读取官号媒体池素材描述；官号从手机上传的素材会进入 Photos、自动识图并加入 Official Media Pool。
- Service Worker 升级为 v20。


## v0.3.6 · WVS Notice & Resolver Fix
- Notice 与 Official Post 分离；公告支持列表/详情/编辑/删除且无评论区。
- Official Post 进入官号主页；评论生成以顶级评论为主。
- 统一 Media Resolver：允许生图但无 API/失败时降级为文字图片；album_only 匹配失败仍不伪造图片。

## v0.3.7 · WVS Post Scroll & Notice Empty-State Fix
- Post 详情恢复整页单一纵向滚动：Artist / 正文 / 图片 / Comments / 评论连续滚动，评论区不再独立滚动。
- 底部评论输入栏继续固定；加载更多保持在评论末尾。
- Community Home 无公告时点击仅提示“暂无公告”，不再误开“发布公告”；“查看全部 → 新建”保持不变。
- 移除详情图 230px 限高。
- Service Worker cache version 升至 v22。

## v0.3.8 · Chat Profile MVP
- 新增角色专属 Chat Profile：`displayName` 与 `avatarUrl` 只影响 Chat，不修改 Character 本体资料。
- Chat 昵称显示优先级：用户备注 `alias` > Chat Profile 昵称 > Character.name。
- Chat 头像显示优先级：Chat Profile 头像 > Character.avatar。
- 聊天信息页原“设置头像”升级为“聊天资料”，可手动编辑 TA 的聊天昵称与聊天头像，并可一键恢复角色默认资料。
- 联系人列表、会话列表、聊天室标题/头像与通知头像统一读取 Chat Profile。
- 现有“发图并暗示对方换头像”机制接受后只更新 Chat Profile，不再污染角色卡头像。
- Chat Profile 纳入数据管理/备份键；旧角色无 Profile 时自动回退，无需迁移旧数据。
- 本版只补 Chat Profile 基础层，暂未加入角色主动自主改昵称/头像的 AI 行为。
- Service Worker cache version 升至 v23。


## v0.3.9 · Chat Bubble Avatar Sync Fix
- 修复 Chat Profile 头像修改后，聊天室消息气泡仍显示 Character 原头像的问题。
- 单聊历史消息/新消息头像统一读取 Chat Profile 头像并实时跟随资料更新。
- 群聊成员消息与群聊流式预览也按各自角色 Chat Profile 解析头像；无覆盖时继续回退 Character.avatar。
- Service Worker cache version 升至 v24。

## v0.4.0 · Autonomous Chat Profile
- 在 v0.3.9 Chat Profile 基础上新增角色自主资料行为：角色可低频、按人设主动修改自己的 Chat 昵称或头像；不会修改 Character 本体资料，也不会覆盖用户备注 alias。
- 自主昵称通过隐藏 `资料更新` 动作执行；绝大多数普通聊天不应触发，角色资料自主更新后有 72 小时字段级冷却，避免频繁改名/换头像。
- 自主头像只能从 Photos 中该角色已关联、AI 可调用且识图完成的真实照片候选里选择，动作执行时会再次校验 photoId，不能编造图片。
- 当前 Chat 头像/昵称与角色当前外观参考会提供给模型，避免重复设置同一资料。
- 保留原有“用户发图/小窗推荐角色换头像 → 角色自主接受或拒绝”的完整机制；当本轮存在用户头像推荐时，禁止同时走自主头像动作，避免绕开推荐图片。
- `资料更新` 动作壳按 platform target 设计；v0.4.0 只执行 `chat`，为后续 WVS / LYSN 复用同一资料行为层预留。
- Service Worker cache version 升至 v25。


## v0.4.1 · Chat Profile Tool Isolation Fix

- 修复明确要求角色“换头像 / 改昵称”时可能误入原生工具调用链、最终出现 `Tool Network Error connecting to AI Provider: Failed to fetch` 的问题。
- 私聊中明确的 Chat Profile 修改请求现在强制关闭本轮外部工具，仅走普通文本生成 + 本地 `资料更新` 动作；不影响普通聊天里的工具能力。
- Profile 自主提示词新增硬约束：修改头像/昵称不得调用联网、搜索、生图、文件或发送照片工具；头像只能选择已注入的真实 Photos 候选 `photoId`。
- 用户发图推荐头像的原有接受/拒绝机制继续保留，并同样受益于本轮工具隔离。
- Service Worker cache version 升至 v26。


## v0.4.2 · Avatar Recommendation + Asset Avatar Fix

- 修复“用户发图推荐角色换头像”时 Custom AI Provider 可能因多模态图片 body 直接 `Failed to fetch`：该轮保留文字/图片描述与推荐语义，但不再把原始图片 base64 再次塞进聊天请求。
- 保留原有“角色按人设接受/拒绝推荐头像”机制；接受后仍使用用户推荐的那一张。
- 修复角色从 Photos 自主挑选头像后把 `asset://...` 直接写进 `<img src>` 导致头像空白：现在会从 IndexedDB 读取素材并压缩成可直接显示的 Chat Profile 头像 Data URL 后再落库；v0.4.0/v0.4.1 已产生的旧 `asset://` 头像也会在读取时自动迁移并先回退默认头像，避免继续显示空白。
- `资料更新` 动作支持异步落库，确保 Photos 素材解析完成后再更新头像。
- Service Worker cache version 升至 v27。

## v0.4.3 · Recommended Avatar Apply Fix

- 修复“用户推荐头像，角色口头接受但 Chat Profile 没真正换上”的问题。
- 头像推荐接受判定补充中文“换了/换好了/已经换”等表达，并兼容常见韩语、日语、英语接受/拒绝措辞；拒绝判断优先，避免误判。
- 用户推荐的原始图片不再直接整张写入 Chat Profile：接受后会先解析并压缩成头像尺寸，再更新平台头像，避免超大 data URL 或内部 asset 引用导致显示/持久化异常。
- 推荐头像仍只影响 Chat Profile，不修改 Character 本体；自主从 Photos 换头像逻辑保持不变。

## v0.4.4 · Avatar Recommendation Clean Restore

- 撤回 v0.4.1–v0.4.3 对“用户推荐头像”链路叠加的工具隔离、去图、扩展口语判定与异步压缩落库补丁。
- 推荐头像恢复到 v0.3.9 已验证的原始流程：用户发图并提出头像建议 → 角色按人设接受/拒绝 → 隐藏控制标记 → 接受后直接使用该条消息的真实 `mediaUrl` 更新资料。
- 与旧版唯一的目标差异：最终不再写 `Character.avatar`，而是写 `ChatProfile.avatarUrl`，因此只影响 Chat 平台头像。
- “角色自主从 Photos 换头像/改昵称”继续保留，并与推荐头像严格分支；推荐回合不进入自主 `资料更新` 提示。
- Service Worker cache version 升至 v29。

## v0.4.5 · WVS Autonomous Profile

- WVS 现有成员资料手动编辑入口保持不变。
- Chat 中接入角色 WVS Profile 自主行为：角色可低频自己改 WVS 昵称，或从 Photos 的真实可用角色照片中选择 WVS 头像。
- Chat 中明确提到 WVS/Weverse/위버스 的头像或昵称时，只影响 WVS Profile，不误改 Chat Profile。
- 用户“发图 + 推荐作为 WVS 头像”沿用已经稳定的头像推荐链：角色接受/拒绝；接受后直接更新 WVS memberProfile，不碰 Character/Chat。
- WVS 自主资料动作使用 `[资料更新 "wvs"]...[/资料更新]`，由现有 Action Parser 分发；当前只从 Chat 沟通渠道触发，WVS 本身不新增推荐资料入口。
- WVS Profile 自主改名/头像有 72 小时低频冷却；用户明确在 Chat 里提出 WVS 资料建议时可按人设当轮决定，不被自主冷却强制挡住。
- Service Worker cache v30。

## v0.5.0 · WVS Text LIVE MVP

- WVS LIVE 从占位壳升级为可实际游玩的文字直播：成员主页 LIVE 标签可直接生成一场成员私人 LIVE；主题可留空让角色按人设/近期情境自由开播，也可填写“活动后台 / 吃饭 / 睡前聊天 / 推歌”等软主题。
- 支持横屏与竖屏两种 WVS 观看壳：横屏为 16:9 文字 Stage + 下方评论；竖屏为全屏暗色 Stage + 下半区叠加评论。当前不接真实视频，直播本体为角色语言、动作/环境与弹幕。
- LIVE 采用“懒播放 / 分段生成”：开播一次生成首段角色内容和一批粉丝留言，前端按时间逐条显现；本轮播放完后再由用户选择是否推进，不持续后台调用 AI。
- 新增“继续播放”：不发弹幕也能生成下一小段直播；不设固定轮数或固定时长，由角色人设、当次情境与直播目的决定继续或自然收尾。
- 新增“多条弹幕暂存 + 召唤”：回车/发送只把用户评论加入本轮待发送队列，不立即触发 AI；点击召唤后才一起提交并推进下一段。角色可以看到其中部分、综合回应、完全忽略或继续原话题，不做一问一答式私聊。
- 观众数与活跃评论分离：在线观众可明显多于发言者，生成规则包含核心粉丝、普通关注者、路人和潜水观众；私人 LIVE 冷启动先等人进来，评论从“终于开播 / 今天好帅 / 最近吃啥”等即时反应逐渐升温。
- 点赞数、当前/峰值观看数随直播推进持久化；角色决定自然下播后，最后一段内容和弹幕播放完才切换 REPLAY，成员页与 LIVE·Media 可进入回放。
- Live 数据进入 Weverse state v5；旧 state 自动补空 lives，不要求手动迁移。
- 纯语音 LIVE / TTS 播放壳暂不在本版实现，等文字 LIVE 交互稳定后复用同一底层。
- Service Worker cache version 升至 v31。

## v0.5.1 · WVS LIVE UI / History / Exit Fix
- 普通 LIVE 统一改为深色观看壳；观看数/点赞数只保留顶部一处，移除横屏标题区重复统计。
- LIVE Stage 现在保留并渲染全部已播放 segment，可直接在直播窗口内上滑回看前几轮，不再把历史拆成“往期回放”卡片。
- 返回键在直播中改为退出选择：可“仅退出，保留后台播放”，或“关闭直播”；角色仍可按原逻辑自行收尾下播。
- 手动关闭直播会截断尚未播放的排队 segment/comment，避免下播后未来内容继续冒出；若 AI 请求仍在生成，返回结果会在发现直播已关闭后丢弃。
- action 改为可选：只有确实发生新的动作/姿态变化/环境操作才生成；没有新动作就完全省略。动作使用省略主语的现场写法，不写第三人称，通过斜体样式与原语言/翻译区分。
- Service Worker cache version 升至 v32。
