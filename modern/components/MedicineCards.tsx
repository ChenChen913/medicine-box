/**
 * 文件名: modern/components/MedicineCards.tsx
 * 功能: 新版 UI 的药品卡片
 * 描述: 三种卡片形态，均按设计稿还原并接入真实数据：
 *       - DesktopCard  桌面端大卡（渐变图标方块 + 适应症条 + 大号库存 + 吃药按钮）
 *       - MobileCard   移动端大卡（三列库存读数区 + 吃药按钮）
 *       - MobileMiniCard 移动端小卡（外用/器械类双列网格，取用 1 次完成）
 */

import React from 'react';
import { Medicine } from '../../types';
import { getStatus, usableDays, formatExpiryShort, getCategoryMeta } from '../ui';
import { Icon } from '../icons';

export const CONSUME_PLACEHOLDER = '__dialog__';

interface CardActions {
  /** 打开数量确认弹窗（桌面/移动大卡）；传 CONSUME_PLACEHOLDER */
  onRequestConsume: (med: Medicine) => void;
  onOpenDetail: (med: Medicine) => void;
  onAddToRestock: (med: Medicine) => void;
  /** 移动端小卡「取用」直接扣 1 件 */
  onQuickConsume?: (med: Medicine) => void;
}

/** 卡片通用头部（渐变图标 + 名称 + 副标题 + 状态徽章） */
function CardHead({ med, subtitle, compact }: { med: Medicine; subtitle: string; compact?: boolean }) {
  const meta = getCategoryMeta(med.category);
  const status = getStatus(med);
  return (
    <div className="flex items-start justify-between gap-2">
      <div className={`flex items-center ${compact ? 'gap-2.5' : 'gap-3'} min-w-0`}>
        <div
          className={`${compact ? 'w-10 h-10 rounded-xl' : 'w-12 h-12 rounded-2xl'} bg-gradient-to-br ${meta.iconBg} flex items-center justify-center ${meta.iconColor} shrink-0 shadow-inner`}
        >
          <Icon name={meta.icon} className={`${compact ? 'w-5 h-5' : 'w-6 h-6'}`} />
        </div>
        <div className="flex flex-col min-w-0">
          <span className={`font-semibold text-m3-on-surface truncate ${compact ? 'text-sm' : 'text-base'}`}>{med.name}</span>
          <span className="text-xs text-m3-on-surface-variant truncate">{subtitle}</span>
        </div>
      </div>
      <span className={`${status.badgeClass} shrink-0 px-2 py-0.5 rounded-full text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap`}>
        {status.key === 'normal' && <span className="w-1.5 h-1.5 rounded-full bg-m3-primary" />}
        {status.key === 'expiring' && <Icon name="alarm" className="w-3 h-3" />}
        {status.label}
      </span>
    </div>
  );
}

/** 用法说明（schedule 图标 + 文本；未填写时不渲染，避免占位文案增加视觉噪音） */
function DosageLine({ med, className = '' }: { med: Medicine; className?: string }) {
  if (!med.dosage_instruction) return null;
  return (
    <div className={`flex items-center gap-1.5 text-m3-on-surface-variant text-[13px] min-w-0 ${className}`}>
      <Icon name="schedule" className="w-4 h-4 text-m3-primary shrink-0" />
      <span className="truncate">{med.dosage_instruction}</span>
    </div>
  );
}

/** 吃药打卡按钮（默认剂量 = 每次用量，库存不足时 clamp） */
export function ConsumeButton({ med, onClick, label }: { med: Medicine; onClick: () => void; label?: string }) {
  const dose = Math.max(1, Math.min(med.daily_usage || 1, med.total_quantity));
  const disabled = med.total_quantity <= 0 || getStatus(med).key === 'expired';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1 px-4 py-1.5 rounded-full bg-m3-primary-fixed text-m3-on-primary-fixed-variant text-[13px] font-semibold shadow-sm active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none shrink-0"
    >
      <Icon name="check_circle" className="w-4 h-4" />
      <span>{label ?? (dose > 1 ? `吃药 -${dose}${med.unit}` : '吃药打卡')}</span>
    </button>
  );
}

