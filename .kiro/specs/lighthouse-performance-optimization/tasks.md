# Implementation Plan: Lighthouse Performance Optimization

## Overview

This plan implements targeted Lighthouse performance optimizations across the nexpose-js, nexpose-console-ui, and nexpose (JSP/server) repositories. Tasks are ordered in four phases: Phase 1 (quick wins with no architectural changes), Phase 2 (nexpose-js architectural changes including Webpack 5 upgrade and code splitting), Phase 3 (nexpose-console-ui lazy loading), and Phase 4 (dependency cleanup, CSS purging, and cache headers). The Lighthouse audit script is created first to establish a baseline measurement.

## Tasks

- [x] 1. Create Local Lighthouse Audit Script (baseline measurement)
  - [x] 1.1 Create `nexpose-js/scripts/lighthouse-audit.mjs` with Lighthouse API, Chrome Launcher, and Puppeteer-based authentication support
    - Implement argument parsing for URL, `--username`, `--password` flags and `LH_USERNAME`/`LH_PASSWORD` env vars
    - Launch Chrome headless via `chrome-launcher`
    - Implement Puppeteer login flow: navigate to `https://localhost:3780/login.jsp`, fill credentials, submit, extract session cookies
    - Pass cookies to Lighthouse via `extraHeaders`
    - Run Lighthouse with `onlyCategories: ['performance']`
    - Capture Performance score, FCP, LCP, TBT, CLS, SI, total transfer size, unused JS bytes, unused CSS bytes
    - Append timestamped entry to `lighthouse-results.json`
    - Print current results and delta vs previous run
    - _Requirements: 14.1, 14.2, 14.3, 14.6, 14.7, 14.8, 14.9_

  - [x] 1.2 Add devDependencies and package.json script entry
    - Add `lighthouse`, `chrome-launcher`, `puppeteer-core` to `nexpose-js/package.json` devDependencies
    - Add `"lighthouse": "node scripts/lighthouse-audit.mjs"` script entry
    - _Requirements: 14.4_

  - [x] 1.3 Add `lighthouse-results.json` to `nexpose-js/.gitignore`
    - _Requirements: 14.5_

- [x] 2. Checkpoint — Verify Lighthouse audit script
  - Ensure the script file exists and is syntactically valid, ask the user if questions arise.

- [x] 3. Font Display Fix (both repos)
  - [x] 3.1 Add `font-display: swap` to nexpose-js SCSS `@font-face` rules
    - Update `css/fonts/_inter-fontface.scss` (2 rules)
    - Update `css/fonts/_rubik-fontface.scss` (2 rules)
    - Update `css/fonts/_bootstrap-font-override.scss` (1 rule)
    - _Requirements: 2.1_

  - [x] 3.2 Create PostCSS font-display-swap plugin for nexpose-js
    - Create `nexpose-js/js/react/postcss-font-display-swap.js` that injects `font-display: swap` into any `@font-face` rule lacking it
    - Add the plugin to the `postcss-loader` plugins array in `nexpose-js/js/react/webpack.config.js`
    - _Requirements: 2.1_

  - [ ]* 3.3 Write property test for font-display swap universality (nexpose-js)
    - **Property 1: Font-display swap universality**
    - Generate random valid `@font-face` CSS blocks, run through the PostCSS plugin, verify every output contains `font-display: swap`
    - Use `fast-check` library
    - **Validates: Requirements 2.1, 2.2, 2.3**

  - [x] 3.4 Create PostCSS font-display-swap plugin for nexpose-console-ui
    - Create `nexpose-console-ui/webpack/postcss-font-display-swap.js` (same plugin logic)
    - Add `postcss-loader` with the plugin to the SCSS rule chain in `nexpose-console-ui/webpack/webpackUtils.js` (between `css-loader` and `resolve-url-loader`)
    - Add `postcss-loader` with the plugin to the CSS rule chain in `nexpose-console-ui/webpack/webpackUtils.js`
    - This catches `@font-face` rules from `roboto-fontface` (imported in `main.scss`) and `@rapid7/rapid7-muli-font` (imported in `dev.scss`)
    - _Requirements: 2.2, 2.3_

  - [ ]* 3.5 Write property test for font-display swap universality (nexpose-console-ui)
    - **Property 1: Font-display swap universality**
    - Same property test as 3.3 but targeting the nexpose-console-ui PostCSS plugin
    - **Validates: Requirements 2.2, 2.3**

