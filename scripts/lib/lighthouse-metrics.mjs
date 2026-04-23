import path from 'path';
import puppeteer from 'puppeteer-core';
import { appendHistory } from './fs-utils.mjs';
import { getAuditUrl } from './config.mjs';

const metricDisplay = (value, suffix = '') => (typeof value === 'number' ? `${value}${suffix}` : 'n/a');
const kibDisplay = (value) => (typeof value === 'number' ? `${(value / 1024).toFixed(0)} KiB` : 'n/a');

const getMetricsFileForPath = (metricsDir, auditPath) => {
  const pathSlug = auditPath
    .replace(/^\//, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return path.resolve(metricsDir, `lighthouse-metrics-${pathSlug}.json`);
};

const getRoundedMetric = (audits, auditKey, digits = 0) => {
  const rawValue = audits[auditKey]?.numericValue;
  if (typeof rawValue !== 'number') {
    return null;
  }
  if (digits > 0) {
    return Number(rawValue.toFixed(digits));
  }
  return Math.round(rawValue);
};

const delta = (curr, old) => {
  if (typeof curr !== 'number' || typeof old !== 'number') {
    return 'n/a';
  }
  const d = curr - old;
  return d > 0 ? `+${d}` : `${d}`;
};

const deltaWithUnit = (curr, old, unit = '') => {
  const value = delta(curr, old);
  return value === 'n/a' ? 'n/a' : `${value}${unit}`;
};

const clearBrowserState = async (chromePort, baseUrl) => {
  const versionRes = await fetch(`http://127.0.0.1:${chromePort}/json/version`);
  const { webSocketDebuggerUrl } = await versionRes.json();
  const browser = await puppeteer.connect({ browserWSEndpoint: webSocketDebuggerUrl });
  const page = await browser.newPage();
  const client = await page.target().createCDPSession();
  const origin = new globalThis.URL(baseUrl).origin;

  await client.send('Network.enable');
  await client.send('Network.clearBrowserCache');
  await client.send('Network.clearBrowserCookies');
  await client.send('Storage.clearDataForOrigin', {
    origin,
    storageTypes: 'all',
  });

  await page.close();
  await browser.disconnect();
};

export const runAuditsForPaths = async ({
  lighthouse,
  chromePort,
  baseUrl,
  auditPaths,
  cookies,
  measurementProfile = 'lighthouse',
  metricsDir,
  resultsFile,
  persistResults = true,
  verbose = true,
  onProgress = () => {},
}) => {
  if (persistResults && (!metricsDir || !resultsFile)) {
    throw new Error('metricsDir and resultsFile are required when persistResults=true');
  }

  const flags = {
    port: chromePort,
    output: 'json',
    onlyCategories: ['performance'],
  };

  const entries = [];

  const lighthouseConfig = measurementProfile === 'lighthouse'
    ? undefined
    : {
      extends: 'lighthouse:default',
      settings: {
        formFactor: 'desktop',
        throttlingMethod: 'provided',
        screenEmulation: {
          mobile: false,
          width: 1350,
          height: 940,
          deviceScaleFactor: 1,
          disabled: false,
        },
      },
    };

  if (cookies.length > 0) {
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    flags.extraHeaders = { Cookie: cookieHeader };
  }

  for (const auditPath of auditPaths) {
    onProgress({ stage: 'start-path', path: auditPath });
    try {
      await clearBrowserState(chromePort, baseUrl);
      onProgress({ stage: 'cleared-browser-state', path: auditPath });
      if (verbose) {
        console.log(`Cleared browser cache/storage before auditing ${auditPath}`);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      onProgress({ stage: 'browser-state-clear-failed', path: auditPath, reason });
      if (verbose) {
        console.warn(`Warning: could not clear browser state before ${auditPath}: ${reason}`);
      }
    }

    const auditUrl = getAuditUrl(baseUrl, auditPath);
    onProgress({ stage: 'running-lighthouse', path: auditPath, url: auditUrl });
    const result = await lighthouse(auditUrl, flags, lighthouseConfig);
    const { categories, audits } = JSON.parse(result.report);

    const entry = {
      timestamp: new Date().toISOString(),
      url: auditUrl,
      path: auditPath,
      measurementProfile,
      authenticated: cookies.length > 0,
      scores: {
        performance: typeof categories.performance.score === 'number'
          ? Math.round(categories.performance.score * 100)
          : null,
      },
      metrics: {
        FCP: getRoundedMetric(audits, 'first-contentful-paint'),
        LCP: getRoundedMetric(audits, 'largest-contentful-paint'),
        TBT: getRoundedMetric(audits, 'total-blocking-time'),
        CLS: getRoundedMetric(audits, 'cumulative-layout-shift', 4),
        SI: getRoundedMetric(audits, 'speed-index'),
      },
      bundles: {
        totalTransferSize: audits['total-byte-weight']?.numericValue,
        unusedJS: audits['unused-javascript']?.details?.overallSavingsBytes,
        unusedCSS: audits['unused-css-rules']?.details?.overallSavingsBytes,
      },
    };
    entries.push(entry);
    onProgress({ stage: 'completed-path', path: auditPath, entry });

    let pageHistory = [];
    let pageResultsFile = null;
    if (persistResults) {
      pageResultsFile = getMetricsFileForPath(metricsDir, auditPath);
      pageHistory = appendHistory(pageResultsFile, entry);
      appendHistory(resultsFile, entry);
    }

    if (verbose) {
      console.log(`--- Current Run (${auditPath}) ---`);
      console.log(`Profile: ${measurementProfile}`);
      console.log(`Performance Score: ${metricDisplay(entry.scores.performance)}`);
      console.log(`FCP: ${metricDisplay(entry.metrics.FCP, 'ms')} | LCP: ${metricDisplay(entry.metrics.LCP, 'ms')} | TBT: ${metricDisplay(entry.metrics.TBT, 'ms')} | CLS: ${metricDisplay(entry.metrics.CLS)} | SI: ${metricDisplay(entry.metrics.SI, 'ms')}`);
      console.log(`Total Transfer: ${kibDisplay(entry.bundles.totalTransferSize)} | Unused JS: ${kibDisplay(entry.bundles.unusedJS || 0)} | Unused CSS: ${kibDisplay(entry.bundles.unusedCSS || 0)}`);
    }

    if (verbose && pageHistory.length > 1) {
      const prev = pageHistory[pageHistory.length - 2];
      console.log('\n--- Delta vs Previous Run ---');
      console.log(`Performance: ${metricDisplay(prev.scores.performance)} → ${metricDisplay(entry.scores.performance)} (${delta(entry.scores.performance, prev.scores.performance)})`);
      console.log(`FCP: ${deltaWithUnit(entry.metrics.FCP, prev.metrics.FCP, 'ms')} | LCP: ${deltaWithUnit(entry.metrics.LCP, prev.metrics.LCP, 'ms')} | TBT: ${deltaWithUnit(entry.metrics.TBT, prev.metrics.TBT, 'ms')}`);
      console.log(`Unused JS: ${delta(Math.round((entry.bundles.unusedJS || 0) / 1024), Math.round((prev.bundles.unusedJS || 0) / 1024))} KiB`);
    }

    if (verbose && persistResults) {
      console.log(`\nResults appended to ${pageResultsFile} (${pageHistory.length} total runs)`);
    }
  }

  onProgress({ stage: 'finished-all-paths', count: entries.length });
  return entries;
};
