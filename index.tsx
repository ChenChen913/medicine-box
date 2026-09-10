import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './modern/components/ErrorBoundary';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

/* ============================================================
 * 【临时功能 · 看完即撤】演示数据自动载入
 * 规则：
 *   1. 药箱是空的 → 自动载入演示数据（打开网址就能看到界面效果，无需任何参数）；
 *   2. 药箱里已有数据 → 一律不动（保护真实记录）；
 *   3. URL 加 ?demo=1 → 强制重新载入（已有数据时会先弹确认）。
 * 数据源：public/demo-backup.json（仓库 backup/ 里那份演示快照的副本，
 *         全部为虚构数据，不含任何真实用药记录）。
 * 撤销方式：删除本段 + public/demo-backup.json，并把下面的挂载改回直接 render。
 * ============================================================ */
const DEMO_FLAG = 'smart-medicine-box:prod-reset:v1'; // 投产清空标记，必须同步写上（见下）
const DEMO_SOURCE = 'demo-backup.json';

async function loadDemoDataIfNeeded(): Promise<void> {
  const force = new URLSearchParams(window.location.search).get('demo') === '1';

  const { MedicineService } = await import('./services/medicineService');

  let existing: unknown[];
  try {
    existing = await MedicineService.getMedicines();
  } catch (e) {
    // ⚠️ 关键：读取失败（存储损坏 / 不可用）绝不能当成"空药箱"。
    // 否则这里会用演示数据 replace 掉用户真实（但暂时读不出来）的数据 ——
    // 与「读失败绝不覆盖现有数据」的铁律直接冲突，e2e 的 G3.4 就抓到了这一点。
    console.info('[demo] 数据读取失败，跳过演示数据载入：', e instanceof Error ? e.message : e);
    return;
  }

  if (existing.length > 0) {  // 类型：getMedicines 返回 Medicine[]
    if (!force) return; // 有数据且非强制 → 绝不打扰
    const ok = window.confirm(
      '药箱里已有 ' + existing.length + ' 种药品，重新载入演示数据会【覆盖】它们。\n\n继续吗？（建议先导出备份）'
    );
    if (!ok) return;
  }

  const res = await fetch(import.meta.env.BASE_URL + DEMO_SOURCE, { cache: 'no-store' });
  if (!res.ok) throw new Error('演示数据文件拉取失败（HTTP ' + res.status + '）');

  const result = await MedicineService.importData(await res.text(), 'replace');

  // 关键：补写"投产清空"一次性迁移标记。
  // 否则在从未打开过本应用的新设备上，首次读取数据会把刚导入的演示数据当遗留数据清空
  // （services/medicineService.ts 的 resetForProduction）。
  try {
    localStorage.setItem(DEMO_FLAG, new Date().toISOString());
  } catch { /* 存储不可用时由导入流程自己报错 */ }

  if (force) {
    window.alert(
      '演示数据已载入 ✅\n\n药品 ' + result.medicines + ' 种 · 待补货 ' + result.shoppingList +
      ' 条 · 用药记录 ' + result.logs + ' 条\n\n看完后可在「数据备份与恢复 → 清空全部数据」里清空。'
    );
  }
}

// 先准备数据再挂载 React，保证界面首次读取时数据已经就位。
//
// ⚠️ 必须限时：这个 await 在渲染之前，手机弱网下如果请求一直挂着，
// 页面就会永远白屏（真实事故：老板在手机上遇到过一次）。超过 2.5 秒就先渲染，
// 数据在后台继续载入，下次打开即可看到。
const DEMO_LOAD_TIMEOUT_MS = 2500;
Promise.race([
  loadDemoDataIfNeeded(),
  new Promise<void>(resolve => setTimeout(resolve, DEMO_LOAD_TIMEOUT_MS)),
])
  .catch(e => {
    // 自动载入失败不该打断应用（离线、文件缺失等），仅记录
    console.info('[demo] 演示数据未载入：', e instanceof Error ? e.message : e);
  })
  .finally(() => {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </React.StrictMode>
    );
  });

// 注册 Service Worker（仅生产构建）：提供离线外壳。
// 开发环境不注册，避免缓存干扰 Vite 的 HMR。
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(err => console.warn('[sw] Service Worker 注册失败（不影响正常使用）：', err));
  });
}