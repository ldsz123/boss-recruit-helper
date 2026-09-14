/* build-activate.js — 生成单文件在线激活网页
 * 用法：node build-activate.js
 * 输入：./activate-template.html + ./license-core.js（算法）
 * 输出：../activate.html（可直接双击打开，也可丢到任意静态托管）
 */
const fs = require('fs');
const path = require('path');

const tpl = fs.readFileSync(path.join(__dirname, 'activate-template.html'), 'utf8');
const core = fs.readFileSync(path.join(__dirname, 'license-core.js'), 'utf8');
const OUT = path.join(__dirname, '..', 'activate.html');

if (tpl.indexOf('/*__LICENSE_CORE__*/') < 0) {
  console.error('模板缺少 /*__LICENSE_CORE__*/ 占位符');
  process.exit(1);
}

const html = tpl.replace('/*__LICENSE_CORE__*/', core);
fs.writeFileSync(OUT, html, 'utf8');
console.log('✅ 已生成 activate.html  (' + (html.length / 1024).toFixed(1) + ' KB)');
