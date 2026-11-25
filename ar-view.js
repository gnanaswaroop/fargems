/* FarGems AR view: the camera picture with sky objects drawn over it.
 * It owns the camera stream, the overlay canvas and tap handling. Everything it needs from the app is
 * passed to create(), so it does not depend on app.js internals. The maths lives in lib/ar.js.
 *
 * create({ root, video, canvas, closeBtn, getObjects, getFilters, getSelected, getOrientation, onSelect, onClose })
 *   getObjects()     -> [{ id, kind, name, az, el, az2?, el2?, color?, visible?, sunlit?, name }]
 *   getFilters()     -> layer switches { air, sat, sky, labels }
 *   getSelected()    -> id of the selected object, or null
 *   getOrientation() -> { alpha, beta, gamma, compassHeading, absolute }
 * Returns { open(), close(), isOpen() }. open() rejects with an Error whose .code is 'unsupported', 'denied' or 'failed'. */
(function (root) {
  'use strict';
  const AR = root.FarGemsAR, L = root.FarGemsLogic;
  const VFOV = 63; // typical phone camera, vertical field of view in portrait

  function create(o) {
    let isOpen = false, stream = null, raf = 0, heading = null, items = [];
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
      heading = AR.smoothHeading(heading, AR.chooseHeading(ori.compassHeading, pose.heading), 0.25);
      const cam = { heading, pitch: pose.pitch }, view = { W, H, vfov: VFOV };
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
      for (const ob of o.getObjects()) {
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
        } else {
          const big = ob.name === 'Sun' || ob.name === 'Moon';
          ctx.fillStyle = ob.color || '#ffd86b'; ctx.shadowColor = ob.color || '#ffd86b'; ctx.shadowBlur = 10;
          ctx.beginPath(); ctx.arc(0, 0, big ? 11 : 7, 0, 7); ctx.fill();
        }
        ctx.restore();
        if (isSel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, 24, 0, 7); ctx.stroke(); }
        if (F.labels || isSel) label(ob.name, p.x + 18, p.y - 14, air ? '#ffd9a0' : '#fff');
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

    function onTap(e) {
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
      isOpen = false; cancelAnimationFrame(raf); stopCamera(); o.root.hidden = true; document.body.classList.remove('ar-on');
    }
    return { open, close, isOpen: () => isOpen };
  }

  root.FarGemsARView = { create };
})(typeof self !== 'undefined' ? self : globalThis);
