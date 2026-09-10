/**
 * 文件名: services/medicineService.ts
 * 功能: 核心业务逻辑层
 * 描述: 双后端 —— 配置了 Supabase 环境变量时走云端 Postgres（多设备同步），
 *       否则自动降级为浏览器 localStorage（单机可用）。
 *       本文件不再依赖任何本地 Express 服务，可直接部署为纯静态站点。
 */

import { Medicine, ShoppingItem, UsageLog, FormType, ShoppingStatus } from '../types';
import { isSupabaseConfigured, getSupabase } from './supabaseClient';

interface DBStructure {
  medicines: Medicine[];
  shoppingList: ShoppingItem[];
  logs: UsageLog[];
}

const EMPTY_DB = (): DBStructure => ({ medicines: [], shoppingList: [], logs: [] });

/**
 * 任意日期 → 本地时区的 YYYY-MM-DD 字符串。
 * 说明：不要用 new Date('YYYY-MM-DD') 与 new Date() 直接比较——
 * 前者按 UTC 零点解析，后者是本地时间，在东八区过期日当天 8 点前后结果会不一致。
 * 统一转成本地日期字符串做字典序比较，完全避开时区问题。
 * 同时也不要用 new Date().toISOString().split('T')[0] 取日期——
 * 那是 UTC 日期，东八区早上 8 点前会得到「昨天」，项目里所有取日期的地方都应使用本函数。
 */
export function localDateString(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function todayDateString(): string {
  return localDateString(new Date());
}

/**
 * 分类展示权重：数值越大越靠前（常用药类目优先展示）。
 * App.tsx 的分组排序与 sortMedicines 共用此实现，避免两处逻辑漂移。
 */
export function getCategoryWeight(c: string): number {
  if (['感冒', '止痛', '肠胃', '抗生素', '心脑'].some(k => c.includes(k))) return 10;
  if (['咽喉', '抗过敏'].some(k => c.includes(k))) return 5;
  if (['外用', '眼科', '皮肤'].some(k => c.includes(k))) return 2;
  if (['保健品', '医疗器械'].some(k => c.includes(k))) return 0;
  return 5;
}

/**
 * 存储读写失败时向 UI 广播事件（App 监听后以横幅/toast 告知用户）。
 * 服务层保持与 UI 解耦，只发事件不直接操作视图。
 */
function notifyStorageError(message: string): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<string>('mb:storage-error', { detail: message }));
  }
}

// ==========================================================
// 剂型 ↔ 单位联动 + 待补货匹配（入库/编辑补货链路的核心逻辑）
// ==========================================================

/**
 * 剂型 → 默认数量单位映射（入库/编辑表单切换剂型时单位自动联动）。
 * 这是「片剂→几片、胶囊→几粒、颗粒→几袋」等对应关系的单一数据源，
 * 表单（modern/components/Dialogs.tsx）直接引用，避免两处漂移。
 * 用户仍可在表单中手动改单位；映射只在切换剂型那一刻生效。
 */
export const FORM_UNIT_MAP: Record<string, string> = {
  [FormType.TABLET]: '片',
  [FormType.CAPSULE]: '粒',
  [FormType.GRANULE]: '袋',
  [FormType.LIQUID]: '支',
  [FormType.TOPICAL]: '瓶',
  [FormType.SPRAY]: '瓶',
  [FormType.OTHER]: '盒',
};

/** 各剂型在药品名称中的常见关键词（用于从名称反推剂型，辅助匹配） */
const FORM_KEYWORDS: Record<string, string[]> = {
  [FormType.TABLET]: ['片'],
  [FormType.CAPSULE]: ['胶囊', '胶丸'],
  [FormType.GRANULE]: ['颗粒', '冲剂', '散'],
  [FormType.LIQUID]: ['口服液', '糖浆', '合剂', '滴眼液', '滴鼻液', '滴耳液', '滴剂', '水', '液'],
  [FormType.TOPICAL]: ['膏', '霜', '凝胶', '栓', '贴', '搽剂'],
  [FormType.SPRAY]: ['喷雾', '气雾剂', '喷剂'],
  [FormType.OTHER]: [],
};

/** 从药品名称推断可能剂型集合；无命中返回空集（无法判断） */
function inferFormsFromName(name: string): Set<string> {
  const hits = new Set<string>();
  Object.entries(FORM_KEYWORDS).forEach(([form, words]) => {
    if (words.some(w => name.includes(w))) hits.add(form);
  });
  return hits;
}

/**
 * 判断「待补货条目」与「入库/编辑的药品」是否指向同一种药。
 * 匹配规则（入库自动核销待补货的核心，需与表单提示口径一致）：
 *  1. 名称 trim 后完全相等 → 直接认定同一药品（名称是补货条目的唯一标识，
 *     此时不再苛求剂型——同一名字录成不同剂型视为数据修正，仍应核销提醒）；
 *  2. 名称存在包含关系（如「布洛芬缓释胶囊 (芬必得)」与「布洛芬缓释胶囊」）
 *     → 需剂型佐证，两层校验：
 *       a. 药箱中与条目同名的药品剂型最权威，与本次录入剂型不同 → 不匹配；
 *       b. 双方名称关键词反推剂型（条目名与药品名各自推断后取并集），
 *          只要能推断出剂型就必须与录入剂型一致（如条目「阿司匹林」本身
 *          推不出剂型，但药名「阿司匹林肠溶片」能推出片剂，胶囊录入即不匹配）；
 *  3. 其余情况（名称无包含关系）→ 一律不匹配，避免误伤相似名药品。
 */
/**
 * 判断某条待补货条目是否属于指定药品。
 * 新数据带 medicine_id（精确命中）；旧数据退化到「药名 + 品牌」比对；
 * 两者都没有时才只按药名（兼容历史备份）。
 */
export function isItemForMedicine(item: ShoppingItem, med: Medicine): boolean {
  if (item.medicine_id) return String(item.medicine_id) === String(med.id);
  if (item.brand !== undefined) return item.medicine_name === med.name && (item.brand ?? '') === (med.brand ?? '');
  return item.medicine_name === med.name;
}

/**
 * 按待补货条目定位要核销的药品。**绝不只按药名取第一条**——
 * 同名不同品牌是两条独立记录，取首条会把库存写进错误的那条
 * （真实缺陷：补货登记 5，结果未过期的甲牌被改成 5，真正缺货的乙牌仍为 0）。
 */
