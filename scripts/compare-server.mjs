import http from 'http';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { WebSocketServer } from 'ws';
import puppeteer from 'puppeteer-core';
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';
import { authenticateAndCapture } from './lib/auth-flow.mjs';
import { runAuditsForPaths } from './lib/lighthouse-metrics.mjs';
import { createScreenshotVideoManager } from './lib/screenshot-video.mjs';
import { ensureDir } from './lib/fs-utils.mjs';
import { getOriginFolderName } from './lib/config.mjs';

const PORT = Number(process.env.PORT || 8787);
const RUNS_ROOT_DIR = path.resolve(process.cwd(), 'lighthouse-runs');
const TRENDS_FILE = path.resolve(process.cwd(), 'lighthouse-trends.html');
const APP_BASE_URL = `http://localhost:${PORT}`;
let requestCounter = 0;

ensureDir(RUNS_ROOT_DIR);

const wsClients = new Set();

const broadcast = (payload) => {
  const data = JSON.stringify(payload);
  wsClients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(data);
    }
  });
};

const log = (scope, message, requestId = null) => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${scope}] ${message}`);
  broadcast({ type: 'log', timestamp: ts, scope, message, requestId });
};

const elapsedMs = (start) => `${Date.now() - start}ms`;

const getOutputPathsForBaseUrl = (baseUrl) => {
  const originFolder = getOriginFolderName(baseUrl);
  const outputRoot = path.resolve(RUNS_ROOT_DIR, originFolder);
  return {
    originFolder,
    outputRoot,
    metricsDir: path.resolve(outputRoot, 'lighthouse-metrics'),
    resultsFile: path.resolve(outputRoot, 'lighthouse-results.json'),
    screenshotRootDir: path.resolve(outputRoot, 'lighthouse-screenshots'),
    videoDir: path.resolve(outputRoot, 'lighthouse-videos'),
  };
};

const runTrendsReport = async (requestId) => new Promise((resolve, reject) => {
  const scriptPath = path.resolve(process.cwd(), 'scripts/performance-trends.mjs');
  log(`REQ-${requestId}`, 'starting trends generation from browser', requestId);

  const child = spawn(process.execPath, [scriptPath], { cwd: process.cwd() });
  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (chunk) => {
    const line = chunk.toString();
    stdout += line;
    if (line.trim()) {
      log(`REQ-${requestId}`, `[trends] ${line.trim()}`, requestId);
    }
  });

  child.stderr.on('data', (chunk) => {
    const line = chunk.toString();
    stderr += line;
    if (line.trim()) {
      log(`REQ-${requestId}`, `[trends:err] ${line.trim()}`, requestId);
    }
  });

  child.on('close', (code) => {
    if (code === 0) {
      resolve({ ok: true, stdout: stdout.trim() });
      return;
    }
    reject(new Error(stderr.trim() || `Trends generation failed with exit code ${code}`));
  });

  child.on('error', reject);
});

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const normalizeAuditPaths = (raw, baseUrl) => {
  const items = String(raw || '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (items.length === 0) {
    return ['/home.jsp', '/asset/index.jsp'];
  }

  return items.map((item) => {
    if (item.startsWith('/')) {
      return item;
    }
    try {
      const parsed = new URL(item, baseUrl);
      return parsed.pathname || '/';
    } catch {
      return `/${item.replace(/^\/+/, '')}`;
    }
  });
};

const hostSlug = (hostLabel) => hostLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const captureRouteScreenshots = async ({ chromePort, baseUrl, paths, captureScreenshot, requestId, hostLabel }) => {
  const versionRes = await fetch(`http://127.0.0.1:${chromePort}/json/version`);
  const { webSocketDebuggerUrl } = await versionRes.json();
  const browser = await puppeteer.connect({ browserWSEndpoint: webSocketDebuggerUrl });
  const page = await browser.newPage();

  try {
    for (const auditPath of paths) {
      const url = new URL(auditPath, baseUrl).toString();
      log(`REQ-${requestId}`, `${hostLabel}: recording preview frame for ${auditPath}`, requestId);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
      await captureScreenshot(page, `${hostSlug(hostLabel)}-preview-${auditPath.replace(/[^a-zA-Z0-9-_]/g, '_')}`);
    }
  } finally {
    await page.close().catch(() => null);
    await browser.disconnect().catch(() => null);
  }
};

