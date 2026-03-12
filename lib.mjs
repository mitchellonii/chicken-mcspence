// ============================================================
//  gamelib.js  –  Launcher Game Library
//  Extends the base canvas/asset/character/game helpers with:
//    • SceneManager  (pregame → game → cutscene → eod → upgrades)
//    • Cutscene      (scripted text+asset sequences)
//    • UIOverlay     (menus, buttons, stat panels drawn to canvas)
//    • ProgressTracker (milestone detection + callbacks)
//    • Upgrades      (persistent upgrade store)
// ============================================================

// ─────────────────────────────────────────────
//  Internal shared refs (same pattern as before)
// ─────────────────────────────────────────────
const refs = {
  canvas: null,
  assets: [],
  game: null,
};

export function registerCanvas(c) {
  refs.canvas = c;
  try { _setupCanvasPointerHandlers(); } catch (e) { /* setup will run when defined */ }
  try { _installDebugDrawHooks(c); } catch (e) { /* ignore */ }
}
export function registerGame(game) { refs.game = game; }
export function getCanvas() { return refs.canvas; }
export function getAssetImage(id) { return refs.assets.find(a => a.id === id)?.img ?? null; }

// Debug toggle: when enabled, outlines are drawn around rendered assets.
export let DEV_DRAW_HITBOXES = false;
export function setDevDrawHitboxes(enabled = false) {
  DEV_DRAW_HITBOXES = !!enabled;
  if (typeof window !== 'undefined') {
    try { window.DEV_DRAW_HITBOXES = DEV_DRAW_HITBOXES; } catch (e) { /* ignore */ }
  }
  return DEV_DRAW_HITBOXES;
}
if (typeof window !== 'undefined') {
  try { window.DEV_DRAW_HITBOXES = DEV_DRAW_HITBOXES; } catch (e) { /* ignore readonly window in some envs */ }
}

function _isDevHitboxEnabled() {
  if (typeof window !== 'undefined' && typeof window.DEV_DRAW_HITBOXES === 'boolean') {
    return !!window.DEV_DRAW_HITBOXES;
  }
  return !!DEV_DRAW_HITBOXES;
}

function _installDebugDrawHooks(canvas) {
  if (!canvas || typeof canvas.getContext !== 'function') return;
  const ctx = canvas.getContext('2d');
  if (!ctx || ctx.__devDrawHookInstalled) return;

  const originalDrawImage = ctx.drawImage.bind(ctx);
  ctx.drawImage = function patchedDrawImage(...args) {
    originalDrawImage(...args);
    if (!_isDevHitboxEnabled()) return;

    let x = 0, y = 0, w = 0, h = 0;
    if (args.length === 3) {
      const img = args[0];
      x = Number(args[1]);
      y = Number(args[2]);
      w = Number(img?.width ?? 0);
      h = Number(img?.height ?? 0);
    } else if (args.length === 5) {
      x = Number(args[1]);
      y = Number(args[2]);
      w = Number(args[3]);
      h = Number(args[4]);
    } else if (args.length >= 9) {
      x = Number(args[5]);
      y = Number(args[6]);
      w = Number(args[7]);
      h = Number(args[8]);
    }

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;

    this.save();
    this.strokeStyle = 'rgba(255, 0, 80, 0.95)';
    this.lineWidth = Math.max(1, sUi(1));
    this.strokeRect(x, y, w, h);
    this.restore();
  };

  ctx.__devDrawHookInstalled = true;
}

// Global UI scale to allow easy runtime scaling of UI elements.
// Exported for module imports and mirrored on `window` for legacy scripts.
export let UI_SCALE = 2;
if (typeof window !== 'undefined') {
  try { window.UI_SCALE = UI_SCALE; } catch (e) { /* ignore readonly window in some envs */ }
}

export function setUIScale(scale = 2) {
  const s = Number(scale);
  UI_SCALE = s >= 3 ? 3 : (s >= 2 ? 2 : 1);
  if (typeof window !== 'undefined') {
    try { window.UI_SCALE = UI_SCALE; } catch (e) { /* ignore */ }
  }
  return UI_SCALE;
}

// Helpers for scaled UI measurements and fonts (use for any non-canvas-relative sizes)
export function sUi(n) { return Math.max(0, Math.round((n || 0) * UI_SCALE)); }
export function scaledFont(size, weight = '') { const sz = Math.max(10, Math.round((size || 12) * UI_SCALE)); return `${weight ? weight + ' ' : ''}${sz}px sans-serif`; }
export function scaledFontFamily(size, weight = '', family = 'sans-serif') { const sz = Math.max(10, Math.round((size || 12) * UI_SCALE)); return `${weight ? weight + ' ' : ''}${sz}px ${family}`; }

function _cssFontFamily(family, fallback = 'sans-serif') {
  const raw = String(family || '').trim() || fallback;
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) return raw;
  return /\s/.test(raw) ? `"${raw.replace(/"/g, '\\"')}"` : raw;
}

function _resolveUIFontFamily(fonts, role = 'regular', fallback = 'sans-serif') {
  if (typeof fonts === 'string') return _cssFontFamily(fonts, fallback);
  const f = (fonts && typeof fonts === 'object') ? fonts : {};
  const family =
    f[role]
    ?? ((role === 'button') ? (f.bold ?? f.regular) : null)
    ?? ((role === 'mono') ? (f.mono ?? f.regular) : null)
    ?? f.family
    ?? ((role === 'mono') ? 'monospace' : fallback);
  return _cssFontFamily(family, fallback);
}

function _scaledUIFont(size, {
  fonts,
  role = 'regular',
  weight = '',
  fallbackFamily = 'sans-serif',
} = {}) {
  const family = _resolveUIFontFamily(fonts, role, fallbackFamily);
  return scaledFontFamily(size, weight, family);
}

function _resolveUIColor(colors, role = 'text', fallback = '#fff') {
  if (typeof colors === 'string') return colors;
  const c = (colors && typeof colors === 'object') ? colors : {};
  return c[role] ?? c.text ?? c.default ?? fallback;
}

// Centralized coin economy calculator. Tune values here to rebalance rewards quickly.
// `catagory` spelling is intentional to match external call sites.
export function calculateAwardCoinsAmount(inputValue, catagory = '') {
  const value = Math.max(0, Number(inputValue) || 0);
  const key = String(catagory || '').toLowerCase().replace(/[^a-z]/g, '');

  switch (key) {
    case 'distance':
      return Math.max(0, Math.round(value / 30));
    case 'altitude':
      return Math.max(0, Math.round(value / 50));
    case 'speed':
      return Math.max(0, Math.round(value * 1.5));
    case 'impact':
      return Math.max(0, Math.round(value / 4));
    case 'duration':
      return Math.max(0, Math.round(value / 3));
    // input is impact ratio, e.g. `impact / breakImpact`
    case 'landmarkimpact':
      return Math.max(1, Math.round(value * 40));
    default:
      return Math.max(0, Math.round(value));
  }
}

export async function clearAssetCache() {
  const cacheName = 'game-assets-v1';
  if (typeof caches === 'undefined') return false;
  try {
    return await caches.delete(cacheName);
  } catch (e) {
    console.error('clearAssetCache error', e);
    return false;
  }
}

// Scene entity and animation helpers
refs.sceneEntities = refs.sceneEntities || Object.create(null);
refs.activeScene = refs.activeScene || null;
refs._canvasListenersAdded = refs._canvasListenersAdded || false;

export class AnimatedSprite {
  constructor({ frames = [], frameRate = 8, loop = true } = {}) {
    // frames may be an array (single anonymous animation) or an object mapping names to animations
    this.animations = Object.create(null);
    this.currentAnim = null;
    this.frameIndex = 0;
    this._acc = 0; // ms accumulator
    this.playing = true;
    this.onEnd = null;
    // if frames is an object of named animations: { idle: { frames: [...], frameRate, loop }, ... }
    if (frames && typeof frames === 'object' && !Array.isArray(frames)) {
      for (const k of Object.keys(frames)) {
        const v = frames[k] || {};
        const f = Array.isArray(v.frames) ? v.frames.slice() : [];
        const fr = v.frameRate || frameRate;
        const lp = v.loop == null ? !!loop : !!v.loop;
        this.addAnimation(k, f, fr, lp);
      }
      const first = Object.keys(this.animations)[0];
      if (first) this.changeAnimation(first, true);
    } else if (Array.isArray(frames)) {
      this.addAnimation('main', frames.slice(), frameRate, !!loop);
      this.changeAnimation('main', true);
    }
  }
  // add a named animation
  addAnimation(name, frames, frameRate = 8, loop = true) {
    if (!name || !Array.isArray(frames)) return;
    this.animations[name] = { frames: frames.slice(), frameRate: frameRate || 8, loop: !!loop };
  }
  // change currently playing named animation
  changeAnimation(name, reset = true) {
    const anim = this.animations[name];
    if (!anim) return;
    this.currentAnim = name;
    this.frames = anim.frames.slice();
    this.frameRate = anim.frameRate;
    this.loop = !!anim.loop;
    if (reset) { this.frameIndex = 0; this._acc = 0; }
    this.playing = true;
  }
  // legacy convenience: play raw frames (anonymous)
  play(frames, frameRate = 8, loop = true, reset = true) {
    if (!Array.isArray(frames)) return;
    this.addAnimation('main', frames.slice(), frameRate, loop);
    this.changeAnimation('main', reset);
  }
  stop() { this.playing = false; }
  resume() { if (this.frames.length) this.playing = true; }
  goto(frameIdx) { this.frameIndex = Math.max(0, Math.min((this.frames.length - 1) || 0, frameIdx)); }
  update(dt) {
    if (!this.playing || this.frames.length <= 1) return;
    const ms = (typeof dt === 'number') ? dt : (1000 / 60);
    this._acc += ms;
    const frameTime = 1000 / Math.max(1, this.frameRate);
    if (this._acc >= frameTime) {
      const steps = Math.floor(this._acc / frameTime);
      this._acc -= steps * frameTime;
      this.frameIndex += steps;
      if (this.frameIndex >= this.frames.length) {
        if (this.loop) {
          this.frameIndex %= this.frames.length;
        } else {
          this.frameIndex = this.frames.length - 1;
          this.playing = false;
          if (typeof this.onEnd === 'function') {
            try { this.onEnd(); } catch (e) { console.error(e); }
          }
        }
      }
    }
  }
  draw(ctx, x, y, scale = 1) {
    const id = this.frames[this.frameIndex];
    if (!id) return;
    const img = getAssetImage(id);
    if (!img) return;
    const eff = (scale || 1) * UI_SCALE;
    ctx.drawImage(img, x, y, img.width * eff, img.height * eff);
  }
  getFrameId() { return this.frames[this.frameIndex]; }
}

export class SceneEntity {
  constructor({ x = 0, y = 0, layer = 0, interactive = false, hitBox = null, update = null, draw = null } = {}) {
    this.x = x; this.y = y; this.layer = layer; this.interactive = interactive; this.hitBox = hitBox; this.updateFn = update; this.drawFn = draw; this._visible = true;
  }
  update(dt) { if (typeof this.updateFn === 'function') this.updateFn(this, dt); }
  draw(ctx) { if (typeof this.drawFn === 'function') this.drawFn(this, ctx); }
  contains(px, py) {
    if (!this.hitBox) return false;
    const { x = 0, y = 0, w = 0, h = 0 } = this.hitBox;
    return px >= this.x + x && px <= this.x + x + w && py >= this.y + y && py <= this.y + y + h;
  }
  setVisible(v) { this._visible = !!v; }
}

export function addSceneEntity(sceneName, entity) {
  refs.sceneEntities[sceneName] = refs.sceneEntities[sceneName] || [];
  refs.sceneEntities[sceneName].push(entity);
}

export function removeSceneEntity(sceneName, entity) {
  const arr = refs.sceneEntities[sceneName] || [];
  const idx = arr.indexOf(entity);
  if (idx >= 0) arr.splice(idx, 1);
}

export function getSceneEntities(sceneName) {
  return (refs.sceneEntities[sceneName] || []).slice();
}

export function processSceneEntities(sceneName, ctx, dt) {
  const arr = refs.sceneEntities[sceneName] || [];
  arr.sort((a, b) => (a.layer || 0) - (b.layer || 0));
  for (const e of arr) {
    if (e._visible === false) continue;
    try { e.update(dt); } catch (err) { console.error('entity update error', err); }
    try { e.draw(ctx); } catch (err) { console.error('entity draw error', err); }
  }
}

export function setActiveScene(name) { refs.activeScene = name; }
export function getActiveScene() { return refs.activeScene; }

function _setupCanvasPointerHandlers() {
  const c = refs.canvas;
  if (!c || refs._canvasListenersAdded) return;
  refs._canvasListenersAdded = true;

  const toCanvas = (ev) => {
    const rect = c.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * (c.width / rect.width);
    const y = (ev.clientY - rect.top) * (c.height / rect.height);
    return { x, y };
  };

  const dispatch = (type, ev) => {
    const pos = toCanvas(ev);
    const scene = refs.activeScene;
    let scenesToCheck = [];
    if (scene) scenesToCheck.push(scene);
    else scenesToCheck = Object.keys(refs.sceneEntities || {});

    for (const sc of scenesToCheck) {
      const arr = refs.sceneEntities[sc] || [];
      // hit-test topmost first
      for (let i = arr.length - 1; i >= 0; i--) {
        const ent = arr[i];
        if (!ent.interactive) continue;
        if (typeof ent.contains === 'function' && ent.contains(pos.x, pos.y)) {
          const handler = ent[`onPointer${type}`];
          if (typeof handler === 'function') {
            try { handler({ x: pos.x, y: pos.y, event: ev, entity: ent }); } catch (err) { console.error('pointer handler error', err); }
          }
          // stop at first hit across scenes
          return;
        }
      }
    }
  };

  c.addEventListener('pointerdown', (e) => dispatch('Down', e));
  c.addEventListener('pointermove', (e) => dispatch('Move', e));
  c.addEventListener('pointerup', (e) => dispatch('Up', e));
}

// ensure pointer handlers are attached when canvas is registered
// (setup is invoked from the original registerCanvas implementation)

