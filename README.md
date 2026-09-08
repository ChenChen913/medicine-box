# 家庭智慧药箱

一个基于 React + Vite + TypeScript 构建的「家庭智慧药箱」单页应用，支持药品库存管理、过期提醒、补货清单与用药记录。

**在线访问地址：** https://chenchen913.github.io/smart-medicine-box/

---

## 技术架构

- **前端**：React 18 + Vite 5 + TailwindCSS CDN
- **数据持久化**：Supabase（Postgres + Row Level Security）
- **降级方案**：当未配置 Supabase 环境变量时，自动降级为浏览器 localStorage（单机可用，换设备不丢失需配置云端）
- **部署**：GitHub Actions → GitHub Pages（免费）

---

## 本地开发

```bash
npm install
npm run dev
```

应用会在 `http://localhost:5173` 启动。

> 如果你需要连接自己的 Supabase 项目，把 `.env.example` 复制为 `.env.local`，填入你的 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`。

---

## Supabase 建库

进入 `supabase/schema.sql`，整段粘贴到你的 Supabase SQL Editor 执行即可。建完三张表并启用 RLS 策略后，你的数据就能在多设备间实时同步。

---

## 部署说明

每次推送 `main` 分支时，`.github/workflows/deploy.yml` 会自动构建并发布到 GitHub Pages，无需手动操作。
