# 家庭药箱 · 开发踩坑与经验沉淀

> 本文档沉淀了项目从评审、双 UI 改版到投产全过程中**实际踩过的坑、根因与解法**，
> 按主题组织（每个条目尽量给出「现象 → 根因 → 解决 → 预防」）。
> 新会话/新协作者上手前先读一遍，可以避开绝大部分已知的坑。
>
> 维护约定：后续再踩新坑，请继续按主题追加到对应小节，并在文末更新「踩坑记录速查」。

---

## 一、项目背景速览

- 技术栈：React 18 + Vite 5 + TypeScript（strict）+ TailwindCSS 3 + tailwindcss-animate；
- 存储：配置了 `VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY` 时走 Supabase（Postgres），
  否则自动降级为浏览器 `localStorage`（当前线上部署即此模式，密钥未配置）；
- 部署：推送 `main` → GitHub Actions 构建 → GitHub Pages；
- 双 UI：`ui/classic`（原版，逻辑冻结）与 `modern`（Material 3 风格主力开发），
  共享 `services/medicineService.ts` 数据层，`?ui=classic` 可强制回退；
- 2026-09-09 正式投入使用：系统内不再预置任何演示数据，历史演示数据备份在
  `backup/` 目录（**均为虚构数据，非真实用户数据**，见 `backup/README.md`）。

---

## 二、部署链路（GitHub Pages + Actions）

### 2.1 直接用 PAT URL 推送后，本地 remote-tracking ref 不更新

- **现象**：`git push https://<PAT>@github.com/ChenChen913/medicine-box main` 成功后，
  本地 `git status` / `git log origin/main` 仍显示落后。
- **根因**：用完整 URL 推送不会更新 `origin/main` 的 remote-tracking 引用。
- **解决**：推送后执行
  `git fetch https://<PAT>@github.com/ChenChen913/medicine-box main:refs/remotes/origin/main`
  把远端引用对齐，避免下一轮误判「远端有未合并提交」。

### 2.2 Actions API 匿名轮询触发 403 限流

- **现象**：推送后用 `curl https://api.github.com/repos/.../actions/runs?...` 轮询部署状态，
  若干次后开始 403。
- **根因**：GitHub API 匿名请求限额很低（约 60 次/小时/IP）。
- **解决**：所有轮询请求带上 `Authorization: Bearer <PAT>` 头（限额升到 5000/h）。

### 2.3 「部署完成」≠「线上生效」：用 chunk 哈希比对确认

- **现象**：Actions 显示 success，但用户浏览器可能还在跑旧 bundle（缓存/CDN 延迟）。
- **解决**：以本地构建产物为准 —— `ls dist/assets/index-*.js` 拿到带内容哈希的文件名
  （如 `index-BSy6LzV_.js`），再去 `https://chenchen913.github.io/medicine-box/` 拉取线上
  `index.html` 比对引用的 chunk 名；关键改动还可直接在**线上 JS 文本**里 grep 特性代码
  （如 `[I.LIQUID]:"支"`）确认生效。
- **预防**：每次推送后固定执行「Actions success → 线上 chunk 名比对 → 必要时线上文本抽查」三步。

### 2.4 47 个文件的 mode 变化噪音

- **现象**：`git status` 出现几十个文件的 old mode/new mode 变更（0 行内容变化）。
- **根因**：Windows/WSL 与 Linux 之间文件权限位（executable bit）差异。
- **解决**：`git config core.fileMode false` 屏蔽权限位噪音（只对本仓库）。

### 2.5 Supabase secrets 未配置时构建不能失败

- **约定**：`deploy.yml` 里 secrets 通过 env 注入；没配置时构建照样成功，
  应用运行时自动降级 localStorage。`services/supabaseClient.ts` 用
  `URL.startsWith('http') && key.length > 20` 判定「是否真的配置了」，
  避免空串/占位符被当成有效配置。

---

## 三、数据层（localStorage / Supabase 双后端）

### 3.1 「读-改-写」链路里二次读库 = 数据丢失（本项目最经典的 bug）

- **现象**（历史）：`getMedicines` 播种后调用 `checkExpiry`，后者内部又 `readDB()` 再写回，
  把播种结果整体覆盖，首次打开后种子数据部分丢失。
