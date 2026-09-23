# Weverse · v0.3.7 Post Scroll & Notice Empty-State Fix

> v0.3.7 是针对 v0.3.6 实测问题的定点修复：恢复 Post Detail 的整页单一滚动逻辑，并移除 Community Home 空公告卡片误触“发布公告”的入口。

## v0.3.7 · Post Scroll & Notice Empty-State Fix

- Post Detail 改为唯一滚动链：Artist / 正文 / 图片 / Comments / 全部评论按页面自然顺序连续滚动；评论列表不再拥有独立固定高度或独立 overflow。
- 底部评论输入栏继续固定在详情页底部；“加载更多评论”保持在评论内容末尾。
- Community Home 没有公告时，点击公告卡片只提示“暂无公告”，不再打开“发布公告”；“查看全部”页右上角“新建”继续保留。
- 移除 v0.3.6 对 Post 图片 230px 的详情页限高，避免修滚动时连带压缩正文图片。
- Service Worker cache 升至 v22。

---

# Weverse · v0.3.6 Notice & Resolver Fix

> v0.3.6 聚焦 v0.3.5 实测修正：Official Notice 与 Official Post 正式拆分、公告列表/详情/编辑/删除、Official Account 主页、评论树分布与详情滚动修正，以及统一 Media Resolver 的“允许生图但无 API → 文字图片”降级。

## v0.3.6 · Notice & Resolver Fix

- Notice 是独立正式公告：有标题/正文/日期，可由 AI 或用户创建，支持编辑与删除；没有点赞与评论区，不混入普通 Feed。
- Official Post 保持社交动态语气，并统一归档到 Official Account 主页。
- Community Home 的公告模块只读取 Notice，并提供“查看全部”。
- AI 粉丝评论默认以独立顶级评论为主，少量形成回复楼，避免整批黏在第一条下方。
- Post Detail 维持底部回复栏固定，评论区独立滚动。
- Media Resolver 全局规则：仅相册模式匹配失败仍返回空；允许生图的模式下，真实生图失败/未配置 API 时返回文字图片描述占位。WVS、后续 Bubble/SMS 等可复用同一返回协议。
- Service Worker cache 升至 v21。


---

# Weverse · v0.3.5 Living Community

> v0.3.5 在 v0.3.4 的评论/媒体基础上补齐“社区已经活了一阵子”的时间线体验：固定评论输入栏、加载更多评论、艺人回复优先、主页回复关联卡、时间感知、粉丝数与模拟互动量、Official 自动用媒体池，以及 Community 历史初始化。

## v0.3.5 · Living Community
- Community 新增“当前粉丝数”，新生成帖的点赞/总评论数按 Community 规模、作者类型与内容随机生成并持久化；`commentCount` 与真正展开的 `comments[]` 分离。
- 评论详情只滚评论区，底部回复栏固定；滑到底出现“加载更多评论”，追加可见样本但不改总体评论数。
- 被 Artist 回复的整楼优先展示；Artist 主页“评论”改成 Artist Reply + 被回复上下文的关联卡，并可跳回原楼。
- WVS Artist / Official / Fan / Artist Reply 全链路加入当前时间锚点，避免下午集体说晚安；历史回填使用目标过去时间。
- Official AI 在生成前可读取当前 Official Media Pool 的识图描述并优先选择自然吻合素材；手工官号上传会直接写入 Photos、自动识图并同时加入当前官号媒体池。
- 创建/管理 Community 可选择“新社区 / 已运营一段时间 / 自定义开始日期”。历史模式会先生成少量 Official、Artist、较热闹的 Fan 旧内容，使用过去时间戳，不写入当前近期记忆；Feed 底部可继续“加载更早动态”。
- 旧 v0.3.4 帖子在迁移到 state v3 时会补上稳定的模拟互动数字，不清空已有社区、帖子、评论、收藏或媒体池。


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
- Official LIVE 与 Official 账号主页（个人 LIVE / 回放已进入 v0.5.x 主线）。
- 通知页本体。
- Fan Post 直接从 Photos 选择素材的手工选择器。