export function preloadAssets() {
  return new Promise((resolve, reject) => {
    fetch('/assets.json')
      .then(r => r.json())
      .then(assets => {
        let loaded = 0;
        const total = assets.length;
        let loadedBytes = 0;
        let totalBytes = 0;

        const drawLoading = () => {
          const canvas = refs.canvas;
          if (!canvas) return;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          ctx.save();
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#0b1022';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#e6f2ff';
          ctx.font = scaledFont(18, 'bold');
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          if (totalBytes > 0) {
            const kbLoaded = (loadedBytes / 1024).toFixed(1);
            const kbTotal = (totalBytes / 1024).toFixed(1);
            ctx.fillText(`loaded ${loaded}/${total} — ${kbLoaded} KB / ${kbTotal} KB`, canvas.width / 2, canvas.height / 2);
          } else {
            ctx.fillText(`loaded ${loaded}/${total}`, canvas.width / 2, canvas.height / 2);
          }
          ctx.restore();
        };

        if (total === 0) {
          drawLoading();
          resolve();
          return;
        }

        refs.soundEvents = refs.soundEvents || Object.create(null);

        // First, try to HEAD each asset to get content-length
        const headerPromises = assets.map(asset => fetch(asset.src, { method: 'HEAD' }).then(r => {
          const len = r.headers.get('content-length');
          asset._bytes = len ? parseInt(len, 10) : 0;
        }).catch(() => { asset._bytes = 0; }));

        Promise.all(headerPromises).then(async () => {
          totalBytes = assets.reduce((s, a) => s + (a._bytes || 0), 0);
          drawLoading();
          const cacheName = 'game-assets-v1';
          const cache = (typeof caches !== 'undefined') ? await caches.open(cacheName).catch(() => null) : null;

          for (const asset of assets) {
            const isAudioExt = (/(mp3|wav|ogg|m4a|aac)$/i).test(asset.src);
            const isVideoExt = (/(mp4|webm|ogv|mov|m4v)$/i).test(asset.src);
            const isFontExt = (/(ttf|otf|woff2?|eot)$/i).test(asset.src);
            const inferredType = (asset.type || '').toLowerCase() || (isAudioExt ? 'audio' : (isVideoExt ? 'video' : (isFontExt ? 'font' : 'image')));
            const entry = { id: asset.id, img: null, audio: null, video: null, videoSrc: null, font: null, fontFamily: (asset.family || asset.id), type: inferredType };
            refs.assets.push(entry);

            if (asset.event && typeof asset.event === 'string') refs.soundEvents[asset.event] = asset.id;

            // NOTE: we increment `loadedBytes` per-chunk below instead of
            // bumping by asset._bytes here so progress updates as packets arrive.

            // stream the resource so we can update progress per chunk and cache responses
            const fetchWithProgress = async (asset, onChunk) => {
              try {
                let resp = null;
                if (cache) {
                  const cached = await cache.match(asset.src).catch(() => null);
                  if (cached) resp = cached.clone();
                }
                if (!resp) {
                  resp = await fetch(asset.src);
                  if (cache && resp && resp.ok) {
                    // store a copy, don't block on it
                    try { cache.put(asset.src, resp.clone()); } catch (e) { /* ignore */ }
                  }
                }
                const len = resp.headers.get('content-length');
                if (len) asset._bytes = parseInt(len, 10);
                const reader = resp.body && resp.body.getReader();
                if (!reader) {
                  const b = await resp.blob(); onChunk(b.size); return b;
                }
                const chunks = [];
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  chunks.push(value);
                  const chunkLen = value.length || value.byteLength || 0;
                  onChunk(chunkLen);
                }
                return new Blob(chunks);
              } catch (err) {
                throw err;
              }
            };

            fetchWithProgress(asset, (chunkLen) => {
              loadedBytes += chunkLen;
              drawLoading();
            }).then(blob => {
              const url = URL.createObjectURL(blob);
              if (inferredType === 'audio') {
                const a = new Audio();
                a.preload = 'auto';
                a.src = url;
                a.loop = !!asset.loop;
                a.crossOrigin = 'anonymous';
                const onLoaded = () => {
                  entry.audio = a;
                  loaded += 1;
                  drawLoading();
                  if (loaded === total) resolve();
                };
                a.addEventListener('canplaythrough', onLoaded, { once: true });
                a.addEventListener('error', () => { console.error(`Failed to load audio asset "${asset.id}"`); entry.audio = null; onLoaded(); }, { once: true });
              } else if (inferredType === 'video') {
                const v = document.createElement('video');
                v.preload = 'auto';
                v.src = url;
                v.loop = !!asset.loop;
                v.crossOrigin = 'anonymous';
                v.muted = asset.muted == null ? true : !!asset.muted;
                v.playsInline = true;
                const onLoaded = () => {
                  entry.video = v;
                  entry.videoSrc = url;
                  loaded += 1;
                  drawLoading();
                  if (loaded === total) resolve();
                };
                v.addEventListener('loadeddata', onLoaded, { once: true });
                v.addEventListener('error', () => {
                  console.error(`Failed to load video asset "${asset.id}"`);
                  entry.video = null;
                  entry.videoSrc = null;
                  onLoaded();
                }, { once: true });
                try { v.load(); } catch (e) { /* ignore */ }
              } else if (inferredType === 'font') {
                const family = asset.family || asset.id;
                const descriptors = {};
                if (asset.weight != null) descriptors.weight = String(asset.weight);
                if (asset.style != null) descriptors.style = String(asset.style);
                if (asset.stretch != null) descriptors.stretch = String(asset.stretch);
                if (asset.unicodeRange != null) descriptors.unicodeRange = String(asset.unicodeRange);

                const onLoaded = () => {
                  loaded += 1;
                  drawLoading();
                  if (loaded === total) resolve();
                };

                try {
                  if (typeof FontFace === 'function' && typeof document !== 'undefined' && document.fonts) {
                    const face = new FontFace(family, `url(${url})`, descriptors);
                    face.load().then((loadedFace) => {
                      try { document.fonts.add(loadedFace); } catch (e) { /* ignore */ }
                      entry.font = loadedFace;
                      entry.fontFamily = family;
                      onLoaded();
                    }).catch((err) => {
                      console.error(`Failed to load font asset "${asset.id}"`, err);
                      entry.font = null;
                      onLoaded();
                    });
                  } else {
                    entry.font = null;
                    entry.fontFamily = family;
                    onLoaded();
                  }
                } catch (err) {
                  console.error(`Failed to initialize font asset "${asset.id}"`, err);
                  entry.font = null;
                  onLoaded();
                }
              } else {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                  try {
                    let processed = inCrop(img, asset.inCrop || 0);
                    if (asset.scale) {
                      const scaled = document.createElement('canvas');
                      scaled.width = Math.max(1, Math.round(processed.width * asset.scale));
                      scaled.height = Math.max(1, Math.round(processed.height * asset.scale));
                      const ctx = scaled.getContext('2d');
                      ctx.imageSmoothingEnabled = false;
                      ctx.drawImage(processed, 0, 0, scaled.width, scaled.height);
                      processed = scaled;
                    }
                    entry.img = processed;
                  } catch (e) {
                    console.error('Error processing image', e);
                    entry.img = img;
                  }
                  loaded += 1;
                  drawLoading();
                  if (loaded === total) resolve();
                };
                img.onerror = () => {
                  console.error(`Failed to load image asset "${asset.id}" from blob. Using placeholder.`);
                  const tile = 16;
                  const ph = document.createElement('canvas');
                  ph.width = ph.height = tile * 2;
                  const ctx = ph.getContext('2d');
                  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
                    ctx.fillStyle = (x + y) % 2 === 0 ? '#ff66ff' : '#000000';
                    ctx.fillRect(x * tile, y * tile, tile, tile);
                  }
                  entry.img = asset.scale ? (function () {
                    const scaled = document.createElement('canvas');
                    scaled.width = Math.max(1, Math.round(ph.width * asset.scale));
                    scaled.height = Math.max(1, Math.round(ph.height * asset.scale));
                    const sctx = scaled.getContext('2d');
                    sctx.imageSmoothingEnabled = false;
                    sctx.drawImage(ph, 0, 0, scaled.width, scaled.height);
                    return scaled;
                  })() : ph;
                  loaded += 1;
                  drawLoading();
                  if (loaded === total) resolve();
                };
                img.src = url;
              }
            }).catch(err => {
              console.error(`Failed to fetch asset "${asset.id}" from "${asset.src}"`, err);
              loaded += 1;
              drawLoading();
              if (loaded === total) resolve();
            });
          }
        }).catch(() => {
          // If header fetching failed, fall back to previous behavior without sizes
          drawLoading();
          for (const asset of assets) {
            const isAudioExt = (/(mp3|wav|ogg|m4a|aac)$/i).test(asset.src);
            const isVideoExt = (/(mp4|webm|ogv|mov|m4v)$/i).test(asset.src);
            const isFontExt = (/(ttf|otf|woff2?|eot)$/i).test(asset.src);
            const inferredType = (asset.type || '').toLowerCase() || (isAudioExt ? 'audio' : (isVideoExt ? 'video' : (isFontExt ? 'font' : 'image')));
            const entry = { id: asset.id, img: null, audio: null, video: null, videoSrc: null, font: null, fontFamily: (asset.family || asset.id), type: inferredType };
            refs.assets.push(entry);
            if (asset.event && typeof asset.event === 'string') refs.soundEvents[asset.event] = asset.id;
            const onLoaded = () => {
              loaded += 1;
              drawLoading();
              if (loaded === total) resolve();
            };
            if (inferredType === 'audio') {
              const a = new Audio();
              a.preload = 'auto';
              a.src = asset.src;
              a.loop = !!asset.loop;
              a.crossOrigin = 'anonymous';
              a.addEventListener('canplaythrough', () => { entry.audio = a; onLoaded(); }, { once: true });
              a.addEventListener('error', () => { entry.audio = null; onLoaded(); }, { once: true });
              a.load();
            } else if (inferredType === 'video') {
              const v = document.createElement('video');
              v.preload = 'auto';
              v.src = asset.src;
              v.loop = !!asset.loop;
              v.crossOrigin = 'anonymous';
              v.muted = asset.muted == null ? true : !!asset.muted;
              v.playsInline = true;
              v.addEventListener('loadeddata', () => { entry.video = v; entry.videoSrc = asset.src; onLoaded(); }, { once: true });
              v.addEventListener('error', () => { entry.video = null; entry.videoSrc = null; onLoaded(); }, { once: true });
              try { v.load(); } catch (e) { onLoaded(); }
            } else if (inferredType === 'font') {
              const family = asset.family || asset.id;
              const descriptors = {};
              if (asset.weight != null) descriptors.weight = String(asset.weight);
              if (asset.style != null) descriptors.style = String(asset.style);
              if (asset.stretch != null) descriptors.stretch = String(asset.stretch);
              if (asset.unicodeRange != null) descriptors.unicodeRange = String(asset.unicodeRange);

              try {
                if (typeof FontFace === 'function' && typeof document !== 'undefined' && document.fonts) {
                  const face = new FontFace(family, `url(${asset.src})`, descriptors);
                  face.load().then((loadedFace) => {
                    try { document.fonts.add(loadedFace); } catch (e) { /* ignore */ }
                    entry.font = loadedFace;
                    entry.fontFamily = family;
                    onLoaded();
                  }).catch(() => {
                    entry.font = null;
                    onLoaded();
                  });
                } else {
                  entry.font = null;
                  entry.fontFamily = family;
                  onLoaded();
                }
              } catch (e) {
                entry.font = null;
                onLoaded();
              }
            } else {
              const img = new Image();
              img.crossOrigin = 'anonymous';
              img.onload = () => { entry.img = inCrop(img, asset.inCrop || 0); onLoaded(); };
              img.onerror = () => { const ph = document.createElement('canvas'); ph.width = ph.height = 32; entry.img = ph; onLoaded(); };
              img.src = asset.src;
            }
          }
        });
      })
      .catch(reject);
  });
}

export function drawAsset(id, x, y, scale = 1) {
  const asset = refs.assets.find(a => a.id === id);
  if (!asset) { console.warn(`Asset "${id}" not found.`); return; }
  const ctx = refs.canvas.getContext('2d');
  ctx.drawImage(asset.img, x, y, asset.img.width * scale, asset.img.height * scale);
}

function inCrop(img, crop) {
  const c = document.createElement('canvas');
  c.width = img.width - 2 * crop;
  c.height = img.height - 2 * crop;
  c.getContext('2d').drawImage(img, crop, crop, c.width, c.height, 0, 0, c.width, c.height);
  return c;
}

// ─────────────────────────────────────────────
//  Character (unchanged)
// ─────────────────────────────────────────────
export class Character {
  constructor(name, x, y) {
    this.name = name;
    this.x = x; this.y = y;
    this.dx = 0; this.dy = 0;
    this.animationFrame = 0;
    this.animationState = 'idle';
    this.animationSpeed = 0.25;
    this.spriteIdFormat = 'ANIMATION-FRAME';
    this._prevAnimFrameIdx = 0;
    this._prevAnimState = this.animationState;
  }
  update(dt) {
    const dtSec = typeof dt === 'number' ? dt : (1 / 60);
    const dtScale = dtSec * 60;
    const prevFrameIdx = ~~this.animationFrame;
    const prevState = this.animationState;
    const frames = this.animationState === 'idle' ? 4 : 12;
    const frameAdvance = (this.animationState === 'idle'
      ? 0.25
      : (this.animationSpeed ?? 0.25)) * dtScale;
    this.animationFrame = (this.animationFrame + frameAdvance) % frames;
    const newFrameIdx = ~~this.animationFrame;
    // Play eating sound when reaching frame 3 (trigger only once when crossing)
    if (this.animationState === 'eating' && newFrameIdx === 3 && prevFrameIdx !== 3) {
      try { triggerSoundEvent('eating'); console.log('eating sound') } catch (e) { }
    }
    this.x += this.dx * dtScale; this.y += this.dy * dtScale;
    const damp = Math.pow(0.8, dtScale);
    this.dx *= damp; this.dy *= damp;
    if (Math.abs(this.dx) < 0.01) this.dx = 0;
    if (Math.abs(this.dy) < 0.01) this.dy = 0;
    this._prevAnimFrameIdx = newFrameIdx;
    this._prevAnimState = this.animationState;
  }
  draw() {
    const id = this.spriteIdFormat
      .replace('ANIMATION', this.animationState)
      .replace('FRAME', ~~this.animationFrame);
    const asset = refs.assets.find(a => a.id === id);
    // Get the canvas context, which may be transformed by the caller
    const ctx = refs.canvas.getContext('2d');
    if (ctx && asset?.img) {
      // Draw centered at this.x, this.y
      ctx.drawImage(asset.img, this.x - asset.img.width / 2, this.y - asset.img.height / 2,
        asset.img.width, asset.img.height);
    } else if (asset?.img) {
      // Fallback if ctx is somehow null
      drawAsset(id, this.x, this.y, 1);
    }
  }
  changeAnimation(newState) {
    if (this.animationState !== newState) {
      this.animationState = newState;
      this.animationFrame = 0;
    }
  }
}

// ─────────────────────────────────────────────
//  Game (unchanged core, minor additions)
// ─────────────────────────────────────────────
export class Game {
  constructor() {
    this.characters = [];
    this.camera = { x: 0, y: 0, targetX: 0, targetY: 0, easing: 20, followMainCharacter: false };
    this._loopHandle = null;
    this._paused = false;
  }
  addCharacter(c) { this.characters.push(c); }
  pause() { this._paused = true; }
  resume() { this._paused = false; }
  update(dt) {
    if (this._paused) return;
    const dtSec = typeof dt === 'number' ? dt : (1 / 60);
    const dtScale = dtSec * 60;
    if (this.camera.followMainCharacter) {
      const mc = this.characters[0];
      const worldScale = (typeof window !== 'undefined' && window.UI_SCALE) ? Math.max(1, window.UI_SCALE) : 1;
      this.camera.targetX = mc.x - (refs.canvas.width / worldScale) / 2;
      this.camera.targetY = mc.y - (refs.canvas.height / worldScale) / 2;
    }
    const camLerp = 1 - Math.pow(1 - 1 / this.camera.easing, dtScale);
    this.camera.x += (this.camera.targetX - this.camera.x) * camLerp;
    this.camera.y += (this.camera.targetY - this.camera.y) * camLerp;
    for (const c of this.characters) c.update(dtSec);
  }
  draw() {
    const ctx = refs.canvas.getContext('2d');
    ctx.clearRect(0, 0, refs.canvas.width, refs.canvas.height);
    for (const c of this.characters) {
      ctx.save();
      ctx.translate(-this.camera.x, -this.camera.y);
      c.draw();
      ctx.restore();
    }
  }
  startLoop() {
    const loop = () => {
      this.update();
      this.draw();
      this._loopHandle = setTimeout(loop, 1000 / 60);
    };
    loop();
  }
  stopLoop() {
    clearTimeout(this._loopHandle);
    this._loopHandle = null;
  }
}

// ─────────────────────────────────────────────
//  Input helpers (unchanged)
// ─────────────────────────────────────────────
export function getClickGamePos(evt) {
  const canvas = refs.canvas;
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / rect.width;
  const sy = canvas.height / rect.height;
  const cx = (evt.clientX - rect.left) * sx;
  const cy = (evt.clientY - rect.top) * sy;
  const cam = refs.game?.camera ?? { x: 0, y: 0 };
  return { x: cx + cam.x, y: cy + cam.y };
}

// ─────────────────────────────────────────────
//  Cutscene loader / renderer (JSON-driven)
// ─────────────────────────────────────────────
let _cutsceneJsonCache = null;
async function _loadCutsceneJson() {
  if (_cutsceneJsonCache) return _cutsceneJsonCache;
  try {
    const res = await fetch('/cutscenes.json');
    if (!res.ok) throw new Error('failed to load cutscenes.json');
    _cutsceneJsonCache = await res.json();
  } catch (e) {
    console.warn('Could not load cutscenes.json', e);
    _cutsceneJsonCache = [];
  }
  return _cutsceneJsonCache;
}

export async function loadCutscenes({ getAsset, canvas } = {}) {
  const list = await _loadCutsceneJson();
  const map = Object.create(null);
  const grouped = new Map();
  for (const item of list) {
    const t = item.trigger || 'default';
    if (!grouped.has(t)) grouped.set(t, []);
    grouped.get(t).push(item);
  }
  for (const [trigger, items] of grouped.entries()) {
    const frames = items.map(it => ({
      duration: 0,
      bg: it.bg ?? '#000',
      videoAssetId: it.videoAssetId ?? null,
      videoSrc: it.src ?? null,
      assetId: it.assetId ?? null,
    }));
    map[trigger] = _createSequenceCutscene(frames, { canvas: canvas ?? refs.canvas });
  }
  return { map, defs: list };
}

function _createSequenceCutscene(frames, { canvas } = {}) {
  const fn = (ctx, dt, onEnd) => {
    if (!fn._state) fn.reset();
    const s = fn._state;
    s.frameElapsed += dt;
    if (s.frameIdx !== s._enteredFrameIdx) {
      const prev = frames[s._enteredFrameIdx];
      if (prev && prev._video) try { prev._video.pause(); } catch (e) { }
      s._enteredFrameIdx = s.frameIdx;
      const cur = frames[s.frameIdx];
      if (cur && (cur.videoAssetId || cur.videoSrc)) {
        if (!cur._video) {
          const preloaded = cur.videoAssetId ? _getAssetEntry(cur.videoAssetId) : null;
          if (preloaded?.video) {
            cur._video = preloaded.video;
            if (!cur.videoSrc && preloaded.videoSrc) cur.videoSrc = preloaded.videoSrc;
          } else {
            const v = document.createElement('video');
            v.src = cur.videoSrc;
            v.muted = true;
            v.playsInline = true;
            v.preload = 'auto';
            v.crossOrigin = 'anonymous';
            v.addEventListener('loadedmetadata', () => {
              if (!isNaN(v.duration) && v.duration > 0) cur.duration = v.duration * 1000;
            });
            cur._video = v;
          }
        }
        if (cur._video && !(cur.duration > 0) && !isNaN(cur._video.duration) && cur._video.duration > 0) {
          cur.duration = cur._video.duration * 1000;
        }
        try { cur._video.currentTime = s.frameElapsed / 1000; } catch (e) { }
        cur._video.play().catch(() => { });
      }
    }
    while (s.frameIdx < frames.length) {
      const curDur = frames[s.frameIdx]?.duration ?? 0;
      if (!(curDur > 0 && s.frameElapsed >= curDur)) break;
      s.frameElapsed -= curDur;
      s.frameIdx++;
      if (s.frameIdx >= frames.length) {
        const last = frames[s._enteredFrameIdx];
        if (last && last._video) try { last._video.pause(); } catch (e) { }
        onEnd?.();
        return;
      }
    }
    const frame = frames[s.frameIdx];
    if (frame) _drawCutsceneFrame(ctx, frame, s.frameElapsed, frame.duration ?? 0, { canvas });
  };
  fn.reset = () => { fn._state = { frameIdx: 0, frameElapsed: 0, _enteredFrameIdx: -1 }; };
  return fn;
}

function _drawCutsceneFrame(ctx, frame, elapsed, total, { canvas } = {}) {
  const c = canvas ?? refs.canvas;
  const w = c.width;
  const h = c.height;
  ctx.fillStyle = frame.bg ?? '#000';
  ctx.fillRect(0, 0, w, h);
  if (frame.videoAssetId || frame.videoSrc || frame._video) {
    const video = frame._video;
    if (video && video.readyState >= 2 && video.videoWidth && video.videoHeight) {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const vidAspect = vw / vh;
      const canvasAspect = w / h;
      ctx.drawImage(video, 0, 0, w, h);

    }
  } else if (frame.assetId) {
    const asset = getAssetImage(frame.assetId);
    if (asset) {
      const scale = Math.min(w / asset.width, h / asset.height);
      const iw = asset.width * scale;
      const ih = asset.height * scale;
      ctx.drawImage(asset, (w - iw) / 2, (h - ih) / 2, iw, ih);
    }
  }
  frame.draw?.(ctx, w, h, elapsed, total);
  if (frame.text?.length) {
    const ts = frame.textStyle ?? {};
    ctx.font = ts.font ?? scaledFont(28, 'bold');
    ctx.fillStyle = ts.color ?? '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lh = ts.lineHeight ?? 40;
    const startY = h * (ts.y ?? 0.5) - ((frame.text.length - 1) * lh) / 2;
    frame.text.forEach((line, i) => ctx.fillText(line, w / 2, startY + i * lh));
  }
  const fadeTime = Math.min(300, total / 4);
  let alpha = 0;
  if (elapsed < fadeTime) alpha = 1 - elapsed / fadeTime;
  if (elapsed > total - fadeTime) alpha = (elapsed - (total - fadeTime)) / fadeTime;
  if (alpha > 0) {
    ctx.fillStyle = `rgba(0,0,0,${Math.min(1, alpha)})`;
    ctx.fillRect(0, 0, w, h);
  }
}

export function registerClickHandler(handler) {
  const canvas = refs.canvas;
  if (!canvas) throw new Error('Call registerCanvas() first.');
  const wrapped = evt => handler(getClickGamePos(evt), evt);
  canvas.addEventListener('click', wrapped);
  return () => canvas.removeEventListener('click', wrapped);
}

// ─────────────────────────────────────────────
//  Internal utility: asset texture pattern
// ─────────────────────────────────────────────
const _patternCache = new Map();
function _assetPattern(ctx, assetId) {
  const key = `asset:${assetId}`;
  if (_patternCache.has(key)) return _patternCache.get(key);
  const asset = refs.assets.find(a => a.id === assetId);
  if (!asset?.img) return null;
  const pattern = ctx.createPattern(asset.img, 'repeat');
  _patternCache.set(key, pattern);
  return pattern;
}
// ═══════════════════════════════════════════════════════════════
//  NEW: Sound engine
//  - Preloaded audio assets (asset.type === 'audio' or inferred by extension)
//  - Event mapping via `event` property in assets.json
//  - Singleton `sound` with `playSfx`, `playMusic`, `stopMusic`, volume controls
//
function _getAssetEntry(id) {
  return refs.assets.find(a => a.id === id);
}

export class SoundEngine {
  constructor() {
    this.master = 1;
    this.sfx = 1;
    this.music = 1;
    this.currentMusic = null;
    this._playingSfx = new Set();
    this._musicSuspended = false;
  }

  playSfx(id, { volume = 1 } = {}) {
    const entry = _getAssetEntry(id);
    if (!entry || !entry.audio) return null;
    let a;
    try { a = entry.audio.cloneNode(true); } catch (e) { a = new Audio(entry.audio.src); }
    a.volume = Math.max(0, Math.min(1, this.master * this.sfx * volume));
    a.loop = false;
    a.play().catch(() => { });
    // track for global stop
    this._playingSfx.add(a);
    const cleanup = () => { try { this._playingSfx.delete(a); } catch (e) { } };
    a.addEventListener('ended', cleanup, { once: true });
    a.addEventListener('pause', cleanup, { once: true });
    return a;
  }