- [x] 4. Quick Wins — nexpose-js babel and bundle fixes
  - [x] 4.1 Remove IE 11 targeting from nexpose-js babel config
    - In `nexpose-js/js/react/webpack.config.js`, change `targets: { ie: 11 }` to `targets: '> 0.5%, not dead, not ie 11'`
    - Remove `useBuiltIns: 'entry'` and `corejs` config from the babel-loader options
    - _Requirements: 3.1, 3.2_

  - [x] 4.2 Update JSP references to use minified bundle
    - In the nexpose repo JSP templates, change `nexpose-react.js` references to `nexpose-react.min.js`
    - _Requirements: 4.1_

- [ ] 5. Quick Wins — nexpose-console-ui build fixes
  - [x] 5.1 Fix production source maps in nexpose-console-ui
    - In `nexpose-console-ui/webpack/webpackUtils.js`, change `devtool: 'eval-source-map'` to `devtool: isDev ? 'eval-source-map' : 'source-map'`
    - _Requirements: 11.1, 11.2, 11.3_

  - [ ]* 5.2 Write property test for no inline source maps in production JS
    - **Property 7: No inline source maps in production JavaScript**
    - Generate random JS file contents with/without inline source maps, verify detection logic correctly identifies inline source maps
    - **Validates: Requirements 11.1, 11.3**

  - [x] 5.3 Optimize nexpose-console-ui CSS delivery
    - Update `MiniCssExtractPlugin` in `nexpose-console-ui/webpack/webpackUtils.js` to use `filename: '[name].[contenthash].css'` and `chunkFilename: '[id].[contenthash].css'`
    - Also update the `MiniCssExtractPlugin` in `nexpose-console-ui/webpack/webpackDefaults.js` `PRODUCTION_DEFINE_PLUGINS` to use the same filename pattern
    - _Requirements: 12.1, 12.2, 12.3_

- [-] 6. Quick Wins — Image dimensions audit
  - [-] 6.1 Audit and fix `<img>` elements missing explicit dimensions
    - Search JSP templates, nexpose-js React components, and nexpose-console-ui React components for `<img>` tags without `width`/`height` attributes
    - Add explicit `width` and `height` props or CSS `aspect-ratio` rules to each image
    - _Requirements: 5.1, 5.2, 5.3_

  - [ ]* 6.2 Write property test for image dimension completeness
    - **Property 3: Image dimension completeness**
    - Generate random React component trees with `<img>` elements, render them, verify every `<img>` has `width`+`height` or `aspect-ratio`
    - **Validates: Requirements 5.1, 5.2, 5.3**

- [ ] 7. Checkpoint — Verify Phase 1 quick wins
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Webpack 5 Upgrade for nexpose-js
  - [x] 8.1 Upgrade Webpack and related packages
    - Upgrade `webpack` from 4.47.0 to 5.x in `nexpose-js/package.json`
    - Upgrade `webpack-cli` from 3.x to 4.x
    - Replace `webpack-merge` 4.x with 5.x (API change: `merge.smart` → `merge`)
    - Upgrade `mini-css-extract-plugin` from 1.x to 2.x
    - Replace `file-loader` with Webpack 5 asset modules (`type: 'asset/resource'`)
    - Replace `eslint-loader` with `eslint-webpack-plugin`
    - Remove `{ parser: { amd: false } }` rule from `nexpose-js/js/react/webpack.config.js`
    - Update `postcss-loader` config to use `postcssOptions` wrapper (v4+ API)
    - _Requirements: 10.1, 10.5_

  - [x] 8.2 Update `nexpose-js/js/react/webpack.config.prod.js` for Webpack 5
    - Replace `merge.smart(common, ...)` with `merge(common, ...)`
    - Verify production build produces functionally equivalent output
    - _Requirements: 10.2_

  - [ ]* 8.3 Write unit tests to verify Webpack 5 build output equivalence
    - Verify the build produces JS and CSS output files
    - Verify babel targets exclude IE 11
    - _Requirements: 10.2_