export function findMedicineForItem(meds: Medicine[], item: ShoppingItem): number {
  if (item.medicine_id) {
    const byId = meds.findIndex(m => String(m.id) === String(item.medicine_id));
    if (byId !== -1) return byId;
  }
  if (item.brand !== undefined) {
    const byBrand = meds.findIndex(m => m.name === item.medicine_name && (m.brand ?? '') === (item.brand ?? ''));
    if (byBrand !== -1) return byBrand;
  }
  const candidates = meds
    .map((m, i) => ({ m, i }))
    .filter(x => x.m.name === item.medicine_name);
  if (!candidates.length) return -1;
  // 历史数据兜底：优先选"最需要补货"的那条（库存最少，其次效期最早）
  candidates.sort(
    (a, b) => (a.m.total_quantity - b.m.total_quantity)
      || String(a.m.expiry_date).localeCompare(String(b.m.expiry_date))
  );
  return candidates[0].i;
}

export function isRestockMatch(
  itemName: string,
  med: Pick<Medicine, 'name' | 'form_type'>,
  medicines: Medicine[]
): boolean {
  const a = (itemName || '').trim();
  const b = (med.name || '').trim();
  if (!a || !b) return false;
  if (a === b) return true;
  if (!(a.includes(b) || b.includes(a))) return false;

  const existing = medicines.find(m => (m.name || '').trim() === a);
  if (existing?.form_type && existing.form_type !== med.form_type) return false;

  const hits = new Set<string>([...inferFormsFromName(a), ...inferFormsFromName(b)]);
  return hits.size === 0 || hits.has(med.form_type);
}

/**
 * 在 DBStructure 上核销（移除）与新药品匹配的待补货条目，原地修改。
 * 返回被核销的药品名称列表（已去重，供 UI toast 提示）。
 * 注意：必须在调用方持有的同一个数据对象上操作并单次写回，
 * 与 addExpiredToShoppingList 相同的约定，避免双写互相覆盖。
 */
function settleMatchingRestocks(data: DBStructure, med: Medicine): string[] {
  const removed: string[] = [];
  const kept = data.shoppingList.filter(item => {
    if (item.status !== ShoppingStatus.PENDING) return true;
    // 品牌/id 不匹配的条目不属于这条药品：同名不同品牌是两条独立记录，
    // 给 A 入库不能顺手把 B 的补货提醒也核销掉。
    if (item.medicine_id && String(item.medicine_id) !== String(med.id)) return true;
    if (item.brand !== undefined && normBrand(item.brand) !== normBrand(med.brand)) return true;
    const hit = isRestockMatch(item.medicine_name, med, data.medicines);
    if (hit && !removed.includes(item.medicine_name)) removed.push(item.medicine_name);
    return !hit;
  });
  if (removed.length > 0) data.shoppingList = kept;
  return removed;
}

// ==========================================================
// 品牌字段：规范化与同名同品牌合并判定
// ==========================================================

/** 品牌规范化：trim；未设置（undefined / 空白）统一为 ''，用于比较与入库 */
export function normBrand(b?: string): string {
  return (b || '').trim();
}

/** 零宽字符（零宽空格/连接符/不换行空格）：肉眼看不见，必须显式去掉，否则会得到"空白名字" */
const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;

/**
 * 名称规范化：去掉零宽字符后 trim。
 * 纯空格 / 全零宽的"名字"不是有效药品名 —— 它会让卡片显示成一片空白，
 * 也会让补货条目无法按名称关联（EX5）。
 */
export function normalizeName(v: unknown): string {
  return String(v ?? '').replace(ZERO_WIDTH_RE, '').trim();
}

/**
 * 同名药入库时是否视为「同一条药品」（合并入库的判定，与表单实时提示口径一致）：
 * 名称 trim 相等 + 剂型相同 + 品牌规范化后相同。
 * 品牌不同 → 独立条目，可分开记录用药（用户需求：同一药吃两三个牌子分别记账）。
 */
export function isSameMedicineIdentity(
  a: Pick<Medicine, 'name' | 'form_type' | 'brand'>,
  b: Pick<Medicine, 'name' | 'form_type' | 'brand'>
): boolean {
  return (
    (a.name || '').trim() === (b.name || '').trim() &&
    a.form_type === b.form_type &&
    normBrand(a.brand) === normBrand(b.brand)
  );
}

// ==========================================================
// 投产清空（一次性，自动执行）
// ==========================================================

/**
 * 投产重置迁移（一次性，幂等）。
 * 背景：项目于 2026-09-09 正式投入使用，此前各设备浏览器里保存的都是
 * 开发/演示阶段生成的虚构数据（种子药品、演示品牌、模拟分品牌用药打卡、
 * 演示补货条目等），正式使用前必须清空。
 * 行为：新版本首次加载时把三张表一次性清空并用 localStorage 标记封口，
 * 之后不再执行。全部演示数据已留档于仓库 backup/ 目录
 * （均为虚构数据，非真实用户数据，详见 backup/README.md）；
 * 后续需要做功能测试时，可在应用内「数据备份与恢复 → 导入备份」恢复该文件。
 */
const PROD_RESET_FLAG = 'smart-medicine-box:prod-reset:v1';

/**
 * 演示数据清理迁移（一次性，幂等）。
 *
 * 背景：2026-09-10 之前，应用会在"空药箱"时自动把演示数据写进浏览器。该自动载入已撤除，
 * 但**已经写进设备的演示数据不会自己消失**——而且当初导入时顺手写下了上面那个投产标记，
 * 使老的清空迁移不会再次触发。于是老设备会一直看到演示数据。
 *
 * 安全性：只按**指纹**识别（药品 id 集合与演示数据完全一致），指纹不符说明是用户自己的真实数据，
 * 一个字都不动。标记只写一次，跑过就不再检查。
 */
/** 演示数据的药品 id 集合（默认字典序排序后拼接），取自 backup/medicine-box-demo-backup-20260909.json */
const LEGACY_DEMO_IDS = '1,10,11,12,13,14,15,16,17,18,19,2,20,3,4,5,6,7,8,9,seed-amox-b';