const readBody = (req) => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 1024 * 1024) {
      reject(new Error('Request body too large'));
      req.destroy();
    }
  });
  req.on('end', () => resolve(body));
  req.on('error', reject);
});

const asSeconds = (value) => (typeof value === 'number' ? `${(value / 1000).toFixed(2)}s (${Math.round(value)}ms)` : 'n/a');
const asScore = (value) => (typeof value === 'number' ? String(value) : 'n/a');
const asCLS = (value) => (typeof value === 'number' ? value.toFixed(3) : 'n/a');

const baseStyles = `
  body { margin: 0; font-family: -apple-system, Segoe UI, sans-serif; background: #0f172a; color: #e2e8f0; }
  .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
  h1 { margin: 0 0 6px; }
  p { color: #94a3b8; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; }
  .card { background: #111827; border: 1px solid #334155; border-radius: 12px; padding: 14px; }
  label { display: block; margin-top: 8px; margin-bottom: 4px; color: #cbd5e1; font-size: 0.9rem; }
  input, textarea, select { width: 100%; box-sizing: border-box; background: #0b1220; color: #e2e8f0; border: 1px solid #334155; border-radius: 8px; padding: 8px; }
  textarea { min-height: 60px; resize: vertical; }
  .actions { margin-top: 14px; }
  button { background: #0ea5e9; color: #082f49; border: none; border-radius: 8px; padding: 10px 14px; font-weight: 700; cursor: pointer; }
  button:disabled { opacity: 0.6; cursor: not-allowed; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { border-bottom: 1px solid #334155; padding: 8px; text-align: left; font-size: 0.9rem; }
  th { color: #93c5fd; }
  .muted { color: #94a3b8; font-size: 0.88rem; }
  .links { margin-bottom: 12px; }
  .links a { color: #7dd3fc; text-decoration: none; margin-right: 12px; }
  .error { margin: 12px 0; color: #fecaca; background: #7f1d1d; border: 1px solid #b91c1c; border-radius: 8px; padding: 10px; display: none; }
  .progress-box { height: 220px; overflow: auto; background: #020617; border: 1px solid #334155; border-radius: 8px; padding: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .trends-frame { width: 100%; height: 600px; border: 1px solid #334155; border-radius: 8px; background: #020617; }
  .row { display: flex; align-items: center; gap: 10px; }
`;

const renderSinglePage = () => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Single Host Lighthouse Runner</title>
  <style>
    ${baseStyles}
  </style>
</head>
<body>
  <div class="container">
    <h1>Lighthouse Single Host Runner</h1>
    <p>Run the same route metrics as npm run lighthouse from a UI, with live WebSocket progress logs.</p>
    <div class="links">
      <a href="/">Single Host</a>
      <a href="/compare">Compare Two Hosts</a>
    </div>

    <div id="error" class="error"></div>

    <form id="singleForm">
      <div class="grid">
        <section class="card">
          <h2>Target Host</h2>
          <label for="baseUrl">Base URL</label>
          <input id="baseUrl" name="baseUrl" placeholder="https://example-one.com" required />

          <label for="username">Username (optional)</label>
          <input id="username" name="username" />

          <label for="password">Password (optional)</label>
          <input id="password" name="password" type="password" />

          <label for="accessCode">Access Code (optional)</label>
          <input id="accessCode" name="accessCode" />

          <label for="paths">URLs/paths to measure (comma or newline separated)</label>
          <textarea id="paths" name="paths">/home.jsp
