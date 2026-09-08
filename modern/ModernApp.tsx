/**
 * 文件名: modern/ModernApp.tsx
 * 功能: 新版 UI 主容器
 * 描述: 基于设计稿（电脑端.html / 手机端.html）适配真实数据层的完整实现：
 *       - 桌面（lg+）：固定顶栏 + 储药指数横幅 + 4 指标卡 + 提示条 +
 *         搜索过滤 + 分类三列卡片 + 右侧详情抽屉
 *       - 移动（<lg）：头部 + 环形健康卡 + 迷你指标 + 过滤 chips +
 *         分类列表（含轻量物资双列小卡）+ 悬浮底部导航 + 中央 FAB
 *       数据层与经典版完全共享（MedicineService），任何操作实时同步。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Medicine, ShoppingItem, UsageLog, ShoppingStatus } from '../types';
import { MedicineService, todayDateString } from '../services/medicineService';
import { getStatus, getHealthOverview } from './ui';
import { Icon } from './icons';
import UISwitcher from '../ui/UISwitcher';
import { useToasts, ToastStack } from './components/Toast';
import { DetailDrawer } from './components/DetailDrawer';
import { ConsumeDialog, DeleteDialog, MedicineForm } from './components/Dialogs';
import { RestockView, LogsView } from './components/Views';
import {
  ReminderBar, SearchFilter, CategorySections, MobileHealthCard,
  HealthBanner, MetricGrid, useFilteredMedicines,
  type FilterKey,
} from './components/HomeContent';

type ViewKey = 'box' | 'restock' | 'logs';

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

  // ---- 数据加载 ----
  const refreshData = useCallback(async () => {
    try {
      const [meds, shop, lg] = await Promise.all([
        MedicineService.getMedicines(),
        MedicineService.getShoppingList(),
        MedicineService.getUsageLogs(),
      ]);
      setMedicines(MedicineService.sortMedicines(meds));
      setShopping(shop.filter(i => i.status === ShoppingStatus.PENDING));
      setLogs(lg);
      setLoadError(null);
    } catch (e) {
      console.error('[Modern] 数据加载失败：', e);
      setLoadError('无法连接数据源，已暂停本次加载以保护云端数据，请检查网络后重试。');
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
  const categoryCount = useMemo(
    () => new Set(medicines.map(m => m.category || '其他')).size,
    [medicines]
  );
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
  const filtered = useFilteredMedicines(medicines, query, filter, location);

  // ---- 操作 ----
  const handleConsumeDone = async (med: Medicine, amount: number) => {
    setConsumeTarget(null);
    await MedicineService.consumeMedicine(med.id, amount);
    showToast(`已记录 ${med.name} 用药 ${amount}${med.unit}，健康日志已同步`);
    refreshData();
  };

  const handleQuickConsume = async (med: Medicine) => {
    if (med.total_quantity <= 0) return;
    await MedicineService.consumeMedicine(med.id, 1);
    showToast(`已取用 ${med.name} 1${med.unit}，库存已更新`);
    refreshData();
  };

  const handleAddRestock = async (med: Medicine) => {
    const status = getStatus(med, todayDateString());
    const reason = status.key === 'expired' ? '过期' : med.total_quantity === 0 ? '用尽' : '手动添加';
    const added = await MedicineService.addToShoppingList([{ name: med.name, reason }]);
    showToast(
      added > 0 ? `已将「${med.name}」加入补货清单` : `「${med.name}」已在补货清单中，无需重复添加`,
      added > 0 ? 'success' : 'warning'
    );
    refreshData();
  };

  const handleGeneratePurchase = async () => {
    const today = todayDateString();
    const entries = medicines
      .filter(m => {
        const s = getStatus(m, today);
        return s.key === 'low' || s.key === 'out';
      })
      .map(m => ({ name: m.name, reason: (m.total_quantity === 0 ? '用尽' : '手动添加') as ShoppingItem['reason'] }));
    if (entries.length === 0) {
      showToast('当前没有需要补货的药品，清单保持不变', 'warning');
      return;
    }
    const added = await MedicineService.addToShoppingList(entries);
    showToast(`已根据库存状况生成采购建议（新增 ${added} 项）`);
    refreshData();
    setView('restock');
  };

  const handleDeleteDone = async () => {
    if (!deleteTarget) return;
    const name = deleteTarget.name;
    setDeleteTarget(null);
    setDrawerMed(null);
    await MedicineService.deleteMedicine(deleteTarget.id);
    showToast(`已将「${name}」移出药箱`);
    refreshData();
  };

  const openAdd = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (med: Medicine) => { setDrawerMed(null); setEditing(med); setFormOpen(true); };

  const navBadge = shopping.length;
  // 任一弹层打开时隐藏右下角 UI 切换按钮，避免遮挡抽屉/弹窗的操作区
  const overlayOpen = !!(drawerMed || consumeTarget || deleteTarget || formOpen);

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
      <div className="flex flex-col leading-none text-left">
        <span className="text-lg font-bold text-m3-on-surface tracking-tight">家庭药箱</span>
        <span className="text-[11px] text-m3-on-surface-variant font-medium mt-1">家庭健康管家</span>
      </div>
    </div>
  );

  const navItems: { key: ViewKey; label: string; icon: 'grid_view' | 'shopping_bag' | 'history'; badge?: number }[] = [
    { key: 'box', label: '我的药箱', icon: 'grid_view' },
    { key: 'restock', label: '需补货', icon: 'shopping_bag', badge: navBadge },
    { key: 'logs', label: '用药记录', icon: 'history' },
  ];

  const NavPill = ({ item, mobile }: { item: typeof navItems[number]; mobile?: boolean }) => {
    const active = view === item.key;
    return (
      <button
        type="button"
        onClick={() => switchView(item.key)}
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
            {navItems.map(item => <NavPill key={item.key} item={item} />)}
          </nav>
          <button
            type="button"
            onClick={openAdd}
            className="flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-m3-primary hover:bg-m3-primary-container text-m3-on-primary text-sm font-semibold shadow-[0_6px_16px_-2px_rgba(15,118,110,0.3)] hover:shadow-[0_8px_20px_-2px_rgba(15,118,110,0.38)] active:scale-[0.98] transition-all"
          >
            <Icon name="add" className="w-[18px] h-[18px]" />
            <span>入库新药</span>
          </button>
        </div>
      </header>

      {/* 移动端头部（流内） */}
      <header className="md:hidden px-4 pt-4 pb-1 flex items-center justify-between gap-3">
        {Logo}
        <button
          type="button"
          onClick={openAdd}
          className="flex items-center gap-1 px-3.5 py-2 rounded-full bg-m3-primary text-m3-on-primary text-xs font-semibold shadow-[0_4px_12px_rgba(15,118,110,0.3)] active:scale-95 transition-all shrink-0"
        >
          <Icon name="add" className="w-4 h-4" />
          <span>入库</span>
        </button>
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
                <MetricGrid o={overview} categoryCount={categoryCount} filter={filter} onFilter={setFilter} />
              </div>
              <div className="lg:hidden"><MobileHealthCard o={overview} filter={filter} onFilter={setFilter} /></div>

              <ReminderBar o={overview} onGenerate={handleGeneratePurchase} />

              <SearchFilter
                query={query} onQuery={setQuery}
                filter={filter} onFilter={setFilter}
                counts={counts}
                locations={locations} location={location} onLocation={setLocation}
              />

              {loading ? (
                <div className="py-20 text-center text-sm text-m3-on-surface-variant">正在加载药箱…</div>
              ) : (
                <CategorySections
                  meds={filtered}
                  onRequestConsume={setConsumeTarget}
                  onOpenDetail={setDrawerMed}
                  onAddToRestock={handleAddRestock}
                  onQuickConsume={handleQuickConsume}
                />
              )}
            </div>
          )}

          {view === 'restock' && <RestockView onChanged={refreshData} />}
          {view === 'logs' && <LogsView logs={logs} loading={loading} />}

          {/* 页脚 */}
          <footer className="mt-12 md:mt-16 pt-6 border-t border-m3-surface-container-low flex flex-col sm:flex-row items-center justify-between gap-2 pb-4">
            <div className="flex items-center gap-2">
              <img
                src={`${import.meta.env.BASE_URL}favicon.svg`}
                alt=""
                className="w-6 h-6 rounded-md"
              />
              <span className="text-sm font-semibold text-m3-on-surface">家庭药箱</span>
              <span className="text-xs text-m3-on-surface-variant ml-1">温润守护每一位家人的常备与急救用药</span>
            </div>
            <div className="text-xs text-m3-on-surface-variant">© 2026 家庭健康管家 · 关怀、清晰与守护</div>
          </footer>
        </div>
      </main>

      {/* 移动端悬浮底部导航：药箱 / 记录 / FAB / 补货 */}
      <div className="md:hidden fixed bottom-4 left-1/2 -translate-x-1/2 w-[92%] max-w-[400px] z-50">
        <div className="relative bg-m3-surface-container-lowest/90 backdrop-blur-xl rounded-full shadow-[0_8px_30px_rgba(0,0,0,0.10)] pl-2 pr-2 py-2 flex items-center justify-between">
          <NavPill item={navItems[0]} mobile />
          <NavPill item={navItems[2]} mobile />
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
          <NavPill item={navItems[1]} mobile />
        </div>
      </div>

      {/* 抽屉与弹窗 */}
      {drawerMed && (
        <DetailDrawer
          med={drawerMed}
          logs={logs}
          onClose={() => setDrawerMed(null)}
          onConsume={setConsumeTarget}
          onRestock={handleAddRestock}
          onEdit={openEdit}
          onDelete={setDeleteTarget}
        />
      )}
      {consumeTarget && (
        <ConsumeDialog med={consumeTarget} onClose={() => setConsumeTarget(null)} onDone={a => handleConsumeDone(consumeTarget, a)} />
      )}
      {deleteTarget && (
        <DeleteDialog med={deleteTarget} onClose={() => setDeleteTarget(null)} onDone={handleDeleteDone} />
      )}
      {formOpen && (
        <MedicineForm
          key={editing ? `edit-${editing.id}` : 'add-new'}
          editing={editing ?? undefined}
          onClose={() => { setFormOpen(false); setEditing(null); }}
          onDone={name => {
            setFormOpen(false);
            const wasEditing = !!editing;
            setEditing(null);
            showToast(wasEditing ? `「${name}」的信息已更新` : `新药品「${name}」已入库，药箱概览已更新`);
            refreshData();
          }}
        />
      )}

      {!overlayOpen && <UISwitcher bottomClass="bottom-24 md:bottom-6" />}
    </div>
  );
};

export default ModernApp;
