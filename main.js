import * as blobs2Animate from "blobs/v2/animate";

// ─── State ───────────────────────────────────────────────────────────
const state = {
  // Blob shape
  extraPoints: 5,
  randomness: 8,
  size: 250,
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
  bgStyle: "mesh",     // "mesh" | "linear" | "radial"
  bgColor1: "#7b8cde", // base
  bgColor2: "#a5b4f0", // mid
  bgColor3: "#c8c0e8", // accent
  bgAngle: 160,
  bgSpeed: 30,         // 0-100
  bgComplexity: 4,     // 2-8 orbs for mesh
  bgGrain: 12,         // 0-40
};

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
  orbs = [];
  for (let i = 0; i < count; i++) {
    orbs.push({
      // Normalized center position [0-1]
      x: 0.15 + Math.random() * 0.7,
      y: 0.1 + Math.random() * 0.8,
      // Drift parameters (radians/sec)
      phaseX: Math.random() * Math.PI * 2,
      phaseY: Math.random() * Math.PI * 2,
      freqX: 0.3 + Math.random() * 0.5,
      freqY: 0.2 + Math.random() * 0.4,
      driftX: 0.04 + Math.random() * 0.08,
      driftY: 0.03 + Math.random() * 0.07,
      // Which color pool to use (0, 1, or 2 maps to bg colors)
      colorIdx: i % 3,
      // Radius as fraction of canvas diagonal
      radius: 0.25 + Math.random() * 0.25,
      // Individual opacity
      alpha: 0.5 + Math.random() * 0.4,
    });
  }
}
generateOrbs(state.bgComplexity);

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

  } else {
    // "mesh" - fill base color then overlay drifting radial orbs
    bgCtx.fillStyle = colors[0];
    bgCtx.fillRect(0, 0, w, h);

    const diag = Math.sqrt(w * w + h * h);

    for (const orb of orbs) {
      const ox = (orb.x + Math.sin(t * orb.freqX + orb.phaseX) * orb.driftX) * w;
      const oy = (orb.y + Math.cos(t * orb.freqY + orb.phaseY) * orb.driftY) * h;
      const or = orb.radius * diag;

      const color = colors[orb.colorIdx];
      const grad = bgCtx.createRadialGradient(ox, oy, 0, ox, oy, or);
      grad.addColorStop(0, hexToRgba(color, orb.alpha));
      grad.addColorStop(0.6, hexToRgba(color, orb.alpha * 0.3));
      grad.addColorStop(1, hexToRgba(color, 0));

      bgCtx.globalCompositeOperation = "screen";
      bgCtx.fillStyle = grad;
      bgCtx.fillRect(0, 0, w, h);
      bgCtx.globalCompositeOperation = "source-over";
    }
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
    seed: Math.random(),
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
function wireSlider(id, stateKey, displayId, formatter) {
  const input = document.getElementById(id);
  const display = document.getElementById(displayId);
  input.addEventListener("input", () => {
    const val = parseFloat(input.value);
    state[stateKey] = val;
    if (display) display.textContent = formatter ? formatter(val) : val;
    updateGlow();
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
wireSlider("energy", "energy", "energyVal", (v) => v.toFixed(2));

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
  });
}

// Background controls
wireSlider("bgAngle", "bgAngle", "bgAngleVal", (v) => `${v}\u00B0`);
wireSlider("bgSpeed", "bgSpeed", "bgSpeedVal", (v) => `${v}%`);
wireSlider("bgGrain", "bgGrain", "bgGrainVal", (v) => `${v}%`);

// Background complexity regenerates orbs
const bgComplexityInput = document.getElementById("bgComplexity");
const bgComplexityDisplay = document.getElementById("bgComplexityVal");
bgComplexityInput.addEventListener("input", () => {
  state.bgComplexity = parseInt(bgComplexityInput.value);
  bgComplexityDisplay.textContent = state.bgComplexity;
  generateOrbs(state.bgComplexity);
});

// Blob color pickers
document.getElementById("color1").addEventListener("input", (e) => {
  state.color1 = e.target.value;
  updateGlow();
});
document.getElementById("color2").addEventListener("input", (e) => {
  state.color2 = e.target.value;
  updateGlow();
});
document.getElementById("color3").addEventListener("input", (e) => {
  state.color3 = e.target.value;
  updateGlow();
});

// Background color pickers
document.getElementById("bgColor1").addEventListener("input", (e) => {
  state.bgColor1 = e.target.value;
});
document.getElementById("bgColor2").addEventListener("input", (e) => {
  state.bgColor2 = e.target.value;
});
document.getElementById("bgColor3").addEventListener("input", (e) => {
  state.bgColor3 = e.target.value;
});

// Selects
document.getElementById("timingFunction").addEventListener("change", (e) => {
  state.timingFunction = e.target.value;
});
document.getElementById("blendMode").addEventListener("change", (e) => {
  state.blendMode = e.target.value;
});
document.getElementById("bgStyle").addEventListener("change", (e) => {
  state.bgStyle = e.target.value;
});

// Audio controls
wireSlider("sensitivity", "sensitivity", "sensitivityVal", (v) => `${v.toFixed(1)}x`);
wireSlider("smoothing", "smoothing", "smoothingVal", (v) => v.toFixed(2));

document.getElementById("audioSource").addEventListener("change", (e) => {
  state.audioSource = e.target.value;
  loadAudioFile(e.target.value);
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
  });
});

wireSlider("reactivityAmount", "reactivityAmount", "reactivityAmountVal", (v) => `${v}%`);

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

// ─── Init ────────────────────────────────────────────────────────────
updateGlow();
startLoop();
requestAnimationFrame(frame);