## v0.5.0 · Text LIVE MVP
- 成员主页 LIVE 标签已从占位升级为真实数据：可生成成员私人 LIVE，并在结束后保留 REPLAY。
- 开播主题可留空（角色自主决定）或填写软主题；可选择横屏/竖屏直播壳。
- 当前直播不使用真实视频：Stage 用角色语言 + 动作/环境模拟画面，粉丝留言按节奏逐条出现。
- 直播采用分段懒播放；当前缓存播完后可“继续播放”。
- 用户评论支持连续暂存多条；回车只加入待发送队列，点击“召唤”后才把本轮评论一起交给角色并推进直播。
- 角色无需回复用户，可按人设选择看到/忽略/综合回应。
- 在线人数、峰值、点赞与评论样本分离，允许大量潜水观众、路人和普通关注者。
- 直播总轮数/时长不固定，由角色及当次情境自然决定；收尾内容播完后才转入 REPLAY。
- 语音 LIVE 仍为下一阶段，当前不包含 TTS。

## v0.5.1 · LIVE fix
- LIVE 观看页改为黑色 WVS 风格；顶部保留唯一观看数/点赞数。
- 直播 Stage 可纵向回看全部已播放内容；新内容在用户停留底部时自动跟随，用户上滑回看时不强行拉回。
- 直播中点击返回键弹出“仅退出，保留后台播放 / 关闭直播 / 取消”。
- 角色仍可自主结束直播；手动关闭用于用户主动结束当前场次。
- 动作不是每轮必需，仅在发生新动作时出现；采用省略主语的现场描写，并以斜体显示。

## v0.5.2 · LIVE Playback / Artist Watch / Collaboration
- 普通文字 LIVE 只保留横屏 16:9 Stage；顶部为简化 `● LIVE / REPLAY`，不保留分享入口。
- 真正懒播放：模型返回后才排播放时间，主播内容逐段显现、观众评论逐条进入评论流；Stage 内仍可上滑回看已经播过的内容。
- 底栏改为输入框 + 小飞机 + 爱心：Enter 只发评论；小飞机有待处理评论时召唤并推进，无评论时直接继续；爱心仅飘心，不影响角色逻辑。
- 正在直播页不再占一块重复展示标题/主题；观看数与点赞数放在 Stage 下方。标题、封面、时长主要用于 LIVE 列表和 REPLAY 卡片。
- 每位成员可在 WVS 资料里设置默认 LIVE 封面，新直播自动继承；单场可覆盖，回放也可换封面。结束后的回放支持删除，并从成员 LIVE 与 Community LIVE·Media 同步移除。
- 同 Community 成员可围观彼此 LIVE：可以潜水，也可留下艺人评论。艺人评论有独立入口/列表，带艺人头像、认证、时间、原文与中文翻译；主播通常更容易注意艺人评论，但不强制逐条回复。
- 同 Community 成员也可中途连线加入同一 LiveSession。连线不改变页面成视频分屏，只在 Stage 中以 WVS ID 区分发言者，并用系统行标注加入/离开。艺人围观与连线参与是两种独立状态。
- 结束后为主持/连线参与者与纯围观艺人分别生成精简的 WVS LIVE 记忆投影，避免角色忘记自己来过；不同 Community 暂不互相围观或连线。
- Official LIVE 延后与 Official 账号主页一起实现；普通 LIVE 的点播 TTS 与纯语音 LIVE 也不在本版。

## v0.5.3 · LIVE TTS / Artist comments drawer
- 普通文字 LIVE 接入 Weverse 绑定的 TTS：直播 Stage 左下提供单一语音按钮，点击只朗读当前最新一条可见角色原话；不自动播放，不朗读动作或中文翻译；再次点击可停止，播完后可重复播放。
- 多人连线时按该 speech segment 的 `characterId` 解析各自 Weverse 语音绑定，所以不同成员自动使用自己的声音。
- 艺人评论不再跳转全屏页面：`X 条艺人评论` 在当前直播页内展开/收起半屏折叠抽屉，直播 Stage 始终可见，抽屉内部独立滚动。

## v0.5.4 · LIVE per-line TTS
- LIVE 不再使用一个“播放最新发言”的全局语音键。每一条角色 `speech` 原话前都有独立小语音按钮，用户可逐句选择是否播放。
- 单条播放只读该条原话；action、系统行、中文翻译不显示语音键也不朗读。多人连线按每条发言的 `characterId` 使用各自 Weverse TTS 绑定。
