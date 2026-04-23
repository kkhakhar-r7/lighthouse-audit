import path from 'path';

export const DEFAULT_BASE_URL = 'https://odin.vuln.lax.rapid7.com:3780/';
export const AUDIT_PATHS = ['/home.jsp', '/asset/index.jsp'];

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

  return {
    baseUrl: positionalArgs[0] || DEFAULT_BASE_URL,
    username: flagArgs.username || process.env.LH_USERNAME,
    password: flagArgs.password || process.env.LH_PASSWORD,
    accessCode: flagArgs.accessCode || flagArgs.accesscode || process.env.LH_ACCESS_CODE,
    resultsFile: path.resolve(process.cwd(), 'lighthouse-results.json'),
    metricsDir: path.resolve(process.cwd(), 'lighthouse-metrics'),
    screenshotRootDir: path.resolve(process.cwd(), 'lighthouse-screenshots'),
    videoDir: path.resolve(process.cwd(), 'lighthouse-videos'),
  };
};

export const getAuditUrl = (baseUrl, auditPath) => {
  const parsedBase = new globalThis.URL(baseUrl);
  return new globalThis.URL(auditPath, `${parsedBase.origin}/`).toString();
};

export const getRunId = () => new Date().toISOString().replace(/[T:.]/g, '-');
