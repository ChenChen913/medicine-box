/**
 * 文件名: modern/ModernApp.tsx
 * 功能: 新版 UI 主容器
 * 描述: 基于设计稿（电脑端.html / 手机端.html）适配真实数据层的完整实现：
 *       - 桌面（lg+）：固定顶栏 + 储药指数横幅 + 4 指标卡 + 提示条 +
 *         搜索过滤 + 分类三列卡片 + 右侧详情抽屉
 *       - 移动（<lg）：头部（Logo + 用药记录入口）+ 健康概览 2x2 四格 +
 *         搜索联想下拉 + 分类列表（含轻量物资双列小卡）+ 悬浮底部导航（3 位：药箱/FAB/补货）
 *       数据层与经典版完全共享（MedicineService），任何操作实时同步。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Medicine, ShoppingItem, UsageLog, ShoppingStatus } from '../types';
import { MedicineService } from '../services/medicineService';
import { getHealthOverview } from './ui';
import { Icon } from './icons';
import UISwitcher from '../ui/UISwitcher';
import { useToasts, ToastStack } from './components/Toast';
import { ConsumeDialog, DeleteDialog, MedicineForm } from './components/Dialogs';
// Tab 视图是核心导航（底部导航栏直达），必须随首屏一起加载：
// 之前拆成按需加载，弱网下点「需补货」要等分块下载才出内容（老板反馈"加载很长时间"）。
import { RestockView, LogsView } from './components/Views';
import { ErrorBoundary } from './components/ErrorBoundary';
import { lazyWithRetry } from './lazyWithRetry';

// 只有"交互后才会出现"的重组件：拆成独立 chunk 按需加载，不占首屏 JS 体积。
// 首屏只需要药箱主界面（列表/统计/搜索），抽屉与备份弹窗点开时再下载。
const DetailDrawer = lazyWithRetry(() =>
  import('./components/DetailDrawer').then(m => ({ default: m.DetailDrawer })));
const DataBackupDialog = lazyWithRetry(() =>
  import('./components/DataBackup').then(m => ({ default: m.DataBackupDialog })));
/** 分块彻底加载失败时的兜底（配合 ErrorBoundary，避免白屏） */
const lazyFailed = (what: string) => (_error: Error, reset: () => void) => (
  <div className="fixed inset-0 z-[70] flex items-center justify-center bg-m3-on-surface/20 p-6">
    <div className="max-w-sm w-full rounded-2xl bg-m3-surface-container-lowest shadow-lg p-5 text-center">
      <div className="text-sm font-bold text-m3-on-surface mb-1">{what}加载失败</div>
      <p className="text-xs text-m3-on-surface-variant leading-relaxed mb-3">
        多半是网络抖动，数据没有丢失。请点重试或刷新页面。
      </p>
      <button type="button" onClick={reset} className="w-full py-2.5 rounded-xl bg-m3-primary text-m3-on-primary text-sm font-semibold">
        重试
      </button>
    </div>
  </div>
);

// 懒加载组件的占位：首屏不含这些组件，弱网下点开需要等一下——
// 给出可见反馈，避免"点了没反应"被误当成卡死。
const dialogLoading = (
  // 注意：不要铺全屏深色遮罩 —— 分块命中缓存时它只出现几十毫秒，
  // 视觉上就是"黑影一闪而过"（老板在手机上反馈过）。
  <div className="fixed inset-x-0 bottom-24 z-[70] flex justify-center pointer-events-none">
    <div className="rounded-full bg-m3-surface-container-high/95 px-4 py-2 text-xs text-m3-on-surface-variant shadow-md">
      加载中…
    </div>
  </div>
);

import {
  SearchFilter, CategorySections, MobileHealthCard,
  HealthBanner, MetricGrid, useFilteredMedicines, usePinyinIndex,
  type FilterKey,
} from './components/HomeContent';

type ViewKey = 'box' | 'restock' | 'logs';

