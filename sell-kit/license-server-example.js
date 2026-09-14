/* ============================================================
 * license-server-example.js — 可选的「在线授权服务端」示例（零依赖，Node 原生）
 *
 * 为什么需要它：
 *   纯静态方案（脚本 + 激活网页）的算法与密钥都在前端可见，理论上可被逆向自签发。
 *   接上服务端后，你可以做到：只认登记过的码、一机一码、随时吊销、查看激活日志。
 *
 * 启动：  node license-server-example.js        （默认监听 8787）
 * 然后把脚本里的 LICENSE_API 填成 https://你的域名/verify，重跑 make-sell.js 即可。
 *
 * 接口：
 *   POST /issue   header: x-admin-token     body: {exp:'perm'|'30'|'90'|'365', count:5, note:'闲鱼订单1'}
 *                 → 生成并登记激活码（只有登记过的码才能通过 /verify）
 *   POST /verify  body: {code, machine, version}
 *                 → {ok:true} / {ok:false,msg:'...'}
 *   GET  /list    header: x-admin-token     → 查看全部激活码与激活情况
 *   POST /revoke  header: x-admin-token     body: {code}  → 吊销
 *   GET  /health  → {ok:true}
 * ========================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const L = require('./license-core.js');

const PORT = process.env.PORT || 8787;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'brh-admin-change-me';
const DB_FILE = path.join(__dirname, 'codes.json');
const MAX_DEVICES = 1;          // 一个激活码最多允许绑定的设备数（1 = 一机一码）

function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { return {}; }
}
function saveDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8'); }

function body(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => { s += c; });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch (e) { resolve({}); } });
  });
}
function send(res, obj, code) {
  res.writeHead(code || 200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST,GET,OPTIONS' });
    return res.end();
  }
  const url = req.url.split('?')[0];
  const db = loadDB();

  if (url === '/health') return send(res, { ok: true, time: Date.now() });

  /* ---- 发码（管理员） ---- */
  if (url === '/issue' && req.method === 'POST') {
    if (req.headers['x-admin-token'] !== ADMIN_TOKEN) return send(res, { ok: false, msg: 'token 错误' }, 401);
    const b = await body(req);
    const count = Math.max(1, Math.min(500, parseInt(b.count, 10) || 1));
    const expDate = L.parseExpChoice(b.exp || '90');
    const codes = [];
    for (let i = 0; i < count; i++) {
      const c = L.genCode(expDate);
      db[c] = { exp: expDate ? expDate.getTime() : 0, machines: [], created: Date.now(), note: b.note || '', revoked: false };
      codes.push(c);
    }
    saveDB(db);
    return send(res, { ok: true, codes, exp: expDate ? expDate.toISOString().slice(0, 10) : '永久' });
  }

  /* ---- 校验（脚本端调用） ---- */
  if (url === '/verify' && req.method === 'POST') {
    const b = await body(req);
    const code = String(b.code || '').trim().toUpperCase();
    const machine = String(b.machine || '').trim();
    const chk = L.checkCode(code);
    if (!chk.ok) return send(res, { ok: false, msg: chk.reason });
    const rec = db[code];
    if (!rec) return send(res, { ok: false, msg: '激活码未登记（可能是伪造码）' });
    if (rec.revoked) return send(res, { ok: false, msg: '激活码已被吊销，请联系卖家' });
    if (rec.exp && Date.now() > rec.exp) return send(res, { ok: false, msg: '激活码已过期' });
    if (machine) {
      if (rec.machines.indexOf(machine) < 0) {
        if (rec.machines.length >= MAX_DEVICES) {
          return send(res, { ok: false, msg: '该激活码已在其他设备使用（上限 ' + MAX_DEVICES + ' 台）' });
        }
        rec.machines.push(machine);
      }
    }
    rec.lastSeen = Date.now();
    rec.uses = (rec.uses || 0) + 1;
    saveDB(db);
    return send(res, { ok: true, exp: rec.exp });
  }

  /* ---- 列表 / 吊销（管理员） ---- */
  if (url === '/list' && req.method === 'GET') {
    if (req.headers['x-admin-token'] !== ADMIN_TOKEN) return send(res, { ok: false, msg: 'token 错误' }, 401);
    return send(res, { ok: true, total: Object.keys(db).length, data: db });
  }
  if (url === '/revoke' && req.method === 'POST') {
    if (req.headers['x-admin-token'] !== ADMIN_TOKEN) return send(res, { ok: false, msg: 'token 错误' }, 401);
    const b = await body(req);
    const code = String(b.code || '').trim().toUpperCase();
    if (!db[code]) return send(res, { ok: false, msg: '码不存在' });
    db[code].revoked = true;
    saveDB(db);
    return send(res, { ok: true, msg: '已吊销 ' + code });
  }

  send(res, { ok: false, msg: 'not found' }, 404);
});

server.listen(PORT, () => {
  console.log('授权服务已启动： http://localhost:' + PORT);
  console.log('  发码： curl -X POST http://localhost:' + PORT + '/issue -H "x-admin-token: ' + ADMIN_TOKEN + '" -H "Content-Type: application/json" -d "{\\"exp\\":\\"90\\",\\"count\\":3}"');
  console.log('  脚本端 LICENSE_API 填： http://你的域名:' + PORT + '/verify');
});