/asset/index.jsp</textarea>

          <label for="measurementProfile">Measurement Profile</label>
          <select id="measurementProfile" name="measurementProfile">
            <option value="lighthouse" selected>lighthouse (default lab profile)</option>
            <option value="browser">browser (desktop/provided throttling)</option>
          </select>
        </section>
      </div>

      <div class="actions">
        <button id="singleSubmit" type="submit">Run Audit</button>
        <button id="singleTrends" type="button">Refresh Trends (Regenerate)</button>
      </div>
    </form>

    <section class="card">
      <h2>Live Progress</h2>
      <div id="progressLog" class="progress-box"></div>
    </section>

    <section class="card">
      <h2>Run Results</h2>
      <div class="muted">Metrics shown: Performance, FCP, LCP, TBT, CLS, SI.</div>
      <table>
        <thead>
          <tr>
            <th>Host</th>
            <th>Base URL</th>
            <th>Path</th>
            <th>Performance</th>
            <th>FCP</th>
            <th>LCP</th>
            <th>TBT</th>
            <th>CLS</th>
            <th>SI</th>
            <th>Video</th>
          </tr>
        </thead>
        <tbody id="resultsBody"><tr><td colspan="10">No results yet.</td></tr></tbody>
      </table>
    </section>

    <section class="card">
      <h2>Trends (Inline)</h2>
      <div class="row" style="margin-bottom: 10px;">
        <button id="singleTrendsReload" type="button">Reload Inline Trends</button>
        <a href="/trends" target="_blank" rel="noopener" class="links">Open Full Trends</a>
      </div>
      <iframe id="singleTrendsFrame" class="trends-frame" title="Inline trends report"></iframe>
    </section>
  </div>

  <script>
    const progressLog = document.getElementById('progressLog');
    const errorBox = document.getElementById('error');
    const form = document.getElementById('singleForm');
    const submitBtn = document.getElementById('singleSubmit');
    const trendsBtn = document.getElementById('singleTrends');
    const trendsReloadBtn = document.getElementById('singleTrendsReload');
    const trendsFrame = document.getElementById('singleTrendsFrame');
    const resultsBody = document.getElementById('resultsBody');
    let activeRequestId = null;
    let ws = null;

    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';

    const appendLog = (line) => {
      const div = document.createElement('div');
      div.textContent = line;
      progressLog.appendChild(div);
      progressLog.scrollTop = progressLog.scrollHeight;
    };

    const connectWs = () => {
      ws = new WebSocket(wsProto + '//' + location.host + '/ws');
      ws.onopen = () => appendLog('[client] live progress connected');
      ws.onclose = () => {
        appendLog('[client] live progress disconnected, retrying...');
        setTimeout(connectWs, 1500);
      };
      ws.onerror = () => appendLog('[client] websocket error encountered');
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type !== 'log') return;
          if (msg.requestId && activeRequestId && msg.requestId !== activeRequestId) return;
          if (msg.requestId && !activeRequestId) return;
          appendLog('[' + new Date(msg.timestamp).toLocaleTimeString() + '] [' + msg.scope + '] ' + msg.message);
        } catch {
          appendLog('[client] failed to parse websocket message');
        }
      };
    };

    connectWs();

    const fmtMs = (v) => (typeof v === 'number' ? (v / 1000).toFixed(2) + 's (' + Math.round(v) + 'ms)' : 'n/a');
    const fmtScore = (v) => (typeof v === 'number' ? String(v) : 'n/a');
    const fmtCLS = (v) => (typeof v === 'number' ? v.toFixed(3) : 'n/a');

    const renderRows = (rows) => {
      if (!rows.length) {
        resultsBody.innerHTML = '<tr><td colspan="10">No results returned.</td></tr>';
        return;
      }
      resultsBody.innerHTML = rows.map((row) =>
        '<tr>' +
        '<td>' + row.hostLabel + '</td>' +
        '<td>' + row.baseUrl + '</td>' +
        '<td>' + row.path + '</td>' +
        '<td>' + fmtScore(row.performance) + '</td>' +
        '<td>' + fmtMs(row.FCP) + '</td>' +
        '<td>' + fmtMs(row.LCP) + '</td>' +
        '<td>' + fmtMs(row.TBT) + '</td>' +
        '<td>' + fmtCLS(row.CLS) + '</td>' +
        '<td>' + fmtMs(row.SI) + '</td>' +
        '<td>' + (row.videoPath || 'n/a') + '</td>' +
        '</tr>'
      ).join('');
    };

    const reloadInlineTrends = () => {
      trendsFrame.src = '/trends?ts=' + Date.now();
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorBox.style.display = 'none';
      errorBox.textContent = '';
      progressLog.innerHTML = '';
      resultsBody.innerHTML = '<tr><td colspan="10">Running...</td></tr>';
      submitBtn.disabled = true;

      activeRequestId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      appendLog('[client] submitted request ' + activeRequestId);

      const params = new URLSearchParams(new FormData(form));
      params.set('requestId', activeRequestId);

      try {
        const response = await fetch('/api/single-run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Request failed');
        }
        renderRows(data.rows || []);
      } catch (err) {
        errorBox.textContent = String(err.message || err);
        errorBox.style.display = 'block';
        resultsBody.innerHTML = '<tr><td colspan="10">No results.</td></tr>';
      } finally {
        submitBtn.disabled = false;
      }
    });

    trendsBtn.addEventListener('click', async () => {
      errorBox.style.display = 'none';
      errorBox.textContent = '';
      progressLog.innerHTML = '';
      trendsBtn.disabled = true;
      submitBtn.disabled = true;

      activeRequestId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      appendLog('[client] requested trends update ' + activeRequestId);

      try {
        const response = await fetch('/api/trends-run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ requestId: activeRequestId }).toString(),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Trends update failed');
        }
        appendLog('[client] trends report updated: ' + (data.outputFile || 'lighthouse-trends.html'));
        reloadInlineTrends();
      } catch (err) {
        errorBox.textContent = String(err.message || err);
        errorBox.style.display = 'block';
      } finally {
        trendsBtn.disabled = false;
        submitBtn.disabled = false;
      }
    });

    trendsReloadBtn.addEventListener('click', () => {
      reloadInlineTrends();
      appendLog('[client] inline trends reloaded');
    });

    reloadInlineTrends();
  </script>
