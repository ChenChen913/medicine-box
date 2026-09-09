# 代码评审报告（2026-09-09 · 投产前全面审核）

## 评审方式

按阿里开源 AI 代码评审工具 **OpenCodeReview**（https://github.com/alibaba/open-code-review）
的 **Delegation 模式**执行：OCR 负责确定性的文件选取与规则解析（零 LLM key 依赖），
AI agent 按 OCR 规则逐文件深审。

```bash
npm install -g @alibaba-group/open-code-review   # v1.11.6
ocr scan --preview        # → 选取 36 个可评审文件（排除二进制/文档/lock）
ocr delegate rule <files> # → 输出六大类评审规则（拼写/死代码/质量/React/异步/安全）
```

评审范围：全部源码约 5,500 行（服务层 / 新版 UI / 经典版 UI / 构建部署配置 / schema）。

## 发现并已修复的问题

### 高优先级（数据安全 / 正确性）

| # | 问题 | 修复 |
| --- | --- | --- |
| 1 | `localRead()` 在 localStorage 内容损坏时返回空库，任何一次变更写入都会用空数据覆盖全部真实数据 | 返回 `null` 走「读取失败」语义；所有变更方法读失败即抛错中止（附 22 项断言中的损坏用例） |
| 2 | 服务层变更方法（入库/打卡/删除/补货登记等）在读取失败时静默返回，UI 照样提示成功（假成功） | 统一改为抛错；两套 UI 全部操作接 try/catch → toast/横幅/表单内错误提示，表单内容不丢 |
| 3 | `consumeMedicine` 未校验数量：负数会凭空加库存、NaN 会污染库存与记录 | 数量必须为有限正数，否则拒绝且不产生打卡记录 |
| 4 | `restockMedicine` 未校验输入：负数/NaN 数量、垃圾日期可直接写入库存 | 数量 ≥ 0 且日期 `YYYY-MM-DD` 校验，失败保留清单条目 |
| 5 | 合并入库未上传图片会把原记录图片清空（`...med` 覆盖） | 合并分支保留原图（入库表单无删图入口，语义为「未上传=不变」） |
| 6 | 导入清洗对 `image_url` 无协议限制，`javascript:` 等危险 URL 可入库 | 白名单：仅 `data:image/` 与 `http(s)`；非法日期（非 YYYY-MM-DD）置空不参与过期比较 |
| 7 | 导入的 `log_time` 无校验，Invalid Date 参与排序/分组产生 NaN 分组 | 非法时间兜底为当前时间 |

### 中优先级（React 最佳实践 / 健壮性）

| # | 问题 | 修复 |
| --- | --- | --- |
| 8 | `NavPill` 定义在 `ModernApp` 渲染体内，每次渲染重建子树（OCR React 规则） | 提升为模块级组件，`active/onSelect` 走 props |
| 9 | 「服药打卡」确认后弹窗不关闭（重构引入回归，自测发现即修） | onDone 内先关弹窗再执行 |
| 10 | 导出下载 `URL.revokeObjectURL` 立即执行，部分浏览器会中断下载 | 延迟 1s 释放 |
| 11 | 上传图片未校验 MIME（`accept` 可被绕过），非图片会进 base64 | `file.type.startsWith('image/')` 校验 |
| 12 | 经典版删除失败静默；乐观更新后不回读 | 失败提示 + 成功后 `refreshData()` 回读真实数据 |
| 13 | 卡片 `role="button"` 仅处理 Enter 不处理 Space（键盘可达性） | Enter/Space 均触发并 `preventDefault` |
| 14 | `LogsView` 静默截断至 100 条无提示 | 截断时显示「仅展示最近 100 条，完整记录可导出查看」 |
| 15 | `RestockView` 清单刷新逻辑重复两处且无错误兜底 | 抽取 `reloadItems()` + catch |
| 16 | 加载失败文案硬编码「云端/网络」，与本地存储损坏场景不符 | 透出服务层原始错误信息 |

### 体验补强（配合投产清空数据）

| # | 问题 | 修复 |
| --- | --- | --- |
| 17 | 清空数据后空箱状态显示「药箱状态良好/100% 达标」，误导 | 空箱专属文案与评级（待入库），新版/经典版各自增加「入库引导」空态 |
| 18 | 品牌/日期等无法按品牌搜索（品牌已展示但不可搜） | 联想下拉与主列表过滤均支持品牌关键词 |

## 评审遗留（记录在 docs/EXPERIENCE.md 第十节，需产品决策）

- Supabase RLS anon 全开放的暴露面（建议匿名登录 + user_id 隔离）；
- 多标签页 last-writer-wins 并发模型；
- 补货条目无数量字段（部分抵消需改 schema）。

## 验证

- `tsc --noEmit` 严格模式通过；`vite build` 通过（主 chunk 277KB → 216KB，移除演示数据收益）；
- 服务层 node 单测 22/22 通过（`scripts/test-medicine-service.mjs`，含投产重置/损坏保护/输入防御）；
- 补货匹配单测 18/18 通过（同步修正两条滞后断言）；
- 双端浏览器冒烟见工作日志。
