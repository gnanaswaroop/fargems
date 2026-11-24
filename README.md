# FarGems

Live sky view of what is above you: aircraft, satellites (ISS, Tiangong and ~100 bright ones), Sun, Moon, planets, bright stars and active meteor showers. A static PWA with no backend. Every data request goes from the browser straight to a public API.

## Run locally

```
python3 -m http.server 8000     # then open http://localhost:8000
```

Geolocation, compass and the service worker need HTTPS, but `localhost` counts as secure.

To test on your phone over Wi-Fi, run the HTTPS server:

```
npm run serve:https          # https://<your-pc-ip>:8443 (accept the certificate warning once)
npm run serve:https -- 9443  # custom port
```

It needs `openssl` on your PATH to create a local certificate once (stored in `tmp/certs`, which git ignores).

## Deployment

`.github/workflows/pages.yml` runs the tests and then publishes the site to GitHub Pages on every push to `main`. In repo settings, set Pages → Build and deployment → Source to **GitHub Actions**. `ci.yml` runs the tests on every pull request.

## Deploy to fargems.com (GitHub Pages)

1. Push these files to the root of `gnanaswaroop/fargems` (branch `main`).
2. Repo → Settings → Pages → Source: `main` / root. Custom domain: `fargems.com`. Tick "Enforce HTTPS" once the certificate is issued.
3. At your DNS provider:
   - `A` records for `@` → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - `CNAME` for `www` → `gnanaswaroop.github.io`
4. Cloudflare Pages, Netlify and Vercel also work, since the app is only static files.

## Pages

- `index.html`: landing page. It asks for location and compass permission in one tap (iOS needs the compass request to come from a tap), then opens the sky view.
- `viewer.html`: the sky view. It turns the compass on automatically when the landing page was allowed.

Choices are stored on the device only (`fg.loc`, `fg.compass`).

## Data sources (all CORS-enabled, no keys)

| Layer | Source | Notes |
|---|---|---|
| Aircraft | adsb.lol → airplanes.live → OpenSky (fallbacks, in order) | Polled every 10 s, 150 nm radius. Positions are dead-reckoned between polls. |
| Satellites | CelesTrak GP (`stations`, `visual` groups) | TLEs cached 6 h in localStorage. SGP4 runs in the browser (satellite.js). |
| Sun, Moon, planets, stars | astronomy-engine | Computed locally, so it works offline. |
| Meteor showers | Static table in `app.js` | Windows, peaks and radiants are approximate. |
| Cloud cover | Open-Meteo | Optional. |

## Known limits

- **ADS-B coverage:** community feeds have gaps, and military or blocked aircraft may not appear.
- **Compass accuracy:** typically 5–20° off. The "North up" button plus drag-to-rotate is the fallback.
- **Sky orientation:** the map uses the standard star-chart convention (E on the left when N is up). The "E/W" button mirrors it if that feels backwards.
- **Library loading:** the two libraries load from jsDelivr on first run, and the service worker caches them afterwards. Vendoring them into the repo with SRI hashes is on the roadmap.
- **Meteors:** radiants are plotted, but individual meteors can't be tracked. Nobody publishes them in real time.

## Roadmap

1. Vendor the libraries with SRI hashes, and add a CSP meta tag.
2. Camera AR mode: `getUserMedia` plus orientation, with labels over the live image.
3. Optional Starlink group, as a web worker so the UI stays smooth.
4. Pass alerts while the app is open, such as "ISS rises in 5 min". Background push is unreliable on iOS without a server.
5. Calibrate the compass by tapping the Sun or Moon.
6. Recent fireballs (NASA CNEOS) as a "recent events" list.
7. Offline pass-prediction cache for the next few days.
