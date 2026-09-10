# 家庭药箱

一个基于 React + Vite + TypeScript 构建的「家庭药箱」单页应用，支持药品库存管理、过期提醒、补货清单与用药记录。

**在线访问地址：** https://chenchen913.github.io/medicine-box/

---

## 技术架构

- **前端**：React 18 + TypeScript 5 + Vite 8 + TailwindCSS 3（本地编译，见 `tailwind.config.js`）
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

## 质量保障

三层自动化测试（共 328 条断言）：

```bash
npm test                         # 单元与逻辑：服务层 171 + UI 逻辑 91 = 262 条（Node，无需浏览器）
npm run test:e2e                 # 浏览器端 66 条（Puppeteer 驱动本机 Chrome）
npm run test:all                 # 类型检查 + 单元 + lint + 浏览器 E2E（一条命令跑完）
node scripts/mutation-check.mjs  # 变异测试：故意改坏 5 条关键防线，验证测试真的抓得住（手动运行）
```

浏览器端覆盖：渲染与响应式（320/360/390/768/1440）、核心业务链路、数据安全与对抗（投毒备份 / XSS / 配额写失败）、
无障碍与键盘（焦点管理 / Tab 锁定 / 24px 目标尺寸）、PWA 与离线、布局回归、历史缺陷回归墙、**axe 无障碍扫描**（10 个界面状态）。

- 推送 `main` 自动执行 CI：类型检查 → 测试 → ESLint → 构建 → 浏览器 E2E（见 `.github/workflows/ci.yml`）。
- 无障碍：axe-core 按 WCAG 2.0/2.1/2.2 A+AA 扫描颜色对比度与嵌套交互元素，全部通过。
- 验收标准、逐条判定与三轮复测证据见 [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)。

---

## 部署说明

每次推送 `main` 分支时，`.github/workflows/deploy.yml` 会自动构建并发布到 GitHub Pages，无需手动操作。

---

## 待办事项

见 [TODO.md](TODO.md) —— 包含数据持久化方案对比与后续计划。
