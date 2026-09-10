/**
 * 文件名: modern/components/Views.tsx
 * 功能: 新版 UI 的两个次级视图
 * 描述: - RestockView 需补货清单（对应设计稿的「需补货」页签，
 *           「已买入」走补货登记弹窗 → restockMedicine，与经典版同一服务层）
 *       - LogsView 用药记录（真实 usage_logs 数据，按日期倒序分组展示）
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ShoppingItem, ShoppingStatus, UsageLog } from '../../types';
import { MedicineService } from '../../services/medicineService';
import { formatLogTime } from '../ui';
import { Icon } from '../icons';
import { RestockDialog } from './Dialogs';

const REASON_STYLE: Record<string, string> = {
  '过期': 'bg-m3-error-container text-m3-error',
  '用尽': 'bg-m3-tertiary-fixed text-m3-on-tertiary-fixed-variant',
};

export const RestockView: React.FC<{ onChanged: () => void }> = ({ onChanged }) => {
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [restockItem, setRestockItem] = useState<ShoppingItem | null>(null);

  const reloadItems = () =>
    MedicineService.getShoppingList()
      .then(all => setItems(all.filter(i => i.status === ShoppingStatus.PENDING)))
      .catch(e => console.error('[RestockView] 清单刷新失败：', e));

  useEffect(() => {
    reloadItems().finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-0">
      <div className="flex items-center gap-3 mb-5">
        <h1 className="text-xl md:text-2xl font-bold text-m3-on-surface tracking-tight">需补货清单</h1>
        {items.length > 0 && (
          <span className="px-2.5 py-1 rounded-full bg-m3-tertiary-fixed text-m3-on-tertiary-fixed-variant text-xs font-bold">{items.length} 项</span>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-m3-on-surface-variant py-16 text-center">正在加载清单…</p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 bg-m3-surface-container-lowest rounded-3xl border border-dashed border-m3-outline-variant">
          <div className="w-14 h-14 rounded-2xl bg-m3-primary/10 text-m3-primary flex items-center justify-center mb-4">
            <Icon name="shopping_bag" className="w-7 h-7" />
          </div>
          <p className="text-sm font-medium text-m3-on-surface">目前没有需要补货的药品</p>
          <p className="text-xs text-m3-on-surface-variant mt-1.5">药品「过期」或「用完」时会自动出现在这里</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map(item => (
            <div key={item.id} className="bg-m3-surface-container-lowest p-4 md:p-5 rounded-2xl shadow-[0_4px_20px_-2px_rgba(15,118,110,0.04)] flex items-center justify-between gap-3 hover:shadow-md transition-shadow">
              <div className="min-w-0">
                <h3 className="font-semibold text-m3-on-surface truncate">{item.medicine_name}</h3>
                <div className="flex items-center gap-2.5 mt-2 flex-wrap">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${REASON_STYLE[item.reason] ?? 'bg-m3-surface-container-high text-m3-on-surface-variant'}`}>
                    原因：{item.reason}
                  </span>
                  <span className="text-[11px] text-m3-on-surface-variant">加入于 {formatLogTime(item.created_at)}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRestockItem(item)}
                className="shrink-0 px-5 py-2.5 rounded-full bg-m3-primary text-m3-on-primary text-sm font-semibold shadow-md hover:bg-m3-primary-container active:scale-[0.98] transition-all whitespace-nowrap"
              >
                已买入
              </button>
            </div>
          ))}
        </div>
      )}

      {restockItem && (
        <RestockDialog
          item={{ id: restockItem.id, medicine_name: restockItem.medicine_name }}
          onClose={() => setRestockItem(null)}
          onDone={() => {
            setRestockItem(null);
            onChanged();
            reloadItems();
          }}
        />
      )}
    </div>
  );
};

// ============ 用药记录 ============

export const LogsView: React.FC<{ logs: UsageLog[]; loading: boolean }> = ({ logs, loading }) => {
  const grouped = useMemo(() => {
    const groups: { label: string; items: UsageLog[] }[] = [];
    const idx = new Map<string, number>();
    logs.slice(0, 100).forEach(log => {
      const d = new Date(log.log_time);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const label = formatLogTime(log.log_time).split(' ')[0];
      if (!idx.has(key)) {
        idx.set(key, groups.length);
        groups.push({ label, items: [] });
      }
      groups[idx.get(key)!].items.push(log);
    });
    return groups;
  }, [logs]);

  // "现在"只在挂载时取一次（渲染期调用 Date.now() 违反组件纯函数约束）
  const [nowTs] = useState(() => Date.now());
  const total30 = useMemo(() => {
    const from = nowTs - 30 * 86400000;
    return logs.filter(l => new Date(l.log_time).getTime() >= from).length;
  }, [logs, nowTs]);

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-0">
      <div className="flex items-center justify-between gap-3 mb-5">
        <h1 className="text-xl md:text-2xl font-bold text-m3-on-surface tracking-tight">用药记录</h1>
        <span className="text-xs text-m3-on-surface-variant">近 30 天共 {total30} 次打卡</span>
      </div>

      {logs.length > 100 && (
        <p className="mb-4 text-[11px] text-m3-outline text-center">记录较多，当前展示最近 100 条；完整记录可通过「数据备份与恢复」导出查看</p>
      )}

      {loading ? (
        <p className="text-sm text-m3-on-surface-variant py-16 text-center">正在加载记录…</p>
      ) : logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 bg-m3-surface-container-lowest rounded-3xl border border-dashed border-m3-outline-variant">
          <div className="w-14 h-14 rounded-2xl bg-m3-primary/10 text-m3-primary flex items-center justify-center mb-4">
            <Icon name="event_available" className="w-7 h-7" />
          </div>
          <p className="text-sm font-medium text-m3-on-surface">还没有用药打卡记录</p>
          <p className="text-xs text-m3-on-surface-variant mt-1.5">在药箱页面点击「吃药打卡」即可开始记录</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {grouped.map(g => (
            <div key={g.label}>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-1 h-3.5 rounded-full bg-m3-primary" />
                <h2 className="text-sm font-bold text-m3-on-surface">{g.label}</h2>
                <span className="text-[11px] text-m3-on-surface-variant">{g.items.length} 次</span>
              </div>
              <div className="flex flex-col gap-2">
                {g.items.map(log => (
                  <div key={log.id} className="bg-m3-surface-container-lowest px-4 py-3 rounded-2xl shadow-[0_2px_10px_rgba(15,118,110,0.03)] flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-m3-primary/10 text-m3-primary flex items-center justify-center shrink-0">
                        <Icon name="check" className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <span className="text-sm font-medium text-m3-on-surface truncate block">{log.medicine_name}</span>
                        {/* 品牌快照徽标：同名药不同品牌的用量在此分明 */}
                        {log.brand && (
                          <span className="inline-flex items-center gap-0.5 mt-0.5 px-1.5 py-px rounded-full bg-m3-secondary-fixed/50 text-m3-on-secondary-container text-[10px] font-semibold max-w-full">
                            <Icon name="medication" className="w-3 h-3 shrink-0" />
                            <span className="truncate">{log.brand}</span>
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold text-m3-primary">−{log.amount}</div>
                      <div className="text-[11px] text-m3-on-surface-variant">{formatLogTime(log.log_time).split(' ').slice(1).join(' ')}{log.user ? ` · ${log.user}` : ''}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};