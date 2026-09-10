#!/usr/bin/env node
/**
 * 文件名: scripts/test-ui-logic.mjs
 * 功能: modern/ui.ts 纯逻辑回归测试（状态徽章文案 / 健康指数）
 *
 * 为什么需要它：界面文案里的动态数字曾出过严重错误 ——
 *   getStatus() 计算"已过期多少天"时符号写反，任何过期药品都显示「已过期 1 天」
 *   （2024 年过期的药在 2026 年看也是"1 天"）。这类 bug 不会被类型检查和
 *   服务层测试覆盖，只能靠针对文案的断言守住。
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
function check(id, desc, ok, detail) {
  if (ok) { pass += 1; console.log('PASS ' + id + ' ' + desc); }
  else { fail += 1; console.log('FAIL ' + id + ' ' + desc + '\n     实际: ' + detail); }
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

const { getStatus, getHealthOverview } = ui;
const TODAY = '2026-09-10';

// --- 已过期天数（本次修复的核心）---
const long = getStatus(makeMed({ expiry_date: '2024-09-10' }), TODAY);
check('U1', '2024-09-10 过期 → 已过期 730 天（不是 1 天）', long.label === '已过期 730 天', long.label);

const yesterday = getStatus(makeMed({ expiry_date: '2026-09-09' }), TODAY);
check('U2', '昨天过期 → 已过期 1 天', yesterday.label === '已过期 1 天', yesterday.label);

const todayEdge = getStatus(makeMed({ expiry_date: TODAY }), TODAY);
check('U3', '当天到期不算过期（边界）', todayEdge.key !== 'expired', todayEdge.key + '/' + todayEdge.label);

const soon = getStatus(makeMed({ expiry_date: '2026-09-20' }), TODAY);
check('U4', '10 天后到期 → 还有 10 天过期', soon.label === '还有 10 天过期', soon.label);

const noExpiry = getStatus(makeMed({ expiry_date: '' }), TODAY);
check('U5', '无有效期 → 不判过期', noExpiry.key === 'normal', noExpiry.key);

const outOfStock = getStatus(makeMed({ total_quantity: 0 }), TODAY);
check('U6', '库存为 0 → 已用尽', outOfStock.label === '已用尽', outOfStock.label);

// --- 健康指数（空箱语义）---
const empty = getHealthOverview([]);
check('U7', '空药箱：指数 0、评级「待入库」（不是 100% 达标）',
  empty.score === 0 && empty.grade === '待入库', 'score=' + empty.score + ' grade=' + empty.grade);

const healthy = getHealthOverview([makeMed({ total_quantity: 30, expiry_date: '2027-12-31' })]);
check('U8', '全部正常：指数 100、评级「优良」',
  healthy.score === 100 && healthy.grade === '优良', 'score=' + healthy.score + ' grade=' + healthy.grade);

const mixed = getHealthOverview([
  makeMed({ total_quantity: 30, expiry_date: '2027-12-31' }),
  makeMed({ id: 't-2', expiry_date: '2020-01-01' }),
  makeMed({ id: 't-3', total_quantity: 0 }),
]);
check('U9', '混合状态：过期 1 / 用尽 1 被正确统计',
  mixed.expired === 1 && mixed.out === 1 && mixed.total === 3, JSON.stringify(mixed));

console.log('\n' + '='.repeat(60));
console.log('TOTAL=' + (pass + fail) + ' PASS=' + pass + ' FAIL=' + fail);
console.log('='.repeat(60));
process.exit(fail > 0 ? 1 : 0);
