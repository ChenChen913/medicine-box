/**
 * 文件名: services/medicineService.ts
 * 功能: 核心业务逻辑层
 * 描述: 双后端 —— 配置了 Supabase 环境变量时走云端 Postgres（多设备同步），
 *       否则自动降级为浏览器 localStorage（单机可用）。
 *       本文件不再依赖任何本地 Express 服务，可直接部署为纯静态站点。
 */

import { Medicine, ShoppingItem, UsageLog, FormType, ShoppingStatus } from '../types';
import { isSupabaseConfigured, getSupabase } from './supabaseClient';

/**
 * 以今天为基准偏移 N 天的本地日期字符串（YYYY-MM-DD）。
 * 供演示种子数据使用：让「临期 / 已过期」等状态在新装设备上始终可被演示，
 * 不会随真实时间流逝而失效。需在 INITIAL_MEDICINES 之前定义（模块初始化即调用）。
 */
function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// --- 首次使用时预置的示例数据 ---
// brand：品牌字段演示（同名药不同品牌可分条管理）
const INITIAL_MEDICINES: Medicine[] = [
  {
    id: '1',
    name: '布洛芬缓释胶囊 (芬必得)',
    brand: '芬必得',
    form_type: FormType.CAPSULE,
    category: '止痛药',
    location: '客厅医药箱第一层',
    total_quantity: 12,
    unit: '粒',
    threshold: 6,
    expiry_date: '2027-12-31',
    last_purchase_date: '2023-10-01',
    symptoms_treated: '头痛, 牙痛, 痛经, 发热',
    dosage_instruction: '每日2次，每次1粒',
    daily_usage: 2,
    side_effects: '恶心、呕吐、胃烧灼感或轻度消化不良、胃肠道溃疡及出血等。',
    usage_frequency_score: 15
  },
  {
    id: '2',
    name: '感冒灵颗粒',
    brand: '999',
    form_type: FormType.GRANULE,
    category: '感冒药',
    location: '客厅医药箱第二层',
    total_quantity: 5,
    unit: '袋',
    threshold: 3,
    expiry_date: '2027-05-20',
    last_purchase_date: '2023-11-15',
    symptoms_treated: '感冒引起的头痛, 发热, 鼻塞, 流涕',
    dosage_instruction: '每日3次，每次1袋',
    daily_usage: 3,
    side_effects: '偶见皮疹、荨麻疹、药热及粒细胞减少。',
    usage_frequency_score: 20
  },
  {
    id: '3',
    name: '阿莫西林胶囊',
    brand: '华北制药',
    form_type: FormType.CAPSULE,
    category: '抗生素',
    location: '主卧抽屉',
    total_quantity: 24,
    unit: '粒',
    threshold: 10,
    expiry_date: '2027-08-10',
    last_purchase_date: '2023-09-01',
    symptoms_treated: '呼吸道感染, 泌尿道感染',
    dosage_instruction: '每日3次，每次2粒',
    daily_usage: 6,
    side_effects: '恶心、呕吐、腹泻及假膜性肠炎等胃肠道反应。',
    usage_frequency_score: 5
  },
  {
    id: '4',
    name: '蒙脱石散 (思密达)',
    brand: '思密达',
    form_type: FormType.GRANULE,
    category: '肠胃药',
    location: '客厅医药箱',
    total_quantity: 8,
    unit: '袋',
    threshold: 4,
    expiry_date: '2028-06-01',
    last_purchase_date: '2024-01-10',
    symptoms_treated: '急慢性腹泻',
    dosage_instruction: '每日3次，每次1袋',
    daily_usage: 3,
    side_effects: '少数人可能产生轻度便秘。',
    usage_frequency_score: 8
  },
  {
    id: '5',
    name: '碘伏消毒液',
    form_type: FormType.LIQUID,
    category: '外用药',
    location: '急救包',
    total_quantity: 50,
    unit: 'ml',
    threshold: 20,
    expiry_date: '2027-11-30',
    last_purchase_date: '2023-06-01',
    symptoms_treated: '皮肤消毒, 小伤口处理',
    dosage_instruction: '外用，适量涂抹',
    daily_usage: 5, 
    side_effects: '极个别病例可见皮肤过敏反应。',
    usage_frequency_score: 12
  },
  {
    id: '6',
    name: '创可贴',
    form_type: FormType.OTHER,
    category: '医疗器械',
    location: '玄关杂物盒',
    total_quantity: 0,
    unit: '片',
    threshold: 10,
    expiry_date: '2028-01-01',
    last_purchase_date: '2022-01-01',
    symptoms_treated: '小创口止血, 护创',
    dosage_instruction: '清洁伤口后贴敷',
    daily_usage: 1,
    side_effects: '胶布过敏者慎用。',
    usage_frequency_score: 30
  },
  {
    id: '7',
    name: '维生素C泡腾片',
    brand: '力度伸',
    form_type: FormType.TABLET,
    category: '保健品',
    location: '厨房柜子',
    total_quantity: 15,
    unit: '片',
    threshold: 5,
    expiry_date: '2027-03-15',
    last_purchase_date: '2023-12-20',
    symptoms_treated: '增强免疫力, 预防坏血病',
    dosage_instruction: '每日1次，每次1片',
    daily_usage: 1,
    side_effects: '长期过量服用可能导致尿路结石。',
    usage_frequency_score: 25
  },
  {
    id: '8',
    name: '氯雷他定片 (开瑞坦)',
    brand: '开瑞坦',
    form_type: FormType.TABLET,
    category: '抗过敏',
    location: '卧室抽屉',
    total_quantity: 6,
    unit: '片',
    threshold: 3,
    // 动态日期：保持“过期约 20 天”的真实演示状态，不随时间漂移成多年前
    expiry_date: daysFromNow(-20),
    last_purchase_date: '2020-01-01',
    symptoms_treated: '过敏性鼻炎, 荨麻疹',
    dosage_instruction: '每日1次，每次1片',
    daily_usage: 1,
    side_effects: '乏力、头痛、嗜睡、口干等。',
    usage_frequency_score: 2
  },
  {
    id: '9',
    name: '藿香正气水',
    brand: '太极',
    form_type: FormType.LIQUID,
    category: '肠胃药',
    location: '客厅医药箱',
    total_quantity: 10,
    unit: '支',
    threshold: 5,
    expiry_date: '2027-06-30',
    last_purchase_date: '2023-07-01',
    symptoms_treated: '中暑, 脘腹胀痛',
    dosage_instruction: '每日2次，每次1支',
    daily_usage: 2,
    side_effects: '含酒精，服用后不得驾驶。',
    usage_frequency_score: 4
  },
  {
    id: '10',
    name: '人工泪液滴眼液',
    form_type: FormType.OTHER,
    category: '眼科',
    location: '书房桌面',
    total_quantity: 1,
    unit: '瓶',
    threshold: 1,
    expiry_date: '2027-12-12',
    last_purchase_date: '2024-01-20',
    symptoms_treated: '眼干, 眼涩',
    dosage_instruction: '滴入眼睑内，一次1-2滴',
    daily_usage: 0.1,
    side_effects: '偶见眼部刺痛。',
    usage_frequency_score: 50
  },
  { id: '11', name: '健胃消食片', brand: '江中', category: '肠胃药', form_type: FormType.TABLET, location: '餐厅', total_quantity: 32, unit: '片', threshold: 10, expiry_date: '2027-10-01', last_purchase_date: '2023-11-11', symptoms_treated: '消化不良', dosage_instruction: '每日3次，每次3片', daily_usage: 9, side_effects: '无', usage_frequency_score: 10 },
  { id: '12', name: '云南白药喷雾', category: '外用药', form_type: FormType.SPRAY, location: '运动包', total_quantity: 1, unit: '瓶', threshold: 1, expiry_date: daysFromNow(25), last_purchase_date: '2023-12-01', symptoms_treated: '跌打损伤', dosage_instruction: '每日3-5次，喷患处', daily_usage: 0.2, side_effects: '皮肤过敏', usage_frequency_score: 6 },
  { id: '13', name: '奥美拉唑肠溶胶囊', brand: '阿斯利康', category: '肠胃药', form_type: FormType.CAPSULE, location: '药箱', total_quantity: 14, unit: '粒', threshold: 7, expiry_date: '2028-02-01', last_purchase_date: '2023-08-01', symptoms_treated: '胃酸过多', dosage_instruction: '每日1次，每次1粒', daily_usage: 1, side_effects: '口干', usage_frequency_score: 9 },
  { id: '14', name: '连花清瘟胶囊', brand: '以岭', category: '感冒药', form_type: FormType.CAPSULE, location: '药箱', total_quantity: 48, unit: '粒', threshold: 24, expiry_date: '2027-09-09', last_purchase_date: '2022-12-01', symptoms_treated: '流感', dosage_instruction: '每日3次，每次4粒', daily_usage: 12, side_effects: '胃部不适', usage_frequency_score: 40 },
  { id: '15', name: '红霉素软膏', category: '外用药', form_type: FormType.TOPICAL, location: '床头柜', total_quantity: 1, unit: '支', threshold: 1, expiry_date: '2027-01-01', last_purchase_date: '2023-01-01', symptoms_treated: '皮肤感染', dosage_instruction: '每日2次，涂抹患处', daily_usage: 0.1, side_effects: '偶见刺激', usage_frequency_score: 3 },
  { id: '16', name: '褪黑素', brand: '汤臣倍健', category: '保健品', form_type: FormType.TABLET, location: '床头柜', total_quantity: 60, unit: '粒', threshold: 10, expiry_date: '2028-05-05', last_purchase_date: '2023-10-10', symptoms_treated: '失眠', dosage_instruction: '睡前1粒', daily_usage: 1, side_effects: '白天嗜睡', usage_frequency_score: 100 },
  { id: '17', name: '诺氟沙星胶囊', category: '肠胃药', form_type: FormType.CAPSULE, location: '药箱', total_quantity: 20, unit: '粒', threshold: 6, expiry_date: '2019-01-01', last_purchase_date: '2018-01-01', symptoms_treated: '细菌性痢疾', dosage_instruction: '每日2次，每次2粒', daily_usage: 4, side_effects: '软骨损害', usage_frequency_score: 0 },
  { id: '18', name: '阿司匹林肠溶片', brand: '拜耳', category: '心脑血管', form_type: FormType.TABLET, location: '老人房', total_quantity: 100, unit: '片', threshold: 30, expiry_date: '2028-03-03', last_purchase_date: '2023-11-01', symptoms_treated: '血栓预防', dosage_instruction: '每日1次，每次1片', daily_usage: 1, side_effects: '出血倾向', usage_frequency_score: 90 },
  { id: '19', name: '金嗓子喉片', brand: '金嗓子', category: '咽喉', form_type: FormType.TABLET, location: '包里', total_quantity: 5, unit: '片', threshold: 5, expiry_date: daysFromNow(12), last_purchase_date: '2023-09-09', symptoms_treated: '咽喉肿痛', dosage_instruction: '含服，每小时1-2片', daily_usage: 3, side_effects: '无', usage_frequency_score: 18 },
  { id: '20', name: '风油精', category: '外用药', form_type: FormType.LIQUID, location: '客厅茶几', total_quantity: 2, unit: '瓶', threshold: 1, expiry_date: '2028-10-10', last_purchase_date: '2021-10-10', symptoms_treated: '蚊虫叮咬', dosage_instruction: '适量涂抹', daily_usage: 0.1, side_effects: '刺激眼睛', usage_frequency_score: 11 },
];

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
    const hit = item.status === ShoppingStatus.PENDING && isRestockMatch(item.medicine_name, med, data.medicines);
    if (hit && !removed.includes(item.medicine_name)) removed.push(item.medicine_name);
    return !hit;
  });
  if (removed.length > 0) data.shoppingList = kept;
  return removed;
}