/**
 * 刻意**不用"只跑一次"标记**：标记会在首次加载（此时药箱可能是空的）就被消费掉，
 * 等数据出现时反而不检查了 —— 实测踩过这个坑。改为每次读取都按指纹判断：
 * 21 条数据的集合比较可忽略不计，且幂等（清空后签名变成空串，自然不再匹配）。
 */
function cleanupSeededDemoData(data: DBStructure): boolean {
  const sig = data.medicines.map(m => String(m.id)).sort().join(',');
  if (sig !== LEGACY_DEMO_IDS) return false; // 不是演示数据 → 绝不改动
  data.medicines = [];
  data.shoppingList = [];
  data.logs = [];
  console.info('[演示数据清理] 浏览器里遗留的演示数据已清空，药箱从空开始（你自己的数据不受影响）');
  return true;
}

function resetForProduction(data: DBStructure): boolean {
  try {
    if (localStorage.getItem(PROD_RESET_FLAG)) return false;
  } catch {
    // localStorage 不可用（隐私模式等）：本地存储本身不可写，无需清空
    return false;
  }
  data.medicines = [];
  data.shoppingList = [];
  data.logs = [];
  try {
    localStorage.setItem(PROD_RESET_FLAG, new Date().toISOString());
  } catch { /* ignore */ }
  console.info('[投产重置] 已清空演示/历史数据，药箱从空开始（演示数据备份见仓库 backup/ 目录）');
  return true;
}

// ==========================================================
// 后端 A：localStorage（未配置 Supabase 时的降级方案）
// ==========================================================
const LS_KEY = 'smart-medicine-box:db:v1';

function localRead(): DBStructure | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return EMPTY_DB();
    const parsed = JSON.parse(raw);
    return {
      medicines: Array.isArray(parsed.medicines) ? parsed.medicines : [],
      shoppingList: Array.isArray(parsed.shoppingList) ? parsed.shoppingList : [],
      logs: Array.isArray(parsed.logs) ? parsed.logs : [],
    };
  } catch (e) {
    console.error('[localStorage] 读取失败：', e);
    // 必须返回 null（读取失败语义），让上层放弃写回：
    // 旧实现此处返回 EMPTY_DB，一旦存储内容损坏，任何一次变更写入都会把真实数据覆盖掉
    return null;
  }
}

const WRITE_FAIL_MSG = '数据保存失败：本地存储写入被拒绝（空间可能不足，或浏览器禁用了存储），本次修改未保存';

function localWrite(db: DBStructure): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(db));
  } catch (e) {
    console.error('[localStorage] 写入失败：', e);
    // 两条通道都要给信号：
    // 1) 广播事件给 UI 弹提示（qutoa 满/隐私模式等）；
    // 2) 向上抛错——服务层返回值/异常通道必须能表达"没存上"，
    //    否则任何非 UI 调用方（脚本、测试、非浏览器宿主）都会以为保存成功而丢数据。
    notifyStorageError('本地存储写入失败（空间可能不足，常见于大图片占用），本次修改未能保存');
    throw new Error(WRITE_FAIL_MSG, { cause: e });
  }
}

// ==========================================================
// 后端 B：Supabase（云端持久化，多设备同步）
// ==========================================================
// Supabase 返回的数据在严格 TS 下易产生泛型推断问题，这里统一用 any 简化
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

const MEDICINE_COLUMNS = [
  'id', 'name', 'brand', 'image_url', 'form_type', 'category', 'location', 'total_quantity', 'unit',
  'threshold', 'expiry_date', 'last_purchase_date', 'symptoms_treated', 'dosage_instruction',
  'daily_usage', 'dose_per_time', 'side_effects', 'usage_frequency_score',
];

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** 非负数字清洗：非法值兜底 0，负数归零（库存/阈值/用量/频率分不允许为负） */
const nonNegNum = (v: unknown): number => Math.max(0, num(v));

// 日期字段：数据库用 date 类型，这里统一成 YYYY-MM-DD
const day = (v: unknown): string | null => {
  if (!v) return null;
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : null;
};

function medToRow(m: Medicine): Row {
  return {
    id: String(m.id),
    name: m.name,
    brand: m.brand || null,
    image_url: m.image_url || null,
    form_type: m.form_type,
    category: m.category || null,
    location: m.location || null,
    total_quantity: num(m.total_quantity),
    unit: m.unit || null,
    threshold: num(m.threshold),
    expiry_date: day(m.expiry_date),
    last_purchase_date: day(m.last_purchase_date),
    symptoms_treated: m.symptoms_treated || null,
    dosage_instruction: m.dosage_instruction || null,
    daily_usage: num(m.daily_usage),
    dose_per_time: m.dose_per_time === undefined ? null : num(m.dose_per_time),
    side_effects: m.side_effects || null,
    usage_frequency_score: num(m.usage_frequency_score),
    // 显式携带 updated_at：schema 里的 default now() 只在 insert 生效，
    // upsert 冲突更新时需要显式赋值才能真正刷新
    updated_at: new Date().toISOString(),
  };
}

function rowToMed(r: Row): Medicine {
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    brand: (r.brand as string) ?? undefined,
    image_url: (r.image_url as string) ?? undefined,
    form_type: (r.form_type as FormType) ?? FormType.OTHER,
    category: String(r.category ?? ''),
    location: String(r.location ?? ''),
    total_quantity: num(r.total_quantity),
    unit: String(r.unit ?? ''),
    threshold: num(r.threshold),
    expiry_date: String(r.expiry_date ?? ''),
    last_purchase_date: String(r.last_purchase_date ?? ''),
    symptoms_treated: String(r.symptoms_treated ?? ''),
    dosage_instruction: String(r.dosage_instruction ?? ''),
    daily_usage: num(r.daily_usage),
    ...(num(r.dose_per_time) > 0 ? { dose_per_time: num(r.dose_per_time) } : {}),
    side_effects: String(r.side_effects ?? ''),
    usage_frequency_score: num(r.usage_frequency_score),
  };
}

function itemToRow(i: ShoppingItem): Row {
  return {
    id: String(i.id),
    medicine_name: i.medicine_name,
    brand: i.brand || null,
    medicine_id: i.medicine_id || null,
    reason: i.reason,
    status: i.status,
    created_at: i.created_at || new Date().toISOString(),
  };
}

