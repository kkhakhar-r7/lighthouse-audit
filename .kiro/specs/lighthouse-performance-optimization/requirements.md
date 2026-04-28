# Requirements Document

## Introduction

The Scan Manager UI (hosted SaaS version of the Nexpose console) currently scores 31/100 on Lighthouse Performance for the `asset.jsp` page. This feature addresses the highest-impact Lighthouse findings to improve page load performance, focusing on short-term wins achievable through build tooling changes, script loading optimizations, and font delivery improvements. Optimizations span both the nexpose-js repository (Webpack 4 React/Marionette build producing the monolithic UMD bundle loaded by JSP pages) and the nexpose-console-ui repository (Webpack 5 + esbuild-loader build producing multi-entry bundles for admin, assets, calendar, and scanConfig), as well as the nexpose (JSP) server layer.

## Glossary

- **JSP_Page**: A JavaServer Pages template in the nexpose repository that serves as the HTML entry point for a given route (e.g., `asset.jsp`)
- **Nexpose_JS_Bundle**: The monolithic `nexpose-react.js` or `nexpose-react.min.js` UMD bundle produced by the nexpose-js Webpack 4 build, containing all React components for all routes
- **Build_Pipeline**: The Webpack-based compilation and bundling process in nexpose-js that transforms source modules into distributable JavaScript and CSS assets
- **Script_Loader**: The mechanism in JSP_Page templates that includes `<script>` and `<link>` tags to load JavaScript and CSS assets into the browser
- **Font_Renderer**: The browser subsystem responsible for downloading, parsing, and rendering web fonts declared via `@font-face` rules
- **Babel_Transpiler**: The Babel compilation step in the nexpose-js Webpack configuration that transforms modern JavaScript to a target browser compatibility level
- **Route_Chunk**: A JavaScript bundle produced by Webpack code splitting that contains only the components and dependencies required for a specific application route or feature area
- **Vendor_Chunk**: A JavaScript bundle containing third-party dependencies extracted from application code via Webpack splitChunks optimization
- **CSS_Bundle**: The compiled and concatenated stylesheet output from the nexpose-js build, including Bootstrap 4, component styles, and font declarations
- **LCP**: Largest Contentful Paint — a Core Web Vital metric measuring the time until the largest visible content element is rendered
- **CLS**: Cumulative Layout Shift — a Core Web Vital metric measuring unexpected visual movement of page content during loading
- **Lighthouse_Score**: The numeric performance score (0–100) produced by Google Lighthouse auditing tool
- **Console_UI_Build**: The Webpack 5 + esbuild-loader build pipeline in nexpose-console-ui that produces multi-entry bundles (admin, assets, calendar, scanConfig)
- **Console_UI_Bundle**: The JavaScript and CSS output from the nexpose-console-ui Webpack 5 build

## Requirements

### Requirement 1: Eliminate Render-Blocking Script Loading

**Affected Repos:** `nexpose` (JSP templates), `nexpose-js`

**User Story:** As a Scan Manager UI user, I want the page to begin rendering without waiting for all JavaScript to download, so that I see meaningful content faster.

#### Acceptance Criteria

1. WHEN a JSP_Page is loaded in the browser, THE Script_Loader SHALL load the Nexpose_JS_Bundle with the `defer` attribute on its `<script>` tag
2. WHEN a JSP_Page is loaded in the browser, THE Script_Loader SHALL load all non-critical CSS asynchronously using the `<link rel="preload" as="style">` pattern with an `onload` handler that switches the `rel` to `stylesheet`
3. WHEN a JSP_Page is loaded in the browser, THE Script_Loader SHALL inline critical above-the-fold CSS directly in the `<head>` element
4. WHEN Lighthouse audits a JSP_Page after these changes, THE Script_Loader SHALL produce zero render-blocking resource warnings for JavaScript files

### Requirement 2: Fix Font Display Behavior

**Affected Repos:** `nexpose-js`, `nexpose-console-ui`, `nexpose` (JSP templates)

**User Story:** As a Scan Manager UI user, I want text to be visible immediately using a fallback font while web fonts load, so that I do not see invisible text during page load.

#### Acceptance Criteria

1. THE Font_Renderer SHALL declare `font-display: swap` on every `@font-face` rule in the nexpose-js CSS_Bundle output
2. WHEN the Console_UI_Build compiles nexpose-console-ui, THE Console_UI_Build SHALL override or patch the `@font-face` declarations imported from the `roboto-fontface` npm package (via `main.scss`) and the `@rapid7/rapid7-muli-font` npm package (via `dev.scss`) to include `font-display: swap`, since these upstream packages do not declare `font-display` in their `@font-face` rules
3. WHEN the Console_UI_Build produces Console_UI_Bundle CSS output, THE Console_UI_Bundle SHALL contain `font-display: swap` on every `@font-face` rule, including those originating from third-party npm font packages
4. WHEN a JSP_Page is loaded, THE Script_Loader SHALL include `<link rel="preload" as="font" type="font/woff2" crossorigin>` tags for the Roboto, Muli, and Rapid7 icon font files used above the fold
5. WHEN Lighthouse audits a JSP_Page after these changes, THE Font_Renderer SHALL produce zero "Ensure text remains visible during webfont load" warnings

