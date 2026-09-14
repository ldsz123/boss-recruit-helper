/* ============================================================
 * license-core.js — Boss招聘小助手 · 激活码算法（唯一算法源）
 *
 * 本文件同时被以下两处使用，改这里即全局生效：
 *   1) 油猴售卖版脚本（由 make-sell.js 注入，暴露为 window.BRHLicense）
 *   2) 在线激活网页 activate.html（由 build-activate.js 内联进去）
 *
 * ⚠️ 修改 SECRET 后，此前发出的激活码会全部失效，请谨慎。
 *
 * 激活码结构：BRH-XXXX-XXXX-XXXX
 *   payload = 前两段 8 字符：
 *     [0..1] 有效期：00 = 永久；否则为 (年-2026)*12 + 月 + 1 的 Base32(2位)
 *     [2..7] 随机串（Crockford Base32，去掉易混淆的 I L O U）
 *   check   = 第三段 4 字符：HMAC-SHA256(SECRET, payload) 取 4 位摘要
 * ========================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BRHLicense = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- 可调参数 ---------------- */
  var SECRET = 'brh-2026-zq17-8f3a9c';                 // ← 作者密钥（建议改成只有你知道的字符串）
  var ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   // Crockford Base32（无 I / L / O / U）
  var BASE_YEAR = 2026;

  /* ---------------- 工具 ---------------- */
  function utf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    var out = [], i, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
    return new Uint8Array(out);
  }
  function ror(x, n) { return (x >>> n) | (x << (32 - n)); }
  function b32(num, len) {
    var s = '';
    for (var i = len - 1; i >= 0; i--) s += ALPHABET[(num >>> (i * 5)) & 31];
    return s;
  }
  function fromB32(s) {
    var v = 0;
    for (var i = 0; i < s.length; i++) {
      var idx = ALPHABET.indexOf(s[i]);
      if (idx < 0) return -1;
      v = v * 32 + idx;
    }
    return v;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtDate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

  /* ---------------- SHA-256 & HMAC ---------------- */
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function sha256(msgBytes) {
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var len = msgBytes.length;
    var blocks = Math.ceil((len + 9) / 64);
    var total = blocks * 64;
    var buf = new Uint8Array(total);
    buf.set(msgBytes);
    buf[len] = 0x80;
    var dv = new DataView(buf.buffer);
    var bitLen = len * 8;
    dv.setUint32(total - 8, Math.floor(bitLen / 4294967296));
    dv.setUint32(total - 4, bitLen >>> 0);
    var w = new Int32Array(64);
    var i, t;
    for (var b = 0; b < blocks; b++) {
      var off = b * 64;
      for (i = 0; i < 16; i++) w[i] = dv.getInt32(off + i * 4);
      for (i = 16; i < 64; i++) {
        var x15 = w[i - 15], x2 = w[i - 2];
        var s0 = ror(x15, 7) ^ ror(x15, 18) ^ (x15 >>> 3);
        var s1 = ror(x2, 17) ^ ror(x2, 19) ^ (x2 >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = H[0], bb = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = ror(e, 6) ^ ror(e, 11) ^ ror(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[i] + w[i]) | 0;
        var S0 = ror(a, 2) ^ ror(a, 13) ^ ror(a, 22);
        var maj = (a & bb) ^ (a & c) ^ (bb & c);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + bb) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    var out = new Uint8Array(32);
    for (i = 0; i < 8; i++) {
      out[i * 4] = (H[i] >>> 24) & 0xff;
      out[i * 4 + 1] = (H[i] >>> 16) & 0xff;
      out[i * 4 + 2] = (H[i] >>> 8) & 0xff;
      out[i * 4 + 3] = H[i] & 0xff;
    }
    return out;
  }

  function hmacBytes(keyStr, msgStr) {
    var B = 64;
    var key = utf8(keyStr);
    if (key.length > B) key = sha256(key);
    var pad = new Uint8Array(B);
    pad.set(key);
    var o = new Uint8Array(B), iPad = new Uint8Array(B);
    for (var j = 0; j < B; j++) { o[j] = pad[j] ^ 0x5c; iPad[j] = pad[j] ^ 0x36; }
    var inner = new Uint8Array(B + utf8(msgStr).length);
    inner.set(iPad);
    inner.set(utf8(msgStr), B);
    var outer = new Uint8Array(B + 32);
    outer.set(o);
    outer.set(sha256(inner), B);
    return sha256(outer);
  }

  /* ---------------- 有效期编解码 ---------------- */
  function encodeExp(dateOrNull) {
    if (!dateOrNull) return '00';
    var v = (dateOrNull.getFullYear() - BASE_YEAR) * 12 + dateOrNull.getMonth() + 1;
    if (v > 1023) v = 1023;
    return b32(v, 2);
  }
  function decodeExp(tag) {
    if (tag === '00') return null;
    var v = fromB32(tag);
    if (v <= 0) return null;
    var t = v - 1;
    var y = BASE_YEAR + Math.floor(t / 12);
    var m = t % 12;
    return new Date(y, m + 1, 0, 23, 59, 59); // 当月最后一天 23:59:59
  }

  /* ---------------- 激活码生成 / 校验 ---------------- */
  function checksum(payload) {
    var h = hmacBytes(SECRET, payload);
    var s = '';
    for (var i = 0; i < 4; i++) s += ALPHABET[h[i * 3 + 1] % 32];
    return s;
  }

  function randomChars(n) {
    var s = '';
    for (var i = 0; i < n; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    return s;
  }

  function genCode(expDate) {
    var payload = encodeExp(expDate || null) + randomChars(6);
    return 'BRH-' + payload.slice(0, 4) + '-' + payload.slice(4, 8) + '-' + checksum(payload);
  }

  /**
   * @returns {{ok:boolean, reason?:string, exp?:number, expText?:string, expired?:boolean}}
   */
  function checkCode(raw) {
    var code = String(raw == null ? '' : raw).trim().toUpperCase().replace(/\s+/g, '');
    var m = /^BRH-([0-9A-Z]{4})-([0-9A-Z]{4})-([0-9A-Z]{4})$/.exec(code);
    if (!m) return { ok: false, reason: '格式不正确（应为 BRH-XXXX-XXXX-XXXX）' };
    var payload = m[1] + m[2];
    for (var i = 0; i < payload.length; i++) {
      if (ALPHABET.indexOf(payload[i]) < 0) return { ok: false, reason: '包含无效字符（不含 I L O U）' };
    }
    if (checksum(payload) !== m[3]) return { ok: false, reason: '激活码无效（校验失败）' };
    var expDate = decodeExp(payload.slice(0, 2));
    if (expDate && Date.now() > expDate.getTime()) {
      return { ok: false, expired: true, reason: '激活码已过期（有效期至 ' + fmtDate(expDate) + '）' };
    }
    return {
      ok: true,
      code: code,
      exp: expDate ? expDate.getTime() : 0,
      expText: expDate ? ('有效期至 ' + fmtDate(expDate)) : '永久有效'
    };
  }

  return {
    SECRET: SECRET,
    ALPHABET: ALPHABET,
    BASE_YEAR: BASE_YEAR,
    genCode: genCode,
    checkCode: checkCode,
    encodeExp: encodeExp,
    decodeExp: decodeExp,
    fmtDate: fmtDate,
    parseExpChoice: function (choice) {   // 'perm' | '30' | '90' | '180' | '365'
      if (!choice || choice === 'perm') return null;
      var d = new Date();
      d.setDate(d.getDate() + parseInt(choice, 10));
      return d;
    }
  };
});