// ==========================================================
// 品牌字段：规范化 + 演示数据迁移（老用户也能看到品牌与分品牌用药记录）
// ==========================================================

/** 品牌规范化：trim；未设置（undefined / 空白）统一为 ''，用于比较与入库 */
export function normBrand(b?: string): string {
  return (b || '').trim();
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

/**
 * 品牌演示迁移（一次性，幂等）：
 *  1. 给「id+name 与种子一致且从未填过品牌」的老药品补上演示品牌
 *     （用户自建、改过名或填过品牌的条目一律不动）；
 *  2. 追加一条同名不同品牌的「阿莫西林胶囊 · 珠海联邦」，演示同名药分品牌管理；
 *  3. 为两个品牌的阿莫西林播种近两周的分品牌用药记录，
 *     让「用药记录按品牌区分」开箱即可看到效果。
 *  仅在 localStorage 可读的设备执行一次（flag 封口）；各子步骤自带条件幂等，
 *  即使 flag 丢失（清浏览器数据）也不会重复插入（同名同品牌存在即跳过）。
 */
const BRAND_SEED_FLAG = 'smart-medicine-box:brand-seed:v1';

/** 老种子药品的演示品牌（id+name 双重匹配才生效） */
const SEED_BRANDS: Record<string, { name: string; brand: string }> = {
  '1': { name: '布洛芬缓释胶囊 (芬必得)', brand: '芬必得' },
  '2': { name: '感冒灵颗粒', brand: '999' },
  '3': { name: '阿莫西林胶囊', brand: '华北制药' },
  '4': { name: '蒙脱石散 (思密达)', brand: '思密达' },
  '7': { name: '维生素C泡腾片', brand: '力度伸' },
  '8': { name: '氯雷他定片 (开瑞坦)', brand: '开瑞坦' },
  '9': { name: '藿香正气水', brand: '太极' },
  '11': { name: '健胃消食片', brand: '江中' },
  '13': { name: '奥美拉唑肠溶胶囊', brand: '阿斯利康' },
  '14': { name: '连花清瘟胶囊', brand: '以岭' },
  '16': { name: '褪黑素', brand: '汤臣倍健' },
  '18': { name: '阿司匹林肠溶片', brand: '拜耳' },
  '19': { name: '金嗓子喉片', brand: '金嗓子' },
};

/** 生成 N 天前某时刻的 ISO 时间戳（模拟打卡时间用，本地时区） */
function daysAgoIso(days: number, hour: number, minute: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function seedBrandDemo(data: DBStructure): boolean {
  try {
    if (localStorage.getItem(BRAND_SEED_FLAG)) return false;
  } catch {
    // localStorage 不可用（隐私模式等）：跳过演示迁移，避免每次加载都尝试
    return false;
  }

  let changed = false;

  // 1) 老种子药品补品牌（id+name 一致且从未设置过品牌才补）
  data.medicines.forEach(med => {
    const seed = SEED_BRANDS[String(med.id)];
    if (!seed || seed.name !== med.name) return;
    if (normBrand(med.brand) !== '') return; // 用户已填过品牌，不动
    med.brand = seed.brand;
    changed = true;
  });

  // 2) 追加同名不同品牌的阿莫西林（仅当 id 与「同名+同品牌」都不存在时）
  const amoxA = data.medicines.find(m => String(m.id) === '3' && m.name === '阿莫西林胶囊');
  const amoxBId = 'seed-amox-b';
  const hasAmoxB =
    data.medicines.some(m => String(m.id) === amoxBId) ||
    data.medicines.some(m => isSameMedicineIdentity(m, { name: '阿莫西林胶囊', form_type: FormType.CAPSULE, brand: '珠海联邦' }));
  let amoxB: Medicine | undefined;
  if (!hasAmoxB) {
    amoxB = {
      id: amoxBId,
      name: '阿莫西林胶囊',
      brand: '珠海联邦',
      form_type: FormType.CAPSULE,
      category: '抗生素',
      location: '客厅医药箱第二层',
      total_quantity: 16,
      unit: '粒',
      threshold: 8,
      expiry_date: daysFromNow(180),
      last_purchase_date: daysFromNow(-9),
      symptoms_treated: '呼吸道感染, 泌尿道感染',
      dosage_instruction: '每日3次，每次2粒',
      daily_usage: 6,
      side_effects: '恶心、呕吐、腹泻及假膜性肠炎等胃肠道反应。',
      usage_frequency_score: 3,
    };
    data.medicines.push(amoxB);
    changed = true;
  }

  // 3) 播种分品牌用药记录（logs 里没有 seed-log- 前缀的演示记录时才播种；
  //    品牌条目必须真实存在于药箱，避免产生指向已删药品的孤儿记录）
  const hasSeedLogs = data.logs.some(l => String(l.id).startsWith('seed-log-'));
  if (!hasSeedLogs) {
    const seedLogs: UsageLog[] = [];
    const pushLogs = (med: Medicine | undefined, dayOffsets: number[], tag: string) => {
      if (!med) return;
      const times = [8 * 60 + 10, 12 * 60 + 30, 19 * 60 + 20]; // 早/中/晚三个打卡时点
      dayOffsets.forEach((d, i) => {
        const t = times[i % times.length];
        seedLogs.push({
          id: `seed-log-${tag}${i + 1}`,
          medicine_id: String(med.id),
          medicine_name: med.name,
          brand: med.brand,
          amount: 2,
          log_time: daysAgoIso(d, Math.floor(t / 60), t % 60),
        });
      });
    };
    // 华北制药：14 天内 8 次；珠海联邦：9 天内 5 次 → 用药记录里两个品牌分明
    pushLogs(amoxA ?? data.medicines.find(m => m.name === '阿莫西林胶囊' && m.brand === '华北制药'),
      [1, 2, 4, 5, 7, 9, 11, 13], 'a');
    pushLogs(amoxB, [1, 3, 6, 8, 12], 'b');
    if (seedLogs.length > 0) {
      data.logs.push(...seedLogs);
      changed = true;
    }
  }

  try {
    localStorage.setItem(BRAND_SEED_FLAG, new Date().toISOString());
  } catch { /* ignore */ }
  if (changed) console.info('[演示数据] 已补品牌字段并播种分品牌用药记录（阿莫西林 · 华北制药 / 珠海联邦）');
  return changed;
}

// ==========================================================
// 后端 A：localStorage（未配置 Supabase 时的降级方案）
// ==========================================================
const LS_KEY = 'smart-medicine-box:db:v1';

function localRead(): DBStructure {
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
    return EMPTY_DB();
  }
}

function localWrite(db: DBStructure): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(db));
  } catch (e) {
    console.error('[localStorage] 写入失败：', e);
    // 静默失败会让用户以为已保存，刷新后数据丢失。必须广播给 UI 提示。
    notifyStorageError('本地存储写入失败（空间可能不足，常见于大图片占用），本次修改未能保存');
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
  'daily_usage', 'side_effects', 'usage_frequency_score',
];

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

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
    side_effects: String(r.side_effects ?? ''),
    usage_frequency_score: num(r.usage_frequency_score),
  };
}