  playMusic(id, { volume = 1, loop = true } = {}) {
    const entry = _getAssetEntry(id);
    if (!entry || !entry.audio) return null;
    if (this.currentMusic) {
      try { this.currentMusic.pause(); } catch (e) { }
    }
    let a;
    try { a = entry.audio.cloneNode(true); } catch (e) { a = new Audio(entry.audio.src); }
    a.loop = !!loop;
    a.volume = Math.max(0, Math.min(1, this.master * this.music * volume));
    a.play().catch(() => { });
    this.currentMusic = a;
    return a;
  }

  stopMusic() {
    if (this.currentMusic) {
      try { this.currentMusic.pause(); } catch (e) { }
      this.currentMusic = null;
    }
  }

  stopAll() {
    // stop music
    try { this.stopMusic(); } catch (e) { }
    // stop tracked sfx
    try {
      for (const a of Array.from(this._playingSfx)) {
        try { a.pause(); } catch (e) { }
      }
      this._playingSfx.clear();
    } catch (e) { }
    // also try to pause any original audio assets
    try {
      for (const asset of refs.assets) if (asset?.audio) {
        try { asset.audio.pause(); } catch (e) { }
      }
    } catch (e) { }
  }

  // Pause music when page is hidden, resume when visible (called by visibility handler)
  handleVisibility(hidden) {
    try {
      if (hidden) {
        if (this.currentMusic && !this.currentMusic.paused) {
          try { this.currentMusic.pause(); } catch (e) { }
          this._musicSuspended = true;
        }
      } else {
        if (this._musicSuspended) {
          if (this.currentMusic && this.currentMusic.paused) {
            try { this.currentMusic.play().catch(() => { }); } catch (e) { }
          }
          this._musicSuspended = false;
        }
      }
    } catch (e) { }
  }

  setMasterVolume(v) { this.master = Math.max(0, Math.min(1, v)); if (this.currentMusic) this.currentMusic.volume = this.master * this.music; }
  setSfxVolume(v) { this.sfx = Math.max(0, Math.min(1, v)); }
  setMusicVolume(v) { this.music = Math.max(0, Math.min(1, v)); if (this.currentMusic) this.currentMusic.volume = this.master * this.music; }

  triggerEvent(name, opts) {
    const id = refs.soundEvents?.[name];
    if (!id) return null;
    const entry = _getAssetEntry(id);
    // Treat as music if explicitly 'music', if asset is looped, or if this is a known background event
    const musicEvents = new Set(['music', 'preday', 'intro']);
    if (musicEvents.has(name) || entry?.audio?.loop) return this.playMusic(id, opts);
    return this.playSfx(id, opts);
  }
}

export const sound = new SoundEngine();

export function playSoundById(id, opts) { return sound.playSfx(id, opts); }
export function playMusicById(id, opts) { return sound.playMusic(id, opts); }
export function stopMusic() { return sound.stopMusic(); }
export function triggerSoundEvent(name, opts) { return sound.triggerEvent(name, opts); }
export function stopAllAudio() { try { sound.stopAll(); } catch (e) { } }
// Install a document visibility handler to pause/resume background music automatically.
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('visibilitychange', () => {
    try {
      const hidden = !!document.hidden;
      sound.handleVisibility(hidden);
    } catch (e) { }
  });
}

// ═══════════════════════════════════════════════════════════════
//  NEW: Upgrades Store
//  Persistent (localStorage) key-value store for upgrades.
//
//  Usage:
//    const upgrades = new Upgrades('myGame', [
//      { id: 'power',    label: 'Launch Power',  maxLevel: 5, cost: lvl => lvl * 100 },
//      { id: 'bounce',   label: 'Bounce Count',  maxLevel: 3, cost: lvl => 150 * lvl },
//      { id: 'fuel',     label: 'Fuel Tank',     maxLevel: 4, cost: lvl => 200 * lvl },
//    ]);
//    const power = upgrades.getLevel('power');   // 0-5
//    upgrades.purchase('power', currentCoins);   // returns { ok, newCoins, newLevel }
// ═══════════════════════════════════════════════════════════════
export class Upgrades {
  /**
   * @param {string} namespace  – localStorage key prefix
   * @param {Array<{ id, label, maxLevel, cost:(lvl)=>number }>} defs
   */
  constructor(namespace, defs) {
    this.ns = namespace;
    this.defs = defs;
    this._data = JSON.parse(localStorage.getItem(this.ns) || '{}');
  }
  _save() { localStorage.setItem(this.ns, JSON.stringify(this._data)); }

  getLevel(id) { return this._data[id] ?? 0; }

  getCost(id) {
    const def = this.defs.find(d => d.id === id);
    if (!def) return Infinity;
    const lvl = this.getLevel(id);
    if (lvl >= def.maxLevel) return Infinity;
    return def.cost(lvl + 1);
  }

  isMaxed(id) {
    const def = this.defs.find(d => d.id === id);
    return def ? this.getLevel(id) >= def.maxLevel : true;
  }

  /**
   * Attempt a purchase.
   * @param {string} id
   * @param {number} coins  – current coin balance
   * @returns {{ ok: boolean, newCoins: number, newLevel: number, reason?: string }}
   */
  purchase(id, coins) {
    if (this.isMaxed(id)) return { ok: false, newCoins: coins, newLevel: this.getLevel(id), reason: 'maxed' };
    const cost = this.getCost(id);
    if (coins < cost) return { ok: false, newCoins: coins, newLevel: this.getLevel(id), reason: 'insufficient' };
    this._data[id] = (this._data[id] ?? 0) + 1;
    this._save();
    return { ok: true, newCoins: coins - cost, newLevel: this._data[id] };
  }

  reset() { this._data = {}; this._save(); }
}

// ═══════════════════════════════════════════════════════════════
//  NEW: ProgressTracker
//  Watches the character's position and fires milestone callbacks.
//
//  Usage:
//    const tracker = new ProgressTracker(character, {
//      onHorizontalThreshold: (dist) => { /* show "go to moon!" cutscene */ },
//      horizontalThreshold: 5000,   // px world units
//      onVerticalThreshold: (height) => { /* win */ },
//      verticalThreshold: -8000,    // negative y = up
//    });
//    // In your game loop:
//    tracker.update();
//    const { maxDist, maxHeight, phase } = tracker.getStats();
// ═══════════════════════════════════════════════════════════════
export class ProgressTracker {
  /**
   * @param {Character} character
   * @param {{
   *   horizontalThreshold: number,
   *   verticalThreshold:   number,
   *   onHorizontalThreshold: (dist:number)=>void,
   *   onVerticalThreshold:   (height:number)=>void,
   * }} opts
   */
  constructor(character, opts = {}) {
    this.char = character;
    this.opts = opts;
    this.maxDist = 0;   // max horizontal distance from origin
    this.maxHeight = 0;   // max upward distance (positive value, char.y decreases)
    this.originX = character.x;
    this.originY = character.y;
    // 'horizontal' | 'vertical' | 'complete'
    this.phase = 'horizontal';
    this._hFired = false;
    this._vFired = false;
  }

  update() {
    const dist = this.char.x - this.originX;
    const height = this.originY - this.char.y; // upward is negative y

    if (dist > this.maxDist) this.maxDist = dist;
    if (height > this.maxHeight) this.maxHeight = height;

    const ht = this.opts.horizontalThreshold ?? Infinity;
    const vt = this.opts.verticalThreshold ?? Infinity;

    if (!this._hFired && dist >= ht) {
      this._hFired = true;
      this.phase = 'vertical';
      this.opts.onHorizontalThreshold?.(dist);
    }
    if (!this._vFired && height >= vt) {
      this._vFired = true;
      this.phase = 'complete';
      this.opts.onVerticalThreshold?.(height);
    }
  }

  getStats() {
    return {
      maxDist: this.maxDist,
      maxHeight: this.maxHeight,
      phase: this.phase,
    };
  }

  reset(character) {
    if (character) this.char = character;
    this.originX = this.char.x;
    this.originY = this.char.y;
    this.maxDist = 0;
    this.maxHeight = 0;
    this.phase = 'horizontal';
    this._hFired = false;
    this._vFired = false;
  }
}

// ═══════════════════════════════════════════════════════════════
//  NEW: Cutscene
//  A scripted sequence of frames shown over the canvas.
//  Each frame can have: an asset to draw fullscreen, text lines,
//  a custom draw callback, and a duration.
//
//  Usage:
//    const cs = new Cutscene([
//      {
//        duration: 3000,                        // ms
//        bg: '#0a0a1a',
//        assetId: 'cutscene-rocket',            // optional asset
//        text: ['3… 2… 1…', 'LAUNCH!'],
//        textStyle: { font: '32px monospace', color: '#fff', y: 0.7 },
//        draw: (ctx, w, h, elapsed, total) => { /* custom overdraw */ },
//      },
//      { duration: 2500, bg: '#000', text: ['Your goal has changed…'], ... },
//    ], onComplete);
//
//    cs.start();  // begins playing; calls onComplete when done
//    cs.skip();   // jump to end immediately
// ═══════════════════════════════════════════════════════════════
export class Cutscene {
  /**
   * @param {Array<{
   *   duration: number,
   *   bg?: string,
   *   assetId?: string,
   *   text?: string[],
   *   textStyle?: { font?:string, color?:string, lineHeight?:number, y?:number },
   *   draw?: (ctx, w, h, elapsed, total) => void,
   * }>} frames
   * @param {()=>void} onComplete
   */
  constructor(frames, onComplete) {
    this.frames = frames;
    this.onComplete = onComplete;
    this._frameIdx = 0;
    this._frameStart = 0;
    this._handle = null;
    this._active = false;
    this._fadeAlpha = 0;
  }

  start() {
    this._active = true;
    this._frameIdx = 0;
    this._frameStart = performance.now();
    this._loop();
  }

  skip() {
    this._finish();
  }

  _loop() {
    if (!this._active) return;
    const now = performance.now();
    const frame = this.frames[this._frameIdx];
    const elapsed = now - this._frameStart;

    this._render(frame, elapsed, frame.duration);

    if (elapsed >= frame.duration) {
      this._frameIdx++;
      if (this._frameIdx >= this.frames.length) {
        this._finish();
        return;
      }
      this._frameStart = now;
    }

    this._handle = requestAnimationFrame(() => this._loop());
  }

