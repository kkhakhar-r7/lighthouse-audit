import path from 'path';
import { spawnSync } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { ensureDir } from './fs-utils.mjs';

export const createScreenshotVideoManager = ({ runId, baseUrl, screenshotRootDir, videoDir }) => {
  const screenshotDir = path.resolve(screenshotRootDir, runId);
  let screenshotCounter = 0;

  const screenshotPath = (label) => {
    const safeLabel = label.replace(/[^a-zA-Z0-9-_]/g, '_');
    screenshotCounter += 1;
    return path.join(screenshotDir, `${String(screenshotCounter).padStart(3, '0')}-${safeLabel}.png`);
  };

  const captureScreenshot = async (page, label) => {
    ensureDir(screenshotDir);
    const filePath = screenshotPath(label);
    await page.screenshot({ path: filePath, fullPage: true }).catch(() => null);
    return filePath;
  };

  const createRunVideo = () => {
    ensureDir(videoDir);
    const runHost = new globalThis.URL(baseUrl).host.replace(/[^a-zA-Z0-9.-]/g, '-');
    const outputPath = path.join(videoDir, `lighthouse-auth-flow-${runHost}-${runId}.mp4`);

    if (!ffmpegPath) {
      console.log('ffmpeg-static is unavailable, skipping video generation.');
      return null;
    }

    const args = [
      '-y',
      '-framerate',
      '1',
      '-pattern_type',
      'glob',
      '-i',
      `${screenshotDir}/*.png`,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      outputPath,
    ];

    const run = spawnSync(ffmpegPath, args, { encoding: 'utf-8' });
    if (run.status !== 0) {
      console.log('Failed to generate video from screenshots.');
      if (run.stderr) {
        console.log(run.stderr.trim());
      }
      return null;
    }

    return outputPath;
  };

  return {
    screenshotDir,
    captureScreenshot,
    createRunVideo,
  };
};
