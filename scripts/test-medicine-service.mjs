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
import { spawnSync } from 'node:child_process';

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
    /** 全部键值快照（失败原子性用：逐字节比对） */
    dump() { return Object.fromEntries(map); },
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
async function buildBundle() {
  const out = path.join(os.tmpdir(), 'mb-svc-bundle-' + process.pid + '.mjs');
  // 用 esbuild 的 JS API 而不是调用 bin/esbuild：
  // Windows 上 bin/esbuild 是 JS 启动壳，Linux/macOS 上却是原生二进制，
  // 用 node 去执行它在 CI（ubuntu）会直接 SyntaxError。
  let esbuild;
  try {
    esbuild = await import('esbuild');
  } catch (e) {
    throw new Error('找不到 esbuild：它是 devDependency，请先运行 npm install', { cause: e });
  }
  await esbuild.build({
    entryPoints: [SRC_FILE],
    outfile: out,
    bundle: true,
    format: 'esm',
    platform: 'node',
    define: {
      'import.meta.env.VITE_SUPABASE_URL': '""',
      'import.meta.env.VITE_SUPABASE_ANON_KEY': '""',
    },
    external: ['@supabase/supabase-js'],
    logLevel: 'warning',
  });
  return out;
}

// ==========================================================
// 时区子进程：TZ 由进程环境决定 + 假时钟固定时刻
// ==========================================================
function tzChildMain(tz, instantISO) {
  const bundle = process.env.MB_BUNDLE;
  const RealDate = Date;
  const FIXED_MS = RealDate.parse(instantISO || '2026-03-01T20:30:00.000Z'); // 默认：东八区已是 03-02，UTC 还是 03-01
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
      instant: new RealDate(FIXED_MS).toISOString(),
      expiryBoundary: {},
      writtenLastPurchase: null,
      consumeLogTime: null,
      logCount: 0,
      sortedOrder: null,
      parseOffsets: null,
    };

    // 过期边界：本地今天（不算过期）/ 本地昨天（过期）/ 本地明天（不算过期）
    const y = new RealDate(FIXED_MS);
    y.setDate(y.getDate() - 1);
    const yStr = mod.localDateString(y);
    const tm = new RealDate(FIXED_MS);
    tm.setDate(tm.getDate() + 1);
    const tmStr = mod.localDateString(tm);
    seedDB({
      medicines: [
        makeMed({ id: 'tz-today', name: '今天到期药', expiry_date: expectedLocalToday, category: '感冒', usage_frequency_score: 5 }),
        makeMed({ id: 'tz-yest', name: '昨天过期药', expiry_date: yStr, category: '感冒', usage_frequency_score: 5 }),
        makeMed({ id: 'tz-tom', name: '明天到期药', expiry_date: tmStr, category: '感冒', usage_frequency_score: 5 }),
      ],
      shoppingList: [], logs: [],
    }, 'migrated');
    await svc.getMedicines();
    const list = await svc.getShoppingList();
    out.expiryBoundary = { today: expectedLocalToday, yesterday: yStr, tomorrow: tmStr, expiredNames: list.map(i => i.medicine_name) };

    // 写入路径：入库时未填 last_purchase_date → 应写本地今天
    seedDB(emptyDB(), 'migrated');
    await svc.addMedicine(makeMed({ id: 'tz-write', name: '时区写入药', expiry_date: '2099-12-31', last_purchase_date: '' }));
    const meds = await svc.getMedicines();
    out.writtenLastPurchase = meds.length ? meds[0].last_purchase_date : null;

    // 打卡落库时间：假时钟固定时刻下应精确等于该时刻（不受时区偏移影响）
    seedDB({ medicines: [makeMed({ id: 'tz-consume', name: '打卡药', total_quantity: 5, expiry_date: '2099-12-31' })], shoppingList: [], logs: [] }, 'migrated');
    await svc.consumeMedicine('tz-consume', 1);
    const logs = await svc.getUsageLogs();
    out.consumeLogTime = logs.length ? logs[0].log_time : null;
    out.logCount = logs.length;

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

  const bundlePath = await buildBundle();
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
  // 注：2026-09-10 起补货清单规则收紧为「过期 / 用尽」两种，历史「手动添加」条目不再产生，
  // 因此这里用规则内的「用尽」条目来做"编辑加库存 → 核销提醒"的断言（语义不变）。
  await run('D8', '编辑药品补货（库存增加 + previous）：刷新最近购入并核销提醒', async () => {
    seedDB({ medicines: [makeMed({ id: 'D-8', name: '手动补货药', total_quantity: 1 })], shoppingList: [makeItem({ id: 'D-8-item', medicine_name: '手动补货药', reason: '用尽' })], logs: [] }, 'migrated');
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
      evidence: 'services/medicineService.ts:531-537 fetchData 读取失败即抛 READ_FAIL_MSG（首轮验收修复项：旧写法为 ?? EMPTY_DB()）',
    });
    return 'fetchData 抛错（读取失败语义正确）';
  });
  await run('E9', '损坏状态下 checkExpiry()（可写入口）应让调用方感知失败', async () => {
    storage.seed(CORRUPT, 'migrated');
    const r = await mustThrow(() => S.checkExpiry());
    check(r.threw, {
      expected: '抛错或明确返回失败',
      actual: '未抛错，静默 resolve(' + j(r.value) + ') —— 与「无需补货」不可区分',
      evidence: 'services/medicineService.ts:673-680 checkExpiry 读取失败即抛错（首轮验收修复项：旧写法为静默 return）',
    });
    return 'checkExpiry 抛错（调用方可感知）';
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
      check(r.threw && /保存失败/.test(String(r.error && r.error.message)), {
        expected: '抛错且错误信息明确（数据保存失败…本次修改未保存）',
        actual: 'threw=' + r.threw + '；error=' + describeError(r.error),
        evidence: 'services/medicineService.ts:271-285 localWrite 捕获 setItem 异常后 notifyStorageError + throw new Error(WRITE_FAIL_MSG)'
          + '（首轮验收修复项：旧实现只广播事件、不向上抛）。'
          + '同步观测：主键内容是否变化=' + (rawBefore === rawAfter ? '否（本次修改未落盘，数据丢失）' : '是')
          + '；mb:storage-error 事件数=' + events.length + (events.length ? '（' + j(events) + '）' : '')
          + (extra ? '；' + extra : ''),
      });
      return '写失败已抛错，调用方可见';
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
      evidence: 'services/medicineService.ts:283 无 window 时也照样 throw（首轮验收修复项：旧实现仅靠 window 事件通知，非浏览器宿主会静默丢数据）',
    });
    return '无 window 也抛错，不再静默';
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
  await run('H3', '形状合法但日历上不存在的日期（2024-13-45 等 4 例）应被清洗为空串', async () => {
    seedDB();
    await S.importData(j({ medicines: [Object.assign(canon(makeMed({ id: 'H3-1' })), { expiry_date: '2024-13-45', last_purchase_date: '2025-02-30' })] }), 'replace');
    const m1 = (await S.getMedicines())[0];
    await S.importData(j({ medicines: [Object.assign(canon(makeMed({ id: 'H3-2' })), { expiry_date: '0000-00-00x', last_purchase_date: '2024-00-10' })] }), 'replace');
    const m2 = (await S.getMedicines())[0];
    const bad = [['2024-13-45', m1.expiry_date], ['2025-02-30', m1.last_purchase_date], ['0000-00-00x', m2.expiry_date], ['2024-00-10', m2.last_purchase_date]];
    check(bad.every(([, v]) => v === ''), {
      expected: 'expiry_date="" 且 last_purchase_date=""',
      actual: bad.map(([i, v]) => i + ' → ' + j(v)).join(' | '),
      evidence: 'services/medicineService.ts:974-986 isValidCalendarDate（年份 1900-2999 + 闰年 + 每月天数）。'
        + '首轮验收修复项：旧实现只有 DATE_RE 形状校验，"2024-13-45" 会被原样存库且因字典序极大永不过期',
    });
    return '4 例非法日历日期全部清洗为空串';
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
      evidence: 'services/medicineService.ts:306 nonNegNum + 1019-1028 sanitizeMedicine（首轮验收修复项：旧实现 num() 只判 isFinite，负数原样落库）',
    });
    return '负库存被兜底为 0';
  });

  // ----------------------------------------------------------
  line('');
  line('--- I. 时区（TZ 子进程 + 假时钟，固定时刻 2026-03-01T20:30:00Z）---');
  // ----------------------------------------------------------
  /** 在指定时区 + 指定固定时刻下跑一个子进程，拿回该时刻的服务层行为快照 */
  function runTzChild(tz, instant) {
    const args = [__filename, TZ_CHILD_FLAG, tz];
    if (instant) args.push(instant);
    const cp = spawnSync(process.execPath, args, {
      cwd: PROJECT_ROOT, encoding: 'utf8',
      env: Object.assign({}, process.env, { TZ: tz, MB_BUNDLE: bundlePath }),
    });
    const marker = String(cp.stdout || '').split(/\r?\n/).find(l => l.startsWith('__TZ_JSON__'));
    if (!marker) {
      return { error: tz + '@' + (instant || '默认时刻') + ': 子进程无结果(exit=' + cp.status + ') ' + String(cp.stderr || '').slice(0, 300) };
    }
    return JSON.parse(marker.slice('__TZ_JSON__'.length));
  }
  const TZS = ['Asia/Shanghai', 'America/New_York', 'UTC', 'Pacific/Kiritimati', 'Pacific/Midway'];
  const tzResults = {};
  const tzErrors = [];
  for (const tz of TZS) {
    const tr = runTzChild(tz);
    if (tr.error) tzErrors.push(tr.error);
    else tzResults[tz] = tr;
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
  line('--- TM. 时间与日期边界（假时钟固定时刻 × 时区）---');
  // ----------------------------------------------------------
  // 每例 5 条断言：本地日期 / 过期判定 / 入库写入日期 / 打卡 log_time / 排序
  const TM_CASES = [
    ['TM1', 'Asia/Shanghai', '2026-01-31T15:59:00.000Z', false, '月末 01-31 23:59（东八区）'],
    ['TM2', 'Asia/Shanghai', '2026-12-31T15:59:00.000Z', false, '年末 12-31 23:59（东八区）'],
    ['TM3', 'Asia/Shanghai', '2024-02-29T15:59:00.000Z', false, '闰年 2024-02-29 23:59（东八区）'],
    ['TM4', 'Asia/Shanghai', '2024-03-01T15:59:00.000Z', false, '平年 2024-03-01 23:59（东八区）'],
    ['TM5', 'Asia/Shanghai', '2024-12-31T16:01:00.000Z', true, '跨年 2025-01-01 00:01（东八区，UTC 仍是 12-31）'],
    ['TM6', 'America/New_York', '2026-03-01T04:30:00.000Z', true, '纽约 2026-02-28 23:30（UTC 已是 03-01）'],
  ];
  const tmResults = {};
  for (const c of TM_CASES) tmResults[c[0]] = runTzChild(c[1], c[2]);
  for (const [id, tz, instant, crossDay, label] of TM_CASES) {
    const tr = tmResults[id];
    const bad = () => { throw new TestFailure({ expected: '子进程返回该时刻的行为快照', actual: tr.error || '(空)', evidence: tz + ' @ ' + instant }); };
    await run(id + 'a', label + '：todayDateString 取该时区的本地日期', () => {
      if (tr.error) bad();
      check(tr.resolvedTimeZone === tz && tr.todayDateString === tr.expectedLocalToday, {
        expected: 'tz=' + tz + ' 本地日期=' + tr.expectedLocalToday,
        actual: 'tz=' + tr.resolvedTimeZone + ' todayDateString=' + tr.todayDateString,
        evidence: 'services/medicineService.ts:28-36 localDateString（本地 getFullYear/getMonth/getDate）',
      });
      if (crossDay) {
        check(tr.utcDate !== tr.todayDateString, {
          expected: '跨日场景：UTC 日期 ≠ 本地日期（证明该场景真的能区分两种实现）',
          actual: 'utc=' + tr.utcDate + ' local=' + tr.todayDateString,
          evidence: '若用 new Date().toISOString().slice(0,10) 会得到 ' + tr.utcDate,
        });
      }
      return '本地 ' + tr.todayDateString + ' / UTC ' + tr.utcDate;
    });
    await run(id + 'b', label + '：过期判定按本地日期（仅「昨天过期药」进补货清单）', () => {
      if (tr.error) bad();
      const names = tr.expiryBoundary.expiredNames;
      check(names.length === 1 && names[0] === '昨天过期药', {
        expected: '过期集合 = [昨天过期药]（今天/明天到期均不算）',
        actual: j(names) + '（本地今天=' + tr.expiryBoundary.today + ' 昨天=' + tr.expiryBoundary.yesterday + ' 明天=' + tr.expiryBoundary.tomorrow + '）',
        evidence: 'services/medicineService.ts:499-527 本地日期字符串字典序比较',
      });
      return '今天/明天不算过期，昨天算过期';
    });
    await run(id + 'c', label + '：入库写入的 last_purchase_date = 本地今天', () => {
      if (tr.error) bad();
      check(tr.writtenLastPurchase === tr.expectedLocalToday, {
        expected: 'last_purchase_date = ' + tr.expectedLocalToday,
        actual: j(tr.writtenLastPurchase) + '（UTC 日期=' + tr.utcDate + '）',
        evidence: 'services/medicineService.ts:718/725 均走 todayDateString()',
      });
      return '写入 ' + tr.writtenLastPurchase;
    });
    await run(id + 'd', label + '：打卡 log_time 精确等于假时钟时刻（不随时区漂移）', () => {
      if (tr.error) bad();
      check(tr.logCount === 1 && tr.consumeLogTime === tr.instant, {
        expected: 'log_time = ' + tr.instant,
        actual: 'logs=' + tr.logCount + ' log_time=' + j(tr.consumeLogTime),
        evidence: 'services/medicineService.ts:643-651 new Date().toISOString()（瞬时时间，与时区无关）',
      });
      return 'log_time=' + tr.consumeLogTime;
    });
    await run(id + 'e', label + '：排序不随 UTC 偏移错乱', () => {
      if (tr.error) bad();
      check(j(tr.sortedOrder) === j(['b', 'a', 'd', 'c']), {
        expected: j(['b', 'a', 'd', 'c']) + '（06-30 > 01-15 > 2025-03-01，a/d 同日期保持稳定）',
        actual: j(tr.sortedOrder) + '（UTC 偏移 ' + tr.parseOffsets.offsetMinutes + ' 分钟）',
        evidence: 'services/medicineService.ts:613-623 new Date(last_purchase_date).getTime() 两侧同为 UTC 解析',
      });
      return '顺序一致，偏移 ' + tr.parseOffsets.offsetMinutes + 'min';
    });
  }

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
      evidence: 'services/medicineService.ts:774-782 带 medicine_id 的条目按 id 精确清理（首轮验收修复项：旧实现按药名一律删除，会误删另一品牌的提醒）',
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
      evidence: 'services/medicineService.ts:129-148 findMedicineForItem（按 medicine_id → brand → 最需补货兜底），'
        + '首轮验收修复项：旧实现 findIndex(m => m.name === item.medicine_name) 会把库存写进同名的另一条记录',
    });
    return '核销命中正确记录';
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

  // J7：演示数据清理迁移（老设备里遗留的演示数据）
  await run('J7', '遗留演示数据按指纹清空一次，真实数据不受影响', async () => {
    const demo = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'backup', 'medicine-box-demo-backup-20260909.json'), 'utf8')).data;
    seedDB(demo, 'migrated');
    const after = await S.getMedicines();
    check(after.length === 0, {
      expected: '识别出演示数据指纹 → 清空（0 种）',
      actual: '剩余 ' + after.length + ' 种',
      evidence: 'services/medicineService.ts cleanupSeededDemoData：按药品 id 集合指纹识别',
    });

    // 真实数据（id 集合不同）绝不能被误清
    seedDB({ medicines: [makeMed({ id: 'my-med-1', name: '我自己的药', total_quantity: 12 })], shoppingList: [], logs: [] }, 'migrated');
    const mine = await S.getMedicines();
    check(mine.length === 1 && mine[0].name === '我自己的药' && mine[0].total_quantity === 12, {
      expected: '指纹不符 → 原样保留 1 种 / 12 件',
      actual: '剩余 ' + mine.length + ' 种' + (mine[0] ? ' / ' + mine[0].total_quantity + ' 件' : ''),
      evidence: 'cleanupSeededDemoData：签名不相等时直接返回 false',
    });
    return '演示数据清空、真实数据零改动';
  });

  // J6：核销定位的回退路径（变异测试 M5 暴露的覆盖缺口 —— 老数据/失效 id 走的就是这里）
  await run('J6', '核销定位回退：medicine_id 失效或缺席时按品牌命中，绝不取同名首条', async () => {
    const F = mod.findMedicineForItem;
    const meds = [
      makeMed({ id: 'J6-a', name: NAME_J, brand: '芬必得', total_quantity: 3, expiry_date: '2099-01-01' }),
      makeMed({ id: 'J6-b', name: NAME_J, brand: '中美史克', total_quantity: 0, expiry_date: shiftToday(-1) }),
    ];
    const base = { reason: '用尽', status: 'pending', created_at: new Date().toISOString() };

    // ① 条目 medicine_id 指向已被删除的药品 → 必须回退到品牌匹配（而不是取同名首条）
    const stale = Object.assign({ id: 'J6-i1', medicine_name: NAME_J, brand: '中美史克', medicine_id: 'deleted-id' }, base);
    const i1 = F(meds, stale);
    check(i1 !== -1 && meds[i1].id === 'J6-b', {
      expected: 'medicine_id 失效 → 命中 中美史克（J6-b）',
      actual: 'index=' + i1 + ' 命中=' + (i1 === -1 ? '无' : meds[i1].id + '/' + meds[i1].brand),
      evidence: 'services/medicineService.ts:129-137 byId 未命中后必须按 name+brand 精确定位',
    });

    // ② 老数据条目完全没有 medicine_id（升级前遗留） → 同样必须按品牌
    const legacy = { id: 'J6-i2', medicine_name: NAME_J, brand: '中美史克' };
    Object.assign(legacy, base);
    const i2 = F(meds, legacy);
    check(i2 !== -1 && meds[i2].id === 'J6-b', {
      expected: '无 medicine_id 但有品牌 → 命中 中美史克（J6-b）',
      actual: 'index=' + i2 + ' 命中=' + (i2 === -1 ? '无' : meds[i2].id + '/' + meds[i2].brand),
      evidence: 'services/medicineService.ts:134-137 品牌分支（老数据兼容路径）',
    });

    // ③ 药名与品牌都无法区分时，兜底必须选「最需要补货」的那条（库存最少）
    const unknown = Object.assign({ id: 'J6-i3', medicine_name: NAME_J }, base);
    const i3 = F(meds, unknown);
    check(i3 !== -1 && meds[i3].id === 'J6-b', {
      expected: '无 id 无品牌 → 兜底选库存更少的 J6-b（0 < 3）',
      actual: 'index=' + i3 + ' 命中=' + (i3 === -1 ? '无' : meds[i3].id + ' 库存=' + meds[i3].total_quantity),
      evidence: 'services/medicineService.ts:138-147 candidates 按库存升序、效期升序兜底',
    });
    return '三条回退路径全部命中正确记录';
  });

  // ----------------------------------------------------------
  line('');
  line('--- NB. 同名不同品牌完整矩阵（阿莫西林：华北制药 24 未过期 / 珠海联邦 16 已过期）---');
  // ----------------------------------------------------------
  const NB_NAME = '阿莫西林';
  function nbSeed(both) {
    seedDB({
      medicines: [
        makeMed({ id: 'NB-huabei', name: NB_NAME, brand: '华北制药', total_quantity: 24, expiry_date: both ? shiftToday(-2) : '2099-01-01' }),
        makeMed({ id: 'NB-zhuhai', name: NB_NAME, brand: '珠海联邦', total_quantity: 16, expiry_date: shiftToday(-1) }),
      ],
      shoppingList: [], logs: [],
    }, 'migrated');
  }
  const nbMed = (meds, id) => meds.find(m => m.id === id);
  await run('NB1', '补货条目带 medicine_id + brand（按「这一条药品」而非按药名去重的结构前提）', async () => {
    nbSeed(false);
    await S.getMedicines();
    const list = await S.getShoppingList();
    const it = list[0] || {};
    check(list.length === 1 && it.medicine_id === 'NB-zhuhai' && it.brand === '珠海联邦', {
      expected: "仅珠海联邦（已过期）1 条，且 medicine_id='NB-zhuhai' brand='珠海联邦'",
      actual: list.length + ' 条；' + j(list.map(i => ({ n: i.medicine_name, b: i.brand, mid: i.medicine_id }))),
      evidence: 'types.ts:59-67 ShoppingItem 新增 brand/medicine_id；services/medicineService.ts:512-520 生成条目时写入归属',
    });
    return '未过期的华北制药不产生提醒，归属精确到 id';
  });
  await run('NB2', '过期去重按 medicine_id：两品牌各持一条提醒', async () => {
    nbSeed(true);
    await S.getMedicines();
    const list = await S.getShoppingList();
    const ids = list.map(i => String(i.medicine_id)).sort();
    check(list.length === 2 && j(ids) === j(['NB-huabei', 'NB-zhuhai']), {
      expected: '2 条提醒，medicine_id = [NB-huabei, NB-zhuhai]',
      actual: list.length + ' 条，medicine_id=' + j(list.map(i => i.medicine_id)),
      evidence: 'services/medicineService.ts:508-510 用 isItemForMedicine(item, med) 精确去重（旧实现按药名去重 → 两条共用一个条目）',
    });
    return '同名不同品牌各自成条';
  });
  await run('NB3', '过期检测重复触发 5 次：条目数仍为 2（按 id 幂等）', async () => {
    nbSeed(true);
    for (let i = 0; i < 5; i++) await S.getMedicines();
    await S.checkExpiry();
    const list = await S.getShoppingList();
    check(list.length === 2, {
      expected: '6 次触发后仍 2 条',
      actual: list.length + ' 条: ' + j(list.map(i => i.medicine_id)),
      evidence: 'services/medicineService.ts:499-527 addExpiredToShoppingList 去重',
    });
    return '幂等';
  });
  await run('NB4', '补货核销精确命中珠海联邦（16→20，效期/最近购入刷新）', async () => {
    nbSeed(true);
    await S.getMedicines();
    const item = (await S.getShoppingList()).find(i => String(i.medicine_id) === 'NB-zhuhai');
    await S.restockMedicine(item.id, 20, '2030-01-01');
    const zh = nbMed(await S.getMedicines(), 'NB-zhuhai');
    check(zh.total_quantity === 20 && zh.expiry_date === '2030-01-01' && zh.last_purchase_date === todayLocal(), {
      expected: '珠海联邦 数量=20 效期=2030-01-01 最近购入=' + todayLocal(),
      actual: '数量=' + zh.total_quantity + ' 效期=' + zh.expiry_date + ' 最近购入=' + zh.last_purchase_date,
      evidence: 'services/medicineService.ts:803 findMedicineForItem（按 medicine_id 命中；旧实现按药名取首条 → 写进华北制药）',
    });
    return '核销命中正确记录';
  });
  await run('NB5', '补货核销不误伤另一品牌：华北制药库存 24 / 效期 2099-01-01 不变', async () => {
    nbSeed(true);
    await S.getMedicines();
    const item = (await S.getShoppingList()).find(i => String(i.medicine_id) === 'NB-zhuhai');
    await S.restockMedicine(item.id, 20, '2030-01-01');
    const hb = nbMed(await S.getMedicines(), 'NB-huabei');
    check(hb.total_quantity === 24 && hb.expiry_date === shiftToday(-2), {
      expected: '华北制药 数量=24 效期=' + shiftToday(-2) + '（原样）',
      actual: '数量=' + hb.total_quantity + ' 效期=' + hb.expiry_date,
      evidence: 'services/medicineService.ts:129-148 findMedicineForItem；旧实现 findIndex(m => m.name === ...) 会改错记录',
    });
    return '另一品牌零影响';
  });
  await run('NB6', '入库同品牌（华北制药 +10）：合并该条、保留原 id，不动珠海联邦', async () => {
    nbSeed(false);
    await S.getMedicines();
    const r = await S.addMedicine(makeMed({ id: 'NB-new-hb', name: NB_NAME, brand: '华北制药', total_quantity: 34, expiry_date: '2099-01-01' }));
    const meds = await S.getMedicines();
    const hb = nbMed(meds, 'NB-huabei'), zh = nbMed(meds, 'NB-zhuhai');
    check(r.merged === true && meds.length === 2 && hb.total_quantity === 34 && zh.total_quantity === 16, {
      expected: 'merged=true、仍 2 条、华北=34、珠海=16',
      actual: 'merged=' + r.merged + ' 条数=' + meds.length + ' 华北=' + hb.total_quantity + ' 珠海=' + zh.total_quantity,
      evidence: 'services/medicineService.ts:204-213 isSameMedicineIdentity 含 brand',
    });
    return '同品牌合并、异品牌独立';
  });
  await run('NB7', '入库异品牌（珠海联邦 +10）：只更新珠海联邦，华北制药保持 24', async () => {
    nbSeed(false);
    await S.getMedicines();
    const r = await S.addMedicine(makeMed({ id: 'NB-new-zh', name: NB_NAME, brand: '珠海联邦', total_quantity: 26, expiry_date: '2030-05-05' }));
    const meds = await S.getMedicines();
    const hb = nbMed(meds, 'NB-huabei'), zh = nbMed(meds, 'NB-zhuhai');
    check(meds.length === 2 && zh.id === 'NB-zhuhai' && zh.total_quantity === 26 && hb.total_quantity === 24 && hb.expiry_date === '2099-01-01', {
      expected: '珠海=26（原 id）、华北=24/2099-01-01 不变',
      actual: '条数=' + meds.length + ' 珠海=' + zh.total_quantity + '/' + zh.id + ' 华北=' + hb.total_quantity + '/' + hb.expiry_date,
      evidence: 'services/medicineService.ts:705-727 按下标定位合并；merged=' + r.merged,
    });
    return '异品牌不互相覆盖';
  });
  await run('NB8', '打卡按 id 扣减：珠海联邦 16→12，华北制药 24 不变', async () => {
    nbSeed(false);
    await S.getMedicines();
    await S.consumeMedicine('NB-zhuhai', 4);
    const meds = await S.getMedicines();
    const logs = await S.getUsageLogs();
    check(nbMed(meds, 'NB-zhuhai').total_quantity === 12 && nbMed(meds, 'NB-huabei').total_quantity === 24, {
      expected: '珠海=12 华北=24',
      actual: '珠海=' + nbMed(meds, 'NB-zhuhai').total_quantity + ' 华北=' + nbMed(meds, 'NB-huabei').total_quantity,
      evidence: 'services/medicineService.ts:641-651 按 id 定位 + 日志带 brand 快照',
    });
    check(logs.length === 1 && logs[0].brand === '珠海联邦' && logs[0].medicine_id === 'NB-zhuhai', {
      expected: "日志 brand='珠海联邦' medicine_id='NB-zhuhai'",
      actual: j(logs.map(l => ({ b: l.brand, mid: l.medicine_id }))),
    });
    return '按 id 扣减、日志品牌快照正确';
  });
  await run('NB9', '删除华北制药只清自己那条提醒，珠海联邦的提醒保留', async () => {
    nbSeed(true);
    await S.getMedicines();
    const before = await S.getShoppingList();
    await S.deleteMedicine('NB-huabei');
    const after = await S.getShoppingList();
    check(before.length === 2 && after.length === 1 && String(after[0].medicine_id) === 'NB-zhuhai', {
      expected: '删除前 2 条 → 删除后仅剩珠海联邦 1 条',
      actual: '删除前 ' + before.length + ' 条 → 删除后 ' + after.length + ' 条: ' + j(after.map(i => i.medicine_id)),
      evidence: 'services/medicineService.ts:774-782 按 medicine_id 清理（旧实现按药名一律删 → 另一品牌提醒被误删）',
    });
    return '只清自己的提醒';
  });
  await run('NB10', '删除后无孤儿条目：剩余条目都能对应到现存药品', async () => {
    nbSeed(true);
    await S.getMedicines();
    await S.deleteMedicine('NB-huabei');
    const meds = (readRawDB() || {}).medicines || [];
    const list = await S.getShoppingList();
    const orphans = list.filter(i => !meds.some(m => String(m.id) === String(i.medicine_id)));
    check(orphans.length === 0, {
      expected: '0 条孤儿',
      actual: orphans.length + ' 条: ' + j(orphans.map(i => ({ n: i.medicine_name, mid: i.medicine_id }))),
      evidence: '对照 services/medicineService.ts:775-782 的清理分支',
    });
    return '清单与药箱一致';
  });

  // ----------------------------------------------------------
  line('');
  line('--- EX. 输入与清洗极端值 ---');
  // ----------------------------------------------------------
  const EX_LONG = '药'.repeat(100000);
  async function exAdd(name, id) {
    seedDB();
    const r = await mustThrow(() => S.addMedicine(makeMed({ id: id, name: name, total_quantity: 5 })));
    return r;
  }
  await run('EX1', '10 万字符名称：入库不报错、完整落库、可导出', async () => {
    const r = await exAdd(EX_LONG, 'EX-1');
    check(!r.threw, { expected: '不抛错', actual: describeError(r.error), evidence: 'services/medicineService.ts:697-703 只校验数量' });
    const stored = rawMedicines()[0];
    check(stored.name === EX_LONG && stored.name.length === 100000, {
      expected: 'name 长度 100000 且内容一致',
      actual: '长度 ' + String(stored.name).length + '，内容一致=' + (stored.name === EX_LONG),
    });
    const exported = JSON.parse(await S.exportData()).data.medicines[0];
    check(exported.name.length === 100000, { expected: '导出同样保留完整名称', actual: '导出后长度 ' + exported.name.length });
    return '100000 字符名称无损往返';
  });
  await run('EX2', 'emoji 名称：原样落库（代理对不被截断）', async () => {
    const r = await exAdd('💊🩹😀 复方', 'EX-2');
    const stored = rawMedicines()[0];
    check(!r.threw && stored.name === '💊🩹😀 复方' && stored.name.length === '💊🩹😀 复方'.length, {
      expected: 'name 与输入完全一致',
      actual: describeError(r.error) + ' / name=' + j(stored.name),
    });
    return '代理对完整';
  });
  await run('EX3', '控制字符名称：JSON 往返合法、不报错', async () => {
    const weird = 'a\u0000b\u0001c\u001F';
    const r = await exAdd(weird, 'EX-3');
    const stored = rawMedicines()[0];
    check(!r.threw && stored.name === weird, {
      expected: '含 NUL/SOH/US 的名称原样落库',
      actual: describeError(r.error) + ' / name 长度=' + String(stored.name).length,
    });
    return '控制字符不影响存储';
  });
  await run('EX4', '全角数字名称：原样落库', async () => {
    const r = await exAdd('１２３４５', 'EX-4');
    const stored = rawMedicines()[0];
    check(!r.threw && stored.name === '１２３４５', { expected: 'name=１２３４５', actual: j(stored.name) });
    return '全角字符不受影响';
  });
  await run('EX5', '名称边界：纯空格 / 零宽字符(\u200B) 名称应被拒绝或规范化', async () => {
    seedDB();
    const r1 = await mustThrow(() => S.addMedicine(makeMed({ id: 'EX-5a', name: '   ', total_quantity: 1 })));
    seedDB();
    const r2 = await mustThrow(() => S.addMedicine(makeMed({ id: 'EX-5b', name: '\u200B\u200B', total_quantity: 1 })));
    seedDB();
    const r3 = await mustThrow(() => S.importData(j({ medicines: [Object.assign(canon(makeMed({ id: 'EX-5c' })), { name: '\u200B\u200B' })] }), 'replace'));
    const imported = rawMedicines();
    check(r1.threw && r2.threw && r3.threw, {
      expected: '空白/零宽名称一律拒绝（addMedicine 与 importData 两条通道都拒绝）',
      actual: 'addMedicine("   ") threw=' + r1.threw + '；addMedicine("\\u200B\\u200B") threw=' + r2.threw
        + '；importData(name="\\u200B\\u200B") threw=' + r3.threw + ' 且落库 ' + imported.length + ' 条',
      evidence: 'services/medicineService.ts:692-703 addMedicine 不校验名称；:1004 trim() 只去空白类字符、去不掉 \\u200B（零宽空格），'
        + '而 importData 的纯空格名会被 trim 成空串后丢弃（:1005）。最小复现：addMedicine({name:"   "}) → 落库 name="   "',
      severity: '低（UI 表单已校验非空；影响面是脚本/备份投毒产生的空白名条目）',
    });
    return '空白名被拒绝';
  });
  await run('EX6', '数量 1e309（Infinity）：拒绝入库', async () => {
    seedDB();
    // 用 Number('1e309') 而不是字面量 1e309：后者会被 eslint no-loss-of-precision 判为精度丢失
    const r = await mustThrow(() => S.addMedicine(makeMed({ id: 'EX-6', name: '无穷药', total_quantity: Number('1e309') })));
    check(r.threw && rawMedicines().length === 0, {
      expected: '抛错「入库数量必须为不小于 0 的数字」且不落库',
      actual: 'threw=' + r.threw + '；落库 ' + rawMedicines().length + ' 条',
      evidence: 'services/medicineService.ts:696-700 Number.isFinite 防御；旧实现会写成 Infinity，JSON 序列化后退化成 null',
    });
    return describeError(r.error);
  });
  await run('EX7', '数量 -1：拒绝入库', async () => {
    seedDB();
    const r = await mustThrow(() => S.addMedicine(makeMed({ id: 'EX-7', name: '负药', total_quantity: -1 })));
    check(r.threw && rawMedicines().length === 0, {
      expected: '抛错且不落库', actual: 'threw=' + r.threw + '；落库 ' + rawMedicines().length + ' 条',
      evidence: 'services/medicineService.ts:696-700',
    });
    return describeError(r.error);
  });
  await run('EX8', '数量 -0：落库为 0（有限非负）', async () => {
    seedDB();
    const r = await mustThrow(() => S.addMedicine(makeMed({ id: 'EX-8', name: '负零药', total_quantity: -0 })));
    const q = rawMedicines()[0] && rawMedicines()[0].total_quantity;
    check(!r.threw && q === 0 && Number.isFinite(q) && q >= 0, {
      expected: 'total_quantity === 0', actual: 'threw=' + r.threw + ' 落库=' + j(q),
      evidence: 'services/medicineService.ts:696-700（-0 < 0 为 false）→ JSON.stringify(-0) === "0"',
    });
    return '落库 0';
  });
  await run('EX9', '数量 0.1：有限非负（记录：小数库存未被拒绝）', async () => {
    seedDB();
    const r = await mustThrow(() => S.addMedicine(makeMed({ id: 'EX-9', name: '小数药', total_quantity: 0.1 })));
    const q = rawMedicines()[0] && rawMedicines()[0].total_quantity;
    check(!r.threw && q === 0.1 && Number.isFinite(q) && q >= 0, {
      expected: 'total_quantity === 0.1', actual: 'threw=' + r.threw + ' 落库=' + j(q),
      evidence: 'services/medicineService.ts:696-700 未做整数化；服务层允许小数库存（UI 负责取整）',
    });
    return '落库 0.1（非整数但有限非负）';
  });
  await run('EX10', '数量 2^53：有限非负落库', async () => {
    seedDB();
    const big = Math.pow(2, 53);
    const r = await mustThrow(() => S.addMedicine(makeMed({ id: 'EX-10', name: '超大药', total_quantity: big })));
    const q = rawMedicines()[0] && rawMedicines()[0].total_quantity;
    check(!r.threw && q === big && Number.isFinite(q) && q >= 0, {
      expected: 'total_quantity === ' + big, actual: 'threw=' + r.threw + ' 落库=' + j(q),
    });
    return '落库 ' + big;
  });
  await run('EX11', 'threshold 为 Infinity：拒绝入库（避免阈值比较恒真）', async () => {
    seedDB();
    const r = await mustThrow(() => S.addMedicine(makeMed({ id: 'EX-11', name: '阈值药', total_quantity: 1, threshold: Infinity })));
    check(r.threw && rawMedicines().length === 0, {
      expected: '抛错「预警阈值必须为数字」且不落库',
      actual: 'threw=' + r.threw + '；落库 ' + rawMedicines().length + ' 条',
      evidence: 'services/medicineService.ts:701-703',
    });
    return describeError(r.error);
  });
  await run('EX12', '导入通道数值清洗：-50 / Infinity / "abc" / null → 一律兜底 0', async () => {
    const cases = [-50, Infinity, -Infinity, 'abc', null, {}, []];
    const bad = [];
    for (const v of cases) {
      seedDB();
      await S.importData(j({ medicines: [Object.assign(canon(makeMed({ id: 'EX-12' })), { total_quantity: v, threshold: v, daily_usage: v, usage_frequency_score: v })] }), 'replace');
      const m = rawMedicines()[0];
      for (const f of ['total_quantity', 'threshold', 'daily_usage', 'usage_frequency_score']) {
        if (!(m[f] === 0)) bad.push(j(v) + '.' + f + '=' + j(m[f]));
      }
    }
    check(bad.length === 0, {
      expected: '7 组输入 × 4 字段全部兜底为 0',
      actual: bad.join(' | ') || '(全部为 0)',
      evidence: 'services/medicineService.ts:306 nonNegNum() + 1019-1028 sanitizeMedicine',
    });
    return '非负兜底生效（负数/Infinity/NaN 不会进库）';
  });
  await run('EX13', '导入通道：日志 amount 为负数应被拒绝或兜底为 0', async () => {
    seedDB();
    await S.importData(j({
      medicines: [canon(makeMed({ id: 'EX-13' }))],
      logs: [{ id: 'EX-13l', medicine_id: 'EX-13', medicine_name: '阿莫西林胶囊', amount: -5, log_time: '2026-01-01T00:00:00.000Z' }],
    }), 'replace');
    const l = (await S.getUsageLogs())[0];
    check(l && l.amount >= 0, {
      expected: 'amount >= 0（拒绝该条或兜底 0）',
      actual: 'amount=' + j(l && l.amount),
      evidence: 'services/medicineService.ts:1047 sanitizeLog 用 num()（只判 isFinite）而非 nonNegNum()（:306）；'
        + '最小复现：importData 一条 amount=-5 的日志 → 读回 amount=-5（负数用量会污染「累计消耗」类统计）',
      severity: '低-中（sanitizeMedicine 已用 nonNegNum 兜底，日志通道未同步）',
    });
    return '负数量日志被兜底';
  });

  // ----------------------------------------------------------
  line('');
  line('--- VR. 备份版本校验矩阵 ---');
  // ----------------------------------------------------------
  function vrPayload(version) {
    const p = {
      app: 'medicine-box',
      exported_at: '2026-01-01T00:00:00.000Z',
      counts: { medicines: 1, shoppingList: 0, logs: 0 },
      data: { medicines: [canon(makeMed({ id: 'VR-new', name: '版本药' }))], shoppingList: [], logs: [] },
    };
    if (version !== undefined) p.version = version;
    return j(p);
  }
  const VR_CASES = [
    ['VR1', undefined, true, 'version 缺失（旧备份兼容）'],
    ['VR2', 0, false, 'version=0'],
    ['VR3', 1, true, 'version=1（当前版本）'],
    ['VR4', 2, false, 'version=2（未来版本）'],
    ['VR5', 999, false, 'version=999'],
    ['VR6', '1', true, 'version="1"（字符串）'],
    ['VR7', null, false, 'version=null'],
  ];
  const vrRejects = [];
  for (const [id, ver, accept, label] of VR_CASES) {
    await run(id, '版本校验：' + label + (accept ? ' → 接受' : ' → 拒绝'), async () => {
      seedDB({ medicines: [makeMed({ id: 'VR-old', name: '原有药' })], shoppingList: [makeItem({ id: 'VR-old-item', medicine_name: '原有药' })], logs: [] }, 'migrated');
      const before = JSON.stringify(storage.dump());
      const r = await mustThrow(() => S.importData(vrPayload(ver), 'replace'));
      const after = JSON.stringify(storage.dump());
      if (accept) {
        const meds = (readRawDB() || {}).medicines || [];
        check(!r.threw && meds.some(m => m.id === 'VR-new'), {
          expected: '接受导入 → 库内出现 VR-new',
          actual: 'threw=' + r.threw + (r.threw ? '(' + describeError(r.error) + ')' : '') + '；药品=' + j(meds.map(m => m.id)),
          evidence: 'services/medicineService.ts:874-883 只有声明了 version 且 Number(version) !== 1 才拒绝',
        });
      } else {
        vrRejects.push({ id, unchanged: after === before });
        check(r.threw && after === before, {
          expected: '拒绝（抛错）且存储内容逐字节不变',
          actual: 'threw=' + r.threw + (r.threw ? '（' + describeError(r.error) + '）' : '；返回值=' + j(r.value)) + '；内容一致=' + (after === before),
          evidence: 'services/medicineService.ts:876-883 版本校验位于任何写入之前',
        });
      }
      return r.threw ? '拒绝：' + describeError(r.error) : '接受';
    });
  }
  await run('VR8', '版本被拒时数据一字未动（4 例逐一验证）', () => {
    const bad = vrRejects.filter(x => !x.unchanged);
    check(vrRejects.length === 4 && bad.length === 0, {
      expected: '4 个被拒版本（0/2/999/null）均保持存储内容逐字节不变',
      actual: '被拒例数=' + vrRejects.length + '；被改动的=' + j(bad.map(x => x.id)),
      evidence: 'services/medicineService.ts:856-883 解析 → 结构校验 → 版本校验 → 之后才写库',
    });
    return vrRejects.map(x => x.id).join('/') + ' 均未写入';
  });

  // ----------------------------------------------------------
  line('');
  line('--- CD. 日历日期矩阵（导入清洗 + 补货登记校验）---');
  // ----------------------------------------------------------
  const CD_CASES = [
    ['CD1', '2024-02-29', true, '闰日合法（2024 是闰年）'],
    ['CD2', '2023-02-29', false, '2023 不是闰年'],
    ['CD3', '2024-02-30', false, '2 月没有 30 日'],
    ['CD4', '2024-13-01', false, '没有 13 月'],
    ['CD5', '2024-00-10', false, '没有 0 月'],
    ['CD6', '2024-01-32', false, '1 月没有 32 日'],
    ['CD7', '1900-01-01', true, '合法（年份下界 1900）'],
    ['CD8', '1899-12-31', false, '早于年份下界 1900'],
    ['CD9', '2999-12-31', true, '合法（年份上界 2999）'],
    ['CD10', '3000-01-01', false, '晚于年份上界 2999'],
  ];
  for (const [id, value, keep, why] of CD_CASES) {
    await run(id, '日历日期 ' + value + '（' + why + '）→ ' + (keep ? '保留' : '清洗为空串'), async () => {
      seedDB();
      await S.importData(j({ medicines: [Object.assign(canon(makeMed({ id: 'CD-1', name: '日期药' })), { expiry_date: value, last_purchase_date: value })] }), 'replace');
      const m = (await S.getMedicines())[0];
      const list = await S.getShoppingList();
      const judged = list.some(i => i.medicine_name === '日期药');
      if (keep) {
        check(m.expiry_date === value && m.last_purchase_date === value, {
          expected: 'expiry/last_purchase 均保留 ' + value,
          actual: 'expiry=' + j(m.expiry_date) + ' last_purchase=' + j(m.last_purchase_date),
          evidence: 'services/medicineService.ts:974-986 isValidCalendarDate + date10',
        });
      } else {
        check(m.expiry_date === '' && m.last_purchase_date === '', {
          expected: 'expiry/last_purchase 均清洗为 ""',
          actual: 'expiry=' + j(m.expiry_date) + ' last_purchase=' + j(m.last_purchase_date)
            + '；过期判定=' + (judged ? '被判为过期' : '未被判过期'),
          evidence: 'services/medicineService.ts:974-981 isValidCalendarDate（年份 1900-2999 + 闰年 + 月份天数）',
        });
      }
      return keep ? '保留 ' + value : '清洗为空串';
    });
  }
  await run('CD11', '补货登记的效期校验应与导入一致（拒绝日历上不存在的日期）', async () => {
    seedDB({ medicines: [makeMed({ id: 'CD-11', name: '补货日期药', total_quantity: 0, expiry_date: shiftToday(-1) })], shoppingList: [], logs: [] }, 'migrated');
    await S.getMedicines();
    const item = (await S.getShoppingList())[0];
    const r = await mustThrow(() => S.restockMedicine(item.id, 10, '9999-99-99'));
    const med = (await S.getMedicines()).find(m => m.id === 'CD-11');
    check(r.threw, {
      expected: '拒绝「9999-99-99」这类日历上不存在的日期',
      actual: 'threw=' + r.threw + '；落库效期=' + j(med.expiry_date) + '（库存 ' + j(med.total_quantity) + '）',
      evidence: 'services/medicineService.ts:793-797 restockMedicine 仍只用形状正则 /^\\d{4}-\\d{2}-\\d{2}$/，未复用 isValidCalendarDate(:974)；'
        + '最小复现：restockMedicine(itemId, 10, "9999-99-99") → 效期被写成 9999-99-99，'
        + '该值字典序极大，永远不会被 :505 判为过期，该药从此不再进补货清单',
      severity: '低-中（表单用 <input type="date"> 挡住常规输入，但服务层校验与导入路径不一致）',
    });
    return '效期校验一致';
  });

  // ----------------------------------------------------------
  line('');
  line('--- AM. 失败原子性（读失败 / 写失败 / 导入失败）---');
  // ----------------------------------------------------------
  function quotaErr() {
    const e = new Error('QuotaExceededError: the quota has been exceeded.');
    e.name = 'QuotaExceededError';
    return e;
  }
  await run('AM1', '读失败（getItem 抛错）：存储内容逐字节一致', async () => {
    seedDB({ medicines: [makeMed({ id: 'AM-1' })], shoppingList: [makeItem({ id: 'AM-1i' })], logs: [makeLog({ id: 'AM-1l' })] }, 'migrated');
    const before = JSON.stringify(storage.dump());
    storage.failReads(() => new Error('SecurityError: storage disabled'));
    const r = await mustThrow(() => S.getMedicines());
    storage.clearReadFailure();
    const after = JSON.stringify(storage.dump());
    check(r.threw && after === before, {
      expected: '抛错且存储内容逐字节不变',
      actual: 'threw=' + r.threw + '；内容一致=' + (after === before),
      evidence: 'services/medicineService.ts:253-269 localRead 返回 null；:461-463 READ_FAIL_MSG',
    });
    return '存储 ' + before.length + ' 字节未变';
  });
  await run('AM2', '写失败（setItem 抛 QuotaExceededError）：存储内容逐字节一致', async () => {
    seedDB({ medicines: [makeMed({ id: 'AM-2', name: '写失败药', total_quantity: 5 })], shoppingList: [], logs: [] }, 'migrated');
    const before = JSON.stringify(storage.dump());
    storage.failWrites(quotaErr);
    const r = await mustThrow(() => S.addMedicine(makeMed({ id: 'AM-2b', name: '新药', total_quantity: 3 })));
    storage.clearWriteFailure();
    const after = JSON.stringify(storage.dump());
    check(r.threw && after === before, {
      expected: '抛错且存储内容逐字节不变（失败不产生半截写入）',
      actual: 'threw=' + r.threw + '；内容一致=' + (after === before),
      evidence: 'services/medicineService.ts:273-285 localWrite 先写后抛，JSON.stringify 是一次性赋值，不存在部分写入',
    });
    return '存储 ' + before.length + ' 字节未变';
  });
  await run('AM3', '写失败：变更方法的返回值不含成功语义（addMedicine / consumeMedicine）', async () => {
    seedDB({ medicines: [makeMed({ id: 'AM-3', name: '写失败药', total_quantity: 5 })], shoppingList: [], logs: [] }, 'migrated');
    storage.failWrites(quotaErr);
    const r1 = await mustThrow(() => S.addMedicine(makeMed({ id: 'AM-3b', name: '新药', total_quantity: 3 })));
    const r2 = await mustThrow(() => S.consumeMedicine('AM-3', 1));
    storage.clearWriteFailure();
    check(r1.threw && r2.threw, {
      expected: '两个方法都抛错，调用方拿不到「成功」返回值',
      actual: 'addMedicine threw=' + r1.threw + (r1.threw ? '' : ' 返回 ' + j(r1.value)) + '；consumeMedicine threw=' + r2.threw,
      evidence: 'services/medicineService.ts:283 throw new Error(WRITE_FAIL_MSG)',
    });
    return describeError(r1.error);
  });
  await run('AM4', '读失败：读取入口抛错（绝不返回空库/空数组）', async () => {
    seedDB({ medicines: [makeMed({ id: 'AM-4' })], shoppingList: [], logs: [] }, 'migrated');
    storage.failReads(() => new Error('SecurityError: storage disabled'));
    const a = await mustThrow(() => S.getMedicines());
    const b = await mustThrow(() => S.getShoppingList());
    const c = await mustThrow(() => S.getUsageLogs());
    const d = await mustThrow(() => S.fetchData());
    const e2 = await mustThrow(() => S.exportData());
    storage.clearReadFailure();
    const bad = [['getMedicines', a], ['getShoppingList', b], ['getUsageLogs', c], ['fetchData', d], ['exportData', e2]].filter(x => !x[1].threw);
    check(bad.length === 0, {
      expected: '5 个读取/导出入口全部抛错',
      actual: bad.map(x => x[0] + ' 返回 ' + j(x[1].value)).join(' | ') || '(全部抛错)',
      evidence: 'services/medicineService.ts:461-463 READ_FAIL_MSG；:531-537 fetchData 不再 ?? EMPTY_DB()',
    });
    return '读取失败语义统一';
  });
  await run('AM5', '导入失败（非法 JSON / 缺 medicines）：存储内容逐字节一致', async () => {
    seedDB({ medicines: [makeMed({ id: 'AM-5', name: '原有药' })], shoppingList: [], logs: [] }, 'migrated');
    const before = JSON.stringify(storage.dump());
    const r1 = await mustThrow(() => S.importData('{oops', 'replace'));
    const r2 = await mustThrow(() => S.importData(j({ shoppingList: [] }), 'merge'));
    const r3 = await mustThrow(() => S.importData(vrPayload(999), 'replace'));
    const after = JSON.stringify(storage.dump());
    check(r1.threw && r2.threw && r3.threw && after === before, {
      expected: '三种非法导入全部抛错且存储逐字节不变',
      actual: 'threw=' + r1.threw + '/' + r2.threw + '/' + r3.threw + '；内容一致=' + (after === before),
      evidence: 'services/medicineService.ts:857-883 三道校验都发生在 writeDB 之前',
    });
    return '存储 ' + before.length + ' 字节未变';
  });
  await run('AM6', '导入写失败：importData 抛错而不是返回成功摘要', async () => {
    seedDB({ medicines: [makeMed({ id: 'AM-6', name: '原有药' })], shoppingList: [], logs: [] }, 'migrated');
    const before = JSON.stringify(storage.dump());
    storage.failWrites(quotaErr);
    const r = await mustThrow(() => S.importData(j({ medicines: [canon(makeMed({ id: 'AM-6b', name: '导入药' }))] }), 'replace'));
    storage.clearWriteFailure();
    const after = JSON.stringify(storage.dump());
    check(r.threw && after === before, {
      expected: '抛错（不给 ImportResult 成功摘要）且存储逐字节不变',
      actual: 'threw=' + r.threw + (r.threw ? '' : '；返回值=' + j(r.value)) + '；内容一致=' + (after === before),
      evidence: 'services/medicineService.ts:906-908 importData replace 分支 → writeDB → localWrite 抛出',
    });
    return describeError(r.error);
  });
  await run('AM7', '损坏态下 5 个变更方法：存储内容逐字节一致（不覆盖损坏数据）', async () => {
    const CORRUPT2 = '{"medicines":[{"id":"x",  <<< 非法 JSON';
    const fns = [
      ['addMedicine', () => S.addMedicine(makeMed({ id: 'AM-7a' }))],
      ['deleteMedicine', () => S.deleteMedicine('whatever')],
      ['consumeMedicine', () => S.consumeMedicine('whatever', 1)],
      ['updateMedicine', () => S.updateMedicine(makeMed({ id: 'AM-7b' }))],
      ['restockMedicine', () => S.restockMedicine('whatever', 1, '2030-01-01')],
    ];
    const notThrew = [];
    const changed = [];
    for (const [name, fn] of fns) {
      storage.seed(CORRUPT2, 'migrated');
      const before = JSON.stringify(storage.dump());
      const r = await mustThrow(fn);
      if (!r.threw) notThrew.push(name);
      if (JSON.stringify(storage.dump()) !== before) changed.push(name);
    }
    check(notThrew.length === 0 && changed.length === 0, {
      expected: '5 个方法都抛错且都不改动损坏的存储内容',
      actual: '未抛错的=' + j(notThrew) + '；被改动的=' + j(changed),
      evidence: 'services/medicineService.ts:253-269 localRead 返回 null → 各方法前置 if (!data) throw',
    });
    return '损坏数据零改动';
  });

  // ----------------------------------------------------------
  line('');
  line('--- ID. 幂等与重复调用 ---');
  // ----------------------------------------------------------
  await run('ID1', 'getMedicines() ×5：不产生重复补货条目', async () => {
    seedDB({
      medicines: [
        makeMed({ id: 'ID-1a', name: '过期甲', expiry_date: shiftToday(-1) }),
        makeMed({ id: 'ID-1b', name: '过期乙', expiry_date: shiftToday(-30) }),
      ], shoppingList: [], logs: [],
    }, 'migrated');
    const counts = [];
    for (let i = 0; i < 5; i++) { await S.getMedicines(); counts.push((await S.getShoppingList()).length); }
    check(counts.every(c => c === 2), {
      expected: '每次都固定 2 条', actual: j(counts),
      evidence: 'services/medicineService.ts:499-527 去重（按 id）',
    });
    return '条目数稳定 ' + j(counts);
  });
  await run('ID2', 'getMedicines() ×5：数据逐字节稳定（首轮结算后不再变化）', async () => {
    seedDB({
      medicines: [makeMed({ id: 'ID-2a', name: '过期药', expiry_date: shiftToday(-1) })],
      shoppingList: [], logs: [makeLog({ id: 'ID-2l', medicine_id: 'ID-2a', medicine_name: '过期药' })],
    }, 'migrated');
    await S.getMedicines();
    const first = JSON.stringify(storage.dump());
    for (let i = 0; i < 4; i++) await S.getMedicines();
    const last = JSON.stringify(storage.dump());
    check(first === last, {
      expected: '第 2~5 次调用不再写库（内容逐字节一致）',
      actual: '一致=' + (first === last) + (first === last ? '' : '；前=' + first.slice(0, 120) + ' 后=' + last.slice(0, 120)),
      evidence: 'services/medicineService.ts:542-568 dirty 标记，无变更不写回',
    });
    return '存储 ' + first.length + ' 字节稳定';
  });
  await run('ID3', 'checkExpiry() ×5：幂等', async () => {
    seedDB({
      medicines: [makeMed({ id: 'ID-3a', name: '过期药', expiry_date: shiftToday(-5) })],
      shoppingList: [], logs: [],
    }, 'migrated');
    const counts = [];
    for (let i = 0; i < 5; i++) { await S.checkExpiry(); counts.push((await S.getShoppingList()).length); }
    check(counts.every(c => c === 1), {
      expected: '每次都固定 1 条', actual: j(counts),
      evidence: 'services/medicineService.ts:673-680 checkExpiry',
    });
    return '条目数稳定 ' + j(counts);
  });
  await run('ID4', 'importData(replace) 同文件连续导入 3 次：结果逐字节一致', async () => {
    seedDB();
    const payload = j({
      medicines: [canon(makeMed({ id: 'ID-4a', name: '导入药甲' })), canon(makeMed({ id: 'ID-4b', name: '导入药乙' }))],
      shoppingList: [canon(makeItem({ id: 'ID-4i', medicine_name: '导入药甲' }))],
      logs: [canon(makeLog({ id: 'ID-4l', medicine_id: 'ID-4a', medicine_name: '导入药甲' }))],
    });
    const snaps = [];
    for (let i = 0; i < 3; i++) { await S.importData(payload, 'replace'); snaps.push(JSON.stringify(readRawDB())); }
    check(snaps[0] === snaps[1] && snaps[1] === snaps[2], {
      expected: '3 次导入后主键内容完全相同',
      actual: '一致=' + (snaps[0] === snaps[1] && snaps[1] === snaps[2]) + '；长度=' + j(snaps.map(s => s.length)),
      evidence: 'services/medicineService.ts:906-908 replace 为幂等整库覆盖',
    });
    return '3 次结果一致（' + snaps[0].length + ' 字节）';
  });
  await run('ID5', 'addMedicine 同品牌连续入库 3 次：仍只 1 条记录，数量=最后一次', async () => {
    seedDB();
    const qtys = [5, 9, 12];
    for (const q of qtys) await S.addMedicine(makeMed({ id: 'ID-5-' + q, name: '重复入库药', brand: '甲厂', total_quantity: q }));
    const meds = await S.getMedicines();
    check(meds.length === 1 && meds[0].total_quantity === 12, {
      expected: '1 条记录、数量=12',
      actual: meds.length + ' 条，数量=' + meds[0].total_quantity,
      evidence: 'services/medicineService.ts:705-727 同身份合并（保留原 id）',
    });
    return '合并幂等';
  });

  // ----------------------------------------------------------
  line('');
  line('--- BG. 大数据量（1000 药品 + 1000 日志）---');
  // ----------------------------------------------------------
  const BIG_N = 1000;
  function bigDB(n) {
    return {
      medicines: Array.from({ length: n }, (_, i) => makeMed({
        id: 'BIG-' + String(i).padStart(5, '0'),
        name: '批量药' + i,
        brand: i % 2 ? '甲厂' : '乙厂',
        total_quantity: i % 50,
        threshold: i % 5,
        expiry_date: '20' + (30 + (i % 60)) + '-0' + (1 + (i % 9)) + '-1' + (i % 9),
        last_purchase_date: '2026-0' + (1 + (i % 9)) + '-1' + (i % 9),
        usage_frequency_score: i % 7,
      })),
      shoppingList: [],
      logs: Array.from({ length: n }, (_, i) => makeLog({
        id: 'BIGLOG-' + String(i).padStart(5, '0'),
        medicine_id: 'BIG-' + String(i).padStart(5, '0'),
        medicine_name: '批量药' + i,
        amount: 1 + (i % 3),
        log_time: new Date(Date.UTC(2026, 0, 1) + i * 3600000).toISOString(),
      })),
    };
  }
  const BIG_LIMIT_MS = 5000;
  await run('BG1', BIG_N + ' 条药品：读取（含全量过期检测）耗时与数据完整性', async () => {
    seedDB(bigDB(BIG_N), 'migrated');
    const t0 = Date.now();
    const meds = await S.getMedicines();
    const ms = Date.now() - t0;
    check(meds.length === BIG_N && ms < BIG_LIMIT_MS, {
      expected: '读取 ' + BIG_N + ' 条且耗时 < ' + BIG_LIMIT_MS + 'ms',
      actual: meds.length + ' 条，' + ms + 'ms',
      evidence: 'services/medicineService.ts:542-568',
    });
    return BIG_N + ' 条 / ' + ms + 'ms';
  });
  await run('BG2', BIG_N + ' 条药品：单次打卡（整库读写）耗时与结果', async () => {
    seedDB(bigDB(BIG_N), 'migrated');
    await S.getMedicines();
    const t0 = Date.now();
    await S.consumeMedicine('BIG-00007', 3);
    const ms = Date.now() - t0;
    const m = (await S.getMedicines()).find(x => x.id === 'BIG-00007');
    check(m.total_quantity === 4 && ms < BIG_LIMIT_MS, {
      expected: '7%50=7 → 扣 3 后为 4，耗时 < ' + BIG_LIMIT_MS + 'ms',
      actual: '库存=' + j(m.total_quantity) + '，' + ms + 'ms',
      evidence: 'services/medicineService.ts:626-671 每次操作整库读写',
    });
    return '库存 7→4 / ' + ms + 'ms';
  });
  await run('BG3', BIG_N + ' 条 + ' + BIG_N + ' 日志：exportData 耗时与计数', async () => {
    seedDB(bigDB(BIG_N), 'migrated');
    const t0 = Date.now();
    const raw = await S.exportData();
    const ms = Date.now() - t0;
    const p = JSON.parse(raw);
    check(p.counts.medicines === BIG_N && p.counts.logs === BIG_N && ms < BIG_LIMIT_MS, {
      expected: 'counts=' + BIG_N + '/' + BIG_N + '，耗时 < ' + BIG_LIMIT_MS + 'ms',
      actual: j(p.counts) + '，' + ms + 'ms，' + raw.length + ' 字节',
      evidence: 'services/medicineService.ts:831-853',
    });
    return raw.length + ' 字节 / ' + ms + 'ms';
  });
  await run('BG4', BIG_N + ' 条：importData(replace) 耗时与 id 完整性', async () => {
    seedDB();
    const raw = j({ medicines: bigDB(BIG_N).medicines, shoppingList: [], logs: [] });
    const t0 = Date.now();
    const res = await S.importData(raw, 'replace');
    const ms = Date.now() - t0;
    const stored = rawMedicines();
    const idsOk = stored[0].id === 'BIG-00000' && stored[BIG_N - 1].id === 'BIG-00' + (BIG_N - 1);
    check(res.medicines === BIG_N && stored.length === BIG_N && idsOk && ms < BIG_LIMIT_MS, {
      expected: '导入 ' + BIG_N + ' 条、顺序与 id 完整、耗时 < ' + BIG_LIMIT_MS + 'ms',
      actual: 'res=' + j(res.medicines) + ' 落库=' + stored.length + ' 首尾 id=' + stored[0].id + '..' + stored[BIG_N - 1].id + '，' + ms + 'ms',
      evidence: 'services/medicineService.ts:894-908 逐条 sanitize + 单次写回',
    });
    return BIG_N + ' 条 / ' + ms + 'ms';
  });
  await run('BG5', BIG_N + ' 条：sortMedicines 耗时与元素守恒', async () => {
    seedDB(bigDB(BIG_N), 'migrated');
    const meds = await S.getMedicines();
    const t0 = Date.now();
    const sorted = S.sortMedicines(meds);
    const ms = Date.now() - t0;
    const sameSet = new Set(sorted.map(m => m.id)).size === BIG_N;
    check(sorted.length === BIG_N && sameSet && sorted !== meds && ms < BIG_LIMIT_MS, {
      expected: '排序后仍 ' + BIG_N + ' 条且 id 集合不变（不原地改数组），耗时 < ' + BIG_LIMIT_MS + 'ms',
      actual: sorted.length + ' 条，唯一 id=' + new Set(sorted.map(m => m.id)).size + '，' + ms + 'ms',
      evidence: 'services/medicineService.ts:613-623 拷贝后排序',
    });
    return BIG_N + ' 条 / ' + ms + 'ms';
  });
  await run('BG6', BIG_N + ' 条：全量字段无 NaN / Infinity / 负数', async () => {
    seedDB(bigDB(BIG_N), 'migrated');
    await S.getMedicines();
    const bad = [];
    for (const m of rawMedicines()) {
      for (const f of ['total_quantity', 'threshold', 'daily_usage', 'usage_frequency_score']) {
        if (typeof m[f] !== 'number' || !Number.isFinite(m[f]) || m[f] < 0) bad.push(m.id + '.' + f + '=' + j(m[f]));
      }
    }
    check(bad.length === 0, {
      expected: '4 个数值字段全部为有限非负数',
      actual: bad.length + ' 处异常: ' + bad.slice(0, 5).join(' | '),
      evidence: 'services/medicineService.ts:306 nonNegNum',
    });
    return BIG_N + ' 条 × 4 字段全部合法';
  });
  await run('BG7', BIG_N + ' 条日志：读取、倒序、无丢数据', async () => {
    seedDB(bigDB(BIG_N), 'migrated');
    const t0 = Date.now();
    const logs = await S.getUsageLogs();
    const ms = Date.now() - t0;
    const desc = logs.every((l, i) => i === 0 || logs[i - 1].log_time >= l.log_time);
    check(logs.length === BIG_N && desc && logs[0].id === 'BIGLOG-00999' && ms < BIG_LIMIT_MS, {
      expected: BIG_N + ' 条、按时间倒序（首条为最新的 BIGLOG-00999）',
      actual: logs.length + ' 条、倒序=' + desc + '、首条=' + logs[0].id + '，' + ms + 'ms',
      evidence: 'services/medicineService.ts:606-610 localeCompare 倒序',
    });
    return BIG_N + ' 条 / ' + ms + 'ms';
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
  const SEQ_COUNT = 300;
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
        // INV3：补货清单不得存在孤儿条目 —— 带 medicine_id 的必须能对应到现存药品；
        //       无 medicine_id 的历史条目必须能找到同名药品。
        for (const item of (Array.isArray(snapshot.shoppingList) ? snapshot.shoppingList : [])) {
          if (item.status !== 'pending') continue;
          const linked = item.medicine_id
            ? snapshot.medicines.some(m => String(m.id) === String(item.medicine_id))
            : snapshot.medicines.some(m => m.name === item.medicine_name);
          if (!linked) {
            violations.push({
              inv: 'INV3 清单无孤儿条目', trace: trace.slice(),
              detail: '条目 ' + j({ id: item.id, name: item.medicine_name, brand: item.brand, medicine_id: item.medicine_id }) + ' 找不到对应药品',
            });
          }
        }
      }
    }
    return { violations, steps, clampEvents, seqs };
  }
  const prop = await runPropertySequences(SEQ_COUNT);
  await run('K1', '属性测试：' + SEQ_COUNT + ' 组随机操作序列，每步后库存恒为有限非负数（INV1）', () => {
    const bad = prop.violations.filter(v => !v.inv.startsWith('INV2') && v.inv !== 'INV3 清单无孤儿条目');
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
  await run('K3', '属性测试边界：入库数量为负必须被拒绝，且库里不出现负库存（INV1 的对抗输入）', async () => {
    seedDB();
    const r = await mustThrow(() => S.addMedicine(makeMed({ id: 'K3-neg', name: '负库存药', total_quantity: -5 })));
    const meds = await S.getMedicines();
    const q = meds.length ? meds[0].total_quantity : null;
    check(r.threw && (meds.length === 0 || (Number.isFinite(q) && q >= 0)), {
      expected: '抛错「入库数量必须为不小于 0 的数字」，且不落库',
      actual: r.threw ? '已抛错 ' + describeError(r.error) + '；落库 ' + meds.length + ' 条' : '未抛错，落库 total_quantity=' + j(q),
      evidence: 'services/medicineService.ts:696-700 addMedicine 数量防御（首轮验收修复项，与 restockMedicine:793-797 / consumeMedicine 对称）',
    });
    return r.threw ? '被拒绝' : '负库存已落库';
  });
  await run('K4', '属性测试：任意时刻补货清单不存在孤儿条目（INV3）', () => {
    const bad = prop.violations.filter(v => v.inv === 'INV3 清单无孤儿条目');
    check(bad.length === 0, {
      expected: '每步之后：清单里每条 pending 条目都能对应到现存药品（id 命中或同名命中）',
      actual: bad.length + ' 处违反：' + bad.map(v => v.detail).join(' | '),
      evidence: bad.length ? '触发序列：\n       ' + bad[0].trace.map((t, i) => (i + 1) + ') ' + t).join('\n       ') : '',
    });
    return prop.seqs + ' 组序列 / ' + prop.steps + ' 步内未出现孤儿条目';
  });
  await run('K5', '孤儿防护（对抗输入）：删除药品后，旧备份里「带品牌但无 medicine_id」的同品牌条目不应残留', async () => {
    seedDB({
      medicines: [makeMed({ id: 'K5-med', name: '历史药', brand: '老品牌', total_quantity: 1, expiry_date: shiftToday(-1) })],
      shoppingList: [{ id: 'K5-item', medicine_name: '历史药', brand: '老品牌', reason: '过期', status: 'pending', created_at: '2026-01-01T00:00:00.000Z' }],
      logs: [],
    }, 'migrated');
    await S.deleteMedicine('K5-med');
    const meds = rawMedicines();
    const list = await S.getShoppingList();
    const orphans = list.filter(i => !meds.some(m => (i.medicine_id ? String(m.id) === String(i.medicine_id) : m.name === i.medicine_name)));
    check(orphans.length === 0, {
      expected: '删除后该药品的历史条目被清理，清单 0 条孤儿',
      actual: orphans.length + ' 条孤儿: ' + j(orphans.map(i => ({ n: i.medicine_name, b: i.brand, mid: i.medicine_id }))),
      evidence: 'services/medicineService.ts:775-782：无 medicine_id 但带 brand 的条目一律 return true（假定归属其它品牌）；'
        + '品牌恰好与被删药品相同时该提醒残留。最小复现：seed 一条 {medicine_name:"历史药", brand:"老品牌"}（模拟旧备份）→ deleteMedicine(该药品) → 条目仍在',
      severity: '低（仅旧备份/旧设备遗留的无 id 条目；新数据一律带 medicine_id，NB9/NB10 已覆盖）',
    });
    return '无孤儿';
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
  tzChildMain(process.argv[3], process.argv[4]).then((out) => {
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