// ============ 桌面大卡 ============

export const DesktopCard: React.FC<{ med: Medicine } & CardActions> = ({ med, onRequestConsume, onOpenDetail, onAddToRestock }) => {
  const status = getStatus(med);
  const remain = usableDays(med);

  return (
    <article className="group bg-m3-surface-container-lowest rounded-2xl p-5 shadow-[0_4px_20px_-2px_rgba(15,118,110,0.04)] hover:shadow-[0_12px_28px_-4px_rgba(15,118,110,0.10)] transition-all flex flex-col justify-between gap-3">
      <div className="flex flex-col gap-3">
        <CardHead
          med={med}
          subtitle={`${med.form_type}${med.brand ? ' · ' + med.brand : ''}${med.location ? ' · ' + med.location : ''}`}
        />

        {med.symptoms_treated && (
          <div className="px-3 py-1.5 rounded-xl bg-m3-surface-container-low text-[13px] text-m3-on-surface-variant flex items-center gap-1.5">
            <Icon name="medical_services" className="w-4 h-4 text-m3-primary shrink-0" />
            <span className="truncate">主治 {med.symptoms_treated}</span>
          </div>
        )}

        <div className="flex items-baseline justify-between pt-1">
          <div className="flex items-baseline gap-1 min-w-0">
            <span className={`text-[30px] leading-9 font-extrabold tracking-tight ${status.emphasisClass}`}>{med.total_quantity}</span>
            <span className="text-xs text-m3-on-surface-variant font-medium">{med.unit}</span>
            {remain !== null && (
              <span className="text-[13px] text-m3-on-surface-variant ml-2 truncate">
                {status.key === 'expired' ? '已失效' : remain > 0 ? `约可用 ${remain} 天` : '余量不足 1 天'}
              </span>
            )}
          </div>
          {status.key === 'expired' ? (
            <span className="text-[11px] text-m3-error font-medium shrink-0">有效期至 {formatExpiryShort(med.expiry_date)}</span>
          ) : status.key === 'low' || status.key === 'out' ? (
            <button
              type="button"
              onClick={() => onAddToRestock(med)}
              className="text-[11px] text-m3-primary hover:underline flex items-center gap-0.5 shrink-0"
            >
              + 加入待购
            </button>
          ) : (
            <span className="text-[11px] text-m3-on-surface-variant shrink-0">有效期至 {formatExpiryShort(med.expiry_date)}</span>
          )}
        </div>
      </div>

      <div className="pt-3 border-t border-m3-surface-container-low flex items-center justify-between gap-2">
        <DosageLine med={med} className="flex-1" />
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onOpenDetail(med)}
            className="px-2.5 py-1.5 rounded-full text-m3-on-surface-variant hover:text-m3-primary hover:bg-m3-surface-container-low text-xs transition-colors"
          >
            详情
          </button>
          <ConsumeButton med={med} onClick={() => onRequestConsume(med)} />
        </div>
      </div>
    </article>
  );
};

// ============ 移动大卡 ============