- [ ] 9. Route-Based Code Splitting for nexpose-js
  - [x] 9.1 Convert to multi-entry configuration with splitChunks
    - In `nexpose-js/js/react/webpack.config.prod.js`, replace single `nexpose-react` entry with multi-entry: `nexpose-core`, `nexpose-assets`, `nexpose-scans`, `nexpose-policies`, `nexpose-adsec`
    - Add `splitChunks` config with `vendor` cache group (node_modules → `nexpose-vendor`) and `common` cache group (shared modules → `nexpose-common`)
    - Remove UMD library target (`library`, `libraryTarget`, `umdNamedDefine`)
    - _Requirements: 6.1, 6.2, 6.3, 10.3_

  - [x] 9.2 Add content hashing and manifest generation
    - Change output filename to `[name].[contenthash].js` and `sourceMapFilename` to `[file].map`
    - Add `WebpackManifestPlugin` to emit `manifest.json` mapping logical chunk names to hashed filenames
    - Install `webpack-manifest-plugin` as devDependency
    - _Requirements: 8.1, 10.4_

  - [ ]* 9.3 Write property test for content hash in output filenames
    - **Property 6: Content hash in output filenames**
    - Generate random filenames, verify content-hash-detection regex correctly identifies `[name].[contenthash].[ext]` pattern
    - **Validates: Requirements 8.1**

  - [x] 9.4 Update Gruntfile copy tasks for multi-chunk output
    - In `nexpose-js/Gruntfile.js`, update copy tasks to handle multiple `nexpose-*.js` and `nexpose-*.css` files from `js/react/dist/` using glob patterns
    - Also copy `manifest.json` to dist
    - _Requirements: 6.1_

- [x] 10. JSP Script Loader Changes (nexpose repo)
  - [x] 10.1 Update JSP templates for deferred loading and route-specific chunks
    - Add `defer` attribute to all `<script>` tags loading nexpose-js and nexpose-console-ui bundles
    - Replace synchronous CSS `<link>` tags with the preload pattern (`<link rel="preload" as="style" onload="...">` + `<noscript>` fallback)
    - Inline critical above-the-fold CSS in `<style>` tags in `<head>`
    - Add font preload hints for Roboto, Muli, and Rapid7 icon font woff2 files
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.4_

  - [x] 10.2 Reference route-specific chunks via manifest.json
    - Implement JSP-side manifest.json reader to resolve hashed filenames
    - Replace monolithic bundle `<script>` tag with route-specific chunk tags (e.g., `asset.jsp` loads `nexpose-vendor`, `nexpose-common`, `nexpose-assets`)
    - _Requirements: 6.4_

- [ ] 11. Checkpoint — Verify Phase 2 (nexpose-js architectural changes)
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Route-Level Lazy Loading in nexpose-console-ui
  - [x] 12.1 Convert `routes.tsx` to use `React.lazy()` and `Suspense`
    - In `nexpose-console-ui/src/modules/nav/routes.tsx`, replace static imports of `AdminRoutes`, `HomeRoutes`, `AssetsRoutes`, `CalendarRoutes`, `SiteConfigRoutes` with `React.lazy()` + dynamic `import()` with `webpackChunkName` comments
    - Wrap `<Routes>` in `<Suspense fallback={<LoadingApplicationView />}>`
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [x] 12.2 Convert `admin.routes.tsx` to lazy-load sub-page components
    - In `nexpose-console-ui/src/pages/admin/admin.routes.tsx`, replace static imports of `EnginePools`, `Blackouts`, `MultiTenancy`, `BackupScheduleLayout`, `MaintenanceLayout`, `Users`, `VulnCoverage`, `AssetHistory`, `ManageSilos`, `ManageSiloProfile`, `ManageSiloUsers`, `SilosTable`, `SiloProfilesTable`, `SiloUsersTable`, `PasswordPolicy`, `UserRolesTable`, `UsersTable` with `React.lazy()` + dynamic `import()` with `webpackChunkName` comments
    - _Requirements: 13.5_

  - [ ]* 12.3 Write unit tests for lazy loading
    - Verify `routes.tsx` uses `React.lazy()` for route modules
    - Verify `admin.routes.tsx` uses `React.lazy()` for sub-page components
    - Verify `Suspense` wraps lazy routes
    - _Requirements: 13.1, 13.4_

