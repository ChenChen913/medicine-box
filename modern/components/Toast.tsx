/**
 * 文件名: modern/components/Toast.tsx
 * 功能: 新版 UI 的 toast 通知系统
 * 描述: 对应设计稿的 toast 微交互（桌面右上角 / 移动底部居中，
 *       深色胶囊 + 图标 + 自动消失）。通过 useToasts 在任意层级触发。
 */

import React, { useCallback, useRef, useState } from 'react';
import { Icon } from '../icons';

export interface ToastItem {
  id: number;
  message: string;
  tone: 'success' | 'warning';
}

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const showToast = useCallback((message: string, tone: 'success' | 'warning' = 'success') => {
    const id = ++seq.current;
    setToasts(prev => [...prev.slice(-2), { id, message, tone }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3400);
  }, []);

  return { toasts, showToast };
}

export const ToastStack: React.FC<{ toasts: ToastItem[] }> = ({ toasts }) => (
  <div className="fixed top-4 md:top-20 right-3 md:right-6 z-[95] flex flex-col gap-2 pointer-events-none max-w-[calc(100vw-1.5rem)] md:max-w-sm">
    {toasts.map(t => (
      <div
        key={t.id}
        role="status"
        className="pointer-events-auto bg-m3-inverse-surface text-m3-inverse-on-surface px-4 py-3 rounded-2xl shadow-xl flex items-center gap-2.5 animate-in fade-in slide-in-from-top-2 duration-300"
      >
        <Icon
          name={t.tone === 'success' ? 'check_circle' : 'warning'}
          className={`w-[18px] h-[18px] shrink-0 ${t.tone === 'success' ? 'text-m3-secondary-fixed-dim' : 'text-m3-tertiary-fixed-dim'}`}
        />
        <span className="text-[13px] leading-snug font-medium">{t.message}</span>
      </div>
    ))}
  </div>
);
