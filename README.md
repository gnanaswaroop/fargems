# FarGems

What is flying above you, right now. FarGems is a client-only PWA that shows aircraft, satellites (ISS, Tiangong and about 100 bright ones), the Sun, Moon, planets, bright stars and active meteor showers, calculated from your location.

It is static files only, with no backend and no API keys.

## Files

- `index.html`, `style.css`, `app.js`: the app
- `sw.js`: service worker (caches the app shell for offline use)
- `manifest.webmanifest`, `icon.svg`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`: PWA install assets
- `CNAME`, `.nojekyll`: GitHub Pages config for `fargems.com`

## Data sources

| Layer | Source |
|---|---|
| Aircraft | adsb.lol, then airplanes.live, then OpenSky (fallbacks) |
| Satellites | CelesTrak orbit data, positions computed in the browser with satellite.js |
| Sun, Moon, planets, stars | astronomy-engine, computed locally |
| Meteor showers | Built-in table (approximate dates and radiants) |
| Cloud cover | Open-Meteo |

## Browser sensors

- **Location:** Geolocation API, with manual coordinates as a fallback.
- **Compass:** DeviceOrientation, with an iOS permission prompt. Without a compass, drag the sky dome to rotate it.

Location and compass need HTTPS.

## Running locally

Serve the folder over HTTP (for example `npx serve .` or `python -m http.server`), then open it in a browser. Use `localhost` for the geolocation and service worker features.

## Deploying to GitHub Pages

1. Push the files to the repo root on `main`.
2. Settings → Pages → Source `main` / root, custom domain `fargems.com`, then enforce HTTPS once the certificate is issued.
3. DNS: `A` records for `@` to 185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153; `CNAME` for `www` to `gnanaswaroop.github.io`.

## Known limits

- Satellite.js and astronomy-engine load from jsDelivr with pinned versions but no integrity hashes. Vendoring them with SRI hashes is the first roadmap item.
- Compass is typically 5–20° off, and iOS behaviour is not verified.
- Meteor shower dates and radiants are approximate.

## Roadmap

1. Vendor the libraries with SRI hashes, and add a CSP meta tag.
2. Camera AR overlay.
3. Optional Starlink group, in a web worker.
4. Pass alerts while the app is open.
5. Compass calibration by tapping the Sun or Moon.
6. Recent fireballs (NASA CNEOS).
7. Offline pass-prediction cache.
