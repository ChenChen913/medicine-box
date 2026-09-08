/**
 * 文件名: modern/components/DetailDrawer.tsx
 * 功能: 药品详情弹窗（新版 UI）
 * 描述: 屏幕正中央的居中弹窗（桌面/移动统一），内部可上下滑动，
 *       点击空白遮罩即可关闭 —— 适合单手操作。
 *       全部展示真实数据：库存、效期、用法、禁忌、位置、适应症、
 *       该药最近打卡时间线（usage_logs）；
 *       「30 天库存消耗趋势」由当前库存 + 打卡记录反推估算（无记录时优雅降级）。
 *       操作：补货标记 / 打卡服药 / 编辑 / 删除。
 */

import React, { useMemo } from 'react';
import { Medicine, UsageLog } from '../../types';
import { getStatus, usableDays, formatLogTime, getCategoryMeta } from '../ui';
import { Icon } from '../icons';

interface Props {
  med: Medicine;
  /** 该药的全部打卡记录（组件内部自行过滤时间窗） */
  logs: UsageLog[];
  onClose: () => void;
  onConsume: (med: Medicine) => void;
  onRestock: (med: Medicine) => void;
  onEdit: (med: Medicine) => void;
  onDelete: (med: Medicine) => void;
}

const DAY_MS = 86400000;
const TREND_WINDOW_DAYS = 30;

/** 用打卡记录 + 当前库存反推近 30 天库存走势（估算值，供趋势图使用） */
function estimateTrend(med: Medicine, logs: UsageLog[]): { points: { x: number; y: number }[]; consumed: number } {
  const now = Date.now();
  const from = now - TREND_WINDOW_DAYS * DAY_MS;
  const recent = logs
    .filter(l => String(l.medicine_id) === String(med.id))
    .filter(l => {
      const t = new Date(l.log_time).getTime();
      return Number.isFinite(t) && t >= from;
    })
    .sort((a, b) => a.log_time.localeCompare(b.log_time));

  if (recent.length < 2) return { points: [], consumed: 0 };

  // 从当前库存向前逐条「归还」扣减量，得到每个打卡时点的库存估计
  let running = med.total_quantity;
  const pts = recent.map(l => {
    running += l.amount;
    return {
      x: Math.round(((new Date(l.log_time).getTime() - from) / (TREND_WINDOW_DAYS * DAY_MS)) * 300),
      y: running,
    };
  });
  const consumed = recent.reduce((s, l) => s + l.amount, 0);

  // 归一化到 300x56 的 SVG 视窗
  const maxY = Math.max(...pts.map(p => p.y), 1);
  const minY = Math.min(...pts.map(p => p.y), 0);
  const range = Math.max(maxY - minY, 1);
  const points = [
    { x: 0, y: pts[0].y },
    ...pts.slice(1),
  ].map(p => ({
    x: Math.min(300, Math.max(0, p.x)),
    y: 4 + (1 - (p.y - minY) / range) * 48,
  }));

  return { points, consumed };
}

