/**
 * 文件名: ui/UISwitcher.tsx
 * 功能: 双 UI 浮动切换按钮
 * 描述: 渲染在两套 UI 中各自的位置上（fixed 悬浮），点击即可在
 *       classic / modern 之间即时切换，无需刷新。样式自带对比度，
 *       不依赖所在 UI 的设计体系。
 */

import React, { useState } from 'react';
import { useUIMode } from './UIMode';

interface Props {
  /**
   * 距视口底部的偏移（tailwind 类值）。
   * 移动端两套 UI 底部都有导航栏（classic 流内 / modern 悬浮），需要抬高避开；
   * 桌面端统一贴近右下角。
   */
  bottomClass?: string;
}

const UISwitcher: React.FC<Props> = ({ bottomClass = 'bottom-24' }) => {
  const { mode, setMode } = useUIMode();
  const [hintVisible, setHintVisible] = useState(false);

  const isModern = mode === 'modern';
  const target: 'classic' | 'modern' = isModern ? 'classic' : 'modern';

  return (
    <div
      className={`fixed ${bottomClass} right-3 md:right-6 z-[90] flex flex-col items-end gap-2`}
    >
      {hintVisible && (
        <div
          className="px-3 py-2 rounded-xl bg-slate-900/90 text-white text-xs leading-relaxed shadow-xl max-w-[220px]"
          role="tooltip"
        >
          {isModern
            ? '正在使用新版设计，点击可随时切回经典版'
            : '正在使用经典版界面，点击体验新版设计'}
        </div>
      )}
      <button
        type="button"
        onClick={() => setMode(target)}
        onMouseEnter={() => setHintVisible(true)}
        onMouseLeave={() => setHintVisible(false)}
        onFocus={() => setHintVisible(true)}
        onBlur={() => setHintVisible(false)}
        aria-label={isModern ? '切换到经典版界面' : '切换到新版界面'}
        className="group flex items-center gap-1.5 pl-3 pr-3.5 py-2 rounded-full bg-slate-900/85 hover:bg-slate-900 text-white text-xs font-semibold shadow-[0_6px_20px_rgba(0,0,0,0.25)] backdrop-blur-md active:scale-95 transition-all"
      >
        {/* 双向切换箭头 */}
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2}
            d="M8 7h11m0 0l-3.5-3.5M19 7l-3.5 3.5M16 17H5m0 0l3.5 3.5M5 17l3.5-3.5" />
        </svg>
        <span>{isModern ? '经典版' : '新版界面'}</span>
      </button>
    </div>
  );
};

export default UISwitcher;
