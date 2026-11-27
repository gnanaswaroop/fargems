# How FarGems works

This document explains the whole system: what runs where, what permissions it needs and why, how the compass is read
and corrected, how the camera (AR) view is built, where the data comes from and what happens when a provider throttles
or fails, and how the pieces are tested and shipped. To run it yourself, see [LOCAL_SETUP.md](LOCAL_SETUP.md).

## Contents

1. [The idea in one page](#1-the-idea-in-one-page)
2. [Parts and files](#2-parts-and-files)
3. [Permissions](#3-permissions)
4. [Finding where things are in the sky](#4-finding-where-things-are-in-the-sky)
5. [Compass detection](#5-compass-detection)
6. [The radar view](#6-the-radar-view)
7. [The camera (AR) view](#7-the-camera-ar-view)
8. [Data providers and the proxy](#8-data-providers-and-the-proxy)
9. [Offline use and the service worker](#9-offline-use-and-the-service-worker)
10. [Privacy](#10-privacy)
11. [Build, deploy and search](#11-build-deploy-and-search)
12. [Testing](#12-testing)
13. [Known limits](#13-known-limits)
14. [Install and updates](#14-install-and-updates)

---

## 1. The idea in one page

FarGems shows what is above you right now: aircraft, satellites, the Sun, Moon, planets, bright stars and meteor showers.

- **Hold the phone flat** and you see a radar-style map of the whole sky. The centre is straight up, the edge is the
  horizon. With the compass on, the map turns as you turn, so N, E, S and W always point the real way.
- **Tap an object** for its details. For a flight that includes where it is flying to.
- **Raise the phone** to point it at the sky and the camera view opens, with labels drawn over what you are looking at.
  An arrow guides you to the object you picked.

It is a static website (a PWA). All the sky maths runs in the browser. The only server of ours is a tiny optional proxy
for the aircraft feeds, which browsers cannot call directly.

```
 phone / browser                                     the internet
┌──────────────────────────────┐
│ landing page ── permissions  │
│ sky view: radar + camera view│── sky maths locally ── astronomy-engine, satellite.js
│ settings                     │
└──────┬───────────────────────┘
       │ aircraft, routes, satellite elements
       ▼
┌──────────────────────┐   fallback chains    ┌─────────────────────────────────────────┐
│ data proxy           │ ───────────────────► │ aircraft: adsb.lol → adsb.fi → OpenSky  │
│ (Cloudflare Worker)  │                      │ routes:   adsbdb → hexdb                │
│ caches, cools down   │                      │ satellites: CelesTrak → mirror → ISS feed│
│ failing providers    │                      └─────────────────────────────────────────┘
└──────────────────────┘
       weather ──────────────────────────────► Open-Meteo (straight from the browser)
```

## 2. Parts and files

| Part | Files | Job |
|---|---|---|
| Landing page | `index.html`, `landing.js`, `lib/onboarding.js` | explains the idea, asks for location and compass, offers install, links to the sky view |
| About page | `about.html` | how it works, data sources, privacy, limits (text for people and search engines) |
| Sky view | `viewer.html`, `app.js` | radar, nearby list, details, status line, timers |
| Camera view | `ar-view.js`, `lib/ar.js` | camera picture with labels, pose and projection maths, auto-open rules |
| Settings | `settings.html`, `settings.js` | units, layers, distance, mirror option, location |
| Pure logic | `lib/logic.js` | helpers with no page access: parsing, distances, visibility, formatting, URLs |
| Compass correction | `lib/declination.js` | magnetic declination from the World Magnetic Model |
| Offline | `sw.js`, `manifest.webmanifest` | service worker, install details |
| Updates and navigation | `lib/update.js`, `update.js`, `nav.js` | notice a newer version and offer a reload; a Back button that returns to the page you came from |
| Data proxy | `worker/aircraft-proxy.mjs` | the Cloudflare Worker (one file, no imports) |
| Local proxy | `scripts/dev-worker.mjs` | the same Worker on your machine, in Node |
| Build helpers | `scripts/seo.js`, `.github/workflows/*` | fill in the site address for search engines, tests, deploy |
| Config | `config.js` | the proxy address; empty in git, written at deploy time |

Files in `lib/` are small UMD modules: they work as plain `<script>` tags in the browser and as `require()` in Node. That
is why most of the logic can be tested without a browser.

Storage on the device (`localStorage`):

| Key | Holds |
|---|---|
| `fg.loc` | the saved location `{ lat, lon }` |
| `fg.compass` | `granted`, `denied` or `na` (not needed on this device) |
| `fg.camera` | `granted` once the camera was allowed |
| `fg.flip` | `1` (east on the right, like a map) or `0` (mirrored sky chart) |
| `fg.unit` | `C` or `F` |
| `fg.layers` | which layers are shown |
| `fg.visOnly` | only show flights that can be seen by eye |
| `fg.flightRange` | farthest flight to show, in km (default 25, 1 to 100) |
| `fg.tle.<group>` | the last satellite element sets and when they were fetched |

## 3. Permissions

The app asks for three things. Each is asked at a moment where the reason is clear, and each can be refused without
breaking the app.

| Permission | Browser feature | Why | If refused |
|---|---|---|---|
| **Location** | `navigator.geolocation` | to work out what is overhead from where you are, and which flights are near | enter coordinates by hand, or use the sample location |
| **Compass** (motion and orientation) | `DeviceOrientationEvent` | to turn the map the way you face, and to line up the camera view | the radar still works: drag to rotate the sky |
| **Camera** | `getUserMedia` (back camera) | the picture behind the labels in the camera view | the radar still works; the camera view says why it could not open |

Rules that shape how they are asked:

- **Secure context.** Location, motion sensors, camera and the service worker only work on HTTPS or `http://localhost`.
- **Location** is requested with a 15 second timeout and may reuse a position up to 10 minutes old. It is saved on the device.
- **Compass on iPhone and iPad** must be requested with `DeviceOrientationEvent.requestPermission()` **inside a tap**. iOS
  rejects the request if anything is awaited first, so the landing page starts it synchronously in the click handler,
  before it waits for location. A test enforces this. On Android and desktop the call does not exist and no permission is
  needed, so the compass state is recorded as `na`.
- **Camera** is requested the first time the camera view opens. Only after it has been granted once will the view open by
  itself when you raise the phone. If it fails or is denied, automatic opening is switched off until the phone has been laid
  flat again, so it never keeps retrying while you hold the phone up.
- **Landing page flow.** Nothing is saved yet: it shows the permission card with one button. Once a location is saved the
  card disappears and a single "Open the sky view" button sits right under the small radar picture (which is a launch
  button too). If the browser already allows location for the site but this copy has nothing saved (a reinstalled or newly
  installed app has fresh storage), the page asks the Permissions API, fetches the position quietly and goes straight to
  that state, so nobody is asked twice. The menu at the top right has Settings (where location and compass can be changed),
  About, GitHub, Install app and Try a sample location.
- **No network permission** is needed. The app calls public data services from the browser or through the proxy.

## 4. Finding where things are in the sky

Everything is turned into two angles as seen from you: **azimuth** (compass direction, 0 = true north, clockwise) and
**elevation** (angle above the horizon).

| Object | How |
|---|---|
| Sun, Moon, planets, bright stars | `astronomy-engine` (pinned version from a CDN) computes positions, rise and set times and the Moon's phase |
| Satellites | element sets (TLEs) are parsed and propagated with `satellite.js` (SGP4), then converted to azimuth and elevation. Passes of the ISS and Tiangong are predicted every 20 minutes |
| Aircraft | a position, height, speed and track from a provider. Between polls (every 30 seconds) the position is moved forward by dead reckoning so planes glide instead of jumping. Azimuth and elevation come from the same look-angle maths as satellites, with the aircraft height above the ground |
| Meteor showers | a built-in table of dates and radiants |

All azimuths are **true north**. That matters for the compass (section 5).

### Which flights are shown

The radar only draws flights you could plausibly see by eye. A flight is shown when both are true:

- its **elevation is at least 5°**, so it is not hidden by buildings and haze, and
- its **ground distance** from you is within the **farthest flight** setting (default 25 km, adjustable from 1 to 100 km).

Ground distance (along the Earth's surface), not straight-line distance, is used on purpose: a jet at cruising height is
about 11 km up, so a straight-line limit of 10 km would hide every jet, even one directly overhead. Turning off "Only show
flights I can see" shows everything the feed returns.

Where a flight is going comes from the proxy's `/route` lookup by callsign, and is shown when you tap the flight.

## 5. Compass detection

A phone does not know where true north is. It has a magnetometer that finds **magnetic north**, and the sky is laid out
from **true north**. The app has to read the sensor, turn it into a heading, correct it, and smooth it.

### Step 1: read the sensor

Two kinds of event give a heading, depending on the browser:

| Where | Event | How the heading is read |
|---|---|---|
| Android (Chrome) | `deviceorientationabsolute` with `absolute: true` | the W3C `alpha` angle counts anticlockwise from magnetic north, so heading = `360 − alpha` |
| iPhone and iPad (Safari) | `deviceorientation` with `webkitCompassHeading` | already a clockwise heading from magnetic north, used as it is |

The app listens for both and uses whichever delivers a heading. When the phone lies flat, the heading is the direction the
top of the phone points. (For the camera view, when the phone is upright, the heading is the direction the back camera
points; see section 7.)

### Step 2: correct for magnetic declination

True north and magnetic north differ by the **declination**, which depends on where you are. It is about +15° in Seattle,
−12° in New York, +13° in Sydney, and near 0° in Hyderabad. Without a correction every direction would be off by that
much.

`lib/declination.js` computes it in the browser from the **World Magnetic Model 2025** (NOAA, public domain; the coefficients
are in the file; valid 2025 to 2030). It is a 12-degree spherical harmonic expansion evaluated at your latitude and
longitude, with the secular change for today's date. It is checked against all 12 of NOAA's official test values to within
0.03°. If anything is wrong with the input, it returns 0 so the compass is never made worse.

The declination is worked out whenever the location is set. The corrected heading is:

```
true heading = magnetic heading + declination
```

### Step 3: smooth

Sensor readings jitter. The heading is moved a quarter of the way toward each new reading, taking the shortest way round
the circle (so 359° to 1° does not swing through 180°).

### Step 4: use it

- **Radar:** with the compass on, the map is rotated by the heading, so the top of the screen is the way you face and the
  N, E, S and W letters point the real way. East is on the right, like a map seen from above (the setting "Show east on the
  right" can mirror this for a fixed sky chart when the compass is off). A line at the top right shows
  "Facing NNE 15° (true)" so you can check the compass against a direction you know.
- **Camera view:** the same corrected heading is combined with the phone's tilt (section 7).
- **Nearby list:** "where to look" is given relative to your heading when the compass is on.

### How the compass is turned on

The landing page records the compass state: `granted`, `denied`, or `na` (this device needs no permission, which is every
Android phone and computer). The sky view starts the sensors by itself for `granted` and `na`, and also when nothing is
stored (someone who skipped the landing page) on a device that needs no permission. It stays off after a refusal, and on an
iPhone until a tap has granted it.

Where no permission was asked, the compass is only counted as on once a real reading arrives. A computer with no sensor
therefore keeps dragging-to-rotate, and a phone switches to the turning map as soon as its first reading comes in.

### Accuracy

A phone compass is usually 5 to 20° off and gets worse near metal, speakers, cases with magnets and in cars. The app
cannot fix that. It can only remove the systematic part (declination). Moving the phone in a figure of eight recalibrates
most phones.

## 6. The radar view

The radar is a canvas. The centre is straight up (elevation 90°), the outer circle is the horizon (0°), and rings mark 30°
and 60°. Each object is drawn at a position computed from its azimuth and elevation, minus the map rotation, with east on the
right (or mirrored if the setting says so).

- Tapping picks the nearest object within a small radius. A flight beats a star drawn behind it.
- A radar sweep turns round the dial (switched off if the device asks for reduced motion, or in Layers).
- Pinch or the +/− buttons zoom; dragging pans when zoomed in. At 1× with the compass off, dragging rotates the sky.
- The status line says where each kind of data came from and how old it is, and says plainly when a feed is unreachable
  or switched off.
- The zoom, reset and AR buttons sit in a row just under the radar, so they never cover it.
- **Nearby tab:** a list, nearest first. Each row has a small icon for the kind of object (plane, satellite, space station,
  Sun, Moon, planet, star), its name, the kind in words, the distance and where to look. Tapping a row opens the object on
  the radar.
- **Selecting text.** The page refreshes its text every two seconds. A container is only rewritten when its content changed,
  and never while the visitor has text selected in it, so selecting and copying works. Rows are text blocks rather than
  buttons (a button's text cannot be selected), and a drag that selects text is not treated as a tap or a swipe.

## 7. The camera (AR) view

The camera view shows the back camera with labels drawn over it. The labels are placed by maths, not by image
recognition.

### Where the camera points

The W3C orientation angles `alpha`, `beta`, `gamma` describe how the phone is rotated. The device's `z` axis (out of the
screen) is expressed in Earth coordinates (x east, y north, z up). The back camera looks along its negative `z`.

From that, `lib/ar.js` computes:

- **heading** = `atan2(−m13, −m23)`: the compass direction the camera faces,
- **pitch** = `asin(−m33)`: 0 when level, +90° straight up, −90° straight down. A phone lying flat face up has a pitch of −90°.

On iPhone the heading comes from `webkitCompassHeading` instead of `alpha`. The declination is added to either (section 5).
The heading is smoothed in the same way as the radar's.

### Putting an object on the screen

For an object at azimuth `a` and elevation `e`, and a camera at heading `h` and pitch `p`:

1. Turn both into unit vectors in (east, north, up).
2. Build the camera's forward, right and up vectors from `h` and `p`.
3. Take the dot products to get the object's position relative to the camera.
4. Behind the camera (negative forward component): not drawn.
5. Otherwise use a pinhole camera: the focal length in pixels is `(screen height / 2) / tan(vertical field of view / 2)`, and
   `x`, `y` follow from the right and up components divided by the forward component.

The vertical field of view is assumed to be **63°**, typical for a phone camera held in portrait. Phone roll (tilting the
phone sideways) is **ignored**, so the picture assumes the phone is held upright.

### What is drawn

A horizon line and N, E, S, W marks so you can see the picture lines up with the sky; planes as the airplane symbol turned
to their track, satellites as diamonds, the Sun, Moon and planets as circles, with names; the object you selected
highlighted, and, if it is off the screen, an **arrow at the screen edge** pointing the way to turn; and a heading and tilt
readout.

### When it opens by itself

Raising the phone opens the camera view; laying it back down closes it. The rule uses the pitch with a gap between the two
thresholds (hysteresis) so it does not flicker:

| Event | Rule |
|---|---|
| Opens | pitch above **−15°** (nearly upright) for **700 ms**, with camera permission already granted, the compass on, the radar page showing, and nothing already opening |
| Closes | pitch below **−40°** |
| A phone tilted to read (about −30° or lower) | never opens it |
| After a camera failure or after you close it by hand | no automatic opening until the phone has been laid flat once |

There is also an **AR** button on the radar for opening it by hand. **Only a view that opened by itself closes by itself.**
A view opened with the AR button stays until you press its close button, even if the phone is held low or laid flat;
otherwise tapping AR with the phone tilted to read would close it again 0.7 seconds later.

### The camera stream

`getUserMedia` asks for the back camera (`facingMode: environment`). Opening is guarded by one shared pending promise, so two
triggers cannot start two streams. Errors are sorted into `unsupported`, `denied` and `failed` so the screen can say what
happened. The stream is stopped when the view closes. The picture never leaves the phone.

## 8. Data providers and the proxy

### Why a proxy

Most public aircraft feeds send no CORS headers, so a web page cannot read them. The proxy fetches them on the server
side and returns the answer with CORS headers for the allowed origins. It also lets everyone in the same area share one
upstream request, which is what keeps free feeds from throttling us.

### What it serves

| Endpoint | Answer | Cache: fresh for | Served stale when all providers fail, for |
|---|---|---|---|
| `/aircraft?lat=&lon=&r=` | `{ ac: [...] }` in the readsb v2 format (the radius is rounded up to a multiple of 25 km, so made-up radii share one cache entry) | 30 s | 3 min |
| `/route?callsign=` | `{ callsign, origin, destination }` | 30 min (10 min when unknown) | 24 h |
| `/tle?group=stations\|visual` | element sets as plain text | 6 h | 3 days |
| `/locate` | `{ lat, lon, city, region, country }`: the city Cloudflare knows for the visitor's network address, rounded to about 1 km | never cached or stored (`private, no-store`) | — |
| `/status` | which providers are healthy now | never cached | — |

The aircraft area is rounded to a 0.25° cell and the query goes to the centre of the cell, so every visitor in the cell gets
the same answer from one cache entry.

### Providers and fallbacks

| Data | In order | Notes |
|---|---|---|
| Aircraft | adsb.lol → adsb.fi → OpenSky | the first two use the same format; OpenSky's answer is converted (metres to feet, m/s to knots) so the app needs only one parser |
| Routes | adsbdb → hexdb | adsbdb knows more; hexdb answers the route as ICAO codes and the proxy looks each airport up. A flight adsbdb does not know is also asked of hexdb |
| Satellites | CelesTrak → a mirror database → an ISS-only feed | the mirror and the ISS feed only carry the space stations. The `visual` group (about 100 bright satellites) has no mirror and relies on the cached copy |
| Weather | Open-Meteo, called from the browser | no fallback: it is only cloud cover and temperature, and the app works without it |

Providers that refuse anonymous clients are not used: airplanes.live and adsb.one now answer HTTP 403.

### What happens when a provider throttles or fails

The proxy treats every provider as unreliable.

1. **Timeouts.** Each provider call has a 6 second limit, so a slow provider cannot hold up the answer.
2. **Ordered fallback.** Providers are tried in order until one gives a valid answer. A "valid" answer is checked, not just
   a 200: an HTML error page or an empty JSON object counts as a failure.
3. **Cooldowns.** A failing provider is put on a cooldown and skipped until it ends, so a throttled provider is not hammered:

   | Failure | Cooldown |
   |---|---|
   | HTTP 429 or 503 | the `Retry-After` value (a number of seconds or a date), 60 s when not given, at most 10 min |
   | HTTP 401 or 403 (blocked) | 1 hour |
   | Timeout, network error, HTTP 5xx, bad payload | 15 s, doubling with each failure in a row, up to 5 min |
   | Success | cooldown cleared |

4. **Full outage.** If every provider is cooling down, the one whose cooldown ends first is tried anyway, so an outage can end.
5. **Stale answers.** When every provider fails, the last good answer is served (`X-Cache: STALE`, with `X-Stale-Age`)
   for the stale period in the table above. Only when there is nothing to serve does the caller get HTTP 502, with a list
   of what each provider did and a `Retry-After`.
6. **Shared work.** A fresh cache entry means no provider is called at all (`X-Cache: HIT`); `X-Provider` always says which
   provider the answer came from.

Cooldown memory lives in the running Worker instance. A fresh instance starts knowing nothing and finds out on its first
failures. `/status` shows what the instance you reached currently knows.

### Which origins may read it

`ALLOWED_ORIGINS` (a Worker variable) lists the site origins that may read the answers. Pages on `http://localhost` and
`http://127.0.0.1` are always allowed so local development needs no setup. Other origins get no
`Access-Control-Allow-Origin` header, and browsers then refuse to hand them the data.

### Kill switch

Setting the `ENABLED` variable to `false` (or `0`, `off`, `no`, `disabled`) makes every path answer HTTP 503 immediately,
with no provider call and no cache read. The app shows "Aircraft: feed switched off for now". Remove the variable, or set
`true`, to switch it back on.

### What the app does with failures

The app polls aircraft every 30 seconds while the page is visible. A failed poll leaves the previous list on screen and
the status line says the feed is unreachable (or switched off). Route lookups that failed are tried again after a minute;
an "unknown route" is retried after ten minutes; a known route is kept. Satellite element sets are cached in the browser
for 6 hours and, if every source fails, the saved copy is used however old it is. If the proxy does not answer for
satellites, the app asks CelesTrak directly.

### Cost

The Worker needs no keys or storage and uses Cloudflare's cache. Because answers are shared by area, the number of provider
calls depends on how many areas are active, not on how many phones are polling.

## 9. Offline use and the service worker

`sw.js` precaches the app's files and the two CDN libraries (`astronomy-engine`, `satellite.js`, pinned to exact versions) so
the app opens offline. Own files are fetched **network first** (so a new deploy shows straight away) with the cache as the
fallback. Live data is never cached by the service worker; the app keeps its own saved satellite copy. A test checks that every
file a page loads is in the precache list.

## 10. Privacy

- Location and compass readings stay on the device. They are used to compute positions.
- The aircraft request carries your coordinates to the proxy. The proxy forwards only the centre of a 0.25° cell (about
  28 km across) to the providers and keeps no record of you. Its cache is keyed by area, not by person.
- Weather is requested straight from Open-Meteo with your coordinates rounded to two decimals.
- Satellite data requests carry no location.
- The two libraries come from a public CDN, which sees an ordinary page request.
- The camera picture is shown on the screen only. It is not recorded or sent anywhere.
- There are no accounts and no analytics.

(Any service in front of the site or proxy, such as a CDN, will have its own logs; that is outside the app.)

## 11. Build, deploy and search

- **CI** (`ci.yml`) runs `npm test` on every pull request and on pushes to `main`.
- **Deploy** (`pages.yml`) runs the tests, copies the published files into `_site`, writes `config.js` from the
  `AIRCRAFT_PROXY_URL` repository variable, writes the `CNAME` file from `PAGES_DOMAIN`, runs `scripts/seo.js`, and publishes
  to GitHub Pages.
- **Search engines** need absolute addresses for canonical links, share tags, a sitemap and `robots.txt`, but the repository
  must not contain the site's address. Pages carry a `__SITE_URL__` placeholder, and `scripts/seo.js` replaces it at build time.
  With no domain set, the lines that need it are dropped and the pages are still valid. The sky view and settings pages are
  marked `noindex`; the home and About pages are indexed.
- **Live data** (`live-data.yml`) runs the live data test daily and on demand. It is separate from CI on purpose.

## 12. Testing

| Layer | Where | Runs |
|---|---|---|
| Unit tests: logic, formatting, visibility, parsing, onboarding, layers | `test/*.test.js` | every pull request |
| Compass correction against NOAA's official WMM2025 test values | `test/declination.test.js` | every pull request |
| AR maths: pose, projection, auto-open rules; the camera with a mocked `getUserMedia` | `test/ar*.test.js` | every pull request |
| Proxy: caching, CORS, kill switch, fallbacks, cooldowns, stale answers, routes, satellites | `test/aircraft-proxy.test.js`, `test/provider-fallback.test.js`, `test/flights.test.js` | every pull request, with a fake network, cache and clock |
| Local proxy | `test/dev-worker.test.js` | every pull request |
| Pages, links, service worker list, SEO tags, landing page structure | `test/site.test.js`, `test/seo.test.js`, `test/landing-page.test.js` | every pull request |
| Camera view on an Android emulator (compass starts by itself, the AR button keeps the view open, raising the phone opens it, laying it flat closes it) | `e2e/android/ar.e2e.js` (`npm run test:android`) | by hand, with an emulator |
| The app in Safari's engine (WebKit) with an iPhone profile and every iPad profile in both orientations (six models): the motion permission asked inside the tap, `webkitCompassHeading` turned into a true heading, install steps (also for an iPad that calls itself a Mac), camera view, layout, no scrolling on landscape iPads | `e2e/ios/safari.e2e.js` (`npm run test:ios`) | every pull request, in the `iOS Safari (WebKit)` workflow |
| Real data at five places | `e2e/live/live-data.e2e.js` (`npm run test:live`) | daily on GitHub, and by hand |
| Compass on an Android emulator with virtual sensors | `e2e/android/compass.e2e.js` (`npm run test:android`) | by hand, with an emulator |

The emulator test sets the virtual accelerometer and magnetometer so the phone lies flat pointing at a known magnetic
heading, then reads the "Facing" line the app shows and checks it equals the magnetic heading plus the declination for the
place the app was told it is in.

## 13. Known limits

- **No real iPhone or iPad in the tests.** The iOS test runs Safari's engine on a Linux desktop with an iPhone profile and the iPad profiles (a Playwright profile sets the screen size, touch and user agent; it is not iPadOS). It adds the iPhone-only motion permission and `webkitCompassHeading` the way iOS provides them, so it checks the app's iPhone logic and layout, but not the real compass, the real camera, or the way iOS treats a home-screen app. Those need a real iPhone.

- **The camera view has not been run on a real phone.** It is covered by maths tests and the emulator, but the iPhone
  heading (`webkitCompassHeading` while the phone is upright), the assumed 63° field of view, and ignoring phone roll are
  unverified on real hardware.
- **Compass error.** Phone compasses are typically 5 to 20° off.
- **Flight routes** are looked up by callsign, and airlines reuse callsigns, so a route can occasionally be the wrong leg.
- **Aircraft coverage** comes from community receivers: some aircraft are missing or delayed, and military or private
  flights may be hidden.
- **Satellites.** The `visual` group depends on CelesTrak or the cached copy. If CelesTrak is down for a first-time visitor
  and nothing is cached, only the space stations (through the mirror) are available.
- **OpenSky** is the last aircraft fallback. Anonymous use has a small daily allowance, so it is a safety net, not the main source.
- **Declination model validity.** The built-in model covers 2025 to 2030 and must be replaced with the next World Magnetic
  Model after that.
- **Weather** has one provider and no fallback.

## 14. Install and updates

### Installing the app

FarGems is a Progressive Web App. The home page always has an **Install app** button (and the same item in the menu) until
the app is installed:

- Where the browser offers installation (Chrome and Edge on Android and desktop) the button starts the browser's own install
  prompt. The page keeps the `beforeinstallprompt` event for this.
- On iPhone and iPad there is no prompt to start, so the button shows the steps: Share, then Add to Home Screen.
- In any other browser it points to the browser's menu (Install app, or Add to Home screen).
- Once the app runs installed (`display-mode: standalone`) the button disappears.

What makes a site installable: a manifest with a name, `start_url`, `display: standalone` and icons; a service worker with a
fetch handler; HTTPS. The manifest has round "any" icons (192 and 512), a separate full-bleed "maskable" icon (the system
crops it to its own shape), and the SVG. The old icons were square pictures with a dark background and a stray generator mark; the new ones
are drawn from `icon.svg`. iPhone uses `apple-touch-icon.png`, a full-bleed navy square, because iOS cannot show transparency
or a circle. Inside the installed app the wordmark is plain white.

### Knowing that a newer version exists

The service worker fetches the app's own files network-first, so a reload always gets the newest files. The page that is
already open, though, keeps running the old code until it is reloaded, so it has to be told.

- At deploy time the workflow writes the commit it built from into `config.js` (`build`) and into `version.json`.
- `update.js` asks for `version.json` (with a changing query, so no cache can answer, and never through the service worker)
  when the page is shown and every 10 minutes, at most once every 5 minutes. If the build id differs from the page's own, a
  bar appears: "A new version of FarGems is available" with **Reload** and **Later**.
- It also shows the bar if the service worker is replaced while the page is open (`controllerchange`), but not for the very
  first install.
- Reload asks the service worker to update, then reloads the page.
- A copy run locally has no build id and never shows the bar.

If a CDN sits in front of the site it can keep old copies of the files for hours. Purge the changed files after a deploy.

## 15. Pins, sharing and a place from the network

- **Pins.** Every row of the nearby list has a star, and the detail card has a Pin button. Pinned object ids are kept in
  `localStorage` (`fg.pins`, at most 30, newest first). Pinned objects lead the nearby list and are always named on the radar
  with a star. An aircraft is pinned by its hex id, so the pin matters only while that flight is overhead.
- **Share.** The detail card's Share button calls `navigator.share` when the browser has it and otherwise copies the text. The text
  says what the object is and where to look (angle and compass direction, never coordinates), adds the Wikipedia link when
  there is one, and ends with the permalink of the object (section 37).
- **Wikipedia.** `wikiTitle` in `lib/logic.js` maps planets, the Sun and Moon, the bright stars, meteor showers, space stations,
  constellations and common aircraft types to an article. The detail card asks Wikipedia's summary endpoint once per article,
  shows the opening, and hides the link when the article does not exist.
- **A place when none was shared.** With no saved location the viewer first uses the exact position if the browser already allows
  it. Otherwise it asks the relay's `/locate` (Cloudflare gives the Worker a city for the network address), shows the sky for
  that city with a note saying it is a guess, and does **not** save it, so the permission flow still works and the guess goes away
  once a real location exists. With no relay configured, or when the relay cannot tell, the card asks for a location as before.
- **Names on the radar.** A name is placed only where all four corners of its box are inside the circle and the canvas and clear
  of other names. Long names are cut with an ellipsis (a selected object's name is cut to what fits across the radar). An
  important name with no free spot is moved toward the middle until it fits.

## 16. Units and language

- **Units.** Settings has a Distance and speed choice: metric (km, km/h, m), imperial (miles, mph, feet) or aviation (nautical miles, knots, feet). It is saved as `fg.units`; with nothing saved the browser language decides (miles and mph for en-US and a few others). The conversions live in `lib/logic.js` (`lengthText`, `altitudeText`, `speedText`), so every place that shows a length, height or speed uses the same ones. The farthest-flight setting stays in km.
- **Language.** The text is English only, and `<html lang>` is `en`. Times and dates follow the browser locale. Translating means moving the fixed phrases (the pages, the detail card, compass names, moon phases) into one catalogue keyed by language and setting `lang` from it; that has not been done yet, and a half-translated page would be worse than a consistent English one.

## 17. The camera view: Moon phase, pictures, and lining up

- **The Moon.** `lib/moon.js` draws the Moon with the fraction that is lit (`phase_fraction` from astronomy-engine), the lit side turned toward the Sun (`directionOnScreen` in `lib/ar.js`, an exact direction in the camera picture) and the dark seas turned by the parallactic angle, so it looks like the real Moon at that moment. The seas are approximate shapes, not a map.
- **Photo.** The Photo button in the camera view joins the video frame (cropped like the screen, `coverCrop`), the overlay and a small caption (name and time, never a place) into a PNG. It goes to the share sheet where the phone can share files, otherwise it is saved as a file. Nothing is uploaded.
- **Align.** A phone compass can be several degrees off. In Align mode dragging the picture moves the overlay, and the difference is saved as `fg.arOffset` (`{ h, p }` degrees, kept within 45 and 25). The heading offset is added to the compass reading for both the camera view and the radar, so they stay in agreement. Reset clears it.

## 18. Very long distances

From a million km on (the Sun, planets) a distance is shown short in the visitor's units (`149.6 million km`, `93.0 million mi`, `4.5 billion km`). Settings can switch the Sun and planets to astronomical units (`fg.far` = `au`; one AU is the average Earth to Sun distance, 149,597,870.7 km, explained in a tooltip on the detail card) or to light travel time (`light`, for example `8 min 19 s by light`). The detail card for these objects also has a Light takes row. Nearer things (the Moon, satellites, flights) keep the full number.

## 19. Android tablets, permissions and installing

- **One permission.** Only iPhone and iPad ask for the compass (`compassNeedsPermission` also checks the device is an Apple one, because other browsers can have the same function and answer "granted" without asking). Elsewhere the home page asks for the location only, and Settings has no compass card. The camera is never asked for on the home page: only the AR button (or a camera view that was allowed before) uses it.
- **Opening the sky view.** After the location is allowed the page goes straight in, also when the browser already had the permission (the first visit; later visits find the stored place and stay). If the device cannot work out a position (no GPS, location switched off, timeout) that is not a refusal: the sky view opens with an area guessed from the network. Only a refusal (code 1) asks for coordinates.
- **Installed.** The browser fires `appinstalled` once; the page writes `fg.installed` so a later visit in a browser tab stops offering the install. `beforeinstallprompt` only fires while the app is not installed, so it clears the note.
- **Manifest.** `orientation` is `any`; it used to lock the installed app to portrait, which turned a tablet sideways.
- **Tests.** `e2e/ios/android-tablet.e2e.js` runs an Android tablet profile in Chromium on every pull request.
- **Compass on a turned screen.** The orientation sensors belong to the device, not to the screen. An Android tablet is naturally sideways, and an installed app can be held in portrait, so `facingHeading` takes `screen.orientation.angle` and follows the top of the screen (the device y axis turned by that angle). iPhone and iPad give a heading of their own and are left alone.

## 20. Station passes and the key

- **Passes.** The ISS and Tiangong rows under the radar are buttons. Choosing one draws its path across the sky as a dashed line (with a dot where it comes up and a ring where it goes down) and shows a card: when it rises, where, how high it gets, where it sets, how long it stays above 10 degrees, and a Wikipedia link. A station that is above the horizon already is selected on the radar instead, and shows its normal card. Choosing the same pass again clears it.
- **The key.** A closed `details` block under the details and passes explains the radar: the middle is straight overhead and the edge is the horizon (an object is drawn at a distance from the middle of 90 minus its height in degrees), and every symbol, including the dashed circle with a plus for a meteor shower radiant.

## 21. Reading the radar by day

The radar's background goes from dark blue at night to light blue by day (`skyLook` in `lib/logic.js` gives the colours for a brightness). Names were light grey and white, which vanished on the light sky. Now every name (and the 30 and 60 degree numbers) is drawn with a dark outline, the star names are near white, the rings and lines get brighter by day, and the dots have an edge so a pale Moon still shows. In the camera view a name that would run off the right edge goes to the left of its object.

## 22. Turning the screen

iPhone and iPad give the heading of the top of the device, so a screen turned sideways needs the same correction as on Android: the heading is the device heading plus the screen turn (`window.orientation`: 0, 90, 180, -90), which makes east show as east in landscape. The heading no longer smooths by a fixed amount: `followHeading` moves further the further away the new reading is (a quarter turn in one reading, a small wobble a quarter of the way), and after a turn (a screen orientation change, an orientationchange event, or the window changing between portrait and landscape) it takes the next reading as it is for 0.6 s, and the camera view forgets its smoothed heading.

## 23. Tests in CI

The browser tests (WebKit for iPhone and iPad, Chromium for an Android tablet) run as four shards at the same time. `e2e/ios/shard.js` replaces `node:test` in those files: with `FG_SHARD=2/4` a run only registers the tests whose number is 2 modulo 4 (plus one), so the slow ones spread evenly and the answer comes back in the time of the slowest quarter. The unit tests (a few seconds) run in their own job. The job called `safari` waits for all four shards and fails unless they all passed, so it is the one result to look at or to require.

## 24. A dark radar, and closing the details

- **Dark sky.** The radar background is always dark (the light blue day sky is gone), with the horizon circle drawn as an outline. Names may cross the circle (they only have to stay on the canvas), and the Sun, Moon and planets up to 6 degrees below the horizon are drawn just outside the rim.
- **Closing the details.** Every details card has a cross (and Escape does the same). It clears the selection and the station pass, hides the card (also in the camera view), and the card stays away until something is picked again.

## 25. Flight direction and paths

- **Direction.** A missing speed or direction stays missing (it used to become 0, so a flight with no direction was drawn heading north, and one with no speed did not move and its plane pointed a random way). `reconcileCourse` fills them in from how the flight moved between two polls, and replaces a reported direction that is more than 45 degrees from a clear movement. A flight whose direction is still not known is drawn as a plain dot, never as a plane. The position uses its age (`seen_pos`), and at each poll the drawn place slides from the old place to the new one over 20 seconds (`applyCorrection`), so flights no longer jump and look as if they move at an angle.
- **Paths.** The object you pick gets its path: a flight, 15 minutes straight ahead; a satellite, the next 40 minutes of its orbit until it sets (nothing for one that hardly moves across the sky, such as a geostationary one); the Sun, Moon, planets, stars and meteor radiants, the next 12 hours from where they rise to where they set, with a dot and a label each hour. It is drawn as a dashed line on the radar and in the camera view.

## 26. The logo's white ring

The logo has a thin white ring: `icon.svg` draws it as an outline (nothing is painted inside, so the logo is still transparent; the viewBox grew to make room), and the round app icons `icon-512.png` and `icon-192.png` have it in place of their old teal edge. `scripts/make-icons.js` redraws the two PNGs (it repaints only the edge band and keeps the artwork). The full-bleed maskable icon and the iPhone icon are left alone, because the system crops them to its own shape and a ring would be cut off.

## 27. A phone on its side, and installing from the sky view

- **Landscape on a phone.** The two-column layout now starts at 560 px wide (it was 900), so a phone on its side gets the radar on the left and the details on the right. On a short screen (560 px high or less) the radar is sized by the height (`100dvh - 92px`, it used to be as wide as the page and so taller than the screen), the zoom buttons stand in a column beside it, the details scroll inside their own column, and the home page drops its picture and shrinks its words so both pages fit without scrolling. The narrowest phones (under 700 px) keep the home page in one column. The radar canvas is no longer clipped to a circle (the circle is drawn on the canvas), so names and things outside the horizon circle show.
- **Install from the sky view.** The gear menu has Install app. It starts the browser's own install when the browser offers it, otherwise it says how to do it from the menu, and it goes once the app is installed or when this already is the installed app.

## 28. Load speed

- **A scripts tag next to a CSP tag.** The Content-Security-Policy `<meta>` tag (added for security) made Chrome find the page's scripts one at a time: each started only when the one before had finished, instead of all together. On a slow phone connection (150 ms round trip, 1.6 Mbps, 4x slower CPU) the sky view's cold load went from about 1.1 s to about 3.0 s. Every script is now `defer` (they still run in the same order, after the page is parsed), which brings it back to about 1.1 s. A browser test delays every script by 350 ms and fails if they load one after another.
- **Icons.** The four app icons are a few flat colours, but a canvas export compresses badly (600 KB together, which the service worker downloads when it installs). `scripts/shrink-png.py` gives them a 256-colour palette: about 45 KB together, with a faint banding in the dark gradient that is not visible at icon size.
- **Ring on every icon.** `scripts/make-icons.js` also draws the thin white ring on the Android maskable icon and the iPhone icon, inside the middle 80% that no launcher mask cuts, so the installed icon shows it whatever shape the phone uses.

## 29. The airline and the route on a flight card

- **Airline.** The first three letters of a flight number are the airline's ICAO code (AIC144 is Air India), looked up in a list of about 140 airlines (`airlineOf` in `lib/logic.js`). The card shows the name right under the flight number, and the nearby list shows it beside the word Aircraft. Registrations (N123AB) and airlines not in the list show none.
- **Route.** Where the flight came from and where it is going are drawn by the same code, side by side, with the same size, weight and colour: the city on top of its code, with From and To above and an arrow between, and the distance to go below. An unknown start says Not known at the same size, only lighter. Sharing a flight says it in words (for example Air India. Flying from Hyderabad (HYD) to Delhi (DEL).).

## 30. Sharing the app

Tell a friend is in the home page "..." menu, the sky view gear menu and, under the heading Pass it on, on the Settings page. It sends one short text (about 170 characters, so it fits a WhatsApp message or a tweet with the address): the line the app is known by, "Look up. Know what you are looking at.", then what it does in one breath (it names the planes, the ISS, planets and the Moon above you, live, on a radar or in AR through your camera; free, no sign-up). The address is the site root, taken from where the page is served. `shareApp` in `lib/onboarding.js` uses the phone share sheet when there is one, otherwise it copies the text and the address, and closing the sheet is not an error.

## 31. The tabs

Radar and Nearby are one rounded control: the chosen tab is filled in the accent colour, each tab has an icon, Nearby shows how many things are in its list, and each is at least 40 px tall. They are still a proper tab list for keyboards and screen readers (the earlier accessibility work, which changes nothing you can see).

The browser tests now run as six parallel jobs: the Safari (WebKit) tests in five shards and the Android tablet tests (Chromium) in one. Each job installs only its own browser (before, every job installed both, which took 40 to 70 seconds of a 70 to 120 second job) and keeps the downloaded browsers between runs with a cache.


## 32. Back from the camera view

The camera view adds one step to the browser history when it opens. A swipe back or the phone Back button closes the view and stays on the sky view. Closing it with the X, or by laying the phone flat, removes that step again so Back still goes to the page before.

## 33. Crosshair

The camera view draws a thin cross with a gap in the middle at the centre of the screen: a dark edge under a light line, so it shows on a bright or dark sky. It marks the point the camera is aimed at, which helps when lining the overlay up on the real Moon or a star with Align. It is drawn first each frame, so it is there before the sensors start, and it is in the photo too.

## 34. Icons drawn at their own size, and browser-test setup

`scripts/make-icons.js` draws every app icon from `icon.svg` at the icon's own pixel size (512, 192, 512 maskable, 180 for iPhone): the dark tile, the artwork without the SVG's own ring, and a white ring (2% of the size on the round icons, 2.2% on the full-bleed ones, whose ring stays inside the 40% radius a round mask leaves). A browser takes the picture at one device pixel per pixel, so nothing is shrunk or palette-squeezed and the ring stays a clean line. In CI the browser install step has short apt timeouts and three time-limited attempts, because a stalled package mirror made one shard wait ten minutes.

## 35. Node 24 in CI

The workflows run the project's scripts on Node 24, and use releases of the GitHub actions (checkout, setup-node, cache, upload-pages-artifact, deploy-pages) that run on Node 24 themselves, each pinned to a commit. `test/node-version.test.js` fails if an action goes back to a Node 20 release.

## 36. Compass points in the camera view

The camera view draws the eight compass points as poles standing on the horizon (12 degrees tall) with their names on top, North in red. When magnetic north is more than half a degree from true north (the declination), it is added as a dashed cyan pole labelled Mag N. A major point that is out of the picture is shown as an arrow with its letter on the left or right edge, by the shorter turn toward it; two on one edge are stacked, the nearer first. The crosshair is small (arms 4 to 14 px from the centre).

## 37. A permanent link to one object

Every object has an address of its own: `viewer.html#o=<id>`, with the ids the sky already uses: `sat:25544` (NORAD number), `air:4ca7b2` (transponder address), `body:Mars`, `star:Vega`, `met:Perseids` (`lib/permalink.js`; only ids of that shape are read or written). The link names the object only, never a place: whoever opens it sees the object from where they are.

- **Opening it** picks the object before the first draw, on the radar page, exactly like a tap: the card, the highlight, the dashed path, and the same in the camera view. Changing the address by hand (or opening another link in the same tab) picks the new object.
- **The address follows the pick.** `renderDetail()` ends with `syncLink()`, which sets `#o=<id>` with `history.replaceState` (so Back and the camera view's history step are untouched) and removes it when the card is closed. Share sends the same link.
- **When the object cannot be seen it says so**, in a card with an amber line (`.notvis`): below the horizon (with how far under and which way), too far or too low to see (flights hidden by "visible only"), not among the flights around you (landed, or out of range of where you are), a satellite FarGems does not have, or a meteor shower that is not on. `computeSky` keeps those in `state.unseen` for the card. While the place, the flights or the satellites have not arrived yet it says it is looking, not that the object is gone, and the object is picked up as soon as it appears. Objects that are listed but out of sight (the Sun at night) get the line above their facts, and so does an object whose layer is switched off.

## 38. The crosshair picks what it is held on

In the camera view the object nearest the crosshair (within 28 px of the middle of the picture, `AIM_RADIUS` in `lib/ar.js`) is picked on its own once the phone has been held on it for 600 ms (`AIM_DWELL_MS`); no tap is needed, and a tap still works. `aimTarget` finds the object and `aimStep` is the timer: moving to another object, or off every object, starts the hold again, so a phone swinging past things picks nothing; an object that is already the pick is left alone; after a pick nothing is picked again until the crosshair has left that object, so a tap on something else is not taken back while still aiming. A thin cyan ring fills around the crosshair while holding. Nothing is picked while the picture is being lined up by hand (Align). Looking away does not clear the pick.