function rowToItem(r: Row): ShoppingItem {
  const brand = String(r.brand ?? '').trim();
  const medicineId = String(r.medicine_id ?? '').trim();
  return {
    id: String(r.id),
    medicine_name: String(r.medicine_name ?? ''),
    ...(brand ? { brand } : {}),
    ...(medicineId ? { medicine_id: medicineId } : {}),
    reason: (r.reason as ShoppingItem['reason']) ?? '手动添加',
    status: (r.status as ShoppingStatus) ?? ShoppingStatus.PENDING,
    created_at: String(r.created_at ?? ''),
  };
}

function logToRow(l: UsageLog): Row {
  return {
    id: String(l.id),
    medicine_id: l.medicine_id,
    medicine_name: l.medicine_name,
    brand: l.brand || null,
    amount: num(l.amount),
    log_time: l.log_time || new Date().toISOString(),
    user_name: l.user || null,
  };
}

function rowToLog(r: Row): UsageLog {
  return {
    id: String(r.id),
    medicine_id: String(r.medicine_id ?? ''),
    medicine_name: String(r.medicine_name ?? ''),
    brand: (r.brand as string) ?? undefined,
    amount: num(r.amount),
    log_time: String(r.log_time ?? ''),
    user: (r.user_name as string) ?? undefined,
  };
}

async function sbRead(): Promise<DBStructure> {
  const supabase = await getSupabase();
  const [m, s, l] = await Promise.all([
    supabase.from('medicines').select(MEDICINE_COLUMNS.join(',')),
    supabase.from('shopping_list').select('*'),
    supabase.from('usage_logs').select('*'),
  ]);
  if (m.error) throw m.error;
  if (s.error) throw s.error;
  if (l.error) throw l.error;
  return {
    medicines: ((m.data as Row[]) ?? []).map(rowToMed),
    shoppingList: ((s.data as Row[]) ?? []).map(rowToItem),
    logs: ((l.data as Row[]) ?? []).map(rowToLog),
  };
}

/** 整表同步：删除已移除的行 + upsert 当前所有行（数据量很小，安全且实现简单） */
async function sbSyncTable(table: string, rows: Row[]): Promise<void> {
  const supabase = await getSupabase();

  const existing = await supabase.from(table).select('id');
  if (existing.error) throw existing.error;

  const nextIds = new Set(rows.map((r) => String(r.id)));
  const removed = ((existing.data as Row[]) ?? [])
    .map((r: Row) => String(r.id))
    .filter((id: string) => !nextIds.has(id));

  if (removed.length > 0) {
    const del = await supabase.from(table).delete().in('id', removed);
    if (del.error) throw del.error;
  }
  if (rows.length > 0) {
    const up = await supabase.from(table).upsert(rows, { onConflict: 'id' });
    if (up.error) throw up.error;
  }
}

async function sbWrite(db: DBStructure): Promise<void> {
  // 三张表相互独立，并行同步以减少总耗时
  await Promise.all([
    sbSyncTable('medicines', db.medicines.map(medToRow)),
    sbSyncTable('shopping_list', db.shoppingList.map(itemToRow)),
    sbSyncTable('usage_logs', db.logs.map(logToRow)),
  ]);
}

/** 读取失败的统一文案：宁可让操作失败，也不能拿空数据覆盖现有数据 */
const READ_FAIL_MSG = '数据读取失败：存储不可达或内容已损坏，为保护现有数据已中止本次操作';

/**
 * 读取整库。返回 null 表示「读取失败」，此时调用方必须放弃写入，
 * 避免用空数据覆盖掉已有数据。
 */
async function readDB(): Promise<DBStructure | null> {
  if (isSupabaseConfigured) {
    try {
      return await sbRead();
    } catch (e) {
      console.error('[Supabase] 读取失败，本次操作已中止：', e);
      return null;
    }
  }
  return localRead();
}

async function writeDB(db: DBStructure): Promise<void> {
  if (isSupabaseConfigured) {
    try {
      await sbWrite(db);
      return;
    } catch (e) {
      console.error('[Supabase] 写入失败，已回落到本地缓存：', e);
      // 广播给 UI：用户需要知道云端没有保存成功，否则下次换设备会发现数据「丢了」
      notifyStorageError('云端写入失败，本次修改仅保存在当前设备浏览器中，请检查网络');
    }
  }
  localWrite(db);
}

/** 补货清单的唯一规则：过期 或 用完。其余原因（如历史遗留的"手动添加"）一律不进清单。 */
export const RESTOCK_REASONS: ShoppingItem['reason'][] = ['过期', '用尽'];

/**
 * 补货清单同步（唯一真相来源）：每次读取药品时执行，在传入的 data 上原地修改，
 * 返回是否有变更。
 *
 * 规则（老板 2026-09-10 明确）——**只有两种情况需要补货**：
 *   1. 已过期（expiry_date < 今天）
 *   2. 已用完（total_quantity === 0）
 * 另外会清理历史遗留的"手动添加"条目，保证清单里列出的就是全部需要补货的药品。
 *
 * 注意：必须在调用方持有的同一个数据对象上操作并单次写回，
 * 不要在函数内部重新 readDB —— 否则会与调用方的写回互相覆盖（旧版播种流程的丢失 bug）。
 */
function addExpiredToShoppingList(data: DBStructure): boolean {
  // 用本地日期字符串比较，避免 new Date('YYYY-MM-DD') 按 UTC 解析造成的时区误差
  const today = todayDateString();
  let hasChanges = false;

  data.medicines.forEach(med => {
    const expired = !!med.expiry_date && med.expiry_date < today;
    const usedUp = med.total_quantity === 0;
    if (!expired && !usedUp) return;

    const reason: ShoppingItem['reason'] = expired ? '过期' : '用尽';

    // 去重必须精确到"这一条药品"：只按药名去重会让同名不同品牌的两条共用一个条目，
    // 后续核销时无法区分该补哪一条（历史上会把库存写错记录）。
    const exists = data.shoppingList.find(
      item => item.status === ShoppingStatus.PENDING && isItemForMedicine(item, med)
    );
    if (exists) {
      // 原因可能变化（先用完后来过期 / 反之），保持与实际状态一致
      if (exists.reason !== reason) { exists.reason = reason; hasChanges = true; }
      return;
    }
    data.shoppingList.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      medicine_name: med.name,
      ...(med.brand ? { brand: med.brand } : {}),
      medicine_id: String(med.id),
      reason,
      status: ShoppingStatus.PENDING,
      created_at: new Date().toISOString(),
    });
    hasChanges = true;
  });

  // 清理规则外的历史条目（旧版本的「手动添加」「加入待购」产物），
  // 保证"清单里列出的 = 所有需要补货的药品"这条语义成立。
  const kept = data.shoppingList.filter(item => RESTOCK_REASONS.includes(item.reason));
  if (kept.length !== data.shoppingList.length) {
    data.shoppingList = kept;
    hasChanges = true;
  }

  return hasChanges;
}