### Requirement 3: Remove IE 11 Browser Targeting

**Affected Repos:** `nexpose-js`

**User Story:** As a developer, I want the nexpose-js build to stop targeting IE 11, so that unnecessary polyfills are removed and the bundle size is reduced.

#### Acceptance Criteria

1. THE Babel_Transpiler SHALL use the browserslist query `> 0.5%, not dead, not ie 11` as its compilation target instead of `{ ie: 11 }`
2. WHEN the Build_Pipeline compiles nexpose-js after the target change, THE Babel_Transpiler SHALL exclude core-js polyfills for `Promise`, `Symbol`, `Array.from`, `Object.assign`, and other features natively supported by the updated target browsers
3. WHEN the Build_Pipeline produces the Nexpose_JS_Bundle after the target change, THE Nexpose_JS_Bundle SHALL be at least 60 KiB smaller than the bundle produced with IE 11 targeting enabled
4. IF the Babel_Transpiler encounters source code using syntax unsupported by the updated target browsers, THEN THE Babel_Transpiler SHALL still transpile that syntax to a compatible form

### Requirement 4: Ensure Only Minified Bundles Are Served

**Affected Repos:** `nexpose-js`, `nexpose` (JSP templates / server config)

**User Story:** As a Scan Manager UI user, I want the server to deliver only minified JavaScript and CSS, so that download sizes are minimized.

#### Acceptance Criteria

1. WHEN a JSP_Page references the Nexpose_JS_Bundle, THE Script_Loader SHALL reference `nexpose-react.min.js` and not `nexpose-react.js`
2. WHEN the Build_Pipeline produces CSS_Bundle output for production, THE Build_Pipeline SHALL minify all CSS files
3. WHEN Lighthouse audits a JSP_Page after these changes, THE Script_Loader SHALL produce zero "Minify JavaScript" or "Minify CSS" diagnostic warnings for assets served from the nexpose-js build output

### Requirement 5: Set Explicit Image Dimensions

**Affected Repos:** `nexpose-js`, `nexpose-console-ui`, `nexpose` (JSP templates)

**User Story:** As a Scan Manager UI user, I want the page layout to remain stable while images load, so that I do not experience unexpected content shifts.

#### Acceptance Criteria

1. THE JSP_Page SHALL include explicit `width` and `height` attributes on every `<img>` element
2. WHEN an image is rendered by a React component in the Nexpose_JS_Bundle, THE React component SHALL specify both `width` and `height` props or apply a CSS `aspect-ratio` rule on the image element
3. WHEN an image is rendered by a React component in nexpose-console-ui, THE React component SHALL specify both `width` and `height` props or apply a CSS `aspect-ratio` rule on the image element
4. WHEN Lighthouse audits a JSP_Page after these changes, THE JSP_Page SHALL produce zero "Image elements do not have explicit width and height" diagnostic warnings

### Requirement 6: Implement Route-Based Code Splitting in nexpose-js

**Affected Repos:** `nexpose-js`, `nexpose` (JSP templates)

**User Story:** As a Scan Manager UI user, I want each page to load only the JavaScript needed for that specific route, so that I do not download and parse unused code.

#### Acceptance Criteria

1. WHEN the Build_Pipeline compiles nexpose-js, THE Build_Pipeline SHALL produce separate Route_Chunk files for distinct feature areas (assets, scans, policies, adaptive security) instead of a single monolithic Nexpose_JS_Bundle
2. WHEN the Build_Pipeline compiles nexpose-js, THE Build_Pipeline SHALL extract shared third-party dependencies into a Vendor_Chunk that is loaded once and cached across routes
3. WHEN the Build_Pipeline compiles nexpose-js, THE Build_Pipeline SHALL extract modules used by two or more Route_Chunk files into a common shared chunk
4. WHEN a JSP_Page is loaded, THE Script_Loader SHALL include only the Vendor_Chunk, the common shared chunk, and the Route_Chunk corresponding to that page's feature area
5. WHEN Lighthouse audits the `asset.jsp` page after code splitting, THE Nexpose_JS_Bundle SHALL report less than 500 KiB of unused JavaScript (reduced from 1,982 KiB)

### Requirement 13: Implement Route-Level Lazy Loading in nexpose-console-ui

**Affected Repos:** `nexpose-console-ui`

