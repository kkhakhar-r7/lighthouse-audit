# Lighthouse Audit

Standalone Lighthouse performance audit tool for the Nexpose Scan Manager UI. Requires Node.js >= 18.

## Setup

```bash
nvm use        # switches to Node 20 via .nvmrc
npm install
```

## Usage

```bash
# Unauthenticated
npm run lighthouse
npm run lighthouse -- https://custom-url:3780/page.jsp

# Authenticated (inline)
npm run lighthouse -- https://odin.vuln.lax.rapid7.com:3780/asset.jsp --username admin --password secret

# Authenticated (env vars)
LH_USERNAME=admin LH_PASSWORD=secret npm run lighthouse
```

Results are appended to `lighthouse-results.json` (gitignored) with deltas printed against the previous run.
