# Workspace UI polish

Status: implementation, local verification and independent code review complete; preparing personal fork draft PR. Merge and installed-app replacement have not been performed.

## Accepted scope

- User clarified that folder/file actions exist but are difficult to discover; requested UI/UX design polish, then resumed with `continue`.
- NORMAL: frontend presentation and interaction changes over personal devtest `fcec7a5f5aeb46c9ddf4ed7aff25b45e10db17f4`.
- Branch `enhance/kh-workspace-polish`, isolated checkout `~/kilhyeonjun-harness/projects/meetily-kh-workspace-polish`.
- Improve folder browser hierarchy, contextual meeting/note/subfolder creation, responsive list, sidebar alignment, menu/dialog navigation, focus and cancellation.
- Preserve existing services, recording identity, folder membership rules, deletion semantics and SQLite schema. No new trash, purge, audio processing or physical file deletion.
- Installed Meetily apps/data/settings and the existing open user session remain untouched. This source iteration does not replace/restart the installed app.

## Verification

- Existing frontend suites: 35/35 passed, 172 tests passed, 0 failed. Isolated per-suite execution follows `.github/scripts/run-frontend-tests.mjs`.
- TypeScript and final Next production build passed. No local native compilation/capture or installed WebView test in this iteration.
- Added repeatable Playwright regression fixture mounting real workspace components with in-memory Tauri/navigation boundaries. It never accesses the installed app or real meeting contents.
- RED observed: last-row action is not an accessible button/menu, creation form lacks destination information; original 800px layout test passed.
- Menu content now uses an existing portal primitive so list clipping cannot hide the last-row menu. Dialog provides focus containment, Escape/cancel and focus return.
- Browser regressions: 7/7 passed, including actual menu click/focus, cancellation/reopen, current-folder creation, 800px viewport, 480px sidebar within that viewport, rename/remove-folder document preservation and keyboard-only menu/dialog navigation. Each test asserts no uncaught page errors.
- Menu/dialog cleanup: dropdown is non-modal, dialog remains modal; outgoing menu animation is disabled and its own trigger is excluded from outside-dismiss handling. Cancel/reopen verifies body pointer state returns to `auto` and original folder selection resets.
- Layout uses container queries so list columns follow content width after sidebar resizing, rather than window width alone.
- Independent read-only implementation review found no actionable defects. Reviewer checked runtime diff, test fixture/CI boundaries and narrow-pane screenshot; did not run installed WebView/native recording.
- Screenshots generated and visually inspected: `frontend/test-results/workspace/**/{workspace-1280.png,workspace-800.png,workspace-wide-sidebar.png,move-dialog.png}`. Data is synthetic. CI uploads these and failure traces as `workspace-ui-evidence-<sha>`.
- Native arm64 build verification will run on the draft PR through existing KH CI; local browser checks do not certify native recording.

## Reproduce the UI checks

From `frontend`, use Node 20+, pnpm 9.15.9 and Bun 1.4.2:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm test:workspace-ui --workers=2
```

The test server binds only `127.0.0.1:3129` and is started/stopped by Playwright. It bundles the real workspace components with in-memory IPC/navigation adapters, builds actual Tailwind CSS and uses a fresh temporary Chromium profile. Generated CSS, traces and screenshots are gitignored. No installed Meetily process or existing browser session is used.

## Knowledge candidates

- Source and browser verified: an absolutely positioned `details` menu is clipped by the new list's `overflow-hidden` ancestor. Existing portal menu primitives avoid that geometry coupling.
- Browser RED→GREEN and dependency source: overlapping modal menu/dialog locks can leave body pointer events disabled. An outgoing exit animation can also retain a dismiss listener and close a newly reopened menu. Test both dialog cleanup and menu reopening; focus-only checks miss this.
- Browser RED→GREEN: viewport breakpoints can hide row actions beyond an 800px app when a 480px sidebar leaves only 320px for content. Container queries keep the actions reachable.
- Project-local only. No KH/GD/GP shared policy or core-sync changes.

## Measurements

- Dependency installation: 26.8s reported by pnpm; local infrastructure work, not a product runtime regression.
- Focused resume tests: 6 passed, 0 failed, Bun reported 276ms. TypeScript command group completed in 5.18s.
- Browser regression iterations: 17.9s / 15.7s / 16.2s with bounded failing assertions. These are debugging runs, not comparable runtime performance baselines.
- Final browser 7/7 run: 20.5s total including CSS/fixture startup; the CSS startup step took 7.704s (prior run 0.770s) during concurrent machine activity. Only one such measurement was observed, below the stage threshold; no product runtime regression or optimization claim.
- Existing frontend suite wall-time sum from runner metadata: 2.835s. Overall final Next build elapsed time is unavailable in the yielded command metadata; build exit status was 0. No actionable performance regression established.