function itemToRow(i: ShoppingItem): Row {
  return {
    id: String(i.id),
    medicine_name: i.medicine_name,
    reason: i.reason,
    status: i.status,
    created_at: i.created_at || new Date().toISOString(),
  };
}

function rowToItem(r: Row): ShoppingItem {
  return {
    id: String(r.id),
    medicine_name: String(r.medicine_name ?? ''),
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
    medicines: ((m.data as any[]) ?? []).map(rowToMed),
    shoppingList: ((s.data as any[]) ?? []).map(rowToItem),
    logs: ((l.data as any[]) ?? []).map(rowToLog),
  };
}

/** 整表同步：删除已移除的行 + upsert 当前所有行（数据量很小，安全且实现简单） */
async function sbSyncTable(table: string, rows: Row[]): Promise<void> {
  const supabase = await getSupabase();

  const existing = await supabase.from(table).select('id');
  if (existing.error) throw existing.error;

  const nextIds = new Set(rows.map((r) => String(r.id)));
  const removed = ((existing.data as any[]) ?? [])
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

/**
 * 读取整库。返回 null 表示「读取失败」，此时调用方必须放弃写入，
 * 避免用空数据覆盖掉云端已有数据。
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

/**
 * 过期检测：把「已过期且尚无待补货条目」的药品加入补货清单。
 * 在传入的 data 上原地修改，返回是否有变更。
 * 注意：必须在调用方持有的同一个数据对象上操作并单次写回，
 * 不要在函数内部重新 readDB —— 否则会与调用方的写回互相覆盖（旧版播种流程的丢失 bug）。
 */
function addExpiredToShoppingList(data: DBStructure): boolean {
  // 用本地日期字符串比较，避免 new Date('YYYY-MM-DD') 按 UTC 解析造成的时区误差
  const today = todayDateString();
  let hasChanges = false;

  data.medicines.forEach(med => {
    if (med.expiry_date && med.expiry_date < today) {
      const exists = data.shoppingList.find(
        item => item.medicine_name === med.name && item.status === ShoppingStatus.PENDING
      );
      if (!exists) {
        data.shoppingList.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          medicine_name: med.name,
          reason: '过期',
          status: ShoppingStatus.PENDING,
          created_at: new Date().toISOString(),
        });
        hasChanges = true;
      }
    }
  });

  return hasChanges;
}

