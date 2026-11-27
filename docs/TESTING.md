# Writing tests for FarGems

Two kinds of test, run by `npm test` (unit, in `test/`) and `npm run test:ios` (browser, in `e2e/ios/`, WebKit through Playwright). CI runs both on every pull request; the browser tests are split into five shards plus a tablet run.

**Run the whole of both before you push, not only the test you wrote.** The layout tests measure the height of the whole page, so adding one row anywhere breaks tests that look unrelated.

## Browser tests: start from the helpers

`e2e/ios/helpers.js` holds the building blocks. Every one of them is there because a version written inline in a test failed at random in CI. A new test that starts from them gets that experience for free; the check in `test/e2e-practices.test.js` fails the build when a test goes round them.

| Helper | Use it to |
| --- | --- |
| `iphone({ storage, answer, quiet, device, desktopUA })` | get a fresh iPhone or iPad page, with the iPhone motion permission and a camera of its own already in place |
| `linked(hash, setup, before)` | open `viewer.html?fgtest=1` with the sky libraries blocked and a sky set up by `setup` (a string of script, e.g. `FAKE_SKY`); `before(context)` is for answers to set up before the page asks |
| `openAr(page, sky, { still })` | open the camera view facing east with the camera and compass settled |
| `arShown(page)` | wait for the camera view; if it does not show, the failure says what the page was doing |
| `fakeCamera(page)` | put a camera of our own on the page (`openAr` does this for you) |
| `heading(page, magnetic, times, beta)` | feed compass readings |
| `wikiAnswers(context, { thumb, picture })` | answer Wikipedia and its picture server (pass it as `before` to `linked`) |
| `openSearch(page)`, `typeSearch(page, text)` | the search bar is hidden until wanted; these open it |
| `tallerBy(page, most)` | check a picture on the card adds no more than `most` px of height |

Static pieces: `HITEC`, `SAVED` (a stored location), `FAKE_SKY`, `AR_SKY`, `PNG`, `sleep`.

The place used everywhere is **HITEC City, Hyderabad (17.4435, 78.3772)**. Never use a real person's home, even rounded.

## The rules, and what went wrong without them

1. **Never change the browser's own `navigator.mediaDevices`.** On some WebKit builds an assignment to `navigator.mediaDevices.getUserMedia` does not stick; the page then asks for a real camera, is refused, and the camera view never opens. About one CI run in three failed on this. The helpers give the page a camera object of its own. Do not tap `#arBtn` yourself: use `openAr`, or call `fakeCamera(page)` just before the tap and `arShown(page)` after it.
2. **Do not work out where something is on the screen with your own sums.** The picture follows the compass a little behind, so a position worked out from the sky data is wrong for a moment, and on a slow runner for longer. Ask the view where it drew the object, and wait until it has stopped moving: `window.__fg.arView().item(id)` gives `{ x, y }`, and `callout()` gives the bubble's box.
3. **Do not measure something that changes with time after a fixed wait.** The picked object's icon fades after about 1.5 s; a runner three times slower than yours measures after the fade. Wait for a state (`callout()` is not null), measure at once, or keep the crosshair from picking with `openAr(page, sky, { still: true })` for tests that look at pixels in the middle.
4. **No `waitForTimeout`.** Wait for what you mean with `waitForFunction` or `waitForSelector`. `sleep` is only for letting a few frames draw, never the thing that makes a test pass. To prove that something does *not* happen, wait a bounded time for it and report the outcome: `await page.waitForURL('**/viewer.html', { timeout: 1500 }).then(() => 'redirected', () => 'stayed')`.
5. **Assert with a message that shows what was measured**, e.g. `'the bubble is inside the picture: ' + JSON.stringify(box)`. A failure in CI cannot be rerun at your desk.
6. **CI is slower than your machine, by about three times.** Do not assert that something shows up within a second of an action. Waits are generous (5 to 15 s); tests are quick because they do not wait when they do not have to.
7. **Do not reuse the names the test page keeps for itself:** `window.__ios`, `window.__toasts`, `window.__diagClicks`, `window.__diagErrs`, `window.__fg`. A test that wrote its own `window.__clicks` once collided with a diagnostic and failed every time.
8. **Check `style.css` for a class name before using it.** A new row class called `.sr` was already taken by the screen-reader-only style, which shrank every row to one pixel. The browser test found it; a unit test could not.
9. **Every test opens its own context and closes it in `finally`.** The tests share nothing, so any split into shards is safe.
10. **Use the cards' numbers and units as the page prints them** (miles or km follow the browser's language), or set the units in the test.
11. **A test never depends on the outside world.** `iphone()` switches off every request that leaves for a host other than this machine and the CDN the sky libraries come from. A page that really asked Wikipedia, the weather or the flight feeds was changed by the answers at random moments: the card grew above the Share button as the answer arrived and the button moved under the click, so one run in twenty failed. If a test needs an answer from one of them, register your own route after the helper has made the context (`wikiAnswers` does this; so does `routeSetup` in `safari.e2e.js`): the last route registered is the first one asked.
12. **A card is rewritten every couple of seconds**, as the numbers move. A tap that began before a rewrite and ended after it used to be lost (the button had been replaced between the press and the release), so Share or Pin occasionally did nothing. `setHtml` now leaves a container alone while a press that began in it is held. To test a tap on anything inside a card, include a case that rewrites the card between `page.mouse.down()` and `page.mouse.up()` (see `a tap is not lost when the card is redrawn`). A raw mouse press does not scroll: call `scrollIntoViewIfNeeded()` first, or it lands on nothing.

## When a test fails at random

Do not just rerun it. A rerun hides the cause.

1. Make the failure say what the page was doing: put the state in the thrown message (see `arShown`: toasts, the clicks that reached the page, errors, the state of the button and of the camera function).
2. Push that to a draft pull request and rerun the workflow ten times (`gh run rerun <id>`); the message of every failure is then in the logs.
3. Fix the cause in the helper, not in the one test, so every test benefits. Rerun ten times again; the run is clean only when all ten pass.

## Unit tests

`test/*.test.js` use `node:test`. Pure logic lives in `lib/` as small UMD modules (no DOM, no network) so it can be tested directly: pass the data in. Source-reading checks (`read('app.js')` and a regular expression) are fine for wiring, but pin the behaviour with a real test beside them; a view can be run against a mocked canvas and a clock the test controls (see `viewEnv` in `test/ar-callout.test.js`).

Every new feature gets both: unit tests for the logic and a browser test for what the visitor sees. A change to something visible gets before and after screenshots in the pull request description.
