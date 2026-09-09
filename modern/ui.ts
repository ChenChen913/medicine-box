/**
 * 文件名: modern/ui.ts
 * 功能: 新版 UI 的状态计算与展示工具（纯函数）
 * 描述: 从真实药品数据推导设计稿中的各类视觉元素：
 *       药品状态徽章、家庭储药健康指数、分类图标映射、时间格式化等。
 *       全部复用 services/medicineService 的本地时区日期纪律（todayDateString）。
 */

import { Medicine } from '../types';
import { todayDateString } from '../services/medicineService';
import { IconName } from './icons';

// ============ 药品状态 ============

export type MedStatusKey = 'normal' | 'low' | 'out' | 'expiring' | 'expired';

export interface MedStatus {
  key: MedStatusKey;
  /** 徽章文案（含动态数字，如「已过期 12 天」「仅剩 2 天用量」） */
  label: string;
  /** 徽章配色（tailwind 类） */
  badgeClass: string;
  /** 大数字的强调色（tailwind 文本类） */
  emphasisClass: string;
}

const EXPIRING_WINDOW_DAYS = 30;

function daysBetween(fromStr: string, toStr: string): number {
  const from = new Date(`${fromStr}T00:00:00`);
  const to = new Date(`${toStr}T00:00:00`);
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

/** 估算还能用几天（每日用量有效时才有意义） */
export function usableDays(m: Medicine): number | null {
  if (!m.daily_usage || m.daily_usage <= 0) return null;
  return Math.floor(m.total_quantity / m.daily_usage);
}

export function getStatus(m: Medicine, today: string = todayDateString()): MedStatus {
  // 过期优先级最高：无论库存多少，过期药品都不能再标注为「正常」
  if (m.expiry_date && m.expiry_date < today) {
    const over = Math.max(1, -daysBetween(m.expiry_date, today));
    return {
      key: 'expired',
      label: `已过期 ${over} 天`,
      badgeClass: 'bg-m3-error-container text-m3-error',
      emphasisClass: 'text-m3-error',
    };
  }

  if (m.total_quantity === 0) {
    return {
      key: 'out',
      label: '已用尽',
      badgeClass: 'bg-m3-surface-container-high text-m3-on-surface-variant',
      emphasisClass: 'text-m3-on-surface-variant',
    };
  }

  const remain = usableDays(m);
  if (m.total_quantity <= m.threshold) {
    return {
      key: 'low',
      label: remain !== null && remain <= 3 ? `库存告急 (仅剩${remain}天)` : '库存告急',
      badgeClass: 'bg-m3-tertiary-fixed text-m3-tertiary-container',
      emphasisClass: 'text-m3-tertiary',
    };
  }

  if (m.expiry_date) {
    const left = daysBetween(today, m.expiry_date);
    if (left <= EXPIRING_WINDOW_DAYS) {
      return {
        key: 'expiring',
        label: `还有 ${left} 天过期`,
        badgeClass: 'bg-m3-tertiary-fixed text-m3-tertiary-container',
        emphasisClass: 'text-m3-on-surface',
      };
    }
  }

  return {
    key: 'normal',
    label: '状态正常',
    badgeClass: 'bg-m3-primary/10 text-m3-primary',
    emphasisClass: m.total_quantity > m.threshold * 3 ? 'text-m3-primary' : 'text-m3-on-surface',
  };
}

// ============ 家庭储药健康指数 ============

export interface HealthOverview {
  total: number;
  normal: number;
  low: number;
  out: number;
  expired: number;
  expiringSoon: number;
  /** 0-100 的健康指数 */
  score: number;
  /** 指数评级 */
  grade: string;
  /** 主标题（横幅 headline，基于真实数据动态生成） */
  headline: string;
}

export function getHealthOverview(medicines: Medicine[]): HealthOverview {
  const today = todayDateString();
  const total = medicines.length;

  let low = 0, out = 0, expired = 0, expiringSoon = 0;
  medicines.forEach(m => {
    const s = getStatus(m, today);
    if (s.key === 'expired') expired += 1;
    else if (s.key === 'out') out += 1;
    else if (s.key === 'low') low += 1;
    else if (s.key === 'expiring') expiringSoon += 1;
  });

  const normal = total - low - out - expired;
  const score = total === 0 ? 100 : Math.round((normal / total) * 100);

  let grade = '需关注';
  if (score >= 85) grade = '优良';
  else if (score >= 70) grade = '良好';
  else if (score >= 50) grade = '一般';

  const headline = expired > 0
    ? '药箱中有过期药品，建议尽快清理更换'
    : low + out > 0
      ? '部分常备药品库存偏低，建议及时补足'
      : '今日药箱状态良好，常备物资充裕';

  return { total, normal, low, out, expired, expiringSoon, score, grade, headline };
}

// ============ 分类视觉映射 ============

export interface CategoryMeta {
  icon: IconName;
  /** 图标方块渐变（tailwind 类） */
  iconBg: string;
  /** 图标颜色（tailwind 类） */
  iconColor: string;
}

/** 分类 → 图标/配色映射（Task 9 语义化重选：图标与症状/病因直接对应） */
export function getCategoryMeta(category: string): CategoryMeta {
  const c = category || '其他';
  if (c.includes('心脑')) return { icon: 'favorite', iconBg: 'from-m3-error-container/60 to-m3-error-container/20', iconColor: 'text-m3-error' };
  if (c.includes('感冒') || c.includes('呼吸')) return { icon: 'coronavirus', iconBg: 'from-m3-secondary-fixed/40 to-m3-primary-fixed/20', iconColor: 'text-m3-primary' };
  if (c.includes('止痛')) return { icon: 'painkiller', iconBg: 'from-m3-primary-fixed/40 to-m3-secondary-fixed/30', iconColor: 'text-m3-primary' };
  if (c.includes('肠胃')) return { icon: 'stomach', iconBg: 'from-m3-tertiary-fixed to-m3-tertiary-fixed-dim/40', iconColor: 'text-m3-tertiary' };
  if (c.includes('抗生素')) return { icon: 'bacteria', iconBg: 'from-m3-surface-container-high to-m3-surface-container', iconColor: 'text-m3-primary' };
  if (c.includes('外用')) return { icon: 'ointment', iconBg: 'from-m3-primary-fixed/40 to-m3-secondary-fixed/30', iconColor: 'text-m3-primary' };
  if (c.includes('过敏')) return { icon: 'spa', iconBg: 'from-m3-secondary-fixed/40 to-m3-primary-fixed/20', iconColor: 'text-m3-secondary' };
  if (c.includes('咽喉')) return { icon: 'throat', iconBg: 'from-m3-tertiary-fixed to-m3-surface-container', iconColor: 'text-m3-tertiary' };
  if (c.includes('保健')) return { icon: 'eco', iconBg: 'from-m3-secondary-fixed/30 to-m3-primary-fixed/20', iconColor: 'text-m3-secondary' };
  if (c.includes('器械')) return { icon: 'medical_services', iconBg: 'from-m3-primary-fixed/40 to-m3-secondary-fixed/30', iconColor: 'text-m3-primary' };
  if (c.includes('眼科')) return { icon: 'eye', iconBg: 'from-m3-surface-container-high to-m3-surface-container', iconColor: 'text-m3-primary' };
  return { icon: 'medication', iconBg: 'from-m3-primary-fixed/40 to-m3-secondary-fixed/30', iconColor: 'text-m3-primary' };
}

// ============ 时间格式化 ============

function pad(n: number): string { return String(n).padStart(2, '0'); }

/** 打卡记录时间 → 「今日 12:40」「昨日 08:15」「09-03 21:10」 */
export function formatLogTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const dayStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const yesterday = new Date(now.getTime() - 86400000);
  const yesterdayStr = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`;
  if (dayStr === todayStr) return `今日 ${hm}`;
  if (dayStr === yesterdayStr) return `昨日 ${hm}`;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
}

/** 效期展示：YYYY-MM-DD → YYYY-MM（设计稿样式） */
export function formatExpiryShort(expiry: string): string {
  if (!expiry || expiry.length < 7) return expiry || '—';
  return expiry.slice(0, 7).replace('-', '.');
}
