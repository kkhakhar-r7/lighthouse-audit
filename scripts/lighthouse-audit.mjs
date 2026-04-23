import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';
import { AUDIT_PATHS, getRunId, parseArgs } from './lib/config.mjs';
import { ensureDir } from './lib/fs-utils.mjs';
import { createScreenshotVideoManager } from './lib/screenshot-video.mjs';
import { authenticateAndCapture } from './lib/auth-flow.mjs';
import { runAuditsForPaths } from './lib/lighthouse-metrics.mjs';

const {
  baseUrl,
  username,
  password,
  accessCode,
  resultsFile,
  metricsDir,
  screenshotRootDir,
  videoDir,
} = parseArgs(process.argv);

const runId = getRunId();
const screenshotVideo = createScreenshotVideoManager({
  runId,
  baseUrl,
  screenshotRootDir,
  videoDir,
});

ensureDir(metricsDir);

console.log(`Running Lighthouse audits against origin: ${new globalThis.URL(baseUrl).origin}`);
console.log(`Audit paths: ${AUDIT_PATHS.join(', ')}`);
if (username) console.log(`Authenticating as: ${username}`);
if (accessCode) console.log('Using access code for login flow.');
console.log(`Run ID: ${runId}`);
console.log(`Saving debug screenshots to: ${screenshotVideo.screenshotDir}`);
console.log('');

const chrome = await chromeLauncher.launch({
  chromeFlags: ['--headless', '--no-sandbox', '--ignore-certificate-errors'],
});

let cookies = [];

try {
  if (username && password) {
    const authResult = await authenticateAndCapture({
      chromePort: chrome.port,
      baseUrl,
      username,
      password,
      accessCode,
      captureScreenshot: screenshotVideo.captureScreenshot,
      createRunVideo: screenshotVideo.createRunVideo,
    });

    cookies = authResult.cookies;
    console.log(`Authenticated successfully. Got ${cookies.length} cookies.`);
    console.log(`Saved home page screenshot: ${authResult.homeScreenshotPath}`);
    console.log(`Saved asset page screenshot: ${authResult.assetScreenshotPath}`);
  }

  await runAuditsForPaths({
    lighthouse,
    chromePort: chrome.port,
    baseUrl,
    auditPaths: AUDIT_PATHS,
    cookies,
    metricsDir,
    resultsFile,
  });
} finally {
  chrome.kill();
  const runVideoPath = screenshotVideo.createRunVideo();
  if (runVideoPath) {
    console.log(`Run video saved to ${runVideoPath}`);
  }
}
