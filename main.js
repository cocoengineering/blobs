import * as blobs2Animate from "blobs/v2/animate";

// ─── State ───────────────────────────────────────────────────────────
const state = {
  // Blob shape
  extraPoints: 5,
  randomness: 8,
  size: 250,
  randomSeed: 12345,
  // Blob animation
  duration: 2000,
  timingFunction: "ease",
  // Blob appearance
  color1: "#5ce1e6",
  color2: "#ffffff",
  color3: "#c4b5fd",
  opacity: 80,
  edgeBlur: 20,
  glowIntensity: 60,
  blendMode: "source-over",
  // Blob position (percentage, 50 = centered)
  xPos: 50,
  yPos: 50,
  // Audio
  energy: 0.5,
  sensitivity: 3.0,
  smoothing: 0.85,
  audioSource: "",    // "" = manual, or file path
  // Reactivity channels (which outputs energy drives)
  reactivity: {
    morphSpeed: true,
    scale: true,
    glow: true,
    blur: false,
    brightness: false,
  },
  reactivityAmount: 60, // 0-100, global intensity multiplier
  // Background
  bgStyle: "wavyMesh", // "wavyMesh" | "meshGradient" | "linear" | "radial" | "solid"
  bgColor1: "#7b8cde", // base
  bgColor2: "#a5b4f0", // mid
  bgColor3: "#c8c0e8", // accent
  bgColor4: "#ffd9a8",
  bgColor5: "#4a45ff",
  bgAngle: 160,
  bgSpeed: 30,         // 0-100
  bgComplexity: 4,     // 2-8 orbs for mesh
  bgWaveScale: 55,     // 20-120 mesh softness/spread
  bgEdge: 55,          // 0-100 directional bias
  bgDrift: 28,         // 0-100 mesh-gradient flow amount
  bgGrain: 12,         // 0-40
};

const defaultState = structuredClone(state);
const URL_PARAM_STATE = "s";
const URL_SYNC_DEBOUNCE_MS = 120;
const URL_EXCLUDED_KEYS = new Set(["energy"]);
let urlSyncTimer = null;

function normalizeSeed(seed) {
  const n = Number(seed);
  if (!Number.isFinite(n)) return 0;
  return (Math.trunc(n) >>> 0);
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function createSeededRng(tag) {
  const seed = normalizeSeed(state.randomSeed) ^ (tag >>> 0);
  return mulberry32(seed);
}

let blobSeedRng = createSeededRng(0x9e3779b9);
function reseedBlobRng() {
  blobSeedRng = createSeededRng(0x9e3779b9);
}

function stableStateSnapshot() {
  return {
    ...state,
    reactivity: { ...state.reactivity },
  };
}

function serializableState() {
  const snapshot = stableStateSnapshot();
  for (const key of URL_EXCLUDED_KEYS) {
    delete snapshot[key];
  }
  return snapshot;
}

function encodeStateToBase64Url(value) {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeStateFromBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLength);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json);
}

function coerceValue(value, template) {
  if (typeof template === "number") {
    const n = Number(value);
    return Number.isFinite(n) ? n : template;
  }
  if (typeof template === "boolean") {
    return Boolean(value);
  }
  if (typeof template === "string") {
    return typeof value === "string" ? value : template;
  }
  return value;
}

function normalizeLoadedState(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const next = stableStateSnapshot();
  for (const [key, templateValue] of Object.entries(defaultState)) {
    if (key === "energy") continue;
    if (key === "reactivity") continue;
    if (candidate[key] !== undefined) {
      next[key] = coerceValue(candidate[key], templateValue);
    }
  }

  if (candidate.reactivity && typeof candidate.reactivity === "object") {
    for (const [channel, defaultValue] of Object.entries(defaultState.reactivity)) {
      if (candidate.reactivity[channel] !== undefined) {
        next.reactivity[channel] = coerceValue(candidate.reactivity[channel], defaultValue);
      }
    }
  }

  next.randomSeed = normalizeSeed(next.randomSeed);
  return next;
}

function applyStatePatch(patch) {
  Object.assign(state, patch);
  if (patch.reactivity) {
    Object.assign(state.reactivity, patch.reactivity);
  }
}

function updateUrlFromState() {
  const params = new URLSearchParams(window.location.search);
  const encoded = encodeStateToBase64Url(serializableState());
  params.set(URL_PARAM_STATE, encoded);
  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  window.history.replaceState({}, "", nextUrl);
}

function scheduleUrlSync() {
  if (urlSyncTimer) clearTimeout(urlSyncTimer);
  urlSyncTimer = setTimeout(() => {
    urlSyncTimer = null;
    updateUrlFromState();
  }, URL_SYNC_DEBOUNCE_MS);
}

function loadStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get(URL_PARAM_STATE);
  if (!raw) return false;
  try {
    const parsed = decodeStateFromBase64Url(raw);
    const normalized = normalizeLoadedState(parsed);
    if (!normalized) return false;
    applyStatePatch(normalized);
    return true;
  } catch (error) {
    console.warn("Unable to restore state from URL", error);
    return false;
  }
}

// ─── DOM refs ────────────────────────────────────────────────────────
const blobCanvas = document.getElementById("blobCanvas");
const blobCtx = blobCanvas.getContext("2d");
const glowEl = document.getElementById("blobGlow");
const blobContainer = document.querySelector(".phone-blob-container");
const bgCanvas = document.getElementById("bgCanvas");
const bgCtx = bgCanvas.getContext("2d");
const grainEl = document.querySelector(".phone-grain");

// ─── Resize background canvas to match phone screen ─────────────────
function resizeBgCanvas() {
  const screen = bgCanvas.parentElement;
  bgCanvas.width = screen.clientWidth;
  bgCanvas.height = screen.clientHeight;
}
resizeBgCanvas();
window.addEventListener("resize", resizeBgCanvas);

// ─── Background: animated mesh gradient ──────────────────────────────
// Each "orb" is a large, soft radial gradient circle that drifts slowly.

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function hexToRgba(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const TAU = Math.PI * 2;

// Blend two hex colors, t in [0,1]
function lerpColor(hex1, hex2, t) {
  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

// Seeded orb positions (regenerated when complexity changes)
let orbs = [];
function generateOrbs(count) {
  const rand = createSeededRng(0x243f6a88 ^ (count >>> 0));
  orbs = [];
  for (let i = 0; i < count; i++) {
    orbs.push({
      // Normalized center position [0-1]
      x: 0.15 + rand() * 0.7,
      y: 0.1 + rand() * 0.8,
      // Drift parameters (radians/sec)
      phaseX: rand() * Math.PI * 2,
      phaseY: rand() * Math.PI * 2,
      freqX: 0.3 + rand() * 0.5,
      freqY: 0.2 + rand() * 0.4,
      driftX: 0.04 + rand() * 0.08,
      driftY: 0.03 + rand() * 0.07,
      // Which color pool to use (0-4 maps to bg colors)
      colorIdx: i % 5,
      // Radius as fraction of canvas diagonal
      radius: 0.25 + rand() * 0.25,
      // Individual opacity
      alpha: 0.5 + rand() * 0.4,
      // Directional/shape seeds for mesh variants
      stretchSeed: rand(),
      tiltSeed: (rand() - 0.5) * 1.4,
      pulseSeed: rand() * TAU,
    });
  }
}
function getBgPointCount(style = state.bgStyle) {
  return style === "meshGradient" ? state.bgComplexity + 4 : state.bgComplexity;
}

loadStateFromUrl();
reseedBlobRng();
generateOrbs(getBgPointCount());

function drawEllipticalOrb(x, y, radius, color, alpha, stretch, angle) {
  bgCtx.save();
  bgCtx.translate(x, y);
  bgCtx.rotate(angle);
  bgCtx.scale(stretch, 1);
  const grad = bgCtx.createRadialGradient(0, 0, 0, 0, 0, radius);
  grad.addColorStop(0, hexToRgba(color, alpha));
  grad.addColorStop(0.55, hexToRgba(color, alpha * 0.35));
  grad.addColorStop(1, hexToRgba(color, 0));
  bgCtx.fillStyle = grad;
  bgCtx.fillRect(-radius, -radius, radius * 2, radius * 2);
  bgCtx.restore();
}

let meshBufferCanvas = null;
let meshBufferCtx = null;
let meshBufferImage = null;

function ensureMeshBuffer(w, h) {
  const base = 72 + state.bgComplexity * 18;
  const rw = Math.max(72, base);
  const rh = Math.max(72, Math.round((h / Math.max(1, w)) * base));

  if (!meshBufferCanvas) {
    meshBufferCanvas = document.createElement("canvas");
    meshBufferCtx = meshBufferCanvas.getContext("2d", { willReadFrequently: true });
  }
  if (meshBufferCanvas.width !== rw || meshBufferCanvas.height !== rh || !meshBufferImage) {
    meshBufferCanvas.width = rw;
    meshBufferCanvas.height = rh;
    meshBufferImage = meshBufferCtx.createImageData(rw, rh);
  }
}

function drawWavyMesh({ t, w, h }) {
  const colors = [state.bgColor1, state.bgColor2, state.bgColor3];
  const diag = Math.sqrt(w * w + h * h);
  bgCtx.fillStyle = colors[0];
  bgCtx.fillRect(0, 0, w, h);

  bgCtx.globalCompositeOperation = "screen";
  for (const orb of orbs) {
    const ox = (orb.x + Math.sin(t * orb.freqX + orb.phaseX) * orb.driftX) * w;
    const oy = (orb.y + Math.cos(t * orb.freqY + orb.phaseY) * orb.driftY) * h;
    const radius = orb.radius * diag;
    const color = colors[orb.colorIdx % colors.length];

    const grad = bgCtx.createRadialGradient(ox, oy, 0, ox, oy, radius);
    grad.addColorStop(0, hexToRgba(color, orb.alpha));
    grad.addColorStop(0.6, hexToRgba(color, orb.alpha * 0.3));
    grad.addColorStop(1, hexToRgba(color, 0));
    bgCtx.fillStyle = grad;
    bgCtx.fillRect(0, 0, w, h);
  }
  bgCtx.globalCompositeOperation = "source-over";
}

function drawMeshGradient({ t, w, h }) {
  const colors = [state.bgColor1, state.bgColor2, state.bgColor3, state.bgColor4, state.bgColor5].map(hexToRgb);
  const angle = state.bgAngle * Math.PI / 180;
  const softness = state.bgWaveScale / 100;
  const edge = state.bgEdge / 100;
  const flow = state.bgDrift / 100;
  const speed = state.bgSpeed / 100;
  const flowScale = flow * (0.25 + speed * 0.95);

  ensureMeshBuffer(w, h);
  const rw = meshBufferCanvas.width;
  const rh = meshBufferCanvas.height;
  const data = meshBufferImage.data;

  const sigma = 0.12 + softness * 0.26;
  const sharp = 0.85 + edge * 2.0;
  const invSigma2 = 1 / (2 * sigma * sigma);
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const curveAmount = 0.01 + flowScale * 0.07 + softness * 0.02;

  const pointCount = Math.max(5, Math.min(orbs.length, state.bgComplexity + 4));
  const points = [];
  for (let i = 0; i < pointCount; i++) {
    const orb = orbs[i];
    const px = orb.x
      + Math.sin(t * (0.35 + orb.freqX * 0.45) + orb.phaseX) * orb.driftX * (0.9 + flowScale)
      + Math.cos(t * 0.21 + orb.pulseSeed) * Math.cos(angle) * flowScale * 0.08;
    const py = orb.y
      + Math.cos(t * (0.28 + orb.freqY * 0.4) + orb.phaseY) * orb.driftY * (0.9 + flowScale)
      + Math.sin(t * 0.18 + orb.pulseSeed) * Math.sin(angle) * flowScale * 0.08;
    points.push({
      x: px,
      y: py,
      color: colors[orb.colorIdx % colors.length],
    });
  }

  let k = 0;
  for (let y = 0; y < rh; y++) {
    const ny = y / Math.max(1, rh - 1);
    for (let x = 0; x < rw; x++) {
      const nx = x / Math.max(1, rw - 1);
      // Domain-warp the sampling coordinates to bend otherwise straight separators
      // into curved, flowing boundaries.
      const warpX =
        Math.sin((ny * (2.8 + edge * 2.2) + t * (0.28 + flowScale * 0.5)) * TAU + cosA * 1.7) * curveAmount
        + Math.sin((nx * (1.6 + softness * 1.6) - t * 0.19) * TAU + 0.7) * curveAmount * 0.6;
      const warpY =
        Math.cos((nx * (2.4 + edge * 1.8) - t * (0.24 + flowScale * 0.45)) * TAU + sinA * 1.4) * curveAmount
        + Math.sin((ny * (1.4 + softness * 1.9) + t * 0.16) * TAU + 1.3) * curveAmount * 0.55;
      const sx = nx + warpX;
      const sy = ny + warpY;

      let sumW = 0;
      let maxW = 0;
      let r = 0;
      let g = 0;
      let b = 0;

      for (const p of points) {
        const dx = sx - p.x;
        const dy = sy - p.y;
        const d2 = dx * dx + dy * dy;
        const weight = Math.exp(-d2 * invSigma2 * sharp);
        sumW += weight;
        if (weight > maxW) maxW = weight;
        r += p.color[0] * weight;
        g += p.color[1] * weight;
        b += p.color[2] * weight;
      }

      const inv = 1 / Math.max(1e-6, sumW);
      const dominance = maxW * inv;
      const relief = (dominance - 0.46) * (0.45 + edge * 1.0);
      const shade = 1 + relief * 0.35;

      data[k++] = Math.max(0, Math.min(255, Math.round(r * inv * shade)));
      data[k++] = Math.max(0, Math.min(255, Math.round(g * inv * shade)));
      data[k++] = Math.max(0, Math.min(255, Math.round(b * inv * shade)));
      data[k++] = 255;
    }
  }

  meshBufferCtx.putImageData(meshBufferImage, 0, 0);

  bgCtx.clearRect(0, 0, w, h);
  bgCtx.save();
  bgCtx.imageSmoothingEnabled = true;
  bgCtx.filter = `blur(${2 + softness * 9}px)`;
  bgCtx.drawImage(meshBufferCanvas, 0, 0, w, h);
  bgCtx.restore();

  // Subtle directional light/shadow to suggest depth in the field itself.
  const light = bgCtx.createLinearGradient(
    w * (0.5 - Math.cos(angle) * 0.55),
    h * (0.5 - Math.sin(angle) * 0.55),
    w * (0.5 + Math.cos(angle) * 0.55),
    h * (0.5 + Math.sin(angle) * 0.55)
  );
  light.addColorStop(0, `rgba(255,255,255,${0.03 + edge * 0.08})`);
  light.addColorStop(1, `rgba(0,0,0,${0.02 + edge * 0.07})`);
  bgCtx.globalCompositeOperation = "soft-light";
  bgCtx.fillStyle = light;
  bgCtx.fillRect(0, 0, w, h);
  bgCtx.globalCompositeOperation = "source-over";
}

function renderBackground(time) {
  const w = bgCanvas.width;
  const h = bgCanvas.height;
  if (w === 0 || h === 0) return;

  const speed = state.bgSpeed / 100; // normalize to 0-1
  const t = time * 0.001 * speed;    // time in seconds, scaled by speed

  const colors = [state.bgColor1, state.bgColor2, state.bgColor3];

  if (state.bgStyle === "solid") {
    bgCtx.fillStyle = colors[0];
    bgCtx.fillRect(0, 0, w, h);

  } else if (state.bgStyle === "linear") {
    // Simple animated linear gradient
    const angle = (state.bgAngle + t * 10) * Math.PI / 180;
    const cx = w / 2;
    const cy = h / 2;
    const len = Math.max(w, h);
    const dx = Math.cos(angle) * len;
    const dy = Math.sin(angle) * len;
    const grad = bgCtx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    grad.addColorStop(0, colors[0]);
    grad.addColorStop(0.5, colors[1]);
    grad.addColorStop(1, colors[2]);
    bgCtx.fillStyle = grad;
    bgCtx.fillRect(0, 0, w, h);

  } else if (state.bgStyle === "radial") {
    // Animated radial gradient with slowly shifting center
    const cx = w * (0.5 + Math.sin(t * 0.4) * 0.1);
    const cy = h * (0.45 + Math.cos(t * 0.3) * 0.1);
    const r = Math.max(w, h) * 0.7;
    const grad = bgCtx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, colors[1]);  // bright center
    grad.addColorStop(0.5, colors[0]);
    grad.addColorStop(1, colors[2]);
    bgCtx.fillStyle = grad;
    bgCtx.fillRect(0, 0, w, h);

  } else if (state.bgStyle === "wavyMesh") {
    drawWavyMesh({ t, w, h });

  } else if (state.bgStyle === "meshGradient") {
    drawMeshGradient({ t, w, h });

  } else {
    // Fallback to classic mesh
    drawWavyMesh({ t, w, h });
  }

  // Update grain opacity
  grainEl.style.opacity = state.bgGrain / 100;
}

// ─── Blob animation engine ──────────────────────────────────────────
let animation = blobs2Animate.canvasPath();

// Scaled energy: energy * (reactivityAmount / 100)
function scaledEnergy() {
  return state.energy * (state.reactivityAmount / 100);
}

function blobOptions() {
  const e = state.reactivity.morphSpeed ? scaledEnergy() : 0;
  return {
    seed: blobSeedRng(),
    extraPoints: Math.round(state.extraPoints + e * 4),
    randomness: Math.round(state.randomness + e * 12),
    size: state.size,
  };
}

function effectiveDuration() {
  const e = state.reactivity.morphSpeed ? scaledEnergy() : 0;
  return Math.max(200, state.duration * (1 - e * 0.7));
}

function startLoop() {
  const loop = () => {
    animation.transition({
      duration: effectiveDuration(),
      timingFunction: state.timingFunction,
      callback: loop,
      blobOptions: blobOptions(),
    });
  };
  animation.transition({
    duration: effectiveDuration(),
    timingFunction: state.timingFunction,
    callback: loop,
    blobOptions: blobOptions(),
  });
}

// ─── Blob render ─────────────────────────────────────────────────────
function renderBlob() {
  const w = blobCanvas.width;
  const h = blobCanvas.height;
  const e = scaledEnergy();

  blobCtx.clearRect(0, 0, w, h);
  blobCtx.save();

  // Blur pulse: modulate edge blur with energy
  let effectiveBlur = state.edgeBlur;
  if (state.reactivity.blur) {
    effectiveBlur = state.edgeBlur + e * 25; // up to +25px more blur at peak
  }
  blobCtx.filter = effectiveBlur > 0 ? `blur(${effectiveBlur}px)` : "none";
  blobCtx.globalCompositeOperation = state.blendMode;

  // Brightness pulse: shift gradient toward color2 (bright) at high energy
  const alpha = state.opacity / 100;
  const grad = blobCtx.createLinearGradient(0, h * 0.3, w, h * 0.7);
  if (state.reactivity.brightness) {
    // Lerp all stops toward color2 based on energy
    const b = e * 0.6; // max 60% shift toward bright color
    grad.addColorStop(0, hexToRgba(lerpHex(state.color1, state.color2, b), alpha));
    grad.addColorStop(0.45, hexToRgba(state.color2, alpha));
    grad.addColorStop(1, hexToRgba(lerpHex(state.color3, state.color2, b), alpha * (0.7 + b * 0.3)));
  } else {
    grad.addColorStop(0, hexToRgba(state.color1, alpha));
    grad.addColorStop(0.45, hexToRgba(state.color2, alpha));
    grad.addColorStop(1, hexToRgba(state.color3, alpha * 0.7));
  }
  blobCtx.fillStyle = grad;

  // Scale pulse: scale the blob up at high energy
  const cx = w / 2;
  const cy = h / 2;
  if (state.reactivity.scale) {
    const s = 1 + e * 0.2; // up to 20% larger at peak energy
    blobCtx.translate(cx, cy);
    blobCtx.scale(s, s);
    blobCtx.translate(-cx, -cy);
  }

  const offset = (w - state.size) / 2;
  blobCtx.translate(offset, offset);
  blobCtx.fill(animation.renderFrame());
  blobCtx.restore();
}

// Helper: lerp between two hex colors
function lerpHex(hex1, hex2, t) {
  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// ─── Glow ────────────────────────────────────────────────────────────
function updateGlow() {
  const e = scaledEnergy();
  const baseIntensity = state.glowIntensity / 100;

  // Glow pulse: modulate opacity and scale with energy
  let intensity = baseIntensity;
  let scale = 1;
  if (state.reactivity.glow) {
    intensity = baseIntensity * (0.5 + e * 0.8); // range: 50%-130% of base
    scale = 1 + e * 0.5;                          // up to 50% larger
  } else {
    intensity = baseIntensity * 0.7;
    scale = 1;
  }

  glowEl.style.opacity = String(Math.min(1, intensity));
  glowEl.style.background = `radial-gradient(circle,
    ${state.color2} 0%,
    ${state.color1} 40%,
    ${state.color3} 70%,
    transparent 100%
  )`;
  glowEl.style.transform = `scale(${scale})`;
}

// ─── Audio analysis ──────────────────────────────────────────────────
let audioCtx = null;
let analyser = null;
let audioElement = null;
let audioSourceNode = null;
let analyserData = null;
let audioActive = false;
let smoothedEnergy = 0;

function initAudio() {
  if (audioCtx) return;
  audioCtx = new AudioContext();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = state.smoothing;
  analyserData = new Uint8Array(analyser.frequencyBinCount);
  analyser.connect(audioCtx.destination);

  audioElement = new Audio();
  audioElement.crossOrigin = "anonymous";
  audioSourceNode = audioCtx.createMediaElementSource(audioElement);
  audioSourceNode.connect(analyser);

  audioElement.addEventListener("ended", () => {
    audioActive = false;
    btnPlayEl.textContent = "Play";
    btnPlayEl.classList.add("btn--active");
    btnStopEl.classList.remove("btn--active");
  });
}

function loadAudioFile(src) {
  if (!src) {
    audioActive = false;
    if (audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
    }
    audioTransportEl.style.display = "none";
    return;
  }
  initAudio();
  audioElement.src = src;
  audioElement.load();
  audioTransportEl.style.display = "";
  audioActive = false;
  btnPlayEl.textContent = "Play";
  btnPlayEl.classList.add("btn--active");
  btnStopEl.classList.remove("btn--active");
}

function playAudio() {
  if (!audioElement || !audioElement.src) return;
  if (audioCtx.state === "suspended") audioCtx.resume();
  audioElement.play();
  audioActive = true;
  btnPlayEl.textContent = "Pause";
}

function pauseAudio() {
  if (!audioElement) return;
  audioElement.pause();
  audioActive = false;
  btnPlayEl.textContent = "Play";
}

function stopAudio() {
  if (!audioElement) return;
  audioElement.pause();
  audioElement.currentTime = 0;
  audioActive = false;
  btnPlayEl.textContent = "Play";
  btnPlayEl.classList.add("btn--active");
  btnStopEl.classList.remove("btn--active");
}

function sampleAudioEnergy() {
  if (!audioActive || !analyser) return;

  analyser.smoothingTimeConstant = state.smoothing;
  analyser.getByteTimeDomainData(analyserData);

  // Compute RMS energy
  let sum = 0;
  for (let i = 0; i < analyserData.length; i++) {
    const v = (analyserData[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / analyserData.length);

  // Scale by sensitivity and clamp
  const raw = Math.min(1, rms * state.sensitivity);

  // Smooth it
  smoothedEnergy = smoothedEnergy * 0.6 + raw * 0.4;
  state.energy = smoothedEnergy;

  // Update the energy slider/display to reflect live value
  energySlider.value = state.energy;
  energyDisplay.textContent = state.energy.toFixed(2);
}

const audioTransportEl = document.getElementById("audioTransport");
const btnPlayEl = document.getElementById("btnPlay");
const btnStopEl = document.getElementById("btnStop");

// ─── Blob positioning ────────────────────────────────────────────────
function updateBlobPosition() {
  const xOff = state.xPos - 50; // -50 to +50
  const yOff = state.yPos - 50;
  blobContainer.style.transform = `translate(${xOff}%, ${yOff}%)`;
}
updateBlobPosition();

// ─── Unified render loop ─────────────────────────────────────────────
function frame(time) {
  sampleAudioEnergy();
  updateGlow();
  renderBackground(time);
  renderBlob();
  requestAnimationFrame(frame);
}

// ─── Controls wiring ─────────────────────────────────────────────────
function wireSlider(id, stateKey, displayId, formatter, { persist = true, afterChange } = {}) {
  const input = document.getElementById(id);
  const display = document.getElementById(displayId);
  input.addEventListener("input", () => {
    const val = parseFloat(input.value);
    state[stateKey] = val;
    if (display) display.textContent = formatter ? formatter(val) : val;
    updateGlow();
    if (afterChange) afterChange(val);
    if (persist) scheduleUrlSync();
  });
}

// Blob controls
wireSlider("extraPoints", "extraPoints", "extraPointsVal");
wireSlider("randomness", "randomness", "randomnessVal");
wireSlider("blobSize", "size", "sizeVal");
wireSlider("duration", "duration", "durationVal", (v) => `${(v / 1000).toFixed(2)}s`);
wireSlider("opacity", "opacity", "opacityVal", (v) => `${v}%`);
wireSlider("edgeBlur", "edgeBlur", "blurVal", (v) => `${v}px`);
wireSlider("glowIntensity", "glowIntensity", "glowVal", (v) => `${v}%`);
wireSlider("energy", "energy", "energyVal", (v) => v.toFixed(2), { persist: false });

// Position sliders
for (const axis of ["xPos", "yPos"]) {
  const id = axis === "xPos" ? "xPos" : "yPos";
  const displayId = axis === "xPos" ? "xPosVal" : "yPosVal";
  const input = document.getElementById(id);
  const display = document.getElementById(displayId);
  input.addEventListener("input", () => {
    state[axis] = parseFloat(input.value);
    display.textContent = `${state[axis]}%`;
    updateBlobPosition();
    scheduleUrlSync();
  });
}

// Background controls
wireSlider("bgAngle", "bgAngle", "bgAngleVal", (v) => `${v}\u00B0`);
wireSlider("bgSpeed", "bgSpeed", "bgSpeedVal", (v) => `${v}%`);
wireSlider("bgWaveScale", "bgWaveScale", "bgWaveScaleVal", (v) => `${v}%`);
wireSlider("bgEdge", "bgEdge", "bgEdgeVal", (v) => `${v}%`);
wireSlider("bgDrift", "bgDrift", "bgDriftVal", (v) => `${v}%`);
wireSlider("bgGrain", "bgGrain", "bgGrainVal", (v) => `${v}%`);

// Background complexity regenerates orbs
const bgComplexityInput = document.getElementById("bgComplexity");
const bgComplexityDisplay = document.getElementById("bgComplexityVal");
bgComplexityInput.addEventListener("input", () => {
  state.bgComplexity = parseInt(bgComplexityInput.value, 10);
  bgComplexityDisplay.textContent = state.bgComplexity;
  generateOrbs(getBgPointCount());
  scheduleUrlSync();
});

function updateBackgroundControlVisibility() {
  const mode = state.bgStyle;
  const show = (id, visible) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle("is-hidden", !visible);
  };

  const modeConfig = {
    solid: {
      color2: false,
      color3: false,
      color4: false,
      color5: false,
      angle: false,
      speed: false,
      drift: false,
      detail: false,
      waveScale: false,
      edge: false,
    },
    linear: {
      color2: true,
      color3: true,
      color4: false,
      color5: false,
      angle: true,
      speed: true,
      drift: false,
      detail: false,
      waveScale: false,
      edge: false,
    },
    radial: {
      color2: true,
      color3: true,
      color4: false,
      color5: false,
      angle: false,
      speed: true,
      drift: false,
      detail: false,
      waveScale: false,
      edge: false,
    },
    wavyMesh: {
      color2: true,
      color3: true,
      color4: false,
      color5: false,
      angle: false,
      speed: true,
      drift: false,
      detail: true,
      waveScale: false,
      edge: false,
    },
    meshGradient: {
      color2: true,
      color3: true,
      color4: true,
      color5: true,
      angle: true,
      speed: true,
      drift: true,
      detail: true,
      waveScale: true,
      edge: true,
    },
  };

  const config = modeConfig[mode] || modeConfig.wavyMesh;
  show("bgColorItem2", config.color2);
  show("bgColorItem3", config.color3);
  show("bgColorItem4", config.color4);
  show("bgColorItem5", config.color5);
  show("bgAngleGroup", config.angle);
  show("bgSpeedGroup", config.speed);
  show("bgDriftGroup", config.drift);
  show("bgDetailGroup", config.detail);
  show("bgWaveScaleGroup", config.waveScale);
  show("bgEdgeGroup", config.edge);
  show("bgGrainGroup", true);

  const detailLabel = document.getElementById("bgDetailLabel");
  if (detailLabel) {
    detailLabel.textContent = mode === "meshGradient" ? "Control Points" : "Mesh Complexity";
  }

  const waveLabel = document.getElementById("bgWaveScaleLabel");
  if (waveLabel) {
    waveLabel.textContent = "Softness";
  }

  const edgeLabel = document.getElementById("bgEdgeLabel");
  if (edgeLabel) {
    edgeLabel.textContent = "Edge Definition";
  }
  const driftLabel = document.getElementById("bgDriftLabel");
  if (driftLabel) {
    driftLabel.textContent = "Flow";
  }
}

// Blob color pickers
document.getElementById("color1").addEventListener("input", (e) => {
  state.color1 = e.target.value;
  updateGlow();
  scheduleUrlSync();
});
document.getElementById("color2").addEventListener("input", (e) => {
  state.color2 = e.target.value;
  updateGlow();
  scheduleUrlSync();
});
document.getElementById("color3").addEventListener("input", (e) => {
  state.color3 = e.target.value;
  updateGlow();
  scheduleUrlSync();
});

// Background color pickers
document.getElementById("bgColor1").addEventListener("input", (e) => {
  state.bgColor1 = e.target.value;
  scheduleUrlSync();
});
document.getElementById("bgColor2").addEventListener("input", (e) => {
  state.bgColor2 = e.target.value;
  scheduleUrlSync();
});
document.getElementById("bgColor3").addEventListener("input", (e) => {
  state.bgColor3 = e.target.value;
  scheduleUrlSync();
});
document.getElementById("bgColor4").addEventListener("input", (e) => {
  state.bgColor4 = e.target.value;
  scheduleUrlSync();
});
document.getElementById("bgColor5").addEventListener("input", (e) => {
  state.bgColor5 = e.target.value;
  scheduleUrlSync();
});

// Selects
document.getElementById("timingFunction").addEventListener("change", (e) => {
  state.timingFunction = e.target.value;
  scheduleUrlSync();
});
document.getElementById("blendMode").addEventListener("change", (e) => {
  state.blendMode = e.target.value;
  scheduleUrlSync();
});
document.getElementById("bgStyle").addEventListener("change", (e) => {
  state.bgStyle = e.target.value;
  if (state.bgStyle === "wavyMesh" || state.bgStyle === "meshGradient") {
    generateOrbs(getBgPointCount(state.bgStyle));
  }
  updateBackgroundControlVisibility();
  scheduleUrlSync();
});

// Audio controls
wireSlider("sensitivity", "sensitivity", "sensitivityVal", (v) => `${v.toFixed(1)}x`);
wireSlider("smoothing", "smoothing", "smoothingVal", (v) => v.toFixed(2));

document.getElementById("audioSource").addEventListener("change", (e) => {
  state.audioSource = e.target.value;
  loadAudioFile(e.target.value);
  scheduleUrlSync();
});

btnPlayEl.addEventListener("click", () => {
  if (audioActive) {
    pauseAudio();
    btnPlayEl.classList.add("btn--active");
  } else {
    playAudio();
    btnPlayEl.classList.remove("btn--active");
  }
});

btnStopEl.addEventListener("click", () => {
  stopAudio();
});

// Reactivity channel toggles
document.querySelectorAll(".toggle-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    const channel = chip.dataset.channel;
    state.reactivity[channel] = !state.reactivity[channel];
    chip.classList.toggle("toggle-chip--on", state.reactivity[channel]);
    scheduleUrlSync();
  });
});

