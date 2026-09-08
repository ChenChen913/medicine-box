/**
 * 文件名: modern/components/HomeContent.tsx
 * 功能: 新版 UI 的「我的药箱」首页内容
 * 描述: 按设计稿还原三块结构，数据全部来自真实库存：
 *       1. 健康概览（桌面 7:5 横幅 + 4 指标卡 / 移动环形健康卡 + 3 迷你指标）
 *       2. 管家温馨提示条 + 一键生成采购单
 *       3. 搜索 + 状态过滤 pills + 存放位置下拉 + 分类分区卡片网格
 */

import React, { useMemo } from 'react';
import { Medicine } from '../../types';
import { getCategoryWeight } from '../../services/medicineService';
import { HealthOverview, getCategoryMeta, getStatus } from '../ui';
import { Icon, IconName } from '../icons';
import { DesktopCard, MobileCard, MobileMiniCard } from './MedicineCards';

export type FilterKey = 'all' | 'normal' | 'low' | 'expiring' | 'expired';
export type CardActions = {
  onRequestConsume: (med: Medicine) => void;
  onOpenDetail: (med: Medicine) => void;
  onAddToRestock: (med: Medicine) => void;
  onQuickConsume: (med: Medicine) => void;
};

// ============ 指标卡（桌面） ============

const METRIC_DEFS: { key: FilterKey; label: string; icon: IconName; iconWrap: string; valueClass: string; footClass: string }[] = [
  { key: 'all', label: '全部储备种类', icon: 'inventory_2', iconWrap: 'bg-m3-primary/10 text-m3-primary', valueClass: 'text-m3-on-surface', footClass: 'text-m3-primary' },
  { key: 'low', label: '库存告急', icon: 'notifications_active', iconWrap: 'bg-m3-tertiary-fixed text-m3-tertiary-container', valueClass: 'text-m3-tertiary', footClass: 'text-m3-tertiary' },
  { key: 'expired', label: '已过期/待清理', icon: 'event_busy', iconWrap: 'bg-m3-error-container text-m3-error', valueClass: 'text-m3-error', footClass: 'text-m3-error' },
  { key: 'normal', label: '正常备用', icon: 'check_circle', iconWrap: 'bg-m3-primary-fixed/40 text-m3-primary', valueClass: 'text-m3-primary', footClass: 'text-m3-primary' },
];

