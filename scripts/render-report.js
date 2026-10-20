const fs = require('node:fs');
const path = require('node:path');
const { statusNames } = require('./model.js');
const escape = s => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function renderReport(model) {
  const css = fs.readFileSync(path.join(__dirname, 'report-style.css'), 'utf8');
  const client = fs.readFileSync(path.join(__dirname, 'report-client.js'), 'utf8');
  const json = JSON.stringify(model).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  const counts = Object.fromEntries(Object.keys(statusNames).map(s => [s, model.tests.filter(t => t.status === s).length]));
  const labels = { ...statusNames, notRun: model.catalogOnly ? '尚未执行' : '本次未执行' };
  const summary = Object.entries(counts).filter(([s, n]) => n > 0 || s === 'passed' || s === 'failed')
    .map(([s, n]) => `<div class="summary-metric"><div class="summary-metric-label">${labels[s]}</div><div class="summary-metric-value ${s === 'passed' ? 'green' : s === 'failed' || s === 'timedOut' ? 'red' : ''}">${n}</div></div>`).join('');
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>E2E Test Report</title><style>${css}</style></head>
<body><header class="topbar"><div class="brand"><div class="brand-title">E2E Test Report</div><div class="brand-sub">测试目录与执行证据</div></div><div class="top-spacer"></div><span class="duration-pill">${escape(model.framework)}</span></header>
<main class="workspace"><aside class="sidebar" aria-label="文件导航"><p class="section-label">测试文件</p><nav id="suite-tree"></nav></aside>
<section class="main"><div class="page-shell"><div class="run-info" id="run-info"></div>
${model.warnings.map(w => `<div class="notice" role="status">${escape(w)}</div>`).join('')}
${(model.run?.errors || []).map(e => `<div class="notice" role="alert">运行级错误：${escape(e)}</div>`).join('')}
<div class="summary-grid">${summary}</div><div class="toolbar"><input type="search" id="search" class="search" placeholder="搜索测试名称、文件或执行环境" aria-label="搜索测试">
<select id="status-filter" class="filter-select" aria-label="状态筛选"><option value="all">全部状态</option>${Object.entries(labels).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
<button id="expand-all" class="soft-button">全部展开</button><button id="collapse-all" class="soft-button">全部收起</button><span id="visible-count" class="visible-count"></span></div>
<div id="test-list"></div></div></section></main>
<dialog id="image-modal" class="modal"><div class="modal-close"><button data-close="image-modal">关闭</button></div><img id="modal-image" alt="截图预览"></dialog>
<dialog id="copy-modal" class="modal"><div class="modal-close"><button data-close="copy-modal">关闭</button></div><p>未能直接复制，请选中以下文本手动复制。</p><textarea id="copy-text" class="copy-text" readonly aria-label="复制给 AI 的测试信息"></textarea></dialog>
<div id="copy-status" role="status" aria-live="polite" style="position:fixed;bottom:16px;right:16px;background:#202023;padding:8px;border-radius:6px" hidden></div>
<script type="application/json" id="report-data">${json}</script><script>${client}</script></body></html>`;
}
module.exports = { renderReport };
