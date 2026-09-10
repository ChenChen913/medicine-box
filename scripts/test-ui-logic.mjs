#!/usr/bin/env node
/**
 * 文件名: scripts/test-ui-logic.mjs
 * 功能: modern/ui.ts 纯逻辑回归测试（状态徽章文案 / 健康指数 / 分类映射 / 时间格式化）
 *
 * 为什么需要它：界面文案里的动态数字曾出过严重错误 ——
 *   getStatus() 计算"已过期多少天"时符号写反，任何过期药品都显示「已过期 1 天」
 *   （2024 年过期的药在 2026 年看也是"1 天"）。这类 bug 不会被类型检查和
 *   服务层测试覆盖，只能靠针对文案的断言守住。
 *
 * 覆盖矩阵（A-J 十组）：
 *   A 过期（含天数符号与状态优先级）   B 用尽（与 low 的优先级）
 *   C 告急（阈值边界 + 仅剩 N 天文案） D 临期（30 天窗口边界 + 优先级）
 *   E 正常（含大数字强调色分支）       F 脏数据（空串/undefined/非法日期串）
 *   G usableDays（0/负数/小数取整）    H 健康指数（空箱/满分/评分档位/headline）
 *   I 分类图标映射（已知分类/未知兜底） J 时间格式化（今日/昨日/更早/非法）
 *
 * 时间确定性：getStatus 显式传 today；getHealthOverview 与 formatLogTime 内部自己
 *   读时钟（todayDateString / new Date()），所以用 withNow() 把这枚时钟冻在
 *   2026-09-10 09:00，跑完立即还原 —— 断言结果与"跑测试那天真实是几号"无关。
 *
 * 运行：node scripts/test-ui-logic.mjs（或 npm test，会先跑服务层测试）
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let pass = 0;
let fail = 0;

/** 值的可读渲染（字符串带引号，便于看出空串与 undefined 的区别） */
function fmt(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  if (v === null || typeof v === 'undefined') return String(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function check(id, desc, ok, actual, expected) {
  if (ok) { pass += 1; console.log('PASS ' + id + ' ' + desc); return; }
  fail += 1;
  console.log('FAIL ' + id + ' ' + desc);
  console.log('     期望: ' + fmt(expected));
  console.log('     实际: ' + fmt(actual));
}

/** 严格相等 */
function eq(id, desc, actual, expected) { check(id, desc, actual === expected, actual, expected); }

/** 子串断言 */
function has(id, desc, haystack, needle) {
  const text = String(haystack);
  check(id, desc, text.includes(needle), text, '包含 ' + JSON.stringify(needle));
}

function makeMed(over) {
  return {
    id: 't-1', name: '测试药', form_type: '片剂', category: '其他', location: '',
    total_quantity: 10, unit: '片', threshold: 2,
    expiry_date: '', last_purchase_date: '', symptoms_treated: '',
    dosage_instruction: '', daily_usage: 1, side_effects: '', usage_frequency_score: 0,
    ...over,
  };
}

async function buildBundle() {
  let esbuild;
  try {
    esbuild = await import('esbuild');
  } catch (e) {
    throw new Error('找不到 esbuild：它是 devDependency，请先运行 npm install', { cause: e });
  }
  const out = path.join(os.tmpdir(), 'mb-ui-bundle-' + process.pid + '.mjs');
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'modern', 'ui.ts')],
    outfile: out,
    bundle: true,
    format: 'esm',
    platform: 'node',
    define: {
      'import.meta.env.VITE_SUPABASE_URL': '""',
      'import.meta.env.VITE_SUPABASE_ANON_KEY': '""',
    },
    external: ['react', 'react-dom', '@supabase/supabase-js'],
    logLevel: 'warning',
  });
  return out;
}

const bundle = await buildBundle();
const ui = await import(pathToFileURL(bundle).href).finally(() => {
  try { fs.unlinkSync(bundle); } catch { /* ignore */ }
});

const REQUIRED_EXPORTS = ['getStatus', 'getHealthOverview', 'usableDays', 'getCategoryMeta', 'formatLogTime'];
const missingExports = REQUIRED_EXPORTS.filter((name) => typeof ui[name] !== 'function');
check('U0', '导出齐全：' + REQUIRED_EXPORTS.join(' / '),
  missingExports.length === 0, missingExports.join(', ') || '(全部存在)', '(全部存在)');
