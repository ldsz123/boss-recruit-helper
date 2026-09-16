// ==UserScript==
// @name         Boss招聘小助手（JD捕获 + 简历AI优化 + 快捷投递）
// @namespace    https://workbuddy.local/boss-recruit-helper
// @version      1.6.4
// @description  在Boss直聘一键捕获岗位JD、按简历匹配筛选岗位、支持上传PDF/Word/TXT简历并AI优化、生成多套自定义打招呼话术、云端自动更新；优化后自动产出对应岗位话术并导出 PDF/图片/投递
// @author       阿迪
// @match        https://www.zhipin.com/*
// @match        https://zhipin.com/*
// @require      https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js
// @require      https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js
// @require      https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js
// @require      https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js
// 注：导出优先用预载的 html2canvas + jsPDF 生成真实 PDF/图片文件；CDN 不可用时自动降级为 SVG 渲染 + 浏览器打印
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
    jdExplain: 'brh_jd_explain', // AI 岗位需求理解（缓存）
    resume: 'brh_resume',    // 用户原始简历文本
    resumeLibrary: 'brh_resume_lib', // 简历库：按岗位分类的简历
    optimized: 'brh_optimized', // 最近一次优化结果
    greeting: 'brh_greeting',   // 最近一次打招呼话术
    hrQuestion: 'brh_hr_question', // 最近一次 HR 提问（智能回复用）
    hrReply: 'brh_hr_reply',    // 最近一次生成的 HR 回复
    greetingTpl: 'brh_greeting_tpl',        // 当前选中的话术模板 id
    greetingTemplates: 'brh_greeting_templates', // 自定义话术模板数组（覆盖默认）
    matchRes: 'brh_match_res',  // 最近一次岗位匹配结果（数组）
    license: 'brh_license',     // 授权码（可选，售卖时启用）
    resumeTheme: 'brh_resume_theme', // 简历版式：modern / business / elegant
    updateUrl: 'brh_update_url'      // 用户自定义的云端更新地址（覆盖默认）
  };

  const DEFAULT_CFG = {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    resumeTheme: 'modern',  // modern | business | elegant
    updateUrl: ''           // 留空则使用脚本内置的默认托管地址
  };

  // 版本与云端更新：把 DEFAULT_UPDATE_URL 换成你的托管地址（或在设置页填「云端更新地址」），油猴据此自动检查更新
  const VERSION = '1.6.4';
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
   * 2.8 简历库：扫描文件夹 / 多选 PDF → AI 按岗位分类
   * ========================================================== */

  const SELF_MSG_RE = /self|mine|right|my-msg|my-message|is-me|me-item|own|sender-me/i;

  async function extractPdfText(file) {
    const text = await parseResumeFile(file);
    return { name: file.name || '未命名', text: text.trim() };
  }

  async function scanPdfFilesInDir(dirHandle, out, depth) {
    depth = depth || 0;
    if (depth > 4) return;
    try {
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file' && (entry.name || '').toLowerCase().endsWith('.pdf')) {
          try { const file = await entry.getFile(); out.push(file); } catch (e) {}
        } else if (entry.kind === 'directory' && depth < 4) {
          await scanPdfFilesInDir(entry, out, depth + 1);
        }
      }
    } catch (e) {}
  }

  async function aiCategorizeResumes(items, onDone) {
    const summaries = items.map((it, i) => ({ i, name: it.name, snippet: (it.text || '').replace(/\s+/g, ' ').slice(0, 150) }));
    const sys = [
      '你是简历分类专家。下面给出若干份简历的文件名与开头摘要，请完成：',
      '1. 按「岗位」把简历归到不同类别（如「Java 后端」「前端」「产品运营」「UI 设计」「数据分析」「行政人事」「销售」「财务」等，按实际内容判断）；',
      '2. 每份简历提取一个「岗位标题」（12 字内）；',
      '3. 只输出 JSON，不要任何解释，格式：{"categories":[{"category":"类别名","items":[{"i":序号,"title":"岗位标题"}]}]}',
      '要求：类别数 1~8 个；每份简历只归到一个类；类别名用 4~8 字中文。'
    ].join('\n');
    callLLM(
      [{ role: 'system', content: sys }, { role: 'user', content: '【简历列表】\n' + summaries.map((s) => `${s.i}. ${s.name}：${s.snippet}`).join('\n') }],
      (content) => {
        let result;
        try { const m = (content || '').match(/\{[\s\S]*\}/); result = JSON.parse(m ? m[0] : content); }
        catch (e) { result = null; }
        if (!result || !result.categories) {
          const fallbackItems = items.map((it, i) => ({ i, title: it.name.replace(/\.pdf$/i, ''), text: it.text }));
          result = { categories: [{ category: '未分类简历', items: fallbackItems }] };
        }
        const byIdx = {}; items.forEach((it, i) => { byIdx[i] = it; });
        const categories = result.categories.map((c) => ({
          category: c.category,
          items: (c.items || []).map((r) => {
            const src = byIdx[r.i];
            return { name: src ? src.name : (r.name || '未知'), title: (r.title || (src && src.name.replace(/\.pdf$/i, '')) || '未知'), text: src ? src.text : '' };
          }).filter((x) => x.text)
        })).filter((c) => c.items.length);
        onDone(categories);
      },
      'brh-lib'
    );
  }

  async function scanResumeFolder(statusCb) {
    if (typeof isPro === 'function' && !isPro('optimize')) { showLicenseModal('optimize', () => scanResumeFolder(statusCb)); return; }
    statusCb = statusCb || function () {};
    if (!('showDirectoryPicker' in window)) {
      statusCb('当前浏览器不支持文件夹选择，请使用「多选 PDF」'); toast('请改用「多选 PDF」方式', 'err'); return;
    }
    let dirHandle;
    try { dirHandle = await window.showDirectoryPicker({ mode: 'read' }); }
    catch (e) { if (e && e.name === 'AbortError') return; statusCb('未选择文件夹：' + (e && e.message || e)); return; }
    statusCb('正在扫描「' + dirHandle.name + '」…');
    const pdfs = [];
    await scanPdfFilesInDir(dirHandle, pdfs, 0);
    if (!pdfs.length) { statusCb('该文件夹（含子目录）未找到 PDF 文件'); toast('未找到 PDF', 'err'); return; }
    statusCb('找到 ' + pdfs.length + ' 份 PDF，正在解析…');
    await handlePickedFiles(pdfs, statusCb);
  }

  async function handlePickedFiles(files, statusCb) {
    if (typeof isPro === 'function' && !isPro('optimize')) { showLicenseModal('optimize', () => handlePickedFiles(files, statusCb)); return; }
    statusCb = statusCb || function () {};
    if (!files || !files.length) { statusCb('未收到文件'); return; }
    const total = files.length;
    statusCb('解析第 1/' + total + ' 份…');
    const items = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      try {
        const r = await extractPdfText(f);
        if (r.text) items.push({ name: r.name, text: r.text });
        statusCb('解析第 ' + (i + 1) + '/' + total + ' 份…（' + items.length + ' 份有效）');
      } catch (e) { statusCb('跳过 ' + (f.name || '未命名') + '：' + (e && e.message || e)); }
    }
    if (!items.length) { statusCb('没有可识别的 PDF'); toast('解析失败', 'err'); return; }
    statusCb('AI 正在按岗位分类（共 ' + items.length + ' 份）…');
    await new Promise((resolve) => {
      aiCategorizeResumes(items, (categories) => {
        setStore(STORE_KEYS.resumeLibrary, { categories, updated: Date.now() });
        UI.renderResumeTab();
        statusCb('✅ 完成：' + categories.length + ' 个岗位类别，共 ' + items.length + ' 份简历');
        toast('已分类 ' + items.length + ' 份到 ' + categories.length + ' 个岗位', 'ok');
        resolve();
      });
    });
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

  /* ---- HR 智能回复：抓取 HR 最新提问 → 结合优化简历与 JD 生成针对性回复 ---- */

  // 从聊天窗口抓取 HR 的最新消息（Boss 消息 DOM 无稳定 class，做多选择器 + 关键词兜底）
  function extractHrQuestion() {
    const candidates = [
      '.im-list .im-item .im-msg-left',
      '.im-item .msg-left',
      '.chat-message .msg-left',
      '.message-list .left',
      '[class*="msg-left"]',
      '[class*="im-msg-left"]'
    ];
    let best = '';
    for (const sel of candidates) {
      $$(sel).forEach((el) => {
        const t = txt(el);
        // 只要像「提问」的气泡：含问号/疑问词，或明显长于寒暄
        if (t && t.length > 4 && t.length < 500 && /[?？]|请教|了解|方便|期望|考虑|为什么|多久|薪资|经验|介绍|到岗|住址|离职|加班/.test(t)) {
          if (t.length >= best.length) best = t;
        }
      });
      if (best) break;
    }
    return best;
  }

  function generateHrReply(opts = {}) {
    const optimized = getStore(STORE_KEYS.optimized, '');
    if (!optimized) { toast('还没有优化简历：请先在「✨ 优化」页完成一次优化', 'err'); UI.switchTab('optimize'); return; }
    const jd = getStore(STORE_KEYS.jd, '');
    const manual = opts.manual || '';
    let question = manual || extractHrQuestion();
    if (!question) {
      // 页面上抓不到 → 让用户手动粘贴 HR 的问题
      const v = prompt('未在当前页面识别到 HR 的新提问。\n请把 HR 的问题复制粘贴到这里（留空取消）：', getStore(STORE_KEYS.hrQuestion, ''));
      if (!v || !v.trim()) return;
      question = v.trim();
    }
    setStore(STORE_KEYS.hrQuestion, question);
    if (!opts.silent) UI.showStatus('brh-chat', 'AI 正在结合优化后的简历生成针对性回复…');

    const sys = [
      '你是一位帮助求职者与 HR 沟通的顾问。根据 HR 的最新提问，用候选人的第一人称写一条 Boss 直聘回复。',
      '严格遵守：',
      '1. 只使用【优化后简历】里真实存在的经历与数据，严禁编造；',
      '2. 只回答 HR 问到的点（可顺带 1 句优势补充），不要泛泛自我介绍；',
      '3. 80~200 字，口语化但专业，分段最多 2 段，不用 emoji 和「您好」开头的模板腔；',
      '4. 如果 HR 的问题涉及简历未覆盖的信息（如到岗时间、期望薪资），给出得体的通用答法并提醒用户按实际情况确认；',
      '5. 只输出回复正文，不要引号、前缀和解释。'
    ].join('\n');
    const messages = [
      { role: 'system', content: sys },
      { role: 'user', content: [
        jd ? `【目标岗位 JD】\n${jd.slice(0, 2000)}` : '',
        `【优化后简历】\n${optimized.slice(0, 6000)}`,
        `【HR 的最新提问】\n${question}`
      ].filter(Boolean).join('\n\n') }
    ];

    callLLM(messages, (content) => {
      setStore(STORE_KEYS.hrReply, content);
      UI.renderHrReply(content, question);
      UI.showStatus('brh-chat', '✅ 回复已生成，检查后可填入聊天框', 'ok');
      if (!opts.silent) toast('针对 HR 提问的回复已生成', 'ok');
    }, 'brh-chat');
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
    modern:   { name: '现代简约', accent: '#0ea5e9', soft: '#e8f6fe', layout: 'modern' },
    business: { name: '深色商务', accent: '#1e3a5f', soft: '#eef2f7', layout: 'business' },
    elegant:  { name: '雅致衬线', accent: '#8a5a3b', soft: '#f7f0ea', layout: 'elegant' },
    ocean:    { name: '深海渐变', accent: '#2563eb', soft: '#dbeafe', layout: 'ocean' },
    vitality: { name: '活力橙红', accent: '#ea580c', soft: '#ffedd5', layout: 'vitality' },
    jade:     { name: '青玉留白', accent: '#0f766e', soft: '#ccfbf1', layout: 'jade' }
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

  /* 清洗文本：去掉零宽字符、BOM、非法 Unicode 替换符（修复乱码） */
  function cleanText(s) {
    return String(s || '')
      .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')
      .replace(/\uFFFD/g, '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      .trim();
  }

  /* ---- 岗位需求理解：用大白话讲清岗位做什么 / 需要什么能力 / 职业方向 ---- */
  function explainPosition() {
    const jd = getStore(STORE_KEYS.jd, '');
    if (!jd || jd.length < 30) { toast('请先抓取或粘贴 JD（至少 30 字）', 'err'); return; }
    const meta = getStore(STORE_KEYS.jdMeta, {});
    UI.showStatus('brh-jd', 'AI 正在解读岗位需求…');
    const sys = [
      '你是一位资深职业规划师，擅长把招聘 JD 翻译成求职者能听懂的大白话。请根据以下岗位 JD 输出中文解读（不要 Markdown 标题，直接输出正文，用「【】」标出小标题）：',
      '【岗位一句话】一句大白话讲清这个岗位每天做什么。',
      '【核心职责】3~5 条，每条一句话，聚焦「做什么」而不是空话。',
      '【硬技能要求】列出真正需要掌握的工具/技术/证书，区分「必须有」和「加分项」。',
      '【软素质要求】沟通、抗压、协作等隐性要求，结合岗位实际场景说明。',
      '【适合谁】什么专业/什么经验背景的人最匹配；转行者需要补什么。',
      '【职业方向】做 3~5 年后可以往哪些方向走，上升空间如何。',
      '【求职提示】针对该岗位，简历和面试最该突出的 2~3 个点。',
      '要求：不要照抄 JD 原文，全部用自己的话说；对模糊要求给出合理解读；总字数 600~900 字；只输出解读，不要开场白和结束语。'
    ].join('\n');
    callLLM(
      [{ role: 'system', content: sys }, { role: 'user', content: `${meta.title ? '【岗位名称】' + meta.title + '\n' : ''}${meta.company ? '【公司】' + meta.company + '\n' : ''}${meta.salary ? '【薪资】' + meta.salary + '\n' : ''}【岗位 JD】\n${jd}` }],
      (content) => {
        setStore(STORE_KEYS.jdExplain, content);
        if ($('#brh-jd-explain')) $('#brh-jd-explain').value = content;
        UI.showStatus('brh-jd', '✅ 岗位需求解读完成', 'ok');
        toast('岗位需求解读完成', 'ok');
      },
      'brh-jd'
    );
  }

  /* ---- 小红书搜索该岗位真实经验帖 ---- */
  function searchXhs(title) {
    const kw = title || getStore(STORE_KEYS.jdMeta, {}).title || '';
    if (!kw) { toast('请先获取岗位名称', 'err'); return; }
    window.open('https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(kw + ' 岗位职责 面经 薪资') + '&source=web_search_result_notes', '_blank');
    toast('已打开小红书搜索：' + kw, 'ok');
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

  // 从正文里提取联系方式，避免在页眉和正文中重复展示
  function extractContacts(md) {
    const text = String(md || '');
    return {
      phone: (text.match(/1[3-9]\d{9}/) || [])[0] || '',
      email: (text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [])[0] || ''
    };
  }

  // 技能/证书类分区用标签云展示，更像真实简历
  const CHIP_TITLE_RE = /(技能|专长|能力|证书|标签|工具|语言|Skills?)/i;

  // 生成简历 HTML（A4 宽度 794px ≈ 210mm @96dpi；打印时用 CSS 换算成 mm）
  // opts.watermark：溯源水印文本（售卖版激活后自动带授权标识，防止截图/转卖后无法追责）
  function buildResumeHTML(md, theme, opts) {
    const d = parseResumeMarkdown(md);
    const meta = getStore(STORE_KEYS.jdMeta, {});
    const th = RESUME_THEMES[theme] ? RESUME_THEMES[theme] : RESUME_THEMES.modern;
    const accent = th.accent;
    const soft = th.soft || '#eef6fc';
    const wm = (opts && opts.watermark) ? String(opts.watermark) : '';
    const ct = extractContacts(md);
    const today = nowStr().slice(0, 10);

    // 姓名行常写成「张三 — 应聘岗位」，拆开更美观
    let name = d.name || '个人简历';
    let head = d.headline || '';
    const nmSplit = name.match(/^(.{2,8}?)\s*[—–\-|｜·]\s*(.+)$/);
    if (nmSplit) { name = nmSplit[1].trim(); if (!head) head = nmSplit[2].trim(); }

    // 页眉已单独展示联系方式，正文里同款信息去掉，避免重复
    const cleanBit = (s) => {
      let t = String(s || '')
        .split(ct.phone).join('').split(ct.email).join('')
        .replace(/\*\*|__|`/g, '')
        .replace(/电\s*话\s*[:：]?/g, '').replace(/邮\s*箱\s*[:：]?/g, '');
      t = t.replace(/[\s|｜·、,，/]*[|｜][\s|｜·、,，/]*/g, ' | ');   // 分隔符规整
      return t.replace(/\s{2,}/g, ' ')
        .replace(/^[\s|｜·、,，/]+|[\s|｜·、,，/]+$/g, '')
        .trim();
    };
    head = cleanBit(head);
    if (!head) head = meta.title ? `求职意向：${meta.title}${meta.salary ? '　·　' + meta.salary : ''}` : '';

    const contactBits = [ct.phone, ct.email].filter(Boolean);
    const contactHtml = contactBits.length
      ? `<div class="rs-contact">${contactBits.map((b) => `<span>${inlineMd(b)}</span>`).join('')}</div>`
      : '';

    // 正文里若已出现联系方式，就不再重复渲染该行
    const dropContact = (t) => {
      if (!t) return false;
      if (ct.phone && t.indexOf(ct.phone) >= 0) return true;
      if (ct.email && t.indexOf(ct.email) >= 0) return true;
      return false;
    };

    const sectionsHtml = d.sections.map((s) => {
      const isChip = CHIP_TITLE_RE.test(s.title || '');
      let inner = '';
      (s.paras || []).forEach((p) => {
        if (dropContact(p)) return;
        inner += `<div class="rs-p">${inlineMd(p)}</div>`;
      });
      (s.items || []).forEach((it) => {
        if (dropContact(it.text || it.sub || '')) return;
        if (it.sub) { inner += `<div class="rs-sub">${inlineMd(it.sub)}</div>`; return; }
        if (isChip) { inner += `<span class="rs-chip">${inlineMd(it.text)}</span>`; return; }
        inner += `<div class="rs-li"><i class="rs-dot"></i><div>${inlineMd(it.text)}</div></div>`;
      });
      if (!inner) return '';
      const titleHtml = s.title
        ? `<div class="rs-sec-t"><span class="rs-bar"></span><span class="rs-sec-txt">${inlineMd(s.title)}</span><span class="rs-sec-line"></span></div>`
        : '';
      return `<div class="rs-sec">${titleHtml}${isChip ? `<div class="rs-chips">${inner}</div>` : inner}</div>`;
    }).join('');

    const wmTag = wm ? `<span class="rs-foot-lic">${esc(wm)}</span>` : '';
    const foot = `<div class="rs-foot"><span>Boss招聘小助手 · 定制优化</span><span>${today}${meta.company ? ' · 投递 ' + inlineMd(meta.company) : ''}</span>${wmTag}</div>`;
    const wmHtml = wm
      ? `<div class="rs-wm" aria-hidden="true"><span>${esc(wm)}</span><span>${esc(wm)}</span><span>${esc(wm)}</span></div>`
      : '';

    const style = `
      .rs-wrap{ width:794px; background:#fff; color:#262626; box-sizing:border-box; position:relative; overflow:hidden;
                font-family:'Microsoft YaHei','PingFang SC','Hiragino Sans GB','Source Han Sans SC',sans-serif; }
      .rs-wrap *{ box-sizing:border-box; }
      .rs-wm{ position:absolute; left:0; top:0; right:0; bottom:0; z-index:9; pointer-events:none;
              display:flex; flex-direction:column; justify-content:space-evenly; align-items:center;
              transform:rotate(-24deg); }
      .rs-wm span{ font-size:24px; font-weight:700; color:rgba(100,116,139,.06); letter-spacing:4px; white-space:nowrap; }
      .rs-foot-lic{ color:#b91c1c; opacity:.72; }
      .rs-sec{ margin-bottom:15px; }
      .rs-sec-t{ display:flex; align-items:center; margin-bottom:9px; }
      .rs-bar{ width:4px; height:15px; background:${accent}; border-radius:2px; margin-right:8px; }
      .rs-sec-txt{ font-size:15px; font-weight:700; color:${accent}; letter-spacing:1px; white-space:nowrap; }
      .rs-sec-line{ flex:1; height:1px; margin-left:10px;
                    background:linear-gradient(to right,${accent},rgba(255,255,255,0)); opacity:.5; }
      .rs-sub{ font-size:13px; font-weight:700; color:#1f2937; margin:11px 0 5px; padding-left:9px;
               border-left:3px solid ${accent}; }
      .rs-p{ font-size:12.5px; line-height:1.85; margin:3px 0; color:#374151; }
      .rs-li{ display:flex; align-items:flex-start; font-size:12.5px; line-height:1.85; margin:4px 0; color:#374151; }
      .rs-dot{ flex:0 0 auto; width:5px; height:5px; background:${accent}; border-radius:1px;
               margin:9px 9px 0 3px; transform:rotate(45deg); }
      .rs-li>div{ flex:1; }
      .rs-chips{ display:flex; flex-wrap:wrap; gap:7px; }
      .rs-chip{ display:inline-block; font-size:12px; line-height:1.6; padding:3px 11px; border-radius:11px;
                background:${soft}; color:#1f2937; border:1px solid ${accent}33; }
      .rs-foot{ display:flex; justify-content:space-between; font-size:10.5px; color:#9ca3af;
                margin-top:18px; padding-top:9px; border-top:1px dashed #e5e7eb; }
      .rs-contact{ display:flex; gap:16px; font-size:12px; color:#4b5563; }
      .rs-contact span{ display:inline-flex; align-items:center; }
      .rs-contact span::before{ content:''; width:4px; height:4px; border-radius:50%;
                                background:${accent}; margin-right:6px; }

      /* ---------- 版式一：现代简约 ---------- */
      .rs-modern{ padding:40px 48px 30px; }
      .rs-modern .rs-top{ display:flex; align-items:flex-end; justify-content:space-between;
                          padding-bottom:16px; margin-bottom:20px; border-bottom:3px solid ${accent}; }
      .rs-modern .rs-name{ font-size:31px; font-weight:700; color:#111827; letter-spacing:4px; line-height:1.2; }
      .rs-modern .rs-head{ font-size:13.5px; color:${accent}; margin-top:9px; font-weight:600; letter-spacing:.5px; }

      /* ---------- 版式二：深色商务（左右分栏） ---------- */
      .rs-business{ display:flex; min-height:1123px; }
      .rs-business .rs-side{ width:240px; flex:0 0 240px; background:${accent}; color:#fff; padding:40px 26px; }
      .rs-business .rs-side .rs-name{ font-size:27px; font-weight:700; letter-spacing:3px; line-height:1.35; }
      .rs-business .rs-side .rs-line{ width:40px; height:3px; background:#fff; opacity:.9; margin:16px 0 14px; }
      .rs-business .rs-side .rs-head{ font-size:12.5px; line-height:1.9; opacity:.95; }
      .rs-business .rs-side .rs-contact{ margin-top:14px; color:#fff; opacity:.9; font-size:11.5px; flex-direction:column; gap:5px; }
      .rs-business .rs-side .rs-contact span::before{ background:#fff; }
      .rs-business .rs-side .rs-tag{ margin-top:24px; font-size:11px; opacity:.72; line-height:1.8;
                                     border-top:1px solid rgba(255,255,255,.28); padding-top:12px; }
      .rs-business .rs-main{ flex:1; padding:40px 40px 30px; background:#fff; }
      .rs-business .rs-sec-txt{ color:${accent}; }

      /* ---------- 版式三：雅致衬线 ---------- */
      .rs-elegant{ padding:44px 52px 30px; font-family:Georgia,'Songti SC','SimSun','Microsoft YaHei',serif; }
      .rs-elegant .rs-top{ text-align:center; padding-bottom:18px; margin-bottom:22px;
                           border-bottom:1px solid ${accent}; position:relative; }
      .rs-elegant .rs-top::after{ content:''; position:absolute; left:50%; bottom:-4px; width:56px; height:7px;
                                  margin-left:-28px; background:#fff; border-left:1px solid ${accent};
                                  border-right:1px solid ${accent}; }
      .rs-elegant .rs-name{ font-size:30px; font-weight:700; color:${accent}; letter-spacing:6px; }
      .rs-elegant .rs-head{ font-size:13px; color:#6b7280; margin-top:10px; letter-spacing:1px; }
      .rs-elegant .rs-contact{ justify-content:center; margin-top:8px; }
      .rs-elegant .rs-sec-txt{ color:${accent}; font-weight:600; }
      .rs-elegant .rs-bar{ background:${accent}; }

      /* ---------- 版式四：深海渐变（渐变横幅头部） ---------- */
      .rs-ocean{ padding:0 48px 30px; }
      .rs-ocean .rs-top{ margin:0 -48px 24px; padding:34px 48px 26px; color:#fff;
                         background:linear-gradient(120deg,${accent} 0%,${accent}dd 55%,#7c3aed 130%);
                         display:flex; align-items:flex-end; justify-content:space-between; }
      .rs-ocean .rs-name{ font-size:31px; font-weight:700; letter-spacing:5px; color:#fff; }
      .rs-ocean .rs-head{ font-size:13px; margin-top:9px; color:#fff; opacity:.92; letter-spacing:.5px; }
      .rs-ocean .rs-contact{ color:rgba(255,255,255,.92); font-size:11.5px; gap:14px; }
      .rs-ocean .rs-contact span::before{ background:#fff; }
      .rs-ocean .rs-sec-t{ border:0; }
      .rs-ocean .rs-sec-txt{ color:${accent}; }
      .rs-ocean .rs-sec-line{ background:linear-gradient(to right,${accent},rgba(255,255,255,0)); }
      .rs-ocean .rs-sec:first-of-type{ margin-top:-6px; }

      /* ---------- 版式五：活力橙红（时间线） ---------- */
      .rs-vitality{ padding:40px 48px 30px; }
      .rs-vitality .rs-top{ display:flex; align-items:flex-end; gap:14px; margin-bottom:22px; }
      .rs-vitality .rs-name{ font-size:30px; font-weight:800; color:#1c1917; letter-spacing:3px; }
      .rs-vitality .rs-top .rs-head{ font-size:13px; color:#fff; background:${accent}; padding:4px 12px;
                                     border-radius:14px; margin-bottom:6px; font-weight:600; }
      .rs-vitality .rs-contact{ margin-bottom:18px; }
      .rs-vitality .rs-sec{ position:relative; padding-left:20px; }
      .rs-vitality .rs-sec::before{ content:''; position:absolute; left:5px; top:5px; bottom:2px; width:2px;
                                    background:linear-gradient(${accent},${accent}22); border-radius:1px; }
      .rs-vitality .rs-sec::after{ content:''; position:absolute; left:0; top:2px; width:12px; height:12px;
                                   border-radius:50%; background:${accent}; border:3px solid ${soft}; }
      .rs-vitality .rs-sec-t{ margin-bottom:8px; }
      .rs-vitality .rs-bar{ display:none; }
      .rs-vitality .rs-sec-txt{ color:${accent}; }
      .rs-vitality .rs-sec-line{ display:none; }
      .rs-vitality .rs-chip{ background:${accent}; color:#fff; border:0; border-radius:6px; font-weight:600; }

      /* ---------- 版式六：青玉留白（极简双线） ---------- */
      .rs-jade{ padding:46px 56px 30px; }
      .rs-jade .rs-top{ text-align:center; padding-bottom:16px; margin-bottom:6px; }
      .rs-jade .rs-name{ font-size:29px; font-weight:600; color:#134e4a; letter-spacing:10px; text-indent:10px; }
      .rs-jade .rs-head{ font-size:12.5px; color:#6b7280; margin-top:9px; letter-spacing:2px; }
      .rs-jade .rs-contact{ justify-content:center; margin-top:10px; }
      .rs-jade .rs-topline{ height:3px; margin:14px 0 20px; border-top:2px solid #134e4a; border-bottom:1px solid #134e4a; }
      .rs-jade .rs-sec-t{ margin-bottom:10px; }
      .rs-jade .rs-bar{ width:9px; height:9px; background:${accent}; border-radius:2px; transform:rotate(45deg); margin-right:9px; }
      .rs-jade .rs-sec-txt{ color:#134e4a; letter-spacing:3px; }
      .rs-jade .rs-sec-line{ background:linear-gradient(to right,#99f6e4,rgba(255,255,255,0)); }
      .rs-jade .rs-sub{ border-left-color:${accent}; }
    `;

    const headBlock = head
      ? `<div class="rs-head">${inlineMd(head)}</div>`
      : '';
    /* 水印层插在 .rs-wrap 内部（absolute 定位以简历纸面为参照） */
    const withWm = (cls, inner) => `<div class="rs-wrap ${cls}">${wmHtml}${inner}</div>`;
    const body = theme === 'business'
      ? withWm('rs-business', `
           <div class="rs-side">
             <div class="rs-name">${inlineMd(name)}</div>
             <div class="rs-line"></div>
             <div class="rs-head">${inlineMd(head)}</div>
             ${contactHtml}
             <div class="rs-tag">Boss招聘小助手<br/>按岗位 JD 定制优化</div>
           </div>
           <div class="rs-main">${sectionsHtml}${foot}</div>
         `)
      : theme === 'elegant'
      ? withWm('rs-elegant', `
           <div class="rs-top">
             <div class="rs-name">${inlineMd(name)}</div>
             ${headBlock}
             ${contactHtml}
           </div>
           ${sectionsHtml}${foot}
         `)
      : theme === 'ocean'
      ? withWm('rs-ocean', `
           <div class="rs-top">
             <div>
               <div class="rs-name">${inlineMd(name)}</div>
               ${headBlock}
             </div>
             ${contactHtml}
           </div>
           ${sectionsHtml}${foot}
         `)
      : theme === 'vitality'
      ? withWm('rs-vitality', `
           <div class="rs-top">
             <div class="rs-name">${inlineMd(name)}</div>
             ${headBlock}
           </div>
           ${contactHtml}
           ${sectionsHtml}${foot}
         `)
      : theme === 'jade'
      ? withWm('rs-jade', `
           <div class="rs-top">
             <div class="rs-name">${inlineMd(name)}</div>
             ${headBlock}
             ${contactHtml}
           </div>
           <div class="rs-topline"></div>
           ${sectionsHtml}${foot}
         `)
      : withWm('rs-modern', `
           <div class="rs-top">
             <div>
               <div class="rs-name">${inlineMd(name)}</div>
               ${headBlock}
             </div>
             ${contactHtml}
           </div>
           ${sectionsHtml}${foot}
         `);

    return `<style>${style}</style>${body}`;
  }

  /* ------------------------------------------------------------------
   * 渲染方案说明（重要）：
   *   图片/PDF 优先用 Tampermonkey @require 预载的 html2canvas + jsPDF，
   *   直接生成真实可下载的 .png / .pdf 文件（不依赖 SVG foreignObject，
   *   不受目标站 CSP 对 data: 图片的限制——这正是旧版「图片无法生成」的原因）。
   *   CDN 组件加载失败（断网等）时自动降级：
   *     图片 → SVG foreignObject 原生渲染（零依赖）
   *     PDF  → 打开打印窗口（矢量中文，窗口内无内联脚本，由父页面调 print，
   *            避免 about:blank 继承 CSP 拦截内联 <script> 导致白屏）
   * ------------------------------------------------------------------ */

  // 把 DOM 节点转成 canvas（SVG foreignObject 方案，无任何外部依赖；作为兜底）
  function nodeToCanvas(node, w, h, scale) {
    return new Promise((resolve, reject) => {
      let xml = '';
      try { xml = new XMLSerializer().serializeToString(node); }
      catch (e) { reject(new Error('HTML 序列化失败：' + e.message)); return; }
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + (w * scale) + '" height="' + (h * scale) +
        '" viewBox="0 0 ' + w + ' ' + h + '">' +
        '<foreignObject x="0" y="0" width="100%" height="100%">' + xml + '</foreignObject></svg>';
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = Math.round(w * scale);
        cv.height = Math.round(h * scale);
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cv.width, cv.height);
        try { ctx.drawImage(img, 0, 0, cv.width, cv.height); }
        catch (e) { reject(new Error('绘制失败：' + e.message)); return; }
        resolve(cv);
      };
      img.onerror = () => reject(new Error('SVG 渲染失败（浏览器不支持或内容含非法标签）'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  // 渲染简历画布：html2canvas 优先，失败退回 SVG foreignObject
  function renderResumeCanvas(opts = {}) {
    const content = getStore(STORE_KEYS.optimized, '');
    if (!content) { toast('还没有优化简历，请先点击「开始优化」', 'err'); return Promise.reject(new Error('no-content')); }
    const theme = opts.theme || getResumeTheme();
    const scale = opts.scale || 2;
    // 售卖版激活后会在导出物上带溯源水印（免费版无此函数，为空）
    const wm = (typeof getLicenseWatermark === 'function') ? (getLicenseWatermark() || '') : '';
    const html = buildResumeHTML(content, theme, { watermark: wm });

    // ① 挂到离屏容器（注意：html 第一个子元素是 <style>，真实纸面是 .rs-wrap，别量错对象）
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;z-index:-1;pointer-events:none;';
    host.innerHTML = html;
    document.body.appendChild(host);
    const paper = () => host.querySelector('.rs-wrap') || host.firstElementChild;
    const h = Math.max(paper().offsetHeight || paper().scrollHeight || 1123, 700);

    const cleanup = () => { if (host.parentNode) host.parentNode.removeChild(host); };

    // ② html2canvas：直接读 DOM 绘制，不经过 data: 图片，不受 CSP 影响
    const tryH2C = () => {
      const lib = (typeof html2canvas !== 'undefined') ? html2canvas
        : (typeof window !== 'undefined' && window.html2canvas);
      if (typeof lib !== 'function') return Promise.reject(new Error('html2canvas 未加载'));
      return lib(paper(), {
        scale, backgroundColor: '#ffffff', logging: false, useCORS: true,
        width: 794, windowWidth: 794
      });
    };
    // ③ 兜底：SVG foreignObject
    const trySvg = () => nodeToCanvas(paper(), 794, h, scale);

    return tryH2C()
      .catch((e1) => trySvg().catch((e2) => {
        throw new Error((e1 && e1.message ? e1.message : e1) + ' / ' + (e2 && e2.message ? e2.message : e2));
      }))
      .then((cv) => { cleanup(); return cv; }, (e) => { cleanup(); throw e; });
  }

  function canvasDownload(canvas, fileName) {
    canvas.toBlob((blob) => {
      if (!blob) { toast('图片生成失败，请改用「下载 .doc」', 'err'); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1200);
      toast('已下载简历图片：' + fileName, 'ok');
    }, 'image/png');
  }

  // jsPDF（由 @require 预载）是否可用
  function jsPDFLib() {
    const J = (typeof jspdf !== 'undefined' && jspdf && jspdf.jsPDF) ? jspdf.jsPDF
      : (typeof window !== 'undefined' && window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : null;
    return J;
  }

  // 把整条长图画进 A4 竖版 PDF 并保存为真实文件（多页自动切片）
  function buildResumePdf() {
    const meta = getStore(STORE_KEYS.jdMeta, {});
    const fileName = `简历-优化-${safeName(meta.title) || '岗位'}.pdf`;
    return renderResumeCanvas({ scale: 2 }).then((canvas) => {
      const JsPDF = jsPDFLib();
      if (!JsPDF) throw new Error('jsPDF 未加载');
      const PW = 210;                                    // A4 宽 mm
      const pxPerMm = canvas.width / PW;
      const pageHpx = Math.max(1, Math.round(297 * pxPerMm)); // 一页 A4 对应的画布像素
      const pages = Math.max(1, Math.ceil(canvas.height / pageHpx));
      const doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
      const slice = document.createElement('canvas');
      const sctx = slice.getContext('2d');
      for (let p = 0; p < pages; p++) {
        const sy = p * pageHpx;
        const sh = Math.min(pageHpx, canvas.height - sy);
        slice.width = canvas.width; slice.height = sh;
        sctx.fillStyle = '#ffffff'; sctx.fillRect(0, 0, slice.width, slice.height);
        sctx.drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, canvas.width, sh);
        const img = slice.toDataURL('image/jpeg', 0.95);
        if (p > 0) doc.addPage();
        doc.addImage(img, 'JPEG', 0, 0, PW, (sh / pxPerMm), undefined, 'FAST');
      }
      doc.save(fileName);
      return fileName;
    });
  }

  // 生成可打印的 A4 HTML 文档（矢量中文、可搜索；窗口内不含任何内联脚本）
  function buildPrintDocument(theme, fileName) {
    const content = getStore(STORE_KEYS.optimized, '');
    const wm = (typeof getLicenseWatermark === 'function') ? (getLicenseWatermark() || '') : '';
    const inner = buildResumeHTML(content, theme, { watermark: wm });
    return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>${esc(fileName)}</title>
<style>
  *{ -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
  @page{ size:A4; margin:0; }
  html,body{ margin:0; padding:0; background:#eef2f7;
             font-family:'Microsoft YaHei','PingFang SC',sans-serif; }
  .toolbar{ position:sticky; top:0; z-index:9; display:flex; align-items:center; gap:10px;
            flex-wrap:wrap; padding:12px 18px; background:#0f172a; color:#e2e8f0; font-size:13px; }
  .toolbar b{ font-size:14px; }
  .toolbar .hint{ color:#94a3b8; }
  .stage{ padding:18px 0 30px; }
  .rs-wrap{ margin:0 auto; box-shadow:0 2px 14px rgba(15,23,42,.14); }
  @media print{
    html,body{ background:#fff; }
    .toolbar{ display:none !important; }
    .stage{ padding:0; }
    .rs-wrap{ box-shadow:none; margin:0; width:210mm; }
    .rs-sec{ break-inside:avoid; page-break-inside:avoid; }
    .rs-li,.rs-sub,.rs-p{ break-inside:avoid; page-break-inside:avoid; }
  }
</style></head>
<body>
  <div class="toolbar">
    <b>📄 ${esc(fileName)}</b>
    <span class="hint">若未自动弹出打印框：按 Ctrl+P → 目标位置选「另存为 PDF」→ 保存</span>
  </div>
  <div class="stage"><div id="resume-root">${inner}</div></div>
</body></html>`;
  }

  // 打开打印窗口生成 PDF（窗口由本页代为调起打印，避免新窗口内脚本被 CSP 拦截而白屏）
  function openResumePrintWindow() {
    const meta = getStore(STORE_KEYS.jdMeta, {});
    const fileName = `简历-优化-${safeName(meta.title) || '岗位'}`;
    const win = window.open('', '_blank');
    if (!win) { toast('弹窗被拦截：请允许本站弹窗后重试', 'err'); return false; }
    try {
      win.document.open();
      win.document.write(buildPrintDocument(getResumeTheme(), fileName));
      win.document.close();
    } catch (e) { return false; }
    setTimeout(() => { try { win.focus(); win.print(); } catch (e) {} }, 900);
    return true;
  }

  function downloadResumePDF() {
    if (!getStore(STORE_KEYS.optimized, '')) { toast('还没有优化结果，请先点击「开始优化」', 'err'); return; }
    toast('正在生成 PDF 文件，请稍候…', 'info');
    buildResumePdf()
      .then((f) => toast('✅ 已下载 ' + f + '。需要「文字可复制」的矢量 PDF 可用「打印 / 另存为 PDF」', 'ok'))
      .catch(() => {
        toast('PDF 组件不可用（可能断网），已打开打印窗口兜底', 'info');
        openResumePrintWindow();
      });
  }

  function downloadResumeImage() {
    if (!getStore(STORE_KEYS.optimized, '')) { toast('还没有优化结果，请先点击「开始优化」', 'err'); return; }
    toast('正在渲染简历图片，请稍候…', 'info');
    renderResumeCanvas().then((canvas) => {
      const meta = getStore(STORE_KEYS.jdMeta, {});
      canvasDownload(canvas, `简历-优化-${safeName(meta.title) || '岗位'}.png`);
    }).catch((e) => toast('图片渲染失败：' + (e && e.message || e), 'err'));
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
      const explain = getStore(STORE_KEYS.jdExplain, '');
      body.innerHTML = `
        <div class="brh-row">
          <button class="brh-btn" id="brh-grab">🎯 抓取本页岗位 JD</button>
          <button class="brh-btn ghost sm" id="brh-clear-jd">清空</button>
        </div>
        <div class="brh-tip brh-row" id="brh-jd-meta">${meta.title ? `已捕获：<span class="brh-chip">${esc(meta.title)}</span>${meta.salary ? `<span class="brh-chip">${esc(meta.salary)}</span>` : ''}${meta.company ? `<span class="brh-chip">${esc(meta.company)}</span>` : ''}` : '在职位详情页点击「抓取」，或在聊天页右侧岗位卡上点击后抓取；抓不到可直接在下方粘贴 JD。'}</div>
        <textarea class="brh-area" id="brh-jd-area" style="min-height:200px" placeholder="岗位职责 / 任职要求 将显示在这里，可手动编辑补充…">${esc(jd)}</textarea>
        <div class="brh-status" id="brh-jd-status"></div>
        ${jd ? `
        <div class="brh-row" style="margin-top:10px">
          <button class="brh-btn ghost sm" id="brh-explain">📖 岗位需求理解</button>
          <button class="brh-btn ghost sm" id="brh-xhs" ${meta.title ? '' : 'disabled title="请先抓取/粘贴 JD 获取岗位名称"'}>📕 小红书搜经验</button>
        </div>
        <div class="brh-status" id="brh-explain-status"></div>
        ${explain ? `<div class="brh-row" style="margin-top:8px"><div class="brh-label">📖 岗位需求解读</div><textarea class="brh-area" id="brh-jd-explain" style="min-height:120px;line-height:1.8">${esc(explain)}</textarea>
          <div class="brh-row" style="margin-top:6px"><button class="brh-btn ghost sm" id="brh-explain-copy">📋 复制解读</button></div></div>` : ''}
        <div class="brh-tip">「岗位需求理解」用大白话讲清岗位做什么/需要什么能力/职业方向，帮你有针对性地优化简历。<br>「小红书搜经验」一键打开小红书搜索该岗位的面经/薪资/避坑帖。</div>` : ''}
      `;
      $('#brh-grab').onclick = () => {
        const r = extractJD();
        if (!r.sections.length && !r.title) { this.showStatus('brh-jd', '未在本页识别到岗位信息，请手动粘贴 JD', 'err'); return; }
        setStore(STORE_KEYS.jd, jdToText(r));
        setStore(STORE_KEYS.jdMeta, { title: r.title, company: r.company, salary: r.salary, url: location.href, time: nowStr() });
        this.renderJdTab();
        this.showStatus('brh-jd', `✅ 已捕获 ${r.sections.length} 个板块（${nowStr()}）`, 'ok');
        toast('JD 抓取成功', 'ok');
      };
      $('#brh-clear-jd').onclick = () => { setStore(STORE_KEYS.jd, ''); setStore(STORE_KEYS.jdMeta, {}); setStore(STORE_KEYS.jdExplain, ''); this.renderJdTab(); };
      $('#brh-jd-area').addEventListener('change', (e) => { setStore(STORE_KEYS.jd, e.target.value); this.showStatus('brh-jd', '已保存手动编辑', 'ok'); });
      const explainBtn = $('#brh-explain'); if (explainBtn) explainBtn.onclick = () => explainPosition();
      const xhsBtn = $('#brh-xhs'); if (xhsBtn) xhsBtn.onclick = () => searchXhs(meta.title || '');
      const explainCopy = $('#brh-explain-copy'); if (explainCopy) explainCopy.onclick = () => {
        const v = getStore(STORE_KEYS.jdExplain, '');
        if (!v) { toast('暂无解读', 'err'); return; }
        navigator.clipboard.writeText(v).then(() => toast('岗位解读已复制', 'ok'), () => toast('复制失败', 'err'));
      };
    },

    /* ---- 简历页 ---- */
    renderResumeTab() {
      const body = $('#brh-body', this.root);
      const resume = getStore(STORE_KEYS.resume, '');
      const lib = getStore(STORE_KEYS.resumeLibrary, null);
      const cats = (lib && lib.categories) ? lib.categories : [];
      body.innerHTML = `
        <div class="brh-row">
          <label class="brh-btn green" style="cursor:pointer">📎 上传简历（PDF / Word / TXT / MD）
            <input type="file" id="brh-resume-file" accept=".pdf,.docx,.doc,.txt,.md,.markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" style="display:none">
          </label>
        </div>
        <div class="brh-tip brh-row">支持 PDF、Word(.docx)、TXT、MD。老版 .doc 暂不支持（请另存为 .docx 或 PDF）。解析全程在本地浏览器完成，不上传任何服务器。</div>
        <textarea class="brh-area" id="brh-resume-area" style="min-height:160px" placeholder="粘贴或上传你的简历全文（教育背景、工作经历、项目经历、技能…）">${esc(resume)}</textarea>
        <div class="brh-status" id="brh-resume-status">${resume ? '已有简历 ' + resume.length + ' 字' : ''}</div>

        <div class="brh-row" style="margin-top:10px">
          <button class="brh-btn ghost sm" id="brh-scan-dir">📁 扫描文件夹</button>
          <button class="brh-btn ghost sm" id="brh-multi-pdf">📎 多选 PDF</button>
          ${cats.length ? '<button class="brh-btn ghost sm" id="brh-clear-lib">🗑 清空库</button>' : ''}
        </div>
        <input type="file" id="brh-multi-input" accept=".pdf,application/pdf" multiple style="display:none">
        <div class="brh-status" id="brh-lib-status"></div>
        ${cats.length ? `<div class="brh-row" style="margin-top:8px"><div class="brh-label">📚 简历库 <span class="brh-chip">${cats.length} 个岗位 · ${cats.reduce((a,c)=>a+c.items.length,0)} 份</span></div></div>
          <div id="brh-lib-list">${cats.map((c)=>`
            <div class="brh-lib-cat" style="margin-top:8px">
              <div class="brh-lib-cat-name"><b>📂 ${esc(c.category)}</b> <span style="font-size:12px;color:#64748b">(${c.items.length} 份)</span></div>
              ${c.items.map((it)=>`<div class="brh-lib-item" title="${esc(it.name)}" data-lib="${esc(it.name)}">
                <span>📄 ${esc(it.title || it.name)}</span>
                <span style="font-size:11px;color:#64748b">${esc(it.name)}</span>
                <button class="brh-btn ghost sm brh-lib-use" style="margin-left:auto">使用</button>
              </div>`).join('')}
            </div>`).join('')}
          </div>
          <div class="brh-tip">AI 已按岗位把简历分好类。点「使用」加载到上方文本框 → 再去 Boss 页面上传该岗位（需手动操作）。</div>` : '<div class="brh-tip">📁 扫描电脑文件夹里的 PDF（自动递归子目录）或 📎 多选 PDF，AI 会按岗位自动分类整理。'}
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
      const scanBtn = $('#brh-scan-dir'); if (scanBtn) scanBtn.onclick = () => scanResumeFolder((msg) => this.showStatus('brh-resume', msg));
      const multiBtn = $('#brh-multi-pdf'); if (multiBtn) multiBtn.onclick = () => { const el = $('#brh-multi-input'); if (el) el.click(); };
      const multiInput = $('#brh-multi-input');
      if (multiInput) multiInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;
        await handlePickedFiles(files, (msg) => this.showStatus('brh-resume', msg));
        e.target.value = '';
      });
      const clearLib = $('#brh-clear-lib');
      if (clearLib) clearLib.onclick = () => { setStore(STORE_KEYS.resumeLibrary, null); this.renderResumeTab(); toast('已清空简历库', 'ok'); };
      $$('.brh-lib-use').forEach((b) => {
        b.onclick = () => {
          const itemName = b.closest('.brh-lib-item').dataset.lib;
          const lib = getStore(STORE_KEYS.resumeLibrary, null);
          let found = null;
          if (lib) for (const c of lib.categories) { for (const it of c.items) { if (it.name === itemName) { found = it; break; } } if (found) break; }
          if (found && found.text) {
            setStore(STORE_KEYS.resume, found.text.trim());
            this.renderResumeTab();
            this.showStatus('brh-resume', '✅ 已加载「' + (found.title || found.name) + '」，请去 Boss 页面上传该岗位', 'ok');
            toast('已加载：' + (found.title || found.name), 'ok');
          } else { toast('未找到该简历内容', 'err'); }
        };
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
          <button class="brh-btn green sm" id="brh-dl-pdf">📄 导出 PDF 文件</button>
          <button class="brh-btn ghost sm" id="brh-dl-print">🖨 打印 / 另存为 PDF</button>
        </div>
        <div class="brh-row">
          <button class="brh-btn ghost sm" id="brh-dl-img">🖼 下载简历图片</button>
          <button class="brh-btn ghost sm" id="brh-dl-doc">⬇️ 下载 .doc</button>
        </div>
        <div class="brh-row">
          <span class="brh-chip">当前版式：${esc(RESUME_THEMES[getResumeTheme()].name)}</span>
          <button class="brh-btn ghost sm" id="brh-theme-switch">🎨 切换版式</button>
        </div>
        <div class="brh-tip">「导出 PDF 文件」直接得到 .pdf 文件（多页 A4，自动排版）；需要文字可复制/可搜索的矢量 PDF 时用「打印 / 另存为 PDF」。组件加载失败时自动回退到打印窗口。</div>
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
      const printBtn = $('#brh-dl-print'); if (printBtn) printBtn.onclick = () => { openResumePrintWindow(); };
      const doc = $('#brh-dl-doc'); if (doc) doc.onclick = () => downloadOptimized('doc');
      const imgBtn = $('#brh-dl-img'); if (imgBtn) imgBtn.onclick = downloadResumeImage;
      const ths = $('#brh-theme-switch'); if (ths) ths.onclick = () => {
        const order = Object.keys(RESUME_THEMES);
        const i = order.indexOf(getResumeTheme());
        setResumeTheme(order[(i + 1) % order.length]);
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
      const hrQ = getStore(STORE_KEYS.hrQuestion, '');
      const hrA = getStore(STORE_KEYS.hrReply, '');
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
          <button class="brh-btn warn sm" id="brh-attach" ${optimized ? '' : 'disabled'}>🖼 向当前对话发送简历图片</button>
        </div>
        <div class="brh-tip">简历以<b>图片</b>形式附加（排版好看、手机端不乱码）；若页面拦截自动附加，图片会自动下载到本地，手动点聊天窗口「图片」按钮发送即可。</div>` : `
        <div class="brh-tip">先生成打招呼话术；然后可一键填入 Boss 聊天框，并把优化后的简历以图片形式发给当前 HR。</div>`}

        <div class="brh-row" style="margin-top:14px;border-top:1px dashed #e5e7eb;padding-top:10px">
          <div class="brh-label">🎯 HR 智能回复<span class="brh-chip">按 HR 提问 + 优化简历生成</span></div>
          <textarea class="brh-area" id="brh-hr-q" style="min-height:56px" placeholder="自动抓取 HR 最新提问；抓不到时手动把 HR 的问题粘贴到这里">${esc(hrQ)}</textarea>
          <div class="brh-row" style="margin-top:6px">
            <button class="brh-btn" id="brh-hr-gen" ${optimized ? '' : 'disabled title="请先在「优化」页生成优化简历"'}>💬 生成针对性回复</button>
            ${hrA ? '<button class="brh-btn ghost sm" id="brh-hr-regen">🔄 换个说法</button>' : ''}
          </div>
          ${hrA ? `
          <textarea class="brh-area" id="brh-hr-reply" style="min-height:110px;margin-top:8px">${esc(hrA)}</textarea>
          <div class="brh-row" style="margin-top:6px">
            <button class="brh-btn green sm" id="brh-hr-copy">📋 复制回复</button>
            <button class="brh-btn sm" id="brh-hr-fill">📝 填入聊天框</button>
          </div>` : ''}
          <div class="brh-tip">在 HR 聊天页点「生成针对性回复」，脚本会读取 HR 最新提问，结合优化后的简历与岗位 JD 生成第一人称回复；生成后请核对数字与事实再发送。</div>
        </div>`;
      const gen = $('#brh-gen-greeting'); if (gen) gen.onclick = generateGreeting;
      const area = $('#brh-greet-area');
      if (area) area.addEventListener('change', (e) => setStore(STORE_KEYS.greeting, e.target.value));
      const fill = $('#brh-fill'); if (fill) fill.onclick = () => fillGreeting($('#brh-greet-area').value.trim());
      const attach = $('#brh-attach'); if (attach) attach.onclick = sendResumeImage;
      const hrGen = $('#brh-hr-gen'); if (hrGen) hrGen.onclick = () => {
        setStore(STORE_KEYS.hrQuestion, $('#brh-hr-q').value.trim());
        generateHrReply({ manual: $('#brh-hr-q').value.trim() || undefined });
      };
      const hrRegen = $('#brh-hr-regen'); if (hrRegen) hrRegen.onclick = () => generateHrReply({ manual: $('#brh-hr-q').value.trim() || undefined });
      const hrCopy = $('#brh-hr-copy'); if (hrCopy) hrCopy.onclick = () => {
        const v = $('#brh-hr-reply').value.trim();
        if (!v) { toast('暂无回复', 'err'); return; }
        navigator.clipboard.writeText(v).then(() => toast('回复已复制', 'ok'), () => toast('复制失败，请手动选择', 'err'));
      };
      const hrFill = $('#brh-hr-fill'); if (hrFill) hrFill.onclick = () => {
        setStore(STORE_KEYS.hrReply, $('#brh-hr-reply').value);
        fillGreeting($('#brh-hr-reply').value.trim());
      };
      const hrQArea = $('#brh-hr-q');
      if (hrQArea) hrQArea.addEventListener('change', (e) => setStore(STORE_KEYS.hrQuestion, e.target.value.trim()));
    },

    /* HR 智能回复生成完毕后刷新聊天页（问题与回复已入存储） */
    renderHrReply() { this.renderGreeting(getStore(STORE_KEYS.greeting, '')); },

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
            <option value="elegant" ${getResumeTheme() === 'elegant' ? 'selected' : ''}>雅致衬线（居中标题 + 衬线字，稳重耐看）</option>
            <option value="ocean" ${getResumeTheme() === 'ocean' ? 'selected' : ''}>深海渐变（渐变横幅头部，个性醒目）</option>
            <option value="vitality" ${getResumeTheme() === 'vitality' ? 'selected' : ''}>活力橙红（时间线经历，突出成长）</option>
            <option value="jade" ${getResumeTheme() === 'jade' ? 'selected' : ''}>青玉留白（极简双线，清爽克制）</option>
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