</body>
</html>`;

const renderComparePage = () => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Host Performance Compare</title>
  <style>
    ${baseStyles}
  </style>
</head>
<body>
  <div class="container">
    <h1>/compare - Host Performance Comparison</h1>
    <p>Fill both host forms, submit once, and compare the same Lighthouse metrics side-by-side with live progress.</p>
    <div class="links">
      <a href="/">Single Host</a>
      <a href="/compare">Compare Two Hosts</a>
    </div>

    <div id="error" class="error"></div>

    <form id="compareForm">
      <div class="grid">
        <section class="card">
          <h2>Host A</h2>
          <label for="hostAUrl">Base URL</label>
          <input id="hostAUrl" name="hostAUrl" placeholder="https://example-one.com" required />
          <label for="hostAUsername">Username</label>
          <input id="hostAUsername" name="hostAUsername" />
          <label for="hostAPassword">Password</label>
          <input id="hostAPassword" name="hostAPassword" type="password" />
          <label for="hostAAccessCode">Access Code (optional)</label>
          <input id="hostAAccessCode" name="hostAAccessCode" />
          <label for="hostAPaths">URLs/paths to measure</label>
          <textarea id="hostAPaths" name="hostAPaths">/home.jsp
/asset/index.jsp</textarea>
        </section>

        <section class="card">
          <h2>Host B</h2>
          <label for="hostBUrl">Base URL</label>
          <input id="hostBUrl" name="hostBUrl" placeholder="https://example-two.com" required />
          <label for="hostBUsername">Username</label>
          <input id="hostBUsername" name="hostBUsername" />
          <label for="hostBPassword">Password</label>
          <input id="hostBPassword" name="hostBPassword" type="password" />
          <label for="hostBAccessCode">Access Code (optional)</label>
          <input id="hostBAccessCode" name="hostBAccessCode" />
          <label for="hostBPaths">URLs/paths to measure</label>
          <textarea id="hostBPaths" name="hostBPaths">/home.jsp
/asset/index.jsp</textarea>
        </section>
      </div>
      <div class="actions">
        <button id="compareSubmit" type="submit">Compare Hosts</button>
        <button id="compareTrends" type="button">Refresh Trends (Regenerate)</button>
      </div>
    </form>

    <section class="card">
      <h2>Live Progress</h2>
      <div id="progressLog" class="progress-box"></div>
    </section>

    <section class="card">
      <h2>Comparison Results</h2>
      <div class="muted">Metrics shown: Performance, FCP, LCP, TBT, CLS, SI.</div>
      <table>
        <thead>
          <tr>
            <th>Host</th>
            <th>Base URL</th>
            <th>Path</th>
            <th>Performance</th>
            <th>FCP</th>
            <th>LCP</th>
            <th>TBT</th>
            <th>CLS</th>
            <th>SI</th>
            <th>Video</th>
          </tr>
        </thead>
        <tbody id="resultsBody"><tr><td colspan="10">No comparison data yet.</td></tr></tbody>
      </table>
    </section>

    <section class="card">
      <h2>Trends (Inline)</h2>
      <div class="row" style="margin-bottom: 10px;">
        <button id="compareTrendsReload" type="button">Reload Inline Trends</button>
        <a href="/trends" target="_blank" rel="noopener" class="links">Open Full Trends</a>
      </div>
      <iframe id="compareTrendsFrame" class="trends-frame" title="Inline trends report"></iframe>
    </section>
  </div>

  <script>
    const progressLog = document.getElementById('progressLog');
    const errorBox = document.getElementById('error');
    const form = document.getElementById('compareForm');
    const submitBtn = document.getElementById('compareSubmit');
    const trendsBtn = document.getElementById('compareTrends');
    const trendsReloadBtn = document.getElementById('compareTrendsReload');
    const trendsFrame = document.getElementById('compareTrendsFrame');
    const resultsBody = document.getElementById('resultsBody');
    let activeRequestId = null;
    let ws = null;

    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';

    const appendLog = (line) => {
      const div = document.createElement('div');
      div.textContent = line;
      progressLog.appendChild(div);
      progressLog.scrollTop = progressLog.scrollHeight;
    };

    const connectWs = () => {
      ws = new WebSocket(wsProto + '//' + location.host + '/ws');
      ws.onopen = () => appendLog('[client] live progress connected');
      ws.onclose = () => {
        appendLog('[client] live progress disconnected, retrying...');
        setTimeout(connectWs, 1500);
      };
      ws.onerror = () => appendLog('[client] websocket error encountered');
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type !== 'log') return;
          if (msg.requestId && activeRequestId && msg.requestId !== activeRequestId) return;
          if (msg.requestId && !activeRequestId) return;
          appendLog('[' + new Date(msg.timestamp).toLocaleTimeString() + '] [' + msg.scope + '] ' + msg.message);
        } catch {
          appendLog('[client] failed to parse websocket message');
        }
      };
    };

    connectWs();

    const fmtMs = (v) => (typeof v === 'number' ? (v / 1000).toFixed(2) + 's (' + Math.round(v) + 'ms)' : 'n/a');
    const fmtScore = (v) => (typeof v === 'number' ? String(v) : 'n/a');
    const fmtCLS = (v) => (typeof v === 'number' ? v.toFixed(3) : 'n/a');

    const renderRows = (rows) => {
      if (!rows.length) {
        resultsBody.innerHTML = '<tr><td colspan="10">No results returned.</td></tr>';
        return;
      }
      resultsBody.innerHTML = rows.map((row) =>
        '<tr>' +
        '<td>' + row.hostLabel + '</td>' +
        '<td>' + row.baseUrl + '</td>' +
        '<td>' + row.path + '</td>' +
        '<td>' + fmtScore(row.performance) + '</td>' +
        '<td>' + fmtMs(row.FCP) + '</td>' +
        '<td>' + fmtMs(row.LCP) + '</td>' +
        '<td>' + fmtMs(row.TBT) + '</td>' +
        '<td>' + fmtCLS(row.CLS) + '</td>' +
        '<td>' + fmtMs(row.SI) + '</td>' +
        '<td>' + (row.videoPath || 'n/a') + '</td>' +
        '</tr>'
      ).join('');
    };

    const reloadInlineTrends = () => {
      trendsFrame.src = '/trends?ts=' + Date.now();
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorBox.style.display = 'none';
      errorBox.textContent = '';
      progressLog.innerHTML = '';
      resultsBody.innerHTML = '<tr><td colspan="10">Running...</td></tr>';
      submitBtn.disabled = true;

      activeRequestId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      appendLog('[client] submitted request ' + activeRequestId);

      const params = new URLSearchParams(new FormData(form));
      params.set('requestId', activeRequestId);

      try {
        const response = await fetch('/api/compare-run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Request failed');
        }
        renderRows(data.rows || []);
      } catch (err) {
        errorBox.textContent = String(err.message || err);
        errorBox.style.display = 'block';
        resultsBody.innerHTML = '<tr><td colspan="10">No results.</td></tr>';
      } finally {
        submitBtn.disabled = false;
      }
    });

    trendsBtn.addEventListener('click', async () => {
      errorBox.style.display = 'none';
      errorBox.textContent = '';
      progressLog.innerHTML = '';
      trendsBtn.disabled = true;
      submitBtn.disabled = true;

      activeRequestId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      appendLog('[client] requested trends update ' + activeRequestId);

      try {
        const response = await fetch('/api/trends-run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ requestId: activeRequestId }).toString(),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Trends update failed');
        }
        appendLog('[client] trends report updated: ' + (data.outputFile || 'lighthouse-trends.html'));
        reloadInlineTrends();
      } catch (err) {
        errorBox.textContent = String(err.message || err);
        errorBox.style.display = 'block';
      } finally {
        trendsBtn.disabled = false;
        submitBtn.disabled = false;
      }
    });

    trendsReloadBtn.addEventListener('click', () => {
      reloadInlineTrends();
      appendLog('[client] inline trends reloaded');
    });

    reloadInlineTrends();
  </script>
</body>
</html>`;