- **根因**：同一个数据在一条调用链里被两次「读-改-写」，后写者以旧快照覆盖先写者。
- **解决**：约定所有原地修改函数（`addExpiredToShoppingList` / `settleMatchingRestocks` /
  `resetForProduction`…）都**只接收调用方持有的同一个 data 对象、原地修改、由调用方单次写回**，
  函数内部绝不 `readDB()`。函数注释里都写明了这条约定。
- **预防**：新增任何「修改库存/清单/记录」的服务函数时，先检查它有没有偷读库。

### 3.2 读取失败必须返回 null，绝不能返回空库

- **现象**（评审发现）：`localRead()` 在 JSON 损坏时 catch 后返回 `EMPTY_DB()`，
  随后任何一次变更（如入库）都会用「只有一条新数据」的库覆盖掉全部真实数据。
- **根因**：「空库」和「读不出来」是两种语义，混用会把失败伪装成「用户清空了药箱」。
- **解决**：`localRead` 损坏时返回 `null`；`readDB` 透传 null；
  所有变更方法 `if (!data) throw`；只有 `getMedicines` 把错误抛给 UI 显示横幅。
- **预防**：涉及持久化的代码里，「失败」一律走异常/NullObject 明确语义，
  禁止 catch 后用默认值继续走写路径。

### 3.3 UTC 时区泄漏：`toISOString().split('T')[0]` 是错的

- **现象**：东八区早上 8 点前，`toISOString()` 会给出「昨天」的日期，
  过期判断、最近购入日期全部可能偏一天。
- **解决**：全项目统一使用 `localDateString(d)` / `todayDateString()` 取本地日期；
  与「`YYYY-MM-DD` 字符串比较」配合，完全绕开 `new Date('YYYY-MM-DD')` 的 UTC 解析问题。
- **预防**：代码评审时见到 `toISOString` 用于「日期（非时间戳）」直接打回。

### 3.4 一次性迁移模式（本项目反复使用的套路）

适用场景：改种子数据救不了已存在的旧设备数据，需要一次自动迁移。
成熟实现要点（`refreshLegacyDemoData` / `seedBrandDemo` / `resetForProduction` 均如此）：

1. **flag 封口**：`localStorage` 记一个 `smart-medicine-box:<迁移名>:v1` 标记，执行过就跳过；
2. **值匹配双保险**：只改「未被用户动过的数据」（如 id+name+旧值精确相等才刷新），
   即使 flag 丢失（清浏览器数据）也不会二次覆盖用户数据；
3. **幂等**：每个子步骤自带存在性检查（要插入的条目已存在就跳过）；
4. **顺带清理**：迁移产生的孤儿数据（如指向已改效期药品的「过期」补货条目）一并处理；
5. localStorage 不可用（隐私模式）时静默跳过，绝不能每次加载都跑。

### 3.5 演示数据的生命周期教训（投产清空）

- **教训**：早期为演示效果播种了大量模拟数据（20 条种子药 + 演示品牌 + 模拟打卡），
  还写了两次「给老设备补演示数据」的迁移；投产时清理这些数据的工作量远超当初播种的成本。
- **正确姿势**（2026-09-09 落地）：
  1. 代码里**彻底删除**播种与演示迁移逻辑，新设备首开即空箱；
  2. 用一次性 `resetForProduction` 迁移把老设备里的演示数据自动清空（flag 封口）；
  3. 清空前先导出整库快照存入仓库 `backup/`，并在 `backup/README.md` 里**显著注明
     「全部为虚构数据，非真实用户数据」**；
  4. 应用内常驻「数据备份与恢复 → 清空全部数据」入口（两步确认）兜底。

### 3.6 localStorage 写入失败不能静默

- **现象**：大 base64 图片容易撑爆 5MB 配额；写入失败如果只 `console.error`，
  用户会以为已保存，刷新后数据「凭空丢失」。
- **解决**：`localWrite` 失败时 `window.dispatchEvent(new CustomEvent('mb:storage-error'))`，
  两套 UI 都监听该事件弹出提示（新版 toast / 经典版横幅）。云端写入失败同样广播。

