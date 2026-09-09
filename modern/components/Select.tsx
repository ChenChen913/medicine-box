/**
 * 文件名: modern/components/Select.tsx
 * 功能: Material 3 风格的自定义下拉选择组件（M3Select）
 * 描述: 替代原生 <select>（系统原生菜单样式简陋、各平台不一致、无法定制）：
 *       - 菜单通过 Portal + fixed 定位渲染到 body，不受弹窗 overflow-y-auto
 *         裁剪、移动端筛选条 overflow-x-auto 裁剪的影响
 *       - 下方空间不足自动上翻；贴近视口边缘自动收拢；滚动/缩放实时重定位
 *       - 完整键盘导航（↑↓/Home/End/Enter/Esc），选项高亮自动 scrollIntoView
 *       - 点击外部关闭；选中行主色 + 对勾；触发器箭头随开合旋转
 *       - 三种形态：field（表单输入框样式，可带选中项图标）/ pill（筛选胶囊
 *         样式，可带数量徽章）/ compact（窄宽度，如数量单位）
 */

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, IconName } from '../icons';

export interface SelectOption {
  value: string;
  label: string;
  /** 选项左侧图标（Material Symbols 命名，与 icons.tsx 一致） */
  icon?: IconName;
  /** 图标容器样式，如 "bg-gradient-to-br from-… to-… text-…"，原样透传 */
  iconWrap?: string;
  /** 选项次要说明（图标行下方小字） */
  desc?: string;
  /** 行尾附加徽章文字（如该存放位置的药品数量） */
  trailing?: string;
}

interface M3SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** field=表单输入样式（默认） pill=筛选胶囊样式 compact=窄触发器 */
  variant?: 'field' | 'pill' | 'compact';
  ariaLabel?: string;
  /** 追加到触发器上的类（宽度/布局微调） */
  className?: string;
  /** 菜单宽度：match=与触发器同宽（默认） auto=随内容自适应 */
  menuWidth?: 'match' | 'auto';
}

interface MenuPos { top: number; left: number; maxHeight: number; width: number | null }