/**
 * 旧版演示数据效期迁移（一次性，自动执行）。
 *
 * 背景：2024~2025 年间播种的示例数据按「当年年份」填写效期，随着时间推移
 * 陆续过期，老用户的药箱里 20 条演示数据有 17 条标红「已过期」，几乎无法
 * 正常演示系统功能。由于播种只在数据为空时执行，仅更新种子代码救不了
 * 已存在的旧数据，因此这里做一次幂等迁移：
 *
 *  - 仅匹配「id + name 与旧版种子完全一致，且效期仍等于旧种子原始值」的条目，
 *    即确认是未被用户修改过的演示数据才刷新；用户自建、改名或已手动改过
 *    效期的条目一律不动。
 *  - 刷新结果保留完整的状态谱系：多数转为未来效期（正常备用），2 条转为
 *    「临期 30 天内」演示临期提醒，另保留 2 条过期样本（近期过期 + 深度过期）
 *    以便继续演示过期检测与清理链路。
 *  - 刷新后同步清理这些药品遗留的「过期」补货条目：药品已不再过期，
 *    留在补货清单里属于误导性提醒。
 *  - 双重防重跑：localStorage 标记 + 旧值精确匹配。即使标记丢失
 *    （如清空浏览器数据），只要效期已被刷新过、与旧值不再相等，就不会二次覆盖。
 */