**User Story:** As a Scan Manager UI user, I want each nexpose-console-ui page to load its route components on demand, so that the initial bundle is smaller and the page becomes interactive faster.

#### Acceptance Criteria

1. WHEN the NexRoutes component renders in nexpose-console-ui, THE route modules for Admin, Assets, Calendar, SiteConfig, and Home SHALL be imported using `React.lazy()` with dynamic `import()` expressions instead of static top-level imports
2. WHEN a user navigates to a route in nexpose-console-ui, THE Console_UI_Build SHALL load only the JavaScript chunk for that route on demand, deferring the download of chunks for unvisited routes
3. WHEN the Console_UI_Build compiles nexpose-console-ui in production mode, THE Console_UI_Build SHALL produce separate JavaScript chunks for each lazy-loaded route module in addition to the shared vendor and common chunks
4. WHEN a lazy-loaded route chunk is loading, THE application SHALL display a loading fallback (e.g., `Suspense` with a spinner) to maintain a responsive user experience
5. WHEN the admin entry point is loaded, THE admin entry point SHALL NOT eagerly bundle all sub-page components (multi-tenancy, users, engine pools, blackouts, backup schedule, maintenance, vuln coverage, asset history) into a single chunk; instead each sub-page SHALL be lazy-loaded on navigation

### Requirement 7: Remove Global jQuery and Lodash Injection from React Builds

**Affected Repos:** `nexpose-js`

**User Story:** As a developer, I want the nexpose-js React build to stop injecting jQuery and Lodash as global variables, so that Webpack can perform dead code elimination on unused portions of these libraries.

#### Acceptance Criteria

1. WHEN the Build_Pipeline compiles nexpose-js React source code, THE Build_Pipeline SHALL not use `webpack.ProvidePlugin` to inject `$` (jQuery) or `_` (Lodash) as global variables
2. WHEN a React component in nexpose-js requires jQuery functionality, THE React component SHALL use native DOM APIs or React refs instead of jQuery selectors
3. WHEN a React component in nexpose-js requires a Lodash utility, THE React component SHALL import the specific method (e.g., `import groupBy from 'lodash/groupBy'`) instead of the full Lodash library
4. IF a Marionette view in nexpose-js requires jQuery, THEN THE Build_Pipeline SHALL provide jQuery only to the Marionette build output and not to the React Route_Chunk files

### Requirement 8: Configure Long-Lived Cache Headers for Hashed Assets

**Affected Repos:** `nexpose-js`, `nexpose` (server config)

**User Story:** As a Scan Manager UI user, I want static assets to be cached by my browser on subsequent visits, so that repeat page loads are faster.

#### Acceptance Criteria

1. WHEN the Build_Pipeline produces Route_Chunk, Vendor_Chunk, or CSS_Bundle files, THE Build_Pipeline SHALL include a content hash in each output filename (e.g., `[name].[contenthash].js`)
2. WHEN the nexpose server serves a hashed static asset, THE nexpose server SHALL set the `Cache-Control` response header to `public, max-age=31536000, immutable`
3. WHEN the nexpose server serves a JSP_Page or other HTML document, THE nexpose server SHALL set the `Cache-Control` response header to `no-cache`
4. WHEN Lighthouse audits a JSP_Page after these changes, THE nexpose server SHALL produce zero "Serve static assets with an efficient cache policy" warnings for hashed assets

### Requirement 9: Reduce Unused CSS

**Affected Repos:** `nexpose-js`, `nexpose-console-ui`, `nexpose-policy-js`

**User Story:** As a Scan Manager UI user, I want the page to load only the CSS rules it actually uses, so that stylesheet download and parse time is reduced.

#### Acceptance Criteria

1. WHEN the Build_Pipeline produces CSS_Bundle output for production, THE Build_Pipeline SHALL remove CSS rules that are not referenced by any component in the corresponding Route_Chunk
2. WHEN the Build_Pipeline applies CSS purging, THE Build_Pipeline SHALL preserve CSS rules for dynamically applied class names by maintaining a safelist of known dynamic classes
3. WHEN the Console_UI_Build produces Console_UI_Bundle CSS output for production, THE Console_UI_Build SHALL remove CSS rules from the full `rapid7-styles.scss` import and other global stylesheets that are not referenced by any component in the corresponding entry point
4. WHEN the Console_UI_Build applies CSS purging, THE Console_UI_Build SHALL preserve CSS rules for dynamically applied class names used by nexpose-console-ui components by maintaining a safelist of known dynamic classes
5. WHEN Lighthouse audits the `asset.jsp` page after CSS purging, THE CSS_Bundle SHALL report less than 100 KiB of unused CSS (reduced from 283 KiB)

### Requirement 10: Upgrade nexpose-js to Webpack 5

**Affected Repos:** `nexpose-js`

