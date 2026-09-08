/**
 * 文件名: App.tsx
 * 功能: 应用入口（双 UI 薄壳）
 * 描述: 根据用户选择的 UI 模式渲染对应视图层：
 *       - ui/classic/ClassicApp.tsx  经典版（原版界面，原样保留，便于随时回退）
 *       - modern/ModernApp.tsx       新版设计（Material 3 风格改版）
 *       两套 UI 共享同一数据层（services/），切换界面不影响任何数据。
 */

import { UIModeProvider, useUIMode } from './ui/UIMode';
import ClassicApp from './ui/classic/ClassicApp';
import ModernApp from './modern/ModernApp';

function UIShell() {
  const { mode } = useUIMode();
  // 切换按钮由各 UI 自行渲染（位置需适配各自的底部导航与弹层布局）
  return mode === 'modern' ? <ModernApp /> : <ClassicApp />;
}

function App() {
  return (
    <UIModeProvider>
      <UIShell />
    </UIModeProvider>
  );
}

export default App;
