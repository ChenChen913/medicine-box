import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../icons';

/**
 * 文件名: modern/components/DateField.tsx
 * 功能: 自定义日期选择器（替代原生 <input type="date">）
 *
 * 为什么不用原生：手机上原生日期控件的"年份"入口非常隐蔽，用户只能一个月一个月地翻，
 * 选一个 2028 年的日期要点十几次（老板真实反馈）。这里改成：
 *   - 点顶部的「年」→ 弹出年份网格，12 年一屏，左右翻页，一键跳到目标年；
 *   - 点顶部的「月」→ 弹出月份网格，一键跳月；
 *   - 日期网格按周排布，今天/已选高亮；
 *   - 底部提供「今天」「清除」。
 * 交互上仍是标准按钮，键盘 Tab 可完整操作；Esc / 点外面关闭。
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

export const DateField: React.FC<Props> = ({ value, onChange, ariaLabel, className, placeholder = '选择日期' }) => {
  const [open, setOpen] = useState(false);
  const [showYears, setShowYears] = useState(false);
  const [showMonths, setShowMonths] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.test(value) ? value.split('-').map(Number) : null;
  const today = useMemo(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  }, []);
  const [view, setView] = useState(() => ({
    y: parsed ? parsed[0] : today.y,
    m: parsed ? parsed[1] : today.m,
  }));
  // 年份网格当前页的起始年（12 年一屏）
  const [pageStart, setPageStart] = useState(() => {
    const base = parsed ? parsed[0] : today.y;
    return Math.floor((base - 1) / 12) * 12 + 1;
  });

  // 打开时把视图定位到已选值（或今天）
  useEffect(() => {
    if (!open) return;
    const base = parsed ? { y: parsed[0], m: parsed[1] } : { y: today.y, m: today.m };
    setView(base);
    setPageStart(Math.floor((base.y - 1) / 12) * 12 + 1);
    setShowYears(false);
    setShowMonths(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // 点外部 / Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const shiftMonth = (delta: number): void => {
    setView(v => {
      const idx = (v.y * 12 + (v.m - 1)) + delta;
      return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
    });
  };

  const pick = (d: number): void => {
    onChange(ymd(view.y, view.m, d));
    setOpen(false);
  };

  const label = parsed ? parsed[0] + '年' + parsed[1] + '月' + parsed[2] + '日' : '';

  // 当月第一天是周几 + 当月天数 → 生成日期网格
  const firstWeekday = new Date(view.y, view.m - 1, 1).getDay();
  const total = daysInMonth(view.y, view.m);
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ];

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className={className ?? 'h-11 w-full px-4 rounded-xl bg-m3-surface-container-low text-m3-on-surface text-left outline-none focus:ring-2 focus:ring-m3-primary/30 transition-all'}
      >
        <span className={label ? '' : 'text-m3-outline'}>{label || placeholder}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={ariaLabel + '选择器'}
          className="absolute left-0 top-[calc(100%+6px)] z-[80] w-[300px] max-w-[86vw] rounded-2xl bg-m3-surface-container-lowest shadow-2xl border border-m3-surface-container-low p-3"
        >
          {/* 顶部导航：‹ 年 月 › */}
          <div className="flex items-center justify-between gap-1 mb-2">
            <button type="button" aria-label="上一页" onClick={() => (showYears ? setPageStart(p => p - 12) : showMonths ? setView(v => ({ ...v, y: v.y - 1 })) : shiftMonth(-1))}
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
            <button type="button" aria-label="下一页" onClick={() => (showYears ? setPageStart(p => p + 12) : showMonths ? setView(v => ({ ...v, y: v.y + 1 })) : shiftMonth(1))}
              className="w-9 h-9 rounded-full hover:bg-m3-surface-container text-m3-on-surface-variant flex items-center justify-center">
              <Icon name="chevron_right" className="w-5 h-5" />
            </button>
          </div>

          {showYears ? (
            <div className="grid grid-cols-4 gap-1">
              {Array.from({ length: 12 }, (_, i) => pageStart + i).map(y => (
                <button key={y} type="button"
                  onClick={() => { setView(v => ({ ...v, y })); setShowYears(false); }}
                  className={`h-10 rounded-lg text-sm font-semibold ${y === view.y ? 'bg-m3-primary text-m3-on-primary' : 'hover:bg-m3-surface-container text-m3-on-surface'}`}>
                  {y}
                </button>
              ))}
            </div>
          ) : showMonths ? (
            <div className="grid grid-cols-4 gap-1">
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <button key={m} type="button"
                  onClick={() => { setView(v => ({ ...v, m })); setShowMonths(false); }}
                  className={`h-10 rounded-lg text-sm font-semibold ${m === view.m ? 'bg-m3-primary text-m3-on-primary' : 'hover:bg-m3-surface-container text-m3-on-surface'}`}>
                  {m}月
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-7 gap-1 mb-1">
                {WEEK.map(w => <span key={w} className="h-7 flex items-center justify-center text-[11px] text-m3-on-surface-variant">{w}</span>)}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {cells.map((d, i) => d === null ? <span key={'e' + i} /> : (
                  <button key={d} type="button" onClick={() => pick(d)}
                    aria-label={ymd(view.y, view.m, d)}
                    className={`h-9 rounded-lg text-sm font-semibold transition-colors ${
                      parsed && parsed[0] === view.y && parsed[1] === view.m && parsed[2] === d
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

          <div className="flex items-center justify-between mt-2 pt-2 border-t border-m3-surface-container-low">
            <button type="button" onClick={() => { onChange(ymd(today.y, today.m, today.d)); setOpen(false); }}
              className="px-3 h-9 rounded-lg text-xs font-semibold text-m3-primary hover:bg-m3-primary/10">今天</button>
            <button type="button" onClick={() => { onChange(''); setOpen(false); }}
              className="px-3 h-9 rounded-lg text-xs font-semibold text-m3-on-surface-variant hover:bg-m3-surface-container">清除</button>
          </div>
        </div>
      )}
    </div>
  );
};
