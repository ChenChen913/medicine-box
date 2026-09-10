/**
 * 文件名: scripts/mutation-check.mjs
 * 功能: 变异测试（mutation spot-check）—— 故意把关键防线改坏，验证测试真的抓得住。
 * 用法: node scripts/mutation-check.mjs   （手动运行，**不放进 CI**：它会临时改源码）
 *
 * 为什么需要它：
 *   断言数量多 ≠ 测试有效。如果测试只断言"不抛异常"或只覆盖 happy path，
 *   把代码改坏也可能全绿。本脚本对 5 条真实历史缺陷的修复点逐个注入变异，
 *   每个变异都必须让对应用例集**失败**（CAUGHT）；只要有一个 MISSED，
 *   就说明那条防线的测试是摆设。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abs = p => path.join(ROOT, p);

const MUTATIONS = [
  {
    name: 'M1 过期天数符号反转（历史 bug：永远显示「已过期 1 天」）',
    file: 'modern/ui.ts', suite: 'ui',
    find: 'const over = Math.max(1, daysBetween(expiry, today));',
    replace: 'const over = -daysBetween(expiry, today);',
  },
  {
    name: 'M2 药名规范化失效（历史 bug：空白/零宽字符药名可入库）',
    file: 'services/medicineService.ts', suite: 'service',
    find: "return String(v ?? '').replace(ZERO_WIDTH_RE, '').trim();",
    replace: "return String(v ?? '');",
  },
  {
    name: 'M3 日历日期校验失效（历史 bug：2024-13-45 能入库并显示 NaN 天）',
    file: 'services/medicineService.ts', suite: 'service',
    find: 'return d <= daysInMonth[m - 1];',
    replace: 'return true;',
  },
  {
    name: 'M4 本地写入被跳过（历史 bug：写失败被当成保存成功）',
    file: 'services/medicineService.ts', suite: 'service',
    find: 'localStorage.setItem(LS_KEY, JSON.stringify(db));',
    replace: 'void JSON.stringify(db);',
  },
  {
    name: 'M5 补货核销退回「只按药名匹配」（历史 bug：同名不同品牌互相误伤）',
    file: 'services/medicineService.ts', suite: 'service',
    find: "const byBrand = meds.findIndex(m => m.name === item.medicine_name && (m.brand ?? '') === (item.brand ?? ''));",
    replace: "const byBrand = meds.findIndex(m => m.name === item.medicine_name);",
  },
];

const SUITE_FILE = { service: 'scripts/test-medicine-service.mjs', ui: 'scripts/test-ui-logic.mjs' };
let caught = 0, missed = 0, skipped = 0;

for (const m of MUTATIONS) {
  const file = abs(m.file);
  const original = fs.readFileSync(file, 'utf8');
  if (!original.includes(m.find)) { console.log('SKIP    ' + m.name + '（源码中找不到锚点，可能已被重构）'); skipped++; continue; }
  let status;
  try {
    fs.writeFileSync(file, original.replace(m.find, m.replace));
    const r = spawnSync(process.execPath, [path.join(ROOT, SUITE_FILE[m.suite])], { cwd: ROOT, stdio: 'ignore' });
    status = r.status;
  } finally {
    fs.writeFileSync(file, original); // 无论成败立刻还原，避免留下被改坏的源码
  }
  const restored = fs.readFileSync(file, 'utf8') === original;
  if (!restored) { console.error('严重错误：' + m.file + ' 未能还原！'); process.exit(3); }
  if (status !== 0) { console.log('CAUGHT  ' + m.name + '（用例集失败，退出码 ' + status + '）'); caught++; }
  else { console.log('MISSED! ' + m.name + '（变异后测试仍然全绿 → 这条防线没有被真正测试）'); missed++; }
}

console.log('\n' + '='.repeat(64));
console.log('变异总数=' + MUTATIONS.length + ' 被抓住=' + caught + ' 漏网=' + missed + ' 跳过=' + skipped);
console.log('='.repeat(64));
process.exit(missed === 0 ? 0 : 1);
