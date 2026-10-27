# Cloudflare Pages 迁移记录

> 迁移日期：2026-10-27
> 依据：`CLOUDFLARE_MIGRATION_GUIDE.md`（从 GitHub 迁移到 Cloudflare 详细指南）
> 结论：**完成。Cloudflare Pages 作为主站，GitHub Pages 保留为备用入口；核心链路与 PWA 已在新 origin 验证通过。**

## 1. 项目信息

| 项 | 内容 |
| --- | --- |
| GitHub 仓库 | https://github.com/ChenChen913/medicine-box |
| 项目类型 | 纯静态 Vite + React SPA + PWA |
| 主站 | https://medicine-box.pages.dev |
| 备用站 | https://chenchen913.github.io/medicine-box/ |
| 构建命令 | `npm ci && npm run build` |
| 输出目录 | `dist` |
| 运行时 | Node 20（CI/构建）；Cloudflare 部署工作流使用 Node 22 |
| 数据存储 | 浏览器 localStorage（键名 `smart-medicine-box:db:v1`）；Supabase 分支未配置 |
| 服务端 / 文件存储 | 无服务端；本次未使用 R2、D1、KV |

## 2. 迁移策略

- Cloudflare Pages 承接主入口，GitHub Pages 继续保留，不删除仓库、Pages 工作流或旧地址。
- 代码源仍然是 GitHub；两个平台各自独立构建，互不修改同一份产物。
- 本项目没有后端与数据库，因此**不迁移后端数据**；R2 凭据未使用。
- 暂未绑定自定义域名，未修改 DNS；`pages.dev` 作为当前主入口。
- PWA 与 localStorage 按 origin 隔离：旧站数据不会自动带到新站，需要导出 JSON 后在新站导入。

## 3. Cloudflare 配置

| 项 | 配置 |
| --- | --- |
| Pages 项目名 | `medicine-box` |
| 生产分支 | `main` |
| Wrangler 版本 | `4.152.0`（CI 中通过 `npx` 固定版本） |
| 配置文件 | `wrangler.toml` |
| 响应头 | `public/_headers`（安全头 + 静态资源长缓存 + HTML/SW 不缓存） |
| 404 | `public/404.html`（自定义「页面未找到」，返回真实 404） |
| 自动部署 | `.github/workflows/cloudflare-pages.yml`，CI 通过后触发 |
| 本地部署 | `npm run deploy:cf`（Node 22+） |
| 仓库 Secrets | `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`（值不写入仓库） |

Vite 保持 `base: './'`，同一份构建产物同时适配 Cloudflare 根路径与 GitHub Pages 的 `/medicine-box/` 子路径。

## 4. 数据迁移

- localStorage 只属于当前 origin。GitHub Pages 与 `pages.dev` 是两个独立 origin，数据不互通。
- 迁移路径：旧站「数据备份与恢复」导出 JSON → 新站「数据备份与恢复」导入。
- 导入逻辑继续执行版本校验、逐字段清洗、图片协议白名单与非法日期过滤。
- Supabase 未配置；若未来启用，云端数据不受站点域名变化影响，但需先完成账号与 `user_id` 隔离。
- Service Worker 缓存和 PWA 安装同样按 origin 隔离，旧站与新站互不影响。

## 4.1 双站共享数据（Cloudflare D1 + Worker）

两个站点的 localStorage 天然隔离，因此新增了可选的 Cloudflare 同步通道：

| 项 | 配置 |
| --- | --- |
| Worker | `https://medicine-box-sync.maomaotech913.workers.dev` |
| 数据库 | D1 `medicine-box-db`，单表 `sync_states` |
| 数据模型 | 每个家庭同步密钥对应一行版本化 JSON 快照 |
| 密钥处理 | 前端只保存密钥原文；Worker 用 SHA-256 作为 `sync_id`，数据库不存原文 |
| 写入 | 在线时立即写 D1；`baseVersion` 乐观锁，冲突返回 409 并刷新最新数据 |
| 离线 | 只读本机镜像，禁止离线写入，避免两个 origin 各自修改后分叉 |
| 同步频率 | 每 10 秒轮询，窗口聚焦/恢复在线时立即拉取 |
| CORS | 仅允许 `medicine-box.pages.dev`、`*.medicine-box.pages.dev` 与 `chenchen913.github.io` |

使用方式：一个站点生成密钥并连接，复制密钥到另一个站点连接。密钥等同于家庭数据密码，不能公开分享；丢失密钥后无法再读取该云端空间，但本机镜像仍在。

## 5. 自动化部署记录

| 环节 | 结果 |
| --- | --- |
| GitHub Actions CI（run 40419768338） | 成功，3 分 33 秒；类型检查 / 265 断言 / ESLint / 构建 / 85 项 E2E 全过 |
| Cloudflare Pages 部署（run 40420170567） | 成功，27 秒；由 CI 成功后自动触发 |
| GitHub Pages 部署 | 成功；保留为备用入口 |
| 手动首次部署 | 成功；项目创建为 `medicine-box` |

## 6. 验收结果

| 检查项 | 结果 |
| --- | --- |
| 主站首页 | HTTP 200，标题「家庭药箱」，核心 UI 正常渲染 |
| 静态资源 | `assets/index-GKN-fGse.js`、`assets/index-DQ_k4eWe.css` 均 200 |
| 安全响应头 | `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy`、`Permissions-Policy` 生效 |
| 缓存 | `/assets/*` 为 `max-age=31536000, immutable`；`/sw.js` 为 `no-cache`；入口 HTML 为 `must-revalidate` |
| Manifest | 200，可解析，名称为「家庭药箱 · 家庭健康管家」 |
| Service Worker | 已注册并激活，scope 为 `https://medicine-box.pages.dev/` |
| 离线 | 断网后重载仍显示药箱外壳与「待入库」空态 |
| 核心写链路 | 入库测试药（库存 10）→ 打卡后库存 9 → 刷新后药品与库存仍在 |
| 自定义 404 | 未知路径返回 HTTP 404，显示「页面未找到」，不返回首页 |
| 控制台 | 主站加载无 error，无失败资源请求 |
| 备用站 | GitHub Pages 首页 200，控制台无 error，未知路径返回 404 |
| 本地回归 | 服务层 174 + UI 91 全过；浏览器 E2E 85/85；变异测试 5/5 |

## 7. 回滚方案

1. GitHub Pages 仍在运行，可直接作为只读备用入口。
2. Cloudflare Pages 控制台可回滚到上一个部署；本次迁移前后的部署均保留。
3. 未改 DNS，未绑定自定义域名，不存在域名切换回滚步骤。
4. 项目无服务端数据；用户数据仍在各自 origin 的 localStorage，回滚不影响本机数据。
5. 如需回到 GitHub Pages 作为主入口，只需更新 README 与分享链接，不需要改代码。

## 8. 安全与后续

- Cloudflare API Token 只存放在 GitHub Actions Secrets，未写入仓库或前端产物。
- R2 访问密钥本次未使用，未写入任何配置；如仅用于本次迁移，建议在 Cloudflare 控制台撤销。
- 建议在迁移完成后轮换一次 API Token，并同步更新 GitHub Secrets。
- 后续可绑定自定义域名并配置 canonical；绑定前保持 `pages.dev` 与 GitHub Pages 双入口。
- 建议观察 1~4 周，确认无 5xx、无资源 404、无 PWA 缓存异常后再考虑进一步收尾。