export const MetricGrid: React.FC<{ o: HealthOverview; categoryCount: number; filter: FilterKey; onFilter: (f: FilterKey) => void }> = ({ o, categoryCount, filter, onFilter }) => {
  const footText: Record<string, string> = {
    all: `覆盖 ${categoryCount} 大常备科类`,
    low: '低于预警阈值 · 建议补货',
    expired: '避免误服 · 请回收',
    normal: '库存与效期均达标',
  };
  return (
  <div className="lg:col-span-5 grid grid-cols-2 gap-2.5 md:gap-3">
    {METRIC_DEFS.map(def => {
      const value = def.key === 'all' ? o.total : def.key === 'low' ? o.low + o.out : def.key === 'expired' ? o.expired : o.normal;
      const active = filter === def.key;
      return (
        <button
          key={def.key}
          type="button"
          onClick={() => onFilter(def.key)}
          className={`bg-m3-surface-container-lowest rounded-2xl p-4 shadow-[0_4px_20px_-2px_rgba(15,118,110,0.04)] flex flex-col justify-between hover:shadow-md transition-all text-left ${active ? 'ring-2 ring-m3-primary/40' : ''}`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-m3-on-surface-variant font-medium">{def.label}</span>
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${def.iconWrap}`}>
              <Icon name={def.icon} className="w-5 h-5" />
            </div>
          </div>
          <div className="flex items-baseline gap-1.5 mt-3">
            <span className={`text-[30px] leading-9 font-extrabold tracking-tight ${def.valueClass}`}>{value}</span>
            <span className="text-xs text-m3-on-surface-variant">种</span>
          </div>
          <div className={`flex items-center gap-1 text-[11px] mt-1 ${def.footClass} opacity-90`}>
            <span className="truncate">{footText[def.key]}</span>
          </div>
        </button>
      );
    })}
  </div>
  );
};

// ============ 健康横幅（桌面 7 列主卡） ============

export const HealthBanner: React.FC<{ o: HealthOverview }> = ({ o }) => {
  const segTotal = Math.max(o.total, 1);
  const segs = [
    { width: (o.normal / segTotal) * 100, cls: 'bg-m3-primary' },
    { width: ((o.low + o.out) / segTotal) * 100, cls: 'bg-m3-tertiary-fixed-dim' },
    { width: (o.expired / segTotal) * 100, cls: 'bg-m3-error' },
  ];
  return (
    <div className="lg:col-span-7 rounded-2xl bg-m3-surface-container-lowest p-6 shadow-[0_4px_24px_-2px_rgba(15,118,110,0.05)] flex flex-col justify-between relative overflow-hidden">
      <div className="absolute -right-12 -top-12 w-64 h-64 bg-m3-primary-fixed/20 rounded-full blur-3xl pointer-events-none" />
      <div className="flex flex-col gap-2.5 relative z-10">
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-m3-primary/10 text-m3-primary">
            <Icon name="verified" className="w-4 h-4" />
          </span>
          <span className="text-xs text-m3-primary font-semibold tracking-wide">家庭健康储药指数 · {o.grade}</span>
        </div>
        <h1 className="text-2xl font-bold text-m3-on-surface tracking-tight leading-snug">{o.headline}</h1>
        <p className="text-sm text-m3-on-surface-variant leading-relaxed max-w-xl">{o.summary}</p>
      </div>
      <div className="mt-6 pt-4 flex flex-col gap-1.5 relative z-10">
        <div className="flex items-center justify-between text-xs">
          <span className="text-m3-on-surface-variant flex items-center gap-1.5 font-medium">
            <span className="w-2 h-2 rounded-full bg-m3-primary" />
            家庭储药健康度
          </span>
          <span className="text-m3-primary font-bold text-lg">{o.score}% <span className="text-xs font-normal text-m3-on-surface-variant">达标</span></span>
        </div>
        <div className="w-full h-2.5 rounded-full bg-m3-surface-container-low flex overflow-hidden p-0.5 gap-1">
          {segs.map((s, i) => s.width > 0 && (
            <div key={i} className={`h-full rounded-full ${s.cls}`} style={{ width: `${Math.max(s.width - 0.5, 1)}%` }} />
          ))}
        </div>
        <div className="flex items-center justify-between text-[11px] text-m3-on-surface-variant mt-1">
          <span>安全常备 ({o.normal}种)</span>
          <span>库存告急 ({o.low + o.out}种)</span>
          <span>待处理过期 ({o.expired}种)</span>
        </div>
      </div>
    </div>
  );
};

// ============ 温馨提示条 ============

export const ReminderBar: React.FC<{ o: HealthOverview; onGenerate: () => void }> = ({ o, onGenerate }) => {
  const tips: string[] = [];
  if (o.low + o.out > 0) tips.push(`当前 ${o.low + o.out} 种药品库存偏低，建议及时补足`);
  if (o.expiringSoon > 0) tips.push(`${o.expiringSoon} 种药品将在 30 天内临期，请注意轮换`);
  if (o.expired > 0) tips.push(`${o.expired} 种已过期药品待清理回收`);
  const text = tips.length > 0 ? `家庭管家温馨提示：${tips.join('；')}。` : '家庭管家温馨提示：全家药箱储备充裕、效期健康，请保持定期盘点的好习惯。';

  return (
    <div className="w-full bg-m3-surface-container-lowest rounded-2xl px-4 md:px-5 py-3 shadow-[0_2px_12px_rgba(15,118,110,0.03)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
      <div className="flex items-start sm:items-center gap-2.5 min-w-0">
        <span className="w-8 h-8 rounded-full bg-m3-tertiary-fixed flex items-center justify-center text-m3-tertiary shrink-0">
          <Icon name="lightbulb" className="w-[18px] h-[18px]" />
        </span>
        <span className="text-[13px] text-m3-on-surface leading-relaxed">
          <strong className="font-semibold text-m3-tertiary">家庭管家温馨提示：</strong>{text.replace('家庭管家温馨提示：', '')}
        </span>
      </div>
      <button
        type="button"
        onClick={onGenerate}
        className="shrink-0 text-m3-primary hover:text-m3-primary-container text-xs font-semibold flex items-center gap-1 py-1 px-3 rounded-full hover:bg-m3-primary/5 transition-colors"
      >
        一键生成采购单
        <Icon name="arrow_forward" className="w-4 h-4" />
      </button>
    </div>
  );
};

// ============ 搜索 + 过滤 ============

const FILTERS: { key: FilterKey; label: string; badgeCls: string }[] = [
  { key: 'all', label: '全部', badgeCls: 'bg-m3-surface-container text-m3-on-surface-variant' },
  { key: 'normal', label: '正常备用', badgeCls: 'bg-m3-surface-container text-m3-on-surface-variant' },
  { key: 'low', label: '库存不足', badgeCls: 'bg-m3-tertiary-fixed text-m3-tertiary-container' },
  { key: 'expiring', label: '临期 30 天', badgeCls: 'bg-m3-surface-container text-m3-on-surface-variant' },
  { key: 'expired', label: '已过期需清理', badgeCls: 'bg-m3-error-container text-m3-error' },
];

export const SearchFilter: React.FC<{
  query: string; onQuery: (q: string) => void;
  filter: FilterKey; onFilter: (f: FilterKey) => void;
  counts: Record<FilterKey, number>;
  locations: string[]; location: string; onLocation: (l: string) => void;
}> = ({ query, onQuery, filter, onFilter, counts, locations, location, onLocation }) => (
  <div className="w-full flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
    <div className="relative flex-1 max-w-xl">
      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-m3-primary">
        <Icon name="search" className="w-5 h-5" />
      </div>
      <input
        type="text"
        value={query}
        onChange={e => onQuery(e.target.value)}
        className="w-full h-12 pl-11 pr-4 bg-m3-surface-container-lowest rounded-full text-sm text-m3-on-surface placeholder:text-m3-outline shadow-[0_2px_10px_rgba(15,118,110,0.03)] outline-none focus:ring-2 focus:ring-m3-primary/20 transition-all"
        placeholder="搜索药品名称、症状（如：头痛、流感）或存放位置..."
        aria-label="搜索药品"
      />
    </div>
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0">
      {FILTERS.map(f => {
        const active = filter === f.key;
        return (
          <button
            key={f.key}
            type="button"
            onClick={() => onFilter(f.key)}
            className={`px-3.5 py-2 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              active
                ? 'bg-m3-primary text-m3-on-primary shadow-[0_4px_12px_rgba(15,118,110,0.25)]'
                : 'bg-m3-surface-container-lowest hover:bg-m3-surface-container-low text-m3-on-surface-variant'
            }`}
          >
            <span>{f.label}</span>
            <span className={`px-1.5 py-0.5 rounded-full text-[11px] ${active ? 'bg-m3-on-primary/20 text-m3-on-primary' : f.badgeCls}`}>{counts[f.key]}</span>
          </button>
        );
      })}
      {locations.length > 1 && (
        <div className="relative shrink-0">
          <select
            value={location}
            onChange={e => onLocation(e.target.value)}
            className="appearance-none pl-3.5 pr-8 py-2 rounded-full bg-m3-surface-container-lowest hover:bg-m3-surface-container-low text-xs text-m3-on-surface-variant font-medium cursor-pointer outline-none transition-colors"
            aria-label="按存放位置筛选"
          >
            <option value="">所有存放位置</option>
            {locations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
          </select>
          <Icon name="expand_more" className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-m3-outline pointer-events-none" />
        </div>
      )}
    </div>
  </div>
);

// ============ 分类分区列表 ============

function matchFilter(m: Medicine, f: FilterKey): boolean {
  const s = getStatus(m);
  switch (f) {
    case 'normal': return s.key === 'normal';
    case 'low': return s.key === 'low' || s.key === 'out';
    case 'expiring': return s.key === 'expiring';
    case 'expired': return s.key === 'expired';
    default: return true;
  }
}

export function useFilteredMedicines(
  medicines: Medicine[], query: string, filter: FilterKey, location: string
): Medicine[] {
  return useMemo(() => {
    let result = medicines;
    const q = query.trim().toLowerCase();
    if (q) {
      result = result.filter(m =>
        m.name.toLowerCase().includes(q) ||
        m.symptoms_treated.toLowerCase().includes(q) ||
        (m.location || '').toLowerCase().includes(q)
      );
    }
    result = result.filter(m => matchFilter(m, filter));
    if (location) result = result.filter(m => (m.location || '') === location);
    return result;
  }, [medicines, query, filter, location]);
}

export const CategorySections: React.FC<{ meds: Medicine[] } & CardActions> = ({ meds, ...actions }) => {
  const grouped = useMemo(() => {
    const groups: Record<string, Medicine[]> = {};
    meds.forEach(m => {
      const c = m.category || '其他';
      (groups[c] ||= []).push(m);
    });
    return Object.entries(groups).sort((a, b) => getCategoryWeight(b[0]) - getCategoryWeight(a[0]));
  }, [meds]);

  if (grouped.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-14 h-14 rounded-2xl bg-m3-surface-container-low text-m3-outline flex items-center justify-center mx-auto mb-4">
          <Icon name="search" className="w-7 h-7" />
        </div>
        <p className="text-sm font-medium text-m3-on-surface-variant">没有找到相关药品</p>
        <p className="text-xs text-m3-outline mt-1.5">换个关键词或切换筛选条件试试</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      {grouped.map(([category, list]) => {
        const meta = getCategoryMeta(category);
        // 外用 / 器械等轻量物资在移动端用双列小卡（设计稿的外伤急救形态）
        const compactMobile = category.includes('外用') || category.includes('器械');
        return (
          <section key={category} className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-1 h-4 rounded-full bg-m3-primary shrink-0" />
                <h2 className="text-base md:text-lg font-bold text-m3-on-surface tracking-tight truncate">{category}</h2>
                <span className="px-2 py-0.5 rounded-full bg-m3-surface-container-low text-[11px] text-m3-on-surface-variant font-semibold shrink-0">{list.length} 种在库</span>
              </div>
              <span className="hidden md:block text-[13px] text-m3-on-surface-variant shrink-0">{meta.slogan}</span>
            </div>

            {/* 桌面三列大卡 */}
            <div className="hidden md:grid grid-cols-2 lg:grid-cols-3 gap-4">
              {list.map(m => <DesktopCard key={m.id} med={m} {...actions} />)}
            </div>

            {/* 移动端：轻量物资双列小卡，其余单列大卡 */}
            <div className="md:hidden flex flex-col gap-2.5">
              {compactMobile ? (
                <div className="grid grid-cols-2 gap-2.5">
                  {list.map(m => <MobileMiniCard key={m.id} med={m} {...actions} />)}
                </div>
              ) : (
                list.map(m => <MobileCard key={m.id} med={m} {...actions} />)
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
};

// ============ 移动端环形健康卡 ============

export const MobileHealthCard: React.FC<{ o: HealthOverview; filter: FilterKey; onFilter: (f: FilterKey) => void }> = ({ o, filter, onFilter }) => {
  const R = 19;
  const C = 2 * Math.PI * R;
  const dash = C * (1 - o.score / 100);

  return (
    <div className="p-4 rounded-2xl bg-m3-surface-container-lowest shadow-[0_4px_20px_-2px_rgba(15,118,110,0.06)] flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative w-14 h-14 shrink-0 flex items-center justify-center">
            <svg className="w-14 h-14 -rotate-90" viewBox="0 0 48 48">
              <circle className="text-m3-surface-container" cx="24" cy="24" fill="none" r={R} stroke="currentColor" strokeWidth="4" />
              <circle className="text-m3-primary" cx="24" cy="24" fill="none" r={R} stroke="currentColor" strokeWidth="4"
                strokeDasharray={C} strokeDashoffset={dash} strokeLinecap="round" />
            </svg>
            <span className="absolute text-[15px] font-bold text-m3-primary tracking-tighter leading-none">{o.score}%</span>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="text-base font-semibold text-m3-on-surface">家庭药箱状态 · {o.grade}</span>
              <span className="w-2 h-2 rounded-full bg-m3-primary-container animate-pulse" />
            </div>
            <span className="text-xs text-m3-on-surface-variant">{o.headline}</span>
          </div>
        </div>
        <Icon name="health_and_safety" className="w-5 h-5 text-m3-primary shrink-0" />
      </div>

      <div className="grid grid-cols-3 gap-1.5 pt-1">
        {([
          { label: '在库总计', value: o.total, cls: 'bg-m3-surface-container-low', vCls: 'text-m3-on-surface', f: 'all' as FilterKey },
          { label: '需及时补货', value: o.low + o.out, cls: 'bg-m3-tertiary-fixed/30', vCls: 'text-m3-tertiary', f: 'low' as FilterKey },
          { label: '临期/已过期', value: o.expiringSoon + o.expired, cls: 'bg-m3-error-container/40', vCls: 'text-m3-error', f: 'expired' as FilterKey },
        ]).map(cell => (
          <button
            key={cell.label}
            type="button"
            onClick={() => onFilter(cell.f)}
            className={`p-2.5 rounded-xl flex flex-col text-left ${cell.cls} ${filter === cell.f ? 'ring-2 ring-m3-primary/30' : ''}`}
          >
            <span className="text-[11px] text-m3-on-surface-variant">{cell.label}</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className={`text-lg font-bold ${cell.vCls}`}>{cell.value}</span>
              <span className="text-[11px] text-m3-on-surface-variant">种</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