export const MedicineService = {
  // --- 底层读写（对外保留，便于调试） ---
  fetchData: async (): Promise<DBStructure> => {
    const data = await readDB();
    // 读取失败必须与"空药箱"可区分：旧写法 ?? EMPTY_DB() 会让调试/导出入口
    // 把损坏存储当成空库，进而产出"空备份"误导用户。
    if (!data) throw new Error(READ_FAIL_MSG);
    return data;
  },

  saveData: async (data: DBStructure): Promise<void> => writeDB(data),

  // --- 核心业务: 读取与初始化 ---
  getMedicines: async (): Promise<Medicine[]> => {
    const data = await readDB();
    // 读取失败直接抛错：宁可让 UI 明确报错，也不能拿空数据覆盖现有数据。
    // （此前返回 []，UI 上「加载失败」与「空药箱」无法区分）
    if (!data) throw new Error(READ_FAIL_MSG);

    let dirty = false;

    // 投产重置（一次性）：正式投入使用前清空演示/历史数据（见函数注释与 backup/README.md）
    if (resetForProduction(data)) dirty = true;
    // 清掉老设备里遗留的演示数据（按指纹识别；真实数据不受影响）
    if (cleanupSeededDemoData(data)) dirty = true;

    // 过期检测每次加载都执行（此前只在首次播种时运行，
    // 导致药品后来过期时永远不会自动进入补货清单）。
    // 同一数据对象上原地检测 + 单次写入，也修复了旧版
    // 「checkExpiry 内部重读数据库再写回，随后被播种写回覆盖」的双写丢失问题。
    if (addExpiredToShoppingList(data)) dirty = true;

    if (dirty) await writeDB(data);
    return data.medicines;
  },

  getShoppingList: async (): Promise<ShoppingItem[]> => {
    const data = await readDB();
    if (!data) throw new Error(READ_FAIL_MSG);
    return data.shoppingList;
  },

  /**
   * @deprecated 2026-09-10 起补货清单只由规则产生（过期 / 用完），界面已移除手动加购入口。
   * 该接口仅为历史数据兼容与测试保留，业务代码不要再调用 —— 它产生的「手动添加」条目
   * 会在下次读取时被 addExpiredToShoppingList 自动清理掉。
   * 幂等：同名药品已有待补货条目时跳过，返回实际新增条数。
   */
  addToShoppingList: async (
    entries: { name: string; reason: ShoppingItem['reason']; brand?: string; medicineId?: string }[]
  ): Promise<number> => {
    const data = await readDB();
    if (!data) throw new Error(READ_FAIL_MSG);

    let added = 0;
    entries.forEach(({ name, reason, brand, medicineId }) => {
      const exists = data.shoppingList.find(
        item => item.status === ShoppingStatus.PENDING
          && item.medicine_name === name
          && (medicineId ? String(item.medicine_id ?? '') === String(medicineId) : true)
          && (brand !== undefined ? (item.brand ?? '') === brand : true)
      );
      if (!exists) {
        data.shoppingList.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          medicine_name: name,
          ...(brand ? { brand } : {}),
          ...(medicineId ? { medicine_id: String(medicineId) } : {}),
          reason,
          status: ShoppingStatus.PENDING,
          created_at: new Date().toISOString(),
        });
        added += 1;
      }
    });

    if (added > 0) await writeDB(data);
    return added;
  },

  /** 读取全部用药记录（新 UI 的打卡时间线 / 用药记录页使用），按时间倒序 */
  getUsageLogs: async (): Promise<UsageLog[]> => {
    const data = await readDB();
    if (!data) throw new Error(READ_FAIL_MSG);
    return [...data.logs].sort((a, b) => b.log_time.localeCompare(a.log_time));
  },

  // --- 排序算法 (纯函数，无需异步；分类权重复用模块级 getCategoryWeight) ---
  sortMedicines: (medicines: Medicine[]): Medicine[] => {
    return [...medicines].sort((a, b) => {
      const weightA = getCategoryWeight(a.category);
      const weightB = getCategoryWeight(b.category);
      if (weightA !== weightB) return weightB - weightA;
      if (a.usage_frequency_score !== b.usage_frequency_score) return b.usage_frequency_score - a.usage_frequency_score;
      const dateA = new Date(a.last_purchase_date).getTime();
      const dateB = new Date(b.last_purchase_date).getTime();
      return dateB - dateA;
    });
  },

  // --- 业务操作 (异步) ---
  consumeMedicine: async (id: string, amount: number) => {
    const data = await readDB();
    if (!data) throw new Error(READ_FAIL_MSG);

    const meds = data.medicines;
    const targetIndex = meds.findIndex(m => String(m.id) === String(id));
    if (targetIndex === -1) return;

    const target = meds[targetIndex];
    // 数量防御：负数等于凭空入库、NaN 会把库存污染成 NaN，一律拒绝（UI 已有 clamp，这里兜底）
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) throw new Error('用药数量必须为大于 0 的数字');
    target.total_quantity = Math.max(0, target.total_quantity - amt);
    target.usage_frequency_score += 1;

    const newLog: UsageLog = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      medicine_id: String(target.id),
      medicine_name: target.name,
      // 品牌快照：同名药不同品牌的用量可在用药记录里分别统计
      brand: target.brand || undefined,
      amount: amt,
      log_time: new Date().toISOString()
    };
    data.logs.push(newLog);

    if (target.total_quantity <= 0) {
       const exists = data.shoppingList.find(item => item.status === ShoppingStatus.PENDING && isItemForMedicine(item, target));
       if (!exists) {
         data.shoppingList.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            medicine_name: target.name,
            ...(target.brand ? { brand: target.brand } : {}),
            medicine_id: String(target.id),
            reason: '用尽',
            status: ShoppingStatus.PENDING,
            created_at: new Date().toISOString()
         });
       }
    }

    meds[targetIndex] = target;
    data.medicines = meds;
    await writeDB(data);
  },

  // 检查过期（保留为独立入口便于调试；常规路径已并入 getMedicines 内的 addExpiredToShoppingList）
  checkExpiry: async () => {
    const data = await readDB();
    // 静默 return 会让调用方把"读取失败"当成"无需补货"，异常一律向上抛
    if (!data) throw new Error(READ_FAIL_MSG);
    if (addExpiredToShoppingList(data)) {
      await writeDB(data);
    }
  },

  /**
   * 入库新药品（含自动核销待补货链路）：
   *  1. 药箱中已存在「同名 + 同剂型 + 同品牌」药品时视为补货入库 → 合并更新该条记录
   *     （数量/效期/阈值/位置/图片等信息以本次填写为准，保留原 id、名称与使用频率分，
   *     避免产生重复条目；最近购入日期记为今天）；
   *     品牌不同 → 视为独立条目，可分开记录用药（isSameMedicineIdentity 判定）；
   *  2. 无论新建还是合并，都会核销与之匹配的待补货条目（isRestockMatch 规则），
   *     即「补货不一定要走待补货按钮，入库新药同样能消掉提醒」。
   * 返回 { merged, offsetRestocks } 供 UI 组装提示文案。
   */
  addMedicine: async (med: Medicine): Promise<{ merged: boolean; offsetRestocks: string[] }> => {
    const data = await readDB();
    if (!data) throw new Error(READ_FAIL_MSG);

    // 名称防御：纯空格 / 全零宽字符的名称一律拒绝（UI 表单已校验，这里是脚本/导入通道的兜底）
    const name = normalizeName(med.name);
    if (!name) throw new Error('药品名称不能为空（或仅包含空白/零宽字符）');
    const incoming: Medicine = { ...med, name };

    // 数量防御：与 consumeMedicine / restockMedicine 对称，负数会凭空造出负库存
    const qty = Number(med.total_quantity);
    if (!Number.isFinite(qty) || qty < 0) {
      throw new Error('入库数量必须为不小于 0 的数字');
    }
    if (med.threshold !== undefined && med.threshold !== null && !Number.isFinite(Number(med.threshold))) {
      throw new Error('预警阈值必须为数字');
    }

    const idx = data.medicines.findIndex(m => isSameMedicineIdentity(m, incoming));

    let merged = false;
    let finalMed: Medicine;
    if (idx !== -1) {
      merged = true;
      const existing = data.medicines[idx];
      finalMed = {
        ...incoming,
        id: existing.id,
        // 名称保留库内原值：待补货条目按名称关联，改名会让旧提醒变成孤儿
        name: existing.name,
        usage_frequency_score: existing.usage_frequency_score,
        last_purchase_date: todayDateString(),
        // 入库表单没有「删除原图」入口（imageRemoved 仅存在于编辑表单），
        // 合并入库时未重新上传图片 → 保留原记录的图片，避免误把旧图清掉
        ...(med.image_url ? {} : { image_url: existing.image_url }),
      };
      data.medicines[idx] = finalMed;
    } else {
      finalMed = { ...incoming, last_purchase_date: incoming.last_purchase_date || todayDateString() };
      data.medicines.push(finalMed);
    }

    const offsetRestocks = settleMatchingRestocks(data, finalMed);
    await writeDB(data);
    return { merged, offsetRestocks };
  },

  /**
   * 编辑药品：整体替换原记录（按 id 匹配，保留原 id）。
   * 传入 previous（编辑前的旧记录）时启用「手动补货识别」：
   * 库存数量比之前增加 → 视为用户手动买入了药（未触发任何低库存警告的场景），
   * 自动把「最近购入」刷新为今天，并核销该药匹配的待补货提醒。
   */
  updateMedicine: async (med: Medicine, opts?: { previous?: Medicine }): Promise<{ offsetRestocks: string[] }> => {
    const data = await readDB();
    if (!data) throw new Error(READ_FAIL_MSG);
    const targetId = String(med.id).trim();
    const idx = data.medicines.findIndex(m => String(m.id).trim() === targetId);
    if (idx === -1) return { offsetRestocks: [] };

    const previous = opts?.previous;
    const stockIncreased =
      !!previous && Number(med.total_quantity) > Number(previous.total_quantity);

    const updated: Medicine = {
      ...med,
      id: data.medicines[idx].id,
      ...(stockIncreased ? { last_purchase_date: todayDateString() } : {}),
    };
    data.medicines[idx] = updated;

    const offsetRestocks = stockIncreased ? settleMatchingRestocks(data, updated) : [];
    await writeDB(data);
    return { offsetRestocks };
  },

  deleteMedicine: async (id: string) => {
    const data = await readDB();
    if (!data) throw new Error(READ_FAIL_MSG);
    const targetId = String(id).trim();
    const target = data.medicines.find(m => String(m.id).trim() === targetId);
    data.medicines = data.medicines.filter(m => String(m.id).trim() !== targetId);
    // 同步清理该药品遗留的待补货条目，避免补货清单出现指向已删除药品的孤儿提醒。
    // 用药记录（logs）属于历史凭证，保留不清。
    if (target) {
      // 只清理"属于这条药品"的待补货条目：同名不同品牌是两条独立记录，
      // 旧实现按药名一律删除，会把另一个品牌的过期提醒一起删掉。
      const sameNameOthers = data.medicines.filter(m => m.name === target.name);
      data.shoppingList = data.shoppingList.filter(item => {
        if (item.status !== ShoppingStatus.PENDING) return true;
        if (item.medicine_name !== target.name) return true;
        if (item.medicine_id) return String(item.medicine_id) !== String(target.id);
        if (item.brand !== undefined) {
          // 旧条目只有品牌没有 id：品牌不同 → 属于别的品牌，保留；
          // 品牌相同 → 还有同名同品牌的其它药品才保留，否则就是这条药品的孤儿提醒，清掉。
          if (normBrand(item.brand) !== normBrand(target.brand)) return true;
          return sameNameOthers.some(m => normBrand(m.brand) === normBrand(item.brand));
        }
        // 无 id 无品牌的旧条目：只有确认没有同名药品了才清理
        return sameNameOthers.length > 0;
      });
    }
    await writeDB(data);
  },

  restockMedicine: async (itemId: string, newQuantity: number, newExpiryDate: string) => {
    const data = await readDB();
    if (!data) throw new Error(READ_FAIL_MSG);

    // 输入防御：数量必须为有限数字且 >= 0、日期必须为 YYYY-MM-DD，
    // 不合法直接中止（清单条目保留），避免把库存/效期污染成 NaN 或垃圾串
    const qty = Number(newQuantity);
    const expiry = String(newExpiryDate || '').slice(0, 10);
    if (!Number.isFinite(qty) || qty < 0 || !isValidCalendarDate(expiry)) {
      throw new Error('购入数量或有效期格式不正确，本次登记未保存');
    }

    const targetItem = data.shoppingList.find(item => String(item.id) === String(itemId));
    data.shoppingList = data.shoppingList.filter(item => String(item.id) !== String(itemId));

    if (targetItem) {
      const medIndex = findMedicineForItem(data.medicines, targetItem);
      if (medIndex !== -1) {
        data.medicines[medIndex].total_quantity = qty;
        data.medicines[medIndex].expiry_date = expiry;
        data.medicines[medIndex].last_purchase_date = todayDateString();
      }
    }
    await writeDB(data);
  },

  /**
   * 清空全部数据（应用内「数据备份与恢复 → 清空全部数据」入口，UI 需二次确认后调用）：
   * 三张表全部置空写回；Supabase 模式下同步删除云端全部行。
   * 成功后写入投产重置标记，避免老设备随后的自动投产重置再次执行。
   */
  clearAllData: async (): Promise<void> => {
    await writeDB(EMPTY_DB());
    try {
      localStorage.setItem(PROD_RESET_FLAG, new Date().toISOString());
    } catch { /* ignore */ }
  },

  // --- 数据导入导出（备份/恢复/多设备迁移；localStorage 与 Supabase 双后端通用） ---

  /**
   * 导出整库为 JSON 字符串。药品的每一个属性（含品牌、图片 base64、
   * 服用说明等）与待补货清单、用药记录全部详细覆盖，无遗漏字段。
   */
  exportData: async (): Promise<string> => {
    const data = await readDB();
    if (!data) {
      throw new Error('读取失败，已中止导出：为保护现有数据，不能把「读不到」当成「空药箱」导出成空备份。请刷新后重试');
    }
    const payload: ExportPayload = {
      app: 'medicine-box',
      version: EXPORT_VERSION,
      exported_at: new Date().toISOString(),
      counts: {
        medicines: data.medicines.length,
        shoppingList: data.shoppingList.length,
        logs: data.logs.length,
      },
      data,
    };
    return JSON.stringify(payload, null, 2);
  },

  /**
   * 从 JSON 字符串导入数据（mode: merge=合并去重 / replace=整库覆盖）。
   * 逐条清洗校验：非法 JSON、缺 medicines 数组直接抛错；单条字段类型不合规
   * 会被修复（数字兜底 0、日期截断、枚举兜底）或丢弃（缺 id/name），绝不静默写入脏数据。
   * 返回摘要供 UI toast 展示。
   */
  importData: async (raw: string, mode: ImportMode): Promise<ImportResult> => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('文件不是有效的 JSON，请确认导出的是备份文件本身');
    }

    // 兼容两种结构：本应用导出的包装格式（{app, data}），或直接的整库结构
    const obj = parsed as Record<string, unknown>;
    const dbRaw = (obj && typeof obj === 'object' && 'data' in obj && typeof obj.data === 'object' && obj.data !== null
      ? obj.data
      : parsed) as Record<string, unknown>;

    if (!dbRaw || !Array.isArray(dbRaw.medicines)) {
      throw new Error('备份文件缺少药品数据（medicines），不是本应用的有效备份');
    }

    // 版本校验：文件声明了 version 就必须是本应用支持的版本。
    // 不校验会让未来版本/伪造版本的备份被静默接受，字段语义漂移后污染现有数据。
    if (obj && typeof obj === 'object' && 'version' in obj) {
      const fileVersion = (obj as Record<string, unknown>).version;
      if (Number(fileVersion) !== EXPORT_VERSION) {
        throw new Error(
          `备份文件版本不受支持（文件版本：${String(fileVersion)}，当前支持：${EXPORT_VERSION}），请确认文件来源`
        );
      }
    }

    const result: ImportResult = {
      mode,
      medicines: 0,
      shoppingList: 0,
      logs: 0,
      skippedMedicines: 0,
      skippedLogs: 0,
    };

    const incoming: DBStructure = {
      medicines: (dbRaw.medicines as unknown[]).map(sanitizeMedicine).filter((m): m is Medicine => m !== null),
      shoppingList: Array.isArray(dbRaw.shoppingList)
        ? (dbRaw.shoppingList as unknown[]).map(sanitizeItem).filter((i): i is ShoppingItem => i !== null)
        : [],
      logs: Array.isArray(dbRaw.logs)
        ? (dbRaw.logs as unknown[]).map(sanitizeLog).filter((l): l is UsageLog => l !== null)
        : [],
    };
    result.skippedMedicines = (dbRaw.medicines as unknown[]).length - incoming.medicines.length;
    result.skippedLogs = (Array.isArray(dbRaw.logs) ? (dbRaw.logs as unknown[]).length : 0) - incoming.logs.length;

    // 安全闸门：文件里带了药品数据，但清洗后一条都没剩下 —— 说明这是垃圾/投毒备份。
    // 若照常执行 replace，就会把用户现有药箱"成功地"清空并回报导入成功（EX5 暴露）。
    if ((dbRaw.medicines as unknown[]).length > 0 && incoming.medicines.length === 0) {
      throw new Error('备份中的药品数据全部无效（名称为空或字段缺失），已中止导入以免清空现有数据');
    }

    if (mode === 'replace') {
      // 覆盖恢复：整库替换为备份内容
      await writeDB(incoming);
    } else {
      // 合并导入：按 id 去重，冲突时以导入为准；现有数据其余条目保留
      const current = await readDB();
      if (!current) throw new Error('当前数据读取失败，为保护现有数据已中止导入');

      const medById = new Map(current.medicines.map(m => [String(m.id), m]));
      incoming.medicines.forEach(m => medById.set(String(m.id), m));
      current.medicines = [...medById.values()];

      const itemById = new Map(current.shoppingList.map(i => [String(i.id), i]));
      incoming.shoppingList.forEach(i => itemById.set(String(i.id), i));
      current.shoppingList = [...itemById.values()];

      const logById = new Map(current.logs.map(l => [String(l.id), l]));
      incoming.logs.forEach(l => logById.set(String(l.id), l));
      current.logs = [...logById.values()];

      await writeDB(current);
    }

    result.medicines = incoming.medicines.length;
    result.shoppingList = incoming.shoppingList.length;
    result.logs = incoming.logs.length;
    return result;
  },
};

