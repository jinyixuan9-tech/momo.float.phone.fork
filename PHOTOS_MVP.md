# Photos v0.2.0 MVP

基于 `ii-phone custom baseline v0.1.1` 新增 Photos 原生 App。

## 本版包含

- iOS Photos 风格基础界面：图库 / 人物 / 共享。
- 批量导入图片。
- 导入时关联一个或多个角色。
- 两位角色时可标记为真正的 `char1 × char2` Shared Album；user 不作为 shared pair。
- `AI 可调用` 开关（本版仅保存状态，Resolver 下一阶段接入）。
- 图片本体复用现有 IndexedDB 媒体存储，Photos 只保存元数据与关系。
- 人物相册和 Shared Album 自动由照片关系派生，不重复复制媒体文件。
- 照片详情可重新关联角色、修改 Shared、修改 AI 可调用状态、删除照片。
- 已预留视觉识别字段与 usageHistory，供 v0.2.1 / v0.2.2 使用。
- `ai_phone_photo_library_v1` 已登记进数据管理模块；媒体资源引用可被现有孤儿清理扫描识别。

## 本版暂不包含

- 自动识图 / 自动标签。
- 聊天发图前相册检索。
- 朋友圈发图前相册检索。
- DM → Moments / Moments → DM 的复用历史规则。

这些功能将在后续 Photos 阶段继续接入。