/** 底部/顶部导航胶囊（模块级组件：避免在主组件内定义导致每次渲染都重建子树） */
const NavPill: React.FC<{
  item: { key: ViewKey; label: string; icon: 'grid_view' | 'shopping_bag' | 'history'; badge?: number };
  mobile?: boolean;
  active: boolean;
  onSelect: (v: ViewKey) => void;
}> = ({ item, mobile, active, onSelect }) => {
  return (
    <button
      type="button"
      onClick={() => onSelect(item.key)}
      aria-current={active ? 'page' : undefined}
      className={`${mobile
        ? 'flex flex-col items-center justify-center flex-1 h-full gap-0.5'
        : 'px-4 lg:px-5 py-2 rounded-full text-sm flex items-center gap-1.5'} transition-all ${
        active
          ? mobile ? 'text-m3-primary' : 'bg-m3-surface-container-lowest text-m3-primary shadow-[0_2px_8px_rgba(15,118,110,0.06)] font-semibold'
          : mobile ? 'text-m3-on-surface-variant' : 'text-m3-on-surface-variant hover:text-m3-on-surface'
      }`}
    >
      <span className="relative">
        <Icon name={item.icon} className={mobile ? 'w-[22px] h-[22px]' : 'w-4 h-4'} />
        {item.badge ? (
          <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-m3-tertiary text-m3-on-tertiary text-[9px] font-bold flex items-center justify-center">
            {item.badge}
          </span>
        ) : null}
      </span>
      <span className={mobile ? 'text-[11px] font-medium' : ''}>{item.label}</span>
    </button>
  );
};