### 3.7 导入导出：详细覆盖 + 逐条清洗 + 危险值过滤

- 导出为带 `app/version/counts/data` 包装的 JSON，药品**每一个属性**（含品牌、base64 图片、
  副作用等）与待补货清单、用药记录全覆盖，无遗漏；
- 导入支持 `merge`（按 id 去重，冲突以导入为准）与 `replace`（整库覆盖恢复）两种模式；
- **逐条清洗**（`sanitizeMedicine/Log/Item`）：缺 id/name 的条目直接丢弃并计数；
  数字 `Number()` 兜底；枚举不合法回退默认值；
  日期必须满足 `YYYY-MM-DD`，否则置空（垃圾串不参与过期比较）；
  图片只接受 `data:image/` 与 `http(s)` 协议，`javascript:` 等一律丢弃（防导入脏数据/危险 URL）；
- 非法 JSON、缺 `medicines` 数组直接抛错，绝不静默写半份数据。

### 3.8 Supabase 侧的注意事项（若未来启用云端）

- upsert 冲突更新时，schema 的 `default now()` 不会刷新 `updated_at`，必须显式带值；
- 整表同步（删除已移除行 + upsert 全量）在数据量小的场景安全且简单；
- 读失败时必须放弃写（`readDB → null`），否则一次网络抖动就会用空数据覆盖云端。

---

## 四、UI / 组件 / 动画

### 4.1 Google Fonts Material Symbols 在大陆不可达 → 内联 SVG

- **现象**：设计稿用 Material Symbols 字体图标，`fonts.googleapis.com` 在大陆常不可达，
  失败时图标位置直接显示英文单词文本。
- **解决**：全部图标改为内联 SVG（`modern/icons.tsx`，零外部请求、离线可用），
  由脚本从 `@iconify-json/*` 包程序化提取官方 path（见 5.1）。
- **预防**：面向国内用户的站点，任何外部字体/CDN 资源都要有本地兜底。

### 4.2 自定义下拉被容器裁剪 → Portal + fixed 定位

- **现象**：表单弹窗 `overflow-y-auto`、移动端筛选条 `overflow-x-auto` 都会把原生流内下拉裁掉。
- **解决**：`M3Select` 菜单用 `createPortal` 挂到 body + `position: fixed` 定位，
  彻底逃出裁剪上下文；滚动（capture 捕获弹窗内滚动）/resize 实时重定位，
  尾随双 rAF 补一次定位保证最终对齐；空间不足自动上翻（`dropUp`）、贴边收拢。

### 4.3 下拉「从左侧飞入」：合成层旧几何快照问题（最坑的一个动画 bug）

- **现象**：菜单入场动画在某些浏览器（WebKit/iOS 尤甚）表现为「从屏幕左侧飞过来」。
- **根因**：菜单先挂在 `(-9999,-9999)` 占位、同帧内改内联样式到最终坐标并起播；
  合成层会以**插入帧的旧几何快照**作为动画起点，占位坐标在屏幕左外侧 ⇒ 看起来像飞入。
  另一个叠加因素：transform-origin 用「top 是否过屏幕中线」启发式，下半屏向下展开的菜单
  被错误配了 origin-bottom，加剧怪异运动感。
- **解决**（三件套）：
  1. 自定义 `@keyframes m3-menu-in`：纯淡入 + scale 0.96→1，**零 translate 分量**，
     并在 index.css 注释里写明禁用位移的原因；
  2. **定位就绪后才挂动画类**：就绪前菜单 `visibility:hidden`（仅供测量），
     就绪后首帧即处于最终坐标；
  3. `dropUp` 显式驱动 transform-origin（下翻=origin-top，上翻=origin-bottom），不再启发式猜。
- **预防**：「先挂载再测量再移动」的元素，入场动画一律不能用带位移的关键帧。

### 4.4 键盘可达性：headless 环境 focus() 不可靠 → ARIA combobox 模式 B

- **现象**：把焦点移入菜单的方案在自动化测试里时灵时不灵。
- **解决**：采用 ARIA combobox 模式 B —— 焦点始终留在触发器，↑↓/Home/End 移动
  `aria-activedescendant` 高亮，Enter/空格选中，实测最稳且 Tab 序不乱。

