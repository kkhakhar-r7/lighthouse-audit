import path from 'path';
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

export const runAuditsForPaths = async ({
  lighthouse,
  chromePort,
  baseUrl,
  auditPaths,
  cookies,
  metricsDir,
  resultsFile,
}) => {
  const flags = {
    port: chromePort,
    output: 'json',
    onlyCategories: ['performance'],
  };

  if (cookies.length > 0) {
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    flags.extraHeaders = { Cookie: cookieHeader };
  }

  for (const auditPath of auditPaths) {
    const auditUrl = getAuditUrl(baseUrl, auditPath);
    const result = await lighthouse(auditUrl, flags);
    const { categories, audits } = JSON.parse(result.report);

    const entry = {
      timestamp: new Date().toISOString(),
      url: auditUrl,
      path: auditPath,
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

    const pageResultsFile = getMetricsFileForPath(metricsDir, auditPath);
    const pageHistory = appendHistory(pageResultsFile, entry);
    appendHistory(resultsFile, entry);

    console.log(`--- Current Run (${auditPath}) ---`);
    console.log(`Performance Score: ${metricDisplay(entry.scores.performance)}`);
    console.log(`FCP: ${metricDisplay(entry.metrics.FCP, 'ms')} | LCP: ${metricDisplay(entry.metrics.LCP, 'ms')} | TBT: ${metricDisplay(entry.metrics.TBT, 'ms')} | CLS: ${metricDisplay(entry.metrics.CLS)} | SI: ${metricDisplay(entry.metrics.SI, 'ms')}`);
    console.log(`Total Transfer: ${kibDisplay(entry.bundles.totalTransferSize)} | Unused JS: ${kibDisplay(entry.bundles.unusedJS || 0)} | Unused CSS: ${kibDisplay(entry.bundles.unusedCSS || 0)}`);

    if (pageHistory.length > 1) {
      const prev = pageHistory[pageHistory.length - 2];
      console.log('\n--- Delta vs Previous Run ---');
      console.log(`Performance: ${metricDisplay(prev.scores.performance)} → ${metricDisplay(entry.scores.performance)} (${delta(entry.scores.performance, prev.scores.performance)})`);
      console.log(`FCP: ${deltaWithUnit(entry.metrics.FCP, prev.metrics.FCP, 'ms')} | LCP: ${deltaWithUnit(entry.metrics.LCP, prev.metrics.LCP, 'ms')} | TBT: ${deltaWithUnit(entry.metrics.TBT, prev.metrics.TBT, 'ms')}`);
      console.log(`Unused JS: ${delta(Math.round((entry.bundles.unusedJS || 0) / 1024), Math.round((prev.bundles.unusedJS || 0) / 1024))} KiB`);
    }

    console.log(`\nResults appended to ${pageResultsFile} (${pageHistory.length} total runs)`);
  }
};
