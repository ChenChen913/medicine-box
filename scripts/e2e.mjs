#!/usr/bin/env node
/**
 * 文件名: scripts/e2e.mjs
 * 功能: 浏览器端端到端验收套件（自动起 preview 服务 + 驱动本机 Chrome）
 *
 * 为什么要有它：服务层测试（test-medicine-service.mjs）只能覆盖纯逻辑，
 * 而本项目历史上出过的事故大多在"界面层"：焦点没进弹窗、卡片布局不一致、
 * 弱网下动态分块加载失败导致白屏、"已过期 N 天"天数算错……
 * 这些都必须在真实浏览器里点一遍才算验过。
 *
 * 用法：
 *   npm run test:e2e                # 自动构建 + 起服务 + 跑全部用例
 *   E2E_CHROME=/path/to/chrome npm run test:e2e   # 指定浏览器
 *   E2E_PORT=4188 npm run test:e2e  # 指定端口（默认 4178）
 *
 * 退出码：0 = 全部通过；1 = 有用例失败；2 = 环境问题（找不到浏览器/服务起不来）
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = Number(process.env.E2E_PORT || 4178);
const BASE = 'http://127.0.0.1:' + PORT + '/';
const DB_KEY = 'smart-medicine-box:db:v1';

/* ---------------- 浏览器探测 ---------------- */
function findChrome() {
  const candidates = [
    process.env.E2E_CHROME,
    'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
    'C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
    'C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe',
    'C:\\\\Program Files\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch { /* ignore */ } }
  return null;
}

/* ---------------- 结果记录 ---------------- */
const results = [];
let currentGroup = '';
function group(name) { currentGroup = name; console.log('\n--- ' + name + ' ---'); }
function record(id, desc, ok, detail) {
  results.push({ group: currentGroup, id, desc, ok, detail: String(detail === undefined ? '' : detail).slice(0, 400) });
  console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + desc + (ok ? '' : '\n      >> ' + String(detail).slice(0, 300)));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- 页面辅助 ---------------- */
async function newPage(browser, w, h, mobile) {
  let b = await ensureBrowser();
  let ctx;
  try {
    ctx = await b.createBrowserContext();
  } catch {
    // 浏览器进程可能已被前面的用例搞崩（CDP 会话失效）：重启一次再试
    try { await b.close(); } catch { /* ignore */ }
    BROWSER = null;
    b = await ensureBrowser();
    ctx = await b.createBrowserContext();
  }
  const page = await ctx.newPage();
  await page.setViewport({ width: w, height: h, isMobile: !!mobile, hasTouch: !!mobile });
  page._logs = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') page._logs.push(m.type() + ':' + m.text().slice(0, 140)); });
  page.on('pageerror', e => page._logs.push('pageerror:' + String(e).slice(0, 140)));
  page.on('dialog', async d => { try { await d.dismiss(); } catch { /* ignore */ } });
  return page;
}
const readDB = page => page.evaluate(k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }, DB_KEY);

/** 浏览器可能被某个用例搞崩（CDP 会话失效），这里自动重启，保证后续用例还能跑 */
let BROWSER = null;
let PUPPETEER = null;
async function ensureBrowser() {
  if (BROWSER && BROWSER.connected) return BROWSER;
  try { if (BROWSER) await BROWSER.close(); } catch { /* ignore */ }
  BROWSER = await PUPPETEER.launch({ executablePath: process.env.E2E_CHROME_PATH, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  return BROWSER;
}

const waitDb = async (page, pred, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 8000)) { const d = await readDB(page); if (d && pred(d)) return d; await sleep(150); }
  return await readDB(page);
};
const clickLabel = (page, text) => page.evaluate(t => {
  const el = Array.from(document.querySelectorAll('button,[role=button],a'))
    .find(e => (((e.innerText || '') + ' ' + (e.getAttribute('aria-label') || '')).trim()) === t);
  if (!el) return false; el.click(); return true;
}, text);
const clickContains = (page, text) => page.evaluate(t => {
  const el = Array.from(document.querySelectorAll('button,[role=button],a')).find(e => (e.innerText || '').includes(t));
  if (!el) return false; el.click(); return true;
}, text);
/** 真实鼠标点击（按 aria-label 精确匹配）：合成 .click() 不会让按钮获得焦点，
 *  验证"焦点归位"这类行为时必须用真实点击（浏览器会把焦点给按钮） */
const realClickByAria = async (page, label) => {
  const h = await page.evaluateHandle(l => Array.from(document.querySelectorAll('button')).find(x => (x.getAttribute('aria-label') || '') === l), label);
  const el = h.asElement(); if (!el) return false; await el.click(); return true;
};
const realClick = async (page, text) => {
  const h = await page.evaluateHandle(t => Array.from(document.querySelectorAll('button,[role=button],a'))
    .find(e => (((e.innerText || '') + ' ' + (e.getAttribute('aria-label') || '')).trim()) === t), text);
  const el = h.asElement(); if (!el) return false; await el.click(); return true;
};
const waitLabel = (page, text, timeout) => page.waitForFunction(t =>
  Array.from(document.querySelectorAll('button,[role=button],a'))
    .some(e => (((e.innerText || '') + ' ' + (e.getAttribute('aria-label') || '')).trim()) === t),
  { timeout: timeout || 20000 }, text);
const setInput = (page, matcher, value) => page.evaluate((m, v) => {
  const el = Array.from(document.querySelectorAll('input,textarea')).find(i => {
    const lab = (i.labels && i.labels[0] ? i.labels[0].innerText : '') || '';
    return lab.includes(m) || i.placeholder === m || i.getAttribute('aria-label') === m;
  });
  if (!el) return false;
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}, matcher, value);
/**
 * 驱动自定义日期选择器（DateField）：打开 → 年份网格跳到目标年 → 月份网格选月 → 点日期。
 * 年份网格支持左右翻页，这里会自动翻到目标年所在页。
 */
const setDate = async (page, iso, ariaLabel = '有效截止日期') => {
  const [y, m] = iso.split('-');
  const opened = await page.evaluate(l => {
    const b = Array.from(document.querySelectorAll('button')).find(x => (x.getAttribute('aria-label') || '') === l);
    if (!b) return false; b.click(); return true;
  }, ariaLabel);
  if (!opened) return 'NO_TRIGGER';
  await sleep(400);
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find(x => (x.getAttribute('aria-label') || '') === '选择年份'); if (b) b.click(); });
  await sleep(300);
  for (let i = 0; i < 8; i++) {
    const found = await page.evaluate(yy => Array.from(document.querySelectorAll('button')).some(x => (x.innerText || '').trim() === yy), y);
    if (found) break;
    await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find(x => (x.getAttribute('aria-label') || '') === '下一页'); if (b) b.click(); });
    await sleep(200);
  }
  await page.evaluate(yy => { const b = Array.from(document.querySelectorAll('button')).find(x => (x.innerText || '').trim() === yy); if (b) b.click(); }, y);
  await sleep(300);
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find(x => (x.getAttribute('aria-label') || '') === '选择月份'); if (b) b.click(); });
  await sleep(300);
  await page.evaluate(mm => { const b = Array.from(document.querySelectorAll('button')).find(x => (x.innerText || '').trim() === (Number(mm) + '月')); if (b) b.click(); }, m);
  await sleep(300);
  const picked = await page.evaluate(isoStr => {
    const b = Array.from(document.querySelectorAll('button')).find(x => (x.getAttribute('aria-label') || '') === isoStr);
    if (!b) return false; b.click(); return true;
  }, iso);
  await sleep(300);
  return picked ? 'ok' : 'NO_DAY';
};
/** 在最上层弹窗内按正则找按钮并点击（弹窗与卡片上常有同名/近名按钮） */
const clickInDialogMatch = (page, reSource) => page.evaluate(src => {
  const ds = Array.from(document.querySelectorAll('[role=dialog]'));
  const d = ds[ds.length - 1];
  if (!d) return 'NO_DIALOG';
  const rx = new RegExp(src);
  const el = Array.from(d.querySelectorAll('button,[role=button]'))
    .find(e => rx.test(((e.innerText || '') + ' ' + (e.getAttribute('aria-label') || '')).trim()));
  if (!el) return 'NO_BTN';
  el.click(); return 'ok';
}, reSource);
/**
 * 打开某药品的详情抽屉。
 * 2026-09-10 起：移动卡片不再声明 role="button"（父级 role=button 套内层按钮 = 嵌套交互元素，
 * 违反 WCAG 4.1.2，axe 的 nested-interactive 抓到 18 处），改为点卡片里真实可见的「详情」按钮。
 * 桌面卡与移动卡都渲染了这个按钮，故两档视口通用。
 */
const openDetailByName = (page, name, extra = '') => page.evaluate((n, ex) => {
  // ⚠️ 必须取「最具体的匹配容器」（祖先文本最短的那个）。
  // 直接 find 会踩坑：外层容器包含所有卡片，于是每张卡的「详情」按钮都"匹配"，
  // find 返回 DOM 里第一张卡 → 打开了别的药（实测：要布洛芬却开了阿司匹林）。
  const cands = Array.from(document.querySelectorAll('button'))
    .filter(b => (b.innerText || '').trim() === '详情')
    .map(b => {
      let el = b;
      for (let i = 0; i < 8 && el; i++, el = el.parentElement) {
        const t = el.innerText || '';
        if (t.includes(n) && (!ex || t.includes(ex))) return { b, len: t.length };
      }
      return null;
    })
    .filter(Boolean)
    .sort((x, y) => x.len - y.len);
  if (cands.length) { cands[0].b.click(); return true; }
  return false;
}, name, extra);