### 4.5 手机端弹窗「太长无法点空白关闭」→ 底部抽屉化

- **解决**：`ModalShell`/`DetailDrawer` 手机端贴底（`items-end`）、全宽、只圆上角、
  高度收敛（76–80vh）保证顶部留白可点关闭；粘性头部内放拖拽指示条与吸顶关闭按钮；
  内容区 `overscroll-contain` 防滚动穿透；底部 padding 用
  `max(1rem, env(safe-area-inset-bottom))` 适配 iPhone Home 横条。
- **动画纪律**：入场只用垂直位移（slide-in-from-bottom-8），遵守 4.3 的「禁水平位移」原则；
  桌面断点回退为 fade+zoom 居中卡片。

### 4.6 组件定义在渲染体内 = 每次渲染重建子树（评审发现）

- **现象**：`NavPill` 曾定义在 `ModernApp` 函数体内，每次 state 变化都会产生新的组件类型，
  React 会把旧子树整个卸载重建（浪费且可能闪断交互状态）。
- **解决**：提到模块级，把 `active`/`onSelect` 作为 props 传入。
- **预防**：评审规则——组件函数体内不定义新组件；列表项用渲染函数/children 传参。

### 4.7 双 UI 隔离架构

- `App.tsx` 只做薄壳；`ui/UIMode.tsx` 管理 `?ui=` URL 参数 > localStorage 记忆 > 默认 modern；
- 两套 UI 共享服务层、各渲各的切换按钮（弹层打开时隐藏，避免遮挡）；
- Tailwind `content` 扫全部源码目录，m3-* token 独立前缀，不污染经典版。

### 4.8 经典版移动端底部导航惯性滚动时消失

- **根因**：`position: fixed` 在移动端惯性滚动期间会被浏览器丢弃渲染（iOS 历史行为）。
- **解决**：改为 flex 流内布局（页面本身 `h-dvh overflow-hidden`，滚动只在 main 内），常显。

---

## 五、图标系统

### 5.1 官方图标 path 程序化提取，不要手抄

- 用 `@iconify-json/healthicons`（CC-BY 4.0）、`@iconify-json/ic`、
  `@iconify-json/material-symbols`（Apache 2.0）+ `@iconify/utils` 的 `getIconData`
  提取 path，避免手抄出错且许可信息明确。
- **注意**：Healthicons 是 48×48 视窗（非 24），多 path（有的含 evenodd 镂空），
  Icon 组件要支持 `{vb, paths[{d, eo}]}` 对象形态并显式携带 viewBox。

### 5.2 SVG 镂空两法与绕向陷阱

- **方法一**：`fill-rule="evenodd" clip-rule="evenodd"`（简单直接，官方多 path 图标常用）；
- **方法二**：单 path 镂空靠**绕向差**（外轮廓 CCW + 内孔 CW，nonzero 规则下形成孔）；
- **坑**：自绘时给 path 加圆角，若 round 后内孔绕向被反转成同向，镂空会变成实心
  （止痛药片闪电、颗粒袋圆点都栽过）——渲染验证必须放到多尺寸画廊里目检。

### 5.3 多候选图标定稿：同屏多尺寸画廊

- 建 `icon-lab/gallery*.html`，把候选图标以 30/22/17px 同屏排列（对应卡片/列表/徽章场景），
  agent-browser 截图目检，五轮迭代选出终稿。比在真实页面里反复改反复看快得多。

---

## 六、业务逻辑

### 6.1 剂型→单位映射：单一数据源（FORM_UNIT_MAP）

- 表单联动、服务层、测试都引用 `services/medicineService.ts` 的 `FORM_UNIT_MAP`，
  一处修改全局生效；**踩过的坑**：初版口服液/外用默认单位写反（用户发现），
  修正时同时确认「数量单位与服用方式后缀共用 form.unit，无硬编码残留」；
  并把单测断言同步更新（测试断言滞后曾导致 18 项里 2 项假失败）。
- **预防**：任何「映射表」改动，必须同步 grep 引用点 + 跑断言。

### 6.2 待补货自动核销的三层匹配规则（isRestockMatch）

