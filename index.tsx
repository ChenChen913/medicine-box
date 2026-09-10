import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

/* ============================================================
 * 【临时功能 · 看完即撤】URL 加 ?demo=1 一键载入演示数据
 * 用途：让老板在真机/线上直接看到"有数据时"的完整界面效果。
 * 数据源：public/demo-backup.json（仓库 backup/ 目录里那份演示快照的副本，
 *         全部为虚构的演示数据，不含任何真实用药记录）。
 * 撤销方式：删掉本段代码 + public/demo-backup.json 即可。
 * ============================================================ */
async function loadDemoDataIfRequested(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  if (params.get('demo') !== '1') return;

  const { MedicineService } = await import('./services/medicineService');
  try {
    // 已有数据时先征求同意，避免一键覆盖老板自己录入的真实记录
    const existing = await MedicineService.getMedicines().catch(() => []);
    if (existing.length > 0) {
      const ok = window.confirm(
        '药箱里已有 ' + existing.length + ' 种药品，载入演示数据会【覆盖】它们。\n\n继续吗？（建议先导出备份）'
      );
      if (!ok) return;
    }

    const res = await fetch(import.meta.env.BASE_URL + 'demo-backup.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('演示数据文件拉取失败（HTTP ' + res.status + '）');

    const result = await MedicineService.importData(await res.text(), 'replace');
    // 关键：关掉"投产清空"一次性迁移开关。
    // 否则在从未打开过本应用的新设备上，首次读取数据会把刚导入的演示数据当成
    // 遗留的演示数据清空（services/medicineService.ts 的 resetForProduction）。
    try {
      localStorage.setItem('smart-medicine-box:prod-reset:v1', new Date().toISOString());
    } catch { /* 存储不可用时交给上层报错 */ }

    window.alert(
      '演示数据已载入 ✅\n\n药品 ' + result.medicines + ' 种 · 待补货 ' + result.shoppingList +
      ' 条 · 用药记录 ' + result.logs + ' 条\n\n看完后可在「数据备份与恢复 → 清空全部数据」里清空。'
    );
  } catch (e) {
    window.alert('演示数据载入失败：' + (e instanceof Error ? e.message : String(e)));
  }
}

// 先加载演示数据（如果需要），再挂载 React：保证界面首次读取时数据已经就位
loadDemoDataIfRequested().finally(() => {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
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