const activeInfo = page => page.evaluate(() => {
  const a = document.activeElement;
  const lab = a && a.labels && a.labels[0] ? a.labels[0].innerText.replace(/\n+/g, ' ') : '';
  const d = document.querySelector('[role=dialog]');
  return {
    tag: a ? a.tagName : 'none', type: a ? (a.type || '') : '', label: lab.trim().slice(0, 24),
    aria: a ? (a.getAttribute('aria-label') || '') : '', inside: !!(d && a && d.contains(a)),
    isPanel: !!(a && d && a === d),
  };
});
async function openApp(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.body.innerText.includes('我的药箱'), { timeout: 30000 });
  await page.waitForFunction(() => /全部储备种类/.test(document.body.innerText), { timeout: 30000 });
  await sleep(900);
}
async function addMed(page, name, qty, exp, brand) {
  await clickLabel(page, '入库新药');
  await page.waitForSelector('[role=dialog]', { timeout: 15000 });
  await sleep(500);
  await setInput(page, '药品名称', name);
  await setInput(page, '初始入库数量', String(qty));
  if (brand) await setInput(page, '如：999、仁和、拜耳；不填则不区分品牌', brand);
  await setDate(page, exp);
  await sleep(250);
  await clickLabel(page, '确认入库');
  await waitDb(page, d => (d.medicines || []).some(m => m.name === name));
}