const DEMO_REFRESH_FLAG = 'smart-medicine-box:demo-refresh:v1';

/** 旧版种子（首版提交）的效期快照 → 迁移后的演示效期 */
const LEGACY_DEMO_EXPIRY: Record<string, { name: string; old: string; next: string }> = {
  '1': { name: '布洛芬缓释胶囊 (芬必得)', old: '2025-12-31', next: '2027-12-31' },
  '2': { name: '感冒灵颗粒', old: '2024-05-20', next: '2027-05-20' },
  '3': { name: '阿莫西林胶囊', old: '2025-08-10', next: '2027-08-10' },
  '4': { name: '蒙脱石散 (思密达)', old: '2026-01-01', next: '2028-06-01' },
  '5': { name: '碘伏消毒液', old: '2024-11-30', next: '2027-11-30' },
  '7': { name: '维生素C泡腾片', old: '2025-03-15', next: '2027-03-15' },
  '8': { name: '氯雷他定片 (开瑞坦)', old: '2022-01-01', next: daysFromNow(-20) },
  '9': { name: '藿香正气水', old: '2025-06-30', next: '2027-06-30' },
  '10': { name: '人工泪液滴眼液', old: '2024-12-12', next: '2027-12-12' },
  '11': { name: '健胃消食片', old: '2025-10-01', next: '2027-10-01' },
  '12': { name: '云南白药喷雾', old: '2026-05-01', next: daysFromNow(25) },
  '13': { name: '奥美拉唑肠溶胶囊', old: '2025-02-01', next: '2028-02-01' },
  '14': { name: '连花清瘟胶囊', old: '2024-09-09', next: '2027-09-09' },
  '16': { name: '褪黑素', old: '2025-05-05', next: '2028-05-05' },
  '18': { name: '阿司匹林肠溶片', old: '2026-03-03', next: '2028-03-03' },
  '19': { name: '金嗓子喉片', old: '2025-08-08', next: daysFromNow(12) },
};