**User Story:** As a developer, I want nexpose-js to use Webpack 5, so that the build supports improved tree-shaking, modern code splitting, and content hashing required by other performance requirements.

#### Acceptance Criteria

1. THE Build_Pipeline SHALL use Webpack 5 as the module bundler for the nexpose-js React build instead of Webpack 4
2. WHEN the Build_Pipeline compiles nexpose-js with Webpack 5, THE Build_Pipeline SHALL produce functionally equivalent output to the current Webpack 4 build for all existing routes
3. WHEN the Build_Pipeline compiles nexpose-js with Webpack 5, THE Build_Pipeline SHALL support the `splitChunks` optimization configuration required by Requirement 6
4. WHEN the Build_Pipeline compiles nexpose-js with Webpack 5, THE Build_Pipeline SHALL support content hash filenames required by Requirement 8
5. IF a Webpack 4 plugin or loader used by the current nexpose-js build is incompatible with Webpack 5, THEN THE Build_Pipeline SHALL use the Webpack 5 equivalent plugin or loader

### Requirement 11: Optimize nexpose-console-ui Production Source Maps

**Affected Repos:** `nexpose-console-ui`

**User Story:** As a developer, I want the nexpose-console-ui production build to use external source maps instead of inline eval-based source maps, so that production bundle sizes are smaller and main-thread eval time is reduced.

#### Acceptance Criteria

1. WHEN the Console_UI_Build compiles in production mode, THE Console_UI_Build SHALL use `devtool: 'source-map'` or `devtool: 'hidden-source-map'` instead of `devtool: 'eval-source-map'`
2. WHEN the Console_UI_Build compiles in development mode, THE Console_UI_Build SHALL continue to use `devtool: 'eval-source-map'` for fast rebuild performance
3. WHEN the Console_UI_Bundle is served in production, THE Console_UI_Bundle SHALL not contain inline source map content within the JavaScript files

### Requirement 12: Optimize nexpose-console-ui CSS Delivery

**Affected Repos:** `nexpose-console-ui`

**User Story:** As a Scan Manager UI user, I want the nexpose-console-ui pages to load only the CSS needed for the current entry point, so that unused styles do not delay rendering.

#### Acceptance Criteria

1. WHEN the Console_UI_Build compiles in production mode, THE Console_UI_Build SHALL extract CSS into separate files per entry point rather than a single monolithic stylesheet
2. WHEN the Console_UI_Build produces CSS output for production, THE Console_UI_Build SHALL minify all CSS files using CssMinimizerPlugin
3. WHEN a nexpose-console-ui entry point is loaded, THE entry point SHALL not load CSS rules belonging exclusively to other entry points

### Requirement 14: Local Lighthouse Performance Tracking

**Affected Repos:** `nexpose-js`

**User Story:** As a developer, I want a local script that runs Lighthouse audits against a target page and tracks results over time, so that I can measure the impact of each optimization without requiring CI integration.

#### Acceptance Criteria

1. THE nexpose-js repository SHALL contain a Node.js script (e.g., `scripts/lighthouse-audit.mjs`) that programmatically runs a Lighthouse audit against a configurable target URL using the Lighthouse API and Chrome Launcher
2. WHEN the script runs an audit, THE script SHALL capture and store the Performance score, First Contentful Paint (FCP), Largest Contentful Paint (LCP), Total Blocking Time (TBT), Cumulative Layout Shift (CLS), Speed Index, total transfer size, unused JavaScript bytes, and unused CSS bytes as a timestamped entry in a local JSON history file (e.g., `lighthouse-results.json`)
3. WHEN the script completes an audit and a previous result exists in the history file, THE script SHALL print a comparison summary showing the delta for the Performance score and each Core Web Vital metric between the current and previous run
4. THE nexpose-js `package.json` SHALL include a script entry (e.g., `"lighthouse": "node scripts/lighthouse-audit.mjs"`) so developers can run audits via `npm run lighthouse` or `npm run lighthouse <url>`
5. THE `lighthouse-results.json` history file SHALL be listed in `.gitignore` so that local tracking data is not committed to the repository
6. THE script SHALL accept an optional URL argument, defaulting to the staging environment URL if none is provided
7. THE script SHALL support authentication by accepting optional `--username` and `--password` arguments (or reading from `LH_USERNAME` and `LH_PASSWORD` environment variables), using Puppeteer to log in to the application and capture session cookies before passing them to the Lighthouse audit
8. WHEN credentials are provided, THE script SHALL navigate to the login page, submit the credentials, wait for successful authentication, extract the session cookies, and pass them to Lighthouse via the `extraHeaders` or `--extra-headers` configuration so the audit runs against the authenticated page
9. WHEN credentials are NOT provided, THE script SHALL run the Lighthouse audit directly against the target URL without authentication (for pages that do not require login)
