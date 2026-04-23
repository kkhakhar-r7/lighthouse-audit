import path from 'path';

export const DEFAULT_BASE_URL = 'https://odin.vuln.lax.rapid7.com:3780/';
export const AUDIT_PATHS = ['/home.jsp', '/asset/index.jsp'];

export const getOriginFolderName = (baseUrl) => {
  try {
    const parsed = new globalThis.URL(baseUrl);
    return parsed.origin.replace(/[^a-zA-Z0-9.-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  } catch {
    return 'unknown-origin';
  }
};

export const parseArgs = (argv) => {
  const args = argv.slice(2);
  const flagArgs = {};
  const positionalArgs = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length) {
      flagArgs[args[i].replace('--', '')] = args[++i];
    } else if (!args[i].startsWith('--')) {
      positionalArgs.push(args[i]);
    }
  }

  const baseUrl = positionalArgs[0] || DEFAULT_BASE_URL;
  const originFolder = getOriginFolderName(baseUrl);
  const outputRoot = path.resolve(process.cwd(), 'lighthouse-runs', originFolder);

  return {
    baseUrl,
    username: flagArgs.username || process.env.LH_USERNAME,
    password: flagArgs.password || process.env.LH_PASSWORD,
    accessCode: flagArgs.accessCode || flagArgs.accesscode || process.env.LH_ACCESS_CODE,
    measurementProfile: (flagArgs.profile || process.env.LH_PROFILE || 'lighthouse').toLowerCase(),
    resultsFile: path.resolve(outputRoot, 'lighthouse-results.json'),
    metricsDir: path.resolve(outputRoot, 'lighthouse-metrics'),
    screenshotRootDir: path.resolve(outputRoot, 'lighthouse-screenshots'),
    videoDir: path.resolve(outputRoot, 'lighthouse-videos'),
  };
};

export const getAuditUrl = (baseUrl, auditPath) => {
  const parsedBase = new globalThis.URL(baseUrl);
  return new globalThis.URL(auditPath, `${parsedBase.origin}/`).toString();
};

export const getRunId = () => new Date().toISOString().replace(/[T:.]/g, '-');