wireSlider("reactivityAmount", "reactivityAmount", "reactivityAmountVal", (v) => `${v}%`);

const randomSeedInput = document.getElementById("randomSeed");
const randomSeedBtn = document.getElementById("btnReseedOrbs");
randomSeedInput.addEventListener("change", () => {
  state.randomSeed = normalizeSeed(randomSeedInput.value);
  randomSeedInput.value = String(state.randomSeed);
  reseedBlobRng();
  generateOrbs(getBgPointCount());
  scheduleUrlSync();
});
randomSeedBtn.addEventListener("click", () => {
  state.randomSeed = normalizeSeed(state.randomSeed + 1);
  randomSeedInput.value = String(state.randomSeed);
  reseedBlobRng();
  generateOrbs(getBgPointCount());
  scheduleUrlSync();
});

// Manual energy presets
const btnIdle = document.getElementById("btnIdle");
const btnSpeaking = document.getElementById("btnSpeaking");
const btnLoud = document.getElementById("btnLoud");
const energySlider = document.getElementById("energy");
const energyDisplay = document.getElementById("energyVal");

function setEnergy(val, activeBtn) {
  state.energy = val;
  smoothedEnergy = val;
  energySlider.value = val;
  energyDisplay.textContent = val.toFixed(2);
  [btnIdle, btnSpeaking, btnLoud].forEach((b) => b.classList.remove("btn--active"));
  activeBtn.classList.add("btn--active");
  updateGlow();
}

