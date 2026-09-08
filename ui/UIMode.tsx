/**
 * 文件名: ui/UIMode.tsx
 * 功能: 双 UI 模式切换的全局状态
 * 描述: 管理经典版（classic）与新设计版（modern）两套 UI 的切换。
 *       持久化策略：URL ?ui= 参数（最高优先级，便于分享/应急回退）
 *       > localStorage 记忆 > 默认 modern。
 *       两套 UI 共用数据层（services/types），仅视图层隔离，切换零数据迁移成本。
 */

import React, { createContext, useContext, useMemo, useState } from 'react';

export type UIMode = 'classic' | 'modern';

const STORAGE_KEY = 'mb:ui-mode';

function resolveInitialMode(): UIMode {
  // 1. URL 参数优先（?ui=classic 可随时强制回退，即使 localStorage 异常也能生效）
  try {
    const param = new URLSearchParams(window.location.search).get('ui');
    if (param === 'classic' || param === 'modern') return param;
  } catch { /* ignore */ }

  // 2. localStorage 用户上次的选择
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'classic' || saved === 'modern') return saved;
  } catch { /* ignore */ }

  // 3. 默认展示新版设计
  return 'modern';
}

interface UIModeContextValue {
  mode: UIMode;
  setMode: (m: UIMode) => void;
}

const UIModeContext = createContext<UIModeContextValue>({
  mode: 'modern',
  setMode: () => undefined,
});

export function UIModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<UIMode>(resolveInitialMode);

  const setMode = (m: UIMode) => {
    setModeState(m);
    try {
      localStorage.setItem(STORAGE_KEY, m);
    } catch { /* 存储失败不影响本次会话内切换 */ }
    // 同步 URL 参数（不触发刷新），保证刷新后仍停留在当前模式
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('ui', m);
      window.history.replaceState(null, '', url.toString());
    } catch { /* ignore */ }
  };

  const value = useMemo(() => ({ mode, setMode }), [mode]);

  return <UIModeContext.Provider value={value}>{children}</UIModeContext.Provider>;
}

export function useUIMode(): UIModeContextValue {
  return useContext(UIModeContext);
}