// ==========================================================
// 导入导出：类型与清洗工具
// ==========================================================

const EXPORT_VERSION = 1;

export type ImportMode = 'merge' | 'replace';

export interface ExportPayload {
  app: 'medicine-box';
  version: number;
  exported_at: string;
  counts: { medicines: number; shoppingList: number; logs: number };
  data: DBStructure;
}

export interface ImportResult {
  mode: ImportMode;
  medicines: number;
  shoppingList: number;
  logs: number;
  /** 因缺 id/name 等被丢弃的条目数（脏数据防护，供提示） */
  skippedMedicines: number;
  skippedLogs: number;
}

/** 任意值 → 字符串（null/undefined → 默认值），导入清洗用 */
const str = (v: unknown, fallback = ''): string =>
  v === null || v === undefined ? fallback : String(v);

/** YYYY-MM-DD 校验（导入清洗用：不合规日期一律置空，避免垃圾串参与过期比较） */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 真实存在的日历日期校验：DATE_RE 只保证"形状"是 4-2-2 位数字，
 * 会让 2024-13-45 / 2025-02-30 / 0000-00-00 这类值原样入库，
 * 且因字典序极大永远不满足 expiry_date < today —— 永远不会过期、永远进不了补货清单。
 */
export function isValidCalendarDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1) return false;
  const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= daysInMonth[m - 1];
}

