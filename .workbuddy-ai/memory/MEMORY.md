# 项目长期记忆

## 家庭智慧药箱 (smart-medicine-box)

### 技术栈
- React 18 + Vite 5 + TypeScript (strict)
- TailwindCSS CDN（未编译）
- 前端 SPA，无路由

### 部署方式
- GitHub Actions → GitHub Pages（免费）
- Vite `base: './'` 保证在任意子路径正常加载

### 数据持久化
- **首选**：Supabase（Postgres + RLS）
- **降级**：浏览器 localStorage（未配置 Supabase 环境变量时自动降级）
- 不再依赖任何本地后端 / Express 服务

### 环境变量
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### 仓库
- https://github.com/ChenChen913/smart-medicine-box
