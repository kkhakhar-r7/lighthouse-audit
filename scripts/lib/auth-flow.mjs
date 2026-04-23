import puppeteer from 'puppeteer-core';
import { getAuditUrl } from './config.mjs';

const USERNAME_SELECTORS = [
  '#nexposeccusername',
  'input[name="nexposeccusername"]',
  '#username',
  'input[name="username"]',
  'input[name="j_username"]',
];

const PASSWORD_SELECTORS = [
  '#nexposeccpassword',
  'input[name="nexposeccpassword"]',
  '#password',
  'input[name="password"]',
  'input[name="j_password"]',
];

const ACCESS_CODE_SELECTORS = [
  '#nexposecctoken',
  'input[name="nexposecctoken"]',
  'input[name="accessCode"]',
];

const SUBMIT_SELECTORS = [
  '#login_button',
  '#loginButton',
  'button[type="submit"]',
  'input[type="submit"]',
  'button[name="login"]',
];

const LOGIN_HINT_SELECTORS = [
  '#username',
  '#password',
  '#nexposecctoken',
  'input[name="nexposeccusername"]',
  'input[name="nexposeccpassword"]',
  'input[name="nexposecctoken"]',
  'form[action*="login"]',
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const findFirstExistingSelector = async (page, selectors) => {
  for (const selector of selectors) {
    if (await page.$(selector)) return selector;
  }
  return null;
};

const fillInput = async (page, selector, value) => {
  await page.focus(selector);
  await page.$eval(selector, (el) => {
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.type(selector, value, { delay: 20 });
};

const bypassHttpsWarningIfPresent = async (page, captureScreenshot) => {
  const hasDetailsButton = await page.$('#details-button');
  if (!hasDetailsButton) {
    return false;
  }

  await captureScreenshot(page, 'https-warning-before-bypass');
  await page.click('#details-button').catch(() => null);
  await delay(300);

  const hasProceedLink = await page.$('#proceed-link');
  if (!hasProceedLink) {
    return false;
  }

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null),
    page.click('#proceed-link'),
  ]);

  await captureScreenshot(page, 'https-warning-after-bypass');
  return true;
};

const isLikelyLoginPage = async (page) => {
  for (const selector of LOGIN_HINT_SELECTORS) {
    if (await page.$(selector)) {
      return true;
    }
  }

  const currentUrl = page.url().toLowerCase();
  if (currentUrl.includes('/login')) {
    return true;
  }

  const title = (await page.title().catch(() => '')).toLowerCase();
  return title.includes('login') || title.includes('sign in');
};

const navigateWithBypassAndScreenshot = async (page, url, labelPrefix, captureScreenshot) => {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await captureScreenshot(page, `${labelPrefix}-initial`);

  const bypassed = await bypassHttpsWarningIfPresent(page, captureScreenshot);
  if (bypassed) {
    await captureScreenshot(page, `${labelPrefix}-after-warning-bypass`);
  }

  await delay(500);
  return captureScreenshot(page, `${labelPrefix}-final`);
};

export const authenticateAndCapture = async ({
  chromePort,
  baseUrl,
  username,
  password,
  accessCode,
  captureScreenshot,
  createRunVideo,
}) => {
  if (!username || !password) {
    return { cookies: [] };
  }

  const response = await fetch(`http://127.0.0.1:${chromePort}/json/version`);
  const { webSocketDebuggerUrl } = await response.json();
  const browser = await puppeteer.connect({ browserWSEndpoint: webSocketDebuggerUrl });
  const page = await browser.newPage();

  const parsedTargetUrl = new globalThis.URL(baseUrl);
  const loginCandidates = [
    `${parsedTargetUrl.origin}/login.jsp`,
    `${parsedTargetUrl.origin}/`,
  ];

  let cookies = [];

  for (const loginCandidate of loginCandidates) {
    try {
      await page.goto(loginCandidate, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await captureScreenshot(page, 'login-candidate-loaded');

      const bypassed = await bypassHttpsWarningIfPresent(page, captureScreenshot);
      if (bypassed) {
        await captureScreenshot(page, 'login-candidate-after-warning-bypass');
      }

      const usernameSelector = await findFirstExistingSelector(page, USERNAME_SELECTORS);
      const passwordSelector = await findFirstExistingSelector(page, PASSWORD_SELECTORS);
      if (!usernameSelector || !passwordSelector) {
        continue;
      }

      await fillInput(page, usernameSelector, username);
      await fillInput(page, passwordSelector, password);

      if (accessCode) {
        const accessCodeSelector = await findFirstExistingSelector(page, ACCESS_CODE_SELECTORS);
        if (accessCodeSelector) {
          await fillInput(page, accessCodeSelector, accessCode);
        }
      }

      const submitSelector = await findFirstExistingSelector(page, SUBMIT_SELECTORS);
      if (!submitSelector) {
        continue;
      }

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => null),
        page.click(submitSelector),
      ]);
      await captureScreenshot(page, 'after-login-submit');

      const assetIndexUrl = getAuditUrl(baseUrl, '/asset/index.jsp');
      await navigateWithBypassAndScreenshot(page, assetIndexUrl, 'post-login-asset-check', captureScreenshot);
      const stillOnLogin = await isLikelyLoginPage(page);
      if (stillOnLogin) {
        await captureScreenshot(page, 'auth-failed-still-login-page');
        cookies = [];
        continue;
      }

      cookies = await page.cookies();
      if (cookies.length > 0) {
        break;
      }
    } catch {
      // Keep trying next candidate.
    }
  }

  if (cookies.length === 0) {
    const debugUrl = page.url();
    const debugTitle = await page.title();
    const debugScreenshotPath = await captureScreenshot(page, 'lighthouse-login-debug');
    const failedRunVideoPath = createRunVideo();
    throw new Error(
      `Unable to authenticate before Lighthouse run. Last page: ${debugUrl} (title: ${debugTitle}). ` +
      `Saved debug screenshot to ${debugScreenshotPath}.` +
      (failedRunVideoPath ? ` Run video: ${failedRunVideoPath}.` : '')
    );
  }

  const homeUrl = getAuditUrl(baseUrl, '/home.jsp');
  const homeScreenshotPath = await navigateWithBypassAndScreenshot(page, homeUrl, 'authenticated-home-page', captureScreenshot);

  const assetIndexUrl = getAuditUrl(baseUrl, '/asset/index.jsp');
  const assetScreenshotPath = await navigateWithBypassAndScreenshot(page, assetIndexUrl, 'authenticated-asset-page', captureScreenshot);

  await page.close();

  return {
    cookies,
    homeScreenshotPath,
    assetScreenshotPath,
  };
};
