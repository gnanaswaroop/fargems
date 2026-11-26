/* FarGems AR view: the camera picture with sky objects drawn over it.
 * It owns the camera stream, the overlay canvas and tap handling. Everything it needs from the app is
 * passed to create(), so it does not depend on app.js internals. The maths lives in lib/ar.js.
 *
 * create({ root, video, canvas, closeBtn, getObjects, getFilters, getSelected, getOrientation, onSelect, onClose,
 *         getOffset?, onOffset?, getLatitude? })
 *   getObjects()     -> [{ id, kind, name, az, el, az2?, el2?, color?, visible?, sunlit?, name }]
 *   getFilters()     -> layer switches { air, sat, sky, labels }
 *   getSelected()    -> id of the selected object, or null
 *   getOrientation() -> { alpha, beta, gamma, compassHeading, absolute }
 *   getOffset()      -> { h, p } degrees the visitor added to the heading and pitch to line the picture up (optional)
 *   onOffset(off)    -> called while the visitor drags the picture in line-up mode (optional)
 *   getLatitude()    -> the visitor's latitude, to turn the Moon's face the way it is turned in the sky (optional)
 * Returns { open(), close(), isOpen(), capture(), setAligning(on), isAligning() }. open() rejects with an Error whose .code is 'unsupported', 'denied' or 'failed'. */
