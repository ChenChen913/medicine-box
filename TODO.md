# 家庭药箱 · 待办事项

## 🔴 数据持久化方案（当前未配置）

### 现状
应用目前运行在 **浏览器 localStorage** 模式下。数据保存在当前设备的浏览器中，换设备或清除浏览器数据会丢失。

### 方案一：Supabase（推荐，但当前受限）
- **状态**：❌ 待配置
- **原因**：Supabase 免费账户的项目数量已达上限，新建 Project 需要付费升级
- **操作步骤**：
  1. 等现有 Supabase 项目释放额度，或购买付费计划
  2. 新建 Supabase Project
  3. 执行 `supabase/schema.sql` 中的建表脚本
  4. 在 GitHub 仓库 Settings → Secrets 中配置 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`
  5. 重新触发 GitHub Actions 部署
- **文件**：`supabase/schema.sql`（已包含建表语句 + RLS 策略）

### 方案二：Cloudflare Workers + D1（备选）
- **状态**：⏸️ 待评估
- **优势**：免费额度大，不会自动暂停
- **劣势**：需要写 Workers 后端代码，setup 比 Supabase 复杂

### 方案三：纯 localStorage（当前运行中）
- **状态**：✅ 已启用
- **适用场景**：单设备使用，不担心数据丢失
- **限制**：换设备不同步，清除浏览器数据会丢失

---

## 🟡 已完成

- [x] GitHub Pages 自动部署
- [x] 双后端代码架构（Supabase / localStorage）
- [x] 项目重命名为 Medicine Box
- [x] 2026-09 代码评审修复：播种双写丢失过期补货条目、过期检测改为每次加载执行、统计口径与过滤对齐、全链路本地时区日期、存储失败界面可见提示、主包体积优化（413KB → 189KB，supabase-js 懒加载）