const ModernApp: React.FC = () => {
  const { toasts, showToast } = useToasts();

  // ---- 数据 ----
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [shopping, setShopping] = useState<ShoppingItem[]>([]);
  const [logs, setLogs] = useState<UsageLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ---- 视图与筛选 ----
  const [view, setView] = useState<ViewKey>('box');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [location, setLocation] = useState('');

  // ---- 弹层状态 ----
  const [drawerMed, setDrawerMed] = useState<Medicine | null>(null);
  const [consumeTarget, setConsumeTarget] = useState<Medicine | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Medicine | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Medicine | null>(null);
  const [backupOpen, setBackupOpen] = useState(false);

  // ---- 数据加载 ----
  const refreshData = useCallback(async () => {
    try {
      // getMedicines 必须先行：投产重置等一次性迁移在它内部写回，
      // 若与清单/记录并行读取，老设备首屏可能读到迁移前的旧数据（竞态）
      const meds = await MedicineService.getMedicines();
      const [shop, lg] = await Promise.all([
        MedicineService.getShoppingList(),
        MedicineService.getUsageLogs(),
      ]);
      setMedicines(MedicineService.sortMedicines(meds));
      setShopping(shop.filter(i => i.status === ShoppingStatus.PENDING));
      setLogs(lg);
      setLoadError(null);
    } catch (e) {
      console.error('[Modern] 数据加载失败：', e);
      // 透出服务层原始原因（存储损坏 / 云端不可达等），而不是笼统的网络提示
      setLoadError(e instanceof Error && e.message
        ? `${e.message} 请重试；若反复出现，可通过「数据备份与恢复」导出排查。`
        : '无法连接数据源，已暂停本次加载以保护现有数据，请检查网络后重试。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refreshData(); }, [refreshData]);

  // 服务层广播的存储写入失败（配额不足 / 云端写入失败）
  useEffect(() => {
    const onStorageError = (e: Event) => showToast((e as CustomEvent<string>).detail, 'warning');
    window.addEventListener('mb:storage-error', onStorageError);
    return () => window.removeEventListener('mb:storage-error', onStorageError);
  }, [showToast]);

  // ESC 逐层关闭（删除确认 > 服药确认 > 抽屉），编辑表单不响应避免误触丢内容
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (deleteTarget) { setDeleteTarget(null); return; }
      if (consumeTarget) { setConsumeTarget(null); return; }
      if (drawerMed) setDrawerMed(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteTarget, consumeTarget, drawerMed]);

  // ---- 派生数据 ----
  const overview = useMemo(() => getHealthOverview(medicines), [medicines]);
  const locations = useMemo(
    () => Array.from(new Set(medicines.map(m => (m.location || '').trim()).filter(Boolean))).sort(),
    [medicines]
  );
  const counts: Record<FilterKey, number> = useMemo(() => ({
    all: medicines.length,
    normal: overview.normal - overview.expiringSoon,
    low: overview.low + overview.out,
    expiring: overview.expiringSoon,
    expired: overview.expired,
  }), [medicines.length, overview]);
  const pinyinIndex = usePinyinIndex(medicines);
  const filtered = useFilteredMedicines(medicines, query, filter, location, pinyinIndex);

  // ---- 操作（统一错误兜底：服务层抛错时以 warning toast 告知，绝不能静默假成功） ----
  const runSafely = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '操作失败，请重试', 'warning');
    }
  };

  const handleConsumeDone = (target: Medicine, amount: number) =>
    runSafely(async () => {
      await MedicineService.consumeMedicine(target.id, amount);
      showToast(`已记录 ${target.name} 用药 ${amount}${target.unit}，健康日志已同步`);
      refreshData();
    });

  const handleQuickConsume = (med: Medicine) =>
    runSafely(async () => {
      if (med.total_quantity <= 0) return;
      await MedicineService.consumeMedicine(med.id, 1);
      showToast(`已取用 ${med.name} 1${med.unit}，库存已更新`);
      refreshData();
    });

  // 补货清单由服务层规则自动维护（过期 / 用完），界面不再提供手动添加或"生成采购单"入口

  const handleDeleteDone = () =>
    runSafely(async () => {
      if (!deleteTarget) return;
      const name = deleteTarget.name;
      setDeleteTarget(null);
      setDrawerMed(null);
      await MedicineService.deleteMedicine(deleteTarget.id);
      showToast(`已将「${name}」移出药箱`);
      refreshData();
    });

  const openAdd = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (med: Medicine) => { setDrawerMed(null); setEditing(med); setFormOpen(true); };

  const navBadge = shopping.length;
  // 任一弹层打开时隐藏右下角 UI 切换按钮，避免遮挡抽屉/弹窗的操作区
  const overlayOpen = !!(drawerMed || consumeTarget || deleteTarget || formOpen || backupOpen);

  const switchView = (v: ViewKey) => {
    setView(v);
    if (v === 'box') { setFilter('all'); setLocation(''); }
  };

  // ============ 共享片段 ============

  const Logo = (
    <div className="flex items-center gap-2.5">
      {/* 品牌图标：与 favicon / PWA 安装图标同源（public/favicon.svg） */}
      <img
        src={`${import.meta.env.BASE_URL}favicon.svg`}
        alt="家庭药箱"
        className="w-10 h-10 rounded-xl shadow-[0_2px_8px_rgba(15,118,110,0.25)]"
      />
      <span className="text-lg font-bold text-m3-on-surface tracking-tight">家庭药箱</span>
    </div>
  );

  const navItems: { key: ViewKey; label: string; icon: 'grid_view' | 'shopping_bag' | 'history'; badge?: number }[] = [
    { key: 'box', label: '我的药箱', icon: 'grid_view' },
    { key: 'restock', label: '需补货', icon: 'shopping_bag', badge: navBadge },
    { key: 'logs', label: '用药记录', icon: 'history' },
  ];

  return (
    <div className="min-h-dvh bg-m3-surface font-m3-body text-m3-on-surface antialiased">
      <ToastStack toasts={toasts} />

      {/* 桌面固定顶栏 */}
      <header className="hidden md:block fixed top-0 w-full z-50 bg-m3-surface/85 backdrop-blur-xl shadow-[0_1px_12px_rgba(15,118,110,0.05)]">
        <div className="h-16 max-w-7xl mx-auto px-6 flex items-center justify-between gap-4">
          <button type="button" onClick={() => { switchView('box'); setQuery(''); }} className="cursor-pointer">
            {Logo}
          </button>
          <nav className="hidden md:flex items-center p-1 rounded-full bg-m3-surface-container-low">
            {navItems.map(item => <NavPill key={item.key} item={item} active={view === item.key} onSelect={switchView} />)}
          </nav>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setBackupOpen(true)}
              aria-label="数据备份与恢复"
              title="数据备份与恢复"
              className="w-10 h-10 rounded-full border border-m3-outline-variant/70 text-m3-on-surface-variant hover:text-m3-primary hover:border-m3-primary/50 flex items-center justify-center transition-colors"
            >
              <Icon name="archive" className="w-[18px] h-[18px]" />
            </button>
            <button
              type="button"
              onClick={openAdd}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-m3-primary hover:bg-m3-primary-container text-m3-on-primary text-sm font-semibold shadow-[0_6px_16px_-2px_rgba(15,118,110,0.3)] hover:shadow-[0_8px_20px_-2px_rgba(15,118,110,0.38)] active:scale-[0.98] transition-all"
            >
              <Icon name="add" className="w-[18px] h-[18px]" />
              <span>入库新药</span>
            </button>
          </div>
        </div>
      </header>

      {/* 移动端头部（流内）：左 Logo，右用药记录 + 数据备份入口（入库走底部中央 FAB） */}
      <header className="md:hidden px-4 pt-4 pb-1 flex items-center justify-between gap-2">
        {Logo}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => switchView('logs')}
            aria-current={view === 'logs' ? 'page' : undefined}
            className={`flex items-center gap-1 px-3.5 py-2 rounded-full text-xs font-semibold active:scale-95 transition-all ${
              view === 'logs'
                ? 'bg-m3-primary text-m3-on-primary shadow-[0_4px_12px_rgba(15,118,110,0.3)]'
                : 'bg-m3-surface-container-lowest text-m3-on-surface-variant shadow-[0_2px_8px_rgba(15,118,110,0.05)]'
            }`}
          >
            <Icon name="history" className="w-4 h-4" />
            <span>用药记录</span>
          </button>
          <button
            type="button"
            onClick={() => setBackupOpen(true)}
            aria-label="数据备份与恢复"
            className="w-9 h-9 rounded-full bg-m3-surface-container-lowest text-m3-on-surface-variant shadow-[0_2px_8px_rgba(15,118,110,0.05)] flex items-center justify-center active:scale-95 transition-all"
          >
            <Icon name="archive" className="w-[17px] h-[17px]" />
          </button>
        </div>
      </header>

      {/* 主内容 */}
      <main className="w-full pt-2 md:pt-16 pb-28 md:pb-10 min-h-screen">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 md:py-6">
          {loadError && (
            <div className="mb-5 bg-m3-error-container rounded-2xl p-4 flex items-start justify-between gap-4">
              <div className="text-[13px] text-m3-on-error-container leading-relaxed">
                <span className="font-bold block mb-1">数据加载失败</span>
                {loadError}
              </div>
              <button type="button" onClick={refreshData}
                className="shrink-0 bg-m3-error text-m3-on-error text-xs font-bold px-4 py-2 rounded-full hover:opacity-90 transition-opacity shrink-0">
                重试
              </button>
            </div>
          )}

          {view === 'box' && (
            <div className="flex flex-col gap-4 md:gap-5">
              {/* 健康概览：桌面横幅+指标（lg+），移动环形卡（<lg） */}
              <div className="hidden lg:grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
                <HealthBanner o={overview} />
                <MetricGrid o={overview} filter={filter} onFilter={setFilter} />
              </div>
              <div className="lg:hidden"><MobileHealthCard o={overview} filter={filter} onFilter={setFilter} /></div>

              <SearchFilter
                query={query} onQuery={setQuery}
                filter={filter} onFilter={setFilter}
                counts={counts}
                locations={locations} location={location} onLocation={setLocation}
                medicines={medicines}
                pinyinIndex={pinyinIndex}
                onPick={setDrawerMed}
              />

              {loading ? (
                <div className="py-20 text-center text-sm text-m3-on-surface-variant">正在加载药箱…</div>
              ) : (
                <CategorySections
                  meds={filtered}
                  boxEmpty={medicines.length === 0}
                  onRequestConsume={setConsumeTarget}
                  onOpenDetail={setDrawerMed}
                  onQuickConsume={handleQuickConsume}
                />
              )}
            </div>
          )}

          <ErrorBoundary fallback={(_error, reset) => (
            <div className="py-16 text-center text-sm text-m3-on-surface-variant">
              <div className="mb-3">页面加载失败，多半是网络抖动</div>
              <button type="button" onClick={reset} className="px-5 py-2.5 rounded-xl bg-m3-primary text-m3-on-primary font-semibold">重试</button>
            </div>
          )}>
            {view === 'restock' && <RestockView onChanged={refreshData} />}
            {view === 'logs' && <LogsView logs={logs} loading={loading} />}
          </ErrorBoundary>

          {/* 页脚 */}
          <footer className="mt-12 md:mt-16 pt-6 border-t border-m3-surface-container-low flex flex-col sm:flex-row items-center justify-between gap-2 pb-4">
            <div className="flex items-center gap-2">
              <img
                src={`${import.meta.env.BASE_URL}favicon.svg`}
                alt=""
                className="w-6 h-6 rounded-md"
              />
              <span className="text-sm font-semibold text-m3-on-surface">家庭药箱</span>
            </div>
            <div className="text-xs text-m3-on-surface-variant text-center sm:text-right max-w-md">
              <div>© 2026 家庭药箱</div>
              <div className="mt-1 leading-relaxed">
                本工具仅用于家庭药品的库存与效期记录，<strong className="font-semibold">不构成任何医疗建议</strong>；用药请遵医嘱并阅读说明书。
              </div>
            </div>
          </footer>
        </div>
      </main>

      {/* 移动端悬浮底部导航：药箱 / FAB / 补货（实心背景，始终常显） */}
      <div className="md:hidden fixed bottom-4 left-1/2 -translate-x-1/2 w-[92%] max-w-[400px] z-50">
        <div className="relative bg-m3-surface-container-lowest rounded-full shadow-[0_8px_30px_rgba(0,0,0,0.12)] pl-2 pr-2 py-2 flex items-center justify-between">
          <NavPill item={navItems[0]} mobile active={view === navItems[0].key} onSelect={switchView} />
          <div className="relative -top-5 shrink-0 px-2">
            <button
              type="button"
              aria-label="入库新药"
              onClick={openAdd}
              className="w-14 h-14 rounded-full bg-gradient-to-tr from-m3-primary to-m3-primary-container text-m3-on-primary shadow-[0_10px_24px_-4px_rgba(15,118,110,0.45)] flex items-center justify-center hover:scale-105 active:scale-95 transition-all"
            >
              <Icon name="add" className="w-7 h-7" />
            </button>
          </div>
          <NavPill item={navItems[1]} mobile active={view === navItems[1].key} onSelect={switchView} />
        </div>
      </div>

      {/* 抽屉与弹窗 */}
      {drawerMed && (
        <ErrorBoundary fallback={lazyFailed('药品详情')}>
        <React.Suspense fallback={dialogLoading}>
          <DetailDrawer
            med={drawerMed}
            logs={logs}
            onClose={() => setDrawerMed(null)}
            onConsume={setConsumeTarget}
            onEdit={openEdit}
            onDelete={setDeleteTarget}
          />
        </React.Suspense>
        </ErrorBoundary>
      )}
      {consumeTarget && (
        <ConsumeDialog
          med={consumeTarget}
          onClose={() => setConsumeTarget(null)}
          onDone={a => { setConsumeTarget(null); handleConsumeDone(consumeTarget, a); }}
        />
      )}
      {deleteTarget && (
        <DeleteDialog med={deleteTarget} onClose={() => setDeleteTarget(null)} onDone={handleDeleteDone} />
      )}
      {formOpen && (
        <MedicineForm
          key={editing ? `edit-${editing.id}` : 'add-new'}
          editing={editing ?? undefined}
          allMedicines={medicines}
          pendingRestockNames={shopping.map(i => i.medicine_name)}
          onClose={() => { setFormOpen(false); setEditing(null); }}
          onDone={(name, message) => {
            setFormOpen(false);
            const wasEditing = !!editing;
            setEditing(null);
            // message：服务层返回的入库/更新结果汇总（合并入库 / 手动补货识别 / 待补货核销），
            // 无则回退到默认文案
            showToast(
              message || (wasEditing ? `「${name}」的信息已更新` : `新药品「${name}」已入库，药箱概览已更新`)
            );
            refreshData();
          }}
        />
      )}

      {/* 数据备份与恢复（导出/导入，新版 UI 入口：桌面顶栏 + 移动头部） */}
      {backupOpen && (
        <ErrorBoundary fallback={lazyFailed('数据备份')}>
        <React.Suspense fallback={dialogLoading}>
          <DataBackupDialog
            onClose={() => setBackupOpen(false)}
            onDone={message => {
              setBackupOpen(false);
              showToast(message);
              refreshData();
            }}
          />
        </React.Suspense>
        </ErrorBoundary>
      )}

      {!overlayOpen && <UISwitcher bottomClass="bottom-24 md:bottom-6" />}
    </div>
  );
};

export default ModernApp;
