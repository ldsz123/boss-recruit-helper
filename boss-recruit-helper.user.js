// ==UserScript==
// @name         Boss招聘小助手（JD捕获 + 简历AI优化 + 快捷投递）
// @namespace    https://workbuddy.local/boss-recruit-helper
// @version      1.3.0
// @description  在Boss直聘一键捕获岗位JD、按简历匹配筛选岗位、支持上传PDF/Word/TXT简历并AI优化、生成多套自定义打招呼话术、云端自动更新；优化后自动产出对应岗位话术并下载/投递
// @author       阿迪
// @match        https://www.zhipin.com/*
// @match        https://zhipin.com/*
// @require      https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js
// @require      https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js
// @require      https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js
// @require      https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      *
// @connect      cdn.jsdelivr.net
// @run-at       document-idle
// @license      MIT
// @updateURL    https://gitee.com/zzc356/boss-recruit-helper/raw/master/boss-recruit-helper.user.js
// @downloadURL  https://gitee.com/zzc356/boss-recruit-helper/raw/master/boss-recruit-helper.user.js
// ==/UserScript==

(function () {
  'use strict';

  /* ============================================================
   * 0. 常量与工具
   * ========================================================== */

  const STORE_KEYS = {
    cfg: 'brh_cfg',          // { baseUrl, apiKey, model }
    jd: 'brh_jd',            // 最近抓取的 JD 文本
    jdMeta: 'brh_jd_meta',   // { title, company, salary, url, time }
    resume: 'brh_resume',    // 用户原始简历文本
    optimized: 'brh_optimized', // 最近一次优化结果
    greeting: 'brh_greeting',   // 最近一次打招呼话术
    greetingTpl: 'brh_greeting_tpl',        // 当前选中的话术模板 id
    greetingTemplates: 'brh_greeting_templates', // 自定义话术模板数组（覆盖默认）
    matchRes: 'brh_match_res',  // 最近一次岗位匹配结果（数组）
    license: 'brh_license',     // 授权码（可选，售卖时启用）
    resumeTheme: 'brh_resume_theme', // 简历版式：modern（现代简约）/ business（深色商务）
    updateUrl: 'brh_update_url'      // 用户自定义的云端更新地址（覆盖默认）
  };

  const DEFAULT_CFG = {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    resumeTheme: 'modern',  // modern | business
    updateUrl: ''           // 留空则使用脚本内置的默认托管地址
  };

  // 版本与云端更新：把 DEFAULT_UPDATE_URL 换成你的托管地址（或在设置页填「云端更新地址」），油猴据此自动检查更新
  const VERSION = '1.3.0';
  const DEFAULT_UPDATE_URL = 'https://gitee.com/zzc356/boss-recruit-helper/raw/master/boss-recruit-helper.user.js';
  // 优先使用用户在设置页填写的更新地址，否则用内置默认地址
  const getUpdateUrl = () => (getCfg().updateUrl || '').trim() || DEFAULT_UPDATE_URL;

  // 默认话术模板（用户可在设置页新建/编辑/删除；{岗位}{公司}{薪资}{姓名} 会被自动替换）
  const DEFAULT_TEMPLATES = [
    { id: 'formal', name: '正式版', prompt: '你是求职沟通专家。根据目标岗位 JD 与候选人简历，写一条发给 HR 的 Boss 直聘打招呼消息。岗位：{岗位}（{公司} {薪资}）。要求：80~150 字；开头一句贴合岗位的意向表达；中间 2~3 句用简历中最匹配的经历佐证（带数字更佳）；结尾礼貌求进一步沟通。只输出消息正文，不要引号和解释。' },
    { id: 'concise', name: '精简版', prompt: '你是求职沟通专家。针对岗位「{岗位}」（{公司}），写一条极简的 Boss 打招呼消息，60 字内：一句话说明匹配点 + 一句话邀约沟通。只输出正文，不要引号。' },
    { id: 'lively', name: '活泼版', prompt: '你是求职沟通专家。针对岗位「{岗位}」（{公司} {薪资}），写一条有亲和力、不刻板的 Boss 打招呼消息，100 字左右，用轻松但专业的口吻点出 1~2 个核心匹配经历并表达沟通意愿。只输出正文，不要引号。' }
  ];

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const txt = (el) => (el ? el.innerText.trim() : '');
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function getStore(key, fallback) {
    try {
      const v = GM_getValue(key);
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function setStore(key, value) {
    try { GM_setValue(key, value); } catch (e) { /* ignore */ }
  }
  function getCfg() { return Object.assign({}, DEFAULT_CFG, getStore(STORE_KEYS.cfg, {})); }
  function saveCfg(cfg) { setStore(STORE_KEYS.cfg, cfg); }

  function nowStr() {
    return new Date().toLocaleString('zh-CN', { hour12: false });
  }

  function toast(msg, type = 'info') {
    const colors = { info: '#3b82f6', ok: '#16a34a', err: '#dc2626' };
    const el = document.createElement('div');
    el.className = 'brh-toast';
    el.style.borderColor = colors[type] || colors.info;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => { el.classList.add('brh-toast-out'); }, 2400);
    setTimeout(() => { el.remove(); }, 2900);
  }

  /* ============================================================
   * 1. 样式
   * ========================================================== */

  GM_addStyle(`
    #brh-panel { position: fixed; top: 80px; right: 24px; width: 360px; z-index: 2147483000;
      background: #ffffff; border: 1px solid #e4e7ed; border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,.16); font-size: 13px; color: #303133;
      font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
    #brh-panel * { box-sizing: border-box; }
    .brh-header { display: flex; align-items: center; gap: 8px; padding: 10px 12px;
      background: linear-gradient(135deg, #00c3a5, #00a1ea); color: #fff; border-radius: 12px 12px 0 0;
      cursor: move; user-select: none; }
    .brh-header b { flex: 1; font-size: 14px; }
    .brh-header .brh-min { cursor: pointer; font-size: 16px; line-height: 1; padding: 0 4px; opacity: .9; }
    .brh-tabs { display: flex; border-bottom: 1px solid #ebeef5; }
    .brh-tabs .brh-tab { flex: 1; text-align: center; padding: 8px 0; cursor: pointer;
      color: #909399; border-bottom: 2px solid transparent; }
    .brh-tabs .brh-tab.on { color: #00a1ea; border-bottom-color: #00a1ea; font-weight: 600; }
    .brh-body { padding: 12px; max-height: 60vh; overflow-y: auto; }
    .brh-body::-webkit-scrollbar { width: 6px; }
    .brh-body::-webkit-scrollbar-thumb { background: #dcdfe6; border-radius: 3px; }
    .brh-hide { display: none !important; }
    .brh-btn { display: inline-block; padding: 7px 14px; border: none; border-radius: 6px;
      cursor: pointer; font-size: 13px; background: #00a1ea; color: #fff; }
    .brh-btn:hover { filter: brightness(1.08); }
    .brh-btn.green { background: #16a34a; }
    .brh-btn.warn { background: #f59e0b; }
    .brh-btn.ghost { background: #fff; color: #00a1ea; border: 1px solid #00a1ea; }
    .brh-btn.sm { padding: 4px 10px; font-size: 12px; }
    .brh-btn:disabled { background: #c0c4cc; cursor: not-allowed; }
    .brh-btn + .brh-btn { margin-left: 6px; }
    .brh-row { margin-bottom: 10px; }
    .brh-label { display: block; font-weight: 600; margin-bottom: 4px; color: #606266; }
    .brh-area { width: 100%; min-height: 90px; padding: 8px; border: 1px solid #dcdfe6;
      border-radius: 6px; font-size: 12.5px; line-height: 1.6; resize: vertical; font-family: inherit; }
    .brh-area:focus { outline: none; border-color: #00a1ea; }
    .brh-input { width: 100%; padding: 7px 8px; border: 1px solid #dcdfe6; border-radius: 6px; font-size: 12.5px; }
    .brh-input:focus { outline: none; border-color: #00a1ea; }
    .brh-tip { font-size: 12px; color: #909399; line-height: 1.6; }
    .brh-status { font-size: 12px; color: #606266; margin: 6px 0; min-height: 16px; }
    .brh-status.ok { color: #16a34a; } .brh-status.err { color: #dc2626; }
    .brh-chip { display: inline-block; background: #f0f9ff; color: #0369a1; border: 1px solid #bae6fd;
      border-radius: 4px; padding: 1px 6px; font-size: 11.5px; margin-right: 6px; }
    .brh-toast { position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
      background: #fff; border: 1px solid #3b82f6; border-left-width: 4px; border-radius: 8px;
      padding: 10px 18px; font-size: 13px; color: #303133; z-index: 2147483600;
      box-shadow: 0 4px 16px rgba(0,0,0,.15); transition: opacity .4s, top .4s; }
    .brh-toast-out { opacity: 0; top: 6px; }
    .brh-fab { position: fixed; bottom: 96px; right: 24px; z-index: 2147483000;
      width: 46px; height: 46px; border-radius: 50%; border: none; cursor: pointer;
      background: linear-gradient(135deg, #00c3a5, #00a1ea); color: #fff; font-size: 20px;
      box-shadow: 0 4px 16px rgba(0,0,0,.25); }
    .brh-job { border:1px solid #ebeef5; border-radius:8px; padding:8px; margin-bottom:8px; background:#fff; }
    .brh-job-top { display:flex; align-items:center; gap:6px; }
    .brh-job-title { font-weight:600; font-size:13px; color:#303133; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .brh-job-meta { font-size:11.5px; color:#909399; margin:3px 0; }
    .brh-job-reason { font-size:11.5px; color:#606266; line-height:1.5; margin-top:2px; }
    .brh-badge { display:inline-block; min-width:34px; text-align:center; border-radius:10px; padding:1px 6px; font-size:11.5px; font-weight:600; color:#fff; }
    .brh-badge.good { background:#16a34a; } .brh-badge.mid { background:#f59e0b; } .brh-badge.low { background:#dc2626; }
    .brh-match-hidden { display:none !important; }
    .brh-seg { display:flex; border:1px solid #dcdfe6; border-radius:6px; overflow:hidden; margin:8px 0; }
    .brh-seg button { flex:1; border:none; background:#fff; padding:5px 0; cursor:pointer; font-size:12px; color:#606266; }
    .brh-seg button.on { background:#00a1ea; color:#fff; }
  `);

  /* ============================================================
   * 2. JD 抓取（多策略 + 兜底手动粘贴）
   * ========================================================== */

  const JD_KEYWORDS = ['职位描述', '岗位职责', '工作职责', '任职要求', '职位要求', '岗位要求', '工作内容'];

  function extractJD() {
    const result = { title: '', company: '', salary: '', sections: [] };

    // —— 策略A：职位详情页 .job-sec 结构（www.zhipin.com/job_detail/*.html 及新版详情页）
    const secs = $$('.job-sec');
    for (const sec of secs) {
      const h = txt(sec.querySelector('h3, .job-sec-title, .title'));
      const body = txt(sec.querySelector('.job-sec-text, .text')) || txt(sec);
      if (h && body && JD_KEYWORDS.some((k) => h.includes(k))) {
        result.sections.push({ title: h, body });
      }
    }

    // —— 策略B：新版详情页 job-detail / detail-section 结构
    if (!result.sections.length) {
      const boxes = $$('.job-detail-section, .detail-section, [class*="job-detail"]');
      for (const box of boxes) {
        const h = txt(box.querySelector('h3, h2, .title'));
        const body = txt(box.querySelector('.job-sec-text, .describe, .content, .text')) || txt(box);
        if (h && body && JD_KEYWORDS.some((k) => h.includes(k))) {
          result.sections.push({ title: h, body });
        }
      }
    }

    // —— 策略C：兜底全文扫描，按关键词切分
    if (!result.sections.length) {
      const container = $('.job-detail, .job-detail-box, .detail-content, .job-sec-text');
      const full = txt(container) || document.body.innerText;
      for (const kw of ['岗位职责', '工作职责', '职位描述', '工作内容']) {
        const i = full.indexOf(kw);
        if (i >= 0) {
          result.sections.push({ title: kw, body: full.slice(i, i + 3000).trim() });
          break;
        }
      }
    }

    // —— 标题 / 公司 / 薪资（多选择器尝试）
    result.title = txt($('.job-name'))
      || txt($('.job-banner .name'))
      || txt($('.job-title, .name h1, h1'))
      || document.title.replace(/[-|].*$/, '');
    result.company = txt($('.company-info .name'))
      || txt($('.sider-company .name'))
      || txt($('.company-name, [ka*="company"] .name'))
      || '';
    result.salary = txt($('.salary'))
      || txt($('.job-banner .salary'))
      || txt($('.job-salary, .salary-desc'))
      || '';

    return result;
  }

  function jdToText(jd) {
    const head = `【目标岗位】${jd.title}${jd.salary ? '　' + jd.salary : ''}${jd.company ? '　|　' + jd.company : ''}`;
    const body = jd.sections.map((s) => `## ${s.title}\n${s.body}`).join('\n\n');
    return `${head}\n\n${body}`;
  }

  /* ============================================================
   * 2.5 选岗匹配（扫描本页岗位 + AI/本地匹配 + 应用）
   * ========================================================== */

  function extractJobCards() {
    const wrappers = $$('.job-card-wrapper, .job-card-left');
    const list = wrappers.length ? wrappers : $$('[class*="job-card"]').filter((el) => !el.parentElement || !el.parentElement.matches('[class*="job-card"]'));
    const seen = new Set();
    const jobs = [];
    for (const w of list) {
      if (seen.has(w)) continue;
      seen.add(w);
      const titleEl = $('.job-name a', w) || $('a.job-name', w) || $('.job-title a', w) || $('h3 a', w) || $('a', w);
      const title = txt(titleEl).replace(/\s+/g, ' ').trim();
      if (!title || title.length < 2) continue;
      const salary = txt($('.salary', w)) || txt($('.job-salary', w));
      const company = txt($('.company-text', w)) || txt($('h3.name a', w)) || txt($('.company-name', w)) || txt($('.company-info a', w));
      const area = txt($('.job-area', w)) || txt($('.job-area-wrapper', w)) || txt($('.city', w));
      const tags = $$('.tag-list .tag, .tag, .info-desc .tag', w).map(txt).filter(Boolean);
      const desc = txt($('.job-sec-text', w)) || txt($('.info-desc', w)) || txt($('.job-desc', w));
      const link = (titleEl && titleEl.href) ? titleEl : (w.querySelector('a') || null);
      jobs.push({ el: w, title, salary, company, area, tags, desc, href: link && link.href ? link.href : '', _link: link });
    }
    return jobs;
  }

  function buildJdFromCard(job) {
    const lines = [`【目标岗位】${job.title}${job.salary ? '　' + job.salary : ''}${job.company ? '　|　' + job.company : ''}${job.area ? '　' + job.area : ''}`];
    if (job.tags.length) lines.push(`\n## 任职要求 / 岗位标签\n${job.tags.join('、')}`);
    if (job.desc) lines.push(`\n## 职位描述\n${job.desc}`);
    return lines.join('\n');
  }

  function rawLLM(messages, onOk, onFail) {
    const cfg = getCfg();
    const url = String(cfg.baseUrl || DEFAULT_CFG.baseUrl).replace(/\/+$/, '') + '/chat/completions';
    GM_xmlhttpRequest({
      method: 'POST', url,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
      data: JSON.stringify({ model: cfg.model || DEFAULT_CFG.model, messages, temperature: 0.3, stream: false }),
      timeout: 120000,
      onload(res) {
        try {
          if (res.status < 200 || res.status >= 300) throw new Error(`接口返回 ${res.status}：${(res.responseText || '').slice(0, 200)}`);
          const data = JSON.parse(res.responseText);
          const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
          if (!content || !content.trim()) throw new Error('接口未返回内容');
          onOk(content.trim());
        } catch (e) { onFail(e.message); }
      },
      onerror(err) { onFail('网络错误：' + (err && err.error ? err.error : '无法连接接口')); },
      ontimeout() { onFail('请求超时，请重试或更换模型'); }
    });
  }

  function matchJobsAI(resume, jobs, onResult) {
    const cfg = getCfg();
    if (!cfg.apiKey) { UI.showStatus('brh-match', '请先在「设置」填写 API Key，或改用「本地关键词」匹配', 'err'); UI.switchTab('settings'); return; }
    const payload = jobs.map((j, i) => ({ idx: i, title: j.title, salary: j.salary, company: j.company, area: j.area, tags: j.tags, desc: (j.desc || '').slice(0, 200) }));
    const messages = [
      { role: 'system', content: '你是招聘匹配专家。给定候选人简历和一批岗位，逐岗评估匹配度。严格只输出一个 JSON 数组，每个元素形如 {"idx":序号,"score":0到100的整数,"fit":"合适|一般|不太合适","reason":"20字内中文理由，点出关键匹配或不匹配点"}。不要任何解释、不要 Markdown 代码块标记、不要序号。' },
      { role: 'user', content: `【候选人简历】\n${resume}\n\n【待匹配岗位】\n${JSON.stringify(payload)}` }
    ];
    UI.showStatus('brh-match', 'AI 正在匹配本页岗位…（约 10~40 秒）');
    rawLLM(messages, (text) => {
      let arr = [];
      try {
        const m = text.match(/\[[\s\S]*\]/);
        if (m) arr = JSON.parse(m[0]);
      } catch (e) { arr = []; }
      if (!Array.isArray(arr) || !arr.length) { UI.showStatus('brh-match', 'AI 未返回有效结果，可改用「本地关键词」匹配', 'err'); return; }
      onResult(arr);
    }, (msg) => UI.showStatus('brh-match', '匹配失败：' + msg, 'err'));
  }

  function tokenize(s) {
    const set = new Set();
    const clean = (s || '').toLowerCase();
    for (const m of clean.match(/[a-z][a-z0-9\+#\.]{1,}/g) || []) set.add(m);
    const cjk = clean.replace(/[^\u4e00-\u9fa5]/g, '');
    for (let i = 0; i < cjk.length; i++) {
      if (i + 2 <= cjk.length) set.add('ng:' + cjk.slice(i, i + 2));
      if (i + 3 <= cjk.length) set.add('ng:' + cjk.slice(i, i + 3));
    }
    return set;
  }

  function matchJobsLocal(resume, jobs) {
    const R = tokenize(resume);
    const res = [];
    jobs.forEach((j, i) => {
      const J = tokenize(j.title + ' ' + j.tags.join(' ') + ' ' + (j.desc || ''));
      let matched = 0;
      const hitList = [];
      J.forEach((t) => {
        if (R.has(t)) {
          matched++;
          const v = t.startsWith('ng:') ? t.slice(3) : t;
          if (v.length >= 2 && hitList.length < 4 && !hitList.includes(v)) hitList.push(v);
        }
      });
      const cov = J.size ? matched / J.size : 0;
      const score = Math.min(100, Math.round(cov * 130));
      const fit = score >= 45 ? '合适' : score >= 20 ? '一般' : '不太合适';
      res.push({ idx: i, score, fit, reason: hitList.length ? '命中：' + hitList.join('/') : '关键词重合少' });
    });
    return res;
  }

  function runMatch(mode) {
    const resume = getStore(STORE_KEYS.resume, '');
    if (!resume) { toast('请先上传简历', 'err'); UI.switchTab('resume'); return; }
    const jobs = extractJobCards();
    if (!jobs.length) { UI.showStatus('brh-match', '本页没扫描到岗位卡片，请确认在 Boss 职位列表页', 'err'); return; }
    UI.showStatus('brh-match', '已扫描 ' + jobs.length + ' 个岗位，匹配中…');
    const onResult = (res) => {
      setStore(STORE_KEYS.matchRes, res);
      const byIdx = {};
      res.forEach((r) => { byIdx[r.idx] = r; });
      renderMatchList(jobs, byIdx);
      const good = res.filter((r) => r.fit === '合适').length;
      const mid = res.filter((r) => r.fit === '一般').length;
      UI.showStatus('brh-match', `匹配完成：共 ${jobs.length} 个 · 合适 ${good} · 一般 ${mid}`, 'ok');
      const fr = $('#brh-filter-row'); if (fr) fr.style.display = '';
      const scan = $('#brh-scan'); if (scan) scan.textContent = '🔄 重新匹配';
    };
    if (mode === 'ai') matchJobsAI(resume, jobs, onResult);
    else onResult(matchJobsLocal(resume, jobs));
  }

  function renderMatchList(jobs, byIdx) {
    const list = $('#brh-match-list');
    if (!list) return;
    list.innerHTML = '';
    jobs.forEach((job, i) => {
      const r = byIdx[i] || { score: 0, fit: '不太合适', reason: '未评估' };
      const cls = r.fit === '合适' ? 'good' : r.fit === '一般' ? 'mid' : 'low';
      const item = document.createElement('div');
      item.className = 'brh-job';
      item.dataset.fit = r.fit;
      item.innerHTML = `
        <div class="brh-job-top">
          <span class="brh-job-title" title="${esc(job.title)}">${esc(job.title)}</span>
          <span class="brh-badge ${cls}">${r.score}</span>
        </div>
        <div class="brh-job-meta">${esc(job.company || '—')}${job.salary ? '　·　' + esc(job.salary) : ''}${job.area ? '　·　' + esc(job.area) : ''}</div>
        ${job.tags.length ? `<div class="brh-job-meta">${job.tags.slice(0, 6).map((t) => '<span class="brh-chip">' + esc(t) + '</span>').join('')}</div>` : ''}
        <div class="brh-job-reason">${esc(r.reason)}</div>
        <div style="text-align:right;margin-top:6px"><button class="brh-btn sm" data-apply="${i}">应用此岗位 →</button></div>
      `;
      list.appendChild(item);
    });
    $$('[data-apply]', list).forEach((b) => { b.onclick = () => applyJob(jobs[+b.dataset.apply]); });
  }

  function applyJob(job) {
    setStore(STORE_KEYS.jd, buildJdFromCard(job));
    setStore(STORE_KEYS.jdMeta, { title: job.title, company: job.company, salary: job.salary, url: job.href || location.href, time: nowStr() });
    if (job._link && job._link.click) {
      try { job._link.click(); } catch (e) {}
      setTimeout(() => {
        const r = extractJD();
        if (r.sections.length) {
          setStore(STORE_KEYS.jd, jdToText(r));
          setStore(STORE_KEYS.jdMeta, { title: r.title || job.title, company: r.company || job.company, salary: r.salary || job.salary, url: location.href, time: nowStr() });
        }
        toast('已加载该岗位 JD，到「优化」页生成简历', 'ok');
        UI.switchTab('jd');
      }, 1300);
    } else {
      toast('已加载该岗位 JD，到「优化」页生成简历', 'ok');
      UI.switchTab('jd');
    }
  }

  function filterPage(action) {
    const res = getStore(STORE_KEYS.matchRes, null);
    if (!res) { toast('请先点击「扫描本页岗位并匹配」', 'err'); return; }
    const jobs = extractJobCards();
    if (!jobs.length) { toast('本页没有岗位卡片', 'err'); return; }
    const byIdx = {};
    res.forEach((r) => { byIdx[r.idx] = r; });
    jobs.forEach((job, i) => {
      const fit = (byIdx[i] && byIdx[i].fit) || '不太合适';
      if (action === 'good') job.el.classList.toggle('brh-match-hidden', fit !== '合适');
      else job.el.classList.remove('brh-match-hidden');
    });
    toast(action === 'good' ? '已隐藏不合适岗位' : '已恢复全部岗位', 'ok');
  }

  /* ============================================================
   * 3.5 简历文件解析（PDF / Word / TXT / MD）
   * ========================================================== */

  function ensurePdfWorker() {
    if (typeof pdfjsLib !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    }
  }

  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('文件读取失败'));
      r.readAsArrayBuffer(file);
    });
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(new Error('文件读取失败'));
      r.readAsText(file, 'utf-8');
    });
  }

  async function parseResumeFile(file) {
    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.pdf')) {
      if (typeof pdfjsLib === 'undefined') throw new Error('PDF 解析库未加载（可能网络受限），请改用 .docx / .txt 或复制正文粘贴');
      ensurePdfWorker();
      try {
        const buf = await readFileAsArrayBuffer(file);
        const data = new Uint8Array(buf);
        const pdf = await pdfjsLib.getDocument({ data }).promise;
        let text = '';
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p);
          const content = await page.getTextContent();
          text += content.items.map((it) => it.str || '').join(' ') + '\n';
        }
        if (!text.trim()) throw new Error('PDF 未提取到文字（可能是扫描件/图片型）');
        return text.trim();
      } catch (e) { throw new Error('PDF 解析失败：' + e.message); }
    }
    if (name.endsWith('.docx')) {
      if (typeof mammoth === 'undefined') throw new Error('Word 解析库未加载（可能网络受限），请改用 .pdf / .txt 或复制正文粘贴');
      try {
        const buf = await readFileAsArrayBuffer(file);
        const res = await mammoth.extractRawText({ arrayBuffer: buf });
        if (!res.value.trim()) throw new Error('未提取到文字');
        return res.value.trim();
      } catch (e) { throw new Error('Word 解析失败：' + e.message); }
    }
    if (name.endsWith('.doc')) {
      throw new Error('暂不支持老版 .doc 格式，请用 .docx 或将文件另存为 PDF / .txt 后上传');
    }
    return readFileAsText(file); // .txt / .md / 其它按纯文本
  }

  /* ============================================================
   * 3. LLM 调用（OpenAI 兼容 /chat/completions）
   * ========================================================== */

  function callLLM(messages, onDone, statusKey) {
    const sk = statusKey || '优化状态';
    const cfg = getCfg();
    if (!cfg.apiKey) {
      UI.showStatus(sk, '请先在「设置」中填写 API Key', 'err');
      UI.switchTab('settings');
      return;
    }
    const url = String(cfg.baseUrl || DEFAULT_CFG.baseUrl).replace(/\/+$/, '') + '/chat/completions';
    UI.showStatus(sk, 'AI 正在处理，请稍候…（约 10~60 秒）');

    GM_xmlhttpRequest({
      method: 'POST',
      url,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.apiKey
      },
      data: JSON.stringify({
        model: cfg.model || DEFAULT_CFG.model,
        messages,
        temperature: 0.4,
        stream: false
      }),
      timeout: 120000,
      onload(res) {
        try {
          if (res.status < 200 || res.status >= 300) {
            throw new Error(`接口返回 ${res.status}：${(res.responseText || '').slice(0, 200)}`);
          }
          const data = JSON.parse(res.responseText);
          const content = data.choices?.[0]?.message?.content?.trim();
          if (!content) throw new Error('接口未返回内容');
          onDone(content);
        } catch (e) {
          UI.showStatus(sk, '调用失败：' + e.message, 'err');
        }
      },
      onerror(err) {
        UI.showStatus(sk, '网络错误：' + (err.error || '无法连接接口，请检查 baseUrl 是否正确'), 'err');
      },
      ontimeout() {
        UI.showStatus(sk, '请求超时，请重试或更换模型', 'err');
      }
    });
  }

  function optimizeResume() {
    const jd = getStore(STORE_KEYS.jd, '');
    const resume = getStore(STORE_KEYS.resume, '');
    if (!jd || jd.length < 30) { toast('请先在「JD」页抓取或粘贴岗位信息', 'err'); UI.switchTab('jd'); return; }
    if (!resume || resume.length < 50) { toast('请先在「简历」页上传或粘贴简历', 'err'); UI.switchTab('resume'); return; }

    const messages = [
      {
        role: 'system',
        content: [
          '你是一位资深猎头与简历优化专家，精通 HR 筛选简历的逻辑。',
          '请根据目标岗位 JD 优化用户简历，严格遵守：',
          '1. 只重组、突出、润色用户已有的真实经历，严禁虚构任何学历、公司、项目、数据；',
          '2. 把与 JD 匹配的关键词、技能、经历前置并加重；',
          '3. 用「动词 + 做了什么 + 量化结果」的 STAR 风格改写工作与项目经历；',
          '4. 输出为结构清晰的 Markdown 简历，包含：基本信息占位、求职意向（对齐该岗位）、核心优势（3~5条，逐条对应 JD 要求）、工作经历、项目经历、技能清单；',
          '5. 直接输出简历正文，不要任何解释性开场白和结尾。'
        ].join('\n')
      },
      {
        role: 'user',
        content: `${jd}\n\n【我的原始简历】\n${resume}`
      }
    ];

    callLLM(messages, (content) => {
      setStore(STORE_KEYS.optimized, content);
      UI.renderOptimized(content);
      UI.showStatus('优化状态', '✅ 优化完成 ' + nowStr(), 'ok');
      toast('简历优化完成，正在生成对应岗位话术…', 'ok');
      generateGreeting({ silent: true });
    }, '优化状态');
  }

  /* ---- 话术模板 ---- */
  function getTemplates() {
    const t = getStore(STORE_KEYS.greetingTemplates, null);
    return (t && t.length) ? t : DEFAULT_TEMPLATES;
  }
  function getActiveTemplateId() {
    const id = getStore(STORE_KEYS.greetingTpl, '');
    const list = getTemplates();
    return list.some((x) => x.id === id) ? id : list[0].id;
  }
  function getActiveTemplate() {
    const id = getActiveTemplateId();
    return getTemplates().find((x) => x.id === id) || getTemplates()[0];
  }
  function fillTemplate(prompt, jd) {
    const m = jd || getStore(STORE_KEYS.jd, '');
    const meta = getStore(STORE_KEYS.jdMeta, {});
    const title = meta.title || (m.match(/【目标岗位】([^\s　]+)/) || [, ''])[1] || '';
    return String(prompt || '')
      .replace(/\{岗位\}/g, title)
      .replace(/\{公司\}/g, meta.company || '')
      .replace(/\{薪资\}/g, meta.salary || '')
      .replace(/\{姓名\}/g, '');
  }

  function generateGreeting(opts) {
    opts = opts || {};
    const jd = getStore(STORE_KEYS.jd, '');
    const resume = getStore(STORE_KEYS.resume, '');
    if (!jd || jd.length < 30) {
      if (!opts.silent) { toast('请先抓取 JD', 'err'); UI.switchTab('jd'); }
      return;
    }
    const tpl = getActiveTemplate();
    const sys = fillTemplate(tpl.prompt, jd);
    const messages = [
      { role: 'system', content: sys },
      { role: 'user', content: `${jd}\n\n【我的简历】\n${resume || '（未提供，请根据岗位写通用话术，留出可替换的经历占位）'}` }
    ];
    if (!opts.silent) UI.showStatus('brh-chat', 'AI 正在生成打招呼话术…');
    callLLM(messages, (content) => {
      setStore(STORE_KEYS.greeting, content);
      if (!opts.silent) {
        UI.renderGreeting(content);
        UI.showStatus('brh-chat', '✅ 话术已生成，可直接填入聊天框', 'ok');
        toast('话术已生成', 'ok');
      }
      // 若优化页正打开，刷新其话术区块
      const ga = $('#brh-opt-greet');
      if (ga) ga.value = content;
    }, opts.silent ? 'brh-optimize' : 'brh-chat');
  }

  /* ============================================================
   * 4. 导出下载（.doc / .md）
   * ========================================================== */

  function downloadFile(content, filename, mime) {
    const blob = new Blob(['\ufeff' + content], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function markdownToDocHtml(md) {
    // 轻量 Markdown → HTML（标题/加粗/列表/分隔线），足够 Word/WPS 打开排版
    const lines = md.split('\n');
    const html = [];
    let inList = false;
    const inline = (s) => esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.+?)\*/g, '<i>$1</i>')
      .replace(/`(.+?)`/g, '<span style="font-family:Consolas,monospace">$1</span>');
    for (let raw of lines) {
      const line = raw.replace(/\s+$/, '');
      const isLi = /^\s*[-*+]\s+/.test(line);
      const liContent = line.replace(/^\s*[-*+]\s+/, '');
      if (isLi && !inList) { html.push('<ul style="margin:4pt 0 4pt 18pt;">'); inList = true; }
      if (!isLi && inList) { html.push('</ul>'); inList = false; }
      if (isLi) { html.push(`<li style="margin:2pt 0;line-height:1.5;">${inline(liContent)}</li>`); }
      else if (/^#{1,6}\s/.test(line)) {
        const lv = line.match(/^#+/)[0].length;
        const sizes = ['18pt', '15pt', '13.5pt', '12.5pt', '12pt', '12pt'];
        html.push(`<p style="margin:10pt 0 4pt;font-size:${sizes[lv - 1]};font-weight:bold;">${inline(line.replace(/^#+\s*/, ''))}</p>`);
      } else if (/^(-{3,}|\*{3,})$/.test(line)) {
        html.push('<hr style="border:none;border-top:1px solid #999;margin:8pt 0;">');
      } else if (!line.trim()) {
        html.push('<p style="margin:4pt 0;">&nbsp;</p>');
      } else {
        html.push(`<p style="margin:4pt 0;line-height:1.6;">${inline(line)}</p>`);
      }
    }
    if (inList) html.push('</ul>');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>简历</title></head>` +
      `<body style="font-family:'Microsoft YaHei','PingFang SC',SimSun,sans-serif;font-size:10.5pt;color:#222;">` +
      html.join('\n') + '</body></html>';
  }

  function safeName(s) {
    return String(s || '').replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 30) || '优化简历';
  }

  function downloadOptimized(fmt) {
    const content = getStore(STORE_KEYS.optimized, '');
    if (!content) { toast('还没有优化结果，请先点击「开始优化」', 'err'); return; }
    const meta = getStore(STORE_KEYS.jdMeta, {});
    if (fmt === 'doc') {
      downloadFile(markdownToDocHtml(content), `简历-优化-${safeName(meta.title)}.doc`, 'application/msword');
    } else {
      downloadFile(content, `简历-优化-${safeName(meta.title)}.md`, 'text/markdown');
    }
    toast('已开始下载', 'ok');
  }

  /* ============================================================
   * 5. 简历版式渲染与导出（模板 → 图片 → PDF / 聊天发送）
   * ========================================================== */

  const RESUME_THEMES = {
    modern: { name: '现代简约', accent: '#00a1ea' },
    business: { name: '深色商务', accent: '#1e3a5f' }
  };

  function getResumeTheme() {
    const t = getCfg().resumeTheme || getStore(STORE_KEYS.resumeTheme, DEFAULT_CFG.resumeTheme);
    return RESUME_THEMES[t] ? t : 'modern';
  }
  function setResumeTheme(t) {
    setStore(STORE_KEYS.resumeTheme, t);
    saveCfg({ resumeTheme: t });
  }

  function inlineMd(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  }

  // 把优化后的 Markdown 解析成结构化数据（姓名 / 求职意向 / 分区）
  function parseResumeMarkdown(md) {
    const lines = String(md || '').split(/\r?\n/);
    const data = { name: '', headline: '', sections: [] };
    let cur = null;
    const ensureSec = () => {
      if (!cur) { cur = { title: '', paras: [], items: [] }; data.sections.push(cur); }
      return cur;
    };
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || /^(-{3,}|\*{3,}|={3,})$/.test(line)) continue;
      const h1 = line.match(/^#\s+(.*)$/);
      const h2 = line.match(/^##\s+(.*)$/);
      const h3 = line.match(/^###\s+(.*)$/);
      const li = line.match(/^[-*+]\s+(.*)$/);
      if (h1) { if (!data.name) data.name = h1[1].trim(); else { ensureSec().items.push({ sub: h1[1].trim() }); } continue; }
      if (h2) { cur = { title: h2[1].trim(), paras: [], items: [] }; data.sections.push(cur); continue; }
      if (h3) { ensureSec().items.push({ sub: h3[1].trim() }); continue; }
      if (li) { ensureSec().items.push({ text: li[1].trim() }); continue; }
      if (!data.name) { data.name = line.replace(/^#+\s*/, ''); continue; }
      if (!data.headline && !cur) { data.headline = line; continue; }
      ensureSec().paras.push(line);
    }
    return data;
  }

  // 生成好看的简历 HTML（A4 宽度 794px ≈ 210mm @96dpi）
  function buildResumeHTML(md, theme) {
    const d = parseResumeMarkdown(md);
    const meta = getStore(STORE_KEYS.jdMeta, {});
    const accent = RESUME_THEMES[theme] ? RESUME_THEMES[theme].accent : '#00a1ea';
    const name = d.name || '个人简历';
    const head = d.headline ||
      (meta.title ? `求职意向：${meta.title}${meta.salary ? '　·　' + meta.salary : ''}` : '');
    const today = nowStr().slice(0, 10);

    const sectionsHtml = d.sections.map((s) => {
      let inner = '';
      (s.paras || []).forEach((p) => { inner += `<div class="rs-p">${inlineMd(p)}</div>`; });
      (s.items || []).forEach((it) => {
        inner += it.sub
          ? `<div class="rs-sub">${inlineMd(it.sub)}</div>`
          : `<div class="rs-li"><span class="rs-dot"></span><div>${inlineMd(it.text)}</div></div>`;
      });
      const titleHtml = s.title ? `<div class="rs-sec-t">${inlineMd(s.title)}</div>` : '';
      return `<div class="rs-sec">${titleHtml}${inner}</div>`;
    }).join('');

    const foot = `<div class="rs-foot">由 Boss招聘小助手 生成 · ${today}${meta.company ? ' · 投递：' + inlineMd(meta.company) : ''}</div>`;

    const style = `
      .rs-wrap{ width:794px; background:#fff; font-family:'Microsoft YaHei','PingFang SC','Hiragino Sans GB',sans-serif; color:#222; box-sizing:border-box; }
      .rs-wrap *{ box-sizing:border-box; }
      .rs-sec{ margin-bottom:14px; }
      .rs-sec-t{ font-size:15px; font-weight:700; color:${accent}; padding:4px 0 5px 10px; border-left:4px solid ${accent}; margin-bottom:8px; letter-spacing:.5px; }
      .rs-sub{ font-size:13px; font-weight:700; color:#333; margin:9px 0 4px; }
      .rs-p{ font-size:12.5px; line-height:1.75; margin:3px 0; color:#333; }
      .rs-li{ display:flex; align-items:flex-start; font-size:12.5px; line-height:1.75; margin:3px 0; color:#333; }
      .rs-dot{ flex:0 0 auto; width:5px; height:5px; background:${accent}; border-radius:50%; margin:9px 8px 0 2px; }
      .rs-li>div{ flex:1; }
      .rs-foot{ font-size:10.5px; color:#aaa; text-align:center; margin-top:16px; padding-top:8px; border-top:1px dashed #e3e3e3; }
      .rs-modern{ padding:34px 46px 26px; }
      .rs-modern .rs-top{ border-bottom:3px solid ${accent}; padding-bottom:12px; margin-bottom:16px; }
      .rs-modern .rs-name{ font-size:29px; font-weight:700; color:#1a1a1a; letter-spacing:2px; }
      .rs-modern .rs-head{ font-size:13px; color:#666; margin-top:7px; }
      .rs-business{ display:flex; min-height:1123px; }
      .rs-business .rs-side{ width:236px; flex:0 0 236px; background:${accent}; color:#fff; padding:34px 26px; }
      .rs-business .rs-side .rs-name{ font-size:26px; font-weight:700; letter-spacing:2px; line-height:1.3; }
      .rs-business .rs-side .rs-line{ width:38px; height:3px; background:#fff; opacity:.85; margin:14px 0; }
      .rs-business .rs-side .rs-head{ font-size:12.5px; line-height:1.8; opacity:.92; }
      .rs-business .rs-side .rs-tag{ margin-top:18px; font-size:11px; opacity:.75; line-height:1.7; }
      .rs-business .rs-main{ flex:1; padding:34px 38px 26px; background:#fff; }
    `;

    const body = theme === 'business'
      ? `<div class="rs-wrap rs-business">
           <div class="rs-side">
             <div class="rs-name">${inlineMd(name)}</div>
             <div class="rs-line"></div>
             <div class="rs-head">${inlineMd(head)}</div>
             <div class="rs-tag">Boss招聘小助手<br>定制优化简历</div>
           </div>
           <div class="rs-main">${sectionsHtml}${foot}</div>
         </div>`
      : `<div class="rs-wrap rs-modern">
           <div class="rs-top">
             <div class="rs-name">${inlineMd(name)}</div>
             ${head ? `<div class="rs-head">${inlineMd(head)}</div>` : ''}
           </div>
           ${sectionsHtml}${foot}
         </div>`;

    return `<style>${style}</style>${body}`;
  }

  // 用 html2canvas 把模板渲染成画布（离屏，渲染完立即移除）
  function renderResumeCanvas(opts = {}) {
    const content = getStore(STORE_KEYS.optimized, '');
    if (!content) { toast('还没有优化简历，请先点击「开始优化」', 'err'); return Promise.reject(new Error('no-content')); }
    if (typeof window.html2canvas !== 'function') {
      toast('图片渲染库未加载（多为网络受限），请刷新页面重试，或改用「下载 .doc」', 'err');
      return Promise.reject(new Error('html2canvas-missing'));
    }
    const theme = opts.theme || getResumeTheme();
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;z-index:-1;opacity:1;';
    host.innerHTML = buildResumeHTML(content, theme);
    document.body.appendChild(host);
    const target = host.firstElementChild;
    return window.html2canvas(target, {
      scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, imageTimeout: 15000
    }).then((canvas) => {
      if (host.parentNode) host.parentNode.removeChild(host);
      return canvas;
    }).catch((e) => {
      if (host.parentNode) host.parentNode.removeChild(host);
      toast('简历渲染失败：' + ((e && e.message) || '未知错误'), 'err');
      throw e;
    });
  }

  function canvasDownload(canvas, fileName) {
    canvas.toBlob((blob) => {
      if (!blob) { toast('图片生成失败', 'err'); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1200);
      toast('已下载简历图片：' + fileName, 'ok');
    }, 'image/png');
  }

  // canvas → 多页 A4 PDF
  function canvasToPdf(canvas, fileName) {
    const JSPDF = window.jspdf && window.jspdf.jsPDF;
    if (!JSPDF) {
      toast('PDF 库未加载，已改为下载图片', 'err');
      canvasDownload(canvas, String(fileName).replace(/\.pdf$/i, '.png'));
      return;
    }
    const pdf = new JSPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageW = 210, pageH = 297;
    const imgW = pageW;
    const imgH = canvas.height * (pageW / canvas.width);
    const imgData = canvas.toDataURL('image/jpeg', 0.94);
    let heightLeft = imgH;
    let position = 0;
    pdf.addImage(imgData, 'JPEG', 0, position, imgW, imgH);
    heightLeft -= pageH;
    while (heightLeft > 0) {
      position = heightLeft - imgH;
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, position, imgW, imgH);
      heightLeft -= pageH;
    }
    pdf.save(fileName);
  }

  function downloadResumePDF() {
    if (!getStore(STORE_KEYS.optimized, '')) { toast('还没有优化结果，请先点击「开始优化」', 'err'); return; }
    toast('正在渲染简历并生成 PDF，请稍候…', 'info');
    renderResumeCanvas().then((canvas) => {
      const meta = getStore(STORE_KEYS.jdMeta, {});
      canvasToPdf(canvas, `简历-优化-${safeName(meta.title)}.pdf`);
      toast('PDF 已下载', 'ok');
    }).catch(() => {});
  }

  function downloadResumeImage() {
    if (!getStore(STORE_KEYS.optimized, '')) { toast('还没有优化结果，请先点击「开始优化」', 'err'); return; }
    toast('正在渲染简历图片，请稍候…', 'info');
    renderResumeCanvas().then((canvas) => {
      const meta = getStore(STORE_KEYS.jdMeta, {});
      canvasDownload(canvas, `简历-优化-${safeName(meta.title)}.png`);
    }).catch(() => {});
  }

  /* ============================================================
   * 6. 聊天页动作（填话术 + 发送简历图片）
   * ========================================================== */

  const CHAT_INPUT_SELECTORS = [
    'textarea.edit-area',
    '.chat-input textarea',
    '#chat-input',
    'div[contenteditable="true"]',
    'textarea[placeholder*="输入"]',
    'textarea'
  ];
  const FILE_INPUT_SELECTORS = ['input[type="file"]'];

  function findChatInput() {
    for (const sel of CHAT_INPUT_SELECTORS) {
      const els = $$(sel);
      const el = els.find((x) => x.offsetParent !== null) || els[0];
      if (el) return el;
    }
    return null;
  }

  function fillGreeting(message) {
    const input = findChatInput();
    if (!input) {
      toast('未找到聊天输入框：请确认已打开与 HR 的对话，然后重试', 'err');
      return;
    }
    if (input.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(input, message);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      input.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, message);
      input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
    toast('话术已填入聊天框，请检查后点击发送', 'ok');
  }

  // 把优化后的简历渲染成图片，并附加到当前 HR 对话
  function sendResumeImage() {
    const content = getStore(STORE_KEYS.optimized, '');
    if (!content) { toast('还没有优化简历，请先在「优化」页生成', 'err'); UI.switchTab('optimize'); return; }

    const fileInput = FILE_INPUT_SELECTORS.map((s) => $(s)).find(Boolean);
    toast('正在渲染简历图片，请稍候…', 'info');
    renderResumeCanvas().then((canvas) => {
      canvas.toBlob((blob) => {
        if (!blob) { toast('图片生成失败，请改用「下载 PDF」', 'err'); return; }
        const meta = getStore(STORE_KEYS.jdMeta, {});
        const fileName = `简历-${safeName(meta.title) || '优化'}.png`;
        const file = new File([blob], fileName, { type: 'image/png' });

        if (!fileInput) {
          canvasDownload(canvas, fileName);
          toast('未找到聊天上传入口，图片已下载，请手动点击聊天窗口「图片」按钮发送', 'err');
          return;
        }
        const dt = new DataTransfer();
        dt.items.add(file);
        try {
          fileInput.files = dt.files;
          fileInput.dispatchEvent(new Event('change', { bubbles: true }));
          toast('简历图片已附加，请在预览中确认无误后发送', 'ok');
        } catch (e) {
          canvasDownload(canvas, fileName);
          toast('页面限制自动附加，图片已下载，请手动发送', 'err');
        }
      }, 'image/png');
    }).catch(() => {});
  }

  /* ============================================================
   * 6. UI 面板
   * ========================================================== */

  const UI = {
    root: null, tabs: {},

    init() {
      // 悬浮球（面板收起时显示）
      const fab = document.createElement('button');
      fab.className = 'brh-fab';
      fab.textContent = '💼';
      fab.title = 'Boss招聘小助手';
      fab.onclick = () => { fab.classList.add('brh-hide'); this.root.classList.remove('brh-hide'); };
      document.body.appendChild(fab);
      this.fab = fab;

      const panel = document.createElement('div');
      panel.id = 'brh-panel';
      panel.innerHTML = `
        <div class="brh-header" id="brh-header">
          <b>💼 Boss招聘小助手</b>
          <span class="brh-min" id="brh-min" title="收起">—</span>
        </div>
        <div class="brh-tabs">
          <div class="brh-tab on" data-tab="jd">📋 JD</div>
          <div class="brh-tab" data-tab="resume">📄 简历</div>
          <div class="brh-tab" data-tab="optimize">✨ 优化</div>
          <div class="brh-tab" data-tab="chat">💬 聊天</div>
          <div class="brh-tab" data-tab="match">🔍 选岗</div>
          <div class="brh-tab" data-tab="settings">⚙️</div>
        </div>
        <div class="brh-body" id="brh-body"></div>
      `;
      document.body.appendChild(panel);
      this.root = panel;

      $('#brh-min').onclick = () => { panel.classList.add('brh-hide'); fab.classList.remove('brh-hide'); };
      $$('.brh-tab', panel).forEach((t) => {
        t.onclick = () => this.switchTab(t.dataset.tab);
      });
      this.makeDraggable(panel, $('#brh-header'));

      this.switchTab('jd');
    },

    makeDraggable(panel, handle) {
      let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
      handle.addEventListener('mousedown', (e) => {
        if (e.target.id === 'brh-min') return;
        dragging = true;
        const rect = panel.getBoundingClientRect();
        ox = rect.left; oy = rect.top;
        sx = e.clientX; sy = e.clientY;
        panel.style.right = 'auto';
        e.preventDefault();
      });
      document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        panel.style.left = Math.max(0, Math.min(window.innerWidth - 80, ox + e.clientX - sx)) + 'px';
        panel.style.top = Math.max(0, Math.min(window.innerHeight - 60, oy + e.clientY - sy)) + 'px';
      });
      document.addEventListener('mouseup', () => { dragging = false; });
    },

    switchTab(name) {
      $$('.brh-tab', this.root).forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
      const body = $('#brh-body', this.root);
      const renderers = {
        jd: () => this.renderJdTab(),
        resume: () => this.renderResumeTab(),
        optimize: () => this.renderOptimizeTab(),
        chat: () => this.renderChatTab(),
        match: () => this.renderMatchTab(),
        settings: () => this.renderSettingsTab()
      };
      body.innerHTML = '';
      (renderers[name] || renderers.jd)();
    },

    showStatus(idPrefix, msg, type) {
      const el = $(`#${idPrefix}-status`) || $('#brh-optimize-status');
      if (el) {
        el.textContent = msg;
        el.className = 'brh-status' + (type ? ' ' + type : '');
      }
      if (type === 'err') toast(msg, 'err');
    },

    /* ---- JD 页 ---- */
    renderJdTab() {
      const body = $('#brh-body', this.root);
      const jd = getStore(STORE_KEYS.jd, '');
      const meta = getStore(STORE_KEYS.jdMeta, {});
      body.innerHTML = `
        <div class="brh-row">
          <button class="brh-btn" id="brh-grab">🎯 抓取本页岗位 JD</button>
          <button class="brh-btn ghost sm" id="brh-clear-jd">清空</button>
        </div>
        <div class="brh-tip brh-row" id="brh-jd-meta">${meta.title ? `已捕获：<span class="brh-chip">${esc(meta.title)}</span>${meta.salary ? `<span class="brh-chip">${esc(meta.salary)}</span>` : ''}${meta.company ? `<span class="brh-chip">${esc(meta.company)}</span>` : ''}` : '在职位详情页点击「抓取」，或在聊天页右侧岗位卡上点击后抓取；抓不到可直接在下方粘贴 JD。'}</div>
        <textarea class="brh-area" id="brh-jd-area" style="min-height:200px" placeholder="岗位职责 / 任职要求 将显示在这里，可手动编辑补充…">${esc(jd)}</textarea>
        <div class="brh-status" id="brh-jd-status"></div>
      `;
      $('#brh-grab').onclick = () => {
        const r = extractJD();
        if (!r.sections.length && !r.title) {
          this.showStatus('brh-jd', '未在本页识别到岗位信息，请手动粘贴 JD', 'err');
          return;
        }
        setStore(STORE_KEYS.jd, jdToText(r));
        setStore(STORE_KEYS.jdMeta, { title: r.title, company: r.company, salary: r.salary, url: location.href, time: nowStr() });
        this.renderJdTab();
        this.showStatus('brh-jd', `✅ 已捕获 ${r.sections.length} 个板块（${nowStr()}）`, 'ok');
        toast('JD 抓取成功', 'ok');
      };
      $('#brh-clear-jd').onclick = () => { setStore(STORE_KEYS.jd, ''); setStore(STORE_KEYS.jdMeta, {}); this.renderJdTab(); };
      $('#brh-jd-area').addEventListener('change', (e) => {
        setStore(STORE_KEYS.jd, e.target.value);
        this.showStatus('brh-jd', '已保存手动编辑', 'ok');
      });
    },

    /* ---- 简历页 ---- */
    renderResumeTab() {
      const body = $('#brh-body', this.root);
      const resume = getStore(STORE_KEYS.resume, '');
      body.innerHTML = `
        <div class="brh-row">
          <label class="brh-btn green" style="cursor:pointer">📎 上传简历（PDF / Word / TXT / MD）
            <input type="file" id="brh-resume-file" accept=".pdf,.docx,.doc,.txt,.md,.markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" style="display:none">
          </label>
        </div>
        <div class="brh-tip brh-row">支持 PDF、Word(.docx)、TXT、MD。老版 .doc 暂不支持（请另存为 .docx 或 PDF）。解析全程在本地浏览器完成，不上传任何服务器。</div>
        <textarea class="brh-area" id="brh-resume-area" style="min-height:220px" placeholder="粘贴或上传你的简历全文（教育背景、工作经历、项目经历、技能…）">${esc(resume)}</textarea>
        <div class="brh-status" id="brh-resume-status">${resume ? '已有简历 ' + resume.length + ' 字' : ''}</div>
      `;
      $('#brh-resume-file').addEventListener('change', async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        this.showStatus('brh-resume', '正在解析 ' + f.name + ' …');
        try {
          const text = await parseResumeFile(f);
          setStore(STORE_KEYS.resume, text.trim());
          this.renderResumeTab();
          this.showStatus('brh-resume', '✅ 已载入 ' + f.name + '（' + text.trim().length + ' 字）', 'ok');
        } catch (err) {
          this.showStatus('brh-resume', '解析失败：' + err.message + '。可直接复制正文粘贴到下方。', 'err');
        }
      });
      $('#brh-resume-area').addEventListener('change', (e) => {
        setStore(STORE_KEYS.resume, e.target.value.trim());
        this.showStatus('brh-resume', '已保存，共 ' + e.target.value.trim().length + ' 字', 'ok');
      });
    },

    /* ---- 优化页 ---- */
    renderOptimizeTab() { this.renderOptimized(getStore(STORE_KEYS.optimized, '')); },

    renderOptimized(content) {
      const body = $('#brh-body', this.root);
      const jd = getStore(STORE_KEYS.jd, '');
      const resume = getStore(STORE_KEYS.resume, '');
      const greeting = getStore(STORE_KEYS.greeting, '');
      const tpl = getActiveTemplate();
      body.innerHTML = `
        <div class="brh-row">
          <span class="brh-chip">JD ${jd ? jd.length + ' 字' : '未抓取'}</span>
          <span class="brh-chip">简历 ${resume ? resume.length + ' 字' : '未上传'}</span>
        </div>
        <div class="brh-row">
          <button class="brh-btn" id="brh-optimize" ${(!jd || !resume) ? 'disabled title="请先完成 JD 抓取与简历上传"' : ''}>🚀 开始优化</button>
        </div>
        <div class="brh-status" id="brh-optimize-status">${content ? '✅ 已有优化结果 ' + nowStr() : ''}</div>
        ${content ? `
        <div class="brh-row">
          <button class="brh-btn green sm" id="brh-dl-pdf">⬇️ 下载 PDF</button>
          <button class="brh-btn ghost sm" id="brh-dl-doc">⬇️ 下载 .doc</button>
          <button class="brh-btn ghost sm" id="brh-dl-img">🖼 下载简历图片</button>
        </div>
        <div class="brh-row">
          <span class="brh-chip">当前版式：${esc(RESUME_THEMES[getResumeTheme()].name)}</span>
          <button class="brh-btn ghost sm" id="brh-theme-switch">🎨 切换版式</button>
        </div>
        <textarea class="brh-area" id="brh-opt-area" style="min-height:240px">${esc(content)}</textarea>
        <div class="brh-tip">可手动微调后重新下载；发送给 HR 前建议通读一遍，确保经历真实。</div>
        <div class="brh-row" style="margin-top:12px">
          <div class="brh-label">📨 该岗位专属打招呼话术<span class="brh-chip">模板：${esc(tpl.name)}</span></div>
          <textarea class="brh-area" id="brh-opt-greet" style="min-height:110px" placeholder="点「开始优化」后自动生成，也可点下方「重新生成」">${esc(greeting)}</textarea>
          <div class="brh-row" style="margin-top:6px">
            <button class="brh-btn green sm" id="brh-opt-greet-copy">📋 复制话术</button>
            <button class="brh-btn ghost sm" id="brh-opt-greet-fill">📝 填入聊天框</button>
            <button class="brh-btn sm" id="brh-opt-greet-regen">🔄 重新生成</button>
          </div>
          <div class="brh-tip">话术随「开始优化」自动产出（使用当前话术模板）。不满意可换模板后点「重新生成」，或去「💬 聊天」页管理模板。</div>
        </div>` : ''}
      `;
      const btn = $('#brh-optimize');
      if (btn) btn.onclick = () => {
        btn.disabled = true;
        btn.textContent = '⏳ 优化中…';
        optimizeResume();
        setTimeout(() => { btn.disabled = false; btn.textContent = '🚀 开始优化'; }, 1500);
      };
      const pdfBtn = $('#brh-dl-pdf'); if (pdfBtn) pdfBtn.onclick = downloadResumePDF;
      const doc = $('#brh-dl-doc'); if (doc) doc.onclick = () => downloadOptimized('doc');
      const imgBtn = $('#brh-dl-img'); if (imgBtn) imgBtn.onclick = downloadResumeImage;
      const ths = $('#brh-theme-switch'); if (ths) ths.onclick = () => {
        setResumeTheme(getResumeTheme() === 'modern' ? 'business' : 'modern');
        const nm = RESUME_THEMES[getResumeTheme()].name;
        toast('已切换为「' + nm + '」版式', 'ok');
        this.renderOptimized(getStore(STORE_KEYS.optimized, ''));
      };
      const area = $('#brh-opt-area');
      if (area) area.addEventListener('change', (e) => {
        setStore(STORE_KEYS.optimized, e.target.value);
        this.showStatus('brh-optimize', '已保存手动修改', 'ok');
      });
      const greet = $('#brh-opt-greet');
      if (greet) greet.addEventListener('change', (e) => setStore(STORE_KEYS.greeting, e.target.value));
      const copyBtn = $('#brh-opt-greet-copy');
      if (copyBtn) copyBtn.onclick = () => {
        const v = $('#brh-opt-greet').value.trim();
        if (!v) { toast('暂无话术，请先优化或生成', 'err'); return; }
        navigator.clipboard.writeText(v).then(() => toast('话术已复制', 'ok'), () => toast('复制失败，请手动选择', 'err'));
      };
      const fillBtn = $('#brh-opt-greet-fill');
      if (fillBtn) fillBtn.onclick = () => fillGreeting($('#brh-opt-greet').value.trim());
      const regen = $('#brh-opt-greet-regen');
      if (regen) regen.onclick = () => {
        if (!jd) { toast('请先抓取 JD', 'err'); return; }
        generateGreeting({ silent: true });
        toast('正在重新生成话术…', 'info');
      };
    },

    /* ---- 聊天页 ---- */
    renderChatTab() { this.renderGreeting(getStore(STORE_KEYS.greeting, '')); },

    renderGreeting(content) {
      const body = $('#brh-body', this.root);
      const optimized = getStore(STORE_KEYS.optimized, '');
      const isChat = /\/web\/geek\/chat|\/chat/.test(location.pathname);
      body.innerHTML = `
        <div class="brh-row">
          <span class="brh-chip">优化简历 ${optimized ? '已就绪' : '未生成'}</span>
          <span class="brh-chip">${isChat ? '当前在聊天页 ✓' : '非聊天页'}</span>
        </div>
        <div class="brh-row">
          <button class="brh-btn" id="brh-gen-greeting">✍️ 生成打招呼话术</button>
        </div>
        <div class="brh-status" id="brh-chat-status"></div>
        ${content ? `
        <textarea class="brh-area" id="brh-greet-area" style="min-height:110px">${esc(content)}</textarea>
        <div class="brh-row" style="margin-top:8px">
          <button class="brh-btn green" id="brh-fill">📝 填入聊天框</button>
        </div>
        <div class="brh-row" style="margin-top:10px">
          <button class="brh-btn warn" id="brh-attach" ${optimized ? '' : 'disabled'}>🖼 向当前对话发送简历图片</button>
        </div>
        <div class="brh-tip">提示：填入话术后请人工检查再发送。简历会以<b>图片</b>形式附加（排版好看、手机端不乱码）；若页面拦截自动附加，脚本会自动把图片下载到本地，你手动点聊天窗口「图片」按钮发送即可。版式可在「✨ 优化」页切换。</div>` : `
        <div class="brh-tip">先生成打招呼话术；然后可一键填入 Boss 聊天框，并把优化后的简历以图片形式发给当前 HR。</div>`}
      `;
      const gen = $('#brh-gen-greeting'); if (gen) gen.onclick = generateGreeting;
      const area = $('#brh-greet-area');
      if (area) area.addEventListener('change', (e) => setStore(STORE_KEYS.greeting, e.target.value));
      const fill = $('#brh-fill'); if (fill) fill.onclick = () => fillGreeting($('#brh-greet-area').value.trim());
      const attach = $('#brh-attach'); if (attach) attach.onclick = sendResumeImage;
    },

    /* ---- 选岗页 ---- */
    renderMatchTab() {
      const body = $('#brh-body', this.root);
      const resume = getStore(STORE_KEYS.resume, '');
      if (!resume) {
        body.innerHTML = `<div class="brh-tip brh-row">请先在「📄 简历」页上传 / 粘贴你的简历，才能在本页筛选匹配岗位。<button class="brh-btn ghost sm" id="brh-go-resume">去上传简历</button></div>`;
        const g = $('#brh-go-resume'); if (g) g.onclick = () => this.switchTab('resume');
        return;
      }
      const isList = /\/web\/geek\/job/.test(location.pathname) || /\/web\/geek\/searchjob/.test(location.pathname);
      const lastRes = getStore(STORE_KEYS.matchRes, null);
      body.innerHTML = `
        <div class="brh-tip brh-row">简历 ${resume.length} 字已就绪。在 Boss 职位列表页（左侧岗位列表）点击「扫描匹配」，按简历匹配度为本页岗位打分、筛选并应用。</div>
        ${isList ? '' : '<div class="brh-tip brh-row" style="color:#f59e0b">当前不是职位列表页，可能扫描不到岗位；请打开 Boss 搜索结果列表页再试。</div>'}
        <div class="brh-row">
          <button class="brh-btn" id="brh-scan">🔍 扫描本页岗位并匹配</button>
        </div>
        <div class="brh-seg" id="brh-mode">
          <button data-mode="ai" class="on">AI 匹配</button>
          <button data-mode="local">本地关键词</button>
        </div>
        <div class="brh-row" id="brh-filter-row" style="display:${lastRes ? '' : 'none'}">
          <button class="brh-btn green sm" id="brh-only-good">✅ 只看合适岗位</button>
          <button class="brh-btn ghost sm" id="brh-show-all">↺ 显示全部</button>
        </div>
        <div class="brh-status" id="brh-match-status"></div>
        <div id="brh-match-list"></div>
      `;
      const mode = { v: 'ai' };
      $$('#brh-mode button').forEach((b) => { b.onclick = () => { mode.v = b.dataset.mode; $$('#brh-mode button').forEach((x) => x.classList.toggle('on', x === b)); }; });
      const scan = $('#brh-scan'); if (scan) scan.onclick = () => runMatch(mode.v);
      const og = $('#brh-only-good'); if (og) og.onclick = () => filterPage('good');
      const sa = $('#brh-show-all'); if (sa) sa.onclick = () => filterPage('all');
      if (lastRes) {
        const jobs = extractJobCards();
        const byIdx = {};
        lastRes.forEach((r) => { byIdx[r.idx] = r; });
        renderMatchList(jobs, byIdx);
      }
    },

    /* ---- 设置页 ---- */
    renderSettingsTab() {
      const body = $('#brh-body', this.root);
      const cfg = getCfg();
      const lic = getStore(STORE_KEYS.license, '');
      const tpl = getActiveTemplate();
      body.innerHTML = `
        <div class="brh-row">
          <span class="brh-chip">版本 v${VERSION}</span>
          <button class="brh-btn ghost sm" id="brh-check-update">🔄 检查更新</button>
        </div>
        <div class="brh-status" id="brh-update-status"></div>
        <div class="brh-row">
          <label class="brh-label">接口地址（OpenAI 兼容 Base URL）</label>
          <input class="brh-input" id="brh-cfg-url" value="${esc(cfg.baseUrl)}" placeholder="https://api.deepseek.com/v1">
          <div class="brh-tip" style="margin-top:3px">DeepSeek: https://api.deepseek.com/v1 ｜ 通义: https://dashscope.aliyuncs.com/compatible-mode/v1 ｜ Kimi: https://api.moonshot.cn/v1 ｜ OpenAI: https://api.openai.com/v1</div>
        </div>
        <div class="brh-row">
          <label class="brh-label">API Key</label>
          <input class="brh-input" id="brh-cfg-key" type="password" value="${esc(cfg.apiKey)}" placeholder="sk-...">
        </div>
        <div class="brh-row">
          <label class="brh-label">模型名称</label>
          <input class="brh-input" id="brh-cfg-model" value="${esc(cfg.model)}" placeholder="deepseek-chat">
        </div>
        <div class="brh-row">
          <label class="brh-label">简历版式（导出 PDF / 发送图片时使用）</label>
          <select class="brh-input" id="brh-cfg-theme" style="height:30px">
            <option value="modern" ${getResumeTheme() === 'modern' ? 'selected' : ''}>现代简约（白底 + 主色标题条，通用推荐）</option>
            <option value="business" ${getResumeTheme() === 'business' ? 'selected' : ''}>深色商务（深蓝侧边栏，视觉冲击强）</option>
          </select>
        </div>
        <div class="brh-row">
          <label class="brh-label">云端更新地址（可选）</label>
          <input class="brh-input" id="brh-cfg-updateurl" value="${esc(cfg.updateUrl || '')}" placeholder="https://gitee.com/用户名/仓库/raw/master/boss-recruit-helper.user.js">
          <div class="brh-tip" style="margin-top:3px">把脚本托管到 GitHub 后填这里，「检查更新」即可发现新版本；留空则使用内置默认地址。</div>
        </div>
        <div class="brh-row">
          <button class="brh-btn green" id="brh-cfg-save">保存设置</button>
          <button class="brh-btn ghost" id="brh-cfg-test">测试连通</button>
        </div>
        <div class="brh-status" id="brh-cfg-status"></div>
        <div class="brh-row">
          <label class="brh-label">授权码（可选，售卖版启用）</label>
          <input class="brh-input" id="brh-cfg-license" value="${esc(lic)}" placeholder="留空即免费使用；售卖版在此填激活码">
          <div class="brh-tip" style="margin-top:3px">当前模板：<span class="brh-chip">${esc(tpl.name)}</span> · <button class="brh-btn ghost sm" id="brh-tpl-manage" style="margin:0">🗣 话术模板管理</button></div>
        </div>
        <div class="brh-tip">数据（Key、简历、JD）仅保存在本机油猴存储中，不会上传到任何第三方服务器（AI 优化仅请求你配置的模型接口）。<br><br>Boss招聘小助手 v${VERSION} · MIT License</div>
      `;
      $('#brh-cfg-save').onclick = () => {
        const th = $('#brh-cfg-theme') ? $('#brh-cfg-theme').value : getResumeTheme();
        setResumeTheme(th);
        saveCfg({
          baseUrl: $('#brh-cfg-url').value.trim() || DEFAULT_CFG.baseUrl,
          apiKey: $('#brh-cfg-key').value.trim(),
          model: $('#brh-cfg-model').value.trim() || DEFAULT_CFG.model,
          resumeTheme: th,
          updateUrl: $('#brh-cfg-updateurl') ? $('#brh-cfg-updateurl').value.trim() : ''
        });
        setStore(STORE_KEYS.license, $('#brh-cfg-license').value.trim());
        this.showStatus('brh-cfg', '✅ 已保存', 'ok');
      };
      $('#brh-cfg-test').onclick = () => {
        const th2 = $('#brh-cfg-theme') ? $('#brh-cfg-theme').value : getResumeTheme();
        saveCfg({
          baseUrl: $('#brh-cfg-url').value.trim() || DEFAULT_CFG.baseUrl,
          apiKey: $('#brh-cfg-key').value.trim(),
          model: $('#brh-cfg-model').value.trim() || DEFAULT_CFG.model,
          resumeTheme: th2,
          updateUrl: $('#brh-cfg-updateurl') ? $('#brh-cfg-updateurl').value.trim() : ''
        });
        setStore(STORE_KEYS.license, $('#brh-cfg-license').value.trim());
        this.showStatus('brh-cfg', '测试中…');
        callLLM([{ role: 'user', content: '回复"ok"两个字母即可' }], () => {
          this.showStatus('brh-cfg', '✅ 接口连通正常', 'ok');
        }, 'brh-cfg');
      };
      $('#brh-check-update').onclick = () => checkUpdate(false);
      $('#brh-tpl-manage').onclick = () => this.renderTemplateManager();
    },

    /* ---- 话术模板管理 ---- */
    renderTemplateManager() {
      const body = $('#brh-body', this.root);
      const list = getTemplates();
      const active = getActiveTemplateId();
      body.innerHTML = `
        <div class="brh-row"><button class="brh-btn ghost sm" id="brh-tpl-back">← 返回设置</button></div>
        <div class="brh-label">话术模板（优化后按所选模板自动生成话术）</div>
        <div id="brh-tpl-list"></div>
        <div class="brh-row" style="margin-top:8px"><button class="brh-btn green sm" id="brh-tpl-new">＋ 新建模板</button></div>
        <div class="brh-tip">模板支持占位符：{岗位} {公司} {薪资} {姓名}，会按当前岗位自动替换。</div>
      `;
      const listEl = $('#brh-tpl-list');
      list.forEach((t) => {
        const item = document.createElement('div');
        item.className = 'brh-job';
        item.innerHTML = `
          <div class="brh-job-top">
            <span class="brh-job-title">${esc(t.name)}</span>
            ${t.id === active ? '<span class="brh-badge good">当前</span>' : ''}
          </div>
          <div class="brh-job-reason" style="white-space:pre-wrap;max-height:90px;overflow:auto">${esc(t.prompt)}</div>
          <div style="text-align:right;margin-top:6px">
            ${t.id !== active ? '<button class="brh-btn sm" data-use="' + t.id + '">选用</button>' : ''}
            <button class="brh-btn ghost sm" data-edit="${t.id}">编辑</button>
            <button class="brh-btn warn sm" data-del="${t.id}">删除</button>
          </div>`;
        listEl.appendChild(item);
      });
      $$('[data-use]', listEl).forEach((b) => b.onclick = () => { setStore(STORE_KEYS.greetingTpl, b.dataset.use); this.renderTemplateManager(); toast('已切换模板', 'ok'); });
      $$('[data-edit]', listEl).forEach((b) => b.onclick = () => this.editTemplate(b.dataset.edit));
      $$('[data-del]', listEl).forEach((b) => b.onclick = () => {
        if (!confirm('删除该模板？')) return;
        const nl = getTemplates().filter((x) => x.id !== b.dataset.del);
        setStore(STORE_KEYS.greetingTemplates, nl);
        if (getActiveTemplateId() === b.dataset.del) setStore(STORE_KEYS.greetingTpl, nl[0] ? nl[0].id : 'formal');
        this.renderTemplateManager();
      });
      $('#brh-tpl-back').onclick = () => this.renderSettingsTab();
      $('#brh-tpl-new').onclick = () => this.editTemplate(null);
    },

    editTemplate(id) {
      const list = getTemplates();
      const t = id ? (list.find((x) => x.id === id) || { id: '', name: '', prompt: '' }) : { id: '', name: '', prompt: '' };
      const body = $('#brh-body', this.root);
      body.innerHTML = `
        <div class="brh-row"><button class="brh-btn ghost sm" id="brh-tpl-edit-back">← 返回</button></div>
        <div class="brh-row"><label class="brh-label">模板名称</label><input class="brh-input" id="brh-tpl-name" value="${esc(t.name)}" placeholder="如：资深版"></div>
        <div class="brh-row"><label class="brh-label">话术 Prompt（可用 {岗位}{公司}{薪资}{姓名}）</label><textarea class="brh-area" id="brh-tpl-prompt" style="min-height:200px">${esc(t.prompt)}</textarea></div>
        <div class="brh-row"><button class="brh-btn green" id="brh-tpl-save">💾 保存模板</button></div>
        <div class="brh-tip">Prompt 中说明你的角色、话术长度、语气、要突出的点；占位符会在生成时自动替换。</div>
      `;
      $('#brh-tpl-edit-back').onclick = () => this.renderTemplateManager();
      $('#brh-tpl-save').onclick = () => {
        const name = $('#brh-tpl-name').value.trim();
        const prompt = $('#brh-tpl-prompt').value.trim();
        if (!name || !prompt) { toast('名称和 Prompt 不能为空', 'err'); return; }
        let nl = getTemplates().slice();
        if (id) { const i = nl.findIndex((x) => x.id === id); nl[i] = { id, name, prompt }; }
        else { const nid = 't_' + Date.now(); nl.push({ id: nid, name, prompt }); setStore(STORE_KEYS.greetingTpl, nid); }
        setStore(STORE_KEYS.greetingTemplates, nl);
        this.renderTemplateManager();
        toast('模板已保存', 'ok');
      };
    },
  };

  /* ============================================================
   * 6.5 云端更新检查与授权
   * ========================================================== */

  function compareVersion(a, b) {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    const n = Math.max(pa.length, pb.length);
    for (let i = 0; i < n; i++) {
      const x = pa[i] || 0, y = pb[i] || 0;
      if (x > y) return 1;
      if (x < y) return -1;
    }
    return 0;
  }

  function checkUpdate(silent) {
    GM_xmlhttpRequest({
      method: 'GET', url: getUpdateUrl(), timeout: 15000,
      onload(res) {
        const m = (res.responseText || '').match(/@version\s+([0-9.]+)/);
        if (!m) { if (!silent) UI.showStatus('brh-update', '未获取到版本信息（更新地址可能未配置）', 'err'); return; }
        const latest = m[1];
        if (compareVersion(latest, VERSION) > 0) {
          UI.showStatus('brh-update', `🆕 发现新版本 v${latest}（当前 v${VERSION}）。请到「${getUpdateUrl()}」重新导入，或等待油猴自动更新。`, 'ok');
          toast('发现新版本 v' + latest, 'info');
        } else if (!silent) {
          UI.showStatus('brh-update', `✅ 已是最新（v${VERSION}）`, 'ok');
        }
      },
      onerror() { if (!silent) UI.showStatus('brh-update', '检查更新失败（网络受限或地址未配置）', 'err'); },
      ontimeout() { if (!silent) UI.showStatus('brh-update', '检查更新超时', 'err'); }
    });
  }

  function verifyLicense(code) {
    // 本地格式校验雏形；售卖版可在此接入远程校验接口（返回 true/false）
    if (!code) return true; // 未填授权码 = 免费使用
    return /^BRH-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code.trim());
  }

  /* ============================================================
   * 7. 启动
   * ========================================================== */

  function boot() {
    if (window.top !== window.self) return; // 只在顶层页面运行
    UI.init();
    // 授权码格式校验（不强制拦截，仅提示）
    const lic = getStore(STORE_KEYS.license, '');
    if (lic && !verifyLicense(lic)) toast('授权码格式不正确，请到「设置」核对', 'err');
    // 启动 24 小时后台静默检查更新（不弹窗）
    const lastCheck = getStore('brh_last_update_check', 0);
    if (Date.now() - lastCheck > 24 * 3600 * 1000) { setStore('brh_last_update_check', Date.now()); checkUpdate(true); }
    GM_registerMenuCommand('打开/收起小助手面板', () => {
      const p = $('#brh-panel');
      if (p) p.classList.toggle('brh-hide');
    });
    GM_registerMenuCommand('清空全部本地数据（JD/简历/设置）', () => {
      if (confirm('确定清空小助手保存的 JD、简历与优化结果吗？（API Key 保留）')) {
        Object.values(STORE_KEYS).forEach((k) => { if (k !== STORE_KEYS.cfg) setStore(k, ''); });
        toast('已清空', 'ok');
        UI.switchTab('jd');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