btnIdle.addEventListener("click", () => setEnergy(0.05, btnIdle));
btnSpeaking.addEventListener("click", () => setEnergy(0.5, btnSpeaking));
btnLoud.addEventListener("click", () => setEnergy(0.95, btnLoud));

document.getElementById("btnRandomize").addEventListener("click", () => {
  animation.transition({
    duration: 300,
    timingFunction: "ease",
    callback: () => startLoop(),
    blobOptions: blobOptions(),
  });
});

function syncControlsFromState() {
  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = String(value);
  };
  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  // Shape / blob
  setValue("extraPoints", state.extraPoints);
  setText("extraPointsVal", String(state.extraPoints));
  setValue("randomness", state.randomness);
  setText("randomnessVal", String(state.randomness));
  setValue("blobSize", state.size);
  setText("sizeVal", String(state.size));
  setValue("duration", state.duration);
  setText("durationVal", `${(state.duration / 1000).toFixed(2)}s`);
  setValue("opacity", state.opacity);
  setText("opacityVal", `${state.opacity}%`);
  setValue("edgeBlur", state.edgeBlur);
  setText("blurVal", `${state.edgeBlur}px`);
  setValue("glowIntensity", state.glowIntensity);
  setText("glowVal", `${state.glowIntensity}%`);
  setValue("xPos", state.xPos);
  setText("xPosVal", `${state.xPos}%`);
  setValue("yPos", state.yPos);
  setText("yPosVal", `${state.yPos}%`);
  setValue("timingFunction", state.timingFunction);
  setValue("blendMode", state.blendMode);
  setValue("randomSeed", state.randomSeed);

  // Blob colors
  setValue("color1", state.color1);
  setValue("color2", state.color2);
  setValue("color3", state.color3);

  // Background
  setValue("bgStyle", state.bgStyle);
  setValue("bgColor1", state.bgColor1);
  setValue("bgColor2", state.bgColor2);
  setValue("bgColor3", state.bgColor3);
  setValue("bgColor4", state.bgColor4);
  setValue("bgColor5", state.bgColor5);
  setValue("bgAngle", state.bgAngle);
  setText("bgAngleVal", `${state.bgAngle}°`);
  setValue("bgSpeed", state.bgSpeed);
  setText("bgSpeedVal", `${state.bgSpeed}%`);
  setValue("bgDrift", state.bgDrift);
  setText("bgDriftVal", `${state.bgDrift}%`);
  setValue("bgComplexity", state.bgComplexity);
  setText("bgComplexityVal", String(state.bgComplexity));
  setValue("bgWaveScale", state.bgWaveScale);
  setText("bgWaveScaleVal", `${state.bgWaveScale}%`);
  setValue("bgEdge", state.bgEdge);
  setText("bgEdgeVal", `${state.bgEdge}%`);
  setValue("bgGrain", state.bgGrain);
  setText("bgGrainVal", `${state.bgGrain}%`);

  // Audio + reactivity
  setValue("audioSource", state.audioSource);
  setValue("sensitivity", state.sensitivity);
  setText("sensitivityVal", `${state.sensitivity.toFixed(1)}x`);
  setValue("smoothing", state.smoothing);
  setText("smoothingVal", state.smoothing.toFixed(2));
  setValue("energy", state.energy);
  setText("energyVal", state.energy.toFixed(2));
  setValue("reactivityAmount", state.reactivityAmount);
  setText("reactivityAmountVal", `${state.reactivityAmount}%`);

  document.querySelectorAll(".toggle-chip").forEach((chip) => {
    const channel = chip.dataset.channel;
    chip.classList.toggle("toggle-chip--on", Boolean(state.reactivity[channel]));
  });
}

// ─── Init ────────────────────────────────────────────────────────────
smoothedEnergy = state.energy;
syncControlsFromState();
updateBlobPosition();
loadAudioFile(state.audioSource);
updateBackgroundControlVisibility();
updateGlow();
updateUrlFromState();
startLoop();
requestAnimationFrame(frame);
