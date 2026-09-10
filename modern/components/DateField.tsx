import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons';
import { useDialogA11y } from '../useDialogA11y';

/**
 * 文件名: modern/components/DateField.tsx
 * 功能: 日期选择器（独立弹层版）
 *
 * 设计取舍（老板 2026-09-10 两轮反馈后的结论）：
 *   - 第 1 版用原生 <input type="date">：手机上年份入口极隐蔽，只能一个月一个月翻；
 *   - 第 2 版做成表单内的内联浮层：虽然能一键跳年，但在表单里撐开一块，
 *     面板被弹窗裁剪、还要往下滚动才能看全 —— 反而更复杂；
 *   - 现在：**独立弹层**（手机底部抽屉 / 桌面居中卡片），
 *     用 createPortal 挂到 document.body，完全脱离表单布局：
 *     · 不占表单高度、不需要滚动就能看全；
 *     · 不会被父级 overflow / transform 裁剪或错位；
 *     · 自带焦点管理（打开移入、Tab 锁定、关闭归位）与 Esc / 点遮罩关闭。
 *   日历本身保留"点年→年份网格、点月→月份网格"的快速跳转能力。
 */

interface Props {
  value: string;                 // 'YYYY-MM-DD'，空串表示未设置
  onChange: (v: string) => void;
  ariaLabel: string;
  className?: string;            // 触发按钮样式（与表单其它输入框保持一致）
  placeholder?: string;
}

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const pad = (n: number): string => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number): string => y + '-' + pad(m) + '-' + pad(d);
const daysInMonth = (y: number, m: number): number => new Date(y, m, 0).getDate();