function refreshLegacyDemoData(data: DBStructure): boolean {
  // 已执行过迁移的设备直接跳过
  try {
    if (localStorage.getItem(DEMO_REFRESH_FLAG)) return false;
  } catch {
    // localStorage 不可用（隐私模式等）：仅靠「旧值精确匹配」保护，仍可安全执行
  }

  const today = todayDateString();
  let refreshed = 0;

  data.medicines.forEach(med => {
    const legacy = LEGACY_DEMO_EXPIRY[String(med.id)];
    // id + name 同时匹配，且效期仍等于旧种子原始值，才视为未修改过的演示数据
    if (!legacy || legacy.name !== med.name || med.expiry_date !== legacy.old) return;
    med.expiry_date = legacy.next;
    refreshed += 1;
  });

  if (refreshed === 0) return false;

  // 清理已不再过期的药品遗留的「过期」补货条目（对应药品已删除的孤儿条目不在此处理）
  const expiryByName = new Map(data.medicines.map(m => [m.name, m.expiry_date || '']));
  const beforeCount = data.shoppingList.length;
  data.shoppingList = data.shoppingList.filter(item => {
    if (item.reason !== '过期' || item.status !== ShoppingStatus.PENDING) return true;
    const expiry = expiryByName.get(item.medicine_name);
    // 对应药品不存在 → 保留；仍过期 → 保留；已不再过期 → 移除
    return expiry === undefined || expiry < today;
  });
  const cleaned = beforeCount - data.shoppingList.length;

  try {
    localStorage.setItem(DEMO_REFRESH_FLAG, new Date().toISOString());
  } catch { /* ignore */ }

  console.info(`[演示数据] 已刷新 ${refreshed} 条示例药品效期（含 2 条临期、2 条过期演示），清理误导性补货提醒 ${cleaned} 条`);
  return true;
}

