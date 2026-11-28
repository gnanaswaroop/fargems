/* FarGems AR view: the camera picture with sky objects drawn over it.
 * It owns the camera stream, the overlay canvas and tap handling. Everything it needs from the app is
 * passed to create(), so it does not depend on app.js internals. The maths lives in lib/ar.js.
 *
 * create({ root, video, canvas, closeBtn, getObjects, getFilters, getSelected, getOrientation, onSelect, onClose,
 *         getOffset?, onOffset?, getLatitude?, getPath?, getCalloutLines? })
 *   getObjects()     -> [{ id, kind, name, az, el, az2?, el2?, color?, visible?, sunlit?, name }]
 *   getFilters()     -> layer switches { air, sat, sky, labels }
 *   getSelected()    -> id of the selected object, or null
 *   getOrientation() -> { alpha, beta, gamma, compassHeading, absolute }
 *   getOffset()      -> { h, p } degrees the visitor added to the heading and pitch to line the picture up (optional)
 *   onOffset(off)    -> called while the visitor drags the picture in line-up mode (optional)
 *   getPath()        -> { pts: [{ az, el, hr? }], kind } the path of the selected object, or null (optional)
 *   getLatitude()    -> the visitor's latitude, to turn the Moon's face the way it is turned in the sky (optional)
 *   getSymbols()     -> false when the visitor turned the drawn symbols off (optional; default on)
 *   getCalloutLines(ob) -> short lines of text for the bubble beside the picked object (optional; without it the full card is used)
 * Returns { open(), close(), isOpen(), capture(), setAligning(on), isAligning() }. open() rejects with an Error whose .code is 'unsupported', 'denied' or 'failed'. */