  _render(frame, elapsed, total) {
    const canvas = refs.canvas;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    // Background
    ctx.fillStyle = frame.bg ?? '#000';
    ctx.fillRect(0, 0, w, h);

    // Optional fullscreen asset
    if (frame.assetId) {
      const asset = refs.assets.find(a => a.id === frame.assetId);
      if (asset?.img) {
        const scale = Math.min(w / asset.img.width, h / asset.img.height);
        const iw = asset.img.width * scale;
        const ih = asset.img.height * scale;
        ctx.drawImage(asset.img, (w - iw) / 2, (h - ih) / 2, iw, ih);
      }
    }

    // Custom draw hook
    frame.draw?.(ctx, w, h, elapsed, total);

    // Text
    if (frame.text?.length) {
      const ts = frame.textStyle ?? {};
      ctx.font = ts.font ?? scaledFont(28, 'bold');
      ctx.fillStyle = ts.color ?? '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lh = ts.lineHeight ?? 40;
      const startY = h * (ts.y ?? 0.5) - ((frame.text.length - 1) * lh) / 2;
      frame.text.forEach((line, i) => ctx.fillText(line, w / 2, startY + i * lh));
    }

    // Fade in/out at frame edges (first/last 300ms)
    const fadeTime = Math.min(300, total / 4);
    let alpha = 0;
    if (elapsed < fadeTime) alpha = 1 - elapsed / fadeTime;
    if (elapsed > total - fadeTime) alpha = (elapsed - (total - fadeTime)) / fadeTime;
    if (alpha > 0) {
      ctx.fillStyle = `rgba(0,0,0,${Math.min(1, alpha)})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  _finish() {
    this._active = false;
    cancelAnimationFrame(this._handle);
    this.onComplete?.();
  }
}

// ═══════════════════════════════════════════════════════════════
//  NEW: UIOverlay
//  Draws interactive UI panels over the canvas (no DOM).
//  Panels are: 'pregame', 'upgrades', 'eod' (end-of-day/run stats).
//
//  Usage:
//    const ui = new UIOverlay();
//
//    // Pre-game panel
//    ui.showPregame({
//      title: 'LAUNCHER 9000',
//      subtitle: 'Click to set power, release to launch!',
//      buttonLabel: 'LAUNCH',
//      onLaunch: () => sceneManager.goTo('game'),
//      onUpgrades: () => sceneManager.goTo('upgrades'),
//    });
//
//    // Upgrades panel
//    ui.showUpgrades({
//      upgrades,     // Upgrades instance
//      coins: 420,
//      onClose: () => sceneManager.goTo('pregame'),
//    });
//
//    // EOD/run stats panel
//    ui.showEOD({
//      stats: tracker.getStats(),
//      coinsEarned: 320,
//      phase: tracker.phase,
//      onContinue: () => sceneManager.goTo('upgrades'),
//    });
//
//    ui.hide(); // remove current panel
// ═══════════════════════════════════════════════════════════════
export class UIOverlay {
  constructor({ fonts = null, colors = null } = {}) {
    this._panel = null;       // active panel descriptor
    this._removeClick = null; // cleanup fn
    this._removeMove = null;  // cleanup fn
    this._hoverPos = null;
    this._fonts = fonts;
    this._colors = colors;
  }

  // ── Public API ──────────────────────────────────────────────

  /** Show the pre-game launch screen. */
  showPregame({ title, subtitle, buttonLabel = 'LAUNCH', onLaunch, onUpgrades, onIntro, fonts, colors } = {}) {
    this._setPanel({
      type: 'pregame', fonts, colors,
      title, subtitle, buttonLabel, onLaunch, onUpgrades, onIntro,
    });
  }

  /** Show the intro screen. */
  showIntro({ title = 'WELCOME', subtitle = '', buttonLabel = 'PLAY', onPlay, fonts, colors } = {}) {
    this._setPanel({
      type: 'intro', fonts, colors,
      title, subtitle, buttonLabel, onPlay,
    });
  }

  /** Show the upgrades shop. */
  showUpgrades({ upgrades, coins, onClose, lockedIds = [], getLockedIds, categories = [], getEquippedId, onEquip, fonts, colors } = {}) {
    this._setPanel({
      type: 'upgrades',
      fonts,
      colors,
      upgrades,
      coins: coins ?? 0,
      onClose,
      lockedIds,
      getLockedIds,
      categories,
      getEquippedId,
      onEquip,
      activeCategory: null,
      _page: 0,
    });
  }

  /** Show end-of-run stats. */
  showEOD({ stats, coinsEarned, impactCoins, phase, onContinue, day, fonts, colors, perfRows = [], coinBreakdown = [] } = {}) {
    this._setPanel({ type: 'eod', stats, coinsEarned, impactCoins, phase, onContinue, day, fonts, colors, perfRows, coinBreakdown });
  }

  setFonts(fonts = null) {
    this._fonts = fonts;
  }

  setColors(colors = null) {
    this._colors = colors;
  }

  /** Remove the current overlay. */
  hide() {
    this._panel = null;
    this._removeClick?.();
    this._removeClick = null;
    this._removeMove?.();
    this._removeMove = null;
    this._hoverPos = null;
  }

  /**
   * Call this every frame from your render loop while a panel is active.
   * Returns true if a panel is currently being drawn.
   */
  draw() {
    if (!this._panel) return false;
    const canvas = refs.canvas;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    switch (this._panel.type) {
      case 'intro': this._drawIntro(ctx, w, h); break;
      case 'pregame': this._drawPregame(ctx, w, h); break;
      case 'upgrades': this._drawUpgrades(ctx, w, h); break;
      case 'eod': this._drawEOD(ctx, w, h); break;
    }
    return true;
  }

  // ── Renderers ───────────────────────────────────────────────

  _drawPregame(ctx, w, h) {
    const p = this._panel;
    const fonts = this._getFonts();
    const colors = this._getColors();
    // Dark overlay
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(0, 0, w, h);
    const tex = _assetPattern(ctx, 'terrain-dirt');
    if (tex) {
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = tex;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    // Title
    ctx.textAlign = 'center';
    ctx.fillStyle = _resolveUIColor(colors, 'title', '#fff');
    ctx.font = _scaledUIFont(48, { fonts, role: 'title', weight: 'bold' });
    ctx.fillText(p.title ?? 'LAUNCHER', w / 2, h * 0.3);

    // Subtitle
    ctx.font = _scaledUIFont(20, { fonts, role: 'subtitle' });
    ctx.fillStyle = _resolveUIColor(colors, 'subtitle', '#aaa');
    const subtitleLines = String(p.subtitle ?? '').split('\n').filter(Boolean);
    const subtitleLineH = sUi(24);
    const subtitleStartY = h * 0.42;
    if (subtitleLines.length) {
      subtitleLines.forEach((line, idx) => {
        ctx.fillText(line, w / 2, subtitleStartY + idx * subtitleLineH);
      });
    }

    // Buttons
    const btnW = sUi(200);
    const btnH = sUi(50);
    const btnX = w / 2 - btnW / 2;
    const btnY = h * 0.54;
    const btnGap = sUi(16);
    this._drawButton(ctx, btnX, btnY, btnW, btnH, p.buttonLabel, '#f5a623');
    this._drawButton(ctx, btnX, btnY + btnH + btnGap, btnW, btnH, 'UPGRADES', '#4a90e2');
    this._drawButton(ctx, btnX, btnY + (btnH + btnGap) * 2, btnW, btnH, 'INTRO', '#666');
  }

  _drawIntro(ctx, w, h) {
    const p = this._panel;
    const fonts = this._getFonts();
    const colors = this._getColors();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, w, h);

    ctx.textAlign = 'center';
    ctx.fillStyle = _resolveUIColor(colors, 'title', '#fff');
    ctx.font = _scaledUIFont(40, { fonts, role: 'title', weight: 'bold' });
    ctx.fillText(p.title ?? 'WELCOME', w / 2, h * 0.35);

    if (p.subtitle) {
      ctx.font = _scaledUIFont(18, { fonts, role: 'subtitle' });
      ctx.fillStyle = _resolveUIColor(colors, 'subtitle', '#ccc');
      ctx.fillText(p.subtitle, w / 2, h * 0.45);
    }

    const btnW = sUi(200);
    const btnH = sUi(56);
    const btnX = w / 2 - btnW / 2;
    const btnY = h * 0.6;
    this._drawButton(ctx, btnX, btnY, btnW, btnH, p.buttonLabel ?? 'PLAY', '#4a90e2');

    // register some interactive/animated intro entities once
    if (!_introEntityCache.initialized) {
      // initial sizes (runtime logic below reads live canvas size each frame)
      const W = w, H = h;

      // eater that pops up, eats, then pops down
      const eaterFramesIdle = [];
      for (let i = 0; i < 4; i++) eaterFramesIdle.push(`hero-idle-${i}`);
      const eaterFramesEating = [];
      for (let i = 0; i < 12; i++) eaterFramesEating.push(`hero-eating-${i}`);
      const eaterSprite = new AnimatedSprite();
      eaterSprite.addAnimation('idle', eaterFramesIdle, 6, true);
      eaterSprite.addAnimation('eating', eaterFramesEating, 12, false);
      eaterSprite.changeAnimation('idle', true);

      const eater = new SceneEntity({ x: 0, y: H + 120, layer: 1, interactive: true, hitBox: 100 });
      eater._state = 'down';
      eater._timer = 0;
      // make initial pops less frequent and randomized
      eater._delay = 3000 + Math.random() * 7000;
      eater._homeXRatio = 0.28;
      // nudge home Y lower so it's not centered vertically on first appearance
      eater._homeYRatio = 0.62;
      eater._homeX = W * eater._homeXRatio;
      eater._homeY = H * eater._homeYRatio;
      eater.updateFn = (self, dt) => {
        const viewW = refs.canvas?.width || W;
        const viewH = refs.canvas?.height || H;
        // Recompute absolute anchors every frame so quality changes apply instantly.
        self._homeX = viewW * (self._homeXRatio ?? 0.28);
        self._homeY = viewH * (self._homeYRatio ?? 0.62);
        const ms = (typeof dt === 'number') ? dt : (1000 / 60);
        // always advance sprite animation
        try { eaterSprite.update(ms); } catch (e) { }
        self._timer += ms;
        if (self._state === 'down') {
          if (self._timer >= self._delay) {
            self._state = 'up'; self._animT = 0; self._startY = viewH + 60; self._timer = 0; eaterSprite.changeAnimation('idle', true);
          }
        } else if (self._state === 'up') {
          self._animT += ms;
          const dur = 400;
          const t = Math.min(1, self._animT / dur);
          self.y = lerp(self._startY, self._homeY, easeOutCubic(t));
          if (t >= 1) { self._state = 'eating'; eaterSprite.changeAnimation('eating', true); try { triggerSoundEvent('eating'); } catch (e) { } }
        } else if (self._state === 'eating') {
          if (!eaterSprite.playing) { self._state = 'downing'; self._animT = 0; self._startY = self.y; }
        } else if (self._state === 'downing') {
          self._animT += ms;
          const dur = 400;
          const t = Math.min(1, self._animT / dur);
          self.y = lerp(self._startY, viewH + 60, easeInCubic(t));
          if (t >= 1) {
            self._state = 'down';
            self._timer = 0;
            self._delay = 2000 + Math.random() * 3000;
            self._homeXRatio = 0.2 + Math.random() * 0.6;
            self._homeX = viewW * self._homeXRatio;
          }
        }
      };
      eater.drawFn = (self, ctx) => {
        const viewH = refs.canvas?.height || H;
        const imgId = eaterSprite.getFrameId();
        const img = getAssetImage(imgId);
        if (!img) return;
        const scale = 1.2;
        const w2 = img.width * scale;
        const h2 = img.height * scale;
        const x = self._homeX - w2 / 2;
        const y = (typeof self.y === 'number') ? self.y : (viewH + 60);
        self.x = x; self.y = y;
        self.hitBox = { x: 0, y: 0, w: w2, h: h2 };
        ctx.save(); ctx.drawImage(img, x, y, w2, h2); ctx.restore();
      };

      eater.onMouseDown = () => {
        console.log('Eater clicked!');
      };
      // corolla that flies across screen and triggers a sound
      // start the corolla well off-screen (randomized) and along the bottom so it doesn't appear centered on load
      const corolla = new SceneEntity({ x: -140 - Math.random() * W, y: H - 150, layer: 2, interactive: false });
      // faster baseline speed for more noticeable passes
      corolla._vx = 240 + Math.random() * 120;
      corolla._played = false;
      corolla.updateFn = (self, dt) => {
        const viewW = refs.canvas?.width || W;
        const viewH = refs.canvas?.height || H;
        const s = (typeof dt === 'number') ? dt / 1000 : (1 / 60);
        const ms = (typeof dt === 'number') ? dt : (1000 / 60);
        self.y = viewH - 150;
        if (!self._state) self._state = 'flying';

        if (self._state === 'flying') {
          self.x += (self._vx || 300) * s;
          // play sound as soon as it becomes visible on screen (entry)
          if (!self._played && self.x > -20) { self._played = true; try { triggerSoundEvent('corolla-drive'); } catch (e) { } }
          // when off the right edge, enter waiting state instead of instantly respawning
          if (self.x > viewW + 120) {
            self._state = 'waiting';
            self._waitTimer = 0;
            // randomized gap before re-entry (ms)
            self._waitDuration = 2000 + Math.random() * 9000;
            // hold it just past the right edge while waiting
            self.x = viewW + 140;
            self._played = false;
          }
        } else if (self._state === 'waiting') {
          self._waitTimer += ms;
          if (self._waitTimer >= (self._waitDuration || 3000)) {
            // respawn well left to create a visible gap
            self._state = 'flying';
            self.x = -140 - Math.random() * (viewW * 1.8);
            self._played = false;
          }
        }
      };
      corolla.drawFn = (self, ctx) => {
        const asset = getAssetImage('glider-corolla') || null;
        if (asset) ctx.drawImage(asset, self.x, self.y);
        else {
          ctx.save(); ctx.fillStyle = '#ffcc00'; ctx.beginPath(); ctx.ellipse(self.x + 18, self.y + 8, 22, 10, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        }
      };

      addSceneEntity('intro', eater);
      addSceneEntity('intro', corolla);
      _introEntityCache.initialized = true;
    }
    // process intro entities for animation and drawing
    const now = performance.now();
    const last = _introEntityCache._lastTime || now;
    const dt = Math.min(1000 / 30, now - last);
    _introEntityCache._lastTime = now;
    const introEntities = getSceneEntities('intro');
    for (const ent of introEntities) {
      if (ent._visible === false) continue;
      try { ent.update(dt); } catch (err) { console.error('intro entity update error', err); }
      try { ent.draw(ctx); } catch (err) { console.error('intro entity draw error', err); }
    }
  }

  _drawUpgrades(ctx, w, h) {
    const p = this._panel;
    const fonts = this._getFonts();
    const colors = this._getColors();
    const lockedIds = typeof p.getLockedIds === 'function' ? p.getLockedIds() : (p.lockedIds ?? []);
    const { upgrades, coins } = p;
    const categories = p.categories ?? [];
    const defs = upgrades?.defs ?? [];
    const defById = new Map(defs.map(d => [d.id, d]));
    const catById = new Map(categories.map(c => [c.id, c]));
    const panelW = Math.min(sUi(680), w - sUi(40));
    const panelH = Math.min(sUi(520), h - sUi(40));
    const px = (w - panelW) / 2;
    const py = (h - panelH) / 2;

    // Panel bg (image-backed)
    const panelImg = getAssetImage('ui-menu-bg') || getAssetImage('ui-menu-pinboard');
    if (panelImg) {
      ctx.save();
      _roundRect(ctx, px, py, panelW, panelH, sUi(16));
      ctx.clip();
      try { ctx.drawImage(panelImg, px, py, panelW, panelH); } catch (e) { /* draw failure */ }
      ctx.restore();
      // subtle dark overlay to ensure text contrast
      // no color tint overlay (use image as-is)
      ctx.strokeStyle = '#4a90e2'; ctx.lineWidth = sUi(2); _roundRect(ctx, px, py, panelW, panelH, sUi(16)); ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(10,10,30,0.95)';
      _roundRect(ctx, px, py, panelW, panelH, sUi(16));
      ctx.fill();
      const panelTex = _assetPattern(ctx, 'terrain-dirt');
      if (panelTex) {
        ctx.save();
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = panelTex;
        _roundRect(ctx, px, py, panelW, panelH, sUi(16));
        ctx.fill();
        ctx.restore();
      }
      ctx.strokeStyle = '#4a90e2';
      ctx.lineWidth = sUi(2);
      _roundRect(ctx, px, py, panelW, panelH, sUi(16));
      ctx.stroke();
    }

    // Title
    ctx.fillStyle = _resolveUIColor(colors, 'title', '#fff');
    ctx.font = _scaledUIFont(26, { fonts, role: 'title', weight: 'bold' });
    ctx.textAlign = 'center';
    ctx.fillText('UPGRADES', w / 2, py + sUi(38));

    // Coins
    ctx.font = _scaledUIFont(16, { fonts, role: 'meta' });
    ctx.fillStyle = _resolveUIColor(colors, 'meta', '#fff');
    ctx.fillText(`💰 ${coins} coins`, w / 2, py + sUi(62));

    const activeCategory = p.activeCategory ? catById.get(p.activeCategory) : null;
    if (activeCategory) {
      const items = activeCategory.items ?? [];
      // Use the original category item definitions (they include numeric stats)
      const orderedDefs = items.map(item => item).filter(Boolean);
      // catalogue: present as a 2x2 paged grid
      ctx.fillStyle = _resolveUIColor(colors, 'heading', '#fff');
      ctx.font = _scaledUIFont(20, { fonts, role: 'heading', weight: 'bold' });
      ctx.textAlign = 'center';
      ctx.fillText(activeCategory.label ?? 'UPGRADES', w / 2, py + sUi(90));

      const page = p._page || 0;
      const perPage = 4;
      const totalPages = Math.max(1, Math.ceil(orderedDefs.length / perPage));
      const pageItems = orderedDefs.slice(page * perPage, page * perPage + perPage);

      const gridTop = py + sUi(120);
      const gridLeft = px + sUi(28);
      const gridW = panelW - sUi(56);
      const gridH = panelH - sUi(210);
      const gap = sUi(18);
      const cellW = Math.floor((gridW - gap) / 2);
      const cellH = Math.floor((gridH - gap) / 2);

      // Determine numeric stat keys for this category (ordered preference)
      const preferKeys = ['power', 'thrust', 'fuel', 'bounce', 'density', 'maxSpeed', 'gravityScale', 'dragScale', 'turnRate'];
      const statKeysAll = new Set();
      for (const d of orderedDefs) {
        for (const k of Object.keys(d || {})) {
          if (['id', 'label', 'cost', 'icon', 'unlockRequirements', 'mode'].includes(k)) continue;
          if (typeof d[k] === 'number') statKeysAll.add(k);
        }
      }
      const statKeys = preferKeys.filter(k => statKeysAll.has(k)).concat([...statKeysAll].filter(k => !preferKeys.includes(k)));
      const statKeysTrim = statKeys.slice(0, 3); // show up to 3 bars
      // compute per-key maxes (robust: handle missing/non-numeric values)
      const maxByKey = {};
      for (const k of statKeysTrim) {
        let maxV = -Infinity;
        for (const d of orderedDefs) {
          if (!d) continue;
          const v = d[k];
          const num = (typeof v === 'number') ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
          if (Number.isFinite(num)) maxV = Math.max(maxV, num);
        }
        if (!Number.isFinite(maxV) || maxV <= 0) maxV = 1; // avoid divide-by-zero and nonsensical full-bars
        maxByKey[k] = maxV;
      }

      for (let i = 0; i < 4; i++) {
        const def = pageItems[i];
        const cx = gridLeft + (i % 2) * (cellW + gap);
        const cy = gridTop + Math.floor(i / 2) * (cellH + gap);

        // hover scale for the whole item cell
        const hoverPos = this._hoverPos;
        const isHoverCell = hoverPos && hoverPos.x >= cx && hoverPos.x <= cx + cellW && hoverPos.y >= cy && hoverPos.y <= cy + cellH;
        if (isHoverCell) {
          ctx.save();
          const scale = 1.05;
          const centerX = cx + cellW / 2;
          const centerY = cy + cellH / 2;
          ctx.translate(centerX, centerY);
          ctx.scale(scale, scale);
          ctx.translate(-centerX, -centerY);
        }

        // cell background: prefer image, fallback to subtle fill
        const itemCellImg = getAssetImage('ui-upgrade-item-bg') || getAssetImage('ui-menu-pinboard');
        if (itemCellImg) {
          ctx.save();
          _roundRect(ctx, cx, cy, cellW, cellH, sUi(10));
          ctx.clip();
          try { ctx.drawImage(itemCellImg, cx, cy, cellW, cellH); } catch (e) { }
          ctx.restore();
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.04)';
          _roundRect(ctx, cx, cy, cellW, cellH, sUi(10));
          ctx.fill();
        }

        if (!def) {
          // empty slot
          ctx.fillStyle = _resolveUIColor(colors, 'muted', '#888');
          ctx.font = _scaledUIFont(14, { fonts, role: 'body' });
          ctx.textAlign = 'center';
          ctx.fillText('[EMPTY]', cx + cellW / 2, cy + cellH / 2 - sUi(6));
          this._drawButton(ctx, cx + cellW / 2 - sUi(48), cy + cellH - sUi(40), sUi(96), sUi(28), 'LOCKED', '#666', 6, `SUB_LOCKED_${activeCategory.id}_slot${i}`);
          if (isHoverCell) ctx.restore();
          continue;
        }

        const lvl = upgrades.getLevel(def.id);
        const cost = upgrades.getCost(def.id);
        const maxed = upgrades.isMaxed(def.id);
        const isLocked = lockedIds.includes(def.id);
        const owned = lvl > 0;
        const equippedId = typeof p.getEquippedId === 'function' ? p.getEquippedId(activeCategory.id) : null;
        const isEquipped = owned && def.id === equippedId;

        // Layout: left 3/8 for picture, top 1/3 for name, right 5/8 for stat bars
        const leftW = Math.floor(cellW * 3 / 8);
        const rightW = cellW - leftW;
        const nameH = Math.floor(cellH / 3);

        // Name area (top full-width)
        ctx.textAlign = 'left';
        ctx.fillStyle = _resolveUIColor(colors, 'itemTitle', '#fff');
        ctx.font = _scaledUIFont(16, { fonts, role: 'itemTitle', weight: 'bold' });
        const nameX = cx + sUi(12);
        const nameY = cy + Math.round(nameH * 0.6);

        // Picture area (left column under name)
        const picX = cx - sUi(8);
        const picY = cy + nameH - sUi(25);
        const picW = leftW + sUi(16);
        const picH = cellH - nameH + sUi(24);
        const iconAsset = def.icon ? refs.assets.find(a => a.id === def.icon)?.img : null;
        if (iconAsset) {
          // fit inside pic area, maintain aspect
          const ar = iconAsset.width / iconAsset.height;
          let drawW = picW, drawH = picH;
          if (drawW / drawH > ar) drawW = Math.round(drawH * ar); else drawH = Math.round(drawW / ar);
          ctx.save(); ctx.globalAlpha = 0.95; ctx.drawImage(iconAsset, picX + (picW - drawW) / 2, picY + (picH - drawH) / 2, drawW, drawH); ctx.restore();
        } else {
          // placeholder
          ctx.fillStyle = '#2b2b2b';
          _roundRect(ctx, picX, picY, picW, picH, sUi(8)); ctx.fill();
        }
        ctx.fillText(def.label, nameX, nameY);

        // Stats area (right column)
        const statX = cx + leftW + sUi(5);
        const statY = cy + nameH - sUi(16);
        const statW = rightW - sUi(24);
        const statH = cellH - nameH - sUi(24);
        ctx.textAlign = 'left';
        ctx.font = _scaledUIFont(12, { fonts, role: 'statLabel' });
        ctx.fillStyle = _resolveUIColor(colors, 'statLabel', '#ddd');
        // friendly labels for known keys
        const friendly = {
          power: 'Power', thrust: 'Thrust', fuel: 'Fuel', bounce: 'Bounce', density: 'Density', gravityScale: 'Gravity', dragScale: 'Drag', turnRate: 'Turn'
        };
        // draw up to statKeysTrim.length bars
        const bars = statKeysTrim.length;
        const barGap = sUi(8);
        const barH = Math.max(sUi(8), Math.floor((statH - (bars - 1) * barGap) / Math.max(1, bars) / 1.6));

        // drawClarinet: draws a clarinet-shaped bar (widening to the right)
        const drawClarinet = (ctx, sx, sy, fullW, h, rel, bgColor) => {
          const right = sx + fullW;
          const left = sx;
          const topOffset = Math.max(0, h * 0.18);
          const bottomOffset = Math.max(0, h * 0.18);

          // main clarinet path (wider at right)
          ctx.beginPath();
          ctx.moveTo(left, sy + topOffset);
          ctx.lineTo(right, sy);
          ctx.lineTo(right, sy + h);
          ctx.lineTo(left, sy + h - bottomOffset);
          ctx.closePath();

          // background
          ctx.save();
          ctx.fillStyle = bgColor || 'rgba(255,255,255,0.06)';
          ctx.fill();
          ctx.restore();

          // fill according to rel by clipping to the filled rectangle portion
          const fillW = Math.max(2, Math.round(fullW * Math.max(0, Math.min(1, rel))));
          if (fillW > 0) {
            ctx.save();
            ctx.beginPath();
            // clip to the filled width
            ctx.rect(left, sy, fillW, h);
            ctx.clip();

            // gradient from red (left) to green (right) across full width
            const g = ctx.createLinearGradient(left, 0, right, 0);
            g.addColorStop(0, '#e74c3c');
            g.addColorStop(0.5, '#f1c40f');
            g.addColorStop(1, '#2ecc71');
            ctx.fillStyle = g;

            // fill the same clarinet path (but clipped)
            ctx.beginPath();
            ctx.moveTo(left, sy + topOffset);
            ctx.lineTo(right, sy);
            ctx.lineTo(right, sy + h);
            ctx.lineTo(left, sy + h - bottomOffset);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
          }

          // outline
          ctx.save();
          ctx.strokeStyle = 'rgba(255,255,255,0.08)';
          ctx.lineWidth = sUi(1);
          ctx.beginPath();
          ctx.moveTo(left, sy + topOffset);
          ctx.lineTo(right, sy);
          ctx.lineTo(right, sy + h);
          ctx.lineTo(left, sy + h - bottomOffset);
          ctx.closePath();
          ctx.stroke();
          ctx.restore();
        };

        // center bars vertically like a flex column with centered items
        const perStep = barH + barGap;
        const totalBarsHeight = bars > 0 ? ((bars - 1) * perStep + sUi(16) + barH) : 0; // account for label offset (scaled) and barH
        const startOffset = Math.max(sUi(6), Math.floor((statH - totalBarsHeight) / 2));
        for (let bi = 0; bi < bars; bi++) {
          const key = statKeysTrim[bi];
          const val = typeof def[key] === 'number' ? def[key] : 0;
          const maxVal = maxByKey[key] || 1;
          const rel = Math.max(0, Math.min(1, val / maxVal));
          const by = statY + startOffset + bi * perStep;
          // label
          const labelText = friendly[key] || key.replace(/([A-Z])/g, ' $1');
          ctx.fillStyle = _resolveUIColor(colors, 'statLabel', '#bbb');
          ctx.fillText(labelText, statX, by + sUi(10));
          // bar background and fill (clarinet-shaped)
          const barY = by + sUi(16);
          const fullW = Math.floor(statW * 0.92);
          drawClarinet(ctx, statX, barY, fullW, barH, rel, 'rgba(255,255,255,0.06)');
          // numeric
          ctx.fillStyle = _resolveUIColor(colors, 'statValue', '#eee');
          ctx.font = _scaledUIFont(11, { fonts, role: 'statValue' });
          const num = (Math.round((val + Number.EPSILON) * 100) / 100).toString();
          ctx.fillText(num, statX + fullW + sUi(8), barY + barH - 1);
          ctx.font = _scaledUIFont(12, { fonts, role: 'statLabel' });
        }

        // price bottom-left
        if (!isLocked && !owned) {
          ctx.fillStyle = _resolveUIColor(colors, 'price', '#fff');
          ctx.font = _scaledUIFont(14, { fonts, role: 'price', weight: 'bold' });
          ctx.textAlign = 'left';
          ctx.fillText(`${cost}🪙`, cx + sUi(12), cy + cellH - sUi(10));
        } else if (owned) {
          ctx.fillStyle = _resolveUIColor(colors, 'status', '#9bd89b');
          ctx.font = _scaledUIFont(12, { fonts, role: 'status' });
          ctx.textAlign = 'left';
          ctx.fillText(isEquipped ? 'Equipped' : 'Owned', cx + sUi(12), cy + cellH - sUi(10));
        }

        // whole-cell click region: buy/equip or locked
        const actionLabel = isLocked ? `SUB_LOCKED_${def.id}` : (!owned ? `SUB_BUY_${def.id}` : (isEquipped ? `SUB_EQUIPPED_${def.id}` : `SUB_EQUIP_${def.id}`));
        if (!this._hitRegions) this._hitRegions = [];
        this._hitRegions.push({ x: cx, y: cy, bw: cellW, bh: cellH, label: actionLabel });

        // equipped watermark
        if (isEquipped) {
          ctx.save();
          ctx.translate(cx + cellW / 2, cy + cellH / 2);
          ctx.rotate(-0.25);
          ctx.globalAlpha = 0.12;
          ctx.fillStyle = _resolveUIColor(colors, 'watermark', '#fff');
          ctx.font = _scaledUIFont(36, { fonts, role: 'watermark', weight: 'bold' });
          ctx.textAlign = 'center';
          ctx.fillText('EQUIPPED', 0, 0);
          ctx.restore();
        }

        if (isHoverCell) ctx.restore();
      }

      // page controls
      if (totalPages > 1) {
        const pw = sUi(36);
        this._drawButton(ctx, px + sUi(24), py + panelH - sUi(70), sUi(36), sUi(36), '◀', '#444', 8, 'PAGE_PREV');
        this._drawButton(ctx, px + panelW - sUi(24) - pw, py + panelH - sUi(70), sUi(36), sUi(36), '▶', '#444', 8, 'PAGE_NEXT');
        ctx.fillStyle = _resolveUIColor(colors, 'meta', '#ccc'); ctx.font = _scaledUIFont(13, { fonts, role: 'meta' }); ctx.textAlign = 'center'; ctx.fillText(`${page + 1} / ${totalPages}`, w / 2, py + panelH - sUi(44));
      }

      this._drawButton(ctx, w / 2 - sUi(60), py + panelH - sUi(56), sUi(120), sUi(40), '← BACK', '#555', 10, 'BACK_UPGRADES');
      return;
    }

    const barX = px + sUi(48);
    const barW = panelW - sUi(96);
    const barTopY = py + sUi(96);
    const barBottomY = py + panelH - sUi(90);
    const hover = this._hoverPos;
    let hoverText = null;
    let hoverX = 0;
    let hoverY = 0;

    const drawNotchBar = (label, items = [], key, y) => {
      if (!items.length) return;
      ctx.textAlign = 'left';
      ctx.fillStyle = _resolveUIColor(colors, 'heading', '#fff');
      ctx.font = _scaledUIFont(14, { fonts, role: 'heading', weight: 'bold' });
      ctx.fillText(label, barX, y - sUi(14));

      // Track geometry
      const trackH = sUi(12);
      const trackX = barX;
      const trackY = y - Math.floor(trackH / 2);
      const trackW = barW;

      // Draw track background
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      _roundRect(ctx, trackX, trackY, trackW, trackH, trackH / 2);
      ctx.fill();
      ctx.restore();

      // Gradient fill for the filled portion (red -> green)
      const g = ctx.createLinearGradient(trackX, 0, trackX + trackW, 0);
      g.addColorStop(0, '#e74c3c');
      g.addColorStop(1, '#2ecc71');

      // compute owned index
      const ownedIndex = items.reduce((acc, it, idx) => (upgrades.getLevel(it.id) > 0 ? idx : acc), -1);

      // Draw per-segment fills so we can show affordability on hover
      const segW = trackW / items.length;
      const innerPad = Math.max(1, Math.round(sUi(2)));
      const hoverAllowed = hover && Math.abs(hover.y - (trackY + trackH / 2)) <= sUi(12);
      const hoverIdx = hoverAllowed ? Math.min(items.length - 1, Math.max(0, Math.floor((hover.x - trackX) / segW))) : -1;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const segX = trackX + i * segW + innerPad / 2;
        const segWInner = Math.max(2, segW - innerPad);

        // determine fill color for this segment
        let fillColor = null;
        if (i <= ownedIndex) {
          fillColor = 'rgba(46, 204, 113, 1)'; // owned — always fully opaque
        } else if (hover && i <= hoverIdx) {
          // compute cumulative cost from next-to-owned up to this segment
          let cum = 0;
          for (let k = ownedIndex + 1; k <= i; k++) {
            cum += upgrades.getCost(items[k].id);
          }
          // hover preview levels are intentionally semi-transparent
          fillColor = (cum <= (coins || 0))
            ? 'rgba(46, 204, 113, 0.3)'
            : 'rgba(231, 76, 60, 0.3)';
        }

        if (fillColor) {
          ctx.save();
          ctx.fillStyle = fillColor;
          ctx.fillRect(Math.round(segX), trackY, Math.round(segWInner), trackH);
          ctx.restore();
        }

        // separator line (except at 0)
        const nx = Math.round(trackX + i * segW);
        if (i > 0) {
          ctx.save();
          ctx.strokeStyle = 'rgba(0,0,0,0.25)';
          ctx.lineWidth = sUi(2);
          ctx.beginPath();
          ctx.moveTo(nx, trackY + Math.floor(trackH * 0.15));
          ctx.lineTo(nx, trackY + trackH - Math.floor(trackH * 0.15));
          ctx.stroke();
          ctx.restore();
        }

        // hit region spans this segment
        const rx = Math.round(trackX + i * segW);
        const rw = Math.ceil(segW);
        if (!this._hitRegions) this._hitRegions = [];
        this._hitRegions.push({ x: rx, y: trackY - sUi(8), bw: rw, bh: trackH + sUi(16), label: `BAR_${key}_${item.id}` });

        // hover tooltip logic (per-segment) — only when vertically near the bar
        if (hoverAllowed && hoverIdx === i) {
          const owned = upgrades.getLevel(item.id) > 0;
          if (owned) hoverText = `OWNED`;
          else {
            const ownedIndex2 = ownedIndex;
            const toBuy = items.slice(ownedIndex2 + 1, i + 1);
            const totalCost = toBuy.reduce((sum, it2) => sum + upgrades.getCost(it2.id), 0);
            hoverText = `${totalCost}🪙`;
          }
          hoverX = trackX + (i + 0.5) * segW;
          hoverY = trackY - sUi(18);
        }
      }

      // outline track
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = sUi(1);
      _roundRect(ctx, trackX, trackY, trackW, trackH, trackH / 2);
      ctx.stroke();
      ctx.restore();
    };

    drawNotchBar('SLINGSHOT', catById.get('power')?.items ?? [], 'POWER', barTopY);
    drawNotchBar('FUEL TANK', catById.get('fuel')?.items ?? [], 'FUEL', barBottomY);

    if (hoverText) {
      ctx.font = _scaledUIFont(12, { fonts, role: 'tooltip' });
      ctx.fillStyle = _resolveUIColor(colors, 'tooltip', '#fff');
      ctx.textAlign = 'center';
      ctx.fillText(hoverText, hoverX, hoverY);
    }

    const gridTop = barTopY + sUi(10);
    const gridBottom = barBottomY - sUi(40);
    const gridH = Math.max(sUi(120), gridBottom - gridTop);
    const gridW = panelW - sUi(96);
    const gridX = px + sUi(48);
    const gridY = gridTop;
    const gap = 0;
    const cellW = Math.floor((gridW - gap) / 2);
    // make category cells taller (scale up ~30% with a sensible minimum)
    const cellH = Math.max(sUi(100), Math.floor((gridH - gap) / 2));
    const gridIds = ['bounce', 'density', 'thruster', 'glider'];

    gridIds.forEach((catId, i) => {
      const cat = catById.get(catId);
      if (!cat) return;
      const items = cat.items ?? [];
      const owned = items.filter(it => upgrades.getLevel(it.id) > 0);
      const equippedId = typeof p.getEquippedId === 'function' ? p.getEquippedId(catId) : null;
      const equippedItem = items.find(it => it.id === equippedId) ?? null;
      const selectedItem = equippedItem || (owned.length ? owned[owned.length - 1] : null);
      const cx = gridX + (i % 2) * (cellW + gap);
      const cy = gridY + Math.floor(i / 2) * (cellH + gap);

      // hover scale for entire category cell
      const hoverPos = this._hoverPos;
      const isHoverCat = hoverPos && hoverPos.x >= cx && hoverPos.x <= cx + cellW && hoverPos.y >= cy && hoverPos.y <= cy + cellH;
      if (isHoverCat) {
        ctx.save();
        const scale = 1.05;
        const centerX = cx + cellW / 2;
        const centerY = cy + cellH / 2;
        ctx.translate(centerX, centerY);
        ctx.scale(scale, scale);
        ctx.translate(-centerX, -centerY);
      }

      // main category cell background: prefer image, fallback to subtle fill
      const catCellImg = getAssetImage('ui-upgrade-cell-bg') || getAssetImage('ui-menu-pinboard');
      if (catCellImg) {
        ctx.save();
        _roundRect(ctx, cx, cy, cellW, cellH, sUi(10));
        ctx.clip();
        try { ctx.drawImage(catCellImg, cx, cy, cellW, cellH); } catch (e) { }
        ctx.restore();
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        _roundRect(ctx, cx, cy, cellW, cellH, sUi(10));
        ctx.fill();
      }

      ctx.textAlign = 'center';
      ctx.fillStyle = _resolveUIColor(colors, 'itemTitle', '#fff');
      ctx.font = _scaledUIFont(14, { fonts, role: 'itemTitle', weight: 'bold' });

      // If user has an equipped item in this category, show that item's title as the heading and display its icon
      if (equippedItem) {
        // draw icon prominently under heading
        const iconAsset = equippedItem.icon ? refs.assets.find(a => a.id === equippedItem.icon)?.img : null;
        if (iconAsset) {
          const maxW = Math.floor(cellW * 0.6);
          const maxH = Math.floor(cellH * 0.75);
          let drawW = iconAsset.width, drawH = iconAsset.height;
          const ar = iconAsset.width / iconAsset.height;
          if (drawW > maxW) { drawW = maxW; drawH = Math.round(drawW / ar); }
          if (drawH > maxH) { drawH = maxH; drawW = Math.round(drawH * ar); }
          ctx.save(); ctx.globalAlpha = 0.95; ctx.drawImage(iconAsset, cx + (cellW - drawW) / 2, cy, drawW, drawH); ctx.restore();
          ctx.fillText(equippedItem.label || equippedItem.id, cx + cellW / 2, cy + sUi(34));

        }
        // show equipped marker below icon
        ctx.font = _scaledUIFont(12, { fonts, role: 'status' });
        ctx.fillStyle = _resolveUIColor(colors, 'status', '#9bd89b');
        ctx.fillText('Equipped', cx + cellW / 2, cy + Math.min(cellH - sUi(28), sUi(28) + (cellH * 0.36) + sUi(18)));
      } else {
        // default: show category label and selected/placeholder text
        ctx.fillText(cat.label ?? catId.toUpperCase(), cx + cellW / 2, cy + sUi(34));
        if (selectedItem) {
          ctx.font = _scaledUIFont(13, { fonts, role: 'meta' });
          ctx.fillStyle = _resolveUIColor(colors, 'meta', '#ddd');
          ctx.fillText(selectedItem.label || selectedItem.id, cx + cellW / 2, cy + sUi(46));
        } else {
          ctx.font = _scaledUIFont(12, { fonts, role: 'meta' });
          ctx.fillStyle = _resolveUIColor(colors, 'muted', '#c9c9c9ff');
          ctx.fillText('Click to buy', cx + cellW / 2, cy + sUi(60));
        }
      }

      // make the entire category cell clickable (open category)
      if (!this._hitRegions) this._hitRegions = [];
      this._hitRegions.push({ x: cx, y: cy, bw: cellW, bh: cellH, label: `GRID_${catId}` });

      if (isHoverCat) ctx.restore();
    });

    // Close button
    this._drawButton(ctx, w / 2 - sUi(60), py + panelH - sUi(56), sUi(120), sUi(40), '✕ CLOSE', '#555');
  }

  _drawEOD(ctx, w, h) {
    const p = this._panel;
    const fonts = this._getFonts();
    const colors = this._getColors();
    const { stats, coinsEarned, phase, day, perfRows = [], coinBreakdown = [] } = p;
    if (!p._enteredAt) p._enteredAt = performance.now();
    const now = performance.now();
    const enterMs = 380;
    const t = Math.max(0, Math.min(1, (now - p._enteredAt) / enterMs));
    const easeOut = 1 - Math.pow(1 - t, 3);
    const slideX = (1 - easeOut) * (w + sUi(80));

    const barAnimDelayMs = 140;
    const barAnimMs = 1100;
    const barT = Math.max(0, Math.min(1, (now - p._enteredAt - barAnimDelayMs) / barAnimMs));
    const barEase = 1 - Math.pow(1 - barT, 3);

    const panelW = Math.min(sUi(400), w - sUi(40));
    const panelH = Math.min(h - sUi(30), sUi(500));
    const px = (w - panelW) / 2 + slideX;
    const py = Math.min((h - panelH) / 2 + 100, h - panelH - sUi(8));
    const centerX = w / 2 + slideX;

    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, 0, w, h);
    const bgTex = _assetPattern(ctx, 'terrain-dirt');
    if (bgTex) {
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = bgTex;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    // Panel bg (image-backed)
    const panelImg = getAssetImage('ui-menu-bg') || getAssetImage('ui-menu-pinboard');
    if (panelImg) {
      ctx.save();
      _roundRect(ctx, px, py, panelW, panelH, sUi(16));
      ctx.clip();
      try { ctx.drawImage(panelImg, px, py, panelW, panelH); } catch (e) { }
      ctx.restore();
      // no color tint overlay (use image as-is)
      ctx.strokeStyle = phase === 'complete' ? '#f5a623' : '#4a90e2';
      ctx.lineWidth = sUi(2);
      _roundRect(ctx, px, py, panelW, panelH, sUi(16));
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(10,10,30,0.97)';
      _roundRect(ctx, px, py, panelW, panelH, sUi(16));
      ctx.fill();
      const cardTex = _assetPattern(ctx, 'terrain-dirt');
      if (cardTex) {
        ctx.save();
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = cardTex;
        _roundRect(ctx, px, py, panelW, panelH, sUi(16));
        ctx.fill();
        ctx.restore();
      }
      ctx.strokeStyle = phase === 'complete' ? '#f5a623' : '#4a90e2';
      ctx.lineWidth = sUi(2);
      _roundRect(ctx, px, py, panelW, panelH, sUi(16));
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.fillStyle = _resolveUIColor(colors, 'title', '#fff');
    ctx.font = _scaledUIFont(24, { fonts, role: 'title', weight: 'bold' });
    const title = `Day ${Number.isFinite(Number(day)) ? Number(day) : '?'}`;
    ctx.fillText("Launch Completed!", centerX, h / 2 - sUi(168));
    ctx.fillText(title, centerX, h / 2 - sUi(140));

    ctx.font = _scaledUIFont(14, { fonts, role: 'body' });
    ctx.fillStyle = _resolveUIColor(colors, 'body', '#ccc');

    ctx.fillStyle = _resolveUIColor(colors, 'heading', '#fff');
    ctx.font = _scaledUIFont(20, { fonts, role: 'heading', weight: 'bold' });
    const animTotalCoins = Math.max(0, Math.round((Number(coinsEarned) || 0) * barEase));
    ctx.fillText(`+${animTotalCoins} coins`, centerX, py + sUi(132));

    // Progress bars against previous best performance.
    const rows = Array.isArray(perfRows) ? perfRows : [];
    const breakdown = Array.isArray(coinBreakdown) ? coinBreakdown : [];
    const coinsByKey = new Map(breakdown.map(b => [String(b?.key || ''), Math.max(0, Number(b?.coins) || 0)]));
    const barLeft = px + sUi(18);
    const barRight = px + panelW - sUi(18);
    const barW = barRight - barLeft;
    const barH = sUi(18);
    let y = py + sUi(246);

    const formatMetric = (v, unit, progress = 1) => {
      const n = Number(v) || 0;
      const a = Math.max(0, n * Math.max(0, Math.min(1, progress)));
      return unit ? `${a.toFixed(unit === 's' ? 1 : 0)} ${unit}` : `${a.toFixed(0)}`;
    };
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowDelay = i * 80;
      const rowT = Math.max(0, Math.min(1, (now - p._enteredAt - barAnimDelayMs - rowDelay) / barAnimMs));
      const rowEase = 1 - Math.pow(1 - rowT, 3);
      const ratio = Math.max(0, Math.min(1, Number(row?.ratio) || 0));
      const currentText = formatMetric(row?.current, row?.unit || '', rowEase);
      const rowCoins = coinsByKey.get(String(row?.key || '')) ?? 0;
      const rowCoinsAnim = Math.max(0, Math.round(rowCoins * rowEase));

      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      _roundRect(ctx, barLeft, y, barW, barH, sUi(4));
      ctx.fill();

      ctx.fillStyle = _resolveUIColor(colors, 'hudAccent', '#f5c542');
      const fillW = Math.round(barW * ratio * rowEase);
      if (fillW > 0) {
        _roundRect(ctx, barLeft, y, fillW, barH, sUi(4));
        ctx.fill();
      }

      // Text inside progress bar
      ctx.font = _scaledUIFont(11, { fonts, role: 'meta', weight: 'bold' });
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = _resolveUIColor(colors, 'title', '#fff');
      ctx.fillText(`${row?.label ?? 'Metric'}: ${currentText}`, barLeft + sUi(6), y + barH / 2);

      ctx.textAlign = 'right';
      ctx.fillStyle = _resolveUIColor(colors, 'status', '#9bd89b');
      ctx.fillText(`+${rowCoinsAnim}`, barRight - sUi(6), y + barH / 2);
      ctx.textBaseline = 'alphabetic';

      y += sUi(27);
    }

    this._drawButton(ctx, centerX - sUi(80), py + panelH - sUi(54), sUi(160), sUi(44), 'CONTINUE →', '#4a90e2');
  }

  // ── Utilities ───────────────────────────────────────────────

  /**
   * Draw a simple canvas button and register it as a click target.
   * Buttons are stored per-render; click targets are rebuilt each frame.
   */
  _drawButton(ctx, x, y, bw, bh, label, color = '#4a90e2', radius = 10, actionLabel = label) {
    const fonts = this._getFonts();
    const colors = this._getColors();
    const hover = !!(this._hoverPos && this._hoverPos.x >= x && this._hoverPos.x <= x + bw && this._hoverPos.y >= y && this._hoverPos.y <= y + bh);
    const scale = hover ? 1.05 : 1.0;
    const cx = x + bw / 2;
    const cy = y + bh / 2;
    const r = sUi(radius);

    ctx.save();
    if (hover) {
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      // draw at centered coordinates
      ctx.fillStyle = 'transparent';
      _roundRect(ctx, -bw / 2, -bh / 2, bw, bh, r);
      ctx.fill();
      const btnImg = getAssetImage('ui-button-bg') || getAssetImage('ui-menu-pinboard');
      if (btnImg) {
        ctx.save();
        _roundRect(ctx, -bw / 2, -bh / 2, bw, bh, r);
        ctx.clip();
        try { ctx.drawImage(btnImg, -bw / 2, -bh / 2, bw, bh); } catch (e) { }
        ctx.restore();
      }
      ctx.fillStyle = _resolveUIColor(colors, 'button', '#7b7b7bff');
      ctx.font = _scaledUIFont((bh * 0.38) / Math.max(1, UI_SCALE), { fonts, role: 'button', weight: 'bold' });
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 0, 0);
      ctx.textBaseline = 'alphabetic';
    } else {
      ctx.fillStyle = "transparent";
      _roundRect(ctx, x, y, bw, bh, r);
      ctx.fill();
      const btnImg = getAssetImage('ui-button-bg') || getAssetImage('ui-menu-pinboard');
      if (btnImg) {
        ctx.save();
        _roundRect(ctx, x, y, bw, bh, r);
        ctx.clip();
        try { ctx.drawImage(btnImg, x, y, bw, bh); } catch (e) { }
        ctx.restore();
      }
      ctx.fillStyle = _resolveUIColor(colors, 'button', '#7b7b7bff');
      ctx.font = _scaledUIFont((bh * 0.38) / Math.max(1, UI_SCALE), { fonts, role: 'button', weight: 'bold' });
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + bw / 2, y + bh / 2);
      ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();

    // Record hit region for this frame
    if (!this._hitRegions) this._hitRegions = [];
    this._hitRegions.push({ x, y, bw, bh, label: actionLabel });
  }

  _setPanel(descriptor) {
    this.hide();
    this._panel = descriptor;
    this._hitRegions = [];

    // Attach click handler
    const canvas = refs.canvas;
    const onClick = (evt) => {
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / rect.width;
      const sy = canvas.height / rect.height;
      const cx = (evt.clientX - rect.left) * sx;
      const cy = (evt.clientY - rect.top) * sy;

      for (const r of (this._hitRegions ?? [])) {
        if (cx >= r.x && cx <= r.x + r.bw && cy >= r.y && cy <= r.y + r.bh) {
          this._handleClick(r.label);
          break;
        }
      }
      // Rebuild hit regions each frame (draw() fills them)
      this._hitRegions = [];
    };
    canvas.addEventListener('click', onClick);
    this._removeClick = () => canvas.removeEventListener('click', onClick);

    const onMove = (evt) => {
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / rect.width;
      const sy = canvas.height / rect.height;
      const cx = (evt.clientX - rect.left) * sx;
      const cy = (evt.clientY - rect.top) * sy;
      this._hoverPos = { x: cx, y: cy };
    };
    canvas.addEventListener('mousemove', onMove);
    this._removeMove = () => canvas.removeEventListener('mousemove', onMove);
  }

  _getFonts() {
    return {
      ...(this._fonts || {}),
      ...(this._panel?.fonts || {}),
    };
  }

  _getColors() {
    return {
      ...(this._colors || {}),
      ...(this._panel?.colors || {}),
    };
  }

  _handleClick(label) {
    const p = this._panel;
    if (!p) return;

    if (p.type === 'pregame') {
      if (label === p.buttonLabel) p.onLaunch?.();
      if (label === 'UPGRADES') p.onUpgrades?.();
      if (label === 'INTRO') p.onIntro?.();
    }
    if (p.type === 'intro') {
      if (label === p.buttonLabel) p.onPlay?.();
    }
    if (p.type === 'upgrades') {
      if (label === '✕ CLOSE') { p.onClose?.(); return; }
      if (label === 'BACK_UPGRADES') {
        p.activeCategory = null;
        return;
      }
      if (label.startsWith('BAR_')) {
        const parts = label.split('_');
        const id = parts.slice(2).join('_');
        const lockedIds = typeof p.getLockedIds === 'function' ? p.getLockedIds() : (p.lockedIds ?? []);
        if (lockedIds.includes(id)) return;
        const catId = parts[1] === 'POWER' ? 'power' : 'fuel';
        const categories = p.categories ?? [];
        const cat = categories.find(c => c.id === catId);
        const items = cat?.items ?? [];
        const targetIndex = items.findIndex(it => it.id === id);
        const ownedIndex = items.reduce((acc, it, idx) => (p.upgrades.getLevel(it.id) > 0 ? idx : acc), -1);

        if (targetIndex <= ownedIndex) {
          p.onEquip?.(id, catId);
          return;
        }

        const toBuy = items.slice(ownedIndex + 1, targetIndex + 1);
        const totalCost = toBuy.reduce((sum, it) => sum + p.upgrades.getCost(it.id), 0);
        if (p.coins < totalCost) return;

        for (const it of toBuy) {
          const result = p.upgrades.purchase(it.id, p.coins);
          if (!result.ok) return;
          p.coins = result.newCoins;
        }
        p.onEquip?.(id, catId);
        return;
      }
      if (label.startsWith('GRID_')) {
        const catId = label.slice(5);
        p.activeCategory = catId;
        p._page = 0;
        return;
      }
      if (label === 'PAGE_PREV') {
        p._page = Math.max(0, (p._page || 0) - 1);
        return;
      }
      if (label === 'PAGE_NEXT') {
        // compute max pages from active category
        const categories = p.categories ?? [];
        const cat = categories.find(c => c.id === p.activeCategory);
        const items = cat?.items ?? [];
        const totalPages = Math.max(1, Math.ceil(items.length / 4));
        p._page = Math.min(totalPages - 1, (p._page || 0) + 1);
        return;
      }
      if (label.startsWith('SUB_')) {
        const parts = label.split('_');
        const action = parts[1];
        const id = parts.slice(2).join('_');
        const lockedIds = typeof p.getLockedIds === 'function' ? p.getLockedIds() : (p.lockedIds ?? []);
        if (lockedIds.includes(id)) return;
        if (action === 'BUY') {
          const cost = p.upgrades.getCost(id);
          const result = p.upgrades.purchase(id, p.coins);
          if (result.ok) {
            p.coins = result.newCoins;
            p.onEquip?.(id, p.activeCategory);
          }
          return;
        }
        if (action === 'EQUIP') {
          p.onEquip?.(id, p.activeCategory);
          return;
        }
        return;
      }
    }
    if (p.type === 'eod') {
      if (label === 'CONTINUE →') p.onContinue?.();
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  NEW: DialogueOverlay
//  Lightweight dropdown-style tutorial/dialogue panel.
//  Usage:
//    const dialog = new DialogueOverlay();
//    dialog.show({ title: 'Tutorial', text: ['Line 1', 'Line 2'] });
//    dialog.draw();
// ═══════════════════════════════════════════════════════════════
export class DialogueOverlay {
  constructor({ fonts = null, colors = null } = {}) {
    this._active = false;
    this._data = null;
    this._shownAt = 0;
    this._duration = 0;
    this._fonts = fonts;
    this._colors = colors;
  }

  show({ title = '', text = '', position = 'top', width = 0.72, padding = 16, duration = 0, fonts, colors } = {}) {
    this._data = { title, text, position, width, padding, fonts, colors };
    this._shownAt = performance.now();
    this._duration = duration;
    this._active = true;
  }

  setFonts(fonts = null) {
    this._fonts = fonts;
  }

  setColors(colors = null) {
    this._colors = colors;
  }

  hide() {
    this._active = false;
  }

  isActive() {
    return this._active;
  }

  draw() {
    if (!this._active || !this._data) return false;
    const now = performance.now();
    if (this._duration > 0 && now - this._shownAt >= this._duration) {
      this.hide();
      return false;
    }

    const canvas = refs.canvas;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const { title, text, position, width, padding } = this._data;
    const fonts = {
      ...(this._fonts || {}),
      ...(this._data?.fonts || {}),
    };
    const colors = {
      ...(this._colors || {}),
      ...(this._data?.colors || {}),
    };
    const pad = sUi(padding ?? 12);

    const panelW = Math.round(w * Math.min(0.9, Math.max(0.4, width)));
    const x = (w - panelW) / 2;
    const lines = Array.isArray(text) ? text : _wrapText(ctx, String(text), panelW - pad * 2);

    const lineHeight = sUi(20);
    const titleH = title ? sUi(26) : 0;
    const panelH = pad * 2 + titleH + lines.length * lineHeight;

    const dropT = Math.min(1, (now - this._shownAt) / 220);
    const dropOffset = (1 - dropT) * sUi(12);
    const yBase = position === 'bottom' ? h - panelH - sUi(18) : sUi(18);
    const y = yBase - dropOffset;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = 'rgba(10,12,20,0.9)';
    _roundRect(ctx, x, y, panelW, panelH, sUi(12));
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = sUi(1);
    _roundRect(ctx, x, y, panelW, panelH, sUi(12));
    ctx.stroke();

    let ty = y + pad + (title ? sUi(18) : 0);
    if (title) {
      ctx.font = _scaledUIFont(18, { fonts, role: 'title', weight: 'bold' });
      ctx.fillStyle = _resolveUIColor(colors, 'title', '#f5c542');
      ctx.textAlign = 'left';
      ctx.fillText(title, x + pad, y + pad + sUi(18));
      ty = y + pad + titleH;
    }

    ctx.font = _scaledUIFont(14, { fonts, role: 'body' });
    ctx.fillStyle = _resolveUIColor(colors, 'body', '#e6f2ff');
    ctx.textAlign = 'left';
    lines.forEach((line, i) => {
      ctx.fillText(line, x + pad, ty + i * lineHeight + sUi(2));
    });
    ctx.restore();
    return true;
  }
}

// ═══════════════════════════════════════════════════════════════
//  NEW: SceneManager
//  A lightweight finite-state machine for scenes.
//  Each scene has optional onEnter / onExit / update / draw hooks.
//  Transition types: 'cut' | 'fade' (fade to black between scenes).
//
//  Usage:
//    const sm = new SceneManager();
//
//    sm.register('pregame', {
//      onEnter() { ui.showPregame({ ..., onLaunch: () => sm.goTo('game') }); },
//      onExit()  { ui.hide(); },
//      draw()    { ui.draw(); },
//    });
//
//    sm.register('game', {
//      onEnter() { game.resume(); },
//      onExit()  { game.pause(); },
//      update()  { game.update(); tracker.update(); },
//      draw()    { game.draw(); },
//    });
//
//    sm.register('cutscene', {
//      onEnter(data) {
//        const cs = new Cutscene(data.frames, () => sm.goTo(data.next));
//        cs.start();
//      },
//    });
//
//    sm.register('upgrades', {
//      onEnter() { ui.showUpgrades({ upgrades, coins, onClose: () => sm.goTo('pregame') }); },
//      onExit()  { ui.hide(); },
//      draw()    { ui.draw(); },
//    });
//
//    sm.register('eod', {
//      onEnter() { ui.showEOD({ stats, coinsEarned, phase, onContinue: () => sm.goTo('upgrades') }); },
//      onExit()  { ui.hide(); },
//      draw()    { ui.draw(); },
//    });
//
//    sm.goTo('pregame');
//    sm.startLoop();   // drives update+draw for active scene
// ═══════════════════════════════════════════════════════════════
export class SceneManager {
  /**
   * @param {{ transition?: 'cut'|'fade', fadeDuration?: number }} opts
   */
  constructor(opts = {}) {
    this._scenes = {};
    this._current = null;
    this._transition = opts.transition ?? 'fade';
    this._fadeDuration = opts.fadeDuration ?? 400;
    this._fadeAlpha = 0;
    this._fading = false;
    this._pendingScene = null;
    this._pendingData = null;
    this._loopHandle = null;
    // Scenes where the same background music should persist
    this._persistMusicScenes = new Set(['pregame', 'upgrades', 'eod']);
  }

  /** Register a named scene. */
  register(name, { onEnter, onExit, update, draw } = {}) {
    this._scenes[name] = { onEnter, onExit, update, draw };
  }

  /**
   * Transition to a scene. Data is passed to onEnter.
   * @param {string} name
   * @param {any}    data   – passed to scene's onEnter(data)
   */
  goTo(name, data) {
    if (!this._scenes[name]) throw new Error(`Scene "${name}" not registered.`);
    if (this._transition === 'cut') {
      this._switch(name, data);
    } else {
      this._beginFade(name, data);
    }
  }

  /** Start the manager's own rAF loop (drives update + draw). */
  startLoop() {
    const loop = () => {
      this._tick();
      this._loopHandle = requestAnimationFrame(loop);
    };
    loop();
  }

  stopLoop() {
    cancelAnimationFrame(this._loopHandle);
    this._loopHandle = null;
  }

  // ── Internals ────────────────────────────────────────────────

  _tick() {
    const scene = this._current ? this._scenes[this._current] : null;
    scene?.update?.();
    scene?.draw?.();
    if (this._fading) this._drawFade();
  }

  _switch(name, data) {
    const prevName = this._current;
    const prevIn = prevName ? this._persistMusicScenes.has(prevName) : false;
    const nextIn = this._persistMusicScenes.has(name);
    // stop audio unless we're staying within the persistent pre-day music scenes
    if (!(prevIn && nextIn)) {
      try { stopAllAudio(); } catch (e) { }
    }
    const prev = prevName ? this._scenes[prevName] : null;
    prev?.onExit?.();
    this._current = name;
    this._scenes[name].onEnter?.(data);
    // If we just entered a pre-day music scene from outside, start that music
    if (nextIn && !prevIn) {
      try { triggerSoundEvent('preday'); } catch (e) { }
    }
  }

  _beginFade(name, data) {
    if (this._fading) return;
    this._fading = true;
    this._fadeAlpha = 0;
    this._pendingScene = name;
    this._pendingData = data;

    const start = performance.now();
    const half = this._fadeDuration / 2;
    let switched = false;

    const tick = (now) => {
      const elapsed = now - start;
      if (elapsed < half) {
        this._fadeAlpha = elapsed / half;
        requestAnimationFrame(tick);
      } else if (!switched) {
        switched = true;
        this._switch(this._pendingScene, this._pendingData);
        requestAnimationFrame(tick);
      } else if (elapsed < this._fadeDuration) {
        this._fadeAlpha = 1 - (elapsed - half) / half;
        requestAnimationFrame(tick);
      } else {
        this._fadeAlpha = 0;
        this._fading = false;
      }
    };
    requestAnimationFrame(tick);
  }

  _drawFade() {
    const ctx = refs.canvas.getContext('2d');
    ctx.fillStyle = `rgba(0,0,0,${this._fadeAlpha})`;
    ctx.fillRect(0, 0, refs.canvas.width, refs.canvas.height);
  }
}

// ─────────────────────────────────────────────
//  Internal utility: rounded rect path
// ─────────────────────────────────────────────
function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function _wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// ─────────────────────────────────────────────
//  Launcher helpers (moved from index.html)
// ─────────────────────────────────────────────
export function clearLauncherStorage(storage = localStorage) {
  const keys = [
    'lnch_coins', 'lnch_best', 'lnch_moon', 'lnch_runs',
    'lnch_seen_objective', 'lnch_seen_moon', 'lnch_seen_intro',
    'lnch_seen_cutscenes', 'lnch_day', 'lnch_lm_destroyed',
    'lnch_equip_power', 'lnch_equip_bounce', 'lnch_equip_density',
    'lnch_equip_fuel', 'lnch_equip_thruster', 'lnch_equip_glider', 'launcher_v1',
  ];
  for (const k of keys) storage.removeItem(k);
}

export function loadLauncherState(storage = localStorage) {
  const getInt = (key, def = 0) => parseInt(storage.getItem(key) || String(def), 10);
  const getBool = (key) => storage.getItem(key) === '1';
  let destroyed = [];
  try { destroyed = JSON.parse(storage.getItem('lnch_lm_destroyed') || '[]'); } catch (e) { destroyed = []; }
  return {
    coins: getInt('lnch_coins', 0),
    bestDist: getInt('lnch_best', 0),
    moonUnlocked: storage.getItem('lnch_moon') === '1',
    totalRuns: getInt('lnch_runs', 0),
    currentDay: getInt('lnch_day', 1),
    seenObjectiveCs: getBool('lnch_seen_objective'),
    seenMoonCs: getBool('lnch_seen_moon'),
    seenIntroCs: getBool('lnch_seen_intro'),
    destroyedLandmarks: new Set(destroyed),
    equipped: {
      power: storage.getItem('lnch_equip_power') || null,
      bounce: storage.getItem('lnch_equip_bounce') || null,
      density: storage.getItem('lnch_equip_density') || null,
      fuel: storage.getItem('lnch_equip_fuel') || null,
      thruster: storage.getItem('lnch_equip_thruster') || null,
      glider: storage.getItem('lnch_equip_glider') || null,
    },
  };
}

export function saveLauncherState(state, storage = localStorage) {
  storage.setItem('lnch_coins', state.coins ?? 0);
  storage.setItem('lnch_best', state.bestDist ?? 0);
  storage.setItem('lnch_moon', state.moonUnlocked ? '1' : '0');
  storage.setItem('lnch_runs', state.totalRuns ?? 0);
  storage.setItem('lnch_day', state.currentDay ?? 1);
  storage.setItem('lnch_seen_objective', state.seenObjectiveCs ? '1' : '0');
  storage.setItem('lnch_seen_moon', state.seenMoonCs ? '1' : '0');
  storage.setItem('lnch_seen_intro', state.seenIntroCs ? '1' : '0');
}

export function saveDestroyedLandmarks(destroyedLandmarks, storage = localStorage) {
  storage.setItem('lnch_lm_destroyed', JSON.stringify([...destroyedLandmarks]));
}

export function saveEquipped(equipped, storage = localStorage) {
  const keys = ['power', 'bounce', 'density', 'fuel', 'thruster', 'glider'];
  for (const k of keys) {
    const val = equipped[k];
    const storageKey = `lnch_equip_${k}`;
    if (val) storage.setItem(storageKey, val);
    else storage.removeItem(storageKey);
  }
}

export function makeNoopCutscene() {
  const f = (ctx, dt, onEnd) => onEnd?.();
  f.reset = () => { };
  return f;
}

export function buildCutsceneDefMap(defs = []) {
  const map = new Map();
  for (const d of defs) {
    if (!map.has(d.trigger)) map.set(d.trigger, d);
  }
  return map;
}

export function createSeenCutsceneStore({
  storageKey = 'lnch_seen_cutscenes',
  storage = localStorage,
  hasSeenOverride,
} = {}) {
  let cache = null;
  const loadSet = () => {
    if (cache) return cache;
    let seen = [];
    try { seen = JSON.parse(storage.getItem(storageKey) || '[]'); } catch (e) { seen = []; }
    cache = new Set(seen);
    return cache;
  };
  const markSeen = (trigger) => {
    if (!trigger) return;
    const set = loadSet();
    if (set.has(trigger)) return;
    set.add(trigger);
    try { storage.setItem(storageKey, JSON.stringify([...set])); } catch (e) { }
  };
  const hasSeen = (trigger) => {
    if (hasSeenOverride) {
      const v = hasSeenOverride(trigger);
      if (v !== undefined) return v;
    }
    return loadSet().has(trigger);
  };
  const reset = () => { cache = null; };
  return { loadSet, markSeen, hasSeen, reset };
}

export function shouldAllowSkip(trigger, def, hasSeen) {
  if (def?.skippableOnFirstPlay === false) return !!hasSeen?.(trigger);
  return true;
}

export function initDistanceTriggers(defs = [], seenSet = new Set()) {
  return (defs || []).map(d => ({ ...d, fired: seenSet.has(d.trigger) }));
}

export function checkDistanceTriggers({ hero, launchY, triggers, onTrigger } = {}) {
  if (!hero || !triggers?.length) return;
  const hx = hero.x ?? 0;
  for (const t of triggers) {
    const d = t.distance;
    if (!d) continue;
    const already = t.fired;
    const reprompt = !!t.reprompt;
    let triggered = false;
    if (d.type === 'horizontal') {
      if (hx >= (d.value ?? 0)) triggered = true;
    } else if (d.type === 'vertical') {
      const height = Math.max(0, launchY - (hero.y ?? launchY));
      if (height >= (d.value ?? 0)) triggered = true;
    }
    if (triggered && (!already || reprompt)) {
      const res = onTrigger?.(t);
      if (res !== false) {
        if (!reprompt) t.fired = true;
        break;
      }
    }
  }
}

export class CutsceneRunner {
  constructor() {
    this._fn = null;
    this._onEnd = null;
    this._meta = null;
    this._lastTick = 0;
  }
  start(fn, onEnd, meta) {
    this._fn = fn;
    this._onEnd = onEnd;
    this._meta = meta || null;
    this._lastTick = performance.now();
    fn?.reset?.();
  }
  end() {
    if (!this._fn) return null;
    const cb = this._onEnd;
    const meta = this._meta;
    this._fn = null;
    this._onEnd = null;
    this._meta = null;
    cb?.(meta);
    return meta;
  }
  tick(ctx) {
    if (!this._fn) return;
    const now = performance.now();
    const dt = now - this._lastTick;
    this._lastTick = now;
    this._fn(ctx, dt, () => this.end());
  }
  isActive() { return !!this._fn; }
  getMeta() { return this._meta; }
}

export function bindLauncherInput({
  canvas,
  isGameActive,
  isLaunched,
  getIsCharging,
  onChargeStart,
  onChargeEnd,
  onChargeAngle,
  onLaunch,
  getCamera,
  getLaunchPos,
  canBoost,
  onBoostStart,
  onBoostEnd,
} = {}) {
  if (!canvas) return () => { };
  const getHeroScreenPos = () => {
    const cam = getCamera?.() ?? { x: 0, y: 0 };
    const launchPos = getLaunchPos?.() ?? { x: 0, y: 0 };
    const worldScale = Math.max(1, window.UI_SCALE || 1);
    return { x: (launchPos.x - cam.x) * worldScale, y: (launchPos.y - cam.y) * worldScale };
  };

  const onMouseDown = (e) => {
    if (!isGameActive?.() || isLaunched?.()) return;
    onChargeStart?.(performance.now());
  };
  const onMouseMove = (e) => {
    if (!getIsCharging?.() || isLaunched?.()) return;
    const rect = canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const cy = (e.clientY - rect.top) * (canvas.height / rect.height);
    const heroScreen = getHeroScreenPos();
    const dx = cx - heroScreen.x;
    const dy = cy - heroScreen.y;
    let angle = Math.atan2(dy, dx) * 180 / Math.PI;
    angle = Math.max(-80, Math.min(-5, angle));
    onChargeAngle?.(angle);
  };
  const onMouseUp = () => {
    if (!isGameActive?.() || isLaunched?.() || !getIsCharging?.()) return;
    onChargeEnd?.();
    onLaunch?.();
  };

  const onTouchStart = (e) => {
    e.preventDefault?.();
    if (!isGameActive?.() || isLaunched?.()) return;
    onChargeStart?.(performance.now());
  };
  const onTouchMove = (e) => {
    e.preventDefault?.();
    if (!getIsCharging?.() || isLaunched?.()) return;
    const t = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    const cx = (t.clientX - rect.left) * (canvas.width / rect.width);
    const cy = (t.clientY - rect.top) * (canvas.height / rect.height);
    const heroScreen = getHeroScreenPos();
    const dx = cx - heroScreen.x;
    const dy = cy - heroScreen.y;
    let angle = Math.atan2(dy, dx) * 180 / Math.PI;
    angle = Math.max(-80, Math.min(-5, angle));
    onChargeAngle?.(angle);
  };
  const onTouchEnd = () => {
    if (!isGameActive?.() || isLaunched?.() || !getIsCharging?.()) return;
    onChargeEnd?.();
    onLaunch?.();
  };

  const onBoostMouseDown = () => {
    if (!isGameActive?.() || !isLaunched?.()) return;
    if (canBoost?.()) onBoostStart?.();
  };
  const onBoostMouseUp = () => { onBoostEnd?.(); };
  const onBoostTouchStart = () => {
    if (!isGameActive?.() || !isLaunched?.()) return;
    if (canBoost?.()) onBoostStart?.();
  };
  const onBoostTouchEnd = () => { onBoostEnd?.(); };

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd);

  canvas.addEventListener('mousedown', onBoostMouseDown);
  canvas.addEventListener('mouseup', onBoostMouseUp);
  canvas.addEventListener('mouseleave', onBoostMouseUp);
  canvas.addEventListener('touchstart', onBoostTouchStart, { passive: true });
  canvas.addEventListener('touchend', onBoostTouchEnd);
  canvas.addEventListener('touchcancel', onBoostTouchEnd);

  return () => {
    canvas.removeEventListener('mousedown', onMouseDown);
    canvas.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('mouseup', onMouseUp);
    canvas.removeEventListener('touchstart', onTouchStart);
    canvas.removeEventListener('touchmove', onTouchMove);
    canvas.removeEventListener('touchend', onTouchEnd);

    canvas.removeEventListener('mousedown', onBoostMouseDown);
    canvas.removeEventListener('mouseup', onBoostMouseUp);
    canvas.removeEventListener('mouseleave', onBoostMouseUp);
    canvas.removeEventListener('touchstart', onBoostTouchStart);
    canvas.removeEventListener('touchend', onBoostTouchEnd);
    canvas.removeEventListener('touchcancel', onBoostTouchEnd);
  };
}

export function createGroundYAt(terrain, groundY) {
  return function groundYAt(wx) {
    if (!terrain?.length) return groundY;
    if (wx <= terrain[0].x) return terrain[0].y;
    for (let i = 1; i < terrain.length; i++) {
      if (wx <= terrain[i].x) {
        const t = (wx - terrain[i - 1].x) / (terrain[i].x - terrain[i - 1].x);
        return terrain[i - 1].y + t * (terrain[i].y - terrain[i - 1].y);
      }
    }
    return terrain[terrain.length - 1].y ?? groundY;
  };
}

export function createLandmarks(defs, groundYAt) {
  return (defs || []).map(d => {
    const baseY = groundYAt(d.x);
    const centerY = baseY - (d.hitH ?? 80) / 2;
    return { ...d, baseY, y: centerY, destroyed: false };
  });
}

export function spawnThrustBurst(particles, hero, velocity) {
  const count = 10;
  const speed = Math.hypot(velocity.x, velocity.y);
  const angle = speed > 0.1 ? Math.atan2(velocity.y, velocity.x) : -Math.PI / 2;
  const backAngle = angle + Math.PI;
  for (let i = 0; i < count; i++) {
    const spread = (Math.random() - 0.5) * 0.6;
    const v = 2 + Math.random() * 2;
    particles.push({
      x: hero.x - Math.cos(angle) * 18,
      y: hero.y - Math.sin(angle) * 18,
      vx: Math.cos(backAngle + spread) * v + velocity.x * 0.2,
      vy: Math.sin(backAngle + spread) * v + velocity.y * 0.2,
      life: 20 + Math.random() * 10,
      maxLife: 30,
      scale: 0.35 + Math.random() * 0.25,
    });
  }
}

export function updateParticles(particles) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.96;
    p.vy *= 0.96;
    p.life -= 1;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

export function drawParticles(ctx, particles, getAsset) {
  const img = getAsset('thrust');
  if (!img) return;
  for (const p of particles) {
    const alpha = Math.max(0, p.life / p.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha;
    const w = img.width * p.scale;
    const h = img.height * p.scale;
    ctx.drawImage(img, p.x - w / 2, p.y - h / 2, w, h);
    ctx.restore();
  }
}

export function spawnLandmarkExplosion(landmarkParticles, x, y) {
  const count = 120;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 3.5 + Math.random() * 8.5;
    landmarkParticles.push({
      x,
      y: y + (Math.random() - 0.5) * 20,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 80 + Math.random() * 120,
      maxLife: 200,
    });
  }
}

export function updateLandmarkParticles(landmarkParticles) {
  for (let i = landmarkParticles.length - 1; i >= 0; i--) {
    const p = landmarkParticles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.95;
    p.vy *= 0.95;
    p.life -= 1;
    if (p.life <= 0) landmarkParticles.splice(i, 1);
  }
}

export function drawLandmarkParticles(ctx, landmarkParticles) {
  for (const p of landmarkParticles) {
    const alpha = Math.max(0, p.life / p.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ffd27d';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

export function checkLandmarkCollisions({
  landmarks,
  hero,
  heroRadius,
  velocity,
  densityBoost,
  destroyedLandmarks,
  saveDestroyedLandmarks,
  onCoinsAward,
  onImpactFeedback,
  onSpawnExplosion,
  onEndRun,
  getNow = () => performance.now(),
} = {}) {
  if (!landmarks?.length || !hero) return;
  for (const lm of landmarks) {
    if (lm.destroyed) continue;
    const halfW = (lm.hitW ?? 48) / 2;
    const halfH = (lm.hitH ?? 80) / 2;
    const dx = hero.x - lm.x;
    const dy = hero.y - lm.y;
    if (Math.abs(dx) > halfW + heroRadius) continue;
    if (Math.abs(dy) > halfH + heroRadius) continue;

    const impact = Math.hypot(velocity.x, velocity.y);
    const breakImpact = (lm.impact ?? 6) / (densityBoost?.() ?? 1);
    const pct = Math.max(0, Math.min(1, impact / breakImpact));
    if (!lm.coinsAwarded) {
      const impactRatio = Math.min(impact / breakImpact, 2);
      const award = calculateAwardCoinsAmount(impactRatio, 'landmarkImpact');
      lm.coinsAwarded = true;
      onCoinsAward?.(award);
    }
    onImpactFeedback?.({ pct, impact, breakImpact, id: lm.id }, getNow() + 1400);

    if (impact >= breakImpact) {
      lm.destroyed = true;
      destroyedLandmarks?.add(lm.id);
      saveDestroyedLandmarks?.();
      onSpawnExplosion?.(lm.x, lm.y);
      const leftover = Math.max(0, impact - breakImpact);
      if (leftover > 0.01) {
        const inv = impact > 0.001 ? (1 / impact) : 0;
        const nx = velocity.x * inv;
        const ny = velocity.y * inv;
        velocity.x = nx * leftover;
        velocity.y = ny * leftover;
      }
      continue;
    }

    velocity.x = 0;
    velocity.y = 0;
    onEndRun?.();
    return;
  }
}

export function drawLandmarks(ctx, landmarks, getAsset) {
  for (const lm of landmarks) {
    if (lm.destroyed) continue;
    const img = getAsset(lm.id);
    const sx = lm.x;
    const sy = lm.y;
    const halfW = (lm.hitW ?? 48) / 2;
    const halfH = (lm.hitH ?? 80) / 2;
    const baseY = (lm.baseY ?? (lm.y + halfH));
    if (img) {
      const drawX = sx - img.width / 2 + (lm.texOffsetX ?? 0);
      const drawY = baseY - img.height + (lm.texOffsetY ?? 0);
      ctx.drawImage(img, drawX, drawY);
    } else {
      ctx.fillStyle = '#caa868';
      ctx.beginPath();
      const r = Math.max(lm.hitW ?? 48, lm.hitH ?? 80) / 2;
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function drawLandmarkIndicatorHUD(ctx, { landmarks, destroyedLandmarks, hero, W, H, fonts, colors } = {}) {
  if (!landmarks?.length || !hero) return;
  let target = null;
  let minAhead = Infinity;
  for (const lm of landmarks) {
    if (destroyedLandmarks?.has(lm.id)) continue;
    const dx = lm.x - hero.x;
    if (dx >= 0 && dx < minAhead) {
      minAhead = dx;
      target = lm;
    }
  }
  if (!target) return;

  const dx = target.x - hero.x;
  const dy = target.y - hero.y;
  const dist = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const boxW = sUi(170);
  const boxH = sUi(26);
  const x = W - boxW - sUi(8);
  const y = sUi(40);

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(x, y, boxW, boxH);

  const pointerOffsetX = sUi(16);
  const pointerTipX = sUi(8);
  const pointerBackX = sUi(6);
  const pointerHalfH = sUi(5);
  ctx.translate(x + pointerOffsetX, y + boxH / 2);
  ctx.rotate(angle);
  ctx.fillStyle = _resolveUIColor(colors, 'hudAccent', '#f5c542');
  ctx.beginPath();
  ctx.moveTo(pointerTipX, 0);
  ctx.lineTo(-pointerBackX, -pointerHalfH);
  ctx.lineTo(-pointerBackX, pointerHalfH);
  ctx.closePath();
  ctx.fill();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = _scaledUIFont(12, { fonts, role: 'hudMono', fallbackFamily: 'monospace' });
  ctx.fillStyle = _resolveUIColor(colors, 'hudAccent', '#f5c542');
  ctx.textAlign = 'left';
  const label = target.name ?? 'Landmark';
  ctx.fillText(`${label}: ${Math.round(dist)}m`, x + sUi(30), y + sUi(17));
  ctx.restore();
}

export function drawImpactFeedbackHUD(ctx, { impactFeedback, impactFeedbackUntil, W, fonts, colors } = {}) {
  if (!impactFeedback || performance.now() > impactFeedbackUntil) return;
  const { pct, impact, breakImpact } = impactFeedback;
  const boxW = sUi(200);
  const boxH = sUi(30);
  const x = W - boxW - sUi(8);
  const y = sUi(70);
  const barW = boxW - sUi(16);
  const barH = sUi(8);
  const barX = x + sUi(8);
  const barY = y + sUi(16);
  const pctClamped = Math.max(0, Math.min(1, pct));

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x, y, boxW, boxH);

  const hue = 120 - pctClamped * 120;
  ctx.fillStyle = `hsl(${hue}, 90%, 55%)`;
  ctx.fillRect(barX, barY, barW * pctClamped, barH);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = sUi(1);
  ctx.strokeRect(barX, barY, barW, barH);

  ctx.font = _scaledUIFont(11, { fonts, role: 'hudMono', fallbackFamily: 'monospace' });
  ctx.fillStyle = _resolveUIColor(colors, 'hudText', '#fff');
  ctx.textAlign = 'left';
  const pctText = Math.round(pctClamped * 100);
  const shownImpact = Math.min(impact, breakImpact);
  ctx.fillText(`Impact ${pctText}%  (${shownImpact.toFixed(1)}/${breakImpact.toFixed(1)})`, x + sUi(8), y + sUi(12));
  ctx.restore();
}

export function drawChargeBar(ctx, { W, H, chargeStart, fonts, colors } = {}) {
  const elapsed = performance.now() - chargeStart;
  const pct = Math.min(1, elapsed / 1500);
  const bx = W / 2 - sUi(80), by = H - sUi(40), bw = sUi(160), bh = sUi(18);

  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
  const col = pct < 0.5 ? `hsl(${120 - pct * 240},100%,50%)` : `hsl(${120 - pct * 240},100%,50%)`;
  ctx.fillStyle = col;
  ctx.fillRect(bx, by, bw * pct, bh);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = sUi(1);
  ctx.strokeRect(bx, by, bw, bh);
  ctx.font = _scaledUIFont(11, { fonts, role: 'hudMono', weight: 'bold', fallbackFamily: 'monospace' });
  ctx.fillStyle = _resolveUIColor(colors, 'hudText', '#fff');
  ctx.textAlign = 'center';
  ctx.fillText('CHARGE — RELEASE TO FIRE', W / 2, by - sUi(6));
}

export function drawAimIndicator(ctx, { LAUNCH_X, LAUNCH_Y, chargeAngle, W, H, camera, getAsset, fonts, colors } = {}) {
  const worldScale = Math.max(1, window.UI_SCALE || 1);
  const heroScreenX = (LAUNCH_X - camera.x) * worldScale;
  const heroScreenY = (LAUNCH_Y - camera.y) * worldScale;
  const arrowAsset = getAsset('ui-arrow');
  if (!arrowAsset) return;
  const rad = chargeAngle * Math.PI / 180;
  const len = sUi(60);
  const ax = heroScreenX + Math.cos(rad) * len;
  const ay = heroScreenY + Math.sin(rad) * len - sUi(40);
  const drawW = arrowAsset.width * worldScale;
  const drawH = arrowAsset.height * worldScale;

  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(rad);
  ctx.drawImage(arrowAsset, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();


  ctx.font = _scaledUIFont(11, { fonts, role: 'hudMono', fallbackFamily: 'monospace' });
  ctx.fillStyle = _resolveUIColor(colors, 'hudHint', 'rgba(255,255,255,0.8)');
  ctx.textAlign = 'center';
  ctx.fillText('HOLD to charge · DRAG to aim', W / 2, H - sUi(16));
}

export function drawHUD(ctx, {
  tracker,
  moonUnlocked,
  bestDist,
  coins,
  W,
  H,
  launched,
  rocketAttached,
  fuelMax,
  fuelLeft,
  showFuelBar,
  velocity,
  maxSpeed,
  isCharging,
  chargeStart,
  chargeAngle,
  camera,
  LAUNCH_X,
  LAUNCH_Y,
  landmarks,
  destroyedLandmarks,
  hero,
  impactFeedback,
  impactFeedbackUntil,
  getAsset,
  fonts,
  colors,
} = {}) {
  const stats = tracker?.getStats() ?? { maxDist: 0, maxHeight: 0, phase: 'horizontal' };
  const phase = moonUnlocked ? 'vertical' : 'horizontal';

  ctx.save();
  ctx.font = _scaledUIFont(13, { fonts, role: 'hudMono', weight: 'bold', fallbackFamily: 'monospace' });
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(sUi(8), sUi(8), sUi(260), sUi(26));
  ctx.fillStyle = phase === 'vertical'
    ? _resolveUIColor(colors, 'hudObjectiveVertical', '#f5c542')
    : _resolveUIColor(colors, 'hudObjectiveHorizontal', '#8ecfff');
  const objText = phase === 'vertical'
    ? `🌕 REACH THE MOON  ↑ ${Math.round(tracker?.getStats().maxHeight ?? 0)}m`
    : `→ DISTANCE: ${Math.round(stats.maxDist)}m  (best: ${bestDist}m)`;
  ctx.fillText(objText, sUi(14), sUi(26));
  ctx.restore();

  ctx.save();
  ctx.font = _scaledUIFont(13, { fonts, role: 'hudMono', weight: 'bold', fallbackFamily: 'monospace' });
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(W - sUi(120), sUi(8), sUi(112), sUi(26));
  ctx.fillStyle = _resolveUIColor(colors, 'hudAccent', '#f5c542');
  ctx.fillText(`🪙 ${coins}`, W - sUi(12), sUi(26));
  ctx.restore();

  drawLandmarkIndicatorHUD(ctx, { landmarks, destroyedLandmarks, hero, W, H, fonts, colors });
  drawImpactFeedbackHUD(ctx, { impactFeedback, impactFeedbackUntil, W, fonts, colors });

  if (launched && (rocketAttached || showFuelBar) && fuelMax > 0) {
    const gx = sUi(10), gy = H - sUi(26), gw = sUi(140), gh = sUi(10);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(gx - sUi(2), gy - sUi(2), gw + sUi(4), gh + sUi(4));
    const pct = Math.max(0, Math.min(1, fuelLeft / fuelMax));
    ctx.fillStyle = '#ff6a00';
    ctx.fillRect(gx, gy, gw * pct, gh);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = sUi(1);
    ctx.strokeRect(gx, gy, gw, gh);
    ctx.font = _scaledUIFont(10, { fonts, role: 'hudMono', fallbackFamily: 'monospace' });
    ctx.fillStyle = _resolveUIColor(colors, 'hudText', '#fff');
    ctx.fillText('FUEL', gx + gw + sUi(8), gy + gh - sUi(1));
  }

  if (!launched && isCharging) {
    drawChargeBar(ctx, { W, H, chargeStart, fonts, colors });
  }

  if (!launched) {
    drawAimIndicator(ctx, { LAUNCH_X, LAUNCH_Y, chargeAngle, W, H, camera, getAsset, fonts, colors });
  }

  // Speedometer (bottom-right)
  try {
    if (velocity && typeof maxSpeed === 'number' && isFinite(maxSpeed)) {
      const sp = Math.hypot(velocity.x || 0, velocity.y || 0);
      const ratio = sp / Math.max(0.0001, maxSpeed);
      const cx = W - sUi(12) - sUi(36);
      const cy = H - sUi(12) - sUi(36);
      const r = sUi(28);

      // background
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.arc(cx, cy, r + sUi(6), 0, Math.PI * 2);
      ctx.fill();

      // gauge arc: green up to cap, red beyond
      const fullSweep = (3 / 2) * Math.PI; // 270deg
      const startAngle = -3 / 4 * Math.PI; // -135deg
      const capped = Math.min(1, ratio);
      const over = Math.max(0, Math.min(0.5, ratio - 1));

      // green/amber arc up to cap
      ctx.lineWidth = sUi(6);
      ctx.lineCap = 'round';
      ctx.strokeStyle = ratio <= 1 ? '#7ed957' : '#f5c542';
      ctx.beginPath();
      ctx.arc(cx, cy, r, startAngle, startAngle + fullSweep * capped, false);
      ctx.stroke();

      // red arc for overspeed
      if (over > 0) {
        ctx.strokeStyle = '#ff4b4b';
        ctx.beginPath();
        ctx.arc(cx, cy, r, startAngle + fullSweep * 1, startAngle + fullSweep * (1 + over), false);
        ctx.stroke();
      }

      // needle
      const needleRatio = Math.min(1.5, ratio);
      const angle = startAngle + fullSweep * (needleRatio / 1.5);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = sUi(2);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * (r - sUi(8)), cy + Math.sin(angle) * (r - sUi(8)));
      ctx.stroke();

      // readout
      ctx.font = _scaledUIFont(11, { fonts, role: 'hudMono', weight: 'bold', fallbackFamily: 'monospace' });
      ctx.fillStyle = _resolveUIColor(colors, 'hudText', '#fff');
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(sp)}m/s`, cx, cy + sUi(6));
      ctx.font = _scaledUIFont(9, { fonts, role: 'hudMono', fallbackFamily: 'monospace' });
      ctx.fillText('SPD', cx, cy + sUi(18));
      ctx.restore();
    }
  } catch (e) { /* ignore */ }
}

