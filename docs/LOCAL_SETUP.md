# Setting FarGems up on your own machine

This guide takes you from a fresh clone to a running copy of the app, its data proxy, the tests, and (optionally) a
phone or an Android emulator. For how the app works inside, see [IMPLEMENTATION.md](IMPLEMENTATION.md).

FarGems has no build step and no packages to install. The site is plain files, and the data proxy is one JavaScript file.

## 1. What you need

| Need | Why | Notes |
|---|---|---|
| Node.js 18 or newer (22 recommended) | tests, local proxy, HTTPS server | CI uses 22 |
| Git | clone and branches | |
| A way to serve files | the browser needs `http://localhost`, not `file://` | `npm run serve` (uses Python), or any static server |
| `openssl` on your PATH | only for testing on a real phone over Wi-Fi | |
| `adb` and an Android emulator | only for the emulator compass test | optional |

Check Node: `node --version`.

## 2. Get the code and run the tests

```
git clone https://github.com/gnanaswaroop/fargems.git
cd fargems
npm test
```

All tests should pass. They use no network and no browser: the Worker runs with a fake network, the camera is mocked, and
the compass maths is checked against NOAA's published test values.

## 3. Run the site

```
npm run serve                 # python -m http.server 8080, then open http://localhost:8080
```

Any static server works (`npx serve`, `python3 -m http.server 8000`, and so on). Use `localhost`, not your machine's name:
location, compass, camera and the service worker only work on a **secure context**, and `http://localhost` counts as one.

The first page is the landing page (`index.html`). It asks for permission and sends you on to the sky view
(`viewer.html`). If you only want to look around, use "Try a sample location" in the menu at the top right of the landing page.

> **Stale pages while developing.** The service worker caches the app so it works offline. It fetches your own files
> network-first, so edits normally show on reload, but if something looks old: DevTools, Application, Service Workers,
> Unregister, and Clear storage.

## 4. Run the data proxy locally (aircraft, routes, satellites)

Browsers cannot read the aircraft feeds directly (they send no CORS headers), so the app talks to a small proxy.
In production that is a Cloudflare Worker. On your machine you can run the **same code** with Node:

```
npm run worker:dev            # listens on http://localhost:8787
```

It calls the real providers and keeps answers in memory. Try it:

```
http://localhost:8787/aircraft?lat=47.6&lon=-122.3     aircraft around a point
http://localhost:8787/route?callsign=AIC144            where a flight is going
http://localhost:8787/tle?group=stations               space station element sets
http://localhost:8787/status                           which providers are healthy right now
```

Useful variables:

```
PORT=9000 npm run worker:dev                           another port
ENABLED=false npm run worker:dev                       start with the kill switch on: every path answers 503
ALLOWED_ORIGINS=https://example.com npm run worker:dev also allow that site (local pages are always allowed)
```

### Point the app at it

`config.js` holds the proxy address. In git it is empty, and the deploy overwrites it from a repository variable. For local
use, edit it:

```js
window.FARGEMS_CONFIG = { aircraftProxy: 'http://localhost:8787/aircraft' };
```

Reload the page. The status line under the radar should say `Aircraft: FarGems proxy`. The app derives the `/route` and
`/tle` addresses from this one.

To avoid committing your local address by accident:

```
git update-index --skip-worktree config.js      # stop tracking your edit
git update-index --no-skip-worktree config.js   # undo
```

With no proxy configured, the app tries the providers straight from the browser. Most refuse browsers, so aircraft are
often missing. Satellites, planets and weather do not need the proxy.

### Running the real Worker instead

The deployed Worker is `worker/aircraft-proxy.mjs`, a single module with no imports. To run it exactly as Cloudflare
would, use Cloudflare's own tool (`npx wrangler dev worker/aircraft-proxy.mjs`). That needs no account for local
development. `npm run worker:dev` is the quicker way and runs the same file.

## 5. Try it on a real phone

Sensors need HTTPS, and a phone is not `localhost`, so serve over HTTPS on your Wi-Fi:

```
npm run serve:https            # https://<your-computer-ip>:8443
npm run serve:https -- 9443    # another port
```

Accept the certificate warning once on the phone. The certificate is made with `openssl` and kept in `tmp/certs`, which git
ignores. The phone needs to reach your computer on that port (same Wi-Fi, firewall allowing it).

For aircraft on the phone, use a **deployed** Worker address in `config.js` (see section 6). The local proxy
(`npm run worker:dev`) is plain `http://` on your computer, and a page served over HTTPS is not allowed to call a plain
`http://` address (mixed content), so it cannot serve the phone. Without a proxy you can still test the compass, camera view,
planets, Moon and satellites on the phone.

What to try on the phone:

