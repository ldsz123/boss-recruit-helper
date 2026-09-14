/* test-license.js — 在 Node 里用桩环境跑一遍售卖脚本的授权模块
 * 用法：node test-license.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'boss-recruit-helper-sell.user.js');
const src = fs.readFileSync(SRC, 'utf8');

const start = src.indexOf('/* ---- 激活码算法');
const end = src.indexOf('/* ===== END BRH LICENSE MODULE ===== */');
if (start < 0 || end < 0) { console.error('未找到授权模块，请先执行 make-sell.js'); process.exit(1); }
const block = src.slice(start, end);
const core = fs.readFileSync(path.join(__dirname, 'license-core.js'), 'utf8');

const store = {};
const el = () => {
  const o = {
    style: {}, classList: { add() {}, toggle() {} }, value: '', textContent: '', innerHTML: '',
    appendChild() {}, remove() {}, addEventListener() {}, onclick: null
  };
  o.querySelector = () => el();
  return o;
};
const ctx = {
  console, TextEncoder, Math, Date, JSON, parseInt, String, Number, Object,
  setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0,
  navigator: { userAgent: 'test-agent', language: 'zh-CN' },
  screen: { width: 1920, height: 1080 },
  document: { querySelectorAll: () => [], createElement: el, body: { appendChild() {} } },
  getStore: (k, d) => (store[k] === undefined ? d : store[k]),
  setStore: (k, v) => { store[k] = v; },
  toast: (m) => console.log('   [toast]', m),
  STORE_KEYS: { license: 'brh_license' },
  VERSION: '1.3.0',
  GM_xmlhttpRequest: null
};
ctx.self = ctx; ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(core, ctx);
vm.runInContext(block + '\n;globalThis.__api = { BRH_LIC, licState, isPro, saveLicense, machineId, requirePro, GUARD_FEATURES, LICENSE_PAGE, LICENSE_API };', ctx);

const api = ctx.__api;
const { BRH_LIC } = api;
let fail = 0;
function ok(cond, name) { console.log((cond ? '  ✓ ' : '  ✗ ') + name); if (!cond) fail++; }

console.log('机器码:', api.machineId());
console.log('授权页面:', api.LICENSE_PAGE);
console.log('远程接口:', api.LICENSE_API || '(未配置，纯离线校验)');

ok(api.licState().ok === false, '初始状态 = 未激活');
ok(api.licState().text === '未激活', '状态文案 = 未激活');

let ran = false;
api.requirePro('optimize', () => { ran = true; });
ok(ran === false, '未激活时 requirePro 不执行付费功能');

const bad = 'BRH-0000-0000-0000';
api.saveLicense(bad, (r) => { ok(!r.ok, '无效码被拒绝：' + r.reason); });

const perm = BRH_LIC.genCode(null);
api.saveLicense(perm, (r) => {
  ok(r.ok, '永久码激活成功：' + perm);
  ok(store.brh_license === perm, '激活码已写入本地存储');
  ok(api.isPro() === true, '激活后 isPro() = true');
  api.requirePro('optimize', () => { ran = true; });
  ok(ran === true, '激活后 requirePro 正常执行');
});

const d30 = BRH_LIC.genCode(BRH_LIC.parseExpChoice('30'));
const chk = BRH_LIC.checkCode(d30);
ok(chk.ok && chk.exp > 0, '30 天码有效，到期：' + chk.expText);

// 过期码（手动构造一个 2026-01 到期的码）
const expired = (function () {
  const past = new Date(2026, 0, 15);
  return BRH_LIC.genCode(past);
})();
const er = BRH_LIC.checkCode(expired);
ok(!er.ok && er.expired, '过期码被识别：' + er.reason);

ok(Object.keys(api.GUARD_FEATURES).length === 5, '付费功能清单完整（' + Object.keys(api.GUARD_FEATURES).join('/') + '）');

console.log(fail ? '\n❌ 有 ' + fail + ' 项未通过' : '\n✅ 全部通过');
process.exit(fail ? 1 : 0);
