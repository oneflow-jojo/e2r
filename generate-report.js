#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const RESULTS_DIR = path.resolve(process.argv[2] || 'test-results');
const JSON_REPORT = path.resolve(process.argv[3] || 'playwright-report/report.json');
const OUTPUT = path.resolve(process.argv[4] || 'e2r-report/report.html');

function fileToBase64DataUri(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webm': 'video/webm',
    '.mp4': 'video/mp4',
  };
  const mime = mimeMap[ext] || 'application/octet-stream';
  const data = fs.readFileSync(filePath);
  return `data:${mime};base64,${data.toString('base64')}`;
}

function findMediaFiles(testDir) {
  if (!fs.existsSync(testDir)) return { screenshots: [], videos: [] };
  const screenshots = [];
  const videos = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (['.png', '.jpg', '.jpeg'].includes(ext)) screenshots.push(full);
        if (['.webm', '.mp4'].includes(ext)) videos.push(full);
      }
    }
  }
  walk(testDir);
  return { screenshots, videos };
}

function loadReport(jsonPath) {
  if (!fs.existsSync(jsonPath)) return null;
  return JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
}

// Detect report format: 'playwright' or 'e2e'
function detectFormat(report) {
  if (!report) return 'playwright';
  if (report.schemaVersion && report.run) return 'e2e';
  if (report.suites) return 'playwright';
  return 'playwright';
}

// Extract tests from Playwright JSON report
function extractPlaywrightTests(report) {
  if (!report || !report.suites) return [];
  const tests = [];
  function walkSuites(suites, suitePath = []) {
    for (const suite of suites) {
      const currentPath = [...suitePath, suite.title];
      if (suite.specs) {
        for (const spec of suite.specs) {
          for (const test of spec.tests || []) {
            const lastResult = test.results?.[test.results.length - 1];
            tests.push({
              title: spec.title,
              suite: currentPath.join(' > '),
              status: lastResult?.status || test.status || 'unknown',
              duration: lastResult?.duration || 0,
              startTime: lastResult?.startTime || null,
              error: lastResult?.error?.message || null,
              retryCount: test.results ? test.results.length - 1 : 0,
              results: test.results || [],
            });
          }
        }
      }
      if (suite.suites) walkSuites(suite.suites, currentPath);
    }
  }
  walkSuites(report.suites);
  return tests;
}

// Extract tests from e2e (tester-army) JSON report
function extractE2ETests(report, baseDir) {
  if (!report || !report.run || !report.run.results) return [];
  const results = report.run.results;
  const summary = report.run.summary || {};
  const tests = [];

  for (const result of results) {
    const titlePath = result.titlePath || [];
    const title = titlePath[titlePath.length - 1] || result.testId || '(unnamed)';
    // Use filename as suite for grouping
    const fileName = result.file ? path.basename(result.file, path.extname(result.file)) : '';
    const suite = fileName || '';

    const attempts = result.attempts || [];
    const lastAttempt = attempts[attempts.length - 1];
    const status = result.status || 'unknown';
    const durationMs = lastAttempt?.durationMs || 0;
    const retryCount = Math.max(0, attempts.length - 1);

    // Collect artifacts from all attempts
    const screenshotPaths = [];
    const videoPaths = [];
    let errorMessage = null;

    for (const attempt of attempts) {
      // Error from attempt
      if (attempt.error && !errorMessage) {
        errorMessage = attempt.error.message || null;
      }
      // Also check failure.error
      if (attempt.failure?.error && !errorMessage) {
        errorMessage = attempt.failure.error.message || null;
      }

      // Artifacts
      const artifacts = attempt.artifacts || [];
      for (const artifact of artifacts) {
        if (artifact.kind === 'screenshot' && artifact.path) {
          screenshotPaths.push(path.join(baseDir, artifact.path));
        } else if (artifact.kind === 'video' && artifact.path) {
          videoPaths.push(path.join(baseDir, artifact.path));
        }
      }
    }

    // For skipped tests, get skip reason
    if (status === 'skipped' && result.skip) {
      errorMessage = result.skip.reason || 'Skipped';
    }

    tests.push({
      title,
      suite,
      status,
      duration: durationMs,
      error: errorMessage,
      retryCount,
      tags: result.tags || [],
      kind: result.kind || 'test',
      targetId: result.targetId || null,
      file: result.file || null,
      _screenshotPaths: screenshotPaths,
      _videoPaths: videoPaths,
    });
  }

  return tests;
}

function extractTests(report, baseDir) {
  const format = detectFormat(report);
  if (format === 'e2e') {
    return extractE2ETests(report, baseDir);
  }
  return extractPlaywrightTests(report);
}

