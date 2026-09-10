import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './modern/components/ErrorBoundary';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// 直接挂载：不等待任何异步操作，首帧就绘制界面。
//
// 历史：这里曾有一段「空药箱自动载入演示数据」的临时代码，它把挂载放在 await 之后，
// 于是先绘制空壳、数据到位再一次性填充 —— 实测首屏 CLS 0.9（阈值 0.1）。
// 演示数据已于 2026-09-10 撤除（老板要真实使用），挂载同步回归最简单形态。
ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

// 空闲时预热"按需加载"的两个弹窗分块：
// 首次点开药品详情/备份弹窗时就不必等下载，也避免"加载中"占位一闪而过。
const prefetchDialogs = (): void => {
  void import('./modern/components/DetailDrawer');
  void import('./modern/components/DataBackup');
};
if ('requestIdleCallback' in window) {
  (window as Window & { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => void })
    .requestIdleCallback(prefetchDialogs, { timeout: 3000 });
} else {
  setTimeout(prefetchDialogs, 1500);
}

// 注册 Service Worker（仅生产构建）：提供离线外壳。
// 开发环境不注册，避免缓存干扰 Vite 的 HMR。
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(err => console.warn('[sw] Service Worker 注册失败（不影响正常使用）：', err));
  });
}
