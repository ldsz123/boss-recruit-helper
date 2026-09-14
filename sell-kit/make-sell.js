/* ============================================================
 * make-sell.js — 由「正式版脚本」生成「授权售卖版脚本」
 *
 * 用法：  node make-sell.js
 * 输入：  ../boss-recruit-helper.user.js        （免费正式版）
 *         ./license-core.js                    （激活码算法，唯一算法源）
 *         ./license-ui.js                      （授权 UI 与拦截逻辑）
 * 输出：  ../boss-recruit-helper-sell.user.js   （带授权拦截的售卖版）
 *
 * 正式版每次升级后，重新执行本脚本即可得到同版本号的售卖版。
 * 若某条规则未命中（正式版改动了对应代码），脚本会明确报错并停止，
 * 此时按提示更新本文件的 find 片段即可——不会静默产出缺功能的坏版本。
 * ========================================================== */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'boss-recruit-helper.user.js');
const OUT = path.join(ROOT, 'boss-recruit-helper-sell.user.js');
const CORE = path.join(__dirname, 'license-core.js');
const UI = path.join(__dirname, 'license-ui.js');

const SELL_RAW = 'https://gitee.com/zzc356/boss-recruit-helper/raw/master/boss-recruit-helper-sell.user.js';
const FREE_RAW = 'https://gitee.com/zzc356/boss-recruit-helper/raw/master/boss-recruit-helper.user.js';

let src = fs.readFileSync(SRC, 'utf8');
const core = fs.readFileSync(CORE, 'utf8');
const ui = fs.readFileSync(UI, 'utf8');

const rules = [];
const R = (id, find, replace, expect) => rules.push({ id, find, replace, expect: expect == null ? 1 : expect });

/* 1. 脚本身份：改名 + 独立 namespace（避免与免费版互相覆盖） */
R('identity',
`// @name         Boss招聘小助手（JD捕获 + 简历AI优化 + 快捷投递）
// @namespace    https://workbuddy.local/boss-recruit-helper`,
`// @name         Boss招聘小助手 · 授权版（JD捕获 + 简历AI优化 + 快捷投递）
// @namespace    https://workbuddy.local/boss-recruit-helper-sell`);

/* 2. 更新地址指向售卖版自身（否则油猴会把售卖版覆盖成免费版） */
R('update-url',
`// @updateURL    ${FREE_RAW}
// @downloadURL  ${FREE_RAW}`,
`// @updateURL    ${SELL_RAW}
// @downloadURL  ${SELL_RAW}`);

R('update-const',
`  const DEFAULT_UPDATE_URL = '${FREE_RAW}';`,
`  const DEFAULT_UPDATE_URL = '${SELL_RAW}';`);

/* 3. 注入激活码算法 + 授权 UI 模块 */
R('inject-modules',
`  /* ============================================================
   * 6.5 云端更新检查与授权
   * ========================================================== */
`,
`  /* ============================================================
   * 6.5 云端更新检查与授权
   * ========================================================== */

  /* ---- 激活码算法（由 sell-kit/license-core.js 注入，勿手改） ---- */
${core}
  const BRH_LIC = (typeof self !== 'undefined' ? self : window).BRHLicense;

${ui}
`);

/* 4. verifyLicense 改为真实校验 */
R('verify-fn',
`  function verifyLicense(code) {
    // 本地格式校验雏形；售卖版可在此接入远程校验接口（返回 true/false）
    if (!code) return true; // 未填授权码 = 免费使用
    return /^BRH-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code.trim());
  }`,
`  function verifyLicense(code) {
    return !!String(code || '').trim() && BRH_LIC.checkCode(code).ok;
  }`);

/* 5. 付费功能拦截（函数首行守门） */
const guards = [
  ['optimizeResume() {', 'optimize'],
  ['runMatch(mode) {', 'match'],
  ['generateGreeting(opts) {', 'greeting'],
  ['downloadResumePDF() {', 'export'],
  ['downloadResumeImage() {', 'export'],
  ['sendResumeImage() {', 'send']
];
guards.forEach(([sig, key]) => {
  R('guard:' + key, `  function ${sig}\n`,
`  function ${sig}
    if (!isPro()) { showLicenseModal('${key}', () => ${sig.slice(0, sig.indexOf('('))}(${sig.includes('mode') ? 'mode' : sig.includes('opts') ? 'opts' : ''})); return; }
`);
});