function buildSuiteTree(tests) {
  const root = { name: 'Root', path: '', tests: [], children: [] };
  for (const test of tests) {
    const parts = test.suite ? test.suite.split(' > ') : [];
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const segment = parts[i];
      const segPath = parts.slice(0, i + 1).join(' > ');
      let child = node.children.find(c => c.name === segment);
      if (!child) {
        child = { name: segment, path: segPath, tests: [], children: [] };
        node.children.push(child);
      }
      node = child;
    }
    node.tests.push(test.id);
  }
  return root;
}

function generateHTML(tests, resultsDir) {
  const passed = tests.filter(t => t.status === 'passed');
  const failed = tests.filter(t => t.status === 'failed' || t.status === 'timedOut');

  // Build media map from resultsDir (Playwright-style)
  const mediaByTest = {};
  if (resultsDir && fs.existsSync(resultsDir)) {
    for (const entry of fs.readdirSync(resultsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const { screenshots, videos } = findMediaFiles(path.join(resultsDir, entry.name));
        mediaByTest[entry.name] = { screenshots, videos };
      }
    }
  }

  const testDetails = tests.map((test, idx) => {
    let screenshotDataUris = [];
    let videoDataUris = [];

    // If pre-resolved paths exist (e2e format), use them directly
    if (test._screenshotPaths && test._screenshotPaths.length > 0) {
      screenshotDataUris = test._screenshotPaths
        .filter(f => fs.existsSync(f))
        .map(f => ({ name: path.basename(f), uri: fileToBase64DataUri(f) }));
    }
    if (test._videoPaths && test._videoPaths.length > 0) {
      videoDataUris = test._videoPaths
        .filter(f => fs.existsSync(f))
        .map(f => ({ name: path.basename(f), uri: fileToBase64DataUri(f) }));
    }

    // Fallback: try fuzzy matching from resultsDir (Playwright format)
    if (screenshotDataUris.length === 0 && videoDataUris.length === 0 && resultsDir) {
      const testDirName = Object.keys(mediaByTest).find(key => {
        const normalized = key.replace(/-/g, ' ').toLowerCase();
        const title = test.title.replace(/-/g, ' ').toLowerCase();
        const titleWords = title.split(/\s+/).filter(w => w.length > 3);
        const matchesWord = titleWords.some(word => normalized.includes(word));
        return matchesWord || normalized.includes(title) || title.includes(normalized.split('/').pop());
      });
      const media = testDirName ? mediaByTest[testDirName] : { screenshots: [], videos: [] };
      screenshotDataUris = media.screenshots.map(f => ({ name: path.basename(f), uri: fileToBase64DataUri(f) }));
      videoDataUris = media.videos.map(f => ({ name: path.basename(f), uri: fileToBase64DataUri(f) }));
    }

    // Strip internal fields
    const { _screenshotPaths, _videoPaths, ...clean } = test;
    return { ...clean, id: idx, screenshotDataUris, videoDataUris };
  });

  const suiteTree = buildSuiteTree(testDetails);
  const flakyCount = testDetails.filter(t => t.retryCount > 0 && t.status === 'passed').length;
  const testsJson = JSON.stringify(testDetails);
  const suiteTreeJson = JSON.stringify(suiteTree);
  const generatedAt = new Date().toLocaleString('zh-CN');
  const totalDuration = tests.reduce((sum, t) => sum + t.duration, 0);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="dark">
<title>E2E Test Report</title>
<style>
:root {
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  color: #eeeeef;
  background: #0b0b0c;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  --ink: #eeeeef;
  --muted: #929298;
  --subtle: #696971;
  --line: #29292d;
  --surface: #111113;
  --card: #151517;
  --wash: #0b0b0c;
  --raised: #202023;
  --green: #c5e5ca;
  --green-soft: #24372a;
  --red: #f0bcbc;
  --red-soft: #432c2c;
  --amber: #ddd5b4;
  --amber-soft: #393528;
  --shadow: 0 3px 14px #0005;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { margin: 0; min-width: 320px; min-height: 100vh; background: var(--wash); }
button, input, select { font: inherit; }
button { color: inherit; }
a { color: inherit; }
button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible {
  outline: 2px solid var(--green);
  outline-offset: 3px;
}
[hidden] { display: none !important; }

.topbar {
  position: sticky; top: 0; z-index: 4;
  display: flex; align-items: center; gap: 15px;
  min-height: 56px; padding: 0 24px;
  background: var(--surface); border-bottom: 1px solid var(--line);
}
.brand { display: flex; align-items: center; gap: 10px; }
.brandmark {
  display: grid; place-items: center;
  width: 31px; height: 31px;
  border: 1px solid #485b4a; border-radius: 8px;
  background: var(--green-soft); color: var(--green);
}
.brandmark svg { width: 19px; height: 19px; }
.brand-title { font-size: 15px; font-weight: 650; letter-spacing: -.02em; }
.brand-sub { margin-top: 2px; color: var(--muted); font-size: 10px; }
.top-spacer { flex: 1; }
.duration-pill {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 6px 12px; border: 1px solid #36363b; border-radius: 99px;
  background: var(--raised); color: var(--muted);
  font-size: 10px; font-weight: 600; white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.workspace {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  width: 100%;
  height: calc(100vh - 56px);
  min-height: 560px;
}
.sidebar {
  display: flex; flex-direction: column; min-width: 0;
  padding: 20px 12px 24px 18px;
  border-right: 1px solid var(--line);
  background: var(--surface);
  overflow-y: auto;
  scrollbar-color: #3b3b41 transparent; scrollbar-width: thin;
}
.section-label {
  margin: 0 0 9px; padding: 0 9px;
  color: var(--subtle); font-size: 10px; font-weight: 700;
  letter-spacing: .12em; text-transform: uppercase;
}
.suite-node {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  width: 100%; padding: 7px 9px; border: 0; border-radius: 6px;
  background: transparent; color: #a6a6ad; text-align: left;
  font-size: 12px; cursor: pointer; transition: background .15s, color .15s;
}
.suite-node:hover { background: #1c1c1f; color: #f0f0f1; }
.suite-node.active { background: #242428; color: #fff; font-weight: 650; }
.suite-count { color: #77777f; font-size: 10px; font-variant-numeric: tabular-nums; }
.suite-node.active .suite-count { color: #bfc0c4; }
.suite-children {
  display: flex; flex-direction: column; gap: 2px;
  margin: 3px 0 6px 11px; padding-left: 7px;
  border-left: 1px solid #303035;
}
.suite-toggle {
  width: 20px; height: 20px; padding: 0; border: 0; border-radius: 4px;
  background: transparent; color: #77777f; font-size: 10px;
  cursor: pointer; flex-shrink: 0; display: grid; place-items: center;
}
.suite-toggle:hover { background: #1c1c1f; color: #f0f0f1; }
.sidebar-stats {
  margin-top: auto; padding-top: 16px; border-top: 1px solid var(--line);
  color: #77777f; font-size: 10px; line-height: 1.7;
}

.main {
  overflow-y: auto; background: #0f0f11;
  scrollbar-color: #3b3b41 transparent; scrollbar-width: thin;
  padding: 24px clamp(16px, 3vw, 48px) 52px;
}
.page-shell { width: 100%; max-width: 1200px; margin: 0 auto; }

.summary-grid {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px; margin-bottom: 20px;
}
.summary-metric {
  min-width: 0; padding: 15px 17px;
  border: 1px solid #303035; border-radius: 9px;
  background: #141416;
}
.summary-metric-label { color: var(--muted); font-size: 11px; }
.summary-metric-value {
  margin-top: 8px; font-size: 23px; font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.summary-metric-value.green { color: var(--green); }
.summary-metric-value.red { color: var(--red); }
.summary-metric-value.amber { color: var(--amber); }

.toolbar {
  display: flex; gap: 9px; align-items: center; flex-wrap: wrap;
  margin-bottom: 16px;
}
.search {
  flex: 1; min-width: 180px; padding: 9px 10px;
  border: 1px solid #343439; border-radius: 7px;
  background: #19191c; color: var(--ink); font-size: 12px;
}
.search::placeholder { color: #6e6e76; }
.search:focus { border-color: #718e76; box-shadow: 0 0 0 3px #a6d8af14; }
.filter-select {
  min-width: 0; padding: 7px 22px 7px 8px;
  border: 1px solid #343439; border-radius: 6px;
  background: #19191c; color: #c2c2c8; font-size: 11px;
}
.filter-select:focus { border-color: #718e76; }
.soft-button {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 7px 10px; border: 1px solid #36363b; border-radius: 7px;
  background: #222225; color: #e7e7e9; font-size: 11px;
  white-space: nowrap; cursor: pointer;
  transition: background .15s, border-color .15s;
}
.soft-button:hover { border-color: #505057; background: #303034; }
.visible-count { color: #85858d; font-size: 10px; white-space: nowrap; margin-left: auto; }

.status-badge {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 7px; border-radius: 5px;
  font-size: 10px; font-weight: 650; white-space: nowrap;
}
.status-badge:before {
  content: ""; width: 5px; height: 5px; border-radius: 50%;
  background: currentColor;
}
.status-badge.passed { background: var(--green-soft); color: var(--green); }
.status-badge.failed, .status-badge.timedOut { background: var(--red-soft); color: var(--red); }
.status-badge.skipped { background: var(--amber-soft); color: var(--amber); }
.status-badge.other { background: #2b2b31; color: #b0b0ba; }
.status-badge.flaky { background: var(--amber-soft); color: var(--amber); }

.setup-badge {
  display: inline-flex; align-items: center;
  padding: 3px 6px; border-radius: 4px;
  background: #1e2a3a; color: #7eb8da;
  font-size: 9px; font-weight: 600; white-space: nowrap;
}
.tag-list { display: inline-flex; gap: 4px; flex-shrink: 0; }
.tag-badge {
  display: inline-flex; align-items: center;
  padding: 2px 6px; border-radius: 4px;
  background: #2a2a30; color: #9898a0;
  font-size: 9px; white-space: nowrap;
}

.test-item {
  border: 1px solid #303035; border-radius: 9px;
  background: var(--card); margin-bottom: 8px;
  overflow: hidden; transition: border-color .15s;
}
.test-item:hover { border-color: #4a4a51; }
.test-item.flaky { border-left: 3px solid var(--amber); }
.test-header {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 16px; cursor: pointer;
  transition: background .15s;
}
.test-header:hover { background: #1a1a1d; }
.test-title { flex: 1; font-size: 13px; font-weight: 500; color: #e9e9eb; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.test-suite { font-size: 11px; color: var(--muted); margin-right: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; }
.test-duration { font-size: 11px; color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.test-body {
  display: none; padding: 0 16px 16px;
  border-top: 1px solid var(--line);
}
.test-item.open .test-body { display: block; }

.error-box {
  margin-top: 12px; padding: 14px 16px;
  border: 1px solid #35353a; border-left: 3px solid #c06a62;
  border-radius: 9px; background: var(--card);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px; line-height: 1.7;
  white-space: pre-wrap; word-break: break-all;
  color: var(--red); box-shadow: var(--shadow);
}

.evidence-section { margin-top: 14px; }
.evidence-tabs {
  display: flex; gap: 5px;
  border-bottom: 1px solid var(--line);
}
.evidence-tab {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 38px; padding: 8px 12px;
  border: 0; border-bottom: 2px solid transparent;
  border-radius: 6px 6px 0 0;
  background: transparent; color: var(--muted);
  font-size: 11px; cursor: pointer;
}
.evidence-tab:hover { color: #dedee1; background: #19191c; }
.evidence-tab[aria-selected="true"] { border-bottom-color: var(--green); color: #eee; }
.evidence-tab-count {
  min-width: 19px; padding: 2px 5px; border-radius: 99px;
  background: #292b2a; color: #c9ccca;
  font-size: 9px; line-height: 1.25; text-align: center;
}
.evidence-panel { min-width: 0; padding-top: 12px; }
.evidence-panel[hidden] { display: none; }

.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 9px;
}
.media-card {
  overflow: hidden; border: 1px solid #303035;
  border-radius: 8px; background: var(--card);
}
.media-card img.media-preview {
  display: block; width: 100%; height: 148px;
  object-fit: cover; background: #1e1e21; cursor: zoom-in;
}
.media-card video { display: block; width: 100%; aspect-ratio: 16/9; background: #09090a; }
.media-caption {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 8px 9px; color: #aaaab1; font-size: 10px;
}
.media-caption span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.media-controls {
  display: flex; align-items: center; gap: 8px;
  padding: 0 9px 9px; color: var(--muted); font-size: 10px;
}
.media-controls select {
  padding: 4px 6px; border: 1px solid #36363b; border-radius: 4px;
  background: #1c1c1f; color: #d0d0d4; font-size: 9px;
}
.media-controls button {
  padding: 4px 8px; border: 1px solid #36363b; border-radius: 4px;
  background: #1c1c1f; color: #d0d0d4; font-size: 9px;
  cursor: pointer;
}
.media-controls button:hover { background: #2a2a2e; }

.no-media { margin-top: 12px; color: var(--muted); font-size: 11px; font-style: italic; }

.suite-group { margin-bottom: 16px; }
.suite-group-header {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 0; cursor: pointer;
  color: var(--muted); font-size: 11px; font-weight: 600;
}
.suite-group-header:hover { color: var(--ink); }
.suite-group-header .arrow {
  display: inline-block; transition: transform .15s;
  font-size: 10px; width: 14px; text-align: center;
}
.suite-group-header.collapsed .arrow { transform: rotate(-90deg); }
.suite-group-header .group-count { color: #77777f; font-size: 10px; font-weight: 400; }

.modal {
  max-width: min(92vw, 1100px); max-height: 92vh;
  padding: 10px; border: 1px solid #414147; border-radius: 10px;
  background: #19191c; color: var(--ink);
  box-shadow: 0 20px 80px #000b;
}
.modal::backdrop { background: #050506c9; }
.modal img { display: block; max-width: 100%; max-height: 82vh; object-fit: contain; }
.modal-close { display: flex; justify-content: flex-end; margin-bottom: 6px; }
.modal-close button {
  padding: 5px 9px; border: 1px solid #3c3c42; border-radius: 5px;
  background: #252529; color: #ddd; font-size: 10px; cursor: pointer;
}

@media (max-width: 1180px) {
  .workspace { grid-template-columns: 190px minmax(0, 1fr); }
  .main { padding-inline: 20px; }
}
@media (max-width: 920px) {
  .workspace { grid-template-columns: 160px minmax(0, 1fr); }
  .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .test-suite { display: none; }
}
@media (max-width: 640px) {
  .topbar { min-height: 48px; padding: 8px 12px; gap: 8px; }
  .brandmark { width: 28px; height: 28px; }
  .brand-title { font-size: 13px; }
  .workspace { display: flex; flex-direction: column; height: auto; min-height: calc(100vh - 48px); }
  .sidebar {
    position: static; height: auto; order: 0;
    padding: 12px; border-right: 0; border-bottom: 1px solid var(--line);
    max-height: 180px;
  }
  .main { order: 1; padding: 16px 12px 35px; }
  .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .summary-metric { padding: 11px 10px; }
  .summary-metric-value { margin-top: 6px; font-size: 19px; }
  .toolbar { gap: 6px; }
  .search { min-width: 120px; }
  .media-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
}
</style>
</head>
<body>
<header class="topbar">
  <div class="brand">
    <div class="brandmark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6M10 3v6.5l-5.4 6.1A2 2 0 0 0 6.1 19h11.8a2 2 0 0 0 1.5-3.4L14 9.5V3M8 14h8"/></svg></div>
    <div>
      <div class="brand-title">E2E Test Report</div>
      <div class="brand-sub">${generatedAt}</div>
    </div>
  </div>
  <div class="top-spacer"></div>
  <span class="duration-pill">耗时 ${(totalDuration / 1000).toFixed(1)}s</span>
</header>
<main class="workspace">
  <aside class="sidebar" aria-label="套件导航">
    <p class="section-label">测试套件</p>
    <nav id="suite-tree"></nav>
    <div class="sidebar-stats">
      ${tests.length} 个测试 · ${suiteTree.children.length} 个套件
    </div>
  </aside>
  <div class="main">
    <div class="page-shell">
      <div class="summary-grid">
        <div class="summary-metric">
          <div class="summary-metric-label">总计</div>
          <div class="summary-metric-value">${tests.length}</div>
        </div>
        <div class="summary-metric">
          <div class="summary-metric-label">通过</div>
          <div class="summary-metric-value green">${passed.length}</div>
        </div>
        <div class="summary-metric">
          <div class="summary-metric-label">失败</div>
          <div class="summary-metric-value red">${failed.length}</div>
        </div>
        <div class="summary-metric">
          <div class="summary-metric-label">不稳定</div>
          <div class="summary-metric-value amber">${flakyCount}</div>
        </div>
      </div>
      <div class="toolbar">
        <input id="search" class="search" type="search" placeholder="搜索测试名称或套件" aria-label="搜索测试">
        <select id="status-filter" class="filter-select" aria-label="状态筛选">
          <option value="all">全部状态</option>
          <option value="passed">通过</option>
          <option value="failed">失败</option>
          <option value="flaky">不稳定</option>
          <option value="skipped">跳过</option>
        </select>
        <select id="sort-select" class="filter-select" aria-label="排序">
          <option value="default">默认排序</option>
          <option value="duration-desc">最慢优先</option>
          <option value="duration-asc">最快优先</option>
          <option value="name-asc">名称 A-Z</option>
          <option value="name-desc">名称 Z-A</option>
        </select>
        <button class="soft-button" id="expand-all" type="button">全部展开</button>
        <button class="soft-button" id="collapse-all" type="button">全部收起</button>
        <span class="visible-count" id="visible-count"></span>
      </div>
      <div id="test-list"></div>
    </div>
  </div>
</main>
<dialog class="modal" id="image-modal">
  <div class="modal-close"><button type="button" id="close-modal">关闭</button></div>
  <img id="modal-image" alt="截图预览">
</dialog>
<script>
(() => {
  const tests = ${testsJson};
  const suiteTree = ${suiteTreeJson};
  const $ = (sel) => document.querySelector(sel);
  const suiteTreeEl = $('#suite-tree');
  const testListEl = $('#test-list');
  const visibleCountEl = $('#visible-count');
  const modal = $('#image-modal');
  const modalImg = $('#modal-image');

  const state = {
    search: '',
    statusFilter: 'all',
    sortBy: 'default',
    suiteFilter: null,
    openTests: new Set(),
    collapsedSuiteGroups: new Set(),
    expandedTreeNodes: new Set(suiteTree.children.map(c => c.path)),
  };

  const statusLabels = { passed: '通过', failed: '失败', timedOut: '超时', skipped: '跳过' };

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatDuration(ms) {
    if (ms < 1000) return ms + 'ms';
    return (ms / 1000).toFixed(1) + 's';
  }

  function isFlaky(t) { return t.retryCount > 0 && t.status === 'passed'; }

  function statusClass(t) {
    if (isFlaky(t)) return 'flaky';
    if (['passed', 'failed', 'timedOut', 'skipped'].includes(t.status)) return t.status;
    return 'other';
  }

  function statusLabel(t) {
    if (isFlaky(t)) return '不稳定 (' + t.retryCount + '次重试)';
    return statusLabels[t.status] || t.status.toUpperCase();
  }

  function getVisibleTests() {
    let result = tests.slice();
    if (state.suiteFilter) {
      result = result.filter(t => t.suite === state.suiteFilter || t.suite.startsWith(state.suiteFilter + ' > '));
    }
    if (state.statusFilter === 'passed') result = result.filter(t => t.status === 'passed' && !isFlaky(t));
    else if (state.statusFilter === 'failed') result = result.filter(t => t.status === 'failed' || t.status === 'timedOut');
    else if (state.statusFilter === 'flaky') result = result.filter(t => isFlaky(t));
    else if (state.statusFilter === 'skipped') result = result.filter(t => t.status === 'skipped');
    if (state.search) {
      const q = state.search.toLocaleLowerCase('zh-CN');
      result = result.filter(t => (t.title + ' ' + t.suite).toLocaleLowerCase('zh-CN').includes(q));
    }
    if (state.sortBy === 'duration-desc') result.sort((a, b) => b.duration - a.duration);
    else if (state.sortBy === 'duration-asc') result.sort((a, b) => a.duration - b.duration);
    else if (state.sortBy === 'name-asc') result.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
    else if (state.sortBy === 'name-desc') result.sort((a, b) => b.title.localeCompare(a.title, 'zh-CN'));
    return result;
  }

  function renderSuiteTree() {
    let html = '<button class="suite-node' + (!state.suiteFilter ? ' active' : '') + '" data-suite-path="">全部测试<span class="suite-count">' + tests.length + '</span></button>';
    function renderNode(node, depth) {
      if (node.children.length === 0 && node.tests.length === 0) return '';
      const hasChildren = node.children.length > 0;
      const isActive = state.suiteFilter === node.path;
      const isExpanded = state.expandedTreeNodes.has(node.path);
      const count = countTestsInNode(node);
      let s = '';
      const indent = 9 + depth * 12;
      s += '<button class="suite-node' + (isActive ? ' active' : '') + '" data-suite-path="' + escapeHtml(node.path) + '" style="padding-left:' + indent + 'px">';
      if (hasChildren) {
        s += '<span class="suite-toggle" data-toggle-path="' + escapeHtml(node.path) + '">' + (isExpanded ? '▾' : '▸') + '</span>';
      }
      s += '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(node.name) + '</span>';
      s += '<span class="suite-count">' + count + '</span></button>';
      if (hasChildren && isExpanded) {
        s += '<div class="suite-children">';
        for (const child of node.children) s += renderNode(child, depth + 1);
        s += '</div>';
      }
      return s;
    }
    for (const child of suiteTree.children) html += renderNode(child, 0);
    suiteTreeEl.innerHTML = html;
  }

  function countTestsInNode(node) {
    let count = node.tests.length;
    for (const child of node.children) count += countTestsInNode(child);
    return count;
  }

  function renderTestBody(t) {
    let body = '';
    if (t.error) {
      body += '<div class="error-box">' + escapeHtml(t.error) + '</div>';
    }
    const hasScreenshots = t.screenshotDataUris.length > 0;
    const hasVideos = t.videoDataUris.length > 0;
    if (hasScreenshots || hasVideos) {
      body += '<div class="evidence-section">';
      body += '<div class="evidence-tabs" role="tablist">';
      body += '<button class="evidence-tab" role="tab" aria-selected="true" data-tab="screenshots-' + t.id + '">截图<span class="evidence-tab-count">' + t.screenshotDataUris.length + '</span></button>';
      body += '<button class="evidence-tab" role="tab" aria-selected="false" data-tab="videos-' + t.id + '">录屏<span class="evidence-tab-count">' + t.videoDataUris.length + '</span></button>';
      body += '</div>';
      body += '<div class="evidence-panel" role="tabpanel" data-panel="screenshots-' + t.id + '">';
      if (hasScreenshots) {
        body += '<div class="media-grid">';
        for (const s of t.screenshotDataUris) {
          body += '<div class="media-card"><img class="media-preview" src="' + s.uri + '" alt="' + escapeHtml(s.name) + '" data-modal-src="' + s.uri + '"><div class="media-caption"><span>' + escapeHtml(s.name) + '</span></div></div>';
        }
        body += '</div>';
      } else {
        body += '<div class="no-media">无截图</div>';
      }
      body += '</div>';
      body += '<div class="evidence-panel" role="tabpanel" data-panel="videos-' + t.id + '" hidden>';
      if (hasVideos) {
        body += '<div class="media-grid">';
        for (let vi = 0; vi < t.videoDataUris.length; vi++) {
          const v = t.videoDataUris[vi];
          const vid = 'video-' + t.id + '-' + vi;
          body += '<div class="media-card"><video id="' + vid + '" controls preload="metadata" src="' + v.uri + '"></video><div class="media-controls"><select data-video-id="' + vid + '"><option value="1">1x</option><option value="0.5">0.5x</option><option value="1.5">1.5x</option><option value="2">2x</option></select><button data-video-id="' + vid + '" data-action="fullscreen">全屏</button></div><div class="media-caption"><span>' + escapeHtml(v.name) + '</span></div></div>';
        }
        body += '</div>';
      } else {
        body += '<div class="no-media">无录屏</div>';
      }
      body += '</div></div>';
    }
    if (!t.error && !hasScreenshots && !hasVideos) {
      body += '<div class="no-media">无截图或录屏</div>';
    }
    return body;
  }

  function renderTestList() {
    const visible = getVisibleTests();
    const groups = new Map();
    for (const t of visible) {
      const key = t.suite || '(无套件)';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    let html = '';
    for (const [suitePath, suiteTests] of groups) {
      const isCollapsed = state.collapsedSuiteGroups.has(suitePath);
      const passCount = suiteTests.filter(t => t.status === 'passed').length;
      const failCount = suiteTests.filter(t => t.status === 'failed' || t.status === 'timedOut').length;
      const segments = suitePath.split(' > ');
      const displayName = segments[segments.length - 1] || suitePath;
      html += '<div class="suite-group">';
      html += '<div class="suite-group-header' + (isCollapsed ? ' collapsed' : '') + '" data-suite-group="' + escapeHtml(suitePath) + '">';
      html += '<span class="arrow">▾</span>';
      html += '<span>' + escapeHtml(displayName) + '</span>';
      html += '<span class="group-count">' + suiteTests.length + ' 个测试';
      if (passCount > 0) html += ' · <span style="color:var(--green)">' + passCount + ' 通过</span>';
      if (failCount > 0) html += ' · <span style="color:var(--red)">' + failCount + ' 失败</span>';
      html += '</span></div>';
      if (!isCollapsed) {
        for (const t of suiteTests) {
          const sc = statusClass(t);
          const sl = statusLabel(t);
          const isOpen = state.openTests.has(t.id);
          html += '<div class="test-item' + (isFlaky(t) ? ' flaky' : '') + (isOpen ? ' open' : '') + '" data-status="' + t.status + '" data-test-id="' + t.id + '">';
          html += '<div class="test-header">';
          html += '<span class="status-badge ' + sc + '">' + sl + '</span>';
          if (t.kind === 'setup') html += '<span class="setup-badge">setup</span>';
          html += '<div class="test-title">' + escapeHtml(t.title) + '</div>';
          if (t.tags && t.tags.length > 0) {
            html += '<span class="tag-list">';
            for (const tag of t.tags) html += '<span class="tag-badge">' + escapeHtml(tag) + '</span>';
            html += '</span>';
          }
          html += '<div class="test-suite">' + escapeHtml(t.suite) + '</div>';
          html += '<div class="test-duration">' + formatDuration(t.duration) + '</div>';
          html += '</div>';
          html += '<div class="test-body">' + renderTestBody(t) + '</div>';
          html += '</div>';
        }
      }
      html += '</div>';
    }
    if (visible.length === 0) {
      html = '<div style="padding:36px 18px;border:1px dashed #3a3a40;border-radius:9px;background:#141416;color:#9999a1;text-align:center;font-size:12px;line-height:1.75;margin-top:16px">没有匹配的测试</div>';
    }
    testListEl.innerHTML = html;
    visibleCountEl.textContent = '显示 ' + visible.length + ' / ' + tests.length + ' 个测试';
  }

  function render() {
    renderSuiteTree();
    renderTestList();
  }

  suiteTreeEl.addEventListener('click', (e) => {
    const toggle = e.target.closest('.suite-toggle');
    if (toggle) {
      e.stopPropagation();
      const p = toggle.dataset.togglePath;
      if (state.expandedTreeNodes.has(p)) state.expandedTreeNodes.delete(p);
      else state.expandedTreeNodes.add(p);
      renderSuiteTree();
      return;
    }
    const node = e.target.closest('.suite-node');
    if (node) {
      const p = node.dataset.suitePath;
      state.suiteFilter = (state.suiteFilter === p) ? null : (p || null);
      render();
    }
  });

  testListEl.addEventListener('click', (e) => {
    const tab = e.target.closest('.evidence-tab');
    if (tab) {
      const tabId = tab.dataset.tab;
      const tabbar = tab.closest('.evidence-tabs');
      const section = tab.closest('.evidence-section');
      for (const t of tabbar.querySelectorAll('.evidence-tab')) t.setAttribute('aria-selected', 'false');
      tab.setAttribute('aria-selected', 'true');
      for (const p of section.querySelectorAll('.evidence-panel')) {
        const isMatch = p.dataset.panel === tabId;
        if (isMatch) { p.removeAttribute('hidden'); }
        else {
          p.setAttribute('hidden', '');
          for (const v of p.querySelectorAll('video')) v.pause();
        }
      }
      return;
    }
    const img = e.target.closest('img.media-preview');
    if (img && img.dataset.modalSrc) {
      modalImg.src = img.dataset.modalSrc;
      modal.showModal();
      return;
    }
    const fsBtn = e.target.closest('button[data-action="fullscreen"]');
    if (fsBtn) {
      const video = document.getElementById(fsBtn.dataset.videoId);
      if (video && video.requestFullscreen) video.requestFullscreen();
      return;
    }
    const header = e.target.closest('.test-header');
    if (header) {
      const item = header.closest('.test-item');
      const id = Number(item.dataset.testId);
      if (state.openTests.has(id)) state.openTests.delete(id);
      else state.openTests.add(id);
      item.classList.toggle('open');
      return;
    }
    const groupHeader = e.target.closest('.suite-group-header');
    if (groupHeader) {
      const p = groupHeader.dataset.suiteGroup;
      if (state.collapsedSuiteGroups.has(p)) state.collapsedSuiteGroups.delete(p);
      else state.collapsedSuiteGroups.add(p);
      renderTestList();
    }
  });

  testListEl.addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-video-id]');
    if (sel) {
      const video = document.getElementById(sel.dataset.videoId);
      if (video) video.playbackRate = Number(sel.value);
    }
  });

  modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); });
  $('#close-modal').addEventListener('click', () => modal.close());

  $('#search').addEventListener('input', (e) => { state.search = e.target.value; renderTestList(); });
  $('#status-filter').addEventListener('change', (e) => { state.statusFilter = e.target.value; renderTestList(); });
  $('#sort-select').addEventListener('change', (e) => { state.sortBy = e.target.value; renderTestList(); });

  $('#expand-all').addEventListener('click', () => {
    const visible = getVisibleTests();
    for (const t of visible) state.openTests.add(t.id);
    state.collapsedSuiteGroups.clear();
    renderTestList();
  });
  $('#collapse-all').addEventListener('click', () => {
    state.openTests.clear();
    for (const g of document.querySelectorAll('.suite-group-header')) state.collapsedSuiteGroups.add(g.dataset.suiteGroup);
    renderTestList();
  });

  render();
})();
</script>
</body>
</html>`;
}

function main() {
  console.log('E2E Report Generator');
  console.log(`  Results dir: ${RESULTS_DIR}`);
  console.log(`  JSON report: ${JSON_REPORT}`);
  console.log(`  Output:      ${OUTPUT}`);
  console.log();

  const report = loadReport(JSON_REPORT);
  const format = detectFormat(report);
  console.log(`  Format: ${format}`);

  let tests = [];

  if (report) {
    // For e2e format, artifact paths are relative to <report-dir>/results/
    const reportDir = path.dirname(JSON_REPORT);
    const baseDir = format === 'e2e' ? path.join(reportDir, 'results') : RESULTS_DIR;
    tests = extractTests(report, baseDir);
    console.log(`  Found ${tests.length} tests in JSON report`);
  } else {
    console.log('  No JSON report found, scanning test-results directory...');
    if (fs.existsSync(RESULTS_DIR)) {
      const dirs = fs.readdirSync(RESULTS_DIR, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name);
      tests = dirs.map((dir, i) => ({
        title: dir,
        suite: '',
        status: 'unknown',
        duration: 0,
        error: null,
        retryCount: 0,
        results: [],
      }));
      console.log(`  Found ${tests.length} test result directories`);
    }
  }

  if (tests.length === 0 && !fs.existsSync(RESULTS_DIR)) {
    console.log('\n  No test results found. Run your tests first.');
    console.log('  Usage: node generate-report.js [test-results-dir] [json-report] [output-html]');
    process.exit(1);
  }

  const html = generateHTML(tests, format === 'e2e' ? null : RESULTS_DIR);
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, html, 'utf-8');

  const sizeMB = (fs.statSync(OUTPUT).size / 1024 / 1024).toFixed(1);
  console.log(`\n  Report generated: ${OUTPUT} (${sizeMB} MB)`);
  console.log(`  Open with: open ${OUTPUT}`);
}

main();