1. 名称 trim 后完全相等 → 直接匹配（名称是补货条目唯一标识，不再苛求剂型）；
2. 名称包含关系 → 需剂型佐证：药箱中同名药品剂型最权威；双方名称关键词反推剂型取并集，
   能推出剂型就必须一致（防「阿司匹林」条目被「阿司匹林肠溶片胶囊」误伤）；
3. 无包含关系 → 一律不匹配。
- 表单里的实时提示与提交后服务层用**同一个纯函数**，保证「提示即所得」。

### 6.3 合并入库的身份判定与字段取舍

- 同名 + 同剂型 + 同品牌（`normBrand` 规范化后）→ 视为同一条，合并入库；
  品牌不同 → 独立条目、用药分开统计（这正是「按品牌记账」需求的基础）；
- 合并时库存/效期等**以本次填写为准**，保留原 id/名称/频率分，最近购入=今天；
- **图片特殊**：入库表单没有「删图」入口，合并时若本次未上传图必须保留原图
  （`addMedicine` 合并分支 `...(med.image_url ? {} : { image_url: existing.image_url })`），
  否则补个货就把别人上传的照片弄丢了（评审发现的真实缺陷）。

### 6.4 用药记录的品牌快照

- 打卡时把 `medicine.brand` 写进 `UsageLog.brand`（快照而非引用）：
  之后即使改品牌/删药，历史记录仍能按当时的品牌分组统计。

### 6.5 服务层输入防御（评审补齐）

- `consumeMedicine`：数量必须为有限正数（负数=凭空入库、NaN 会污染库存）；
- `restockMedicine`：数量 ≥ 0 且日期 `YYYY-MM-DD`，不合法直接中止并保留清单条目；
- UI 层已有 clamp/表单校验的情况下服务层仍要兜底——服务是最后防线。

---

## 七、浏览器自动化测试（agent-browser）

### 7.1 交互必须用 snapshot ref 真实点击，禁止 find text / eval click

- **坑 1**：`find text` 会命中页面其它同名文本（如行内 span、遮挡元素下的同名按钮），
  导致外点关闭逻辑被误触发、表单填错位置；
- **坑 2**：`eval` 里 `el.click()` 不产生 mousedown/焦点转移，外点关闭、mousedown 挂接的
  组件（联想下拉、M3Select）行为全乱；
- **正确姿势**：`snapshot -i` 取 ref → 用 ref 点击；每次弹窗开关后 ref 会失效/变化，
  必须重新 snapshot。

### 7.2 headless 环境的「假象」要能识别

- `requestAnimationFrame` 可能不执行 → 「菜单不跟随」常是测试假象而非真 bug；
  验证定位用 `scrollTop = x` 赋值（产生原生 scroll 事件）而非模拟滚动；
- CDP resize 事件可能早于布局稳定 → 断言几何前等待/尾随确认；
- 截图相对路径写到 agent-browser 自身 tmp（`/home/z/.agent-browser/tmp/screenshots/`），
  需要拷回项目目录保存。

### 7.3 服务层 node 单测：esbuild 打包 + mock localStorage

- 服务层是纯 TS（含 `import.meta.env`），用
  `esbuild --bundle --define:import.meta.env.VITE_...='""' --external:@supabase/supabase-js`
  打成可运行 bundle，node 里挂一个内存版 `globalThis.localStorage` 即可全链路测试
  （见 `scripts/test-medicine-service.mjs`，22 断言）。
- **坑**：mock 的 `reset()` 若把「迁移 flag」也清掉，后续 `getMedicines` 会把测试数据当
  遗留数据清空——mock 环境要区分「已完成迁移的设备」与「全新设备」两种初始态。

### 7.4 冒烟基线

- 每轮改动后双端（1440 / 390）固定断言：核心链路走通 + **console 无 error/warn**；
- 发现 console 报错先核对 chunk 名是否是旧 bundle 残留，再定位新问题。

---

## 八、AI 协作工程（AI 编码助手的实战教训）

### 8.1 MultiEdit 不是原子的

- **现象**：MultiEdit 某个 old_str 不匹配时整批报错，但**已执行的前几条不会回滚**；
  还发生过替换内容里混入行首杂字符的事故。
