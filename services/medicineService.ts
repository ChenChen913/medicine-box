/**
 * 文件名: services/medicineService.ts
 * 功能: 核心业务逻辑层
 * 描述: 双后端 —— 配置了 Supabase 环境变量时走云端 Postgres（多设备同步），
 *       否则自动降级为浏览器 localStorage（单机可用）。
 *       本文件不再依赖任何本地 Express 服务，可直接部署为纯静态站点。
 */

import { Medicine, ShoppingItem, UsageLog, FormType, ShoppingStatus } from '../types';
import { isSupabaseConfigured, getSupabase } from './supabaseClient';

// --- 首次使用时预置的示例数据 ---
const INITIAL_MEDICINES: Medicine[] = [
  {
    id: '1',
    name: '布洛芬缓释胶囊 (芬必得)',
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
    form_type: FormType.TABLET,
    category: '抗过敏',
    location: '卧室抽屉',
    total_quantity: 6,
    unit: '片',
    threshold: 3,
    expiry_date: '2022-01-01', 
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
  { id: '11', name: '健胃消食片', category: '肠胃药', form_type: FormType.TABLET, location: '餐厅', total_quantity: 32, unit: '片', threshold: 10, expiry_date: '2027-10-01', last_purchase_date: '2023-11-11', symptoms_treated: '消化不良', dosage_instruction: '每日3次，每次3片', daily_usage: 9, side_effects: '无', usage_frequency_score: 10 },
  { id: '12', name: '云南白药喷雾', category: '外用药', form_type: FormType.SPRAY, location: '运动包', total_quantity: 1, unit: '瓶', threshold: 1, expiry_date: '2027-05-01', last_purchase_date: '2023-12-01', symptoms_treated: '跌打损伤', dosage_instruction: '每日3-5次，喷患处', daily_usage: 0.2, side_effects: '皮肤过敏', usage_frequency_score: 6 },
  { id: '13', name: '奥美拉唑肠溶胶囊', category: '肠胃药', form_type: FormType.CAPSULE, location: '药箱', total_quantity: 14, unit: '粒', threshold: 7, expiry_date: '2028-02-01', last_purchase_date: '2023-08-01', symptoms_treated: '胃酸过多', dosage_instruction: '每日1次，每次1粒', daily_usage: 1, side_effects: '口干', usage_frequency_score: 9 },
  { id: '14', name: '连花清瘟胶囊', category: '感冒药', form_type: FormType.CAPSULE, location: '药箱', total_quantity: 48, unit: '粒', threshold: 24, expiry_date: '2027-09-09', last_purchase_date: '2022-12-01', symptoms_treated: '流感', dosage_instruction: '每日3次，每次4粒', daily_usage: 12, side_effects: '胃部不适', usage_frequency_score: 40 },
  { id: '15', name: '红霉素软膏', category: '外用药', form_type: FormType.TOPICAL, location: '床头柜', total_quantity: 1, unit: '支', threshold: 1, expiry_date: '2027-01-01', last_purchase_date: '2023-01-01', symptoms_treated: '皮肤感染', dosage_instruction: '每日2次，涂抹患处', daily_usage: 0.1, side_effects: '偶见刺激', usage_frequency_score: 3 },
  { id: '16', name: '褪黑素', category: '保健品', form_type: FormType.TABLET, location: '床头柜', total_quantity: 60, unit: '粒', threshold: 10, expiry_date: '2028-05-05', last_purchase_date: '2023-10-10', symptoms_treated: '失眠', dosage_instruction: '睡前1粒', daily_usage: 1, side_effects: '白天嗜睡', usage_frequency_score: 100 },
  { id: '17', name: '诺氟沙星胶囊', category: '肠胃药', form_type: FormType.CAPSULE, location: '药箱', total_quantity: 20, unit: '粒', threshold: 6, expiry_date: '2019-01-01', last_purchase_date: '2018-01-01', symptoms_treated: '细菌性痢疾', dosage_instruction: '每日2次，每次2粒', daily_usage: 4, side_effects: '软骨损害', usage_frequency_score: 0 },
  { id: '18', name: '阿司匹林肠溶片', category: '心脑血管', form_type: FormType.TABLET, location: '老人房', total_quantity: 100, unit: '片', threshold: 30, expiry_date: '2028-03-03', last_purchase_date: '2023-11-01', symptoms_treated: '血栓预防', dosage_instruction: '每日1次，每次1片', daily_usage: 1, side_effects: '出血倾向', usage_frequency_score: 90 },
  { id: '19', name: '金嗓子喉片', category: '咽喉', form_type: FormType.TABLET, location: '包里', total_quantity: 5, unit: '片', threshold: 5, expiry_date: '2027-08-08', last_purchase_date: '2023-09-09', symptoms_treated: '咽喉肿痛', dosage_instruction: '含服，每小时1-2片', daily_usage: 3, side_effects: '无', usage_frequency_score: 18 },
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
  'id', 'name', 'image_url', 'form_type', 'category', 'location', 'total_quantity', 'unit',
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

  addMedicine: async (med: Medicine) => {
    const data = await readDB();
    if (!data) return;
    data.medicines.push(med);
    await writeDB(data);
  },

  // 编辑药品：用传入对象整体替换原记录（按 id 匹配），保留原 id
  updateMedicine: async (med: Medicine) => {
    const data = await readDB();
    if (!data) return;
    const targetId = String(med.id).trim();
    const idx = data.medicines.findIndex(m => String(m.id).trim() === targetId);
    if (idx === -1) return;
    data.medicines[idx] = { ...med, id: data.medicines[idx].id };
    await writeDB(data);
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
  }
};