/** 独立弹层本体：只在打开时挂载，因此直接传 open=true 给焦点钩子 */
const PickerDialog: React.FC<{
  ariaLabel: string;
  initial: { y: number; m: number; d: number | null };
  today: { y: number; m: number; d: number };
  onPick: (iso: string) => void;
  onClear: () => void;
  onClose: () => void;
}> = ({ ariaLabel, initial, today, onPick, onClear, onClose }) => {
  const panelRef = useDialogA11y<HTMLDivElement>();
  const [view, setView] = useState({ y: initial.y, m: initial.m });
  const [showYears, setShowYears] = useState(false);
  const [showMonths, setShowMonths] = useState(false);
  const [pageStart, setPageStart] = useState(() => Math.floor((initial.y - 1) / 12) * 12 + 1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const shiftMonth = (delta: number): void => {
    setView(v => {
      const idx = v.y * 12 + (v.m - 1) + delta;
      return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
    });
  };

  const firstWeekday = new Date(view.y, view.m - 1, 1).getDay();
  const total = daysInMonth(view.y, view.m);
  // 固定 6 行（42 格）：不同月份占 4~6 行，若按实际行数渲染，切月时弹层高度会跳
  // （老板反馈："从 9 月切到 10 月，日期矩阵多一行，选择框就变大一点"）。
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ];
  while (cells.length < 42) cells.push(null);
  const isSelected = (d: number): boolean => initial.y === view.y && initial.m === view.m && initial.d === d;

  return createPortal(
    // 手机底部抽屉 / 桌面居中卡片；z-index 高于普通弹窗（70）与遮罩
    <div className="fixed inset-0 z-[95] flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-m3-on-surface/40 animate-in fade-in duration-150" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel + '（选择日期）'}
        className="relative w-full sm:w-[340px] max-h-[86vh] overflow-y-auto overscroll-contain outline-none bg-m3-surface-container-lowest rounded-t-3xl sm:rounded-3xl shadow-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200"
      >
        {/* 手机端拖拽指示条 */}
        <div className="sm:hidden flex justify-center pb-2" aria-hidden="true">
          <span className="w-10 h-1 rounded-full bg-m3-outline-variant/60" />
        </div>

        <div className="flex items-center justify-between gap-1 mb-2">
          <button type="button" aria-label="上一页"
            onClick={() => (showYears ? setPageStart(p => p - 12) : showMonths ? setView(v => ({ ...v, y: v.y - 1 })) : shiftMonth(-1))}
            className="w-9 h-9 rounded-full hover:bg-m3-surface-container text-m3-on-surface-variant flex items-center justify-center">
            <Icon name="chevron_left" className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-1">
            <button type="button" aria-label="选择年份" onClick={() => { setShowYears(true); setShowMonths(false); }}
              className={`px-2.5 h-9 rounded-lg text-sm font-bold ${showYears ? 'bg-m3-primary text-m3-on-primary' : 'text-m3-on-surface hover:bg-m3-surface-container'}`}>
              {showYears ? (pageStart + ' - ' + (pageStart + 11) + '年') : (view.y + '年')}
            </button>
            {!showYears && (
              <button type="button" aria-label="选择月份" onClick={() => { setShowMonths(true); setShowYears(false); }}
                className={`px-2.5 h-9 rounded-lg text-sm font-bold ${showMonths ? 'bg-m3-primary text-m3-on-primary' : 'text-m3-on-surface hover:bg-m3-surface-container'}`}>
                {view.m + '月'}
              </button>
            )}
          </div>
          <button type="button" aria-label="下一页"
            onClick={() => (showYears ? setPageStart(p => p + 12) : showMonths ? setView(v => ({ ...v, y: v.y + 1 })) : shiftMonth(1))}
            className="w-9 h-9 rounded-full hover:bg-m3-surface-container text-m3-on-surface-variant flex items-center justify-center">
            <Icon name="chevron_right" className="w-5 h-5" />
          </button>
          <button type="button" aria-label="关闭日期选择" onClick={onClose}
            className="ml-1 w-9 h-9 rounded-full hover:bg-m3-surface-container text-m3-on-surface-variant flex items-center justify-center">
            <Icon name="close" className="w-[18px] h-[18px]" />
          </button>
        </div>

        {/* 内容区固定高度：日期视图 = 星期行(28) + 6 行日期(6×40) + 行间距(5×4) + 间距(4) = 292px；
            年月视图放进同样高度的盒子里居中，这样在"日 / 月 / 年"三种视图之间切换也不会跳高度 */}
        <div className="h-[292px]">
        {showYears ? (
          <div className="h-full flex items-center">
            <div className="w-full grid grid-cols-4 gap-1">
              {Array.from({ length: 12 }, (_, i) => pageStart + i).map(y => (
                <button key={y} type="button" onClick={() => { setView(v => ({ ...v, y })); setShowYears(false); }}
                  className={`h-12 rounded-xl text-sm font-semibold ${y === view.y ? 'bg-m3-primary text-m3-on-primary' : 'hover:bg-m3-surface-container text-m3-on-surface'}`}>
                  {y}
                </button>
              ))}
            </div>
          </div>
        ) : showMonths ? (
          <div className="h-full flex items-center">
            <div className="w-full grid grid-cols-4 gap-1">
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <button key={m} type="button" onClick={() => { setView(v => ({ ...v, m })); setShowMonths(false); }}
                  className={`h-12 rounded-xl text-sm font-semibold ${m === view.m ? 'bg-m3-primary text-m3-on-primary' : 'hover:bg-m3-surface-container text-m3-on-surface'}`}>
                  {m}月
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-7 gap-1 mb-1">
              {WEEK.map(w => <span key={w} className="h-7 flex items-center justify-center text-[11px] text-m3-on-surface-variant">{w}</span>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((d, i) => d === null ? <span key={'e' + i} /> : (
                <button key={d} type="button" onClick={() => onPick(ymd(view.y, view.m, d))} aria-label={ymd(view.y, view.m, d)}
                  className={`h-10 rounded-xl text-sm font-semibold transition-colors ${
                    isSelected(d)
                      ? 'bg-m3-primary text-m3-on-primary'
                      : (today.y === view.y && today.m === view.m && today.d === d)
                        ? 'ring-1 ring-m3-primary/50 text-m3-primary hover:bg-m3-primary/10'
                        : 'hover:bg-m3-surface-container text-m3-on-surface'
                  }`}>
                  {d}
                </button>
              ))}
            </div>
          </>
        )}
        </div>

        <div className="flex items-center justify-between mt-3 pt-3 border-t border-m3-surface-container-low">
          <button type="button" onClick={() => onPick(ymd(today.y, today.m, today.d))}
            className="px-4 h-10 rounded-xl text-sm font-semibold text-m3-primary hover:bg-m3-primary/10">今天</button>
          <button type="button" onClick={onClear}
            className="px-4 h-10 rounded-xl text-sm font-semibold text-m3-on-surface-variant hover:bg-m3-surface-container">清除</button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export const DateField: React.FC<Props> = ({ value, onChange, ariaLabel, className, placeholder = '选择日期' }) => {
  const [open, setOpen] = useState(false);
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.test(value) ? value.split('-').map(Number) : null;
  const today = useMemo(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  }, []);
  const label = parsed ? parsed[0] + '年' + parsed[1] + '月' + parsed[2] + '日' : '';
  const initial = { y: parsed ? parsed[0] : today.y, m: parsed ? parsed[1] : today.m, d: parsed ? parsed[2] : null };

  return (
    <>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={className ?? 'h-11 w-full px-4 rounded-xl bg-m3-surface-container-low text-m3-on-surface text-left outline-none focus:ring-2 focus:ring-m3-primary/30 transition-all'}
      >
        <span className={label ? '' : 'text-m3-outline'}>{label || placeholder}</span>
      </button>

      {open && (
        <PickerDialog
          ariaLabel={ariaLabel}
          initial={initial}
          today={today}
          onPick={v => { onChange(v); setOpen(false); }}
          onClear={() => { onChange(''); setOpen(false); }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
};
