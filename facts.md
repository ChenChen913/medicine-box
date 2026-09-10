# facts.md

> README 的唯一事实来源。A 部分由 AI 扫描生成（每条附来源与产生命令），B 部分由老板手写（2026-09-10 确认）。
> 本文档不提交到仓库（见 .gitignore），仅作为 README 的事实台账。

## A. 可自动提取的事实

1. **项目类型**：③ Web 应用（React 单页应用 + PWA，静态托管在 GitHub Pages；无服务端）
   来源：`package.json` scripts（dev/build/preview）、`index.html`、`public/manifest.webmanifest`、`.github/workflows/deploy.yml`
2. **主语言 / 运行时 / 最低版本**：TypeScript 5.2（strict，ES2022）· Node **>= 18.18.0** · `.nvmrc` = 20
   来源：`package.json → engines`、`.nvmrc`、`tsconfig.json`
3. **包管理器**：npm（仓库只有 `package-lock.json`，无 yarn.lock / pnpm-lock.yaml）
   来源：锁文件探测
4. **安装命令**：`npm install`　来源：`package.json`（无自定义 install 脚本）
5. **运行命令**：`npm run dev`（Vite dev server，默认 http://localhost:5173）
   来源：`package.json → scripts.dev` = `vite --host`
6. **测试命令**：`npm test`（服务层 + UI 逻辑）、`npm run test:e2e`（浏览器）、`npm run test:all`（全部）
   来源：`package.json → scripts`
7. **构建命令**：`npm run build`（= `tsc && vite build`）　预览：`npm run preview`
8. **断言数量**：服务层 **171** + UI 逻辑 **91** = 262；浏览器 E2E **80**；合计 **342**
   产生命令：`npm test` → `TOTAL=171 PASS=171 FAIL=0` / `TOTAL=91 PASS=91 FAIL=0`；`npm run test:e2e` → `E2E TOTAL=80 PASS=80 FAIL=0`
9. **首屏体积**：入口 `index-*.js` **276.32 kB raw / 84.51 kB gzip**
   产生命令：`npm run build`
10. **变异测试**：5 条历史缺陷防线，5/5 可被用例集抓住
    产生命令：`node scripts/mutation-check.mjs`
11. **目录结构**（顶层）：
    - `modern/` — 新版 UI（Material 3）：组件、无障碍钩子、状态配色工具
    - `ui/classic/` — 经典版 UI（可切换的备用界面）
    - `services/` — 服务层：数据读写、业务规则、存储降级（localStorage / Supabase）
    - `scripts/` — 测试与工具脚本（服务层测试、UI 逻辑测试、浏览器 E2E、变异检查）
    - `supabase/` — 云端建表脚本 `schema.sql`（含 RLS 策略）
    - `docs/` — 验收标准与判定记录、代码审查、经验沉淀
    - `public/` — 静态资源：PWA 图标、manifest、Service Worker `sw.js`
    - `.github/workflows/` — CI、GitHub Pages 部署、代码审查
    - `backup/` — 演示数据快照
    产生命令：`Get-ChildItem -Directory`
12. **依赖（运行时）**：react 18.2 · react-dom 18.2 · @supabase/supabase-js 2.116 · pinyin-pro 3.29
13. **依赖（开发）**：vite 8.2.2 · typescript 5.2 · tailwindcss 3.4 · @vitejs/plugin-react 6.1 · eslint 10.10 · typescript-eslint 8.70 · axe-core 4.13 · puppeteer-core 25.10 · esbuild 0.28
    产生命令：`node -e` 遍历 `dependencies`/`devDependencies`
14. **配置项 / 环境变量**（代码里真实读取）：
    - `VITE_SUPABASE_URL` — 可选。未设置时应用走 localStorage，功能完整度不变
    - `VITE_SUPABASE_ANON_KEY` — 可选。Supabase 的前端公开密钥，安全边界靠数据库 RLS
    - `BASE_URL` / `PROD` — 由 Vite 注入，非用户配置
    产生命令：`git grep -o -E 'import\.meta\.env\.[A-Z_]+'`；示例文件 `.env.example`
15. **仓库 / 默认分支 / 许可证**：https://github.com/ChenChen913/medicine-box ｜ `main` ｜ MIT（`LICENSE` 首行 `MIT License`）
    产生命令：`git remote get-url origin`、`git rev-parse --abbrev-ref HEAD`、读 `LICENSE`
16. **在线地址**：https://chenchen913.github.io/medicine-box/（HTTP 200 实测）
17. **CI**：`.github/workflows/ci.yml`，5 步：类型检查 → 单元测试 → ESLint → 构建 → 浏览器 E2E（E2E 依赖 runner 自带 Chrome）

## B. 只有老板知道的事实（2026-09-10 逐字确认）

1. **一句话描述 / 定位**：**求职作品集展示项目**（读者：面试官 / 技术评估者）
2. **为什么做**（老板原话，逐字引用）：
   > 家里有很多各种品类的药，时间长了，每个药都得看一下是否过期，每种药都要看的话就很麻烦。
   > 如果我把它做成一个线上的系统，就会很方便
3. **目标用户**：自己与家人（自用），同时作为技术作品对外展示
4. **与同类方案的差异**：老板于 2026-09-10 明确授权 AI 代写（原话「这个我不知道，你可以看着写」）。已按仓库可查事实写成「设计取舍」段落，不含任何未经核实的他方产品对比：不做账号体系、数据默认本地、补货清单由规则自动产生、双界面共用一套服务层。
5. **已知限制**（老板确认 2 条）：
   - 不做医疗建议（仅记录，不构成诊疗意见）
   - 不做用药提醒推送 / 闹钟
6. **已知限制**（仓库内可查、非老板口述，来源已注明）：
   - 数据默认存在本机浏览器，换设备不同步；云端同步代码已就绪但未配置账号（来源：`TODO.md`）
   - 多标签页并发写为 last-writer-wins（来源：`docs/EXPERIENCE.md` §10）
7. **演示素材**：老板提供两张真实截图 —— `docs/screenshot-desktop.png`（电脑端，131,779 字节）、`docs/screenshot-mobile.jpg`（手机端，409,647 字节）。已分别置于 README 首屏与「用法」节。