if (missingExports.length > 0) {
  console.log('\nTOTAL=' + (pass + fail) + ' PASS=' + pass + ' FAIL=' + fail);
  process.exit(1);
}

const { getStatus, getHealthOverview, usableDays, getCategoryMeta, formatLogTime } = ui;

// --- 冻结时钟：只影响内部自己读 new Date() 的导出（getHealthOverview / formatLogTime）---
const RealDate = Date;
const FROZEN_NOW = '2026-09-10T09:00:00';

function withNow(iso, fn) {
  const fixed = new RealDate(iso).getTime();
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fixed);
      else super(...args);
    }
    static now() { return fixed; }
  }
  globalThis.Date = FakeDate;
  try {
    return fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

const TODAY = '2026-09-10';
/** 纯函数取状态：today 永远显式传入，不依赖真实时钟 */
const status = (over, today = TODAY) => getStatus(makeMed(over), today);
const health = (medicines) => withNow(FROZEN_NOW, () => getHealthOverview(medicines));
const logTime = (iso) => withNow(FROZEN_NOW, () => formatLogTime(iso));

// ============ A 过期：天数符号 + 状态优先级 ============

const long = status({ expiry_date: '2024-09-10' });
eq('U1', '2024-09-10 过期 → 已过期 730 天（不是 1 天）', long.label, '已过期 730 天');

const yesterday = status({ expiry_date: '2026-09-09' });
eq('U2', '昨天过期 → 已过期 1 天', yesterday.label, '已过期 1 天');

const todayEdge = status({ expiry_date: TODAY });
check('U3', '当天到期不算过期（边界）', todayEdge.key !== 'expired', todayEdge.key, '≠ "expired"');

eq('U10', '当天到期 → 走临期分支（还有 0 天过期）', todayEdge.key, 'expiring');
eq('U11', '当天到期的文案为「还有 0 天过期」', todayEdge.label, '还有 0 天过期');

const oneYearAgo = status({ expiry_date: '2025-09-10' });
eq('U12', '过期满 365 天 → 已过期 365 天（跨年不倒退）', oneYearAgo.label, '已过期 365 天');

check('U13', '过期天数不得出现负号（老 bug 的符号回归）',
  !/-\d/.test(long.label) && !/-\d/.test(yesterday.label), long.label + ' / ' + yesterday.label, '文案中无 "-数字"');

const bothBad = status({ expiry_date: '2020-01-01', total_quantity: 0 });
eq('U14', '既过期又没库存 → 判过期（过期 > 用尽）', bothBad.key, 'expired');
check('U15', '既过期又没库存 → 文案仍是「已过期 N 天」而不是「已用尽」',
  /^已过期 \d+ 天$/.test(bothBad.label), bothBad.label, '匹配 /^已过期 \\d+ 天$/');

const expiredZeroThreshold = status({ expiry_date: '2020-01-01', total_quantity: 0, threshold: 0 });
eq('U16', '过期 + 库存 0 + 阈值 0 → 仍判过期（优先级最高）', expiredZeroThreshold.key, 'expired');

// ============ B 用尽 ============

const outOfStock = status({ total_quantity: 0 });
eq('U6', '库存为 0 → 已用尽', outOfStock.label, '已用尽');

const outZeroThreshold = status({ total_quantity: 0, threshold: 0 });
eq('U17', '库存 0 且阈值 0 → 判用尽（用尽 > 告急，0<=0 也满足 low 条件）', outZeroThreshold.key, 'out');

const outWithUsage = status({ total_quantity: 0, daily_usage: 3 });
eq('U18', '库存 0 且有每日用量 → 判用尽，不因可算天数而变成告急', outWithUsage.key, 'out');

// ============ C 告急：阈值边界 + 「仅剩 N 天」 ============

const atThreshold = status({ total_quantity: 2, threshold: 2 });
eq('U19', '库存 == 阈值 → 库存告急（含等号）', atThreshold.key, 'low');

const overThreshold = status({ total_quantity: 3, threshold: 2 });
eq('U20', '库存 == 阈值 + 1 → 不是告急', overThreshold.key, 'normal');

const lowExactly3 = status({ total_quantity: 3, threshold: 3, daily_usage: 1 });
eq('U21', '告急且剩余正好 3 天 → 文案含「仅剩3天」', lowExactly3.label, '库存告急 (仅剩3天)');

const low4Days = status({ total_quantity: 4, threshold: 4, daily_usage: 1 });
eq('U22', '告急但剩余 4 天（>3）→ 不附加「仅剩」', low4Days.label, '库存告急');

const lowUsageZero = status({ total_quantity: 2, threshold: 2, daily_usage: 0 });
eq('U23', '告急 + daily_usage=0 → 不出现「仅剩」', lowUsageZero.label, '库存告急');

const lowUsageNegative = status({ total_quantity: 2, threshold: 2, daily_usage: -2 });
eq('U24', '告急 + daily_usage 负数 → 不出现「仅剩」', lowUsageNegative.label, '库存告急');

const lowUsageUndefined = status({ total_quantity: 2, threshold: 2, daily_usage: undefined });
eq('U25', '告急 + daily_usage=undefined → 不出现「仅剩」', lowUsageUndefined.label, '库存告急');

const low2Days = status({ total_quantity: 5, threshold: 5, daily_usage: 2 });
eq('U26', '告急 + 每日 2 片剩 5 片 → 「仅剩2天」（按 daily_usage 折算）', low2Days.label, '库存告急 (仅剩2天)');

const badgeCases = [long, yesterday, outOfStock, atThreshold, status({ expiry_date: '2026-09-20' })];
const emptyBadge = badgeCases.filter((s) => !s.badgeClass || !s.emphasisClass).map((s) => s.key);
check('U27', '五种状态的 badgeClass / emphasisClass 均为非空字符串',
  emptyBadge.length === 0, emptyBadge.join(',') || '(全部非空)', '(全部非空)');

// ============ D 临期：30 天窗口边界 + 优先级 ============

const soon = status({ expiry_date: '2026-09-20' });
eq('U4', '10 天后到期 → 还有 10 天过期', soon.label, '还有 10 天过期');

const left29 = status({ expiry_date: '2026-10-09' });
eq('U28', '还剩 29 天 → 临期提醒', left29.key, 'expiring');

const left30 = status({ expiry_date: '2026-10-10' });
eq('U29', '还剩 30 天 → 仍提示（窗口含 30 天边界）', left30.key, 'expiring');
eq('U30', '还剩 30 天 → 文案为「还有 30 天过期」', left30.label, '还有 30 天过期');

const left31 = status({ expiry_date: '2026-10-11' });
eq('U31', '还剩 31 天 → 超出窗口，判正常', left31.key, 'normal');

const lowButSoon = status({ total_quantity: 2, threshold: 2, expiry_date: '2026-09-20' });
eq('U32', '告急 + 10 天后过期 → 判告急（low 优先于 expiring）', lowButSoon.key, 'low');

const outButSoon = status({ total_quantity: 0, expiry_date: '2026-09-20' });
eq('U33', '用尽 + 10 天后过期 → 判用尽（out 优先于 expiring）', outButSoon.key, 'out');

// ============ E 正常 ============

const noExpiry = status({ expiry_date: '' });
eq('U5', '无有效期 → 不判过期', noExpiry.key, 'normal');

const plainNormal = status({ total_quantity: 10, threshold: 2, expiry_date: '' });
eq('U34', '无有效期 + 库存充足 → 文案「状态正常」', plainNormal.label, '状态正常');

const richStock = status({ total_quantity: 10, threshold: 2, expiry_date: '' });
eq('U35', '库存 > 阈值*3 → 大数字用强调色 text-m3-primary', richStock.emphasisClass, 'text-m3-primary');

const modestStock = status({ total_quantity: 5, threshold: 2, expiry_date: '' });
eq('U36', '阈值 < 库存 <= 阈值*3 → 大数字用常规色 text-m3-on-surface',
  modestStock.emphasisClass, 'text-m3-on-surface');

// ============ F 脏数据：不得抛异常、不得误判过期 ============
// 注意：getStatus 用字符串字典序比较日期（m.expiry_date < today），不做日期合法性校验。
// 像 '2024-13-45'（月份越界）、'   '（空白串）这种串字典序小于今天，会被当成过期；
// 随后 daysBetween 解析出 Invalid Date → NaN → 文案「已过期 NaN 天」。
// （'2024-02-30' 例外：V8 宽容地按 2024-03-01 解析，判过期但文案不是 NaN。）
// U39/U40 就是钉住这个问题的。

const emptyExpiry = status({ expiry_date: '' });
eq('U37', 'expiry_date 为空串 → 判正常（空值不等于过期）', emptyExpiry.key, 'normal');

const undefinedExpiry = status({ expiry_date: undefined });
eq('U38', 'expiry_date 为 undefined → 判正常', undefinedExpiry.key, 'normal');

const illegalDate = status({ expiry_date: '2024-13-45' });
check('U39', "非法日期 '2024-13-45' 不得判成过期", illegalDate.key !== 'expired', illegalDate.key, '≠ "expired"');
check('U40', "非法日期 '2024-13-45' 的文案不得含 NaN / Invalid Date",
  !/NaN|Invalid/.test(illegalDate.label), illegalDate.label, '不含 "NaN" / "Invalid"');

const nonDateString = status({ expiry_date: 'not-a-date' });
eq('U41', "非日期串 'not-a-date' → 判正常（字典序大于今天，未进过期分支）",
  nonDateString.key, 'normal');

const dirtyMedicines = [
  makeMed({ expiry_date: '' }),
  makeMed({ expiry_date: undefined }),
  makeMed({ expiry_date: 'not-a-date' }),
  makeMed({ expiry_date: '2024-13-45' }),
  makeMed({ expiry_date: '2024-02-30' }), // 2 月没有 30 号：V8 宽容解析为 2024-03-01（判过期，但无 NaN）
  makeMed({ expiry_date: '   ' }), // 空白串同样字典序小于今天 → NaN 文案
  makeMed({ total_quantity: undefined, threshold: undefined, daily_usage: undefined, expiry_date: '' }),
];
let dirtyThrown = null;
for (const m of dirtyMedicines) {
  try { getStatus(m, TODAY); } catch (e) { dirtyThrown = String((e && e.message) || e); }
}
check('U42', '脏数据矩阵（7 种构造）逐个调用均不抛异常', dirtyThrown === null, dirtyThrown, null);

// ============ G usableDays ============

eq('U43', 'daily_usage=1、库存 10 → 10 天', usableDays(makeMed({ total_quantity: 10, daily_usage: 1 })), 10);
eq('U44', 'daily_usage=0 → null（除零不可用）', usableDays(makeMed({ total_quantity: 10, daily_usage: 0 })), null);
eq('U45', 'daily_usage 负数 → null', usableDays(makeMed({ total_quantity: 10, daily_usage: -2 })), null);
eq('U46', 'daily_usage=undefined → null', usableDays(makeMed({ total_quantity: 10, daily_usage: undefined })), null);
eq('U47', '库存小数 2.5、每日 1 → 向下取整为 2', usableDays(makeMed({ total_quantity: 2.5, daily_usage: 1 })), 2);
eq('U48', '库存 7、每日 3 → 向下取整为 2（不是四舍五入的 2.33）',
  usableDays(makeMed({ total_quantity: 7, daily_usage: 3 })), 2);
eq('U49', '库存 10、每日 0.5 → 20 天（小数用量可用）', usableDays(makeMed({ total_quantity: 10, daily_usage: 0.5 })), 20);

// ============ H 健康指数 ============
// 全部在冻结时钟 2026-09-10 下评估；正常药取 2027-12-31 到期、过期药取 2024-01-01。

const healthyMed = (id) => makeMed({ id, total_quantity: 30, threshold: 2, expiry_date: '2027-12-31' });
const expiredMed = (id) => makeMed({ id, total_quantity: 10, threshold: 2, expiry_date: '2024-01-01' });
const lowMed = (id) => makeMed({ id, total_quantity: 2, threshold: 2, daily_usage: 1, expiry_date: '' });
const outMed = (id) => makeMed({ id, total_quantity: 0, threshold: 2, expiry_date: '' });
const soonMed = (id) => makeMed({ id, total_quantity: 30, threshold: 2, expiry_date: '2026-10-01' });

const empty = health([]);
check('U7', '空药箱：指数 0、评级「待入库」（不是 100% 达标）',
  empty.score === 0 && empty.grade === '待入库', 'score=' + empty.score + ' grade=' + empty.grade,
  'score=0 grade=待入库');
has('U50', '空药箱 headline 引导入库', empty.headline, '入库');

const healthy = health([healthyMed('h-1')]);
check('U8', '全部正常：指数 100、评级「优良」',
  healthy.score === 100 && healthy.grade === '优良', 'score=' + healthy.score + ' grade=' + healthy.grade,
  'score=100 grade=优良');
eq('U51', '全部正常：headline 含「良好」', healthy.headline.includes('良好'), true);
check('U52', '全部正常：low/out/expired/expiringSoon 全为 0',
  healthy.low === 0 && healthy.out === 0 && healthy.expired === 0 && healthy.expiringSoon === 0,
  JSON.stringify({ low: healthy.low, out: healthy.out, expired: healthy.expired, expiringSoon: healthy.expiringSoon }),
  JSON.stringify({ low: 0, out: 0, expired: 0, expiringSoon: 0 }));

const allExpired = health([expiredMed('e-1'), expiredMed('e-2')]);
eq('U53', '全部过期：指数 0', allExpired.score, 0);
check('U54', '全部过期：评级不得是「优良」', allExpired.grade !== '优良', allExpired.grade, '≠ "优良"');
eq('U55', '全部过期：评级为「需关注」', allExpired.grade, '需关注');
has('U56', '全部过期：headline 提示清理过期药', allExpired.headline, '过期');

const lowOnly = health([lowMed('l-1')]);
check('U57', '有告急、无过期：headline 含「偏低」或「补足」',
  /偏低|补足/.test(lowOnly.headline), lowOnly.headline, '匹配 /偏低|补足/');

const outOnly = health([outMed('o-1')]);
check('U58', '有用尽、无过期：headline 含「偏低」或「补足」',
  /偏低|补足/.test(outOnly.headline), outOnly.headline, '匹配 /偏低|补足/');

const mixed = health([healthyMed('m-1'), lowMed('m-2'), outMed('m-3'), expiredMed('m-4'), soonMed('m-5')]);
eq('U59', '混合 5 种状态：total=5', mixed.total, 5);
eq('U60', '混合 5 种状态：expired=1', mixed.expired, 1);
eq('U61', '混合 5 种状态：out=1', mixed.out, 1);
eq('U62', '混合 5 种状态：low=1', mixed.low, 1);
eq('U63', '混合 5 种状态：expiringSoon=1（临期单独计数）', mixed.expiringSoon, 1);
eq('U64', '混合 5 种状态：normal=2（临期药品计入 normal，记录现状）', mixed.normal, 2);
eq('U65', '混合 5 种状态：score=40（2/5 计入健康）', mixed.score, 40);

function scoreBatch(normalCount, expiredCount) {
  const items = [];
  for (let i = 0; i < normalCount; i += 1) items.push(healthyMed('n-' + i));
  for (let i = 0; i < expiredCount; i += 1) items.push(expiredMed('x-' + i));
  return items;
}

const s85 = health(scoreBatch(17, 3)); // 17/20 = 85
eq('U66', 'score 恰好 85 → 评级「优良」', s85.score + '/' + s85.grade, '85/优良');
const s70 = health(scoreBatch(14, 6)); // 14/20 = 70
eq('U67', 'score 恰好 70 → 评级「良好」', s70.score + '/' + s70.grade, '70/良好');
const s50 = health(scoreBatch(10, 10)); // 10/20 = 50
eq('U68', 'score 恰好 50 → 评级「一般」', s50.score + '/' + s50.grade, '50/一般');
const s45 = health(scoreBatch(9, 11)); // 9/20 = 45
eq('U69', 'score 45（差一点到 50）→ 评级「需关注」', s45.score + '/' + s45.grade, '45/需关注');

const mixedInput = [healthyMed('p-1'), lowMed('p-2'), expiredMed('p-3')];
const mixedSnapshot = JSON.stringify(mixedInput);
health(mixedInput);
eq('U70', 'getHealthOverview 不修改入参（纯函数）', JSON.stringify(mixedInput), mixedSnapshot);

// ============ I 分类图标映射 ============

const cold = getCategoryMeta('感冒药');
eq('U71', '已知分类「感冒药」→ 图标 coronavirus', cold.icon, 'coronavirus');
check('U72', '已知分类返回值带非空 iconBg / iconColor',
  Boolean(cold.iconBg) && Boolean(cold.iconColor), cold.iconBg + ' | ' + cold.iconColor, '两个非空字符串');

eq('U73', '已知分类「心脑血管药」→ 图标 favorite', getCategoryMeta('心脑血管药').icon, 'favorite');
eq('U74', '已知分类「止痛药」→ 图标 painkiller', getCategoryMeta('止痛药').icon, 'painkiller');

let unknownThrown = null;
let unknown = null;
try { unknown = getCategoryMeta('奇奇怪怪的分类'); } catch (e) { unknownThrown = String((e && e.message) || e); }
check('U75', '未知分类不抛异常', unknownThrown === null, unknownThrown, null);
eq('U76', '未知分类兜底图标 medication', unknown && unknown.icon, 'medication');
eq('U77', '空分类名兜底图标 medication', getCategoryMeta('').icon, 'medication');

let undefinedCatThrown = null;
let undefinedCat = null;
try { undefinedCat = getCategoryMeta(undefined); } catch (e) { undefinedCatThrown = String((e && e.message) || e); }
check('U78', '分类名为 undefined 不抛异常', undefinedCatThrown === null, undefinedCatThrown, null);
eq('U79', '分类名 undefined 兜底图标 medication', undefinedCat && undefinedCat.icon, 'medication');

const CATEGORY_MATRIX = [
  ['心脑血管药', 'favorite'],
  ['感冒药', 'coronavirus'],
  ['呼吸道用药', 'coronavirus'],
  ['止痛药', 'painkiller'],
  ['肠胃药', 'stomach'],
  ['抗生素', 'bacteria'],
  ['外用药', 'ointment'],
  ['过敏药', 'spa'],
  ['咽喉用药', 'throat'],
  ['保健品', 'eco'],
  ['医疗器械', 'medical_services'],
  ['眼科用药', 'eye'],
  ['其他', 'medication'],
];
const wrongIcons = CATEGORY_MATRIX
  .filter(([category, icon]) => getCategoryMeta(category).icon !== icon)
  .map(([category, icon]) => category + ': 期望 ' + icon + ' 实际 ' + getCategoryMeta(category).icon);
check('U80', '13 个已知分类的图标映射矩阵全部命中', wrongIcons.length === 0,
  wrongIcons.join('; ') || '(全部命中)', '(全部命中)');

const malformedMeta = CATEGORY_MATRIX
  .map(([category]) => getCategoryMeta(category))
  .filter((meta) => typeof meta.icon !== 'string' || !meta.icon || typeof meta.iconBg !== 'string'
    || !meta.iconBg || typeof meta.iconColor !== 'string' || !meta.iconColor);
check('U81', '所有分类返回值都有非空 icon / iconBg / iconColor',
  malformedMeta.length === 0, JSON.stringify(malformedMeta), '[]');

// ============ J 时间格式化（时钟冻结在 2026-09-10 09:00）============

eq('U82', '今天的时间戳 → 「今日 12:40」', logTime('2026-09-10T12:40:00'), '今日 12:40');
eq('U83', '今天凌晨 → 个位小时分钟补零「今日 00:05」', logTime('2026-09-10T00:05:00'), '今日 00:05');
eq('U84', '昨天的时间戳 → 「昨日 08:15」', logTime('2026-09-09T08:15:00'), '昨日 08:15');
eq('U85', '前天及更早 → 「09-07 21:10」', logTime('2026-09-07T21:10:00'), '09-07 21:10');
eq('U86', '更早（跨月）→ 「08-31 07:05」', logTime('2026-08-31T07:05:00'), '08-31 07:05');
eq('U87', '更早（跨年，不带年份）→ 「12-31 23:59」', logTime('2025-12-31T23:59:00'), '12-31 23:59');
eq('U88', '非法时间戳 → 原样返回，不抛异常', logTime('not-a-date'), 'not-a-date');
eq('U89', '空串 → 原样返回空串', logTime(''), '');

const formatted = ['2026-09-10T12:40:00', '2026-09-09T08:15:00', '2026-09-07T21:10:00', '2025-12-31T23:59:00']
  .map((iso) => logTime(iso));
check('U90', '正常时间戳的格式化结果不含 Invalid Date / NaN',
  formatted.every((text) => !/Invalid|NaN/.test(text)), formatted.join(' | '), '不含 "Invalid" / "NaN"');

eq('U91', 'withNow 结束后全局 Date 已还原（不污染后续断言）', Date, RealDate);

console.log('\n' + '='.repeat(60));
console.log('TOTAL=' + (pass + fail) + ' PASS=' + pass + ' FAIL=' + fail);
console.log('='.repeat(60));
process.exit(fail > 0 ? 1 : 0);