(function (root) {
  'use strict';
  const AR = root.FarGemsAR, L = root.FarGemsLogic;
  const VFOV = 63; // typical phone camera, vertical field of view in portrait

  function create(o) {
    let isOpen = false, stream = null, raf = 0, heading = null, items = [], aligning = false, lastCam = null, lastFocal = 1000, topInset = 0, selTrack = { id: null, t0: 0 }, cardOpen = false, calloutBox = null, cardShown = null, aimSt = { id: null, since: 0, done: false }, aimProgress = 0;
    const ctx = o.canvas.getContext('2d');
    const FONT_SYMBOLS = '"Segoe UI Symbol","Noto Sans Symbols2","Apple Symbols","DejaVu Sans",sans-serif';

    async function openCamera() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        const e = new Error('camera not supported'); e.code = 'unsupported'; throw e;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      } catch (err) {
        const e = new Error(String(err && err.message || err));
        e.code = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError') ? 'denied' : 'failed';
        throw e;
      }
      o.video.srcObject = stream;
      try { await o.video.play(); } catch { /* autoplay can be blocked until the first frame, the muted video still shows */ }
    }

    function stopCamera() {
      if (stream) for (const t of stream.getTracks()) t.stop();
      stream = null; o.video.srcObject = null;
    }

    function fitCanvas() {
      const dpr = root.devicePixelRatio || 1, w = o.canvas.clientWidth, h = o.canvas.clientHeight;
      if (o.canvas.width !== Math.round(w * dpr) || o.canvas.height !== Math.round(h * dpr)) {
        o.canvas.width = Math.round(w * dpr); o.canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { W: w, H: h };
    }

    function label(text, x, y, color, W, flipBy) {
      ctx.font = '600 13px system-ui, sans-serif'; ctx.textBaseline = 'middle';
      // A name that would run off the right edge goes to the left of its object (flipBy is the gap from the object).
      const w = W ? ctx.measureText(text).width : 0;
      let align = 'left';
      if (W && x + w > W - 6) { align = 'right'; x -= flipBy || 0; }
      if (W && align === 'right' && x - w < 4) { align = 'left'; x = Math.max(4, Math.min(x, W - 6 - w)); }
      ctx.textAlign = align;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.strokeText(text, x, y);
      ctx.fillStyle = color || '#fff'; ctx.fillText(text, x, y);
    }

    // The compass points around the horizon. Each one stands on the horizon as a pole with its name on top, so it reads as a
    // marker in the space around you and not as a letter on the glass. North is red, magnetic north (when it differs from true
    // north) is a dashed cyan pole, and a point that is out of the picture is shown as an arrow at the edge on its side.
    function drawCompass(cam, view, W, H, declination) {
      const TOP = 12; // how many degrees up a pole reaches
      const away = [];
      for (const pt of AR.compassPoints(declination)) {
        const base = AR.projectToScreen({ az: pt.az, el: 0 }, cam, view), top = AR.projectToScreen({ az: pt.az, el: TOP }, cam, view);
        const col = pt.mag ? '#5ad1e6' : pt.north ? '#ff6b5b' : pt.major ? '#ffd1c9' : 'rgba(255,255,255,.75)';
        if (base.front && top.front && (base.onScreen || top.onScreen)) {
          ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = pt.major ? 2 : 1.25; ctx.lineCap = 'round';
          if (pt.mag) ctx.setLineDash([5, 4]);
          ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 3;
          ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(top.x, top.y); ctx.stroke(); ctx.restore();
          const size = pt.north ? 20 : pt.major ? 16 : 12;
          ctx.save(); ctx.font = '700 ' + size + 'px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.strokeText(pt.name, top.x, top.y - 3);
          ctx.fillStyle = col; ctx.fillText(pt.name, top.x, top.y - 3); ctx.restore();
        } else if (pt.major && !pt.mag) {
          // Out of the picture: which side is it on? Turning toward it by the shorter way (a point behind you counts as the side it is nearer to).
          const rel = ((pt.az - cam.heading + 540) % 360) - 180;
          away.push({ pt, col, rel });
        }
      }
      // The arrows sit on the left or right edge at the height of the horizon; two on one edge are stacked, the nearer one first.
      const horizonY = (side) => { const q = AR.projectToScreen({ az: cam.heading + side * 90, el: 0 }, cam, view); return q.front && Number.isFinite(q.y) ? Math.max(40, Math.min(H - 60, q.y)) : H / 2; };
      for (const side of [-1, 1]) {
        const group = away.filter((a) => (a.rel < 0 ? -1 : 1) === side).sort((a, b) => Math.abs(a.rel) - Math.abs(b.rel));
        group.forEach((a, k) => {
          const x = side < 0 ? 24 : W - 24, y = Math.min(H - 40, horizonY(side) - 22 + k * 30);
          ctx.save(); ctx.translate(x, y); ctx.fillStyle = a.col; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 2;
          ctx.save(); if (side > 0) ctx.scale(-1, 1); // the arrow points toward the edge it sits on
          ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(4, -8); ctx.lineTo(1, 0); ctx.lineTo(4, 8); ctx.closePath(); ctx.stroke(); ctx.fill(); ctx.restore();
          ctx.font = '700 ' + (a.pt.north ? 18 : 15) + 'px system-ui, sans-serif'; ctx.textAlign = side < 0 ? 'left' : 'right'; ctx.textBaseline = 'middle';
          ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.strokeText(a.pt.name, side < 0 ? 12 : -12, 0);
          ctx.fillStyle = a.col; ctx.fillText(a.pt.name, side < 0 ? 12 : -12, 0); ctx.restore();
        });
      }
    }

    // A thin cross with a gap in the middle, a dark edge under a light line so it shows on a bright or a dark sky.
    function crosshair(W, H) {
      const cx = W / 2, cy = H / 2, gap = 4, arm = 10;
      ctx.save(); ctx.lineCap = 'round';
      if (aimProgress > 0 && aimProgress < 1) { // holding on an object: a ring fills, and the object is picked when it closes
        ctx.lineWidth = 3; ctx.strokeStyle = '#5ad1e6'; ctx.beginPath(); ctx.arc(cx, cy, gap + arm + 6, -Math.PI / 2, -Math.PI / 2 + aimProgress * 2 * Math.PI); ctx.stroke();
      }
      for (const [w, c] of [[3, 'rgba(0,0,0,.55)'], [1.25, 'rgba(255,255,255,.95)']]) {
        ctx.lineWidth = w; ctx.strokeStyle = c; ctx.beginPath();
        ctx.moveTo(cx - gap - arm, cy); ctx.lineTo(cx - gap, cy); ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + gap + arm, cy);
        ctx.moveTo(cx, cy - gap - arm); ctx.lineTo(cx, cy - gap); ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + gap + arm);
        ctx.stroke();
      }
      ctx.restore();
    }
    // The name and logo of the app, small, in the top left corner, level with the close button. They are drawn on the same canvas as
    // everything else, so a saved picture has exactly what the screen shows. (A same-site PNG, so the picture can still be saved.)
    const logo = typeof Image === 'function' ? Object.assign(new Image(), { src: o.logoSrc || 'icon-192.png' }) : null;
    function brand() {
      const y = topInset + 32, size = 20, x0 = 14, ready = !!(logo && logo.complete && logo.naturalWidth);
      ctx.save(); ctx.globalAlpha = 0.85;
      if (ready) ctx.drawImage(logo, x0, y - size / 2, size, size);
      ctx.font = '600 14px system-ui, -apple-system, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const x = x0 + (ready ? size + 6 : 0);
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0, 0, 0, .6)'; ctx.strokeText('FarGems', x, y);
      ctx.fillStyle = '#fff'; ctx.fillText('FarGems', x, y);
      ctx.restore();
    }
    // The room the phone keeps at the top of the screen (the notch), read from the page once the view is showing.
    function measureInset() {
      try {
        const p = document.createElement('div'); p.style.cssText = 'position:absolute;visibility:hidden;padding-top:env(safe-area-inset-top)';
        o.root.appendChild(p); topInset = parseFloat(getComputedStyle(p).paddingTop) || 0; p.remove();
      } catch { topInset = 0; }
    }
    // The details of the picked object in a bubble beside it, joined to it by a dotted line, so the object itself stays uncovered
    // and the details are in the picture (and in a saved picture). Tapping the bubble opens the full card.
    function drawCallout(ob, p, lines, alpha, W, H) {
      const padX = 11, padY = 9, lh = 17, titleFont = '700 14px system-ui, -apple-system, sans-serif', bodyFont = '500 12.5px system-ui, -apple-system, sans-serif', moreFont = '600 11px system-ui, -apple-system, sans-serif';
      ctx.save(); ctx.globalAlpha = alpha; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.font = titleFont; const tw = ctx.measureText(lines[0]).width;
      ctx.font = moreFont; const mw = ctx.measureText('More ›').width;
      ctx.font = bodyFont; let w = Math.max(tw + 12 + mw, ...lines.slice(1).map((s) => ctx.measureText(s).width)) + 2 * padX;
      w = Math.min(w, Math.max(120, Math.min(280, W - 16)));
      const h = 2 * padY + lines.length * lh;
      const box = AR.placeCallout(p.x, p.y, w, h, { left: 8, top: topInset + 92, right: W - 8, bottom: H - 150 }, undefined, items.filter((it) => it.id !== ob.id).map((it) => ({ x: it.x, y: it.y, r: 26 })));
      calloutBox = box;
      const lead = AR.calloutLeader(p.x, p.y, box);
      if (lead) { // the dotted pointer
        ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.setLineDash([0.1, 6]); ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 3;
        ctx.beginPath(); ctx.moveTo(lead.x1, lead.y1); ctx.lineTo(lead.x2, lead.y2); ctx.stroke(); ctx.restore();
      }
      const r = 12; // the bubble: a rounded box, dark and a little see-through, with a light edge
      ctx.beginPath(); ctx.moveTo(box.x + r, box.y); ctx.arcTo(box.x + w, box.y, box.x + w, box.y + h, r); ctx.arcTo(box.x + w, box.y + h, box.x, box.y + h, r);
      ctx.arcTo(box.x, box.y + h, box.x, box.y, r); ctx.arcTo(box.x, box.y, box.x + w, box.y, r); ctx.closePath();
      ctx.fillStyle = 'rgba(7, 11, 20, .84)'; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255, 255, 255, .28)'; ctx.stroke();
      const x = box.x + padX; let y = box.y + padY + lh / 2;
      ctx.font = titleFont; ctx.fillStyle = '#fff'; ctx.fillText(lines[0], x, y);
      ctx.font = moreFont; ctx.fillStyle = '#5ad1e6'; ctx.textAlign = 'right'; ctx.fillText('More ›', box.x + w - padX, y); ctx.textAlign = 'left';
      ctx.font = bodyFont; ctx.fillStyle = '#d4dcec';
      for (const s of lines.slice(1)) { y += lh; ctx.fillText(s, x, y); }
      ctx.restore();
    }
    // The full card under the picture shows when there is no bubble (nothing picked, or the picked object is out of the picture),
    // or when the visitor has tapped the bubble for more.
    function showCard(on) {
      if (cardShown === on || !o.root.classList) return;
      cardShown = on; o.root.classList.toggle('ar-card', on);
    }
    function drawFrame() {
      raf = requestAnimationFrame(drawFrame);
      const { W, H } = fitCanvas();
      ctx.clearRect(0, 0, W, H);
      brand();
      crosshair(W, H); // the point the camera is aimed at, so the phone can be lined up on the real Moon or a star
      const ori = o.getOrientation() || {};
      const knowsHeading = typeof ori.compassHeading === 'number' || (ori.absolute && ori.alpha != null);
      if (ori.beta == null) { label('Move the phone to start the sensors', 16, H / 2, '#fff'); return; }
      const pose = AR.cameraPose(ori.alpha, ori.beta, ori.gamma);
      // The compass reads magnetic north and the sky is laid out from true north, so add the declination.
      const off = AR.clampOffset(o.getOffset ? o.getOffset() : null); // the visitor's hand adjustment, for a compass that is a few degrees off
      const trueHead = ((AR.chooseHeading(ori.compassHeading, pose.heading) + (ori.declination || 0) + off.h) % 360 + 360) % 360;
      heading = AR.followHeading(heading, trueHead, false); // big changes (the screen was turned) catch up fast, small ones are smoothed
      const cam = { heading, pitch: pose.pitch + off.p }, view = { W, H, vfov: VFOV };
      lastCam = { heading: cam.heading, pitch: cam.pitch };
      lastFocal = AR.focalFor(H, VFOV);
      const objects = o.getObjects(), sun = objects.find((b) => b.kind === 'body' && b.name === 'Sun');
      const F = o.getFilters(), sel = o.getSelected();
      items = []; calloutBox = null;
      const nowMs = (typeof performance !== 'undefined' ? performance : Date).now();
      if (sel !== selTrack.id) { selTrack = { id: sel, t0: nowMs }; cardOpen = false; } // a new pick starts again with the bubble
      const inline = !!(sel && o.getCalloutLines), phase = inline ? AR.calloutPhase(nowMs - selTrack.t0) : { bubble: 0, icon: 1 };
      let selDraw = null;

      // Horizon line and compass points, so you can tell the picture is lined up with the sky.
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.beginPath();
      let pen = false;
      for (let d = -90; d <= 90; d += 5) {
        const p = AR.projectToScreen({ az: heading + d, el: 0 }, cam, view);
        if (p.front && Math.abs(p.y) < 4000 && Math.abs(p.x) < 4000) { if (pen) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); pen = true; } else pen = false;
      }
      ctx.stroke();
      drawCompass(cam, view, W, H, ori.declination);

      // The path of the selected object, as a dashed line, with a dot at each whole hour for the Sun, Moon, planets and stars.
      const path = o.getPath && o.getPath();
      if (path && path.pts.length > 1) {
        const col = path.kind === 'air' ? '#ffb454' : path.kind === 'sat' ? '#5ad1e6' : path.kind === 'met' ? '#d58cff' : '#dbe6ff';
        const proj = path.pts.map((q) => AR.projectToScreen(q, cam, view));
        ctx.save(); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 3;
        ctx.beginPath(); let pen = false;
        proj.forEach((p) => { if (p.front && Math.abs(p.x) < 4000 && Math.abs(p.y) < 4000) { if (pen) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); pen = true; } else pen = false; });
        ctx.stroke(); ctx.setLineDash([]);
        path.pts.forEach((q, i) => { const p = proj[i]; if (q.hr && p.onScreen) { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, 7); ctx.fill(); label('+' + q.hr + 'h', p.x + 7, p.y - 6, col, W, 14); } });
        ctx.restore();
      }

      let selOff = null;
      for (const ob of objects) {
        const air = ob.kind === 'air', sat = ob.kind === 'sat', body = ob.kind === 'body';
        if (!(air && F.air) && !(sat && F.sat && (ob.visible || ob.sunlit)) && !(body && F.sky)) continue;
        if (ob.el < -1) continue;
        const p = AR.projectToScreen(ob, cam, view);
        const isSel = ob.id === sel;
        if (!p.onScreen) { if (isSel) selOff = { ob, p }; continue; }
        const hide = o.getSymbols ? o.getSymbols() === false : false; // the visitor turned the drawn symbols off: the real objects show, only the ring and bubble remain
        if (!hide) { ctx.save(); ctx.translate(p.x, p.y);
        if (air && ob.course === false) { // direction not known: a plain dot
          ctx.fillStyle = '#ffb454'; ctx.beginPath(); ctx.arc(0, 0, isSel ? 7 : 6, 0, 7); ctx.fill();
        } else if (air) {
          const q = ob.az2 != null ? AR.projectToScreen({ az: ob.az2, el: ob.el2 }, cam, view) : null;
          const ang = q && q.front ? Math.atan2(q.y - p.y, q.x - p.x) : -Math.PI / 4;
          ctx.rotate(L.planeRotation(ang)); ctx.fillStyle = '#ffb454'; ctx.font = (isSel ? 34 : 28) + 'px ' + FONT_SYMBOLS;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 4;
          ctx.fillText(L.PLANE_GLYPH, 0, 0);
        } else if (sat) {
          ctx.fillStyle = '#fff'; ctx.font = (isSel ? 32 : 26) + 'px ' + L.SAT_FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          if (ob.visible) { ctx.shadowColor = '#fff'; ctx.shadowBlur = 12; } // a white glow: the eye can see it
          ctx.fillText(L.SAT_GLYPH, 0, 0);
        } else if (ob.name === 'Moon' && root.FarGemsMoon && ob.phase != null) {
          // The Moon as it looks tonight: lit on the side toward the Sun, with the right amount lit, turned as it is in the sky.
          const limb = sun ? AR.directionOnScreen(ob, sun, cam) : -Math.PI / 2;
          const lat = o.getLatitude ? o.getLatitude() : null;
          const tilt = lat == null ? 0 : -AR.parallacticAngle(ob.az, ob.el, lat) * Math.PI / 180;
          ctx.shadowBlur = 0;
          root.FarGemsMoon.draw(ctx, 0, 0, 16, ob.phase, limb, tilt);
        } else {
          const big = ob.name === 'Sun' || ob.name === 'Moon';
          ctx.fillStyle = ob.color || '#ffd86b'; ctx.shadowColor = ob.color || '#ffd86b'; ctx.shadowBlur = 10;
          ctx.beginPath(); ctx.arc(0, 0, big ? 11 : 7, 0, 7); ctx.fill();
        }
        ctx.restore(); }
        if (isSel) { // a ring of dots marks the picked object and stays when its icon has gone
          ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.setLineDash([0.1, 6]); ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 3;
          ctx.beginPath(); ctx.arc(p.x, p.y, AR.RING_R, 0, 7); ctx.stroke(); ctx.restore();
          if (inline) selDraw = { ob, p };
        }
        if (!hide && (F.labels || isSel) && !(isSel && inline)) { const gap = ob.name === 'Moon' ? 24 : 18; label(ob.name, p.x + gap, Math.max(14, Math.min(H - 14, p.y - 14)), air ? '#ffd9a0' : '#fff', W, 2 * gap); }
        items.push({ id: ob.id, x: p.x, y: p.y, r: 30 });
      }

      // The crosshair picks what it is held on, without a tap (not while the picture is being lined up by hand).
      if (aligning) { aimSt = { id: null, since: 0, done: false }; aimProgress = 0; }
      else {
        const aim = AR.aimStep(aimSt, AR.aimTarget(items, W, H), (typeof performance !== 'undefined' ? performance : Date).now(), sel);
        aimSt = aim.st; aimProgress = aim.progress;
        if (aim.select) o.onSelect(aim.select);
      }

      if (selDraw) { // the picked object is in the picture: its details beside it
        const lines = o.getCalloutLines(selDraw.ob) || [];
        if (lines.length && phase.bubble > 0) drawCallout(selDraw.ob, selDraw.p, lines, phase.bubble, W, H);
      }
      showCard(cardOpen || !selDraw);

      if (selOff) { // the selected object is outside the picture: point toward it from the edge
        const e = AR.edgeIndicator(selOff.p.xc, selOff.p.yc, W, H, 30);
        ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.angle); ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-10, 11); ctx.lineTo(-5, 0); ctx.lineTo(-10, -11); ctx.closePath(); ctx.stroke(); ctx.fill(); ctx.restore();
        const lx = Math.min(W - 90, Math.max(10, e.x - 40)), ly = Math.min(H - 20, Math.max(40, e.y + (e.y < H / 2 ? 24 : -24)));
        label(selOff.ob.name, lx, ly, '#fff');
      }

      // Where the phone is pointing, and a warning when there is no compass to line the picture up.
      label(`${L.dir16(heading)} ${Math.round(heading)}° · ${Math.round(pose.pitch)}° up`, 14, topInset + 62, '#cfe'); // under the app name, below the notch
      if (!knowsHeading) label('No compass reading: directions may be off', 14, topInset + 82, '#ffb4a8');
    }

    // Line-up mode: dragging moves the picture's overlay, so the Moon or Sun drawn here can be put on the real one. The
    // difference is kept as a few degrees added to the compass reading (and to the radar), because a phone compass can be off.
    let drag = null;
    o.canvas.addEventListener('pointerdown', (e) => { if (aligning) drag = { x: e.clientX, y: e.clientY }; });
    o.canvas.addEventListener('pointermove', (e) => {
      if (!aligning || !drag || !o.onOffset) return;
      const next = AR.dragOffset(o.getOffset ? o.getOffset() : null, e.clientX - drag.x, e.clientY - drag.y, lastFocal);
      drag = { x: e.clientX, y: e.clientY };
      o.onOffset(next);
    });
    o.canvas.addEventListener('pointercancel', () => { drag = null; });

    // One tap: the phone is aimed at the real Sun, Moon or a bright planet; the correction becomes the difference.
    // Returns { ok: true, name, off } or { ok: false, why: 'none' | 'far' }.
    function snap() {
      if (!lastCam || !o.onOffset) return { ok: false, why: 'none' };
      const t = AR.snapTarget(o.getObjects(), lastCam);
      if (!t) return { ok: false, why: 'none' };
      const next = AR.snapOffset(o.getOffset ? o.getOffset() : null, lastCam, t);
      if (!next) return { ok: false, why: 'far', name: t.name };
      o.onOffset(next); heading = null; // the heading follows the new correction at once
      return { ok: true, name: t.name, off: next };
    }

    // The picture and the overlay as one image (PNG), the way they look on screen.
    function capture() {
      const cw = o.canvas.width, ch = o.canvas.height;
      const out = document.createElement('canvas'); out.width = cw; out.height = ch;
      const c = out.getContext('2d');
      const vw = o.video.videoWidth, vh = o.video.videoHeight;
      if (vw && vh) { const k = AR.coverCrop(vw, vh, cw, ch); c.drawImage(o.video, k.sx, k.sy, k.sw, k.sh, 0, 0, cw, ch); }
      else { c.fillStyle = '#000'; c.fillRect(0, 0, cw, ch); }
      c.drawImage(o.canvas, 0, 0);
      const px = Math.max(12, Math.round(cw / 32)); // a small caption in the corner: the time (the name is at the top, from the overlay)
      c.font = '600 ' + px + 'px system-ui, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'bottom';
      const caption = new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
      c.lineWidth = Math.max(2, px / 5); c.strokeStyle = 'rgba(0,0,0,.7)'; c.strokeText(caption, px, ch - px);
      c.fillStyle = '#fff'; c.fillText(caption, px, ch - px);
      return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('could not make the picture'))), 'image/png'));
    }

    function onTap(e) {
      if (aligning) { drag = null; return; } // dragging, not choosing
      const r = o.canvas.getBoundingClientRect(), cx = e.clientX - r.left, cy = e.clientY - r.top;
      if (calloutBox && cx >= calloutBox.x && cx <= calloutBox.x + calloutBox.w && cy >= calloutBox.y && cy <= calloutBox.y + calloutBox.h) { cardOpen = !cardOpen; return; } // the bubble: more details
      const hit = AR.pickNearest(items, cx, cy);
      o.onSelect(hit ? hit.id : null);
    }
    o.canvas.addEventListener('pointerup', onTap);
    o.closeBtn.addEventListener('click', () => { close(); if (o.onClose) o.onClose(); });

    let pending = null; // a start that is still waiting for the camera, shared by simultaneous callers
    function open() {
      if (isOpen) return Promise.resolve();
      if (!pending) {
        pending = openCamera().then(() => {
          isOpen = true; heading = null; selTrack = { id: null, t0: 0 }; cardOpen = false; calloutBox = null; cardShown = null; if (o.root.classList) o.root.classList.add('ar-card'); aimSt = { id: null, since: 0, done: false }; aimProgress = 0; o.root.hidden = false; document.body.classList.add('ar-on'); measureInset();
          raf = requestAnimationFrame(drawFrame);
        }).finally(() => { pending = null; });
      }
      return pending;
    }
    function close() {
      if (!isOpen) return;
      isOpen = false; aligning = false; cancelAnimationFrame(raf); stopCamera(); o.root.hidden = true; document.body.classList.remove('ar-on');
    }
    return { open, close, isOpen: () => isOpen, capture, callout: () => (calloutBox ? { ...calloutBox } : null), item: (id) => { const it = items.find((q) => q.id === id); return it ? { x: it.x, y: it.y } : null; }, cardShown: () => !!cardShown, resetHeading: () => { heading = null; }, setAligning: (on) => { aligning = !!on; drag = null; }, isAligning: () => aligning, snap };
  }

  root.FarGemsARView = { create };
})(typeof self !== 'undefined' ? self : globalThis);