export const M3Select: React.FC<M3SelectProps> = ({
  value, options, onChange, variant = 'field', ariaLabel, className = '', menuWidth = 'match',
}) => {
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const selected = options.find(o => o.value === value);

  /** 依据触发器矩形与菜单实际高度计算 fixed 定位（含上翻/限高/边缘收拢） */
  const place = useCallback(() => {
    const t = triggerRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const gap = 6, margin = 8;
    // scrollHeight = 菜单未限高时的完整内容高度
    const naturalH = menuRef.current?.scrollHeight || Math.min(options.length * 46 + 12, 320);
    const menuH = Math.min(naturalH, 320);
    const spaceBelow = vh - r.bottom - gap - margin;
    const spaceAbove = r.top - gap - margin;
    const dropUp = spaceBelow < Math.min(menuH, 200) && spaceAbove > spaceBelow;
    const maxHeight = Math.max(96, Math.min(320, dropUp ? spaceAbove : spaceBelow));
    const naturalW = menuWidth === 'auto' ? (menuRef.current?.offsetWidth || 200) : r.width;
    const left = Math.min(Math.max(margin, r.left), Math.max(margin, vw - naturalW - margin));
    setPos({
      top: dropUp ? r.top - gap - Math.min(menuH, maxHeight) : r.bottom + gap,
      left,
      maxHeight,
      width: menuWidth === 'match' ? r.width : null,
    });
  }, [options.length, menuWidth]);

  // 开合生命周期：打开时计算位置并监听滚动/缩放（capture 捕获弹窗内部滚动），关闭时清理。
  // resize/滚动可能伴随连续布局变化（弹窗 reflow 等），尾随两帧后再补一次定位保证最终对齐。
  const placeRaf = useRef<number[]>([]);
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const placeStable = () => {
      place();
      placeRaf.current.forEach(cancelAnimationFrame);
      placeRaf.current = [
        requestAnimationFrame(() => place()),
        requestAnimationFrame(() => requestAnimationFrame(() => place())),
      ];
    };
    place();
    window.addEventListener('resize', placeStable);
    window.addEventListener('scroll', placeStable, true);
    return () => {
      placeRaf.current.forEach(cancelAnimationFrame);
      window.removeEventListener('resize', placeStable);
      window.removeEventListener('scroll', placeStable, true);
    };
  }, [open, place]);

  // 高亮项滚动到可视区
  useEffect(() => {
    if (!open || focusIdx < 0) return;
    menuRef.current?.querySelector<HTMLElement>(`[data-idx="${focusIdx}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [focusIdx, open]);

  // 外点 / 全局 Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (o: SelectOption) => {
    onChange(o.value);
    setOpen(false);
  };

  // 键盘交互全部在触发器上处理（焦点不移入菜单，符合 ARIA combobox 模式）：
  // 关闭时 ↑↓/Enter/空格 打开；打开时 ↑↓/Home/End 移动高亮、Enter/空格 选中、Tab/Esc 关闭
  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpen(true);
        setFocusIdx(Math.max(0, options.findIndex(o => o.value === value)));
      }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocusIdx(i => Math.min(options.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocusIdx(i => Math.max(0, i - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setFocusIdx(0); }
    else if (e.key === 'End') { e.preventDefault(); setFocusIdx(options.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (focusIdx >= 0 && options[focusIdx]) pick(options[focusIdx]); }
    else if (e.key === 'Tab') { setOpen(false); }
  };

  const chevron = (size: string) => (
    <Icon name="expand_more" className={`${size} text-m3-outline shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
  );

  // 鼠标点击开合：打开时同步高亮当前选中项
  const toggle = () => {
    if (!open) setFocusIdx(Math.max(0, options.findIndex(o => o.value === value)));
    setOpen(o => !o);
  };

  // ---------- 触发器 ----------
  const ariaProps = {
    'aria-haspopup': 'listbox' as const,
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
    'aria-activedescendant': open && focusIdx >= 0 ? `${menuId}-opt-${focusIdx}` : undefined,
  };
  let trigger: React.ReactNode;
  if (variant === 'pill') {
    trigger = (
      <button
        type="button" ref={triggerRef} {...ariaProps} aria-label={ariaLabel}
        onClick={toggle} onKeyDown={onTriggerKey}
        className={`shrink-0 pl-3 pr-2 py-2 rounded-full text-xs font-medium flex items-center gap-1.5 cursor-pointer select-none whitespace-nowrap outline-none transition-colors ${
          open
            ? 'bg-m3-surface-container-low ring-1 ring-m3-outline-variant text-m3-on-surface'
            : 'bg-m3-surface-container-lowest hover:bg-m3-surface-container-low text-m3-on-surface-variant'
        } focus-visible:ring-2 focus-visible:ring-m3-primary/40 ${className}`}
      >
        {selected?.icon && <Icon name={selected.icon} className="w-3.5 h-3.5 text-m3-primary shrink-0" />}
        <span className="max-w-[168px] truncate">{selected?.label ?? ''}</span>
        {selected?.trailing && (
          <span className="px-1.5 py-0.5 rounded-full bg-m3-surface-container text-[11px] text-m3-on-surface-variant font-semibold">{selected.trailing}</span>
        )}
        {chevron('w-4 h-4')}
      </button>
    );
  } else {
    const isCompact = variant === 'compact';
    trigger = (
      <button
        type="button" ref={triggerRef} {...ariaProps} aria-label={ariaLabel}
        onClick={toggle} onKeyDown={onTriggerKey}
        className={`h-11 rounded-xl bg-m3-surface-container-low hover:bg-m3-surface-container text-sm text-m3-on-surface outline-none focus-visible:ring-2 focus-visible:ring-m3-primary/40 transition-all flex items-center gap-1 cursor-pointer select-none ${isCompact ? 'pl-2.5 pr-1.5' : 'pl-3.5 pr-2 w-full'} ${open ? 'ring-2 ring-m3-primary/30' : ''} ${className}`}
      >
        {selected?.icon && !isCompact && (
          <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${selected.iconWrap ?? ''}`}>
            <Icon name={selected.icon} className="w-4 h-4" />
          </span>
        )}
        <span className={`flex-1 min-w-0 truncate ${isCompact ? 'text-center font-semibold' : 'text-left pl-0.5'}`}>{selected?.label ?? ''}</span>
        {chevron(isCompact ? 'w-4 h-4' : 'w-5 h-5')}
      </button>
    );
  }

  // ---------- 菜单（Portal + fixed；焦点留在触发器，菜单为纯视觉层） ----------
  const menu = open && createPortal(
    <div
      ref={menuRef}
      id={menuId}
      role="listbox"
      aria-label={ariaLabel}
      onMouseDown={e => e.preventDefault()}
      style={{
        position: 'fixed',
        top: pos ? pos.top : -9999,
        left: pos ? pos.left : -9999,
        maxHeight: pos ? pos.maxHeight : 320,
        width: pos?.width ? `${pos.width}px` : undefined,
        visibility: pos ? 'visible' : 'hidden',
      }}
      className={`z-[80] bg-m3-surface-container-lowest rounded-2xl shadow-[0_18px_50px_-12px_rgba(0,0,0,0.28)] border border-m3-outline-variant/50 py-1.5 overflow-y-auto overscroll-contain outline-none animate-in fade-in zoom-in-95 duration-150 ${menuWidth === 'auto' ? 'w-max max-w-[calc(100vw-16px)]' : ''} ${pos?.top !== null && pos && pos.top > window.innerHeight / 2 ? 'origin-bottom' : 'origin-top'}`}
    >
      {options.map((o, i) => {
        const active = i === focusIdx;
        const isSel = o.value === value;
        return (
          <div
            key={o.value}
            id={`${menuId}-opt-${i}`}
            data-idx={i}
            role="option"
            aria-selected={isSel}
            onClick={() => pick(o)}
            onMouseEnter={() => setFocusIdx(i)}
            className={`flex items-center gap-2.5 mx-1.5 px-2.5 py-2 rounded-xl cursor-pointer transition-colors ${active ? 'bg-m3-surface-container-low' : ''}`}
          >
            {o.icon && (
              <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${o.iconWrap ?? ''}`}>
                <Icon name={o.icon} className="w-[18px] h-[18px]" />
              </span>
            )}
            <span className="flex-1 min-w-0">
              <span className={`block text-sm leading-5 truncate ${isSel ? 'font-semibold text-m3-primary' : 'text-m3-on-surface'}`}>{o.label}</span>
              {o.desc && <span className="block text-[11px] text-m3-on-surface-variant truncate mt-0.5">{o.desc}</span>}
            </span>
            {o.trailing && (
              <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-m3-surface-container text-[11px] text-m3-on-surface-variant font-semibold">{o.trailing}</span>
            )}
            {isSel && <Icon name="check" className="w-[18px] h-[18px] text-m3-primary shrink-0" />}
          </div>
        );
      })}
    </div>,
    document.body
  );

  return (
    <>
      {trigger}
      {menu}
    </>
  );
};