const runHostAudit = async ({
  chromePort,
  hostLabel,
  hostUrl,
  username,
  password,
  accessCode,
  paths,
  requestId,
  measurementProfile = 'lighthouse',
  persistResults = false,
}) => {
  const hostStart = Date.now();
  const baseUrl = new URL(hostUrl).toString();
  const outputPaths = getOutputPathsForBaseUrl(baseUrl);
  let cookies = [];
  const runId = `${requestId}-${hostSlug(hostLabel)}-${Date.now()}`;

  ensureDir(outputPaths.metricsDir);
  ensureDir(outputPaths.screenshotRootDir);
  ensureDir(outputPaths.videoDir);

  const screenshotVideo = createScreenshotVideoManager({
    runId,
    baseUrl,
    screenshotRootDir: outputPaths.screenshotRootDir,
    videoDir: outputPaths.videoDir,
  });
  let runVideoPath = null;

  log(`REQ-${requestId}`, `${hostLabel}: starting compare audit for ${baseUrl}`, requestId);
  log(`REQ-${requestId}`, `${hostLabel}: paths to audit => ${paths.join(', ')}`, requestId);

  if (username && password) {
    log(`REQ-${requestId}`, `${hostLabel}: authenticating as ${username}`, requestId);
    const authResult = await authenticateAndCapture({
      chromePort,
      baseUrl,
      username,
      password,
      accessCode,
      captureScreenshot: screenshotVideo.captureScreenshot,
      createRunVideo: screenshotVideo.createRunVideo,
    });
    cookies = authResult.cookies;
    log(`REQ-${requestId}`, `${hostLabel}: authentication complete (${cookies.length} cookies)`, requestId);
  } else {
    log(`REQ-${requestId}`, `${hostLabel}: no credentials provided, running unauthenticated`, requestId);
    await captureRouteScreenshots({
      chromePort,
      baseUrl,
      paths,
      captureScreenshot: screenshotVideo.captureScreenshot,
      requestId,
      hostLabel,
    });
  }

  log(`REQ-${requestId}`, `${hostLabel}: running Lighthouse audits`, requestId);
  const entries = await runAuditsForPaths({
    lighthouse,
    chromePort,
    baseUrl,
    auditPaths: paths,
    cookies,
    measurementProfile,
    persistResults,
    metricsDir: outputPaths.metricsDir,
    resultsFile: outputPaths.resultsFile,
    verbose: false,
    onProgress: (event) => {
      if (event.stage === 'running-lighthouse') {
        log(`REQ-${requestId}`, `${hostLabel}: auditing ${event.path}`, requestId);
      }
      if (event.stage === 'completed-path') {
        const perf = event.entry?.scores?.performance;
        log(`REQ-${requestId}`, `${hostLabel}: completed ${event.path} (performance ${typeof perf === 'number' ? perf : 'n/a'})`, requestId);
      }
      if (event.stage === 'browser-state-clear-failed') {
        log(`REQ-${requestId}`, `${hostLabel}: cache clear warning for ${event.path}: ${event.reason}`, requestId);
      }
    },
  });

  log(`REQ-${requestId}`, `${hostLabel}: completed ${entries.length} route audits in ${elapsedMs(hostStart)}`, requestId);

  runVideoPath = screenshotVideo.createRunVideo();
  if (runVideoPath) {
    log(`REQ-${requestId}`, `${hostLabel}: run video saved to ${runVideoPath}`, requestId);
  } else {
    log(`REQ-${requestId}`, `${hostLabel}: video generation skipped or failed`, requestId);
  }

  return entries.map((entry) => ({
    hostLabel,
    baseUrl,
    path: entry.path,
    performance: entry.scores.performance,
    FCP: entry.metrics.FCP,
    LCP: entry.metrics.LCP,
    TBT: entry.metrics.TBT,
    CLS: entry.metrics.CLS,
    SI: entry.metrics.SI,
    videoPath: runVideoPath,
  }));
};