- **正确姿势**：MultiEdit 报错后必须先读文件核实实际状态再补剩余编辑；
  大段替换后用 Read/tsc 复核；新增/删除代码块优先用带标记定位的脚本（见
  `scripts/svc-surgery.py` 的做法）并自带断言校验。

### 8.2 长任务上下文续接

- 跨会话续做时，先做三件事：`git log` 核实 HEAD、读工作日志
  （`/home/z/my-project/worklog.md`）、grep 关键特性代码确认「线上到底有没有这个功能」
  ——摘要/记忆会说谎，仓库不会。

### 8.3 密钥卫生

- PAT token 一旦在聊天/日志中明文暴露就视为永久泄漏，每次推送后必须提醒撤销轮换；
- 代码仓库里永远只放 anon key 级别的公开值，service_role key 不进前端。

---

## 九、OpenCodeReview（阿里开源 AI 评审）接入记录

- 工具：https://github.com/alibaba/open-code-review
  （`npm install -g @alibaba-group/open-code-review`，提供 `ocr` 命令）；
- **Delegation 模式**（无需 LLM key）：`ocr delegate preview` / `ocr delegate rule <files>`
  由 OCR 完成确定性的**文件选取**与**规则解析**（拼写/死代码/质量/React 最佳实践/异步/安全
  六大类），由 AI agent 按规则执行评审 —— 本次投产前的全量审核即采用此模式；
- 全量扫描：`ocr scan --preview` 可先看选取清单（不调 LLM），正式扫描需配置 provider/key
  （内置 dashscope/deepseek/openai/gemini/z-ai 等，对应 `DASHSCOPE_API_KEY` 等环境变量）；
- CI 集成：见 `.github/workflows/code-review.yml`（默认手动触发防报错，
  配置 `OCR_API_KEY` secret 后可开启 PR 自动评审）；
- 本轮评审修复清单见 commit message 与第十节遗留决策表上方说明。

---

## 十、遗留决策与已知权衡（需要产品层面拍板的事）

| 事项 | 现状 | 风险/建议 |
| --- | --- | --- |
| Supabase RLS anon 全开放 | 家庭自用可接受 | 若公网暴露，任何人可读写；建议改匿名登录 + user_id 隔离 |
| 多标签页并发 | last-writer-wins | 同一浏览器开两个标签同时改，后写覆盖先写；家庭场景可接受 |
| 补货条目无数量字段 | 入库核销=整条核销 | 想按数量部分抵消需改 schema（shopping_list 加 quantity 列） |
| 用药记录展示上限 | 新版界面最近 100 条 | 完整记录走导出；如需分页再加 |
| 端到端测试框架 | 未引入（agent-browser 冒烟 + node 单测） | 功能面继续扩大后建议引入 Playwright |

---

## 附：踩坑记录速查（按轮次）

| 轮次 | 主题 | 关键坑 |
| --- | --- | --- |
| 1 | 评审修复 | 播种双写覆盖；UTC 日期泄漏；读失败返回 []；存储失败静默 |
| 2 | 双 UI 改版 | Material Symbols 不可达；UISwitcher 双重渲染 |
| 3 | 演示数据迁移 | 一次性迁移双防重跑；夹具 status 大小写笔误 |
| 4 | 信息降噪 | MultiEdit 杂字符事故 |
| 5 | 移动端+搜索 | pinyin-pro 动态 chunk 拆分 |
| 6 | M3 下拉 | Portal+fixed 逃逸裁剪；ARIA combobox 模式 B；eval click 假象 |
| 7 | 下拉动画 | 合成层旧几何快照；禁水平位移纪律 |
| 8 | 手机端弹窗 | 底部抽屉化；safe-area；ref 失效规则 |
| 9 | 图标语义化 | evenodd/绕向差；48 viewBox；多尺寸画廊 |
| 10 | 入库逻辑 | FORM_UNIT_MAP 单源；三层补货匹配；node 单测基建 |
| 11 | 单位修正 | 一处修改全局生效；线上 JS 文本抽查 |
| 12 | 品牌字段 | 品牌快照；导入导出全字段覆盖；竞态修复 |
| 13 | 投产 | 演示数据清空与备份注记；损坏保护；OCR 评审接入 |
