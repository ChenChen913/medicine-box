/**
 * 文件名: modern/components/HomeContent.tsx
 * 功能: 新版 UI 的「我的药箱」首页内容
 * 描述: 数据全部来自真实库存：
 *       1. 健康概览（桌面 7:5 横幅 + 4 指标卡 / 移动状态行 + 2x2 四格）
 *       2. 搜索（实时联想下拉：模糊 + 拼音首字母）+ 状态过滤 pills + 存放位置下拉 + 分类分区卡片网格
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Medicine } from '../../types';
import { getCategoryWeight } from '../../services/medicineService';
import { HealthOverview, getStatus, getCategoryMeta } from '../ui';
import { Icon, IconName } from '../icons';
import { M3Select, SelectOption } from './Select';
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

export const MetricGrid: React.FC<{ o: HealthOverview; filter: FilterKey; onFilter: (f: FilterKey) => void }> = ({ o, filter, onFilter }) => {
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
          className={`bg-m3-surface-container-lowest rounded-2xl p-4 shadow-[0_4px_20px_-2px_rgba(15,118,110,0.04)] flex flex-col justify-between gap-4 hover:shadow-md transition-all text-left ${active ? 'ring-2 ring-m3-primary/40' : ''}`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-m3-on-surface-variant font-medium">{def.label}</span>
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${def.iconWrap}`}>
              <Icon name={def.icon} className="w-5 h-5" />
            </div>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className={`text-4xl leading-10 font-extrabold tracking-tight ${def.valueClass}`}>{value}</span>
            <span className="text-xs text-m3-on-surface-variant">种</span>
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

// ============ 拼音索引（首字母/全拼） ============

export type PinyinIndex = Map<string, { initials: string; full: string }>;

/** 懒加载 pinyin-pro 构建「药名 → 拼音」索引（动态 chunk，不占首屏体积），供主列表过滤与联想下拉共享 */
export function usePinyinIndex(medicines: Medicine[]): PinyinIndex | null {
  const [index, setIndex] = useState<PinyinIndex | null>(null);
  useEffect(() => {
    if (medicines.length === 0) return;
    let cancelled = false;
    import('pinyin-pro')
      .then(({ pinyin }) => {
        if (cancelled) return;
        const map: PinyinIndex = new Map();
        medicines.forEach(m => {
          if (map.has(m.name)) return;
          const initials = pinyin(m.name, { pattern: 'first', toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('').toLowerCase();
          const full = pinyin(m.name, { toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('').toLowerCase();
          map.set(m.name, { initials, full });
        });
        setIndex(map);
      })
      .catch(() => { /* 索引加载失败时降级为纯文本搜索 */ });
    return () => { cancelled = true; };
  }, [medicines]);
  return index;
}

/** 纯字母 query 的拼音前缀匹配（AS→阿司匹林；asipilin 同样命中） */
function matchPinyin(m: Medicine, ql: string, index: PinyinIndex | null): boolean {
  if (!index) return false;
  const p = index.get(m.name);
  return !!p && (p.initials.startsWith(ql) || p.full.startsWith(ql));
}

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
  medicines: Medicine[];
  pinyinIndex: PinyinIndex | null;
  onPick: (m: Medicine) => void;
}> = ({ query, onQuery, filter, onFilter, counts, locations, location, onLocation, medicines, pinyinIndex, onPick }) => {
  const [suggestOpen, setSuggestOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // 点击联想面板外部区域关闭
  useEffect(() => {
    if (!suggestOpen) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setSuggestOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [suggestOpen]);

  // 实时联想：名称/症状/位置模糊匹配 + 拼音首字母前缀（AS→阿司匹林）+ 全拼前缀
  const suggestions = useMemo(() => {
    const q = query.trim();
    if (!q || !suggestOpen) return [];
    const ql = q.toLowerCase();
    const isAlpha = /^[a-z]+$/i.test(q);
    return medicines.filter(m => {
      if (m.name.toLowerCase().includes(ql)) return true;
      if (m.symptoms_treated.toLowerCase().includes(ql)) return true;
      if ((m.location || '').toLowerCase().includes(ql)) return true;
      if (isAlpha && matchPinyin(m, ql, pinyinIndex)) return true;
      return false;
    }).slice(0, 6);
  }, [query, suggestOpen, medicines, pinyinIndex]);

  return (
  <div className="w-full flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
    <div className="relative flex-1 max-w-xl" ref={boxRef}>
      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-m3-primary">
        <Icon name="search" className="w-5 h-5" />
      </div>
      <input
        type="text"
        value={query}
        onChange={e => onQuery(e.target.value)}
        onFocus={() => setSuggestOpen(true)}
        onKeyDown={e => { if (e.key === 'Escape') setSuggestOpen(false); }}
        className="w-full h-12 pl-11 pr-4 bg-m3-surface-container-lowest rounded-full text-sm text-m3-on-surface placeholder:text-m3-outline shadow-[0_2px_10px_rgba(15,118,110,0.03)] outline-none focus:ring-2 focus:ring-m3-primary/20 transition-all"
        placeholder="搜索名称、症状或拼音首字母（如 AS→阿司匹林）..."
        aria-label="搜索药品"
      />

      {/* 实时联想下拉 */}
      {suggestions.length > 0 && (
        <div className="absolute z-40 top-full mt-2 left-0 right-0 bg-m3-surface-container-lowest rounded-2xl shadow-[0_16px_40px_-8px_rgba(0,0,0,0.18)] py-1.5 max-h-[288px] overflow-y-auto">
          {suggestions.map(m => {
            const meta = getCategoryMeta(m.category);
            const st = getStatus(m);
            return (
              <button
                key={m.id}
                type="button"
                onMouseDown={e => { e.preventDefault(); setSuggestOpen(false); onPick(m); }}
                className="w-full flex items-center gap-3 px-3.5 py-2.5 hover:bg-m3-surface-container-low active:bg-m3-surface-container text-left transition-colors"
              >
                <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-gradient-to-br ${meta.iconBg} ${meta.iconColor}`}>
                  <Icon name={meta.icon} className="w-[18px] h-[18px]" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-m3-on-surface truncate">{m.name}</span>
                  <span className="block text-[11px] text-m3-on-surface-variant truncate mt-0.5">
                    {m.category}{m.symptoms_treated ? ` · ${m.symptoms_treated}` : ''}
                  </span>
                </span>
                <span className={`${st.badgeClass} shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap`}>{st.label}</span>
              </button>
            );
          })}
        </div>
      )}
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
      {locations.length > 1 && (() => {
        const locOptions: SelectOption[] = [
          { value: '', label: '所有存放位置', icon: 'grid_view', iconWrap: 'bg-m3-primary/10 text-m3-primary', trailing: String(medicines.length) },
          ...locations.map(loc => ({
            value: loc,
            label: loc,
            icon: 'room' as IconName,
            iconWrap: 'bg-m3-surface-container-high text-m3-on-surface-variant',
            trailing: String(medicines.filter(m => (m.location || '') === loc).length),
          })),
        ];
        return (
          <M3Select
            variant="pill"
            ariaLabel="按存放位置筛选"
            menuWidth="auto"
            value={location}
            options={locOptions}
            onChange={onLocation}
          />
        );
      })()}
    </div>
  </div>
  );
};

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
  medicines: Medicine[], query: string, filter: FilterKey, location: string,
  pinyinIndex: PinyinIndex | null = null
): Medicine[] {
  return useMemo(() => {
    let result = medicines;
    const q = query.trim();
    if (q) {
      const ql = q.toLowerCase();
      const isAlpha = /^[a-z]+$/i.test(q);
      result = result.filter(m =>
        m.name.toLowerCase().includes(ql) ||
        m.symptoms_treated.toLowerCase().includes(ql) ||
        (m.location || '').toLowerCase().includes(ql) ||
        (isAlpha && matchPinyin(m, ql, pinyinIndex))
      );
    }
    result = result.filter(m => matchFilter(m, filter));
    if (location) result = result.filter(m => (m.location || '') === location);
    return result;
  }, [medicines, query, filter, location, pinyinIndex]);
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

// ============ 移动端健康概览卡（与桌面指标卡同口径的 2x2 四格） ============

export const MobileHealthCard: React.FC<{ o: HealthOverview; filter: FilterKey; onFilter: (f: FilterKey) => void }> = ({ o, filter, onFilter }) => {
  return (
    <div className="p-4 rounded-2xl bg-m3-surface-container-lowest shadow-[0_4px_20px_-2px_rgba(15,118,110,0.06)] flex flex-col gap-3">
      <div className="flex flex-col">
        <span className="text-base font-semibold text-m3-on-surface">家庭药箱状态 · {o.grade}</span>
        <span className="text-xs text-m3-on-surface-variant mt-0.5">{o.headline}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {([
          { label: '全部储备种类', value: o.total, cls: 'bg-m3-surface-container-low', vCls: 'text-m3-on-surface', f: 'all' as FilterKey },
          { label: '库存告急', value: o.low + o.out, cls: 'bg-m3-tertiary-fixed/30', vCls: 'text-m3-tertiary', f: 'low' as FilterKey },
          { label: '已过期/待清理', value: o.expired, cls: 'bg-m3-error-container/40', vCls: 'text-m3-error', f: 'expired' as FilterKey },
          { label: '正常备用', value: o.normal, cls: 'bg-m3-primary-fixed/40', vCls: 'text-m3-primary', f: 'normal' as FilterKey },
        ]).map(cell => (
          <button
            key={cell.label}
            type="button"
            onClick={() => onFilter(cell.f)}
            className={`p-2.5 rounded-xl flex flex-col text-left ${cell.cls} ${filter === cell.f ? 'ring-2 ring-m3-primary/30' : ''}`}
          >
            <span className="text-[11px] text-m3-on-surface-variant">{cell.label}</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className={`text-xl font-bold ${cell.vCls}`}>{cell.value}</span>
              <span className="text-[11px] text-m3-on-surface-variant">种</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