- [ ] 13. Checkpoint — Verify Phase 3 (nexpose-console-ui lazy loading)
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. jQuery and Lodash ProvidePlugin Removal
  - [ ] 14.1 Remove jQuery and Lodash from ProvidePlugin in nexpose-js
    - In `nexpose-js/js/react/webpack.config.js`, remove `$: 'jquery'` and `_: 'lodash'` from `webpack.ProvidePlugin`
    - Keep `React: 'react'` if needed by legacy JSX transform
    - _Requirements: 7.1_

  - [ ] 14.2 Refactor React components to remove jQuery usage
    - Search `nexpose-js/js/react/src/js/` for jQuery patterns (`$('`, `$("`, `jQuery(`, `$.`)
    - Replace with native DOM APIs or React refs
    - _Requirements: 7.2_

  - [ ]* 14.3 Write property test for no jQuery usage in React source files
    - **Property 4: No jQuery usage in React source files**
    - Generate random JS source strings with various patterns, verify jQuery-detection regex correctly identifies jQuery vs. legitimate code
    - **Validates: Requirements 7.2**

  - [ ] 14.4 Refactor React components to use per-method Lodash imports
    - Search `nexpose-js/js/react/src/js/` for full Lodash imports (`import _ from 'lodash'`, `import { x } from 'lodash'`)
    - Replace with per-method imports (e.g., `import groupBy from 'lodash/groupBy'`)
    - _Requirements: 7.3_

  - [ ]* 14.5 Write property test for per-method Lodash imports
    - **Property 5: Per-method Lodash imports in React source files**
    - Generate random import statements, verify detection regex correctly classifies full-library vs. per-method imports
    - **Validates: Requirements 7.3**

- [ ] 15. PurgeCSS Integration
  - [ ] 15.1 Add PurgeCSS to nexpose-js build
    - Install `@fullhuman/postcss-purgecss` as devDependency in nexpose-js
    - Add PurgeCSS plugin to the PostCSS plugin chain in `nexpose-js/js/react/webpack.config.js` (production only)
    - Configure content paths: `./src/js/**/*.{js,jsx}`, `./src/scss/**/*.scss`
    - Configure safelist: `/^rc-tree/`, `/^modal/`, `/^notification/`, `/^chrome-/`, `/^dark/`, `/^light/`, deep patterns for tooltip, dropdown, popover
    - _Requirements: 9.1, 9.2_

  - [ ]* 15.2 Write property test for CSS minification universality
    - **Property 2: CSS minification universality**
    - Generate random valid CSS rulesets, run through CssMinimizerPlugin, verify output has no multi-line comments or unnecessary whitespace
    - **Validates: Requirements 4.2, 12.2**

  - [ ] 15.3 Add PurgeCSS to nexpose-console-ui build
    - Install `@fullhuman/postcss-purgecss` as devDependency in nexpose-console-ui
    - Add PurgeCSS plugin to the PostCSS plugin chain in `nexpose-console-ui/webpack/webpackUtils.js` (production only)
    - Configure content paths: `./src/**/*.{ts,tsx}`, `./src/**/*.scss`
    - Configure safelist: `/^chrome-/`, `/^ui-dark/`, `/^ui-light/`, `/^r7-/`, `/^rds-/`, `/^MuiDataGrid/`, deep patterns for tooltip, modal, notification
    - _Requirements: 9.3, 9.4_

- [ ] 16. Cache Header Configuration
  - [ ] 16.1 Configure server-side cache headers for hashed assets
    - In the nexpose server, add servlet filter or web.xml `<filter>` configuration
    - Hashed assets (`*.[contenthash].js`, `*.[contenthash].css`): `Cache-Control: public, max-age=31536000, immutable`
    - JSP pages and HTML: `Cache-Control: no-cache`
    - Font files: `Cache-Control: public, max-age=31536000, immutable`
    - _Requirements: 8.2, 8.3_

- [ ] 17. Final Checkpoint — Verify all optimizations
  - Ensure all tests pass, ask the user if questions arise.
  - Run existing test suites (nexpose-js Jest + Karma, nexpose-console-ui Jest) to verify no regressions.
  - Verify build output structure: separate route chunks, vendor chunk, common chunk, manifest.json for nexpose-js; lazy route chunks for nexpose-console-ui.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation after each phase
- Property tests validate universal correctness properties from the design document
- The Lighthouse audit script (Task 1) should be run before and after each phase to measure impact
- Webpack 5 upgrade (Task 8) must be completed before code splitting (Task 9)
- JSP Script Loader changes (Task 10) depend on code splitting and manifest generation being complete
- Font display and source map fixes (Tasks 3, 5) are independent quick wins