/* ---------------- 主流程 ---------------- */
async function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.error('未找到 Chrome/Edge，可用环境变量 E2E_CHROME 指定浏览器路径');
    process.exit(2);
  }
  console.log('浏览器: ' + chrome);

  // 1) 构建（保证测的是当前代码，而不是上一次的 dist）
  console.log('构建中…');
  await new Promise((resolve, reject) => {
    const b = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: ROOT, stdio: 'ignore' });
    b.on('exit', c => (c === 0 ? resolve() : reject(new Error('vite build 失败，退出码 ' + c))));
  });

  // 2) 起 preview 服务
  const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const server = spawn(process.execPath, [viteBin, 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try { const r = await fetch(BASE); if (r.ok) { up = true; break; } } catch { /* retry */ }
  }
  if (!up) { server.kill(); console.error('预览服务启动失败: ' + BASE); process.exit(2); }

  PUPPETEER = (await import('puppeteer-core')).default;
  process.env.E2E_CHROME_PATH = chrome;
  const browser = await ensureBrowser();

  try {
    /* ============ G1 渲染与响应式 ============ */
    group('G1 渲染与响应式');
    for (const [id, w, h, mob] of [['G1.1', 1440, 900, false], ['G1.2', 768, 1024, true], ['G1.3', 390, 844, true], ['G1.4', 320, 568, true]]) {
      const p = await newPage(browser, w, h, mob);
      await openApp(p);
      const info = await p.evaluate(() => ({
        title: document.title,
        rendered: !!(document.getElementById('root') && document.getElementById('root').children.length),
        overflowX: document.documentElement.scrollWidth > window.innerWidth + 2,
      }));
      record(id, w + 'x' + h + ' 渲染正常、无横向溢出、console 干净',
        info.rendered && info.title.includes('家庭药箱') && !info.overflowX && p._logs.length === 0,
        JSON.stringify(info) + ' logs=' + JSON.stringify(p._logs.slice(0, 3)));
      if (id === 'G1.1' || id === 'G1.3') {
        const probe = () => p.evaluate(() => {
          const out = [];
          document.querySelectorAll('button,a,[role=button]').forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return;
            if (r.width < 24 || r.height < 24) out.push((el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 14) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
          });
          return out;
        });
        const home = await probe();
        await clickContains(p, '需补货'); await sleep(1400);
        const restock = await probe();
        await clickContains(p, '用药记录'); await sleep(1400);
        const logsView = await probe();
        const all = home.concat(restock, logsView);
        record(id + '-tap', '三个页面的点击目标均 ≥24x24（WCAG 2.5.8）',
          all.length === 0,
          'home=' + home.length + ' restock=' + restock.length + ' logs=' + logsView.length + ' 样例=' + JSON.stringify(all.slice(0, 5)));
      }
      await p.close();
    }

    /* ============ G2 核心业务链路 ============ */
    group('G2 核心业务链路');
    {
      const p = await newPage(browser, 1440, 900);
      await openApp(p);
      await addMed(p, 'E2E测试药', 10, '2027-12-31', '测试品牌');
      const d1 = await readDB(p);
      const med = (d1.medicines || []).find(m => m.name === 'E2E测试药') || {};
      record('G2.1', '入库：落库字段完整（名称/品牌/库存/效期）',
        med.total_quantity === 10 && med.brand === '测试品牌' && med.expiry_date === '2027-12-31', JSON.stringify(med).slice(0, 160));

      const cardShown = await p.evaluate(() => document.body.innerText.includes('E2E测试药'));
      record('G2.2', '入库后卡片立即出现在列表', cardShown);

      // 打卡
      await openDetailByName(p, 'E2E测试药');
      // 详情抽屉里的按钮是「打卡服药」（卡片上的才叫「吃药打卡」），这里限定在弹窗内匹配
      await p.waitForFunction(() => {
        const ds = Array.from(document.querySelectorAll('[role=dialog]'));
        const d = ds[ds.length - 1];
        return !!(d && Array.from(d.querySelectorAll('button')).some(b => /打卡|服药/.test((b.innerText || '').trim())));
      }, { timeout: 15000 });
      const take1 = await clickInDialogMatch(p, '打卡|服药'); await sleep(800);
      const take2 = await clickInDialogMatch(p, '^确认打卡$');
      const d2 = await waitDb(p, d => (d.logs || []).length >= 1);
      const med2 = (d2.medicines || []).find(m => m.name === 'E2E测试药') || {};
      record('G2.3', '打卡：库存减少且写入带品牌的用药记录',
        med2.total_quantity < 10 && (d2.logs || []).length >= 1 && d2.logs[d2.logs.length - 1].brand === '测试品牌',
        'qty=' + med2.total_quantity + ' logs=' + (d2.logs || []).length + ' brand=' + ((d2.logs || [])[0] || {}).brand + ' 点击=' + take1 + '/' + take2);
      await p.keyboard.press('Escape'); await sleep(400);

      // 搜索：名称 / 品牌 / 拼音首字母 / 空态
      await setInput(p, '搜索药品', 'E2E测试药'); await sleep(700);
      const hitName = await p.evaluate(() => document.body.innerText.includes('E2E测试药'));
      await setInput(p, '搜索药品', '测试品牌'); await sleep(700);
      const hitBrand = await p.evaluate(() => document.body.innerText.includes('E2E测试药'));
      await setInput(p, '搜索药品', 'blf'); await sleep(900);
      const pinyin = await p.evaluate(() => /布洛芬/.test(document.body.innerText));
      await setInput(p, '搜索药品', 'ZZZ不存在'); await sleep(700);
      const miss = await p.evaluate(() => ({ gone: !document.body.innerText.includes('E2E测试药'), empty: /没有找到相关药品/.test(document.body.innerText) }));
      record('G2.4', '搜索：名称/品牌/'+(String.fromCharCode(25340,38899))+ '首字母命中，无结果显示空态',
        hitName && hitBrand && pinyin && miss.gone && miss.empty,
        'name=' + hitName + ' brand=' + hitBrand + ' pinyin(blf->布洛芬)=' + pinyin + ' miss=' + JSON.stringify(miss));
      await setInput(p, '搜索药品', ''); await sleep(500);

      // 编辑：改效期为过期 → 自动进补货
      await openDetailByName(p, 'E2E测试药');
      await waitLabel(p, '编辑药品', 15000);
      await clickLabel(p, '编辑药品');
      await waitLabel(p, '保存修改', 15000);
      await setDate(p, '2020-01-01'); await sleep(300);
      await clickLabel(p, '保存修改');
      const d3 = await waitDb(p, d => (d.shoppingList || []).some(s => s.medicine_name === 'E2E测试药'));
      const it = (d3.shoppingList || []).find(s => s.medicine_name === 'E2E测试药') || {};
      record('G2.5', '编辑效期为过去 → 自动进入补货清单且条目带 medicine_id',
        !!it.medicine_name && !!it.medicine_id && String(it.medicine_id).length > 0,
        JSON.stringify(it).slice(0, 160));

      // 删除
      await openDetailByName(p, 'E2E测试药');
      await waitLabel(p, '删除药品', 15000);
      await clickLabel(p, '删除药品'); await sleep(800);
      await clickLabel(p, '确认删除').catch(() => {});
      await p.evaluate(() => { const x = Array.from(document.querySelectorAll('button')).find(y => /确认|删除/.test(y.innerText || '') && !/取消/.test(y.innerText || '')); if (x) x.click(); });
      const d4 = await waitDb(p, d => !(d.medicines || []).some(m => m.name === 'E2E测试药'));
      const gone = !(d4.medicines || []).some(m => m.name === 'E2E测试药');
      const orphan = (d4.shoppingList || []).filter(s => s.medicine_id && !(d4.medicines || []).some(m => String(m.id) === String(s.medicine_id)));
      record('G2.6', '删除：药品消失且不留孤儿补货条目', gone && orphan.length === 0, 'gone=' + gone + ' 孤儿条目=' + JSON.stringify(orphan.map(s => s.medicine_name)));
      record('G2.7', '全流程 console 无 error/warn', p._logs.length === 0, p._logs.slice(0, 3).join(' | '));
      await p.close();
    }

    /* ============ G3 数据安全与对抗 ============ */
    group('G3 数据安全与对抗');
    {
      const p = await newPage(browser, 1440, 900);
      await openApp(p);
      const before = await readDB(p);
      // 导出
      await p.evaluate(() => { const o = URL.createObjectURL; window.__blobs = []; URL.createObjectURL = x => { window.__blobs.push(x); return o(x); }; });
      await clickLabel(p, '数据备份与恢复'); await sleep(900);
      await p.evaluate(() => { const x = Array.from(document.querySelectorAll('button')).find(y => /导出/.test(y.innerText || '')); if (x) x.click(); });
      await sleep(1800);
      const blobText = await p.evaluate(async () => { const b = (window.__blobs || [])[0]; return b ? await b.text() : null; });
      let exported = null; try { exported = JSON.parse(blobText); } catch { /* ignore */ }
      record('G3.1', '导出：结构完整且 counts 与实际一致',
        !!exported && exported.version === 1 && exported.counts.medicines === (before.medicines || []).length,
        'keys=' + (exported ? Object.keys(exported).join(',') : 'null') + ' counts=' + JSON.stringify(exported && exported.counts));
      await p.evaluate(() => { const x = Array.from(document.querySelectorAll('[role=dialog] button')).find(y => (y.getAttribute('aria-label') || y.innerText || '').includes('关闭')); if (x) x.click(); });
      await sleep(500);

      const fsMod = fs;
      const tmp = os.tmpdir();
      const v999 = JSON.parse(blobText || '{}'); v999.version = 999;
      const fV999 = path.join(tmp, 'e2e-v999.json'); fsMod.writeFileSync(fV999, JSON.stringify(v999));
      const poison = JSON.parse(blobText || '{}');
      poison.data.medicines = [
        { id: 'z1', name: '投毒药', form_type: '片剂', category: '感冒药', location: '', total_quantity: -5, unit: '片', threshold: 5, expiry_date: '2026-02-30', last_purchase_date: '2024-13-45', symptoms_treated: '', dosage_instruction: '', daily_usage: 1, side_effects: '', usage_frequency_score: 0, image_url: 'javascript:alert(1)' },
        { id: 'z2', name: '<img src=x onerror=window.__xss=1>', form_type: '片剂', category: '感冒药', location: '', total_quantity: 3, unit: '片', threshold: 5, expiry_date: '2027-01-01', last_purchase_date: '2026-01-01', symptoms_treated: '', dosage_instruction: '', daily_usage: 1, side_effects: '', usage_frequency_score: 0, image_url: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==' },
      ];
      const fPoison = path.join(tmp, 'e2e-poison.json'); fsMod.writeFileSync(fPoison, JSON.stringify(poison));

      const doImport = async (file, mode) => {
        await clickLabel(p, '数据备份与恢复'); await sleep(900);
        if (mode === 'replace') { await p.evaluate(() => { const x = Array.from(document.querySelectorAll('button[role=radio]')).find(y => /覆盖恢复/.test(y.innerText || '')); if (x) x.click(); }); await sleep(250); }
        const input = await p.$('input[type=file]');
        if (!input) return { err: 'NO_FILE_INPUT' };
        await input.uploadFile(file); await sleep(800);
        await p.evaluate(() => { const x = Array.from(document.querySelectorAll('button')).filter(y => /导入|确认|恢复/.test(y.innerText || '') && !/取消|选择/.test(y.innerText || '')).pop(); if (x) x.click(); });
        await sleep(1800);
        await p.evaluate(() => { const x = Array.from(document.querySelectorAll('[role=dialog] button')).find(y => (y.getAttribute('aria-label') || y.innerText || '').includes('关闭')); if (x) x.click(); });
        await sleep(400);
        return { data: await readDB(p) };
      };

      // 未知版本
      const snapshot = await readDB(p);
      const r1 = await doImport(fV999, 'replace');
      const after1 = r1.data || await readDB(p);
      const unchanged = JSON.stringify((after1.medicines || []).map(m => m.id).sort()) === JSON.stringify((snapshot.medicines || []).map(m => m.id).sort());
      record('G3.2', '未知版本备份被拒绝，且现有数据未被改动', unchanged, 'meds=' + ((after1.medicines || []).length) + ' 与导入前一致=' + unchanged);

      // 投毒
      const r2 = await doImport(fPoison, 'replace');
      const after2 = r2.data || await readDB(p);
      const bad = after2.medicines || [];
      const xss = await p.evaluate(() => window.__xss === 1);
      const neg = bad.filter(m => !Number.isFinite(m.total_quantity) || m.total_quantity < 0).length;
      const badUrl = bad.filter(m => /^(javascript:|data:text)/.test(String(m.image_url || ''))).length;
      const badDate = bad.filter(m => m.expiry_date && !/^(19|20|21)\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(m.expiry_date)).length;
      record('G3.3', '投毒备份：XSS 不执行 / 负库存归零 / 危险 URL 丢弃 / 非法日期清洗',
        !xss && neg === 0 && badUrl === 0 && badDate === 0,
        'xss=' + xss + ' neg=' + neg + ' badUrl=' + badUrl + ' badDate=' + badDate + ' meds=' + JSON.stringify(bad.map(m => m.name.slice(0, 10) + ':q' + m.total_quantity + ':' + m.expiry_date)));

      // 存储损坏
      await p.evaluate(k => localStorage.setItem(k, '{ broken'), DB_KEY);
      await p.reload({ waitUntil: 'domcontentloaded' }); await sleep(1800);
      const corrupt = await p.evaluate(k => ({
        err: /读取失败/.test(document.body.innerText),
        raw: (localStorage.getItem(k) || '').includes('broken'),
        rendered: !!(document.getElementById('root') && document.getElementById('root').children.length),
      }), DB_KEY);
      await p.evaluate(() => { const o = URL.createObjectURL; window.__blobs = []; URL.createObjectURL = x => { window.__blobs.push(x); return o(x); }; });
      await clickLabel(p, '数据备份与恢复'); await sleep(1000);
      await p.evaluate(() => { const x = Array.from(document.querySelectorAll('button')).find(y => /导出/.test(y.innerText || '')); if (x) x.click(); });
      await sleep(1600);
      const nBlobs = await p.evaluate(() => (window.__blobs || []).length);
      record('G3.4', '存储损坏：页面仍可用 + 有错误提示 + 原文未被覆盖 + 不导出空备份',
        corrupt.rendered && corrupt.err && corrupt.raw && nBlobs === 0,
        JSON.stringify(corrupt) + ' 导出 blob 数=' + nBlobs);
      await p.close();
    }

    /* ============ G4 无障碍与键盘 ============ */
    group('G4 无障碍与键盘');
    {
      const p = await newPage(browser, 1440, 900);
      await openApp(p);
      await realClick(p, '入库新药');
      await p.waitForSelector('[role=dialog]', { timeout: 15000 }); await sleep(1000);
      const f1 = await activeInfo(p);
      record('G4.1', '弹窗打开即聚焦第一个输入框', f1.inside && f1.type === 'text' && /药品名称/.test(f1.label), JSON.stringify(f1));
      let esc = 0;
      for (let i = 0; i < 15; i++) { await p.keyboard.press('Tab'); const ins = await p.evaluate(() => { const d = document.querySelector('[role=dialog]'); const a = document.activeElement; return !!(d && a && d.contains(a)); }); if (!ins) esc++; }
      record('G4.2', 'Tab 15 次焦点不逃逸出弹窗', esc === 0, '逃逸 ' + esc + ' 次');
      await p.keyboard.press('Escape'); await sleep(400);
      const stillOpen = await p.evaluate(() => !!document.querySelector('[role=dialog]'));
      record('G4.3', '编辑表单不响应 Escape（刻意设计，防误触丢内容）', stillOpen === true, '弹窗仍在=' + stillOpen);
      await p.evaluate(() => { const x = document.querySelector('[role=dialog] button[aria-label="关闭"]'); if (x) x.click(); });
      await sleep(600);
      const back = await p.evaluate(() => (document.activeElement && (document.activeElement.innerText || document.activeElement.getAttribute('aria-label')) || '').trim());
      record('G4.4', '关闭弹窗后焦点归位到触发按钮', /入库新药/.test(back), '焦点=' + back);

      // 抽屉
      await openDetailByName(p, '布洛芬');
      await sleep(1600);
      const f2 = await activeInfo(p);
      record('G4.5', '详情抽屉：焦点落在对话框容器（读屏先读标题）', f2.isPanel, JSON.stringify(f2));
      let esc2 = 0;
      for (let i = 0; i < 12; i++) { await p.keyboard.press('Tab'); const ins = await p.evaluate(() => { const d = document.querySelector('[role=dialog]'); const a = document.activeElement; return !!(d && a && d.contains(a)); }); if (!ins) esc2++; }
      record('G4.6', '抽屉内 Tab 12 次不逃逸', esc2 === 0, '逃逸 ' + esc2 + ' 次');
      await p.keyboard.press('Escape'); await sleep(700);
      const afterEsc = await p.evaluate(() => ({ closed: !document.querySelector('[role=dialog]'), focused: (document.activeElement && document.activeElement.innerText || '').trim().slice(0, 16) }));
      record('G4.7', 'Escape 关闭抽屉且焦点归位', afterEsc.closed && afterEsc.focused.length > 0, JSON.stringify(afterEsc));

      // 静态无障碍检查
      const a11y = await p.evaluate(() => {
        const noLabelBtn = [];
        document.querySelectorAll('button').forEach(b => {
          const t = (b.innerText || '').trim();
          if (!t && !b.getAttribute('aria-label') && !b.getAttribute('title')) noLabelBtn.push(b.className.slice(0, 40));
        });
        const noLabelInput = [];
        document.querySelectorAll('input,select,textarea').forEach(i => {
          const lab = (i.labels && i.labels[0]) || i.getAttribute('aria-label') || i.getAttribute('placeholder');
          if (!lab) noLabelInput.push(i.type + '/' + i.className.slice(0, 30));
        });
        const noAltImg = Array.from(document.querySelectorAll('img')).filter(i => i.getAttribute('alt') === null).length;
        return { noLabelBtn: noLabelBtn.length, noLabelInput: noLabelInput.length, noAltImg, samples: noLabelBtn.slice(0, 3).concat(noLabelInput.slice(0, 3)) };
      });
      record('G4.8', '图标按钮有 aria-label / 表单控件有 label / 图片有 alt',
        a11y.noLabelBtn === 0 && a11y.noLabelInput === 0 && a11y.noAltImg === 0, JSON.stringify(a11y));
      record('G4.9', '无障碍测试全程 console 无报错', p._logs.length === 0, p._logs.slice(0, 3).join(' | '));
      await p.close();
    }

    /* ============ G5 PWA 与离线 ============ */
    group('G5 PWA 与离线');
    {
      const p = await newPage(browser, 390, 844, true);
      await openApp(p);
      const client = await p.target().createCDPSession();
      await client.send('Page.enable');
      const mf = await client.send('Page.getAppManifest').catch(e => ({ errors: [{ message: String(e) }] }));
      const mfErrors = (mf.errors || []).map(e => e.message || JSON.stringify(e));
      record('G5.1', 'manifest 被浏览器解析且无错误', mfErrors.length === 0 && !!mf.data, 'errors=' + JSON.stringify(mfErrors.slice(0, 3)));
      await sleep(2500);
      const sw = await p.evaluate(async () => {
        const r = await navigator.serviceWorker.getRegistration();
        const keys = await caches.keys();
        return { active: !!(r && r.active), caches: keys };
      });
      record('G5.2', 'Service Worker 已激活且缓存版本为 medicine-box-v2', sw.active && sw.caches.includes('medicine-box-v2'), JSON.stringify(sw));
      await p.reload({ waitUntil: 'domcontentloaded' }); await sleep(1500);
      await p.setOfflineMode(true);
      let offlineOk = false;
      try { await p.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }); await sleep(1200); offlineOk = await p.evaluate(() => !!(document.getElementById('root') && document.getElementById('root').children.length)); } catch { offlineOk = false; }
      await p.setOfflineMode(false);
      record('G5.3', '断网后仍能打开（离线外壳生效）', offlineOk, 'offlineRendered=' + offlineOk);
      await p.close();
    }

    /* ============ G6 布局回归 ============ */
    group('G6 布局回归（卡片一致性）');
    {
      const p = await newPage(browser, 390, 844, true);
      await openApp(p);
      await sleep(800);
      const rows = await p.evaluate(() => {
        const out = [];
        document.querySelectorAll('section').forEach(sec => {
          const h = sec.querySelector('h2'); if (!h) return;
          const divs = Array.from(sec.querySelectorAll(':scope > div')).filter(d => getComputedStyle(d).display !== 'none');
          const mob = divs[divs.length - 1]; if (!mob) return;
          const cards = Array.from(mob.children).filter(c => c.getBoundingClientRect().height > 0);
          if (!cards.length) return;
          const cw = mob.clientWidth;
          out.push({
            cat: h.innerText.trim().replace(/\d+$/, ''),
            ratio: Number(Math.max(...cards.map(c => c.getBoundingClientRect().width / cw)).toFixed(2)),
            grid: getComputedStyle(mob).gridTemplateColumns,
            text: (cards[0].innerText || '').replace(/\n+/g, ' ').slice(0, 60),
          });
        });
        return out;
      });
      const bad = rows.filter(r => r.ratio <= 0.9 || r.grid !== 'none');
      record('G6.1', '全部类别在移动端均为单列大卡（共 ' + rows.length + ' 类）', rows.length > 5 && bad.length === 0,
        '异常=' + JSON.stringify(bad.map(b => b.cat + ':' + b.ratio)));
      const topical = rows.find(r => /外用/.test(r.cat));
      const device = rows.find(r => /器械/.test(r.cat));
      record('G6.2', '外用药/医疗器械的卡片信息与其他类别一致（含库存与效期）',
        !!topical && /库存|剩余/.test(topical.text) && !!device && /库存|剩余/.test(device.text),
        '外用药卡片=' + (topical ? topical.text : '未渲染') + ' | 器械=' + (device ? device.text : '未渲染'));
      await p.close();
    }

    /* ============ G7 稳定性 ============ */
    group('G7 稳定性（弱网/异常不白屏）');
    {
      // 7.1 演示数据请求挂死
      const p1 = await newPage(browser, 390, 844, true);
      const c1 = await p1.target().createCDPSession();
      await c1.send('Fetch.enable', { patterns: [{ urlPattern: '*demo-backup.json*' }] });
      c1.on('Fetch.requestPaused', () => { /* 故意不响应 */ });
      const t0 = Date.now();
      await p1.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      let rendered = false, ms = 0;
      for (let i = 0; i < 25; i++) { await sleep(300); rendered = await p1.evaluate(() => !!(document.getElementById('root') && document.getElementById('root').children.length)); if (rendered) { ms = Date.now() - t0; break; } }
      record('G7.1', '演示数据请求挂死时页面仍在 6 秒内渲染（不白屏）', rendered && ms < 6000, '渲染=' + rendered + ' 用时=' + ms + 'ms');
      await p1.close();

      // 7.2 分块加载失败
      // Tab 视图已改回静态加载，仍按需加载的是"详情抽屉/备份弹窗"这类交互型分块
      const p2 = await newPage(browser, 390, 844, true);
      // 必须在打开页面之前就屏蔽：否则空闲预热（requestIdleCallback）会先把分块下载好，
      // 屏蔽就失去意义了 —— 这也从侧面证明预热确实生效。
      const c2 = await p2.target().createCDPSession();
      await c2.send('Network.enable');
      await c2.send('Network.setBlockedURLs', { urls: ['*DetailDrawer-*.js'] });
      await openApp(p2);
      await openDetailByName(p2, '布洛芬');
      await sleep(6000);
      const st = await p2.evaluate(() => ({
        len: document.body.innerText.trim().length,
        hasRetry: /重试/.test(document.body.innerText),
        hasFail: /加载失败/.test(document.body.innerText),
        navAlive: /我的药箱/.test(document.body.innerText),
      }));
      record('G7.2', '按需分块加载失败 → 显示「加载失败+重试」而非白屏', st.len > 30 && st.hasRetry && st.hasFail && st.navAlive, JSON.stringify(st));
      await p2.close();

      // 7.3 反复切换页签/筛选
      const p3 = await newPage(browser, 1440, 900);
      await openApp(p3);
      for (let i = 0; i < 6; i++) {
        await clickContains(p3, '需补货'); await sleep(500);
        await clickContains(p3, '用药记录'); await sleep(500);
        await clickContains(p3, '我的药箱'); await sleep(500);
      }
      const stable = await p3.evaluate(() => !!(document.getElementById('root') && document.getElementById('root').children.length));
      record('G7.3', '连续切换页签 18 次仍稳定且无报错', stable && p3._logs.length === 0, 'stable=' + stable + ' logs=' + JSON.stringify(p3._logs.slice(0, 3)));
      await p3.close();
    }

    /* ============ G8 历史缺陷回归墙 ============ */
    group('G8 历史缺陷回归墙（每个真实缺陷一条）');
    {
      const p = await newPage(browser, 390, 844, true);
      await openApp(p);

      // BUG-03 已过期天数
      await p.evaluate((k, v) => { const d = JSON.parse(localStorage.getItem(k)); d.medicines.find(x => x.brand === '珠海联邦').expiry_date = v; localStorage.setItem(k, JSON.stringify(d)); }, DB_KEY, '2024-09-10');
      await p.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
      const seg = await p.evaluate(() => { const m = document.body.innerText.match(/珠海联邦[\s\S]{0,60}/); return m ? m[0].replace(/\n+/g, ' | ') : ''; });
      record('BUG-03', '「已过期 N 天」天数正确（2024-09-10 → 730 天）', /已过期 730 天/.test(seg), seg.slice(0, 90));

      // BUG-04 空箱评级
      await p.evaluate(k => localStorage.setItem(k, JSON.stringify({ medicines: [], shoppingList: [], logs: [] })), DB_KEY);
      await p.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
      const emptyTxt = await p.evaluate(() => document.body.innerText);
      record('BUG-04', '空箱不出现「100% 达标」误导评级', !/100%\s*达标/.test(emptyTxt), '含 100% 达标=' + /100%\s*达标/.test(emptyTxt));

      // BUG-10 焦点进输入框
      await p.setViewport({ width: 1440, height: 900 });
      await p.reload({ waitUntil: 'domcontentloaded' }); await sleep(2000);
      await realClick(p, '入库新药');
      await p.waitForSelector('[role=dialog]', { timeout: 15000 }); await sleep(900);
      const fi = await activeInfo(p);
      record('BUG-10', '点「入库新药」焦点落在第一个输入框', fi.inside && fi.type === 'text', JSON.stringify(fi));

      // BUG-07 非法日历日期不得渲染成「已过期 NaN 天」
      await p.evaluate(k => { const d = JSON.parse(localStorage.getItem(k)); d.medicines[0].expiry_date = '2024-13-45'; localStorage.setItem(k, JSON.stringify(d)); }, DB_KEY);
      await p.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200);
      const nanTxt = await p.evaluate(() => document.body.innerText);
      record('BUG-07', '非法日历日期（2024-13-45）不出现 NaN / Invalid Date', !/NaN|Invalid Date/.test(nanTxt), '含 NaN=' + /NaN/.test(nanTxt));

      // BUG-11 外用药/器械不再双列（必须先切回手机视口：上一条把视口改成了桌面，
      // 桌面本来是多列网格，不切回来会误判）
      await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
      await p.reload({ waitUntil: 'domcontentloaded' }); await sleep(2000);
      const layout = await p.evaluate(() => {
        const out = [];
        document.querySelectorAll('section').forEach(sec => {
          const h = sec.querySelector('h2'); if (!h || !/外用|器械/.test(h.innerText)) return;
          const divs = Array.from(sec.querySelectorAll(':scope > div')).filter(d => getComputedStyle(d).display !== 'none');
          const mob = divs[divs.length - 1]; if (!mob) return;
          const cards = Array.from(mob.children).filter(c => c.getBoundingClientRect().height > 0);
          if (!cards.length) return;
          out.push(h.innerText.trim().replace(/d+$/, '') + ':' + (Math.max(...cards.map(c => c.getBoundingClientRect().width / mob.clientWidth))).toFixed(2));
        });
        return out;
      });
      record('BUG-11', '外用药/医疗器械为单列大卡（宽度占比 >0.9）', layout.length > 0 && layout.every(x => Number(x.split(':')[1]) > 0.9), JSON.stringify(layout));
      await p.close();

      // BUG-01 / BUG-02 / BUG-06：同名不同品牌的核销与删除、写失败可见（桌面）
      const q = await newPage(browser, 1440, 900);
      await openApp(q);
      const seed = await readDB(q);
      const yi = (seed.medicines || []).find(m => m.brand === '珠海联邦');
      const jia = (seed.medicines || []).find(m => m.brand === '华北制药');
      record('BUG-01-前置', '演示数据含同名双品牌（阿莫西林 华北制药/珠海联邦）', !!yi && !!jia, 'yi=' + !!yi + ' jia=' + !!jia);

      if (yi && jia) {
        // BUG-01：把珠海联邦改成过期 → 补货 → 只动它
        await q.evaluate((k, id) => { const d = JSON.parse(localStorage.getItem(k)); d.medicines.find(m => String(m.id) === String(id)).expiry_date = '2020-01-01'; localStorage.setItem(k, JSON.stringify(d)); }, DB_KEY, yi.id);
        await q.reload({ waitUntil: 'domcontentloaded' }); await sleep(2000);
        await clickContains(q, '需补货'); await sleep(2000);
        const opened = await q.evaluate(() => {
          const cards = Array.from(document.querySelectorAll('div')).filter(d => /阿莫西林胶囊/.test(d.innerText || '') && /已买入/.test(d.innerText || '') && d.querySelector('button'));
          const card = cards.sort((a, b) => a.innerText.length - b.innerText.length)[0];
          if (!card) return false;
          const btn = Array.from(card.querySelectorAll('button')).find(x => /已买入/.test(x.innerText || ''));
          if (!btn) return false; btn.click(); return true;
        });
        await sleep(1500);
        await q.evaluate(() => { const el = Array.from(document.querySelectorAll('input[type=number]')).find(i => (i.labels && i.labels[0] ? i.labels[0].innerText : '').includes('新购入数量')); if (el) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '50'); el.dispatchEvent(new Event('input', { bubbles: true })); } });
        await sleep(300);
        await clickLabel(q, '确认更新');
        const after = await waitDb(q, d => (d.medicines || []).some(m => m.brand === '珠海联邦' && m.total_quantity === 50), 8000);
        const yi2 = (after.medicines || []).find(m => m.brand === '珠海联邦') || {};
        const jia2 = (after.medicines || []).find(m => m.brand === '华北制药') || {};
        record('BUG-01', '补货核销精确命中同名中的那一条（珠海联邦→50，华北制药不动）',
          yi2.total_quantity === 50 && jia2.total_quantity === jia.total_quantity && jia2.expiry_date === jia.expiry_date,
          '珠海联邦=' + yi2.total_quantity + ' 华北制药=' + jia2.total_quantity + '(原' + jia.total_quantity + ') 打开登记=' + opened);

        // BUG-02：让两条同名都过期 → 删除其一 → 另一条的提醒必须还在
        await q.evaluate((k, ji) => { const d = JSON.parse(localStorage.getItem(k)); const m = d.medicines.find(x => String(x.id) === String(ji)); m.expiry_date = '2020-01-01'; localStorage.setItem(k, JSON.stringify(d)); }, DB_KEY, jia.id);
        await q.reload({ waitUntil: 'domcontentloaded' }); await sleep(2200);
        const seeded = await readDB(q);
        const reminders = (seeded.shoppingList || []).filter(s => s.medicine_name === '阿莫西林胶囊');
        // 删除珠海联邦
        await openDetailByName(q, '阿莫西林胶囊', '珠海联邦');
        await waitLabel(q, '删除药品', 15000);
        await clickLabel(q, '删除药品'); await sleep(900);
        await q.evaluate(() => { const x = Array.from(document.querySelectorAll('button')).find(y => /确认|删除/.test(y.innerText || '') && !/取消/.test(y.innerText || '')); if (x) x.click(); });
        await sleep(2200);
        const afterDel = await readDB(q);
        const stillHasJia = (afterDel.medicines || []).some(m => m.brand === '华北制药');
        const jiaReminder = (afterDel.shoppingList || []).some(s => s.medicine_name === '阿莫西林胶囊' && (String(s.medicine_id || '') === String(jia.id) || s.brand === '华北制药'));
        record('BUG-02', '删除同名中的一条，不动另一条的药品与补货提醒',
          stillHasJia && (reminders.length >= 2 ? jiaReminder : true),
          '删除前同名提醒=' + reminders.length + ' 华北制药仍在=' + stillHasJia + ' 其提醒仍在=' + jiaReminder);

        // BUG-06：写失败必须可见，不得假装成功
        const before = await readDB(q);
        await q.evaluate(k => { const orig = Storage.prototype.setItem; Storage.prototype.setItem = function (key, val) { if (String(key) === k) throw new DOMException('QuotaExceededError'); return orig.call(this, key, val); }; }, DB_KEY);
        await clickLabel(q, '入库新药');
        await q.waitForSelector('[role=dialog]', { timeout: 15000 }); await sleep(500);
        await setInput(q, '药品名称', '写失败测试药');
        await setInput(q, '初始入库数量', '3');
        await setDate(q, '2027-12-31'); await sleep(300);
        await clickLabel(q, '确认入库');
        await sleep(1800);
        const afterFail = await readDB(q);
        const notWritten = !(afterFail.medicines || []).some(m => m.name === '写失败测试药');
        const visible = await q.evaluate(() => ({ dlgOpen: !!document.querySelector('[role=dialog]'), toast: /失败|错误|未能|空间/.test(document.body.innerText), onCard: document.body.innerText.includes('写失败测试药') }));
        record('BUG-06', '写失败（配额满）：数据未落库 + 界面有失败提示 + 不假装成功',
          notWritten && !visible.onCard && (visible.toast || visible.dlgOpen),
          '未落库=' + notWritten + ' 卡片未出现=' + !visible.onCard + ' 提示=' + JSON.stringify(visible) + ' 药品数 ' + (before.medicines || []).length + '→' + (afterFail.medicines || []).length);
      }
      await q.close();
    }

    /* ============ G9 本轮修复（补货规则 / 加载速度 / 默认剂量 / 日期选择器） ============ */
    group('G9 本轮修复验证');
    {
      // G9.1 补货清单只剩"过期/用尽"：注入一条历史"手动添加"条目 + 一条规则内条目
      const p = await newPage(browser, 1440, 900);
      await openApp(p);
      await p.evaluate(k => {
        const d = JSON.parse(localStorage.getItem(k));
        d.shoppingList.push({ id: 'e2e-manual', medicine_name: '感冒灵颗粒', reason: '手动添加', status: 'pending', created_at: new Date().toISOString() });
        localStorage.setItem(k, JSON.stringify(d));
      }, DB_KEY);
      await p.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
      const dbAfter = await readDB(p);
      const reasons = Array.from(new Set((dbAfter.shoppingList || []).map(s => s.reason)));
      record('G9.1', '补货清单只保留「过期/用尽」，历史"手动添加"条目被自动清理',
        !reasons.includes('手动添加') && reasons.every(r => r === '过期' || r === '用尽'),
        '清单原因集合=' + JSON.stringify(reasons) + ' 条数=' + (dbAfter.shoppingList || []).length);

      // G9.2 卡片/抽屉不再有手动加购入口
      const manualBtns = await p.evaluate(() => {
        const texts = Array.from(document.querySelectorAll('button,[role=button]')).map(e => (e.innerText || '').trim());
        return texts.filter(t => /加入待购|清理提醒|加入补货|补货标记|一键生成采购单/.test(t));
      });
      record('G9.2', '卡片与详情不再提供"手动加入补货清单"入口', manualBtns.length === 0, JSON.stringify(manualBtns));

      // G9.3 需补货页打开速度（此前要等按需分块下载）
      const t0 = Date.now();
      await clickContains(p, '需补货');
      await p.waitForFunction(() => document.body.innerText.includes('需补货清单'), { timeout: 8000 });
      const ms = Date.now() - t0;
      record('G9.3', '点「需补货」在 1 秒内出内容（不再是"加载很长时间"）', ms < 1000, '耗时 ' + ms + 'ms');
      const noPurchaseBtn = await p.evaluate(() => !/一键生成采购单/.test(document.body.innerText));
      record('G9.4', '「一键生成采购单」按钮已移除', noPurchaseBtn);

      // G9.5 打卡默认数量 = 入库时的「每次用量」
      await p.evaluate(k => {
        const d = JSON.parse(localStorage.getItem(k));
        // ① 显式 dose_per_time=2；② 只有文案（旧数据）→ 应从"每次3粒"解析出 3
        d.medicines.push({ id: 'e2e-dose-1', name: '每次两片药', form_type: '片剂', category: '其他', location: '', total_quantity: 10, unit: '片', threshold: 1, expiry_date: '2027-12-31', last_purchase_date: '2026-09-01', symptoms_treated: '', dosage_instruction: '每日2次，每次2片', daily_usage: 4, dose_per_time: 2, side_effects: '', usage_frequency_score: 0 });
        d.medicines.push({ id: 'e2e-dose-2', name: '旧数据每次三粒', form_type: '胶囊', category: '其他', location: '', total_quantity: 10, unit: '粒', threshold: 1, expiry_date: '2027-12-31', last_purchase_date: '2026-09-01', symptoms_treated: '', dosage_instruction: '每日3次，每次3粒', daily_usage: 9, side_effects: '', usage_frequency_score: 0 });
        localStorage.setItem(k, JSON.stringify(d));
      }, DB_KEY);
      await p.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
      const doseExplicit = await p.evaluate(async () => {
        const card = Array.from(document.querySelectorAll('button')).filter(b => (b.innerText || '').trim() === '详情')
          .map(b => { let el = b; for (let i = 0; i < 8 && el; i++, el = el.parentElement) { const t = el.innerText || ''; if (t.includes('每次两片药')) return { b, len: t.length }; } return null; })
          .filter(Boolean).sort((x, y) => x.len - y.len).map(x => x.b)[0];
        if (!card) return 'NO_CARD';
        card.click();
        await new Promise(r => setTimeout(r, 1200));
        const ds = Array.from(document.querySelectorAll('[role=dialog]'));
        const d = ds[ds.length - 1];
        const btn = d && Array.from(d.querySelectorAll('button')).find(b => /打卡|服药/.test((b.innerText || '').trim()));
        if (!btn) return 'NO_BTN';
        btn.click();
        await new Promise(r => setTimeout(r, 900));
        const ds2 = Array.from(document.querySelectorAll('[role=dialog]'));
        const d2 = ds2[ds2.length - 1];
        const big = d2 ? d2.querySelector('.text-4xl') : null;
        return big ? (big.textContent || '').trim() : 'NO_NUM:' + (d2 ? d2.innerText.slice(0, 40) : 'none');
      });
      record('G9.5', '打卡弹窗默认数量取「每次用量」（显式字段=2）', doseExplicit === '2', '实际显示=' + doseExplicit);
      await p.keyboard.press('Escape'); await sleep(600);

      const doseParsed = await p.evaluate(async () => {
        const card = Array.from(document.querySelectorAll('button')).filter(b => (b.innerText || '').trim() === '详情')
          .map(b => { let el = b; for (let i = 0; i < 8 && el; i++, el = el.parentElement) { const t = el.innerText || ''; if (t.includes('旧数据每次三粒')) return { b, len: t.length }; } return null; })
          .filter(Boolean).sort((x, y) => x.len - y.len).map(x => x.b)[0];
        if (!card) return 'NO_CARD';
        card.click();
        await new Promise(r => setTimeout(r, 1200));
        const ds = Array.from(document.querySelectorAll('[role=dialog]'));
        const d = ds[ds.length - 1];
        const btn = d && Array.from(d.querySelectorAll('button')).find(b => /打卡|服药/.test((b.innerText || '').trim()));
        if (!btn) return 'NO_BTN';
        btn.click();
        await new Promise(r => setTimeout(r, 900));
        const ds2 = Array.from(document.querySelectorAll('[role=dialog]'));
        const d2 = ds2[ds2.length - 1];
        const big = d2 ? d2.querySelector('.text-4xl') : null;
        return big ? (big.textContent || '').trim() : 'NO_NUM';
      });
      record('G9.6', '旧数据（无该字段）从"每次3粒"解析出默认 3', doseParsed === '3', '实际显示=' + doseParsed);
      await p.keyboard.press('Escape'); await sleep(600);

      // G9.7 日期选择器：年份一键跳转
      // 先把前面打开的弹窗/抽屉都关掉：真实鼠标点击会被遮罩挡住
      for (let i = 0; i < 4; i++) {
        if (!(await p.evaluate(() => !!document.querySelector('[role=dialog]')))) break;
        await p.keyboard.press('Escape');
        await sleep(500);
      }
      await realClick(p, '入库新药');
      await p.waitForSelector('[role=dialog]', { timeout: 15000 }); await sleep(800);
      const opened = await p.evaluate(() => {
        const ds = Array.from(document.querySelectorAll('[role=dialog]'));
        const d = ds[ds.length - 1];
        const btn = d && Array.from(d.querySelectorAll('button')).find(b => (b.getAttribute('aria-label') || '') === '有效截止日期');
        if (!btn) return 'NO_TRIGGER';
        btn.click(); return 'ok';
      });
      await sleep(600);
      const yearJump = await p.evaluate(() => {
        const yb = Array.from(document.querySelectorAll('button')).find(b => (b.getAttribute('aria-label') || '') === '选择年份');
        if (!yb) return 'NO_YEAR_BTN';
        yb.click();
        return 'clicked:' + (yb.innerText || '').trim();
      });
      await sleep(500);
      const yearPicked = await p.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button')).filter(b => /^\d{4}$/.test((b.innerText || '').trim()));
        const target = btns.find(b => (b.innerText || '').trim() === '2030') || btns[3];
        if (!target) return 'NO_YEAR_CELL';
        const y = (target.innerText || '').trim();
        target.click();
        return y;
      });
      await sleep(500);
      const dayPicked = await p.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button')).filter(b => /^\d{4}-\d{2}-\d{2}$/.test(b.getAttribute('aria-label') || ''));
        const t = btns.find(b => (b.getAttribute('aria-label') || '').endsWith('-15')) || btns[14];
        if (!t) return 'NO_DAY_CELL';
        const v = t.getAttribute('aria-label');
        t.click();
        return v;
      });
      await sleep(600);
      const shown = await p.evaluate(() => {
        const ds = Array.from(document.querySelectorAll('[role=dialog]'));
        const d = ds[ds.length - 1];
        const btn = d && Array.from(d.querySelectorAll('button')).find(b => (b.getAttribute('aria-label') || '') === '有效截止日期');
        return btn ? (btn.innerText || '').trim() : 'NO_TRIGGER';
      });
      // G9.8 日期面板不得撑出横向滚动（手机右列字段尤甚，老板反馈过"要往左滑"）
      for (const [vw, vh] of [[390, 844], [360, 640], [768, 1024], [1440, 900]]) {
        const vp = await newPage(browser, vw, vh, vw < 500);
        await openApp(vp);
        const geo = await vp.evaluate(async () => {
          const add = Array.from(document.querySelectorAll('button,[role=button]'))
            .find(x => (((x.innerText || '') + ' ' + (x.getAttribute('aria-label') || '')).trim()) === '入库新药');
          if (!add) return { err: 'NO_ADD_BTN' };
          add.click();
          await new Promise(r => setTimeout(r, 1300));
          const ds = Array.from(document.querySelectorAll('[role=dialog]'));
          const modal = ds[ds.length - 1];
          const trg = modal && Array.from(modal.querySelectorAll('button')).find(x => (x.getAttribute('aria-label') || '') === '有效截止日期');
          if (!trg) return { err: 'NO_TRIGGER' };
          trg.click();
          await new Promise(r => setTimeout(r, 600));
          const panel = document.querySelector('[role=dialog][aria-label^="有效截止日期"]');
          const pr = panel ? panel.getBoundingClientRect() : null;
          return {
            win: window.innerWidth, winH: window.innerHeight,
            docScroll: document.documentElement.scrollWidth,
            modalScroll: modal.scrollWidth, modalClient: modal.clientWidth,
            pLeft: pr ? Math.round(pr.left) : -1, pRight: pr ? Math.round(pr.right) : -1,
            pTop: pr ? Math.round(pr.top) : -1, pBottom: pr ? Math.round(pr.bottom) : -1,
          };
        });
        // 关键：既不横向溢出，也不纵向超出屏幕（老板要求"不用滚动就能看全"）
        const ok = !geo.err && geo.docScroll <= geo.win + 1 && geo.modalScroll <= geo.modalClient + 1
          && geo.pLeft >= 0 && geo.pRight <= geo.win && geo.pTop >= 0 && geo.pBottom <= geo.winH;
        record('G9.8-' + vw, vw + 'x' + vh + ' 日期弹层完整可见（横向不溢出、纵向不用滚动）', ok, JSON.stringify(geo));
        await vp.close();
      }

      // G9.9 独立弹层的焦点与滚动行为（Portal 到 body 后必须自管焦点；且不得把表单顶走）
      {
        const dp = await newPage(browser, 390, 844, true);
        await openApp(dp);
        await dp.evaluate(() => {
          const add = Array.from(document.querySelectorAll('button,[role=button]'))
            .find(x => (((x.innerText || '') + ' ' + (x.getAttribute('aria-label') || '')).trim()) === '入库新药');
          if (add) add.click();
        });
        await dp.waitForSelector('[role=dialog]', { timeout: 15000 }); await sleep(900);
        const scrollBefore = await dp.evaluate(() => {
          const ds = Array.from(document.querySelectorAll('[role=dialog]'));
          const modal = ds[ds.length - 1];
          return modal ? modal.scrollTop : -1;
        });
        // 用真实鼠标点击触发器：合成 .click() 不会让按钮获得焦点，焦点归位就无从谈起
        await realClickByAria(dp, '有效截止日期');
        await sleep(800);
        const focusInfo = await dp.evaluate(async (scrollBefore) => {
          const ds = Array.from(document.querySelectorAll('[role=dialog]'));
          const modal = ds[ds.length - 1];
          const picker = document.querySelector('[role=dialog][aria-label^="有效截止日期"]');
          const a = document.activeElement;
          const focusedInside = !!(picker && a && picker.contains(a));
          return { focusedInside, scrollBefore, scrollAfterOpen: modal.scrollTop, modalFound: !!modal, pickerFound: !!picker };
        }, scrollBefore);
        // Tab 十次是否仍在弹层内
        let escapes = 0;
        for (let i = 0; i < 10; i++) {
          await dp.keyboard.press('Tab');
          const inside = await dp.evaluate(() => {
            const picker = document.querySelector('[role=dialog][aria-label^="有效截止日期"]');
            const a = document.activeElement;
            return !!(picker && a && picker.contains(a));
          });
          if (!inside) escapes++;
        }
        await dp.keyboard.press('Escape'); await sleep(600);
        const after = await dp.evaluate(() => {
          const picker = document.querySelector('[role=dialog][aria-label^="有效截止日期"]');
          const a = document.activeElement;
          return { closed: !picker, focusedLabel: a ? (a.getAttribute('aria-label') || (a.innerText || '').trim().slice(0, 12)) : 'none' };
        });
        record('G9.9', '日期弹层：打开即聚焦弹层内 / Tab 不逃逸 / Esc 关闭且焦点归位 / 不顶动表单',
          !focusInfo.err && focusInfo.focusedInside && escapes === 0 && after.closed && /有效截止日期/.test(after.focusedLabel)
            && focusInfo.scrollBefore === focusInfo.scrollAfterOpen,
          JSON.stringify({ ...focusInfo, escapes, after }));
        await dp.close();
      }

      // G9.10 弹层尺寸稳定：不同月份行数不同（4~6 行）、日/月/年视图切换，都不应改变高度
      {
        const sp = await newPage(browser, 390, 844, true);
        await openApp(sp);
        await sp.evaluate(() => {
          const add = Array.from(document.querySelectorAll('button,[role=button]'))
            .find(x => (((x.innerText || '') + ' ' + (x.getAttribute('aria-label') || '')).trim()) === '入库新药');
          if (add) add.click();
        });
        await sp.waitForSelector('[role=dialog]', { timeout: 15000 }); await sleep(900);
        await realClickByAria(sp, '有效截止日期');
        await sleep(800);
        const heights = [];
        const measure = () => sp.evaluate(() => {
          const el = document.querySelector('[role=dialog][aria-label^="有效截止日期"]');
          return el ? Math.round(el.getBoundingClientRect().height) : -1;
        });
        heights.push(await measure());
        // 连续翻 8 个月（覆盖 28/29/30/31 天与不同起始星期的组合）
        for (let i = 0; i < 8; i++) {
          await sp.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find(x => (x.getAttribute('aria-label') || '') === '下一页'); if (b) b.click(); });
          await sleep(280);
          heights.push(await measure());
        }
        // 年月视图
        await sp.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find(x => (x.getAttribute('aria-label') || '') === '选择年份'); if (b) b.click(); });
        await sleep(350); heights.push(await measure());
        await sp.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find(x => (x.innerText || '').trim() === '2030'); if (b) b.click(); });
        await sleep(350);
        await sp.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find(x => (x.getAttribute('aria-label') || '') === '选择月份'); if (b) b.click(); });
        await sleep(350); heights.push(await measure());
        const min = Math.min(...heights);
        const max = Math.max(...heights);
        record('G9.10', '日期弹层高度恒定（翻月 + 年月视图切换都不变）', min > 0 && max - min <= 1, '各次高度=' + JSON.stringify(heights));
        await sp.close();
      }

      record('G9.7', '新日期选择器：可一键跳到年份网格并选中年份/日期',
        String(yearPicked).startsWith('20') && String(dayPicked).startsWith('20') && shown.includes('年'),
        '打开=' + opened + ' 年份按钮=' + yearJump + ' 选中=' + yearPicked + '-' + dayPicked + ' 触发按钮显示=' + shown);
      await p.close();
    }

    /* ============ G10 无障碍自动扫描（axe-core） ============ */
    group('G10 无障碍自动扫描（axe-core）');
    {
      const AXE_PATH = path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js');
      const axeSrc = fs.existsSync(AXE_PATH) ? fs.readFileSync(AXE_PATH, 'utf8') : '';
      let n = 0;
      const scan = async (page, label) => {
        await page.addScriptTag({ content: axeSrc });
        const out = await page.evaluate(async () => {
          const r = await window.axe.run(document, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
          });
          return r.violations.map(v => ({
            id: v.id, impact: v.impact, n: v.nodes.length,
            target: (((v.nodes[0] || {}).target) || []).join(' ').slice(0, 70),
            why: (((v.nodes[0] || {}).failureSummary) || '').replace(/\s+/g, ' ').slice(0, 110),
          }));
        });
        const bad = out.filter(v => v.impact === 'critical' || v.impact === 'serious');
        const rest = out.filter(v => v.impact !== 'critical' && v.impact !== 'serious');
        n += 1;
        record('G10.' + n, label + '：axe（WCAG 2.0/2.1/2.2 A+AA）无 critical/serious 违规', bad.length === 0,
          'critical/serious=' + bad.length + ' ' + JSON.stringify(bad.slice(0, 3)) + ' | 轻中度=' + rest.length);
        return out;
      };
      if (!axeSrc) {
        record('G10.0', 'axe-core 作为 devDependency 可用', false, '缺少 node_modules/axe-core/axe.min.js');
      } else {
        const p = await newPage(browser, 1440, 900);
        await openApp(p);
        await scan(p, 'modern 首页（1440）');
        await clickContains(p, '需补货'); await sleep(1400);
        await scan(p, 'modern 需补货（1440）');
        await clickContains(p, '用药记录'); await sleep(1400);
        await scan(p, 'modern 用药记录（1440）');
        await realClick(p, '入库新药');
        await p.waitForSelector('[role=dialog]', { timeout: 15000 }); await sleep(1000);
        await scan(p, 'modern 新增药品表单（1440）');
        await p.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find(x => (x.getAttribute('aria-label') || '') === '有效截止日期'); if (b) b.click(); });
        await sleep(1000);
        await scan(p, 'modern 日期弹层（1440）');
        await p.keyboard.press('Escape'); await sleep(500);
        await p.evaluate(() => { const x = document.querySelector('[role=dialog] button[aria-label="关闭"]'); if (x) x.click(); });
        await sleep(700);
        await openDetailByName(p, '布洛芬');
        await sleep(1800);
        await scan(p, 'modern 药品详情抽屉（1440）');
        await p.keyboard.press('Escape'); await sleep(700);
        await p.close();

        const m = await newPage(browser, 390, 844, true);
        await openApp(m);
        await scan(m, 'modern 首页（390 移动端）');
        await m.close();

        const c = await newPage(browser, 1440, 900);
        await c.goto(BASE + '?ui=classic', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await c.waitForFunction(() => document.getElementById('root') && document.getElementById('root').children.length > 0 && document.body.innerText.length > 60, { timeout: 30000 });
        await sleep(1500);
        await scan(c, 'classic 首页（1440）');
        await c.close();

        // 空药箱状态：新用户第一眼看到的界面。拦截演示数据文件，强制真正的空态。
        const e1 = await newPage(browser, 390, 844, true);
        await e1.setRequestInterception(true);
        e1.on('request', r => (r.url().includes('demo-backup.json') ? r.abort() : r.continue()));
        await e1.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await e1.evaluate(() => localStorage.clear());
        await e1.reload({ waitUntil: 'domcontentloaded' });
        await sleep(2500);
        await scan(e1, 'modern 空药箱（390 移动端）');
        await e1.close();

        const e2 = await newPage(browser, 1440, 900);
        await e2.setRequestInterception(true);
        e2.on('request', r => (r.url().includes('demo-backup.json') ? r.abort() : r.continue()));
        await e2.goto(BASE + '?ui=classic', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await e2.evaluate(() => localStorage.clear());
        await e2.reload({ waitUntil: 'domcontentloaded' });
        await e2.waitForFunction(() => document.getElementById('root') && document.getElementById('root').children.length > 0, { timeout: 30000 });
        await sleep(2000);
        await scan(e2, 'classic 空药箱（1440）');
        await e2.close();
      }
    }

    /* ============ G11 交互缺陷回归（2026-09-10 老板手动测试发现） ============ */
    group('G11 交互缺陷回归');
    {
      // BUG-12：初始入库数量清不掉（parseFloat('')||0 → 0；输入 50 变 050）
      const p = await newPage(browser, 1440, 900);
      await openApp(p);
      await realClick(p, '入库新药');
      await p.waitForSelector('[role=dialog]', { timeout: 15000 }); await sleep(800);
      const qtySel = '[role=dialog] input[placeholder="如：24"]';
      await p.click(qtySel, { clickCount: 3 });
      await p.keyboard.press('Backspace');
      await sleep(250);
      const afterClear = await p.$eval(qtySel, el => el.value);
      record('G11.1', '初始入库数量可以清空（清空后不是「删不掉的 0」）', afterClear === '', '清空后 value=' + JSON.stringify(afterClear));
      await p.keyboard.type('50');
      await sleep(250);
      const afterType = await p.$eval(qtySel, el => el.value);
      record('G11.2', '清空后输入 50 显示 50（不是 050）', afterType === '50', '输入后 value=' + JSON.stringify(afterType));
      await setInput(p, '药品名称', 'G11数量药');
      await setDate(p, '2027-12-31'); // 表单必填项，漏了会被原生校验挡住（第一次写这条用例时就踩了）
      await clickLabel(p, '确认入库');
      await waitDb(p, d => (d.medicines || []).some(m => m.name === 'G11数量药'));
      const db = await readDB(p);
      const saved = (db.medicines || []).find(m => m.name === 'G11数量药') || {};
      record('G11.3', '按输入值精确入库（50，不是 0 也不是 050 解析异常）', saved.total_quantity === 50, '落库数量=' + saved.total_quantity);
      // 小数：输 "2.5" 中途的 "2." 不能被吃掉
      await realClick(p, '入库新药');
      await p.waitForSelector('[role=dialog]', { timeout: 15000 }); await sleep(700);
      await p.click(qtySel, { clickCount: 3 });
      await p.keyboard.press('Backspace');
      await p.keyboard.type('2.5');
      await sleep(250);
      const decimal = await p.$eval(qtySel, el => el.value);
      record('G11.4', '小数数量可正常输入（2.5 不被吞成 25 或 2）', decimal === '2.5', 'value=' + JSON.stringify(decimal));
      await p.evaluate(() => { const x = document.querySelector('[role=dialog] button[aria-label="关闭"]'); if (x) x.click(); });
      await p.close();

      // BUG-13：手机端点详情抽屉出现黑影闪动/抖动
      const m = await newPage(browser, 390, 844, true);
      await openApp(m);
      const flicker = await m.evaluate(async () => {
        const btns = Array.from(document.querySelectorAll('button')).filter(b => (b.innerText || '').trim() === '详情');
        const cands = btns.map(b => { let el = b; for (let i = 0; i < 8 && el; i++, el = el.parentElement) { const t = el.innerText || ''; if (t.includes('布洛芬')) return { b, len: t.length }; } return null; })
          .filter(Boolean).sort((x, y) => x.len - y.len);
        if (!cands.length) return { err: 'NO_CARD' };
        // ⚠️ 必须在点击之后逐帧重新查询：弹层是点击才挂载的，
        // 点击前抓一次列表会得到空数组，采样全是 -1，断言就变成"空洞通过"（本用例第一版就踩了）。
        const alphaOf = el => {
          const bg = getComputedStyle(el).backgroundColor;
          const mm = bg.match(/rgba?\(([^)]+)\)/);
          if (!mm) return 0;
          const parts = mm[1].split(',');
          return parts.length < 4 ? 1 : parseFloat(parts[3]);
        };
        const darkOverlays = () => Array.from(document.querySelectorAll('.fixed.inset-0')).filter(el => alphaOf(el) > 0.05);
        cands[0].b.click();
        const opacities = [];
        const heights = [];
        let maxDark = 0;
        for (let i = 0; i < 24; i++) {
          await new Promise(r => setTimeout(r, 45));
          const ovs = darkOverlays();
          maxDark = Math.max(maxDark, ovs.length);
          opacities.push(ovs.length ? parseFloat(getComputedStyle(ovs[0]).opacity) : -1);
          const panel = document.querySelector('[role=dialog]');
          heights.push(panel ? Math.round(panel.getBoundingClientRect().height) : 0);
        }
        const overlayDump = Array.from(document.querySelectorAll('.fixed.inset-0'))
          .map(el => (el.className || '').toString().slice(0, 46) + ' α=' + alphaOf(el).toFixed(2));
        const blur = darkOverlays().map(el => getComputedStyle(el).backdropFilter || 'none');
        return {
          overlayCount: maxDark,
          overlayDump,
          blur,
          opacities,
          minH: Math.min(...heights), maxH: Math.max(...heights),
          tapHighlight: getComputedStyle(document.body).webkitTapHighlightColor,
        };
      });
      record('G11.5', '手机端详情只有一层深色遮罩（不叠加变暗）', flicker.overlayCount === 1, 'overlayCount=' + flicker.overlayCount + ' 全部 fixed.inset-0=' + JSON.stringify(flicker.overlayDump));
      record('G11.6', '遮罩不使用 backdrop-filter（移动端合成层闪烁源）', Array.isArray(flicker.blur) && flicker.blur.every(b => b === 'none'), 'backdropFilter=' + JSON.stringify(flicker.blur));
      // 先要求"确实采到了遮罩"（已知至少 20 帧可见），再要求透明度单调不减 ——
      // 否则全 -1 的空数组也能让断言通过，等于没测。
      record('G11.7', '打开过程中遮罩透明度单调递增（无闪回/闪烁）',
        Array.isArray(flicker.opacities) && flicker.opacities.filter(v => v >= 0).length >= 10
          && flicker.opacities.filter(v => v >= 0).every((v, i, arr) => i === 0 || v >= arr[i - 1] - 0.02),
        'opacity 采样=' + JSON.stringify(flicker.opacities));
      record('G11.8', '抽屉打开后高度稳定（不抖动）', flicker.maxH - flicker.minH <= 2 && flicker.maxH > 100, 'min=' + flicker.minH + ' max=' + flicker.maxH);
      record('G11.9', '已关闭移动端点击高亮（消除点按瞬间的黑影）', flicker.tapHighlight === 'rgba(0, 0, 0, 0)', 'tapHighlight=' + flicker.tapHighlight);
      await m.close();
    }

    /* ============ G12 手机端弹层稳定性（背景滚动锁定 + svh 高度） ============ */
    group('G12 手机端弹层稳定性');
    {
      // 根因复现（修复前实测）：在遮罩区拖动，背景页被带着滚（scrollY 400 → 0），
      // 半透明遮罩后的内容整页移动 —— 这就是老板反复反馈的"抖动 / 黑影闪动"。
      const p = await newPage(browser, 390, 844, true);
      await openApp(p);
      await p.evaluate(() => window.scrollTo(0, 400));
      await sleep(400);
      await openDetailByName(p, '布洛芬');
      await sleep(900);
      const cdp = await p.target().createCDPSession();
      const state = () => p.evaluate(() => ({
        scrollY: window.scrollY,
        pos: getComputedStyle(document.body).position,
        top: Math.round(document.body.getBoundingClientRect().top),
        panelH: Math.round((document.querySelector('[role=dialog]') || { getBoundingClientRect: () => ({ height: 0 }) }).getBoundingClientRect().height),
      }));
      const touchSwipe = async (x, y0, dy, steps = 6) => {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
        for (let i = 1; i <= steps; i++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + (dy * i) / steps }] });
          await sleep(25);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await sleep(500);
      };
      const opened = await state();
      record('G12.1', '详情打开时背景被锁定（body position:fixed，内容不随手指移动）',
        opened.pos === 'fixed' && opened.top === -400 && opened.panelH > 100,
        JSON.stringify(opened));

      await touchSwipe(195, 180, 260); // 在遮罩区（面板上方露出部分）往下拖
      const afterScrim = await state();
      record('G12.2', '在遮罩区域拖动：背景页纹丝不动（修复前会被拖动整页，即"黑影闪动"）',
        afterScrim.top === opened.top && afterScrim.panelH === opened.panelH,
        '拖动前 top=' + opened.top + '，拖动后 top=' + afterScrim.top + '，面板高=' + afterScrim.panelH);

      await touchSwipe(195, 760, -240); // 面板内往上拖：抽屉内容应正常滚动
      const innerTop = await p.evaluate(() => { const el = document.querySelector('[role=dialog] .overflow-y-auto'); return el ? Math.round(el.scrollTop) : -1; });
      record('G12.3', '锁定背景后抽屉内容仍可正常滚动（没有把滚动一起锁死）', innerTop > 0, '抽屉内 scrollTop=' + innerTop);

      await p.keyboard.press('Escape'); await sleep(900);
      const closed = await state();
      record('G12.4', '关闭后解锁并回到原滚动位置（不是被弹回页首）',
        closed.pos === 'static' && closed.scrollY === 400 && closed.panelH === 0,
        JSON.stringify(closed));

      // svh：地址栏收起/展开时高度恒定（vh 会变、dvh 会实时抽动）
      const cssFile = fs.readdirSync(path.join(ROOT, 'dist', 'assets')).find(f => f.endsWith('.css'));
      const css = cssFile ? fs.readFileSync(path.join(ROOT, 'dist', 'assets', cssFile), 'utf8') : '';
      record('G12.5', '弹层最大高度用 svh（地址栏收放时面板高度恒定）',
        /\.sheet-max[^{]*\{[^}]*max-height:\s*80svh/.test(css) && /\.sheet-max-form[^{]*\{[^}]*76svh/.test(css),
        'CSS 命中 svh 规则=' + /\.sheet-max[^{]*\{[^}]*max-height:\s*80svh/.test(css));
      await p.close();
    }

  } finally {
    try { await BROWSER.close(); } catch { /* ignore */ }
    try { server.kill(); } catch { /* ignore */ }
  }

  const pass = results.filter(r => r.ok).length;
  const fail = results.filter(r => !r.ok);
  console.log('\n' + '='.repeat(64));
  console.log('E2E TOTAL=' + results.length + ' PASS=' + pass + ' FAIL=' + fail.length);
  if (fail.length) { console.log('失败清单:'); fail.forEach(f => console.log('  - ' + f.id + ' ' + f.desc)); }
  console.log('='.repeat(64));
  const report = path.join(os.tmpdir(), 'medicine-box-e2e-report.json');
  fs.writeFileSync(report, JSON.stringify(results, null, 1));
  console.log('报告: ' + report);
  process.exit(fail.length ? 1 : 0);
}

main().catch(e => { console.error('E2E 运行失败: ' + (e && e.stack ? e.stack.slice(0, 600) : e)); process.exit(2); });