export function drawCharacterSprite(ctx, c, getAsset, offsetY = 0) {
  const id = c.spriteIdFormat
    .replace('ANIMATION', c.animationState)
    .replace('FRAME', ~~c.animationFrame);
  const asset = getAsset(id);
  if (asset) {
    ctx.drawImage(asset,
      c.x - asset.width / 2,
      c.y - asset.height / 2 + offsetY,
      asset.width,
      asset.height);
  } else {
    c.draw();
  }
}

export function drawCharacterWithRocket(ctx, c, {
  hero,
  rocketAttached,
  gliderAssetId,
  gliderActive,
  gliderAngle,
  velocity,
  getAsset,
  HERO_DRAW_OFFSET_Y,
} = {}) {
  const drawOffset = c === hero ? HERO_DRAW_OFFSET_Y : 0;
  if (c !== hero) {
    drawCharacterSprite(ctx, c, getAsset, drawOffset);
    return;
  }

  if (gliderAssetId && gliderActive) {
    const glider = getAsset(gliderAssetId);
    if (glider) {
      const speed = Math.hypot(velocity?.x ?? 0, velocity?.y ?? 0);
      const angle = (typeof gliderAngle === 'number' && isFinite(gliderAngle))
        ? gliderAngle
        : (speed > 0.1 ? Math.atan2(velocity.y, velocity.x) : 0);
      const id = c.spriteIdFormat
        .replace('ANIMATION', c.animationState)
        .replace('FRAME', ~~c.animationFrame);
      const asset = getAsset(id);
      if (asset) {
        // Shared rotation anchor: rotate both hero and glider around hero center
        // so they stay locked together while turning.
        const anchorX = c.x;
        const anchorY = c.y + drawOffset;
        const gliderLocalX = 0;
        const gliderLocalY = -28;

        ctx.save();
        ctx.translate(anchorX, anchorY);
        ctx.rotate(angle);
        ctx.drawImage(glider, gliderLocalX - glider.width / 2, gliderLocalY - glider.height / 2);
        ctx.drawImage(asset, -asset.width / 2, -asset.height / 2, asset.width, asset.height);
        ctx.restore();
        return;
      }
    }
  }

  if (rocketAttached) {
    const rocket = getAsset('rocket');
    if (rocket) {
      const offsetX = -20;
      const offsetY = 10;
      const speed = Math.hypot(velocity.x, velocity.y);
      const angle = speed > 0.1 ? Math.atan2(velocity.y, velocity.x) : 0;
      ctx.save();
      ctx.translate(c.x + offsetX, c.y + offsetY + drawOffset);
      ctx.rotate(angle);
      ctx.drawImage(rocket, -rocket.width / 2, -rocket.height / 2);
      ctx.restore();
    }
  }

  drawCharacterSprite(ctx, c, getAsset, drawOffset);
}