(function (root) {
  'use strict';
  const AR = root.FarGemsAR, L = root.FarGemsLogic;
  const VFOV = 63; // typical phone camera, vertical field of view in portrait

  function create(o) {
    let isOpen = false, stream = null, raf = 0, heading = null, items = [], aligning = false, lastFocal = 1000;
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

    function label(text, x, y, color) {
      ctx.font = '600 13px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.strokeText(text, x, y);
      ctx.fillStyle = color || '#fff'; ctx.fillText(text, x, y);
    }

    function drawFrame() {
      raf = requestAnimationFrame(drawFrame);
      const { W, H } = fitCanvas();
      ctx.clearRect(0, 0, W, H);
      const ori = o.getOrientation() || {};
      const knowsHeading = typeof ori.compassHeading === 'number' || (ori.absolute && ori.alpha != null);
      if (ori.beta == null) { label('Move the phone to start the sensors', 16, H / 2, '#fff'); return; }
      const pose = AR.cameraPose(ori.alpha, ori.beta, ori.gamma);
      // The compass reads magnetic north and the sky is laid out from true north, so add the declination.
      const off = AR.clampOffset(o.getOffset ? o.getOffset() : null); // the visitor's hand adjustment, for a compass that is a few degrees off
      const trueHead = ((AR.chooseHeading(ori.compassHeading, pose.heading) + (ori.declination || 0) + off.h) % 360 + 360) % 360;
      heading = AR.smoothHeading(heading, trueHead, 0.25);
      const cam = { heading, pitch: pose.pitch + off.p }, view = { W, H, vfov: VFOV };
      lastFocal = AR.focalFor(H, VFOV);
      const objects = o.getObjects(), sun = objects.find((b) => b.kind === 'body' && b.name === 'Sun');
      const F = o.getFilters(), sel = o.getSelected();
      items = [];

      // Horizon line and compass points, so you can tell the picture is lined up with the sky.
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.beginPath();
      let pen = false;
      for (let d = -90; d <= 90; d += 5) {
        const p = AR.projectToScreen({ az: heading + d, el: 0 }, cam, view);
        if (p.front && Math.abs(p.y) < 4000 && Math.abs(p.x) < 4000) { if (pen) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); pen = true; } else pen = false;
      }
      ctx.stroke();
      for (const [name, az] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]]) {
        const p = AR.projectToScreen({ az, el: 0 }, cam, view);
        if (p.onScreen) { ctx.font = '700 16px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillStyle = '#ffb4a8'; ctx.fillText(name, p.x, p.y - 4); }
      }

      let selOff = null;
      for (const ob of objects) {
        const air = ob.kind === 'air', sat = ob.kind === 'sat', body = ob.kind === 'body';
        if (!(air && F.air) && !(sat && F.sat && (ob.visible || ob.sunlit)) && !(body && F.sky)) continue;
        if (ob.el < -1) continue;
        const p = AR.projectToScreen(ob, cam, view);
        const isSel = ob.id === sel;
        if (!p.onScreen) { if (isSel) selOff = { ob, p }; continue; }
        ctx.save(); ctx.translate(p.x, p.y);
        if (air) {
          const q = ob.az2 != null ? AR.projectToScreen({ az: ob.az2, el: ob.el2 }, cam, view) : null;
          const ang = q && q.front ? Math.atan2(q.y - p.y, q.x - p.x) : -Math.PI / 4;
          ctx.rotate(L.planeRotation(ang)); ctx.fillStyle = '#ffb454'; ctx.font = (isSel ? 34 : 28) + 'px ' + FONT_SYMBOLS;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 4;
          ctx.fillText(L.PLANE_GLYPH, 0, 0);
        } else if (sat) {
          ctx.fillStyle = ob.visible ? '#fff' : '#5ad1e6'; const r = isSel ? 8 : 6;
          ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0); ctx.closePath(); ctx.fill();
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
        ctx.restore();
        if (isSel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, 24, 0, 7); ctx.stroke(); }
        if (F.labels || isSel) label(ob.name, p.x + (ob.name === 'Moon' ? 24 : 18), p.y - 14, air ? '#ffd9a0' : '#fff');
        items.push({ id: ob.id, x: p.x, y: p.y, r: 30 });
      }

      if (selOff) { // the selected object is outside the picture: point toward it from the edge
        const e = AR.edgeIndicator(selOff.p.xc, selOff.p.yc, W, H, 30);
        ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.angle); ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-10, 11); ctx.lineTo(-5, 0); ctx.lineTo(-10, -11); ctx.closePath(); ctx.stroke(); ctx.fill(); ctx.restore();
        const lx = Math.min(W - 90, Math.max(10, e.x - 40)), ly = Math.min(H - 20, Math.max(40, e.y + (e.y < H / 2 ? 24 : -24)));
        label(selOff.ob.name, lx, ly, '#fff');
      }

      // Where the phone is pointing, and a warning when there is no compass to line the picture up.
      label(`${L.dir16(heading)} ${Math.round(heading)}° · ${Math.round(pose.pitch)}° up`, 12, 22, '#cfe');
      if (!knowsHeading) label('No compass reading: directions may be off', 12, 42, '#ffb4a8');
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

    // The picture and the overlay as one image (PNG), the way they look on screen.
    function capture() {
      const cw = o.canvas.width, ch = o.canvas.height;
      const out = document.createElement('canvas'); out.width = cw; out.height = ch;
      const c = out.getContext('2d');
      const vw = o.video.videoWidth, vh = o.video.videoHeight;
      if (vw && vh) { const k = AR.coverCrop(vw, vh, cw, ch); c.drawImage(o.video, k.sx, k.sy, k.sw, k.sh, 0, 0, cw, ch); }
      else { c.fillStyle = '#000'; c.fillRect(0, 0, cw, ch); }
      c.drawImage(o.canvas, 0, 0);
      const px = Math.max(12, Math.round(cw / 32)); // a small caption in the corner: the name and the time
      c.font = '600 ' + px + 'px system-ui, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'bottom';
      const caption = 'FarGems · ' + new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
      c.lineWidth = Math.max(2, px / 5); c.strokeStyle = 'rgba(0,0,0,.7)'; c.strokeText(caption, px, ch - px);
      c.fillStyle = '#fff'; c.fillText(caption, px, ch - px);
      return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('could not make the picture'))), 'image/png'));
    }

    function onTap(e) {
      if (aligning) { drag = null; return; } // dragging, not choosing
      const r = o.canvas.getBoundingClientRect();
      const hit = AR.pickNearest(items, e.clientX - r.left, e.clientY - r.top);
      o.onSelect(hit ? hit.id : null);
    }
    o.canvas.addEventListener('pointerup', onTap);
    o.closeBtn.addEventListener('click', () => { close(); if (o.onClose) o.onClose(); });

    let pending = null; // a start that is still waiting for the camera, shared by simultaneous callers
    function open() {
      if (isOpen) return Promise.resolve();
      if (!pending) {
        pending = openCamera().then(() => {
          isOpen = true; heading = null; o.root.hidden = false; document.body.classList.add('ar-on');
          raf = requestAnimationFrame(drawFrame);
        }).finally(() => { pending = null; });
      }
      return pending;
    }
    function close() {
      if (!isOpen) return;
      isOpen = false; aligning = false; cancelAnimationFrame(raf); stopCamera(); o.root.hidden = true; document.body.classList.remove('ar-on');
    }
    return { open, close, isOpen: () => isOpen, capture, setAligning: (on) => { aligning = !!on; drag = null; }, isAligning: () => aligning };
  }

  root.FarGemsARView = { create };
})(typeof self !== 'undefined' ? self : globalThis);
