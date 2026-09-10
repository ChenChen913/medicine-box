#!/usr/bin/env node
/**
 * 文件名: scripts/test-medicine-service.mjs
 * 功能: services/medicineService.ts（localStorage 降级后端）的 Node 端自动化测试。
 * 约定: docs/EXPERIENCE.md §7.3 —— esbuild 打包服务层 + node 里挂内存版 localStorage。
 * 依赖: 仅用 node 内置模块 + 项目已有的 esbuild（随 vite 安装），不新增任何依赖。
 * 用法:
 *   node scripts/test-medicine-service.mjs               # 主测试
 *   node scripts/test-medicine-service.mjs --tz-child TZ # 内部使用：时区子进程
 * 产出: 每条断言一行 PASS/FAIL 编号 描述；末尾 TOTAL=n PASS=n FAIL=n
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), '..');
const SRC_FILE = path.join(PROJECT_ROOT, 'services', 'medicineService.ts');

// 存储键名/迁移 flag：与 services/medicineService.ts 保持一致（LS_KEY:209, PROD_RESET_FLAG:187）
const LS_KEY = 'smart-medicine-box:db:v1';
const PROD_RESET_FLAG = 'smart-medicine-box:prod-reset:v1';
const READ_FAIL_MSG = '数据读取失败：存储不可达或内容已损坏，为保护现有数据已中止本次操作';

const TZ_CHILD_FLAG = '--tz-child';

// ==========================================================
// 输出与断言框架
// ==========================================================
const STATS = { pass: 0, fail: 0, total: 0 };
const FAILS = [];

function line(s) { process.stdout.write(s + '\n'); }

class TestFailure extends Error {
  constructor(info) {
    super('assertion failed');
    this.expected = info.expected;
    this.actual = info.actual;
    this.evidence = info.evidence;
    this.severity = info.severity;
  }
}

function check(cond, info) { if (!cond) throw new TestFailure(info); }

function pass(id, desc, note) {
  STATS.total++; STATS.pass++;
  line('PASS ' + id + ' ' + desc);
  if (note) line('     注: ' + note);
}

function fail(id, desc, info) {
  STATS.total++; STATS.fail++;
  FAILS.push({ id, desc });
  line('FAIL ' + id + ' ' + desc);
  line('     期望: ' + info.expected);
  line('     实际: ' + info.actual);
  if (info.evidence) line('     证据: ' + info.evidence);
  if (info.severity) line('     严重度: ' + info.severity);
}

async function run(id, desc, fn, note) {
  try {
    const extra = await fn();
    pass(id, desc, typeof extra === 'string' ? extra : note);
  } catch (e) {
    if (e instanceof TestFailure) fail(id, desc, e);
    else fail(id, desc, {
      expected: '断言通过',
      actual: ((e && e.stack) || String(e)).split('\n').slice(0, 3).join(' | '),
    });
  }
}

function describeError(e) {
  if (!e) return String(e);
  return (e.name || 'Error') + ': ' + (e.message || String(e));
}

async function mustThrow(fn) {
  try { const v = await fn(); return { threw: false, value: v }; }
  catch (e) { return { threw: true, error: e }; }
}

function j(v) { try { return JSON.stringify(v); } catch { return String(v); } }

// ==========================================================
// localStorage 内存 mock
// 两种初始态（历史坑，见 docs/EXPERIENCE.md §7.3）：
//   'migrated' —— 已完成投产迁移（PROD_RESET_FLAG 已存在）→ 测试数据保留
//   'fresh'    —— 全新设备（无 flag，服务层会一次性清空）→ 测试数据会被清掉
// ==========================================================
function createLocalStorage() {
  const map = new Map();
  let writeErrorFactory = null;
  let readErrorFactory = null;
  const calls = { getItem: 0, setItem: 0, removeItem: 0, clear: 0, key: 0 };

  const ls = {
    get length() { return map.size; },
    key(i) {
      calls.key++;
      const keys = [...map.keys()];
      return (i >= 0 && i < keys.length) ? keys[i] : null;
    },
    getItem(k) {
      calls.getItem++;
      if (readErrorFactory) throw readErrorFactory();
      const kk = String(k);
      return map.has(kk) ? map.get(kk) : null;
    },
    setItem(k, v) {
      calls.setItem++;
      if (writeErrorFactory) throw writeErrorFactory();
      map.set(String(k), String(v));
    },
    removeItem(k) { calls.removeItem++; map.delete(String(k)); },
    clear() { calls.clear++; map.clear(); },
  };

  const api = {
    ls, calls,
    failWrites(factory) { writeErrorFactory = factory; },
    clearWriteFailure() { writeErrorFactory = null; },
    failReads(factory) { readErrorFactory = factory; },
    clearReadFailure() { readErrorFactory = null; },
    hardReset() {
      map.clear();
      for (const k of Object.keys(calls)) calls[k] = 0;
    },
    raw(k) { return map.has(String(k)) ? map.get(String(k)) : null; },
    seed(db, device) {
      api.hardReset();
      if (device !== 'fresh') map.set(PROD_RESET_FLAG, '2026-09-09T00:00:00.000Z');
      if (db !== undefined && db !== null) {
        map.set(LS_KEY, typeof db === 'string' ? db : JSON.stringify(db));
      }
    },
  };
  return api;
}

const storage = createLocalStorage();

function readRawDB() {
  const raw = storage.raw(LS_KEY);
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch { return '<<CORRUPT>>'; }
}
function rawMedicines() {
  const d = readRawDB();
  return (d && d !== '<<CORRUPT>>' && Array.isArray(d.medicines)) ? d.medicines : [];
}

// ==========================================================
// 测试数据工厂
// ==========================================================
let idSeq = 0;
function nextId(prefix) { idSeq++; return prefix + '-' + String(idSeq).padStart(4, '0'); }

const DATE_FMT = (() => {
  try {
    const f = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' });
    if (f.format(new Date(2026, 0, 15)) === '2026-01-15') return f;
  } catch { /* fallthrough */ }
  return null;
})();
function todayLocal(d) {
  const t = d || new Date();
  if (DATE_FMT) return DATE_FMT.format(t);
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
}
function shiftToday(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return todayLocal(d);
}

function baseMed() {
  return {
    id: nextId('med'),
    name: '阿莫西林胶囊',
    brand: '联邦制药',
    image_url: 'data:image/png;base64,iVBORw0KGgo=',
    form_type: '胶囊',
    category: '抗生素',
    location: '药箱A',
    total_quantity: 10,
    unit: '粒',
    threshold: 2,
    expiry_date: '2099-12-31',
    last_purchase_date: '2026-01-01',
    symptoms_treated: '细菌感染',
    dosage_instruction: '一次2粒',
    daily_usage: 2,
    side_effects: '偶见皮疹',
    usage_frequency_score: 0,
  };
}
/** 规范化：去掉值为 undefined 的键，便于与经过 JSON 往返的对象比较 */
function canon(o) { return JSON.parse(JSON.stringify(o)); }
function makeMed(over) { return Object.assign(baseMed(), over || {}); }
function makeItem(over) {
  return Object.assign({
    id: nextId('item'), medicine_name: '阿莫西林胶囊', reason: '手动添加',
    status: 'pending', created_at: '2026-01-01T00:00:00.000Z',
  }, over || {});
}
function makeLog(over) {
  return Object.assign({
    id: nextId('log'), medicine_id: 'med-x', medicine_name: '阿莫西林胶囊', brand: '联邦制药',
    amount: 2, log_time: '2026-01-01T08:00:00.000Z',
  }, over || {});
}
function emptyDB() { return { medicines: [], shoppingList: [], logs: [] }; }
function seedDB(db, device) { storage.seed(db || emptyDB(), device || 'migrated'); }

// ==========================================================
// 打包（esbuild，随 vite 安装，不新增依赖）
// ==========================================================
function buildBundle() {
  const out = path.join(os.tmpdir(), 'mb-svc-bundle-' + process.pid + '.mjs');
  const esbuildJs = path.join(PROJECT_ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild');
  const args = [
    esbuildJs, SRC_FILE,
    '--bundle', '--format=esm', '--platform=node',
    '--define:import.meta.env.VITE_SUPABASE_URL=""',
    '--define:import.meta.env.VITE_SUPABASE_ANON_KEY=""',
    '--external:@supabase/supabase-js',
    '--log-level=warning',
    '--outfile=' + out,
  ];
  if (!fs.existsSync(esbuildJs)) throw new Error('找不到 esbuild: ' + esbuildJs);
  execFileSync(process.execPath, args, { cwd: PROJECT_ROOT, encoding: 'utf8', stdio: 'pipe' });
  return out;
}

// ==========================================================
// 时区子进程：TZ 由进程环境决定 + 假时钟固定时刻
// ==========================================================
function tzChildMain(tz) {
  const bundle = process.env.MB_BUNDLE;
  const RealDate = Date;
  const FIXED_MS = RealDate.parse('2026-03-01T20:30:00.000Z'); // 东八区已是 03-02，UTC 还是 03-01
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(FIXED_MS); else super(...a); }
    static now() { return FIXED_MS; }
    static parse(s) { return RealDate.parse(s); }
    static UTC(...a) { return RealDate.UTC(...a); }
  }
  globalThis.Date = FakeDate;
  globalThis.localStorage = storage.ls;

  const expectedLocalToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new RealDate(FIXED_MS));

  return import(pathToFileURL(bundle).href).then(async (mod) => {
    const svc = mod.MedicineService;
    const out = {
      tz,
      resolvedTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      fixedInstant: new RealDate(FIXED_MS).toISOString(),
      expectedLocalToday,
      utcDate: new RealDate(FIXED_MS).toISOString().slice(0, 10),
      todayDateString: mod.todayDateString(),
      localDateString: mod.localDateString(new RealDate(FIXED_MS)),
      storageMode: mod.storageMode,
      expiryBoundary: {},
      writtenLastPurchase: null,
      sortedOrder: null,
      parseOffsets: null,
    };

    // 过期边界：本地今天 / 本地昨天
    const y = new RealDate(FIXED_MS);
    y.setDate(y.getDate() - 1);
    const yStr = mod.localDateString(y);
    seedDB({
      medicines: [
        makeMed({ id: 'tz-today', name: '今天到期药', expiry_date: expectedLocalToday, category: '感冒', usage_frequency_score: 5 }),
        makeMed({ id: 'tz-yest', name: '昨天过期药', expiry_date: yStr, category: '感冒', usage_frequency_score: 5 }),
      ],
      shoppingList: [], logs: [],
    }, 'migrated');
    await svc.getMedicines();
    const list = await svc.getShoppingList();
    out.expiryBoundary = { yesterday: yStr, expiredNames: list.map(i => i.medicine_name) };

    // 写入路径：入库时未填 last_purchase_date → 应写本地今天
    seedDB(emptyDB(), 'migrated');
    await svc.addMedicine(makeMed({ id: 'tz-write', name: '时区写入药', expiry_date: '2099-12-31', last_purchase_date: '' }));
    const meds = await svc.getMedicines();
    out.writtenLastPurchase = meds.length ? meds[0].last_purchase_date : null;

    // 排序：last_purchase_date 新→旧（同类目权重、同 usage_frequency_score）
    const mk = (id, d) => makeMed({ id, name: '排序药' + id, expiry_date: '2099-12-31', last_purchase_date: d, category: '感冒', usage_frequency_score: 5 });
    out.sortedOrder = svc.sortMedicines([
      mk('a', '2026-01-15'), mk('b', '2026-06-30'), mk('c', '2025-03-01'), mk('d', '2026-01-15'),
    ]).map(m => m.id);
    // 证明 new Date('YYYY-MM-DD') 是 UTC 零点解析
    out.parseOffsets = {
      utcParsed: new RealDate('2026-01-15').getTime(),
      localMidnight: new RealDate(2026, 0, 15).getTime(),
      offsetMinutes: (new RealDate('2026-01-15').getTime() - new RealDate(2026, 0, 15).getTime()) / 60000,
    };
    return out;
  });
}

