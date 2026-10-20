(() => {
  const model = JSON.parse(document.getElementById('report-data').textContent);
  const tests = model.tests;
  const $ = s => document.querySelector(s);
  const labels = { passed: '通过', failed: '失败', flaky: '重试后通过', skipped: '跳过',
    timedOut: '超时', interrupted: '中断', notRun: model.catalogOnly ? '尚未执行' : '本次未执行', unknown: '未知' };
  const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const when = value => value ? new Date(value).toLocaleString('zh-CN') : '未提供';
  const state = { search: '', status: 'all', file: '', open: new Set(), attempts: new Map(), tabs: new Map() };
  const list = $('#test-list');
  const info = [`${model.catalogComplete ? '完整目录' : '导入的执行结果 · 目录未完整刷新'}：${tests.length} 个测试项`,
    `目录快照：${when(model.generatedAt)}`];
  if (model.run) info.push(`本次运行：${when(model.run.startedAt)} · ${labels[model.run.status] || model.run.status || '未知'}${model.run.duration != null ? ' · 耗时 ' + (model.run.duration / 1000).toFixed(1) + 's' : ''}`);
  else info.push('尚未运行；此页面仅展示目录。');
  $('#run-info').textContent = info.join('　');
  function environment(t) {
    return [t.target, t.agent, t.repeat ? '重复执行 ' + (t.repeat + 1) : ''].filter(Boolean).join(' · ');
  }
  function location(t) { return t.file + (t.source?.line ? ':' + t.source.line : ''); }
  function current(t) { return t.attempts[state.attempts.get(t.id) ?? t.attempts.length - 1]; }
  function statusLabel(t) { return (labels[t.status] || t.status) + (t.status === 'passed' && t.expectedStatus === 'failed' ? '（符合预期失败）' : ''); }
  function visible() {
    const q = state.search.toLocaleLowerCase('zh-CN');
    return tests.filter(t => (!state.file || t.file === state.file) && (state.status === 'all' || t.status === state.status)
      && (!q || [t.titlePath.join(' '), t.file, environment(t), ...(t.tags || [])].join(' ').toLocaleLowerCase('zh-CN').includes(q)));
  }
  function pause(node) { node.querySelectorAll('video').forEach(v => v.pause()); }
  function renderNavigation() {
    const files = [...new Set(tests.map(t => t.file))];
    $('#suite-tree').innerHTML = `<button class="suite-node ${!state.file ? 'active' : ''}" data-file="">全部测试 <span>${tests.length}</span></button>`
      + files.map(f => `<button class="suite-node ${state.file === f ? 'active' : ''}" data-file="${esc(f)}">${esc(f || '(未提供文件)')} <span>${tests.filter(t => t.file === f).length}</span></button>`).join('');
  }
  function mediaPanel(items, type) {
    const media = items.filter(m => m.type === type);
    if (!media.length) return `<p class="no-media">本次尝试未产生${type === 'video' ? '录屏' : '截图'}</p>`;
    return '<div class="media-grid' + (type === 'video' ? ' video-grid' : '') + '">' + media.map(m => {
      const caption = (m.shared ? '串行组共享' : '') + (m.type === 'video' ? '录屏 · ' : '截图 · ') + m.name;
      if (m.availability === 'missing') return `<div class="media-card"><p class="no-media">${esc(m.reason)}</p><div class="media-caption">${esc(caption)}</div></div>`;
      if (m.availability === 'remote') return `<div class="media-card"><div class="media-caption"><a href="${esc(m.src)}" target="_blank" rel="noopener noreferrer">打开${esc(caption)}（需联网）</a></div></div>`;
      return `<div class="media-card">${type === 'video'
        ? `<video controls preload="metadata" src="${esc(m.src)}" aria-label="${esc(caption)}"></video><div class="media-controls"><select data-speed aria-label="播放速度"><option value="1">1x</option><option value="0.5">0.5x</option><option value="1.5">1.5x</option><option value="2">2x</option></select><button data-fullscreen>全屏</button></div>`
        : `<img class="media-preview" loading="lazy" src="${esc(m.src)}" alt="${esc(caption)}" tabindex="0" role="button" aria-label="放大${esc(caption)}">`}
        <div class="media-caption">${esc(caption)}</div></div>`;
    }).join('') + '</div>';
  }
  function body(t) {
    const a = current(t);
    if (!a) return `<p class="no-media">${esc(labels[t.status] || t.status)}${t.declaredSkip ? ' · 测试声明为跳过' : ''}${t.reason ? '：' + esc(t.reason) : ''}。没有本次执行的截图或录屏。</p>`;
    const selected = state.attempts.get(t.id) ?? t.attempts.length - 1;
    const tabKey = t.id + ':' + selected;
    const type = state.tabs.get(tabKey) || (a.media.some(m => m.type === 'video') ? 'video' : 'screenshot');
    const types = ['video', 'screenshot'].filter(k => a.media.some(m => m.type === k));
    return `<div class="attempt-control"><label>查看尝试 <select data-attempt class="filter-select">${t.attempts.map((attempt, i) => `<option value="${i}" ${i === selected ? 'selected' : ''}>第 ${attempt.index ?? i + 1} 次 · ${esc(labels[attempt.status] || attempt.status)}</option>`).join('')}</select></label>
      <span>${when(a.startedAt)} · ${(a.duration / 1000).toFixed(1)}s</span></div>
      ${types.length ? `<section class="evidence-section"><div class="evidence-tabs" role="tablist" aria-label="执行证据">${types.map(k => `<button class="evidence-tab" role="tab" aria-selected="${k === type}" data-tab="${k}">${k === 'video' ? '录屏' : '截图'} <span class="evidence-tab-count">${a.media.filter(m => m.type === k).length}</span></button>`).join('')}</div><div class="evidence-panel" role="tabpanel">${mediaPanel(a.media, type)}</div></section>` : '<p class="no-media">本次尝试未产生截图或录屏。</p>'}
      ${a.error ? `<details class="error-details"><summary>错误详情</summary><pre class="error-box">${esc(a.error)}</pre></details>` : ''}`;
  }
  function renderBody(item, t) { const target = item.querySelector('.test-body'); pause(target); target.innerHTML = body(t); }
  function renderList() {
    pause(list);
    const rows = visible();
    list.innerHTML = rows.map(t => {
      const media = t.attempts.flatMap(a => a.media);
      const counts = ['video', 'screenshot'].map(type => `${type === 'video' ? '录屏' : '截图'} ${media.filter(m => m.type === type).length}`).join(' · ');
      const missing = media.filter(m => m.availability === 'missing').length;
      const cls = ['passed', 'failed', 'timedOut', 'skipped', 'flaky'].includes(t.status) ? t.status : 'other';
      return `<article class="test-item ${state.open.has(t.id) ? 'open' : ''}" data-id="${t.id}" data-status="${t.status}"><div class="test-header">
      <span class="status-badge ${cls}">${esc(statusLabel(t))}</span><button class="test-toggle" aria-expanded="${state.open.has(t.id)}"><div class="test-title">${esc(t.titlePath.join(' › '))}</div><div class="test-meta">${esc(location(t))}${environment(t) ? ' · ' + esc(environment(t)) : ''}${t.kind === 'setup' ? ' · 准备测试' : ''}</div><div class="test-media-count">${counts}${missing ? ' · ' + missing + ' 个文件不可用' : ''}</div></button>
      <button class="soft-button" data-copy>复制给 AI</button></div><div class="test-body"></div></article>`;
    }).join('') || `<p class="empty">${tests.length ? '没有匹配的测试' : '未发现测试'}</p>`;
    for (const item of list.querySelectorAll('.test-item.open')) renderBody(item, tests.find(t => t.id === item.dataset.id));
    $('#visible-count').textContent = `显示 ${rows.length} / ${tests.length} 个测试项`;
  }
  function copyText(t) {
    const a = current(t);
    return [`测试：${t.titlePath.join(' › ')}`, `位置：${location(t) || '未提供'}`,
      `框架：${t.framework}`, t.nativeId ? '测试 ID：' + t.nativeId : '',
      environment(t) ? '执行环境：' + environment(t) : '', `状态：${statusLabel(t)}`,
      model.run ? `运行时间：${when(model.run.startedAt)}` : '运行：尚未执行',
      model.run?.id ? '运行 ID：' + model.run.id : '',
      a ? `查看尝试：第 ${a.index ?? t.attempts.indexOf(a) + 1} 次 · ${labels[a.status] || a.status}` : '',
      a?.error ? '错误摘要：' + a.error.slice(0, 3000) : '',
      ...(a?.media || []).map(m => `${m.shared ? '串行组共享' : ''}${m.type === 'video' ? '录屏' : '截图'}：${m.src || m.originalPath || '无可用文件'}${m.availability === 'missing' ? '（文件不可用）' : ''}`),
    ].filter(Boolean).join('\n');
  }
  async function copy(t) {
    const text = copyText(t);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);
      $('#copy-status').textContent = '已复制测试信息'; $('#copy-status').hidden = false;
      setTimeout(() => { $('#copy-status').hidden = true; }, 2200);
    } catch {
      $('#copy-text').value = text; $('#copy-modal').showModal(); $('#copy-text').focus(); $('#copy-text').select();
    }
  }
  list.addEventListener('click', event => {
    const item = event.target.closest('.test-item');
    if (!item) return;
    const t = tests.find(t => t.id === item.dataset.id);
    if (event.target.closest('[data-copy]')) { copy(t); return; }
    if (event.target.closest('.test-toggle')) {
      const opening = !state.open.has(t.id);
      if (opening) { state.open.add(t.id); renderBody(item, t); }
      else { state.open.delete(t.id); pause(item); }
      item.classList.toggle('open', opening); item.querySelector('.test-toggle').setAttribute('aria-expanded', opening); return;
    }
    const tab = event.target.closest('[data-tab]');
    if (tab) { state.tabs.set(t.id + ':' + (state.attempts.get(t.id) ?? t.attempts.length - 1), tab.dataset.tab); renderBody(item, t); return; }
    const img = event.target.closest('.media-preview');
    if (img) { $('#modal-image').src = img.src; $('#image-modal').showModal(); return; }
    if (event.target.closest('[data-fullscreen]')) event.target.closest('.media-card').querySelector('video')?.requestFullscreen?.().catch(() => {});
  });
  list.addEventListener('change', event => {
    const item = event.target.closest('.test-item');
    const t = tests.find(t => t.id === item?.dataset.id);
    if (event.target.matches('[data-attempt]')) { state.attempts.set(t.id, Number(event.target.value)); renderBody(item, t); }
    if (event.target.matches('[data-speed]')) event.target.closest('.media-card').querySelector('video').playbackRate = Number(event.target.value);
  });
  list.addEventListener('keydown', e => {
    if (e.target.matches('.media-preview') && ['Enter', ' '].includes(e.key)) { e.preventDefault(); e.target.click(); }
    if (e.target.matches('[role="tab"]') && ['ArrowRight', 'ArrowLeft'].includes(e.key)) {
      e.preventDefault(); const tabs = [...e.target.parentElement.children];
      const next = tabs[(tabs.indexOf(e.target) + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      next.click(); e.target.closest('.test-item').querySelector(`[data-tab="${next.dataset.tab}"]`).focus();
    }
  });
  $('#suite-tree').addEventListener('click', e => {
    const button = e.target.closest('[data-file]'); if (!button) return;
    state.file = button.dataset.file; renderNavigation(); renderList();
  });
  $('#search').addEventListener('input', e => { state.search = e.target.value; renderList(); });
  $('#status-filter').addEventListener('change', e => { state.status = e.target.value; renderList(); });
  $('#expand-all').addEventListener('click', () => { visible().forEach(t => state.open.add(t.id)); renderList(); });
  $('#collapse-all').addEventListener('click', () => { state.open.clear(); renderList(); });
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => document.getElementById(b.dataset.close).close()));
  document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));
  renderNavigation(); renderList();
})();
