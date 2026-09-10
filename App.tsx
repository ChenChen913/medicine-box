/**
 * 文件名: App.tsx
 * 功能: 应用入口（双 UI 薄壳）
 * 描述: 根据用户选择的 UI 模式渲染对应视图层：
 *       - ui/classic/ClassicApp.tsx  经典版（原版界面，原样保留，便于随时回退）
 *       - modern/ModernApp.tsx       新版设计（Material 3 风格改版）
 *       两套 UI 共享同一数据层（services/），切换界面不影响任何数据。
 *
 *       体积策略：经典版是"回退用"的备用界面，改为 React.lazy 按需加载，
 *       默认使用新版界面的用户不必为它付出首屏 JS 体积（此前两套 UI 都打进入口 chunk）。
 */

import { lazy, Suspense } from 'react';
import { UIModeProvider, useUIMode } from './ui/UIMode';
import ModernApp from './modern/ModernApp';

const ClassicApp = lazy(() => import('./ui/classic/ClassicApp'));

function UIShell() {
  const { mode } = useUIMode();
  // 切换按钮由各 UI 自行渲染（位置需适配各自的底部导航与弹层布局）
  if (mode === 'modern') return <ModernApp />;
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-sm text-m3-on-surface-variant">
          正在加载经典版界面…
        </div>
      }
    >
      <ClassicApp />
    </Suspense>
  );
}

function App() {
  return (
    <UIModeProvider>
      <UIShell />
    </UIModeProvider>
  );
}

export default App;