const _pregameAnimCache = { idle: null, blink: null, eating: null, _prevEatingFrame: -1 };
const _introEntityCache = { initialized: false };

function _getAnimFrames(prefix, count, getAsset) {
  const frames = [];
  for (let i = 0; i < count; i++) {
    const img = getAsset(`${prefix}-${i}`);
    if (img) frames.push(img);
  }
  return frames.length ? frames : null;
}

export function drawPregamePeek(ctx, { getAsset, W, H }) {
  // Build animated sprites and a scene entity that manages the idle/blink/eating cycle.
  if (!_pregameAnimCache._initialized) {
    // build frame id arrays (AnimatedSprite expects asset ids)
    const idleIds = [];
    for (let i = 0; i < 4; i++) idleIds.push(`hero-idle-${i}`);
    const blinkIds = [];
    for (let i = 0; i < 12; i++) blinkIds.push(`hero-blink-${i}`);
    const eatingIds = [];
    for (let i = 0; i < 12; i++) eatingIds.push(`hero-eating-${i}`);

    const idleFps = 5;
    const blinkFps = 18;
    const eatingFps = 10;

    const sprite = new AnimatedSprite();
    sprite.addAnimation('idle', idleIds, idleFps, true);
    sprite.addAnimation('blink', blinkIds, blinkFps, false);
    sprite.addAnimation('eating', eatingIds, eatingFps, false);
    sprite.changeAnimation('idle', true);

    // controller entity
    const ent = new SceneEntity({
      x: 0, y: 0, layer: 0, interactive: true
    });

    ent._scale = 1.2;
    ent._prevEatingFrame = -1;

    ent.updateFn = (self, dt) => {
      const viewW = refs.canvas?.width || W;
      const viewH = refs.canvas?.height || H;
      // compute home position if not set
      {
        const imgId = sprite.getFrameId();
        const img = getAsset(imgId);
        if (img) {
          const scale = (self._scale || 1) * UI_SCALE;
          const w = img.width * scale;
          const h = img.height * scale;
          self._homeX = viewW - w * 1;
          self._homeY = viewH - h * 0.9;
          self._homeW = w; self._homeH = h;
          self._homeComputed = true;
        }
      }

      // flying behavior
      if (self._flying) {
        // dt is ms
        const s = (typeof dt === 'number') ? dt / 1000 : (1 / 60);
        self.x += (self._vx || 0) * s;
        self.y += (self._vy || 0) * s;
        self._rotation = (self._rotation || 0) + (self._angVel || 0) * s;

        // check offscreen
        const offLeft = self.x + (self._homeW || 0) < -50;
        const offRight = self.x > viewW + 50;
        const offTop = self.y + (self._homeH || 0) < -50;
        const offBottom = self.y > viewH + 50;
        if ((offLeft || offRight || offTop || offBottom) && !self._offscreenHandled) {
          self._offscreenHandled = true;
          self._visible = false;
          // schedule return after 5s
          setTimeout(() => {
            self._visible = true;
            self._flying = false;
            self._offscreenHandled = false;
            self._rotation = 0;
            // reset to home
            if (typeof self._homeX === 'number') { self.x = self._homeX; self.y = self._homeY; }
            sprite.changeAnimation('idle', true);
            self._activeSprite = sprite;
            self._prevEatingFrame = -1;
          }, 5000);
        }
        return;
      }

      // normal cycle
      const blinkMs = (blinkIds.length / blinkFps) * 1000;
      const idleMs = (idleIds.length / idleFps) * 1000;
      const eatingMs = (eatingIds.length / eatingFps) * 1000;
      const cycleMs = blinkMs + idleMs + eatingMs + idleMs;
      const t = performance.now() % cycleMs;

      // decide which named animation should be active
      let activeName = 'idle';
      if (t < blinkMs) activeName = 'blink';
      else if (t < blinkMs + idleMs) activeName = 'idle';
      else if (t < blinkMs + idleMs + eatingMs) activeName = 'eating';
      else activeName = 'idle';

      if (sprite.currentAnim !== activeName) sprite.changeAnimation(activeName, true);
      sprite.update(dt);

      if (sprite.currentAnim === 'eating') {
        const fi = sprite.frameIndex;
        if (fi === 3 && self._prevEatingFrame !== 3) {
          try { triggerSoundEvent('eating'); } catch (e) { }
        }
        self._prevEatingFrame = fi;
      } else {
        self._prevEatingFrame = -1;
      }

      self._activeSprite = sprite;
      // keep coords at home when not flying
      if (self._homeComputed) { self.x = self._homeX; self.y = self._homeY; }
    };

    ent.drawFn = (self, ctx) => {
      const viewW = refs.canvas?.width || W;
      const viewH = refs.canvas?.height || H;
      const id = sprite.getFrameId();
      const img = getAsset(id);
      if (!img) return;
      const scale = (self._scale || 1) * UI_SCALE;
      const w = img.width * scale;
      const h = img.height * scale;

      // during flight, use ent.x/ent.y and rotation
      if (self._flying) {
        const rx = self.x + w / 2;
        const ry = self.y + h / 2;
        ctx.save();
        ctx.translate(rx, ry);
        ctx.rotate(self._rotation || 0);
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
        ctx.restore();
        return;
      }

      const peekX = self.x ?? (viewW - w * 1);
      const peekY = self.y ?? (viewH - h * 0.9);
      self.hitBox = { x: 0, y: 0, w: w, h: h };
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, viewW, viewH);
      ctx.clip();
      ctx.drawImage(img, peekX, peekY, w, h);
      ctx.restore();
    };

    ent.onPointerDown = ({ x, y }) => {
      console.log("pointer", x, y);
      // If already flying, ignore
      if (ent._flying) return;
      // immediately switch to eating sprite animation
      try { sprite.changeAnimation('eating', true); ent._activeSprite = sprite; } catch (e) { }
      try { triggerSoundEvent('eating'); } catch (e) { }
      ent._flying = true;
      ent._offscreenHandled = false;
      // random velocity: mostly upward and sideways
      const dir = Math.random() > 0.5 ? 1 : -1;
      ent._vx = dir * (200 + Math.random() * 200);
      ent._vy = -(150 + Math.random() * 200);
      ent._angVel = (Math.random() * 6 - 3); // radians per second
      // ensure home computed so x/y are valid
      if (!ent._homeComputed) {
        const viewW = refs.canvas?.width || W;
        const viewH = refs.canvas?.height || H;
        const imgId = sprite.getFrameId();
        const img = getAsset(imgId);
        if (img) {
          const scale = (ent._scale || 1) * UI_SCALE;
          ent._homeW = img.width * scale; ent._homeH = img.height * scale;
          ent._homeX = viewW - ent._homeW * 1;
          ent._homeY = viewH - ent._homeH * 0.9;
          ent._homeComputed = true;
        }
      }
      // set current position to home before launching
      ent.x = ent._homeX; ent.y = ent._homeY;
    };

    addSceneEntity('pregame', ent);
    _pregameAnimCache._initialized = true;
  }

  const now = performance.now();
  const last = _pregameAnimCache._lastTime || now;
  const dt = Math.min(1000 / 30, now - last);
  _pregameAnimCache._lastTime = now;
  const entities = getSceneEntities('pregame');
  for (const e of entities) {
    if (e._visible === false) continue;
    try { e.update(dt); } catch (err) { console.error('entity update error', err); }
    try { e.draw(ctx); } catch (err) { console.error('entity draw error', err); }
  }
}

