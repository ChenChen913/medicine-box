import { useEffect, useRef } from 'react';

/** 表单控件（打开弹窗时要优先聚焦的目标） */
const FORM_CONTROL = [
  'input:not([disabled]):not([type="hidden"]):not([type="file"])', // 文件框不计入：聚焦它肉眼不可见
  'select:not([disabled])',
  'textarea:not([disabled])',
].join(', ');

/** 可聚焦元素选择器（与 WAI-ARIA 对话框模式一致） */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * 已挂载弹窗栈：只有最上层弹窗接管 Tab 循环。
 * 详情抽屉与服药确认弹窗会同时存在，若两个都抢焦点会互相打架。
 */
const openPanels: HTMLElement[] = [];

/**
 * 弹窗无障碍钩子：打开时把焦点移入弹窗、Tab/Shift+Tab 循环锁定在弹窗内、关闭后焦点归位。
 *
 * 只负责焦点，不负责 Escape —— 各弹窗的 Esc 语义在 ModernApp / ClassicApp 里逐层定义
 * （编辑表单刻意不响应 Esc，避免误触丢失正在填写的内容）。
 */
export function useDialogA11y<T extends HTMLElement>(open: boolean = true) {
  const panelRef = useRef<T | null>(null);

  useEffect(() => {
    if (!open) return; // 条件渲染的弹窗（如经典版页内弹窗）用 open 开关驱动
    const panel = panelRef.current;
    if (!panel) return;
    const restoreTo = (document.activeElement as HTMLElement | null) ?? null;
    openPanels.push(panel);

    const focusables = (): HTMLElement[] =>
      Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter(el => el.getClientRects().length > 0);

    // 打开即把焦点移入弹窗，且**优先落在第一个输入框**而不是头部的关闭按钮：
    //   - 用户点开「入库新药/购入登记」本意就是填表，焦点直接进输入框才顺手；
    //   - 弹窗内没有表单控件时（详情抽屉、备份弹窗）才退回容器本身，
    //     让读屏先读出对话框标题，再按 Tab 进入控件。
    // （此前直接取"第一个可聚焦元素"，而 DOM 里排在最前的是关闭按钮 ——
    //   表现为"点了入库新药，焦点没进输入框"，老板 2026-09-10 反馈）
    const firstControl = Array.from(panel.querySelectorAll<HTMLElement>(FORM_CONTROL))
      .find(el => el.getClientRects().length > 0);
    const autoFocusEl = Array.from(panel.querySelectorAll<HTMLElement>('[autofocus], [data-autofocus]'))
      .find(el => el.getClientRects().length > 0);
    const initialTarget = autoFocusEl ?? firstControl ?? panel;
    initialTarget.focus({ preventScroll: true });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (openPanels[openPanels.length - 1] !== panel) return; // 只让最上层弹窗接管
      const items = focusables();
      if (!items.length) {
        e.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      // 焦点跑到弹窗外（含从未进入的情况）→ 拉回弹窗内
      if (!active || !panel.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? lastEl : firstEl).focus({ preventScroll: true });
        return;
      }
      if (e.shiftKey && active === firstEl) {
        e.preventDefault();
        lastEl.focus({ preventScroll: true });
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault();
        firstEl.focus({ preventScroll: true });
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const idx = openPanels.indexOf(panel);
      if (idx !== -1) openPanels.splice(idx, 1);
      // 关闭后焦点归位到打开前的元素（元素已不在文档里则忽略）
      if (restoreTo && document.contains(restoreTo)) restoreTo.focus({ preventScroll: true });
    };
  }, [open]);

  return panelRef;
}