const date10 = (v: unknown): string => {
  const s = str(v).slice(0, 10);
  return isValidCalendarDate(s) ? s : '';
};

/**
 * 图片字段清洗（导入防御）：仅接受本地 base64 图片（data:image/）与 http(s) 外链，
 * 其余协议（javascript: 等）一律丢弃，杜绝把危险 URL 带进 <img src>。
 */
function sanitizeImageUrl(v: unknown): string {
  const s = str(v).trim();
  if (s.startsWith('data:image/')) return s;
  if (/^https?:\/\//i.test(s)) return s;
  return '';
}

/** 清洗单条药品：字段逐一修复类型；缺 id 或 name 返回 null（丢弃） */
function sanitizeMedicine(raw: unknown): Medicine | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id).trim();
  // 名称清洗：去掉零宽字符（\u200B-\u200D/\uFEFF）再 trim —— 纯空格或全零宽的"空名字"
  // 属于脏数据，会让卡片显示成一片空白（EX5）。
  const name = str(r.name).replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  if (!id || !name) return null;
  const brand = str(r.brand).replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  const image = sanitizeImageUrl(r.image_url);
  const formType = (Object.values(FormType) as string[]).includes(str(r.form_type))
    ? (r.form_type as FormType)
    : FormType.OTHER;
  return {
    id,
    name,
    ...(brand ? { brand } : {}),
    ...(image ? { image_url: image } : {}),
    form_type: formType,
    category: str(r.category, '其他'),
    location: str(r.location, '未知'),
    total_quantity: nonNegNum(r.total_quantity),
    unit: str(r.unit, '粒'),
    threshold: nonNegNum(r.threshold),
    expiry_date: date10(r.expiry_date),
    last_purchase_date: date10(r.last_purchase_date),
    symptoms_treated: str(r.symptoms_treated),
    dosage_instruction: str(r.dosage_instruction),
    daily_usage: nonNegNum(r.daily_usage),
    ...(nonNegNum(r.dose_per_time) > 0 ? { dose_per_time: nonNegNum(r.dose_per_time) } : {}),
    side_effects: str(r.side_effects, '详见说明书'),
    usage_frequency_score: nonNegNum(r.usage_frequency_score),
  };
}

