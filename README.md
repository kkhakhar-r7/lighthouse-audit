# Lighthouse Audit

Automated performance auditing framework for Rapid7 Odin console. Captures authenticated user sessions, collects Web Vitals metrics across multiple pages, generates visualization reports with trend analysis.

## Features

- **Automated Authentication**: Puppeteer-based Odin console login with screenshot capture
- **Multi-Page Auditing**: Lighthouse audits for `/home.jsp` and `/asset/index.jsp`
- **Web Vitals Tracking**: Extracts FCP, LCP, TBT, CLS, SI metrics with historical comparison
- **Video Capture**: Generates MP4 videos of authentication flow with human-readable filenames
- **Trend Visualization**: Interactive HTML report with Chart.js performance charts and metrics tables
- **Modular Architecture**: Separate concerns (auth, metrics, video generation, file I/O, config)

## Requirements

- Node.js 20.19.0 (enforced via `.nvmrc`)
- Yarn 1.13.0+ or npm
- Chrome/Chromium (launched headless with `--no-sandbox` flag)
- Access to Odin console at `https://odin.vuln.lax.rapid7.com:3780`

## Setup

```bash
nvm use        # Switch to Node 20.19.0
npm install    # Install dependencies
```

## Usage

### Run Lighthouse Audits

```bash
# Authenticate and audit both pages
npm run lighthouse -- --username hijackers --password hijackers

# With 2FA access code
npm run lighthouse -- --username hijackers --password hijackers --accessCode 123456
```

### Generate Trend Report

```bash
npm run trends
```

Generates `lighthouse-trends.html` with:
- Summary cards showing latest performance scores and run counts
- Performance score trend chart
- Web Vitals selector with per-metric trend visualization
- Summary table with performance deltas
- Web Vitals table with metrics in human-readable format (ms → seconds)

## Output Files

```
lighthouse-metrics/
  ├── lighthouse-metrics-home-jsp.json      # /home.jsp audit history
  └── lighthouse-metrics-asset-index-jsp.json  # /asset/index.jsp audit history

lighthouse-screenshots/
  └── {run-id}/                            # Timestamped auth flow screenshots
      ├── 006-authenticated-home-page-final.png
      └── 008-authenticated-asset-page-final.png

lighthouse-videos/
  └── lighthouse-auth-flow-odin.vuln.lax.rapid7.com-3780-{run-id}.mp4

lighthouse-trends.html                      # Interactive trend report
lighthouse-results.json                     # Aggregate audit results
```

## JSON Metrics Schema

Each audit appends a record to the per-page JSON file:

```json
{
  "timestamp": "2026-04-23T13:48:50.741Z",
  "url": "https://odin.vuln.lax.rapid7.com:3780/home.jsp",
  "path": "/home.jsp",
  "authenticated": true,
  "scores": {
    "performance": 16
  },
  "metrics": {
    "FCP": 35263,
    "LCP": 37324,
    "TBT": 1029,
    "CLS": 0.3522,
    "SI": 35263
  },
  "bundles": {
    "totalTransferSize": 5148160,
    "unusedJS": 1587200,
    "unusedCSS": 290816
  }
}
```

## Architecture

- `scripts/lighthouse-audit.mjs` - Main orchestrator: authentication → audits → video generation
- `scripts/lib/config.mjs` - Configuration and argument parsing
- `scripts/lib/auth-flow.mjs` - Odin console login automation via Puppeteer
- `scripts/lib/screenshot-video.mjs` - PNG sequence capture and MP4 generation
- `scripts/lib/lighthouse-metrics.mjs` - Lighthouse execution and metric extraction
- `scripts/lib/fs-utils.mjs` - Safe file I/O with error handling
- `scripts/performance-trends.mjs` - HTML trend report generation

## Credentials

The tool uses hardcoded Odin credentials for CI/CD automation. For security, consider:
- Storing credentials in environment variables
- Using service accounts with limited permissions
- Rotating credentials regularly