1. Landing page: tap **Allow location and compass**. iPhone asks separately for motion and orientation.
2. Sky view: turn around with the phone flat. N, E, S and W should stay pointed at the real directions. The line
   "Facing NNE 15° (true)" at the top right of the radar shows the heading the app is using.
3. Raise the phone upright to open the camera view (allow the camera when asked).

## 6. Deploy your own

### The site (GitHub Pages)

1. Fork the repository and push to `main`.
2. In the repository settings, set **Pages, Source** to **GitHub Actions**.
3. In **Settings, Secrets and variables, Actions, Variables**, add:
   - `AIRCRAFT_PROXY_URL` — the address of your Worker's aircraft endpoint, for example `https://<your-worker>.<your-account>.workers.dev/aircraft`
   - `PAGES_DOMAIN` — optional, your custom domain (no `https://`). It is used for the `CNAME` file, canonical links and the sitemap.

   Both stay out of the repository on purpose.
4. The `Deploy to GitHub Pages` workflow runs the tests, assembles the site, writes `config.js` from the variables, and publishes.

### The data proxy (Cloudflare Worker)

1. Create a Worker in the Cloudflare dashboard (Workers & Pages, Create) and paste the contents of `worker/aircraft-proxy.mjs`,
   or deploy the file with `wrangler deploy worker/aircraft-proxy.mjs --name <your-worker> --compatibility-date 2025-01-01`.
2. Settings, Variables and Secrets, add a plain-text variable:
   - `ALLOWED_ORIGINS` — your site origins, comma separated, for example `https://example.com,https://www.example.com`
3. Optional: `ENABLED` — set to `false` to switch the Worker off at once (every path answers 503); remove it, or set `true`, to switch it back on.
4. Open `https://<your-worker>.<your-account>.workers.dev/status`. You should see every provider as `ok`.

The Worker needs no keys, no storage and no database. It uses Cloudflare's built-in cache.

If you put a CDN or Cloudflare zone in front of the site, remember it can keep old copies: purge the files that changed after a deploy.

## 7. More tests

| Command | What it does | Needs |
|---|---|---|
| `npm test` | everything that can run anywhere (runs in CI on every pull request) | Node |
| `npm run test:live` | real data at five places: aircraft, sunrise and sunset, Moon, weather, the ISS | internet; `AIRCRAFT_PROXY_URL` for the aircraft part |
| `npm run test:android` | compass on a real Android (Chrome) emulator with virtual sensors | `adb`, one running emulator with Chrome |

Live data test:

```
AIRCRAFT_PROXY_URL=http://localhost:8787/aircraft npm run test:live
```

It also runs once a day on GitHub (the `Live data` workflow) and can be started by hand there. It is separate from CI so a
feed having a bad day never blocks a pull request. A feed that is down is skipped. If **your proxy** cannot get aircraft
from any provider, that is a failure.

Android emulator test:

```
# 1. start an emulator that has Chrome (a "Google APIs" image), and wait for it to boot
# 2.
npm run test:android
E2E_LOG=1 npm run test:android          # print progress; set ANDROID_SERIAL to choose a device
```

It serves the app from your computer through `adb reverse`, opens it in Chrome on the emulator, sets the emulator's virtual
accelerometer and magnetometer to known headings, and checks the heading the app shows in Seattle, New York and Hyderabad.
It takes a few minutes because the emulator's sensors settle slowly. It skips itself when no emulator is running.

## 8. Working on the code

- Everything the browser needs lives in the repository root and `lib/`. `lib/*.js` files are small UMD modules (they work in
  the browser and in Node), which is what makes them testable.
- When you add a file the page loads, also add it to `SHELL` in `sw.js` (offline list) and to the `cp` line in
  `.github/workflows/pages.yml` (published files). A test checks both.
- Add tests for what you change. New behaviour in the Worker gets a test with a fake `fetch` and cache (see
  `test/provider-fallback.test.js`).
- Keep the site address and the proxy address out of the repository. Use the repository variables above.
- Pull requests only: CI must be green before merging.

## 9. Troubleshooting

| Symptom | Likely cause |
|---|---|
| No compass, no camera, no location | Not a secure context: use `http://localhost` or HTTPS |
| iPhone never asks for motion access | The request must come from a tap on the landing page; if you declined once, reset Safari website settings |
| "Aircraft: feed unreachable" | No proxy in `config.js`, the proxy is down, or every provider is throttling: open `/status` on the proxy |
| "Aircraft: feed switched off for now" | The Worker's `ENABLED` variable is `false` |
| Radar shows no flights | Only flights within the "farthest flight" distance (default 25 km) and at least 5° above the horizon are shown. Raise it in Settings, or turn off "Only show flights I can see" |
| Old files after a change | The service worker or a CDN cache: unregister the worker, hard reload, purge the CDN |
| `npm run test:android` skips everything | No emulator found: start one, or set `ANDROID_SERIAL` |