export const MobileCard: React.FC<{ med: Medicine } & CardActions> = ({ med, onRequestConsume, onOpenDetail, onAddToRestock }) => {
  const status = getStatus(med);
  const remain = usableDays(med);

  return (
    <div
      className="p-4 rounded-2xl bg-m3-surface-container-lowest shadow-[0_4px_20px_-2px_rgba(15,118,110,0.05)] flex flex-col gap-3"
      onClick={() => onOpenDetail(med)}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDetail(med); } }}
    >
      <CardHead med={med} subtitle={`${med.form_type}${med.brand ? ' · ' + med.brand : ''}${med.symptoms_treated ? ' · ' + med.symptoms_treated.split(',')[0] : ''}`} />

      {/* 库存读数区：三列（当前库存 / 估算可用 / 有效期至） */}
      <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-m3-surface-container-low">
        <div className="flex flex-col items-start px-1.5">
          <span className="text-[11px] text-m3-on-surface-variant">当前库存</span>
          <div className="flex items-baseline gap-0.5 mt-0.5">
            <span className={`text-lg font-bold ${status.emphasisClass}`}>{med.total_quantity}</span>
            <span className="text-[11px] text-m3-on-surface-variant">{med.unit}</span>
          </div>
        </div>
        <div className="flex flex-col items-start px-1.5">
          <span className="text-[11px] text-m3-on-surface-variant">估算可用</span>
          <span className="text-sm font-semibold text-m3-on-surface mt-1">
            {status.key === 'expired' ? '已失效' : remain !== null ? `约 ${remain} 天` : '—'}
          </span>
        </div>
        <div className="flex flex-col items-start px-1.5">
          <span className="text-[11px] text-m3-on-surface-variant">有效期至</span>
          <span className="text-sm font-semibold text-m3-on-surface mt-1">{formatExpiryShort(med.expiry_date)}</span>
        </div>
      </div>

      {/* 操作区：过期 → 清理提醒（加入补货清单）；告急 → 加入补货；其余 → 吃药打卡 */}
      <div className="flex items-center justify-between gap-2">
        <DosageLine med={med} className="flex-1" />
        {status.key === 'expired' || status.key === 'low' || status.key === 'out' ? (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onAddToRestock(med); }}
            className="flex items-center gap-1 px-3.5 py-1.5 rounded-full bg-m3-surface-container text-m3-primary text-xs font-semibold active:scale-95 transition-all shrink-0"
          >
            <Icon name="shopping_cart" className="w-4 h-4" />
            <span>{status.key === 'expired' ? '清理提醒' : '加入补货'}</span>
          </button>
        ) : (
          <span onClick={e => e.stopPropagation()} role="presentation">
            <ConsumeButton med={med} onClick={() => onRequestConsume(med)} />
          </span>
        )}
      </div>
    </div>
  );
};

// ============ 移动小卡（外用/器械等轻量物资） ============

export const MobileMiniCard: React.FC<{ med: Medicine } & CardActions> = ({ med, onOpenDetail, onQuickConsume }) => {
  const status = getStatus(med);
  return (
    <div
      className="p-4 rounded-2xl bg-m3-surface-container-lowest shadow-[0_4px_16px_rgba(0,0,0,0.03)] flex flex-col justify-between gap-2"
      onClick={() => onOpenDetail(med)}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDetail(med); } }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${status.key === 'expired' ? 'bg-m3-error-container/40 text-m3-error' : 'bg-m3-secondary-container/50 text-m3-primary'}`}>
            <Icon name={getCategoryMeta(med.category).icon} className="w-[18px] h-[18px]" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold text-m3-on-surface truncate">{med.name}</span>
            <span className={`text-[11px] truncate ${status.key === 'expired' ? 'text-m3-error font-medium' : 'text-m3-on-surface-variant'}`}>{status.label}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-baseline gap-1">
          <span className="text-lg font-bold text-m3-on-surface">{med.total_quantity}</span>
          <span className="text-[11px] text-m3-on-surface-variant">{med.unit}剩余</span>
        </div>
        <button
          type="button"
          disabled={med.total_quantity <= 0}
          onClick={e => { e.stopPropagation(); onQuickConsume?.(med); }}
          className="px-3 py-1 rounded-full bg-m3-surface-container-low hover:bg-m3-surface-container text-m3-on-surface text-xs font-medium active:scale-95 transition-all disabled:opacity-40"
        >
          取用 1{med.unit}
        </button>
      </div>
    </div>
  );
};
