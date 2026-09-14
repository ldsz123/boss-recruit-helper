  /* ===== BEGIN BRH LICENSE MODULE (授权版专用 · 由 make-sell.js 注入，请勿手改) =====
   * 付费功能拦截点：optimizeResume / runMatch / generateGreeting /
   *                 downloadResumePDF / downloadResumeImage / sendResumeImage
   * 想调整哪些功能收费，改这 6 个函数开头的 requirePro(...) 一行即可。
   * ============================================================================== */

  /** 在线激活网页地址（脚本内「获取激活码」按钮会打开它） */
  const LICENSE_PAGE = 'https://cdn.jsdelivr.net/gh/zzc356/boss-recruit-helper@master/activate.html';
  /** 可选：远程授权接口。留空 = 纯离线校验；填了则激活时多一道服务端校验（返回 {ok:true/false,msg}） */
  const LICENSE_API = '';

  const GUARD_FEATURES = {
    optimize: 'AI 简历优化',
    match: '岗位扫描匹配',
    greeting: 'AI 话术生成',
    export: 'PDF / 图片导出',
    send: '简历图片发送'
  };

  /** 本机机器码（8 位，便于按设备发码 / 排查问题，当前不强制绑定） */
  function machineId() {
    try {
      const raw = [navigator.userAgent, navigator.language, screen.width + 'x' + screen.height, new Date().getTimezoneOffset()].join('|');
      let h = 5381;
      for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) | 0;
      return (h >>> 0).toString(16).toUpperCase().padStart(8, '0');
    } catch (e) { return '--------'; }
  }

  /** 当前授权状态 */
  function licState() {
    const code = getStore(STORE_KEYS.license, '').trim();
    if (!code) return { ok: false, code: '', text: '未激活', sub: 'AI 优化 / 选岗 / 发送简历 等付费功能已锁定' };
    const r = BRH_LIC.checkCode(code);
    if (!r.ok) return { ok: false, code, text: '授权无效', sub: r.reason };
    return { ok: true, code, text: r.exp ? ('已激活 · ' + r.expText) : '已激活 · 永久有效', sub: '' };
  }
  function isPro() { return licState().ok; }

  /** 可选的服务端校验：未配置接口或网络异常时按离线结果放行，避免误伤已付费用户 */
  function onlineVerify(code, cb) {
    if (!LICENSE_API) return cb({ ok: true });
    try {
      GM_xmlhttpRequest({
        method: 'POST', url: LICENSE_API, timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ code: code, machine: machineId(), version: VERSION }),
        onload(res) {
          try { cb(JSON.parse(res.responseText || '{}')); }
          catch (e) { cb({ ok: true, warn: '授权服务器返回异常，已按离线校验放行' }); }
        },
        onerror() { cb({ ok: true, warn: '授权服务器不可达，已按离线校验放行' }); },
        ontimeout() { cb({ ok: true, warn: '授权校验超时，已按离线校验放行' }); }
      });
    } catch (e) { cb({ ok: true }); }
  }

  /** 写入激活码（会先本地校验） */
  function saveLicense(code, done) {
    const val = String(code || '').trim().toUpperCase();
    if (!val) { if (done) done({ ok: false, reason: '请输入激活码' }); return; }
    const r = BRH_LIC.checkCode(val);
    if (!r.ok) { if (done) done(r); return; }
    onlineVerify(val, (res) => {
      if (res && res.ok === false) { if (done) done({ ok: false, reason: res.msg || '授权服务器拒绝了该激活码' }); return; }
      setStore(STORE_KEYS.license, val);
      setStore('brh_lic_exp', r.exp || 0);
      setStore('brh_lic_time', Date.now());
      if (done) done({ ok: true, expText: r.expText, warn: res && res.warn });
    });
  }

  /** 激活弹窗 */
  function showLicenseModal(featureKey, onOk) {
    document.querySelectorAll('#brh-lic-mask').forEach((n) => n.remove());
    const feat = GUARD_FEATURES[featureKey] || '该功能';
    const mask = document.createElement('div');
    mask.id = 'brh-lic-mask';
    mask.innerHTML = `
      <div id="brh-lic-box" style="background:#fff;border-radius:14px;max-width:420px;width:100%;padding:20px 18px;
           box-shadow:0 20px 60px rgba(0,0,0,.28);font:14px/1.65 -apple-system,'Microsoft YaHei',sans-serif;color:#0f172a">
        <div style="font-size:16px;font-weight:700;margin-bottom:6px">🔒 需要激活</div>
        <div style="color:#475569;margin-bottom:12px">「<b>${feat}</b>」是授权版专属功能，输入激活码后即可解锁全部能力。</div>
        <input id="brh-lic-input" placeholder="BRH-XXXX-XXXX-XXXX" spellcheck="false"
               style="width:100%;box-sizing:border-box;height:38px;padding:0 10px;border:1px solid #cbd5e1;border-radius:8px;
                      font-size:14px;letter-spacing:1px;outline:none">
        <div id="brh-lic-st" style="min-height:18px;font-size:12px;color:#dc2626;margin-top:6px"></div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button id="brh-lic-ok" style="flex:1;height:36px;border:0;border-radius:8px;background:#2563eb;color:#fff;
                  font-size:14px;font-weight:600;cursor:pointer">立即激活</button>
          <button id="brh-lic-buy" style="height:36px;padding:0 12px;border:1px solid #cbd5e1;border-radius:8px;
                  background:#fff;color:#334155;font-size:13px;cursor:pointer">获取激活码</button>
          <button id="brh-lic-x" style="height:36px;padding:0 12px;border:1px solid #cbd5e1;border-radius:8px;
                  background:#fff;color:#94a3b8;font-size:13px;cursor:pointer">取消</button>
        </div>
        <div style="margin-top:10px;font-size:12px;color:#94a3b8">机器码 <b>${machineId()}</b>（按设备发码时请把它发给作者）</div>
      </div>`;
    mask.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px';
    document.body.appendChild(mask);
    const input = mask.querySelector('#brh-lic-input');
    const st = mask.querySelector('#brh-lic-st');
    setTimeout(() => input && input.focus(), 50);
    const close = () => mask.remove();
    mask.querySelector('#brh-lic-x').onclick = close;
    mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
    mask.querySelector('#brh-lic-buy').onclick = () => window.open(LICENSE_PAGE, '_blank');
    const submit = () => {
      st.style.color = '#64748b';
      st.textContent = '校验中…';
      saveLicense(input.value, (r) => {
        if (!r || !r.ok) { st.style.color = '#dc2626'; st.textContent = '❌ ' + ((r && r.reason) || '激活失败'); return; }
        close();
        toast('✅ 激活成功' + (r.expText ? '（' + r.expText + '）' : ''), 'ok');
        if (onOk) onOk();
      });
    };
    mask.querySelector('#brh-lic-ok').onclick = submit;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }

  /** 付费功能守门：已激活直接执行，否则弹激活框（成功后自动继续） */
  function requirePro(featureKey, run) {
    if (isPro()) { run(); return; }
    showLicenseModal(featureKey, run);
  }

  /** 设置页授权卡片 */
  function licenseCardHTML(tpl) {
    const s = licState();
    const statusColor = s.ok ? '#16a34a' : '#dc2626';
    return `
        <div class="brh-row" style="border:1px solid ${s.ok ? '#bbf7d0' : '#fecaca'};background:${s.ok ? '#f0fdf4' : '#fef2f2'};border-radius:10px;padding:10px">
          <div style="font-weight:700;color:${statusColor};font-size:14px">${s.ok ? '✅ ' : '🔒 '}${esc(s.text)}</div>
          <div class="brh-tip" style="margin-top:3px">${esc(s.sub || '全部功能已解锁')}</div>
        </div>
        <div class="brh-row">
          <label class="brh-label">激活码</label>
          <input class="brh-input" id="brh-cfg-license" value="${esc(s.code)}" placeholder="BRH-XXXX-XXXX-XXXX" spellcheck="false">
          <div class="brh-row" style="margin-top:6px">
            <button class="brh-btn green sm" id="brh-lic-act">🔑 激活</button>
            <button class="brh-btn ghost sm" id="brh-lic-buy2">🛒 获取激活码</button>
          </div>
          <div class="brh-tip" style="margin-top:6px">机器码 <span class="brh-chip">${machineId()}</span> · 未激活时：AI 优化 / 选岗扫描 / 话术生成 / 简历图片发送与导出 均不可用。</div>
          <div class="brh-tip" style="margin-top:3px">当前模板：<span class="brh-chip">${esc(tpl.name)}</span> · <button class="brh-btn ghost sm" id="brh-tpl-manage" style="margin:0">🗣 话术模板管理</button></div>
        </div>`;
  }

  /* ===== END BRH LICENSE MODULE ===== */