const _cloudStripCache = new Map();

const CLOUD_DRIFT_SPEED = 12; // pixels per second, positive moves clouds left on screen
function _seedFromString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function _makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xFFFFFFFF;
  };
}

function _getCloudStrip(assetIds, stripW, stripH, density, getAsset) {
  const key = `${assetIds.join('|')}|${stripW}|${stripH}|${density}`;
  if (_cloudStripCache.has(key)) return _cloudStripCache.get(key);

  const strip = document.createElement('canvas');
  strip.width = stripW;
  strip.height = stripH;
  const sctx = strip.getContext('2d');
  const rng = _makeRng(_seedFromString(key));

  const imgs = assetIds.map(id => getAsset(id)).filter(Boolean);
  if (!imgs.length) return null;

  for (let i = 0; i < density; i++) {
    const img = imgs[Math.floor(rng() * imgs.length)];
    const scale = 0.5 + rng() * 0.7;
    const w = img.width * scale;
    const h = img.height * scale;
    const x = rng() * Math.max(1, (stripW - w));
    const y = rng() * Math.max(1, (stripH - h));
    sctx.globalAlpha = 0.5 + rng() * 0.5;
    sctx.drawImage(img, x, y, w, h);
  }

  _cloudStripCache.set(key, strip);
  return strip;
}