export const DetailDrawer: React.FC<Props> = ({ med, logs, onClose, onConsume, onRestock, onEdit, onDelete }) => {
  const meta = getCategoryMeta(med.category);
  const status = getStatus(med);
  const remain = usableDays(med);

  const myLogs = useMemo(
    () => logs.filter(l => String(l.medicine_id) === String(med.id)).slice(0, 5),
    [logs, med.id]
  );

  const { points: trendPoints, consumed } = useMemo(() => estimateTrend(med, logs), [med, logs]);
  const trendPath = trendPoints.length >= 2
    ? `M ${trendPoints.map(p => `${p.x} ${p.y.toFixed(1)}`).join(' L ')}`
    : '';

  return (
    <>
      {/* 背景遮罩：点击空白处直接关闭（单手友好） */}
      <div className="fixed inset-0 bg-m3-on-surface/30 backdrop-blur-[2px] z-[60] animate-in fade-in duration-200" onClick={onClose} />

      {/* 居中弹窗容器：pointer-events-none 让空白区域点击穿透到遮罩 */}
      <div className="fixed inset-0 z-[61] flex items-center justify-center p-4 pointer-events-none">
        <div
          className="pointer-events-auto relative w-full max-w-lg max-h-[86vh] bg-m3-surface-container-lowest rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
          role="dialog"
          aria-modal="true"
          aria-label={`${med.name} 详情`}
        >

        {/* 头部 */}
        <div className="px-5 md:px-6 py-4 border-b border-m3-surface-container-low flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${meta.iconBg} flex items-center justify-center ${meta.iconColor} shrink-0`}>
              <Icon name={meta.icon} className="w-[22px] h-[22px]" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-m3-on-surface tracking-tight truncate">{med.name}</h2>
              <span className="text-xs text-m3-on-surface-variant truncate block">{med.form_type}{med.location ? ` · ${med.location}` : ''}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button type="button" aria-label="编辑药品" onClick={() => onEdit(med)}
              className="w-9 h-9 rounded-full bg-m3-surface-container-low hover:bg-m3-surface-container text-m3-on-surface-variant flex items-center justify-center transition-colors">
              <Icon name="edit" className="w-[18px] h-[18px]" />
            </button>
            <button type="button" aria-label="删除药品" onClick={() => onDelete(med)}
              className="w-9 h-9 rounded-full bg-m3-surface-container-low hover:bg-m3-error-container hover:text-m3-error text-m3-on-surface-variant flex items-center justify-center transition-colors">
              <Icon name="delete" className="w-[18px] h-[18px]" />
            </button>
            <button type="button" aria-label="关闭详情" onClick={onClose}
              className="w-9 h-9 rounded-full bg-m3-surface-container-low hover:bg-m3-surface-container text-m3-on-surface-variant flex items-center justify-center transition-colors">
              <Icon name="close" className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 可滚动内容 */}
        <div className="px-5 md:px-6 py-5 overflow-y-auto flex flex-col gap-5 flex-1 min-h-0 overscroll-contain">
          {/* 用户上传图片（仅 base64 本地图，外链一律不请求）；无图时展示优雅占位 */}
          {med.image_url && med.image_url.startsWith('data:') ? (
            <img src={med.image_url} alt={med.name} className="w-full h-40 object-cover rounded-2xl bg-m3-surface-container-low" />
          ) : (
            <div className="w-full h-28 rounded-2xl bg-gradient-to-br from-m3-primary-fixed/30 via-m3-surface-container-low to-m3-secondary-fixed/30 flex flex-col items-center justify-center gap-1.5 text-m3-outline">
              <Icon name={meta.icon} className="w-8 h-8 opacity-70" />
              <span className="text-xs font-medium">暂无实物图片</span>
            </div>
          )}

          {/* 库存 / 效期双卡 */}
          <div className="bg-m3-surface-container-low rounded-2xl p-4 flex items-center justify-between">
            <div>
              <span className="text-[11px] text-m3-on-surface-variant uppercase tracking-wider">剩余库存</span>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className={`text-[30px] leading-9 font-extrabold ${status.emphasisClass}`}>{med.total_quantity}</span>
                <span className="text-xs text-m3-on-surface-variant">{med.unit}{med.threshold > 0 ? ` · 预警值 ${med.threshold}` : ''}</span>
              </div>
            </div>
            <div className="text-right">
              <span className="text-[11px] text-m3-on-surface-variant uppercase tracking-wider">有效截止日期</span>
              <div className={`text-base font-semibold mt-0.5 ${status.key === 'expired' ? 'text-m3-error' : 'text-m3-on-surface'}`}>
                {med.expiry_date || '—'}
                {status.key === 'expired' && <span className="ml-1 text-xs">（已过期）</span>}
              </div>
            </div>
          </div>

          {/* 消耗趋势（真实打卡数据推算，记录不足时降级为提示） */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-m3-on-surface">近 30 天库存消耗趋势</span>
              <span className="text-m3-on-surface-variant">
                {trendPoints.length >= 2 ? `30 天共消耗约 ${consumed} ${med.unit}` : '暂无足够打卡记录'}
              </span>
            </div>
            {trendPoints.length >= 2 ? (
              <div className="w-full bg-m3-surface-container-low/60 rounded-xl p-3">
                <svg className="w-full h-16 text-m3-primary" viewBox="0 0 300 56" fill="none" preserveAspectRatio="none">
                  <path d={`${trendPath} L 300 56 L 0 56 Z`} fill="currentColor" fillOpacity="0.08" />
                  <path d={trendPath} stroke="currentColor" strokeLinecap="round" strokeWidth="2.5" />
                  <circle cx={trendPoints[trendPoints.length - 1].x} cy={trendPoints[trendPoints.length - 1].y} fill="currentColor" r="3.5" />
                </svg>
                <div className="flex justify-between text-[10px] text-m3-outline mt-1">
                  <span>30 天前</span>
                  <span>今日余量 {med.total_quantity}{med.unit}（估算）</span>
                </div>
              </div>
            ) : (
              <div className="w-full bg-m3-surface-container-low/60 rounded-xl p-4 text-[13px] text-m3-on-surface-variant">
                打卡 2 次以上后会自动生成消耗曲线。
                {remain !== null && ` 按当前用量，库存约可支撑 ${remain} 天。`}
              </div>
            )}
          </div>

          {/* 用法用量与禁忌 */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-m3-on-surface">用法用量与须知</span>
            <div className="bg-m3-surface-container-low rounded-xl p-3.5 flex flex-col gap-2 text-m3-on-surface-variant text-[13px] leading-relaxed">
              {med.dosage_instruction && <p><strong className="text-m3-on-surface font-semibold">服用说明：</strong>{med.dosage_instruction}</p>}
              {med.symptoms_treated && <p><strong className="text-m3-on-surface font-semibold">适应症：</strong>{med.symptoms_treated}</p>}
              <p><strong className="text-m3-on-surface font-semibold">副作用禁忌：</strong>{med.side_effects || '详见说明书'}</p>
              {med.location && <p><strong className="text-m3-on-surface font-semibold">存放位置：</strong>{med.location}</p>}
              <p><strong className="text-m3-on-surface font-semibold">最近购入：</strong>{med.last_purchase_date || '—'}</p>
            </div>
          </div>

          {/* 打卡时间线（真实记录） */}
          <div className="flex flex-col gap-2.5">
            <span className="text-xs font-semibold text-m3-on-surface">用药打卡动态</span>
            {myLogs.length === 0 ? (
              <p className="text-[13px] text-m3-on-surface-variant bg-m3-surface-container-low rounded-xl p-3.5">
                还没有该药品的打卡记录，点击下方「打卡服药」开始记录。
              </p>
            ) : (
              <div className="flex flex-col gap-3 pl-2 border-l-2 border-m3-primary/20">
                {myLogs.map(log => (
                  <div key={log.id} className="flex flex-col gap-0.5 relative pl-4">
                    <span className="w-2.5 h-2.5 rounded-full bg-m3-primary absolute -left-[21px] top-1" />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-m3-on-surface">{formatLogTime(log.log_time)} · 用药打卡</span>
                      <span className="text-[11px] text-m3-on-surface-variant shrink-0">{log.amount} {med.unit}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 底部操作 */}
        <div className="px-5 md:px-6 py-4 border-t border-m3-surface-container-low flex items-center gap-3 bg-m3-surface-container-lowest shrink-0">
          <button
            type="button"
            onClick={() => onRestock(med)}
            className="flex-1 py-2.5 rounded-full bg-m3-surface-container-low hover:bg-m3-surface-container text-m3-on-surface text-sm font-medium transition-colors"
          >
            补货标记
          </button>
          <button
            type="button"
            disabled={med.total_quantity <= 0 || status.key === 'expired'}
            onClick={() => onConsume(med)}
            className="flex-1 py-2.5 rounded-full bg-m3-primary hover:bg-m3-primary-container text-m3-on-primary text-sm font-semibold shadow-md active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none"
          >
            <Icon name="check_circle" className="w-[18px] h-[18px]" />
            <span>打卡服药</span>
          </button>
        </div>
        </div>
      </div>
    </>
  );
};
