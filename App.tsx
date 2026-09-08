/**
 * 文件名: App.tsx
 * 功能: 应用入口（双 UI 薄壳）
 * 描述: 根据用户选择的 UI 模式渲染对应视图层：
 *       - ui/classic/ClassicApp.tsx  经典版（原版界面，原样保留，便于随时回退）
 *       - modern/ModernApp.tsx       新版设计（Material 3 风格改版）
 *       两套 UI 共享同一数据层（services/），切换界面不影响任何数据。
 */

import { UIModeProvider, useUIMode } from './ui/UIMode';
import UISwitcher from './ui/UISwitcher';
import ClassicApp from './ui/classic/ClassicApp';
import ModernApp from './modern/ModernApp';

function UIShell() {
  const { mode } = useUIMode();
  return (
    <>
      {mode === 'modern' ? <ModernApp /> : <ClassicApp />}
      {/* 切换入口统一渲染，保证两套 UI 下都能一键互切。
          bottom-24 同时避开 classic 移动端流内导航与 modern 移动端悬浮导航 */}
      <UISwitcher bottomClass="bottom-24 md:bottom-6" />
    </>
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
