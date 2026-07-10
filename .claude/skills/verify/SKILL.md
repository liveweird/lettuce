---
name: verify
description: Drive the lettuce SPA end-to-end with Playwright to observe a change working against the local dev stack. Use after nontrivial frontend/backend changes, before committing.
---

# Verifying changes end-to-end

## Handle

The surface is the SPA in a browser. Use the running local dev stack (preferred per project convention): `docker compose up postgres` + `./gradlew :server:run` + `cd web && npm run dev`, then drive `http://localhost:5173` (Vite serves the edited source with HMR; `/api` proxies to :8080). Check what's already up first: `lsof -nP -iTCP:8080 -iTCP:5173 -sTCP:LISTEN` — reuse a healthy stack, and remember stray `:server:run` JVMs squat :8080 (see memory).

No Chrome-extension automation required: Playwright is installed in `e2e/node_modules`. A scratch script can import it directly:

```js
import { chromium } from "/<repo>/e2e/node_modules/playwright/index.mjs";
```

Chromium binaries are already installed (the e2e suite uses them).

## Drive recipe (gotchas that cost time)

- **Joyride tour overlay blocks all clicks on a fresh profile.** Stub it before any page load (same trick as `e2e/tests/helpers.ts`):
  ```js
  await page.addInitScript(() => {
    const real = Storage.prototype.getItem;
    Storage.prototype.getItem = function (k) {
      if (typeof k === "string" && k.startsWith("lettuce.tour.seen.")) return "1";
      return real.call(this, k);
    };
  });
  ```
- **Mantine locators:** `getByLabel(/password/i)` is a strict-mode violation (matches the visibility-toggle button too). Use `getByRole("textbox", { name: ... })`.
- **Clipboard:** Mantine `CopyButton` only flips to "Copied" when the copy succeeds; headless Chromium needs `browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] })`.
- **Login:** seed admin `admin@lettuce.local` / `changeme`. Keep logins to a minimum — the per-IP `/login` rate limit produces roaming 429s.
- **Language probe:** `await page.evaluate(() => localStorage.setItem("lettuce.lang", "pl"))` + reload switches the UI to Polish.
- **Lazy-route fill race (production bundle only):** after clicking a link to another SPA route, `waitForURL` passes while the OLD page is still rendered (React Router flips the URL before the lazy chunk mounts — instant in Vite dev, slow enough to bite against the built bundle). A locator that matches fields on both pages (e.g. "Email" on login *and* reset-password) silently fills the old page's input, which then unmounts. Always `waitFor()` an element unique to the target page before filling.
- **Rate-limit self-interference:** `/login`, `/refresh`, and `/password-reset` share small per-IP token buckets (10, 30, and 5 per minute). Curl "warm-up probes" against those endpoints eat the budget of the Playwright run that follows — probe readiness via `GET /` instead, or `docker restart lettuce-app` to reset the in-memory buckets.

## Cleanup

Anything created in the dev DB should be removed: log in as admin over the API and `DELETE /api/v1/users/{id}` (soft-delete) — find ids with the list filters, e.g. `GET /api/v1/users?email=<marker>` (use a recognizable marker like `verify.` in test emails).