const parseForm = async (req) => {
  const rawBody = await readBody(req);
  return Object.fromEntries(new URLSearchParams(rawBody).entries());
};

const sendJson = (res, status, payload) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
};

const server = http.createServer(async (req, res) => {
  try {
    const requestId = ++requestCounter;
    const reqStart = Date.now();
    log(`REQ-${requestId}`, `${req.method} ${req.url} received`);

    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderSinglePage());
      log(`REQ-${requestId}`, `served single-host page in ${elapsedMs(reqStart)}`);
      return;
    }

    if (req.method === 'GET' && req.url === '/compare') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderComparePage());
      log(`REQ-${requestId}`, `served compare form in ${elapsedMs(reqStart)}`);
      return;
    }

    if (req.method === 'GET' && req.url?.startsWith('/trends')) {
      log(`REQ-${requestId}`, 'refreshing trends report before serving /trends', String(requestId));
      try {
        await runTrendsReport(String(requestId));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`REQ-${requestId}`, `trends refresh failed before /trends: ${message}`, String(requestId));
        if (!fs.existsSync(TRENDS_FILE)) {
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<html><body style="font-family:sans-serif">Trends refresh failed and no existing report is available.</body></html>');
          return;
        }
      }

      const trendsHtml = fs.readFileSync(TRENDS_FILE, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(trendsHtml);
      log(`REQ-${requestId}`, `served trends report in ${elapsedMs(reqStart)}`);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/single-run') {
      const form = await parseForm(req);
      const clientRequestId = form.requestId || String(requestId);
      const baseUrl = form.baseUrl?.trim();

      if (!baseUrl) {
        sendJson(res, 400, { error: 'Base URL is required.' });
        return;
      }

      log(`REQ-${clientRequestId}`, `starting single-host run for ${baseUrl}`, clientRequestId);
      const chrome = await chromeLauncher.launch({
        chromeFlags: ['--headless', '--no-sandbox', '--ignore-certificate-errors'],
      });

      try {
        const rows = await runHostAudit({
          chromePort: chrome.port,
          hostLabel: 'Single Host',
          hostUrl: baseUrl,
          username: form.username?.trim(),
          password: form.password,
          accessCode: form.accessCode?.trim(),
          paths: normalizeAuditPaths(form.paths, baseUrl),
          requestId: clientRequestId,
          measurementProfile: (form.measurementProfile || 'lighthouse').toLowerCase(),
          persistResults: true,
        });
        sendJson(res, 200, { requestId: clientRequestId, rows });
        log(`REQ-${clientRequestId}`, `single-host run completed (${rows.length} rows) in ${elapsedMs(reqStart)}`, clientRequestId);
      } finally {
        await chrome.kill();
        log(`REQ-${clientRequestId}`, 'chrome session closed', clientRequestId);
      }
      return;
    }

    if (req.method === 'POST' && req.url === '/api/trends-run') {
      const form = await parseForm(req);
      const clientRequestId = form.requestId || String(requestId);

      try {
        await runTrendsReport(clientRequestId);
        const outputFile = path.resolve(process.cwd(), 'lighthouse-trends.html');
        sendJson(res, 200, { requestId: clientRequestId, outputFile });
        log(`REQ-${clientRequestId}`, `trends report updated at ${outputFile}`, clientRequestId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 500, { error: message });
        log(`REQ-${clientRequestId}`, `trends update failed: ${message}`, clientRequestId);
      }
      return;
    }

    if (req.method === 'POST' && req.url === '/api/compare-run') {
      const form = await parseForm(req);
      const clientRequestId = form.requestId || String(requestId);
      const hostAUrl = form.hostAUrl?.trim();
      const hostBUrl = form.hostBUrl?.trim();

      if (!hostAUrl || !hostBUrl) {
        sendJson(res, 400, { error: 'Both host URLs are required.' });
        return;
      }

      log(`REQ-${clientRequestId}`, `starting comparison: hostA=${hostAUrl}, hostB=${hostBUrl}`, clientRequestId);

      const chrome = await chromeLauncher.launch({
        chromeFlags: ['--headless', '--no-sandbox', '--ignore-certificate-errors'],
      });
      log(`REQ-${clientRequestId}`, `chrome launched on debug port ${chrome.port}`, clientRequestId);

      try {
        const hostAResults = await runHostAudit({
          chromePort: chrome.port,
          hostLabel: 'Host A',
          hostUrl: hostAUrl,
          username: form.hostAUsername?.trim(),
          password: form.hostAPassword,
          accessCode: form.hostAAccessCode?.trim(),
          paths: normalizeAuditPaths(form.hostAPaths, hostAUrl),
          requestId: clientRequestId,
          measurementProfile: 'lighthouse',
          persistResults: false,
        });
        const hostBResults = await runHostAudit({
          chromePort: chrome.port,
          hostLabel: 'Host B',
          hostUrl: hostBUrl,
          username: form.hostBUsername?.trim(),
          password: form.hostBPassword,
          accessCode: form.hostBAccessCode?.trim(),
          paths: normalizeAuditPaths(form.hostBPaths, hostBUrl),
          requestId: clientRequestId,
          measurementProfile: 'lighthouse',
          persistResults: false,
        });

        const rows = [...hostAResults, ...hostBResults];
        sendJson(res, 200, { requestId: clientRequestId, rows });
        log(`REQ-${clientRequestId}`, `comparison complete (${rows.length} rows) in ${elapsedMs(reqStart)}`, clientRequestId);
      } finally {
        await chrome.kill();
        log(`REQ-${clientRequestId}`, 'chrome session closed', clientRequestId);
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    log(`REQ-${requestId}`, `404 for ${req.method} ${req.url} in ${elapsedMs(reqStart)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('SERVER', `request failed: ${message}`);
    sendJson(res, 500, { error: `Run failed: ${message}` });
  }
});

const wsServer = new WebSocketServer({ noServer: true });

wsServer.on('connection', (socket) => {
  wsClients.add(socket);
  socket.send(JSON.stringify({
    type: 'log',
    timestamp: new Date().toISOString(),
    scope: 'SERVER',
    message: 'WebSocket connected. Waiting for runs...',
    requestId: null,
  }));
  socket.on('close', () => wsClients.delete(socket));
});

server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws') {
    wsServer.handleUpgrade(req, socket, head, (ws) => {
      wsServer.emit('connection', ws, req);
    });
    return;
  }
  socket.destroy();
});

server.listen(PORT, () => {
  log('SERVER', 'Application startup complete');
  log('SERVER', `Node.js ${process.version}`);
  log('SERVER', `Working directory: ${process.cwd()}`);
  log('SERVER', `Single host page: ${APP_BASE_URL}/`);
  log('SERVER', `Compare page: ${APP_BASE_URL}/compare`);
  log('SERVER', `Inline trends page: ${APP_BASE_URL}/trends`);
  log('SERVER', `WebSocket endpoint: ${APP_BASE_URL.replace('http', 'ws')}/ws`);
  log('SERVER', `Runs root dir: ${RUNS_ROOT_DIR}`);
  log('SERVER', 'Each host writes to: lighthouse-runs/<origin>/lighthouse-{metrics,screenshots,videos}');
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`[SERVER] Port ${PORT} is already in use.`);
    console.error(`[SERVER] Stop the existing process or start on another port, e.g. PORT=${PORT + 1} npm start`);
    return;
  }
  console.error('[SERVER] Unhandled server error:', err);
});