export const MedicineService = {
  // --- 底层读写（对外保留，便于调试） ---
  fetchData: async (): Promise<DBStructure> => (await readDB()) ?? EMPTY_DB(),

  saveData: async (data: DBStructure): Promise<void> => writeDB(data),

  // --- 核心业务: 读取与初始化 ---
  getMedicines: async (): Promise<Medicine[]> => {
    const data = await readDB();
    // 读取失败直接抛错：宁可让 UI 明确报错，也不能拿空数据/初始数据覆盖云端。
    // （此前返回 []，UI 上「加载失败」与「空药箱」无法区分）
    if (!data) throw new Error('数据读取失败：云端数据库不可达，为保护云端数据已中止本次读写');

    let dirty = false;

    if (!data.medicines || data.medicines.length === 0) {
      // 首次使用：播种示例数据。注意拷贝一份，避免业务代码改动共享常量。
      data.medicines = INITIAL_MEDICINES.map(m => ({ ...m }));
      dirty = true;
    }

    // 旧版演示数据效期迁移（一次性，见函数注释；需在过期检测前执行，
    // 让「不再过期」药品的补货条目先被清理，再由过期检测为仍过期的样本补齐提醒）
    if (refreshLegacyDemoData(data)) dirty = true;

    // 品牌演示迁移（一次性）：补品牌 + 同名双品牌阿莫西林 + 分品牌用药记录
    if (seedBrandDemo(data)) dirty = true;

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
    return data?.shoppingList ?? [];
  },

  /**
   * 手动把药品加入补货清单（新 UI 的「加入待购」「一键生成采购单」使用）。
   * 幂等：同名药品已有待补货条目时跳过，返回实际新增条数。
   */
  addToShoppingList: async (entries: { name: string; reason: ShoppingItem['reason'] }[]): Promise<number> => {
    const data = await readDB();
    if (!data) return 0;

    let added = 0;
    entries.forEach(({ name, reason }) => {
      const exists = data.shoppingList.find(
        item => item.medicine_name === name && item.status === ShoppingStatus.PENDING
      );
      if (!exists) {
        data.shoppingList.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          medicine_name: name,
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
    return [...(data?.logs ?? [])].sort((a, b) => b.log_time.localeCompare(a.log_time));
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
    if (!data) return;

    const meds = data.medicines;
    const targetIndex = meds.findIndex(m => String(m.id) === String(id));
    if (targetIndex === -1) return;

    const target = meds[targetIndex];
    target.total_quantity = Math.max(0, target.total_quantity - amount);
    target.usage_frequency_score += 1;

    const newLog: UsageLog = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      medicine_id: String(target.id),
      medicine_name: target.name,
      // 品牌快照：同名药不同品牌的用量可在用药记录里分别统计
      brand: target.brand || undefined,
      amount,
      log_time: new Date().toISOString()
    };
    data.logs.push(newLog);

    if (target.total_quantity <= 0) {
       const exists = data.shoppingList.find(item => item.medicine_name === target.name && item.status === ShoppingStatus.PENDING);
       if (!exists) {
         data.shoppingList.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            medicine_name: target.name,
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
    if (!data) return;
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
    if (!data) return { merged: false, offsetRestocks: [] };

    const idx = data.medicines.findIndex(m => isSameMedicineIdentity(m, med));

    let merged = false;
    let finalMed: Medicine;
    if (idx !== -1) {
      merged = true;
      const existing = data.medicines[idx];
      finalMed = {
        ...med,
        id: existing.id,
        // 名称保留库内原值：待补货条目按名称关联，改名会让旧提醒变成孤儿
        name: existing.name,
        usage_frequency_score: existing.usage_frequency_score,
        last_purchase_date: todayDateString(),
      };
      data.medicines[idx] = finalMed;
    } else {
      finalMed = { ...med, last_purchase_date: med.last_purchase_date || todayDateString() };
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
    if (!data) return { offsetRestocks: [] };
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
    if (!data) return;
    const targetId = String(id).trim();
    const target = data.medicines.find(m => String(m.id).trim() === targetId);
    data.medicines = data.medicines.filter(m => String(m.id).trim() !== targetId);
    // 同步清理该药品遗留的待补货条目，避免补货清单出现指向已删除药品的孤儿提醒。
    // 用药记录（logs）属于历史凭证，保留不清。
    if (target) {
      data.shoppingList = data.shoppingList.filter(
        item => !(item.medicine_name === target.name && item.status === ShoppingStatus.PENDING)
      );
    }
    await writeDB(data);
  },

  restockMedicine: async (itemId: string, newQuantity: number, newExpiryDate: string) => {
    const data = await readDB();
    if (!data) return;

    const targetItem = data.shoppingList.find(item => String(item.id) === String(itemId));
    data.shoppingList = data.shoppingList.filter(item => String(item.id) !== String(itemId));

    if (targetItem) {
      const medIndex = data.medicines.findIndex(m => m.name === targetItem.medicine_name);
      if (medIndex !== -1) {
        data.medicines[medIndex].total_quantity = newQuantity;
        data.medicines[medIndex].expiry_date = newExpiryDate;
        data.medicines[medIndex].last_purchase_date = todayDateString();
      }
    }
    await writeDB(data);
  },

  // --- 数据导入导出（备份/恢复/多设备迁移；localStorage 与 Supabase 双后端通用） ---

  /**
   * 导出整库为 JSON 字符串。药品的每一个属性（含品牌、图片 base64、
   * 服用说明等）与待补货清单、用药记录全部详细覆盖，无遗漏字段。
   */
  exportData: async (): Promise<string> => {
    const data = (await readDB()) ?? EMPTY_DB();
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

/** 清洗单条药品：字段逐一修复类型；缺 id 或 name 返回 null（丢弃） */
function sanitizeMedicine(raw: unknown): Medicine | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id).trim();
  const name = str(r.name).trim();
  if (!id || !name) return null;
  const brand = str(r.brand).trim();
  const image = str(r.image_url).trim();
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
    total_quantity: num(r.total_quantity),
    unit: str(r.unit, '粒'),
    threshold: num(r.threshold),
    expiry_date: str(r.expiry_date).slice(0, 10),
    last_purchase_date: str(r.last_purchase_date).slice(0, 10),
    symptoms_treated: str(r.symptoms_treated),
    dosage_instruction: str(r.dosage_instruction),
    daily_usage: num(r.daily_usage),
    side_effects: str(r.side_effects, '详见说明书'),
    usage_frequency_score: num(r.usage_frequency_score),
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
  return {
    id,
    medicine_id: str(r.medicine_id),
    medicine_name: medicineName,
    ...(brand ? { brand } : {}),
    amount: num(r.amount),
    log_time: str(r.log_time) || new Date().toISOString(),
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
  return {
    id,
    medicine_name: medicineName,
    reason,
    status: ShoppingStatus.PENDING,
    created_at: str(r.created_at) || new Date().toISOString(),
  };
}