export function drawBackground(ctx, {
  camera,
  W,
  H,
  GROUND_Y,
  terrain,
  getAsset,
  moonUnlocked,
}) {
  const camX = camera.x;
  const camY = camera.y;

  const heightAboveGround = Math.max(0, (GROUND_Y - H) - camY);
  const skyT = Math.min(1, heightAboveGround / 5000);
  const sky1 = lerpColor([100, 160, 255], [10, 10, 40], skyT);
  const sky2 = lerpColor([60, 120, 220], [0, 0, 15], skyT);
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, sky1);
  grad.addColorStop(1, sky2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  if (skyT > 0.2) drawStars(ctx, camX, camY, skyT, W, H);

  drawCloudLayers(ctx, ['bg-cloud-1', 'bg-cloud-2', 'bg-cloud-3'],
    camX, camY, 0.12, H * 0.5, 0.04, 0.85 - skyT * 0.6, getAsset, W);

  if (moonUnlocked || skyT > 0.4) {
    drawMoonInSky(ctx, camX, camY, skyT, W, H, getAsset);
  }

  drawParallaxLayer(ctx, 'bg-hills-far', camX, camY, 0.15, H - 160, 0.6, getAsset, W);
  drawParallaxLayer(ctx, 'bg-hills-near', camX, camY, 0.35, H - 90, 0.8, getAsset, W);

  const padAsset = getAsset('bg-launchpad');
  if (padAsset) {
    ctx.drawImage(padAsset, 60 - camX, GROUND_Y - padAsset.height - camY);
  } else {
    ctx.fillStyle = '#8B7355';
    ctx.fillRect(60 - camX, GROUND_Y - 60 - camY, 120, 60);
    ctx.fillStyle = '#6B5335';
    ctx.fillRect(80 - camX, GROUND_Y - 90 - camY, 20, 90);
  }

  drawTerrain(ctx, camX, camY, terrain, W, H, getAsset);
}

export function drawTerrain(ctx, camX, camY, terrain, W, H, getAsset) {
  if (terrain.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(terrain[0].x - camX, terrain[0].y - camY);
  for (let i = 1; i < terrain.length; i++) {
    ctx.lineTo(terrain[i].x - camX, terrain[i].y - camY);
  }
  ctx.lineTo(terrain[terrain.length - 1].x - camX, H + 50);
  ctx.lineTo(terrain[0].x - camX, H + 50);
  ctx.closePath();

  const dirtAsset = getAsset('terrain-dirt');
  if (dirtAsset) {
    const pat = ctx.createPattern(dirtAsset, 'repeat');
    if (pat?.setTransform) {
      pat.setTransform(new DOMMatrix().translate(-camX, -camY));
    }
    ctx.fillStyle = pat;
  } else {
    ctx.fillStyle = '#7B5E3A';
  }
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(terrain[0].x - camX, terrain[0].y - camY);
  for (let i = 1; i < terrain.length; i++) {
    ctx.lineTo(terrain[i].x - camX, terrain[i].y - camY);
  }
  ctx.strokeStyle = '#4A8C3F';
  ctx.lineWidth = 6;
  ctx.stroke();

  const grassAsset = getAsset('terrain-grass');
  if (grassAsset) {
    const targetH = 32;
    const gScale = Math.min(1, targetH / grassAsset.height);
    const gw = grassAsset.width * gScale;
    const gh = grassAsset.height * gScale;
    for (let i = 0; i < terrain.length; i++) {
      const sx = terrain[i].x - camX;
      const sy = terrain[i].y - camY;
      if (sx < -64 || sx > W + 64) continue;
      ctx.drawImage(grassAsset, sx - gw / 2, sy - gh, gw, gh);
    }
  }
}

export function drawParallaxLayer(ctx, assetId, camX, camY, parallaxX, baseScreenY, parallaxY, getAsset, W) {
  const img = getAsset(assetId);
  if (!img) return;
  const offsetX = (camX * parallaxX) % img.width;
  const offsetY = camY * parallaxY;
  const screenY = baseScreenY - offsetY;
  for (let x = -offsetX; x < W + img.width; x += img.width) {
    ctx.drawImage(img, x, screenY);
  }
}

export function drawCloudLayers(ctx, assetIds, camX, camY, parallaxX, baseScreenY, parallaxY, alpha, getAsset, W) {
  if (!assetIds?.length || alpha <= 0) return;
  const imgs = assetIds.map(id => getAsset(id)).filter(Boolean);
  if (!imgs.length) return;
  const maxSize = Math.max(...imgs.map(img => Math.max(img.width, img.height)));
  const stripW = Math.max(W, 800);
  const stripH = Math.ceil(maxSize * 1.4);
  const density = 10;
  const strip = _getCloudStrip(assetIds, stripW, stripH, density, getAsset);
  if (!strip) return;
  const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const timeDrift = (nowMs / 1000) * CLOUD_DRIFT_SPEED;
  const offsetX = ((camX * parallaxX) + timeDrift) % stripW;
  const offsetY = camY * parallaxY;
  const screenY = baseScreenY - offsetY - stripH * 0.5;

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  for (let x = -offsetX; x < W + stripW; x += stripW) {
    ctx.drawImage(strip, x, screenY);
  }
  ctx.restore();
}

export function drawStars(ctx, camX, camY, alpha, W, H) {
  ctx.fillStyle = `rgba(255,255,255,${Math.min(1, alpha * 1.5)})`;
  for (let i = 0; i < 80; i++) {
    const sx = ((i * 137.508 + camX * 0.02) % W + W) % W;
    const sy = ((i * 97.31 + camY * 0.02) % H + H) % H;
    const r = (i % 3 === 0) ? 1.5 : 1;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawMoonInSky(ctx, camX, camY, skyT, W, H, getAsset) {
  const moonX = W * 0.78 - camX * 0.03;
  const moonY = H * 0.14 - camY * 0.05;
  const moonAlpha = Math.min(1, skyT * 2);

  const moonAsset = getAsset('bg-moon');
  ctx.save();
  ctx.globalAlpha = moonAlpha;
  if (moonAsset) {
    ctx.drawImage(moonAsset, moonX - moonAsset.width / 2, moonY - moonAsset.height / 2, 120, 120);
  } else {
    ctx.fillStyle = '#F0EAD6';
    ctx.beginPath();
    ctx.arc(moonX, moonY, 40, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

export function lerpColor(a, b, t) {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

export function easeInCubic(t) {
  return t * t * t;
}