/* 6. 设置页：授权状态卡片 */
R('settings-card',
`        <div class="brh-row">
          <label class="brh-label">授权码（可选，售卖版启用）</label>
          <input class="brh-input" id="brh-cfg-license" value="\${esc(lic)}" placeholder="留空即免费使用；售卖版在此填激活码">
          <div class="brh-tip" style="margin-top:3px">当前模板：<span class="brh-chip">\${esc(tpl.name)}</span> · <button class="brh-btn ghost sm" id="brh-tpl-manage" style="margin:0">🗣 话术模板管理</button></div>
        </div>`,
`        \${licenseCardHTML(tpl)}`);

/* 7. 保存设置时校验激活码 */
R('save-status',
`        setStore(STORE_KEYS.license, $('#brh-cfg-license').value.trim());
        this.showStatus('brh-cfg', '✅ 已保存', 'ok');`,
`        const licVal = $('#brh-cfg-license').value.trim();
        setStore(STORE_KEYS.license, licVal);
        if (!licVal) {
          this.showStatus('brh-cfg', '✅ 已保存（未激活，付费功能仍锁定）', 'ok');
        } else {
          const lr = BRH_LIC.checkCode(licVal);
          if (lr.ok) { this.showStatus('brh-cfg', '✅ 已保存并激活（' + (lr.expText || '') + '）', 'ok'); }
          else { this.showStatus('brh-cfg', '⚠️ 已保存，但激活码无效：' + lr.reason, 'err'); }
        }`);

/* 8. 设置页按钮绑定 */
R('settings-bind',
`      $('#brh-tpl-manage').onclick = () => this.renderTemplateManager();`,
`      $('#brh-tpl-manage').onclick = () => this.renderTemplateManager();
      const licBuy2 = $('#brh-lic-buy2');
      if (licBuy2) licBuy2.onclick = () => window.open(LICENSE_PAGE, '_blank');
      const licAct = $('#brh-lic-act');
      if (licAct) licAct.onclick = () => {
        const v = $('#brh-cfg-license').value.trim();
        if (!v) { this.showStatus('brh-cfg', '请先粘贴激活码', 'err'); return; }
        saveLicense(v, (r) => {
          if (!r || !r.ok) { this.showStatus('brh-cfg', '❌ ' + ((r && r.reason) || '激活失败'), 'err'); return; }
          this.showStatus('brh-cfg', '✅ 激活成功' + (r.expText ? '（' + r.expText + '）' : '') + (r.warn ? ' · ' + r.warn : ''), 'ok');
          toast('✅ 激活成功', 'ok');
          this.renderSettingsTab();
        });
      };`);

/* 9. 启动提示 */
R('boot-tip',
`    // 授权码格式校验（不强制拦截，仅提示）
    const lic = getStore(STORE_KEYS.license, '');
    if (lic && !verifyLicense(lic)) toast('授权码格式不正确，请到「设置」核对', 'err');`,
`    // 授权状态提示（付费功能在各自入口拦截）
    const lic = getStore(STORE_KEYS.license, '').trim();
    if (!lic) toast('🔒 未激活：AI 优化 / 选岗 / 话术 / 发送简历 需要激活码', 'info');
    else if (!verifyLicense(lic)) toast('⚠️ 激活码无效或已过期，请到「⚙️ 设置」重新激活', 'err');`);

/* ---------- 执行 ---------- */
const errors = [];
rules.forEach((r) => {
  const n = src.split(r.find).length - 1;
  if (n === 0) { errors.push(`  ✗ [${r.id}] 未找到目标片段（正式版可能已改动，请更新 make-sell.js）`); return; }
  if (r.expect && n !== r.expect) { errors.push(`  ✗ [${r.id}] 命中 ${n} 次，期望 ${r.expect} 次`); return; }
  src = src.split(r.find).join(r.replace);
  console.log(`  ✓ ${r.id}`);
});

if (errors.length) {
  console.error('\n生成失败：\n' + errors.join('\n'));
  process.exit(1);
}

// 版本号跟随正式版（保证 update 机制一致）
const ver = (/@version\s+([0-9.]+)/.exec(src) || [])[1] || '?';
// 售卖文件内部显示版本加后缀，便于区分（@version 保持纯数字以便比较）
src = src.replace('Boss招聘小助手 v${VERSION} · MIT License', 'Boss招聘小助手 v${VERSION} · 授权版 · MIT License');

fs.writeFileSync(OUT, src, 'utf8');
console.log(`\n✅ 已生成：${path.relative(ROOT, OUT)}  (v${ver}, ${(src.length / 1024).toFixed(1)} KB)`);
console.log(`   更新地址：${SELL_RAW}`);
