# 家庭药箱

一个基于 React + Vite + TypeScript 构建的「家庭药箱」单页应用，支持药品库存管理、过期提醒、补货清单与用药记录。

**在线访问地址：** https://chenchen913.github.io/medicine-box/

---

## 技术架构

- **前端**：React 18 + Vite 5 + TailwindCSS（本地编译，见 `tailwind.config.js`）
- **数据持久化**：当前使用浏览器 localStorage（单机模式）
- **云端方案**：预留 Supabase 双后端（见 [TODO.md](TODO.md)）
- **部署**：GitHub Actions → GitHub Pages（免费）

---

## 本地开发

```bash
npm install
npm run dev
```

应用会在 `http://localhost:5173` 启动。

---

## 部署说明

每次推送 `main` 分支时，`.github/workflows/deploy.yml` 会自动构建并发布到 GitHub Pages，无需手动操作。

---

## 待办事项

见 [TODO.md](TODO.md) —— 包含数据持久化方案对比与后续计划。