/** 清洗单条用药记录：缺 id 或 medicine_name 返回 null（丢弃） */
function sanitizeLog(raw: unknown): UsageLog | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id).trim();
  const medicineName = str(r.medicine_name).trim();
  if (!id || !medicineName) return null;
  const brand = str(r.brand).trim();
  const user = str(r.user ?? r.user_name).trim();
  const logTime = str(r.log_time).trim();
  return {
    id,
    medicine_id: str(r.medicine_id),
    medicine_name: medicineName,
    ...(brand ? { brand } : {}),
    // 数量必须非负：负数用量会污染统计口径（EX13），与服务层其他数量防御保持一致
    amount: nonNegNum(r.amount),
    // 时间非法时兜底为当前时间：避免 Invalid Date 参与排序/按日分组产生 NaN
    log_time: logTime && !Number.isNaN(new Date(logTime).getTime()) ? logTime : new Date().toISOString(),
    ...(user ? { user } : {}),
  };
}

/** 清洗单条待补货条目：缺 id 或 medicine_name 返回 null（丢弃） */
function sanitizeItem(raw: unknown): ShoppingItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id).trim();
  const medicineName = str(r.medicine_name).trim();
  if (!id || !medicineName) return null;
  const reason = ['过期', '用尽', '手动添加'].includes(str(r.reason))
    ? (r.reason as ShoppingItem['reason'])
    : '手动添加';
  const brand = str(r.brand).trim();
  const medicineId = str(r.medicine_id).trim();
  return {
    id,
    medicine_name: medicineName,
    ...(brand ? { brand } : {}),
    ...(medicineId ? { medicine_id: medicineId } : {}),
    reason,
    status: ShoppingStatus.PENDING,
    created_at: str(r.created_at) || new Date().toISOString(),
  };
}