// ==========================================================
// 主流程
// ==========================================================
async function main() {
  line('='.repeat(78));
  line('services/medicineService.ts —— Node 端服务层测试');
  line('node ' + process.version + ' | ' + process.platform + ' | 本机时区 ' + Intl.DateTimeFormat().resolvedOptions().timeZone + ' | 今天 ' + todayLocal());
  line('='.repeat(78));

  const bundlePath = buildBundle();
  const bundleSrc = fs.readFileSync(bundlePath, 'utf8');
  globalThis.localStorage = storage.ls; // 必须在 import 之前挂好

  // 捕获服务层自身的 console.error（数据损坏/写入失败时它会打日志），
  // 汇总到输出末尾，避免几十条堆栈把 PASS/FAIL 主体淹没（内容一字不改，只做归并）。
  const svcConsoleErrors = [];
  let svcConsoleErrorCount = 0;
  const realConsoleError = console.error.bind(console);
  console.error = (...args) => {
    svcConsoleErrorCount++;
    const msg = args.map(a => (a && a.message) ? (a.name + ': ' + a.message) : (typeof a === 'string' ? a : String(a))).join(' ').slice(0, 160);
    if (!svcConsoleErrors.includes(msg)) svcConsoleErrors.push(msg);
  };
  void realConsoleError;

  // 捕获服务层广播的 mb:storage-error 事件（notifyStorageError 走 window.dispatchEvent）
  const storageEvents = [];
  globalThis.window = {
    dispatchEvent(evt) { storageEvents.push(evt && evt.detail ? evt.detail : String(evt)); return true; },
  };
  if (typeof globalThis.CustomEvent !== 'function') {
    globalThis.CustomEvent = class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init && init.detail; }
    };
  }

  const mod = await import(pathToFileURL(bundlePath).href);
  const S = mod.MedicineService;

  // ----------------------------------------------------------
  line('');
  line('--- Z. 构建产物与后端选择 ---');
  // ----------------------------------------------------------
  await run('Z1', 'bundle 中 import.meta.env 已被 --define 内联（无残留引用）', () => {
    check(!bundleSrc.includes('import.meta.env'), {
      expected: 'bundle 源码中不出现 import.meta.env',
      actual: '仍出现 import.meta.env',
      evidence: 'esbuild --define 未生效',
    });
    return 'bundle ' + bundleSrc.length + ' 字节（' + bundlePath + '）';
  });
  await run('Z2', '未配置 Supabase 时后端降级为 localStorage（行为判定）', async () => {
    // storageMode 常量只从 supabaseClient 导出、未在 medicineService 再导出，
    // 因此改为行为判定：直接往 localStorage 主键写数据，fetchData() 能读到即为本地后端。
    seedDB({ medicines: [makeMed({ id: 'Z-2', name: '后端判定药' })], shoppingList: [], logs: [] }, 'migrated');
    const d = await S.fetchData();
    check(!!d && Array.isArray(d.medicines) && d.medicines.length === 1 && d.medicines[0].id === 'Z-2', {
      expected: 'fetchData() 读到 localStorage 里的 1 条药品 [Z-2]',
      actual: j(d && d.medicines && d.medicines.map(m => m.id)),
      evidence: 'services/supabaseClient.ts:17-18 isSupabaseConfigured=false → readDB() 走 localRead',
    });
    check(!bundleSrc.includes('VITE_SUPABASE'), {
      expected: 'bundle 中无 VITE_SUPABASE_* 残留', actual: '仍存在 VITE_SUPABASE',
    });
    return 'isSupabaseConfigured=false，走 localStorage 分支（esbuild --define 生效）';
  });
  await run('Z3', '脚本自算的本地日期与服务层 todayDateString() 一致', () => {
    check(todayLocal() === mod.todayDateString(), {
      expected: todayLocal(), actual: mod.todayDateString(),
      evidence: 'services/medicineService.ts:28-36 localDateString',
    });
    return '今天=' + todayLocal();
  });

  // ----------------------------------------------------------
  line('');
  line('--- N. mock 设备初始态（历史坑：reset 清掉迁移 flag 会触发投产清空）---');
  // ----------------------------------------------------------
  await run('N1', '全新设备（无迁移 flag）：getMedicines 触发一次性投产清空', async () => {
    seedDB({ medicines: [makeMed({ id: 'seed-1' })], shoppingList: [makeItem({ id: 'si-1' })], logs: [makeLog({ id: 'lg-1' })] }, 'fresh');
    const meds = await S.getMedicines();
    const raw = readRawDB();
    check(meds.length === 0 && raw.medicines.length === 0 && raw.shoppingList.length === 0 && raw.logs.length === 0, {
      expected: '三张表被清空（medicines=0）',
      actual: 'medicines=' + meds.length + ' shoppingList=' + raw.shoppingList.length + ' logs=' + raw.logs.length,
      evidence: 'services/medicineService.ts:187-204 resetForProduction',
    });
    check(storage.raw(PROD_RESET_FLAG) !== null, {
      expected: 'PROD_RESET_FLAG 被写入', actual: 'flag=' + j(storage.raw(PROD_RESET_FLAG)),
      evidence: 'services/medicineService.ts:200',
    });
    return 'flag 已封口，清空只发生一次';
  });
  await run('N2', '已完成迁移的设备（有 flag）：getMedicines 保留测试数据', async () => {
    seedDB({ medicines: [makeMed({ id: 'seed-2', name: '保留药' })], shoppingList: [], logs: [] }, 'migrated');
    const meds = await S.getMedicines();
    check(meds.length === 1 && meds[0].id === 'seed-2', {
      expected: 'medicines.length === 1', actual: 'medicines.length === ' + meds.length,
      evidence: '本组之后所有用例都使用 migrated 初始态',
    });
    return '测试数据不会被清空';
  });

  // ----------------------------------------------------------
  line('');
  line('--- A. 基础 CRUD ---');
  // ----------------------------------------------------------
  const aMed = makeMed({ id: 'A-1', name: '布洛芬缓释胶囊', brand: '芬必得', total_quantity: 8, usage_frequency_score: 3 });
  await run('A1', '新增：addMedicine 后读回，全部字段逐一一致', async () => {
    seedDB();
    const r = await S.addMedicine(aMed);
    check(r.merged === false, { expected: 'merged === false', actual: 'merged === ' + j(r.merged), evidence: 'services/medicineService.ts:615-646' });
    const meds = await S.getMedicines();
    check(meds.length === 1, { expected: '药品数 1', actual: '药品数 ' + meds.length });
    const got = canon(meds[0]);
    const want = canon(aMed);
    const diffs = [];
    for (const k of Object.keys(want)) if (j(got[k]) !== j(want[k])) diffs.push(k + ': 实际=' + j(got[k]) + ' 期望=' + j(want[k]));
    for (const k of Object.keys(got)) if (!(k in want)) diffs.push('多出字段 ' + k + '=' + j(got[k]));
    check(diffs.length === 0, {
      expected: Object.keys(want).length + ' 个字段全部一致',
      actual: diffs.join('; ') || '(无差异)',
      evidence: 'services/medicineService.ts:639-641',
    });
    return Object.keys(want).length + ' 字段全部一致，id=' + got.id;
  });
  await run('A2', '新增（同名同剂型同品牌）：合并入库，不产生重复条目且保留原 id/频率分', async () => {
    seedDB();
    await S.addMedicine(aMed);
    const r2 = await S.addMedicine(makeMed({ id: 'A-1-other', name: aMed.name, brand: aMed.brand, total_quantity: 20, expiry_date: '2030-06-30', usage_frequency_score: 99 }));
    const meds = await S.getMedicines();
    check(r2.merged === true, {
      expected: 'merged === true', actual: 'merged === ' + j(r2.merged),
      evidence: 'services/medicineService.ts:162-171 isSameMedicineIdentity',
    });
    check(meds.length === 1, { expected: '药品数 1（无重复条目）', actual: '药品数 ' + meds.length, evidence: 'services/medicineService.ts:619-637' });
    check(meds[0].id === 'A-1', { expected: "id 保留 'A-1'", actual: 'id=' + meds[0].id });
    check(meds[0].total_quantity === 20 && meds[0].expiry_date === '2030-06-30', {
      expected: '数量=20 效期=2030-06-30', actual: '数量=' + meds[0].total_quantity + ' 效期=' + meds[0].expiry_date,
    });
    check(meds[0].usage_frequency_score === 3, {
      expected: '保留库内 usage_frequency_score=3', actual: 'usage_frequency_score=' + meds[0].usage_frequency_score,
      evidence: 'services/medicineService.ts:631',
    });
    check(meds[0].last_purchase_date === todayLocal(), {
      expected: 'last_purchase_date=' + todayLocal(), actual: 'last_purchase_date=' + meds[0].last_purchase_date,
      evidence: 'services/medicineService.ts:632',
    });
    return '合并正确，offsetRestocks=' + j(r2.offsetRestocks);
  });
  await run('A3', '修改：updateMedicine 按 id 整体替换，字段更新', async () => {
    seedDB();
    await S.addMedicine(aMed);
    const before = (await S.getMedicines())[0];
    await S.updateMedicine(Object.assign({}, before, { total_quantity: 42, location: '药箱B', category: '止痛药', side_effects: '胃部不适' }));
    const after = (await S.getMedicines())[0];
    check(after.id === before.id, { expected: 'id 不变 ' + before.id, actual: 'id=' + after.id, evidence: 'services/medicineService.ts:665-669' });
    check(after.total_quantity === 42 && after.location === '药箱B' && after.category === '止痛药' && after.side_effects === '胃部不适', {
      expected: 'total_quantity=42 location=药箱B category=止痛药 side_effects=胃部不适',
      actual: 'total_quantity=' + after.total_quantity + ' location=' + after.location + ' category=' + after.category + ' side_effects=' + after.side_effects,
    });
    return '整体替换生效';
  });
  await run('A4', '删除：deleteMedicine 后该药品消失', async () => {
    seedDB();
    await S.addMedicine(aMed);
    await S.deleteMedicine('A-1');
    const meds = await S.getMedicines();
    check(meds.length === 0, { expected: '药品数 0', actual: '药品数 ' + meds.length, evidence: 'services/medicineService.ts:677-691' });
    return '按 id 删除成功';
  });
  await run('A5', '新增：同名不同剂型视为独立条目（不合并）', async () => {
    seedDB();
    await S.addMedicine(aMed);
    const r = await S.addMedicine(makeMed({ id: 'A-5', name: aMed.name, brand: aMed.brand, form_type: '片剂', total_quantity: 5 }));
    const meds = await S.getMedicines();
    check(r.merged === false && meds.length === 2, {
      expected: 'merged=false 且药品数 2', actual: 'merged=' + r.merged + ' 药品数 ' + meds.length,
      evidence: 'services/medicineService.ts:166-170',
    });
    return '剂型参与身份判定';
  });

  // ----------------------------------------------------------
  line('');
  line('--- B. 吃药打卡（扣库存 + 写 usage log + 非法数量防御）---');
  // ----------------------------------------------------------
  await run('B1', '正常打卡：库存扣减、usage log 落库、使用频率 +1', async () => {
    seedDB();
    await S.addMedicine(aMed);
    const t0 = new Date().toISOString();
    await S.consumeMedicine('A-1', 3);
    const meds = await S.getMedicines();
    const logs = await S.getUsageLogs();
    check(meds[0].total_quantity === 5, { expected: '库存 8-3=5', actual: '库存 ' + meds[0].total_quantity, evidence: 'services/medicineService.ts:564' });
    check(meds[0].usage_frequency_score === 4, { expected: 'usage_frequency_score=4', actual: 'usage_frequency_score=' + meds[0].usage_frequency_score, evidence: 'services/medicineService.ts:565' });
    check(logs.length === 1, { expected: '日志 1 条', actual: '日志 ' + logs.length + ' 条', evidence: 'services/medicineService.ts:567-576' });
    const lg = logs[0];
    check(lg.medicine_id === 'A-1' && lg.medicine_name === aMed.name && lg.amount === 3 && lg.brand === aMed.brand, {
      expected: 'medicine_id=A-1 medicine_name=' + aMed.name + ' amount=3 brand=' + aMed.brand,
      actual: 'medicine_id=' + lg.medicine_id + ' medicine_name=' + lg.medicine_name + ' amount=' + j(lg.amount) + ' brand=' + j(lg.brand),
    });
    check(typeof lg.log_time === 'string' && lg.log_time >= t0 && !Number.isNaN(new Date(lg.log_time).getTime()), {
      expected: 'log_time 为本次打卡的合法 ISO 时间', actual: 'log_time=' + j(lg.log_time),
    });
    return '库存 8→5，日志 1 条，频率 3→4';
  });
  await run('B2', '打卡日志带品牌快照，且不影响同名的另一品牌', async () => {
    seedDB();
    await S.addMedicine(aMed);
    await S.addMedicine(makeMed({ id: 'B-2b', name: aMed.name, brand: '中美史克', total_quantity: 6 }));
    await S.consumeMedicine('B-2b', 2);
    const logs = await S.getUsageLogs();
    const meds = await S.getMedicines();
    const other = meds.find(m => m.id === 'A-1');
    check(logs.length === 1 && logs[0].brand === '中美史克', {
      expected: "日志 brand='中美史克'", actual: '日志 ' + logs.length + ' 条，brand=' + j(logs[0] && logs[0].brand),
      evidence: 'services/medicineService.ts:572',
    });
    check(other.total_quantity === 8, {
      expected: '同名的另一品牌库存仍为 8', actual: '库存 ' + other.total_quantity,
      evidence: 'services/medicineService.ts:162-171 品牌参与身份判定',
    });
    return '品牌快照正确，按 id 扣减';
  });

  const badAmounts = [
    ['B3', -1, '负数'],
    ['B4', 0, '0'],
    ['B5', NaN, 'NaN'],
    ['B6', Infinity, 'Infinity'],
    ['B7', 'abc', '非数字字符串'],
    ['B8', '', '空字符串'],
    ['B9', undefined, 'undefined'],
  ];
  for (const [id, amt, label] of badAmounts) {
    await run(id, '非法打卡数量被拒（' + label + '=' + j(amt) + '）：抛错且无日志、库存不变', async () => {
      seedDB();
      await S.addMedicine(aMed);
      const before = (await S.getMedicines())[0];
      const r = await mustThrow(() => S.consumeMedicine('A-1', amt));
      check(r.threw, {
        expected: '抛出「用药数量必须为大于 0 的数字」',
        actual: '未抛错，resolve 值=' + j(r.value),
        evidence: 'services/medicineService.ts:561-563 数量防御',
      });
      const after = (await S.getMedicines())[0];
      const logs = await S.getUsageLogs();
      check(after.total_quantity === before.total_quantity, { expected: '库存保持 ' + before.total_quantity, actual: '库存 ' + after.total_quantity });
      check(logs.length === 0, { expected: '日志 0 条', actual: '日志 ' + logs.length + ' 条' });
      check(after.usage_frequency_score === before.usage_frequency_score, {
        expected: 'usage_frequency_score 保持 ' + before.usage_frequency_score, actual: '= ' + after.usage_frequency_score,
      });
      return '库存 ' + after.total_quantity + '，日志 0 条，' + describeError(r.error);
    });
  }
  await run('B10', '打卡数量超过库存：clamp 到 0 且不产生 NaN/负数', async () => {
    seedDB();
    await S.addMedicine(makeMed({ id: 'B-10', name: '限量药', total_quantity: 2 }));
    await S.consumeMedicine('B-10', 5);
    const meds = await S.getMedicines();
    check(meds[0].total_quantity === 0, {
      expected: '库存 clamp 到 0', actual: '库存 ' + j(meds[0].total_quantity),
      evidence: 'services/medicineService.ts:564 Math.max(0, ...)',
    });
    return '超出部分被截断，日志 amount=5';
  });
  await run('B11', '库存耗尽：自动加入补货清单（reason=用尽，且幂等）', async () => {
    seedDB();
    await S.addMedicine(makeMed({ id: 'B-11', name: '耗尽药', total_quantity: 2 }));
    await S.consumeMedicine('B-11', 2);
    await S.consumeMedicine('B-11', 1);
    await S.consumeMedicine('B-11', 1);
    const list = await S.getShoppingList();
    const hits = list.filter(i => i.medicine_name === '耗尽药');
    check(hits.length === 1 && hits[0].reason === '用尽', {
      expected: '1 条 用尽 条目', actual: hits.length + ' 条，reason=' + j(hits.map(h => h.reason)),
      evidence: 'services/medicineService.ts:578-589',
    });
    return '重复耗尽不重复加条目';
  });

  // ----------------------------------------------------------
  line('');
  line('--- C. 过期检测 ---');
  // ----------------------------------------------------------
  await run('C1', '已过期药品：读取时自动进入补货清单（reason=过期）', async () => {
    seedDB({ medicines: [makeMed({ id: 'C-1', name: '过期药', expiry_date: shiftToday(-1) })], shoppingList: [], logs: [] }, 'migrated');
    await S.getMedicines();
    const list = await S.getShoppingList();
    check(list.length === 1 && list[0].medicine_name === '过期药' && list[0].reason === '过期', {
      expected: '1 条 {过期药, 过期}', actual: j(list.map(i => ({ n: i.medicine_name, r: i.reason }))),
      evidence: 'services/medicineService.ts:442-466 addExpiredToShoppingList',
    });
    return '自动补货清单写入成功';
  });
  await run('C2', '重复触发过期检测：不产生重复条目', async () => {
    seedDB({ medicines: [makeMed({ id: 'C-2', name: '过期药', expiry_date: shiftToday(-30) })], shoppingList: [], logs: [] }, 'migrated');
    await S.getMedicines();
    await S.getMedicines();
    await S.checkExpiry();
    await S.getMedicines();
    const list = await S.getShoppingList();
    check(list.length === 1, {
      expected: '4 次触发后仍 1 条', actual: list.length + ' 条',
      evidence: 'services/medicineService.ts:449-451 按 name+pending 去重',
    });
    return '幂等';
  });
  await run('C3', '未过期药品不进入补货清单', async () => {
    seedDB({
      medicines: [
        makeMed({ id: 'C-3', name: '未过期药', expiry_date: shiftToday(1) }),
        makeMed({ id: 'C-3b', name: '远期药', expiry_date: '2099-01-01' }),
      ], shoppingList: [], logs: [],
    }, 'migrated');
    await S.getMedicines();
    const list = await S.getShoppingList();
    check(list.length === 0, { expected: '清单 0 条', actual: list.length + ' 条: ' + j(list.map(i => i.medicine_name)) });
    return '未来效期不受影响';
  });
  await run('C4', '边界：expiry_date === 今天 不算过期（严格小于才过期）', async () => {
    seedDB({ medicines: [makeMed({ id: 'C-4', name: '今日到期药', expiry_date: todayLocal() })], shoppingList: [], logs: [] }, 'migrated');
    await S.getMedicines();
    const list = await S.getShoppingList();
    check(list.length === 0, {
      expected: '当天不算过期 → 清单 0 条', actual: list.length + ' 条',
      evidence: 'services/medicineService.ts:448 med.expiry_date < today',
    });
    return '边界行为：当天仍可用';
  });

  // ----------------------------------------------------------
  line('');
  line('--- D. 补货核销（入库）---');
  // ----------------------------------------------------------
  await run('D1', '登记补货：清单条目被核销，库存/效期/最近购入被更新', async () => {
    seedDB({ medicines: [makeMed({ id: 'D-1', name: '补货药', total_quantity: 0, expiry_date: shiftToday(-5) })], shoppingList: [], logs: [] }, 'migrated');
    await S.getMedicines();
    const list0 = await S.getShoppingList();
    check(list0.length === 1, { expected: '核销前 1 条', actual: list0.length + ' 条' });
    await S.restockMedicine(list0[0].id, 20, '2030-05-20');
    const list1 = await S.getShoppingList();
    const med = (await S.getMedicines()).find(m => m.id === 'D-1');
    check(list1.length === 0, { expected: '清单条目被核销 → 0 条', actual: list1.length + ' 条', evidence: 'services/medicineService.ts:705-706' });
    check(med.total_quantity === 20 && med.expiry_date === '2030-05-20' && med.last_purchase_date === todayLocal(), {
      expected: '数量=20 效期=2030-05-20 最近购入=' + todayLocal(),
      actual: '数量=' + med.total_quantity + ' 效期=' + med.expiry_date + ' 最近购入=' + med.last_purchase_date,
      evidence: 'services/medicineService.ts:711-713',
    });
    return '核销 + 入库链路正常';
  });
  const badRestock = [
    ['D2', -5, '2030-01-01', '数量为负'],
    ['D3', NaN, '2030-01-01', '数量 NaN'],
    ['D4', Infinity, '2030-01-01', '数量 Infinity'],
    ['D5', 10, '2030/01/01', '效期格式非法'],
    ['D6', 10, '', '效期为空'],
  ];
  for (const [id, qty, exp, label] of badRestock) {
    await run(id, '补货登记非法入参被拒（' + label + '）：抛错且清单条目保留、库存不变', async () => {
      seedDB({ medicines: [makeMed({ id: 'D-x', name: '补货药', total_quantity: 1, expiry_date: shiftToday(-5) })], shoppingList: [], logs: [] }, 'migrated');
      await S.getMedicines();
      const item = (await S.getShoppingList())[0];
      const r = await mustThrow(() => S.restockMedicine(item.id, qty, exp));
      check(r.threw, {
        expected: '抛出「购入数量或有效期格式不正确，本次登记未保存」',
        actual: '未抛错，resolve 值=' + j(r.value),
        evidence: 'services/medicineService.ts:699-703 输入防御',
      });
      const list = await S.getShoppingList();
      const med = (await S.getMedicines()).find(m => m.id === 'D-x');
      check(list.length === 1, { expected: '清单条目保留 1 条', actual: list.length + ' 条' });
      check(med.total_quantity === 1 && med.expiry_date === shiftToday(-5), {
        expected: '库存=1 效期=' + shiftToday(-5), actual: '库存=' + j(med.total_quantity) + ' 效期=' + med.expiry_date,
      });
      return '清单保留，库存未变，' + describeError(r.error);
    });
  }
  await run('D7', '入库新药自动核销匹配的待补货条目（offsetRestocks）', async () => {
    seedDB({ medicines: [], shoppingList: [makeItem({ id: 'D-7-item', medicine_name: '布洛芬缓释胶囊', reason: '用尽' })], logs: [] }, 'migrated');
    const r = await S.addMedicine(makeMed({ id: 'D-7-med', name: '布洛芬缓释胶囊', brand: '芬必得', total_quantity: 12 }));
    const list = await S.getShoppingList();
    check(r.offsetRestocks.length === 1 && r.offsetRestocks[0] === '布洛芬缓释胶囊' && list.length === 0, {
      expected: "offsetRestocks=['布洛芬缓释胶囊'] 且清单清空",
      actual: 'offsetRestocks=' + j(r.offsetRestocks) + ' 清单=' + list.length + ' 条',
      evidence: 'services/medicineService.ts:643 settleMatchingRestocks / 113-129 isRestockMatch',
    });
    return '入库即核销';
  });
  await run('D8', '编辑药品手动补货（库存增加 + previous）：刷新最近购入并核销提醒', async () => {
    seedDB({ medicines: [makeMed({ id: 'D-8', name: '手动补货药', total_quantity: 1 })], shoppingList: [makeItem({ id: 'D-8-item', medicine_name: '手动补货药' })], logs: [] }, 'migrated');
    const before = (await S.getMedicines()).find(m => m.id === 'D-8');
    const r = await S.updateMedicine(Object.assign({}, before, { total_quantity: 30, last_purchase_date: '2020-01-01' }), { previous: before });
    const after = (await S.getMedicines()).find(m => m.id === 'D-8');
    const list = await S.getShoppingList();
    check(after.last_purchase_date === todayLocal() && r.offsetRestocks.length === 1 && list.length === 0, {
      expected: '最近购入=' + todayLocal() + " offsetRestocks=['手动补货药'] 清单 0 条",
      actual: '最近购入=' + after.last_purchase_date + ' offsetRestocks=' + j(r.offsetRestocks) + ' 清单=' + list.length + ' 条',
      evidence: 'services/medicineService.ts:661-672',
    });
    return '手动补货识别生效';
  });

  // ----------------------------------------------------------
  line('');
  line('--- E. 数据损坏保护（历史高危 bug：损坏 → 空库覆盖）---');
  // ----------------------------------------------------------
  const CORRUPT = '{"medicines":[{"id":"x",  <<< 非法 JSON';
  await run('E1', '主键为非法 JSON：getMedicines 抛错（返回失败语义，而非空数组）', async () => {
    storage.seed(CORRUPT, 'migrated');
    const r = await mustThrow(() => S.getMedicines());
    check(r.threw, {
      expected: '抛错 ' + READ_FAIL_MSG,
      actual: '未抛错，返回 ' + j(r.value),
      evidence: 'services/medicineService.ts:221-226 localRead 返回 null；:479 抛出 READ_FAIL_MSG',
    });
    return describeError(r.error);
  });
  await run('E2', '主键为非法 JSON：getShoppingList / getUsageLogs 抛错', async () => {
    storage.seed(CORRUPT, 'migrated');
    const a = await mustThrow(() => S.getShoppingList());
    const b = await mustThrow(() => S.getUsageLogs());
    check(a.threw && b.threw, {
      expected: '两个读取入口都抛错',
      actual: 'getShoppingList threw=' + a.threw + ' / getUsageLogs threw=' + b.threw,
      evidence: 'services/medicineService.ts:496-500 / 532-536',
    });
    return '读取失败语义一致';
  });
  const corruptMutations = [
    ['E3', 'addMedicine', () => S.addMedicine(makeMed({ id: 'E-3' })), 'services/medicineService.ts:616-617'],
    ['E4', 'deleteMedicine', () => S.deleteMedicine('whatever'), 'services/medicineService.ts:678-679'],
    ['E5', 'consumeMedicine', () => S.consumeMedicine('whatever', 1), 'services/medicineService.ts:553-554'],
    ['E6', 'updateMedicine', () => S.updateMedicine(makeMed({ id: 'E-6' })), 'services/medicineService.ts:655-656'],
    ['E7', 'importData(merge)', () => S.importData(j({ medicines: [canon(makeMed({ id: 'E-7' }))] }), 'merge'), 'services/medicineService.ts:803-804'],
  ];
  for (const [id, name, fn, evidenceLine] of corruptMutations) {
    await run(id, '损坏状态下变更方法 ' + name + ' 必须失败，且不得把损坏数据覆盖成空库', async () => {
      storage.seed(CORRUPT, 'migrated');
      const r = await mustThrow(fn);
      check(r.threw, {
        expected: '抛错 ' + READ_FAIL_MSG,
        actual: '未抛错，返回 ' + j(r.value),
        evidence: evidenceLine,
      });
      check(storage.raw(LS_KEY) === CORRUPT, {
        expected: 'localStorage 主键内容原样保留（损坏数据未被覆盖）',
        actual: '主键被改写为：' + String(storage.raw(LS_KEY)).slice(0, 120),
        evidence: '旧版 bug：localRead 返回 EMPTY_DB 后任意写入都会清空真实数据',
      });
      return describeError(r.error) + '；损坏内容未被触碰';
    });
  }
  await run('E8', '损坏状态下 fetchData()（调试入口）返回失败语义而不是空库', async () => {
    storage.seed(CORRUPT, 'migrated');
    const r = await mustThrow(() => S.fetchData());
    check(r.threw, {
      expected: '抛错，或明确返回 null（读取失败语义）',
      actual: '未抛错，返回 ' + j(r.value) + '（与「空药箱」不可区分）',
      evidence: 'services/medicineService.ts:470 取读结果 ?? EMPTY_DB() —— 该调试入口仍保留旧版写法',
      severity: '低（调试/兼容入口；UI 主链路 getMedicines/getShoppingList/getUsageLogs 均已抛错）',
    });
    return 'fetchData 未抛错';
  });
  await run('E9', '损坏状态下 checkExpiry()（可写入口）应让调用方感知失败', async () => {
    storage.seed(CORRUPT, 'migrated');
    const r = await mustThrow(() => S.checkExpiry());
    check(r.threw, {
      expected: '抛错或明确返回失败',
      actual: '未抛错，静默 resolve(' + j(r.value) + ') —— 与「无需补货」不可区分',
      evidence: 'services/medicineService.ts:597-603 读取失败时直接 return',
      severity: '低（失败时不会破坏数据，但调用方完全无法感知读取失败）',
    });
    return 'checkExpiry 静默返回';
  });
  await run('E10', '存储读通道不可用（getItem 抛错）时同样走失败语义且不覆盖数据', async () => {
    seedDB({ medicines: [makeMed({ id: 'E-10' })], shoppingList: [], logs: [] }, 'migrated');
    storage.failReads(() => new Error('SecurityError: storage disabled'));
    const r = await mustThrow(() => S.getMedicines());
    storage.clearReadFailure();
    check(r.threw, { expected: '抛错 ' + READ_FAIL_MSG, actual: '未抛错，返回 ' + j(r.value), evidence: 'services/medicineService.ts:213-226' });
    check(rawMedicines().length === 1, { expected: '原数据未被覆盖（1 条）', actual: '药品数 ' + rawMedicines().length });
    return '隐私模式等场景安全';
  });

  // ----------------------------------------------------------
  line('');
  line('--- F. 存储写失败（QuotaExceededError）---');
  // ----------------------------------------------------------
  function quotaError() {
    const e = new Error('QuotaExceededError: the quota has been exceeded.');
    e.name = 'QuotaExceededError';
    return e;
  }
  async function writeFailureCase(id, desc, setup, mutate, extraEvidence) {
    await run(id, desc, async () => {
      setup();
      storageEvents.length = 0;
      const rawBefore = storage.raw(LS_KEY);
      storage.failWrites(quotaError);
      const r = await mustThrow(() => mutate());
      const rawAfter = storage.raw(LS_KEY);
      storage.clearWriteFailure();
      const events = storageEvents.slice();
      const extra = extraEvidence ? extraEvidence() : '';
      check(r.threw, {
        expected: '抛错，或返回明确的失败语义（如 {ok:false}）让调用方感知',
        actual: '未抛错；返回值 ' + j(r.value) + '（与成功路径同形，调用方无法感知失败）',
        evidence: 'services/medicineService.ts:229-237 localWrite 只 console.error + notifyStorageError，不向上抛。'
          + '同步观测：主键内容是否变化=' + (rawBefore === rawAfter ? '否（本次修改未落盘，数据丢失）' : '是')
          + '；mb:storage-error 事件数=' + events.length + (events.length ? '（' + j(events) + '）' : '')
          + (extra ? '；' + extra : ''),
        severity: '中（浏览器里 UI 还能靠 mb:storage-error 事件提示用户；但服务层的返回值/异常通道没有失败信号，'
          + '任何非 UI 调用方（脚本、测试、非浏览器宿主）都会认为保存成功）',
      });
      return '调用方无法感知失败';
    });
  }
  await writeFailureCase('F1', 'setItem 抛 QuotaExceededError：addMedicine 不得静默成功',
    () => seedDB(), () => S.addMedicine(makeMed({ id: 'F-1', name: '写失败药' })),
    () => '落盘药品数=' + rawMedicines().length + '（期望 1，实际未写入）');
  await writeFailureCase('F2', 'setItem 抛 QuotaExceededError：consumeMedicine 不得静默成功',
    () => seedDB({ medicines: [makeMed({ id: 'F-2', name: '写失败药', total_quantity: 5 })], shoppingList: [], logs: [] }, 'migrated'),
    () => S.consumeMedicine('F-2', 1),
    () => '落盘库存=' + j((rawMedicines()[0] || {}).total_quantity) + '（期望 4，实际未写入）');
  await writeFailureCase('F3', 'setItem 抛 QuotaExceededError：deleteMedicine 不得静默成功',
    () => seedDB({ medicines: [makeMed({ id: 'F-3', name: '写失败药' })], shoppingList: [], logs: [] }, 'migrated'),
    () => S.deleteMedicine('F-3'),
    () => '落盘药品数=' + rawMedicines().length + '（期望 0，实际未删除）');
  await writeFailureCase('F4', 'setItem 抛 QuotaExceededError：restockMedicine 不得静默成功',
    () => seedDB({ medicines: [makeMed({ id: 'F-4', name: '写失败药', total_quantity: 0 })], shoppingList: [makeItem({ id: 'F-4-item', medicine_name: '写失败药' })], logs: [] }, 'migrated'),
    () => S.restockMedicine('F-4-item', 10, '2030-01-01'),
    () => '落盘库存=' + j((rawMedicines()[0] || {}).total_quantity) + '（期望 10，实际未写入）');
  await writeFailureCase('F5', 'setItem 抛 QuotaExceededError：importData(replace) 不得返回成功摘要',
    () => seedDB({ medicines: [makeMed({ id: 'F-5-old' })], shoppingList: [], logs: [] }, 'migrated'),
    () => S.importData(j({ medicines: [canon(makeMed({ id: 'F-5-new', name: '导入药' }))] }), 'replace'),
    () => '落盘药品 id=' + j(rawMedicines().map(m => m.id)) + '（期望 [F-5-new]，实际未恢复）');
  await run('F6', '写失败必须双通道：既抛错给调用方，也广播 mb:storage-error 给 UI', async () => {
    seedDB();
    storageEvents.length = 0;
    storage.failWrites(quotaError);
    const thrown = await mustThrow(() => S.addMedicine(makeMed({ id: 'F-6' })));
    storage.clearWriteFailure();
    check(thrown.threw && storageEvents.length >= 1 && String(storageEvents[0]).includes('写入失败'), {
      expected: '抛错 且 至少 1 条含「写入失败」的 mb:storage-error 事件（调用方信号 + UI 提示）',
      actual: 'threw=' + thrown.threw + ' 事件数=' + storageEvents.length + ' 内容=' + j(storageEvents),
      evidence: 'services/medicineService.ts localWrite：notifyStorageError(...) 之后 throw WRITE_FAIL_MSG',
    });
    return '双通道：异常 + 事件=' + j(storageEvents[0]);
  });
  await run('F7', '无 window 环境（纯 node）下写失败完全无任何信号', async () => {
    seedDB();
    const savedWindow = globalThis.window;
    delete globalThis.window;
    storageEvents.length = 0;
    storage.failWrites(quotaError);
    const r = await mustThrow(() => S.addMedicine(makeMed({ id: 'F-7' })));
    storage.clearWriteFailure();
    globalThis.window = savedWindow;
    check(r.threw || storageEvents.length > 0, {
      expected: '即使没有 window，也应通过异常/返回值让调用方感知',
      actual: '未抛错（返回 ' + j(r.value) + '）且零事件；数据未落库（药品数 ' + rawMedicines().length + '）',
      evidence: 'services/medicineService.ts:55 typeof window !== "undefined" 判空后直接跳过通知',
      severity: '中（非浏览器宿主，如本项目 scripts/ 下的 node 脚本、SSR、测试环境：写失败 = 完全静默的数据丢失）',
    });
    return '完全静默';
  });

  // ----------------------------------------------------------
  line('');
  line('--- G. 导入导出往返 ---');
  // ----------------------------------------------------------
  const richDB = {
    medicines: [
      makeMed({ id: 'G-m1', name: '感冒灵颗粒', brand: '999', form_type: '颗粒', category: '感冒', total_quantity: 12, unit: '袋', expiry_date: '2027-08-31', last_purchase_date: '2026-02-01', image_url: 'https://cdn.example.com/a.png', usage_frequency_score: 7 }),
      makeMed({ id: 'G-m2', name: '布洛芬缓释胶囊', brand: '芬必得', form_type: '胶囊', category: '止痛', total_quantity: 3, unit: '粒', expiry_date: '2026-12-01', last_purchase_date: '2025-11-11', image_url: 'data:image/webp;base64,UklGRg==', usage_frequency_score: 2 }),
      makeMed({ id: 'G-m3', name: '碘伏棉签', brand: undefined, image_url: undefined, form_type: '外用', category: '外用', total_quantity: 50, unit: '支', expiry_date: '2028-01-01', last_purchase_date: '2026-03-03', usage_frequency_score: 1 }),
    ],
    shoppingList: [
      makeItem({ id: 'G-i1', medicine_name: '感冒灵颗粒', reason: '用尽', created_at: '2026-02-02T01:02:03.000Z' }),
      makeItem({ id: 'G-i2', medicine_name: '布洛芬缓释胶囊', reason: '过期', created_at: '2026-02-03T01:02:03.000Z' }),
    ],
    logs: [
      makeLog({ id: 'G-l1', medicine_id: 'G-m1', medicine_name: '感冒灵颗粒', brand: '999', amount: 2, log_time: '2026-02-05T09:00:00.000Z' }),
      makeLog({ id: 'G-l2', medicine_id: 'G-m2', medicine_name: '布洛芬缓释胶囊', brand: '芬必得', amount: 1, log_time: '2026-02-06T09:00:00.000Z', user: '老板' }),
    ],
  };
  await run('G1', 'exportData()：包装格式与 counts 正确', async () => {
    seedDB(canon(richDB), 'migrated');
    const raw = await S.exportData();
    const p = JSON.parse(raw);
    check(p.app === 'medicine-box' && p.version === 1 && p.counts.medicines === 3 && p.counts.shoppingList === 2 && p.counts.logs === 2, {
      expected: 'app=medicine-box version=1 counts={3,2,2}',
      actual: 'app=' + j(p.app) + ' version=' + j(p.version) + ' counts=' + j(p.counts),
      evidence: 'services/medicineService.ts:737-751',
    });
    return '导出 ' + raw.length + ' 字节，exported_at=' + j(p.exported_at);
  });
  await run('G2', 'replace 模式回灌：药品/清单/日志逐字段一致', async () => {
    seedDB(canon(richDB), 'migrated');
    const raw = await S.exportData();
    storage.seed(emptyDB(), 'migrated');
    const res = await S.importData(raw, 'replace');
    const back = readRawDB();
    const diffs = [];
    for (const table of ['medicines', 'shoppingList', 'logs']) {
      try { assert.deepStrictEqual(canon(back[table]), canon(richDB[table])); }
      catch (e) { diffs.push(table + ' 不一致: ' + String(e.message).split('\n').slice(0, 6).join(' ')); }
    }
    check(diffs.length === 0, {
      expected: '三张表逐字段与导出前完全一致（node:assert deepStrictEqual）',
      actual: diffs.join(' || ') || '(无差异)',
      evidence: 'importData replace 分支 services/medicineService.ts:798-800',
    });
    check(res.medicines === 3 && res.shoppingList === 2 && res.logs === 2, { expected: '摘要 {3,2,2}', actual: j(res) });
    return '往返无损（含 base64 图片、brand、user、无品牌/无图条目）';
  });
  await run('G3', 'merge 模式：按 id 去重合并，冲突以导入为准，其余保留', async () => {
    seedDB(canon(richDB), 'migrated');
    const raw = await S.exportData();
    const conflict = Object.assign(canon(richDB.medicines[0]), { total_quantity: 999, location: '本地库' });
    storage.seed({
      medicines: [conflict, makeMed({ id: 'G-local', name: '本地独有药' })],
      shoppingList: [makeItem({ id: 'G-local-item', medicine_name: '本地独有药' })],
      logs: [makeLog({ id: 'G-local-log', medicine_id: 'G-local', medicine_name: '本地独有药' })],
    }, 'migrated');
    const res = await S.importData(raw, 'merge');
    const back = readRawDB();
    const byId = Object.fromEntries(back.medicines.map(m => [m.id, m]));
    check(back.medicines.length === 4, {
      expected: '药品 4 条（3 导入 + 1 本地独有）',
      actual: back.medicines.length + ' 条: ' + j(back.medicines.map(m => m.id)),
      evidence: 'services/medicineService.ts:806-808',
    });
    check(byId['G-m1'].total_quantity === 12 && byId['G-m1'].location === '药箱A', {
      expected: 'id 冲突以导入为准（数量=12 位置=药箱A）',
      actual: '数量=' + byId['G-m1'].total_quantity + ' 位置=' + byId['G-m1'].location,
    });
    check(!!byId['G-local'], { expected: '本地独有药保留', actual: j(Object.keys(byId)) });
    check(back.shoppingList.length === 3 && back.logs.length === 3, {
      expected: '清单 3 条 / 日志 3 条', actual: '清单 ' + back.shoppingList.length + ' / 日志 ' + back.logs.length,
    });
    check(res.medicines === 3, { expected: '摘要 medicines=3（导入条数）', actual: j(res) });
    return '合并去重正确';
  });
  await run('G4', '往返：sortMedicines 结果在导出/导入前后一致', async () => {
    seedDB(canon(richDB), 'migrated');
    const raw = await S.exportData();
    const before = S.sortMedicines(await S.getMedicines()).map(m => m.id);
    storage.seed(emptyDB(), 'migrated');
    await S.importData(raw, 'replace');
    const after = S.sortMedicines(await S.getMedicines()).map(m => m.id);
    check(j(before) === j(after), { expected: j(before), actual: j(after), evidence: 'services/medicineService.ts:539-549' });
    return '排序稳定：' + j(after);
  });

  // ----------------------------------------------------------
  line('');
  line('--- H. 导入清洗（备份投毒）---');
  // ----------------------------------------------------------
  await run('H1', '非法 JSON / 缺 medicines 数组：importData 抛错', async () => {
    seedDB();
    const cases = [
      ['非 JSON', '{oops'],
      ['null', 'null'],
      ['数组顶格', '[]'],
      ['无 medicines 字段', j({ shoppingList: [] })],
      ['medicines 是字符串', j({ medicines: 'not-an-array' })],
      ['medicines 是对象', j({ medicines: { a: 1 } })],
      ['包装格式里 data.medicines 非数组', j({ app: 'medicine-box', data: { medicines: 42 } })],
      ['data 是 null', j({ app: 'medicine-box', data: null })],
    ];
    const survived = [];
    for (const [label, raw] of cases) {
      const r = await mustThrow(() => S.importData(raw, 'replace'));
      if (!r.threw) survived.push(label + ' → 未抛错，返回 ' + j(r.value));
    }
    check(survived.length === 0, {
      expected: cases.length + ' 种非法输入全部抛错',
      actual: survived.join(' | ') || '(全部抛错)',
      evidence: 'services/medicineService.ts:759-775',
    });
    return 'medicines 非数组被拒绝';
  });
  await run('H2', '非法日期被清洗为「」（不参与过期比较）', async () => {
    seedDB();
    const bad = ['', 'abc', '2024/01/01', '20240101', '2024-1-1', '2024-1-01', null, 12345, {}];
    for (const v of bad) {
      const med = Object.assign(canon(makeMed({ id: 'H2-' + Math.random().toString(36).slice(2, 8) })), { expiry_date: v, last_purchase_date: v });
      await S.importData(j({ medicines: [med] }), 'replace');
      const m = (await S.getMedicines())[0];
      if (!m || m.expiry_date !== '' || m.last_purchase_date !== '') {
        throw new TestFailure({
          expected: 'expiry_date / last_purchase_date 均被清洗为 ""',
          actual: '输入 ' + j(v) + ' → expiry=' + j(m && m.expiry_date) + ' purchase=' + j(m && m.last_purchase_date),
          evidence: 'services/medicineService.ts:859-863 date10 + DATE_RE',
        });
      }
    }
    return bad.length + ' 种非法日期全部置空';
  });
  await run('H3', '正则通过但日历上不存在的日期（2024-13-45）也应被清洗', async () => {
    seedDB();
    await S.importData(j({ medicines: [Object.assign(canon(makeMed({ id: 'H3-1' })), { expiry_date: '2024-13-45', last_purchase_date: '2025-02-30' })] }), 'replace');
    const m1 = (await S.getMedicines())[0];
    await S.importData(j({ medicines: [Object.assign(canon(makeMed({ id: 'H3-2' })), { expiry_date: '0000-00-00x', last_purchase_date: '2024-00-10' })] }), 'replace');
    const m2 = (await S.getMedicines())[0];
    const bad = [['2024-13-45', m1.expiry_date], ['2025-02-30', m1.last_purchase_date], ['0000-00-00x', m2.expiry_date], ['2024-00-10', m2.last_purchase_date]];
    check(bad.every(([, v]) => v === ''), {
      expected: 'expiry_date="" 且 last_purchase_date=""',
      actual: bad.map(([i, v]) => i + ' → ' + j(v)).join(' | '),
      evidence: 'services/medicineService.ts:859 DATE_RE 只校验形状（4-2-2 位数字）不校验取值范围。'
        + '最小复现：importData 一条 expiry_date="2024-13-45" 的备份 → 该值被原样存库，'
        + '因字典序极大而永远不会被判过期（:448）也不会进补货清单',
      severity: '低-中（备份投毒/旧版脏数据可绕过日期清洗）',
    });
    return '非法日历日期未清洗';
  });
  await run('H4', 'image_url 白名单：仅 data:image/ 与 http(s) 保留，其余丢弃', async () => {
    seedDB();
    const cases = [
      ['data:image/png;base64,AAAA', true],
      ['data:image/webp;base64,BBBB', true],
      ['https://cdn.example.com/x.png', true],
      ['http://cdn.example.com/x.png', true],
      ['HTTPS://CDN.EXAMPLE.COM/x.png', true],
      ['  https://cdn.example.com/y.png  ', true],
      ['javascript:alert(1)', false],
      ['data:text/html;base64,PHNjcmlwdD4=', false],
      ['data:image', false],
      ['//evil.example.com/x.png', false],
      ['vbscript:msgbox', false],
      ['', false],
      [null, false],
    ];
    const wrong = [];
    for (const [input, keep] of cases) {
      const med = Object.assign(canon(makeMed({ id: 'H4-' + Math.random().toString(36).slice(2, 8) })), { image_url: input });
      await S.importData(j({ medicines: [med] }), 'replace');
      const m = (await S.getMedicines())[0];
      const got = m.image_url !== undefined && m.image_url !== '';
      if (got !== keep) wrong.push(j(input) + ' → 期望' + (keep ? '保留' : '丢弃') + '，实际=' + j(m.image_url));
    }
    check(wrong.length === 0, {
      expected: cases.length + ' 组用例的白名单判定全部正确',
      actual: wrong.join(' | ') || '(全部正确)',
      evidence: 'services/medicineService.ts:869-874 sanitizeImageUrl',
    });
    return 'javascript: / data:text/html / 协议相对 URL 均被拦截；http(s) 首尾空白被 trim 保留';
  });
  await run('H5', '数字字段非法值兜底为 0（NaN/Infinity/字符串/对象/数组/null）', async () => {
    seedDB();
    const badNums = ['abc', NaN, Infinity, -Infinity, null, undefined, {}, [], '12abc'];
    const bad = [];
    for (const v of badNums) {
      const med = Object.assign(canon(makeMed({ id: 'H5-' + Math.random().toString(36).slice(2, 8) })), {
        total_quantity: v, threshold: v, daily_usage: v, usage_frequency_score: v,
      });
      await S.importData(j({ medicines: [med] }), 'replace');
      const m = (await S.getMedicines())[0];
      for (const f of ['total_quantity', 'threshold', 'daily_usage', 'usage_frequency_score']) {
        if (m[f] !== 0) bad.push(j(v) + '.' + f + '=' + j(m[f]));
      }
    }
    check(bad.length === 0, {
      expected: '所有非法数字字段 → 0',
      actual: bad.join(' | ') || '(全部为 0)',
      evidence: 'services/medicineService.ts:252-255 num()',
    });
    return badNums.length + ' 组 × 4 字段全部兜底';
  });
  await run('H6', '缺 id / name 的条目被丢弃并计入 skippedMedicines', async () => {
    seedDB();
    const res = await S.importData(j({
      medicines: [
        canon(makeMed({ id: 'H6-ok', name: '好药' })),
        { name: '缺 id 药' },
        { id: 'H6-noname' },
        { id: '   ', name: '空白 id' },
        null, 'string', 42,
      ],
    }), 'replace');
    const meds = await S.getMedicines();
    check(meds.length === 1 && meds[0].id === 'H6-ok', {
      expected: '仅保留 1 条 H6-ok', actual: meds.length + ' 条: ' + j(meds.map(m => m.id)),
      evidence: 'services/medicineService.ts:877-882',
    });
    check(res.skippedMedicines === 6, { expected: 'skippedMedicines=6', actual: 'skippedMedicines=' + res.skippedMedicines });
    return '脏条目被丢弃而非写入';
  });
  await run('H7', 'form_type 非法 → 兜底 OTHER；合法值保留', async () => {
    seedDB();
    await S.importData(j({
      medicines: [
        canon(makeMed({ id: 'H7-1', form_type: '胶囊' })),
        canon(makeMed({ id: 'H7-2', form_type: '不存在的剂型' })),
        canon(makeMed({ id: 'H7-3', form_type: null })),
      ],
    }), 'replace');
    const meds = await S.getMedicines();
    const by = Object.fromEntries(meds.map(m => [m.id, m.form_type]));
    check(by['H7-1'] === '胶囊' && by['H7-2'] === '其他' && by['H7-3'] === '其他', {
      expected: "{H7-1:'胶囊', H7-2:'其他', H7-3:'其他'}", actual: j(by),
      evidence: 'services/medicineService.ts:885-887',
    });
    return '枚举兜底生效';
  });
  await run('H8', '日志/清单清洗：非法 log_time 兜底当前时间、非法 reason → 手动添加、status 强制 pending', async () => {
    seedDB();
    await S.importData(j({
      medicines: [canon(makeMed({ id: 'H8-m' }))],
      logs: [
        { id: 'H8-l1', medicine_id: 'H8-m', medicine_name: '好药', amount: 'NaN', log_time: 'not-a-date' },
        { id: 'H8-l2', medicine_name: '好药', amount: 1, log_time: '2026-01-01T00:00:00.000Z' },
        { id: 'H8-l3', medicine_id: 'H8-m', amount: 1, log_time: '2026-01-01T00:00:00.000Z' },
      ],
      shoppingList: [
        { id: 'H8-i1', medicine_name: '好药', reason: '黑名单理由', status: 'bought', created_at: '' },
        { id: 'H8-i2', reason: '用尽' },
      ],
    }), 'replace');
    const logs = await S.getUsageLogs();
    const list = await S.getShoppingList();
    check(logs.length === 2 && j(logs.map(l => l.id).sort()) === j(['H8-l1', 'H8-l2']), {
      expected: "保留 ['H8-l1','H8-l2']（H8-l3 缺 medicine_name 被丢弃）",
      actual: j(logs.map(l => l.id)),
      evidence: 'services/medicineService.ts:910-915',
    });
    const l1 = logs.find(l => l.id === 'H8-l1');
    check(l1.amount === 0 && !Number.isNaN(new Date(l1.log_time).getTime()), {
      expected: 'amount=0 且 log_time 为合法时间（兜底为当前时间）', actual: 'amount=' + j(l1.amount) + ' log_time=' + j(l1.log_time),
      evidence: 'services/medicineService.ts:924-926',
    });
    check(list.length === 1 && list[0].reason === '手动添加' && list[0].status === 'pending' && list[0].created_at !== '', {
      expected: "保留 1 条 {reason:'手动添加', status:'pending', created_at 非空}",
      actual: j(list.map(i => ({ id: i.id, reason: i.reason, status: i.status, created_at: i.created_at }))),
      evidence: 'services/medicineService.ts:931-948',
    });
    return '清洗规则生效';
  });
  await run('H9', '备份投毒：total_quantity 为负数应被拒绝或兜底（库存不得为负）', async () => {
    seedDB();
    await S.importData(j({ medicines: [Object.assign(canon(makeMed({ id: 'H9-1' })), { total_quantity: -50 })] }), 'replace');
    const m = (await S.getMedicines())[0];
    check(m.total_quantity >= 0, {
      expected: 'total_quantity >= 0（拒绝或 clamp）',
      actual: 'total_quantity=' + j(m.total_quantity),
      evidence: 'services/medicineService.ts:252-255 num() 只判 Number.isFinite，负数原样放行；sanitizeMedicine:896 直接采用。'
        + '最小复现：importData({"medicines":[{"id":"x","name":"y","total_quantity":-50}]}) → 读回 total_quantity=-50',
      severity: '中（与 restockMedicine:701 / consumeMedicine:563 的数量防御不对称，负数库存可持久化）',
    });
    return '负库存可被导入';
  });

  // ----------------------------------------------------------
  line('');
  line('--- I. 时区（TZ 子进程 + 假时钟，固定时刻 2026-03-01T20:30:00Z）---');
  // ----------------------------------------------------------
  const TZS = ['Asia/Shanghai', 'America/New_York', 'UTC', 'Pacific/Kiritimati', 'Pacific/Midway'];
  const tzResults = {};
  const tzErrors = [];
  for (const tz of TZS) {
    const cp = spawnSync(process.execPath, [__filename, TZ_CHILD_FLAG, tz], {
      cwd: PROJECT_ROOT, encoding: 'utf8',
      env: Object.assign({}, process.env, { TZ: tz, MB_BUNDLE: bundlePath }),
    });
    const marker = String(cp.stdout || '').split(/\r?\n/).find(l => l.startsWith('__TZ_JSON__'));
    if (!marker) {
      tzErrors.push(tz + ': 无结果(exit=' + cp.status + ') ' + String(cp.stderr || '').slice(0, 300));
      continue;
    }
    tzResults[tz] = JSON.parse(marker.slice('__TZ_JSON__'.length));
  }
  await run('I0', '五个时区子进程均正常返回结果（TZ 环境变量生效）', () => {
    check(tzErrors.length === 0 && Object.keys(tzResults).length === TZS.length, {
      expected: TZS.length + ' 个时区各返回一份结果',
      actual: tzErrors.join(' | ') || Object.keys(tzResults).length + ' 个成功',
    });
    return TZS.map(tz => tz + '(UTC' + (tzResults[tz] ? (tzResults[tz].parseOffsets.offsetMinutes >= 0 ? '+' : '') + (tzResults[tz].parseOffsets.offsetMinutes / 60) : '?') + ')').join(' ');
  });
  await run('I1', 'todayDateString() 取本地日期，不随 UTC 泄漏（东八区下与 UTC 日期不同）', () => {
    const rows = [];
    for (const tz of TZS) {
      const r = tzResults[tz];
      if (!r) continue;
      rows.push(tz + ' today=' + r.todayDateString + ' utc=' + r.utcDate);
      if (r.resolvedTimeZone !== tz) {
        throw new TestFailure({ expected: 'resolvedOptions().timeZone === ' + tz, actual: r.resolvedTimeZone, evidence: 'TZ 环境变量未被子进程采纳' });
      }
      if (r.todayDateString !== r.expectedLocalToday) {
        throw new TestFailure({
          expected: 'todayDateString() === ' + r.expectedLocalToday + '（该时区本地日期）',
          actual: r.todayDateString,
          evidence: 'services/medicineService.ts:28-36；子进程固定时刻 ' + r.fixedInstant,
        });
      }
    }
    const sh = tzResults['Asia/Shanghai'];
    check(!!sh && sh.utcDate !== sh.todayDateString, {
      expected: '东八区下 UTC 日期与本地日期不同（证明本地/UTC 之分真实存在）',
      actual: sh ? 'utc=' + sh.utcDate + ' local=' + sh.todayDateString : '无结果',
      evidence: '固定时刻 2026-03-01T20:30Z → 东八区已是 03-02；若用 toISOString().slice(0,10) 会得到 03-01',
    });
    return rows.join(' / ');
  });
  await run('I2', '过期判定随本地时区正确（本地今天不过期、本地昨天过期，5 个时区一致）', () => {
    const wrong = [];
    for (const tz of TZS) {
      const r = tzResults[tz];
      if (!r) continue;
      const names = r.expiryBoundary.expiredNames;
      if (!(names.length === 1 && names[0] === '昨天过期药')) {
        wrong.push(tz + ': 过期集合=' + j(names) + '（本地昨天=' + r.expiryBoundary.yesterday + ' 本地今天=' + r.expectedLocalToday + '）');
      }
    }
    check(wrong.length === 0, {
      expected: '每个时区都只有「昨天过期药」被判过期（今日到期药不算）',
      actual: wrong.join(' | ') || '(5 个时区结果一致)',
      evidence: 'services/medicineService.ts:442-466 用本地日期字符串字典序比较',
    });
    return '5 时区判定一致';
  });
  await run('I3', '入库写入的 last_purchase_date = 该时区的本地今天（非 UTC 日期）', () => {
    const wrong = [];
    for (const tz of TZS) {
      const r = tzResults[tz];
      if (!r) continue;
      if (r.writtenLastPurchase !== r.expectedLocalToday) {
        wrong.push(tz + ': 写入=' + j(r.writtenLastPurchase) + ' 期望本地今天=' + r.expectedLocalToday + '（UTC 日期=' + r.utcDate + '）');
      }
    }
    check(wrong.length === 0, {
      expected: '每个时区写入的都是本地今天',
      actual: wrong.join(' | ') || '(5 个时区一致)',
      evidence: 'services/medicineService.ts:632/639/668/713 均调用 todayDateString()',
    });
    return '写入路径无 UTC 泄漏';
  });
  await run('I4', 'sortMedicines 对 last_purchase_date 的排序不随 UTC 偏移错乱', () => {
    const rows = TZS.map(tz => tz + ' 偏移' + (tzResults[tz] ? tzResults[tz].parseOffsets.offsetMinutes : '?') + 'min 顺序=' + j(tzResults[tz] && tzResults[tz].sortedOrder));
    const uniq = new Set(TZS.map(tz => j(tzResults[tz] && tzResults[tz].sortedOrder)));
    check(uniq.size === 1, {
      expected: '5 个时区排序结果完全相同',
      actual: rows.join(' | '),
      evidence: 'services/medicineService.ts:545-547 new Date(last_purchase_date).getTime()',
    });
    check(j(tzResults['UTC'].sortedOrder) === j(['b', 'a', 'd', 'c']), {
      expected: j(['b', 'a', 'd', 'c']) + '（06-30 > 01-15(a,d 稳定) > 2025-03-01）',
      actual: j(tzResults['UTC'].sortedOrder),
      evidence: '三级排序：类目权重 → usage_frequency_score → last_purchase_date 降序',
    });
    return '未发现 UTC 解析导致的排序错误';
  });
  await run('I5', 'new Date(YYYY-MM-DD) 确为 UTC 零点解析（但不影响排序）', () => {
    const offs = TZS.map(tz => tzResults[tz] && tzResults[tz].parseOffsets.offsetMinutes);
    const rows = TZS.map((tz, i) => tz + ': ' + offs[i] + 'min');
    check(new Set(offs).size > 1, { expected: '不同时区下 UTC 解析的偏移量不同（证明是 UTC 解析）', actual: rows.join(' | ') });
    return '比较双方同时平移，相对顺序不变 —— 本次未发现排序被时区破坏（5 时区顺序一致）';
  });

  // ----------------------------------------------------------
  line('');
  line('--- J. 同名不同品牌 ---');
  // ----------------------------------------------------------
  const NAME_J = '布洛芬缓释胶囊';
  await run('J1', '入库：同名同剂型、品牌不同 → 不合并（独立条目）', async () => {
    seedDB();
    const r1 = await S.addMedicine(makeMed({ id: 'J-a', name: NAME_J, brand: '芬必得', total_quantity: 10 }));
    const r2 = await S.addMedicine(makeMed({ id: 'J-b', name: NAME_J, brand: '中美史克', total_quantity: 6 }));
    const meds = await S.getMedicines();
    check(r1.merged === false && r2.merged === false && meds.length === 2, {
      expected: '两条独立记录', actual: 'merged=' + r1.merged + '/' + r2.merged + ' 药品数=' + meds.length,
      evidence: 'services/medicineService.ts:162-171 isSameMedicineIdentity 含 brand',
    });
    return '品牌参与身份判定';
  });
  await run('J2', '打卡：同名不同品牌分别记账，互不扣减', async () => {
    seedDB();
    await S.addMedicine(makeMed({ id: 'J-a', name: NAME_J, brand: '芬必得', total_quantity: 10 }));
    await S.addMedicine(makeMed({ id: 'J-b', name: NAME_J, brand: '中美史克', total_quantity: 6 }));
    await S.consumeMedicine('J-b', 4);
    const meds = await S.getMedicines();
    const a = meds.find(m => m.id === 'J-a'), b = meds.find(m => m.id === 'J-b');
    check(a.total_quantity === 10 && b.total_quantity === 2, {
      expected: 'J-a=10（不受影响） J-b=2', actual: 'J-a=' + a.total_quantity + ' J-b=' + b.total_quantity,
    });
    return '库存按 id 精确扣减';
  });
  await run('J3', '删除：删除品牌 B 不得顺手删掉品牌 A 的待补货提醒', async () => {
    seedDB({
      medicines: [
        makeMed({ id: 'J-a', name: NAME_J, brand: '芬必得', total_quantity: 10, expiry_date: shiftToday(-3) }),
        makeMed({ id: 'J-b', name: NAME_J, brand: '中美史克', total_quantity: 10, expiry_date: '2099-01-01' }),
      ], shoppingList: [], logs: [],
    }, 'migrated');
    await S.getMedicines();
    const before = await S.getShoppingList();
    await S.deleteMedicine('J-b');
    const after = await S.getShoppingList();
    const meds = await S.getMedicines();
    check(after.length === 1 && before.length === 1, {
      expected: '删除 B 后，A（仍已过期）的补货条目保留 1 条',
      actual: '删除前 ' + before.length + ' 条 → 删除后 ' + after.length + ' 条（A 仍过期）',
      evidence: 'services/medicineService.ts:685-689 按 item.medicine_name === target.name 清理，未区分品牌。'
        + '最小复现：seed 两条同名(' + NAME_J + ')不同品牌记录[A 已过期, B 未过期] → getMedicines 生成提醒 → deleteMedicine(B) → 提醒一并被删',
      severity: '中（瞬时误伤：提醒丢失；下次 getMedicines 会因 A 仍过期而重建，非永久丢失）',
    });
    check(meds.some(m => m.id === 'J-a'), { expected: 'J-a 仍在库中', actual: j(meds.map(m => m.id)) });
    return 'A 的记录本身未被删除';
  });
  await run('J4', '补货核销：同名不同品牌时不得把库存写进另一条记录', async () => {
    seedDB({
      medicines: [
        makeMed({ id: 'J-a', name: NAME_J, brand: '芬必得', total_quantity: 3, expiry_date: '2099-01-01' }),
        makeMed({ id: 'J-b', name: NAME_J, brand: '中美史克', total_quantity: 0, expiry_date: shiftToday(-1) }),
      ], shoppingList: [], logs: [],
    }, 'migrated');
    await S.getMedicines();
    const item = (await S.getShoppingList())[0];
    await S.restockMedicine(item.id, 20, '2030-01-01');
    const meds = await S.getMedicines();
    const a = meds.find(m => m.id === 'J-a'), b = meds.find(m => m.id === 'J-b');
    check(a.total_quantity === 3 && b.total_quantity === 20, {
      expected: 'J-a（芬必得）库存保持 3；J-b（中美史克）0→20',
      actual: 'J-a=' + a.total_quantity + '（效期 ' + a.expiry_date + '，最近购入 ' + a.last_purchase_date + '） J-b=' + b.total_quantity + '（效期 ' + b.expiry_date + '）',
      evidence: 'services/medicineService.ts:709 findIndex(m => m.name === targetItem.medicine_name) 只按药名定位，命中数组第一条 J-a。'
        + '最小复现：seed [A 品牌芬必得 库存3 未过期, B 品牌中美史克 库存0 已过期] → getMedicines → restockMedicine(条目, 20) → 20 被写进 A',
      severity: '中（补货入库写错记录：另一品牌的数量/效期被覆盖，真正缺货的品牌仍为 0）',
    });
    return '核销目标错误';
  });
  await run('J5', '提醒粒度：同名两条各自持有提醒，核销只影响被补货的那条', async () => {
    seedDB({
      medicines: [
        makeMed({ id: 'J-a', name: NAME_J, brand: '芬必得', total_quantity: 3, expiry_date: shiftToday(-1) }),
        makeMed({ id: 'J-b', name: NAME_J, brand: '中美史克', total_quantity: 3, expiry_date: shiftToday(-1) }),
      ], shoppingList: [], logs: [],
    }, 'migrated');
    await S.getMedicines();
    const shared = await S.getShoppingList();
    await S.addMedicine(makeMed({ id: 'J-a2', name: NAME_J, brand: '芬必得', total_quantity: 30, expiry_date: '2030-01-01' }));
    const afterRestock = await S.getShoppingList();
    await S.getMedicines();
    const afterReload = await S.getShoppingList();
    check(shared.length === 2 && shared.every(i => i.medicine_id), {
      expected: '同名不同品牌各持有 1 条提醒（共 2 条），且都带 medicine_id 精确定位',
      actual: '条目数=' + shared.length + ' medicine_id=' + j(shared.map(i => i.medicine_id)),
      evidence: 'medicineService.ts addExpiredToShoppingList：按 isItemForMedicine 去重并写入 medicine_id',
    });
    check(afterRestock.length === 1 && afterReload.length === 1, {
      expected: '入库 A 后只剩 B 的提醒（1 条），重载后仍为 1 条',
      actual: '入库后=' + afterRestock.length + ' 条，重载后=' + afterReload.length + ' 条',
      evidence: 'medicineService.ts settleMatchingRestocks / findMedicineForItem：品牌+id 精确匹配',
    });
    return '同名两条各自持有提醒，核销不再互相误伤';
  });

  // ----------------------------------------------------------
  line('');
  line('--- K. 属性测试：随机操作序列不变量 ---');
  // ----------------------------------------------------------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function stepString(op) {
    switch (op.kind) {
      case 'add-new': return 'addMedicine(新增 ' + op.name + '/' + op.form + '/' + (op.brand || '无品牌') + ' 数量=' + op.qty + ')';
      case 'add-merge': return 'addMedicine(合并 ' + op.name + ' 数量=' + op.qty + ')';
      case 'update': return 'updateMedicine(' + op.id + ' 数量=' + op.qty + ')';
      case 'consume': return 'consumeMedicine(' + op.id + ' 数量=' + op.amt + ')';
      case 'delete': return 'deleteMedicine(' + op.id + ')';
      case 'restock': return 'restockMedicine(' + op.itemId + ' 数量=' + op.qty + ' 效期=' + op.expiry + ')';
      case 'add-shopping': return 'addToShoppingList(' + op.name + ')';
      default: return op.kind;
    }
  }
  const SEQ_COUNT = 200;
  async function runPropertySequences(count) {
    const violations = [];
    let steps = 0, clampEvents = 0, seqs = 0;
    for (let s = 0; s < count && violations.length < 5; s++) {
      seqs++;
      const rand = mulberry32(0x5EED + s * 7919);
      const pick = arr => arr[Math.floor(rand() * arr.length) % arr.length];
      seedDB(emptyDB(), 'migrated');
      /** 模型：id -> { name, form, brand, qty, inSum, outSum, adjustSum, clampLoss } */
      const model = new Map();
      const keyOf = r => r.name + '|' + r.form + '|' + (r.brand || '');
      const byKey = new Map();
      const trace = [];
      const nSteps = 4 + Math.floor(rand() * 8);
      for (let st = 0; st < nSteps; st++) {
        const forms = ['片剂', '胶囊', '颗粒', '外用'];
        const kind = pick(['add-new', 'add-new', 'consume', 'consume', 'delete', 'restock', 'add-shopping', 'update', 'add-merge']);
        const ids = [...model.keys()];
        // eslint-disable-next-line no-useless-assignment -- 兜底默认值：kind 未命中任何分支时仍可直接使用
        let op = { kind };
        if (kind === 'add-new') {
          op = { kind, name: '药S' + s + 'T' + st, form: pick(forms), brand: pick(['', 'A', 'B']), qty: Math.floor(rand() * 51) };
          const med = makeMed({ id: 'P-' + s + '-' + st, name: op.name, brand: op.brand, form_type: op.form, total_quantity: op.qty, last_purchase_date: '2026-01-01' });
          await S.addMedicine(med);
          const rec = { id: med.id, name: op.name, form: op.form, brand: op.brand, qty: op.qty, inSum: op.qty, outSum: 0, adjustSum: 0, clampLoss: 0 };
          model.set(med.id, rec);
          byKey.set(keyOf(rec), rec);
        } else if (kind === 'add-merge' && ids.length > 0) {
          const targetId = pick(ids);
          const rec = model.get(targetId);
          op = { kind: 'add-merge', name: rec.name, qty: Math.floor(rand() * 51) };
          await S.addMedicine(makeMed({ id: 'P-' + s + '-' + st, name: rec.name, brand: rec.brand, form_type: rec.form, total_quantity: op.qty, last_purchase_date: '2026-01-01' }));
          rec.adjustSum += op.qty - rec.qty;
          rec.qty = op.qty;
        } else if (kind === 'update' && ids.length > 0) {
          const id = pick(ids);
          const rec = model.get(id);
          const q = Math.floor(rand() * 51);
          const cur = rawMedicines().find(m => String(m.id) === id);
          const inc = q > rec.qty;
          op = { kind: 'update', id, qty: q };
          await S.updateMedicine(Object.assign({}, cur, { total_quantity: q }), inc ? { previous: Object.assign({}, cur) } : undefined);
          rec.adjustSum += q - rec.qty;
          rec.qty = q;
        } else if (kind === 'consume' && ids.length > 0) {
          const id = pick(ids);
          const rec = model.get(id);
          const amt = 1 + Math.floor(rand() * 30);
          op = { kind: 'consume', id, amt };
          await S.consumeMedicine(id, amt);
          const rawQty = rec.qty - amt;
          rec.outSum += amt;
          if (rawQty < 0) { rec.clampLoss += -rawQty; clampEvents++; }
          rec.qty = Math.max(0, rawQty);
        } else if (kind === 'delete' && ids.length > 0) {
          const id = pick(ids);
          op = { kind: 'delete', id };
          await S.deleteMedicine(id);
          byKey.delete(keyOf(model.get(id)));
          model.delete(id);
        } else if (kind === 'add-shopping') {
          const names = [...model.values()].map(r => r.name);
          if (names.length === 0) continue;
          op = { kind: 'add-shopping', name: pick(names) };
          await S.addToShoppingList([{ name: op.name, reason: '手动添加' }]);
        } else if (kind === 'restock') {
          const list = await S.getShoppingList();
          if (list.length === 0) continue;
          const item = pick(list);
          const q = Math.floor(rand() * 51);
          op = { kind: 'restock', itemId: item.id, qty: q, expiry: '203' + (1 + Math.floor(rand() * 8)) + '-0' + (1 + Math.floor(rand() * 9)) + '-15' };
          await S.restockMedicine(item.id, op.qty, op.expiry);
          const target = [...model.values()].find(r => r.name === item.medicine_name);
          if (target) { target.adjustSum += op.qty - target.qty; target.qty = op.qty; }
        } else {
          continue;
        }
        trace.push(stepString(op));
        steps++;

        // ---- 每步之后校验不变量（直接读持久化内容，避免额外副作用） ----
        const snapshot = readRawDB();
        if (snapshot === '<<CORRUPT>>' || !snapshot || !Array.isArray(snapshot.medicines)) {
          violations.push({ inv: 'INV0 存储可解析', trace: trace.slice(), detail: 'localStorage 内容不可解析或 medicines 非数组' });
          break;
        }
        for (const m of snapshot.medicines) {
          if (typeof m.total_quantity !== 'number' || !Number.isFinite(m.total_quantity) || m.total_quantity < 0) {
            violations.push({ inv: 'INV1 库存为有限非负数', trace: trace.slice(), detail: m.id + '(' + m.name + ').total_quantity=' + j(m.total_quantity) });
          }
          const rec = model.get(String(m.id));
          if (!rec) {
            violations.push({ inv: 'INV0 模型一致', trace: trace.slice(), detail: '持久化出现模型外的药品 ' + m.id });
            continue;
          }
          if (m.total_quantity !== rec.qty) {
            violations.push({
              inv: 'INV2 库存 = 累计入库 − 累计消耗 + 调整',
              trace: trace.slice(),
              detail: '药品 ' + m.id + ' 实际=' + j(m.total_quantity) + ' 期望=' + j(rec.qty)
                + '（入库 ' + rec.inSum + ' − 消耗 ' + rec.outSum + ' + 覆盖式调整 ' + rec.adjustSum + ' + clamp ' + rec.clampLoss + '）',
            });
          }
          const ledger = rec.inSum - rec.outSum + rec.adjustSum + rec.clampLoss;
          if (ledger !== m.total_quantity) {
            violations.push({
              inv: 'INV2b 台账恒等式', trace: trace.slice(),
              detail: '药品 ' + m.id + ' 台账=' + j(ledger) + ' 实际=' + j(m.total_quantity),
            });
          }
        }
        for (const id of model.keys()) {
          if (!snapshot.medicines.some(m => String(m.id) === id)) {
            violations.push({ inv: 'INV0 模型一致', trace: trace.slice(), detail: '模型中的药品 ' + id + ' 未出现在持久化数据中' });
          }
        }
      }
    }
    return { violations, steps, clampEvents, seqs };
  }
  const prop = await runPropertySequences(SEQ_COUNT);
  await run('K1', '属性测试：' + SEQ_COUNT + ' 组随机操作序列，每步后库存恒为有限非负数', () => {
    const bad = prop.violations.filter(v => v.inv !== 'INV2 库存 = 累计入库 − 累计消耗 + 调整' && v.inv !== 'INV2b 台账恒等式');
    check(bad.length === 0, {
      expected: '所有序列的每一步，库存都是有限非负数（typeof number 且 >= 0）',
      actual: bad.length + ' 处违反：' + bad.map(v => v.inv + ' @ ' + v.detail).join(' | '),
      evidence: bad.length ? '触发序列：\n       ' + bad[0].trace.map((t, i) => (i + 1) + ') ' + t).join('\n       ') : '',
    });
    return prop.seqs + ' 组序列 / ' + prop.steps + ' 步服务层操作全部通过';
  });
  await run('K2', '属性测试：库存 = 累计入库 − 累计消耗 + 调整（含 clamp 修正）', () => {
    const bad = prop.violations.filter(v => v.inv === 'INV2 库存 = 累计入库 − 累计消耗 + 调整' || v.inv === 'INV2b 台账恒等式');
    check(bad.length === 0, {
      expected: '每步之后：库存 === 模型台账（入库和 − 消耗和 + 覆盖式调整 + 超量打卡被 clamp 的部分）',
      actual: bad.length + ' 处违反：' + bad.map(v => v.inv + ' @ ' + v.detail).join(' | '),
      evidence: bad.length ? '触发序列：\n       ' + bad[0].trace.map((t, i) => (i + 1) + ') ' + t).join('\n       ') : '',
    });
    return '超量打卡触发 clamp ' + prop.clampEvents + ' 次（clamp 语义已计入台账）';
  });
  await run('K3', '属性测试边界：入库数量为负时 INV1 仍应成立（拒绝或兜底）', async () => {
    seedDB();
    const r = await mustThrow(() => S.addMedicine(makeMed({ id: 'K3-neg', name: '负库存药', total_quantity: -5 })));
    const meds = await S.getMedicines();
    const q = meds.length ? meds[0].total_quantity : null;
    check(r.threw || (Number.isFinite(q) && q >= 0), {
      expected: 'addMedicine 拒绝负数（抛错），或入库后库存仍 >= 0',
      actual: r.threw ? '已抛错 ' + describeError(r.error) : '未抛错，落库 total_quantity=' + j(q),
      evidence: 'services/medicineService.ts:615-646 addMedicine 无数量校验（对照 restockMedicine:699-703 / consumeMedicine:561-563）；'
        + '经 importData 清洗通道（sanitizeMedicine:896 → num():252-255 仅判 isFinite）负数可完整进入库存。'
        + '最小复现：addMedicine({total_quantity:-5}) → 读回 -5',
      severity: '中（与 INV1 冲突：负库存可被写入并持久化）',
    });
    return r.threw ? '被拒绝' : '负库存已落库';
  });

  // ----------------------------------------------------------
  line('');
  line('--- 服务层自身日志（console.error 捕获，仅归并展示，内容未改写）---');
  line('console.error 调用 ' + svcConsoleErrorCount + ' 次；去重样例 ' + svcConsoleErrors.length + ' 条:');
  for (const m of svcConsoleErrors) line('  ' + m.slice(0, 200));
  line('');
  line('-'.repeat(78));
  line('FAIL 汇总: ' + (FAILS.map(f => f.id).join(',') || '(无)'));
  line('TOTAL=' + STATS.total + ' PASS=' + STATS.pass + ' FAIL=' + STATS.fail);
  line('-'.repeat(78));
  try { fs.unlinkSync(bundlePath); } catch { /* ignore */ }
  process.exitCode = STATS.fail > 0 ? 1 : 0;
}

// ==========================================================
// 入口
// ==========================================================
if (process.argv[2] === TZ_CHILD_FLAG) {
  tzChildMain(process.argv[3]).then((out) => {
    process.stdout.write('__TZ_JSON__' + JSON.stringify(out) + '\n');
  }).catch((e) => {
    process.stderr.write('TZ-CHILD-ERROR ' + ((e && e.stack) || String(e)) + '\n');
    process.exit(3);
  });
} else {
  main().catch((e) => {
    process.stderr.write('FATAL ' + ((e && e.stack) || String(e)) + '\n');
    process.exit(2);
  });
}
