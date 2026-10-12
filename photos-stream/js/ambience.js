// Undertow — generated ambience.
//
// No audio files: everything here is synthesised with the Web Audio API, so the page
// stays file-free and free of licensing questions. The palette mirrors the visual —
// a low curtain hum, a slowly breathing pad, moving air, and sparse bell-like glints
// that evoke the light specks falling down the threads.
//
// Browsers refuse to start audio without a user gesture, so nothing is created until
// the first pointer/wheel/key press. If audio is unavailable the UI stays silent and
// the sound button hides itself.

const STORAGE_KEY = 'photos-stream-sound';

// D minor pentatonic — every combination stays consonant, so random glints never clash.
const PAD_VOICES = [146.83, 220.0, 246.94, 293.66, 349.23, 440.0, 523.25, 587.33];
const GLINT_SEMITONES = [0, 3, 5, 7, 10]; // pentatonic offsets from D
const GLINT_BASE = 587.33; // D5

function readPreference() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

function writePreference(on) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    /* storage may be blocked; not worth failing over */
  }
}

export function initAmbience() {
  const button = document.getElementById('sound-toggle');
  const hint = document.getElementById('sound-hint');
  const AudioCtx = window.AudioContext || window.webkitAudioContext;

  if (!AudioCtx) {
    button?.remove();
    hint?.remove();
    return () => ({ started: false, enabled: false, state: 'unsupported', gain: null, nodes: 'none' });
  }

  let ctx = null;
  let master = null;
  let started = false;
  let listening = true;
  let enabled = readPreference();
  let glintTimer = null;

  // Measured with an OfflineAudioContext render of this graph: 0.2 sat at -27.9 dBFS RMS
  // with 9.4x headroom, which reads as too quiet next to normal web audio. 0.5 lands near
  // -20 dBFS RMS with the peak still over 3x below clipping.
  const TARGET_GAIN = 0.5;
  const FADE_IN = 6; // seconds — long enough to feel like the light rising

  const setButtonState = (state, on) => {
    if (!button) return;
    button.dataset.state = state;
    button.setAttribute(
      'aria-label',
      state === 'muted' ? '开启声音' : on ? '静音' : '开启声音'
    );
    button.setAttribute('aria-pressed', state === 'muted' ? 'false' : 'true');
  };

  // The hint is only ever shown when a gesture is genuinely still required.
  const clearHint = () => {
    if (!hint) return;
    hint.dataset.done = 'true';
    setTimeout(() => hint.remove(), 900);
  };

  // ── graph ──────────────────────────────────────────────────────────────────
  // Impulse response for the reverb: decaying noise. Cheaper and more predictable
  // than pulling in an IR file, and it suits an abstract scene.
  const makeImpulse = (seconds, decay) => {
    const rate = ctx.sampleRate;
    const length = Math.max(1, Math.floor(rate * seconds));
    const buffer = ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return buffer;
  };

  const noiseBuffer = (seconds) => {
    const rate = ctx.sampleRate;
    const length = Math.max(1, Math.floor(rate * seconds));
    const buffer = ctx.createBuffer(1, length, rate);
    const data = buffer.getChannelData(0);
    // Brown-ish noise: integrating white noise gives a softer, waterier hiss.
    let lastOut = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.02 * white) / 1.02;
      data[i] = lastOut * 3.5;
    }
    return buffer;
  };

  const lfo = (param, hz, depth) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = hz;
    gain.gain.value = depth;
    osc.connect(gain).connect(param);
    osc.start();
    return osc;
  };

  function buildGraph() {
    master = ctx.createGain();
    // A fresh GainNode starts at 1.0, so without this the very first audio block plays
    // at full volume before the fade-in curve takes effect — an audible click.
    master.gain.value = 0.0001;
    master.connect(ctx.destination);

    // Warmth + reverb, shared by every layer.
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 1900;
    tone.Q.value = 0.4;

    const dry = ctx.createGain();
    dry.gain.value = 0.72;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;

    const reverb = ctx.createConvolver();
    reverb.buffer = makeImpulse(5.5, 2.6);

    tone.connect(dry).connect(master);
    tone.connect(reverb).connect(wet).connect(master);

    // Deliberately slow drift on the master filter so the texture never sits still.
    lfo(tone.frequency, 0.012, 420);

    // 1. Low curtain hum.
    const humGain = ctx.createGain();
    humGain.gain.value = 0.5;
    const humFilter = ctx.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.value = 300;
    humFilter.connect(humGain).connect(tone);

    for (const [freq, gain, detune] of [
      [55.0, 0.34, -3],
      [55.3, 0.24, 4],
      [82.5, 0.1, 0],
    ]) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      g.gain.value = gain;
      lfo(g.gain, 0.03 + Math.random() * 0.05, gain * 0.45);
      osc.connect(g).connect(humFilter);
      osc.start();
    }

    // 2. Breathing pad — one oscillator per note, each with its own slow swell.
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 900;
    const padGain = ctx.createGain();
    padGain.gain.value = 0.3;
    padFilter.connect(padGain).connect(tone);
    lfo(padFilter.frequency, 0.017, 380);

    PAD_VOICES.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = i % 3 === 0 ? 'triangle' : 'sine';
      osc.frequency.value = freq;
      osc.detune.value = (Math.random() - 0.5) * 9;
      const peak = 0.085 / (1 + i * 0.12);
      g.gain.value = 0.0001;
      // Independent cycles keep the chord from ever repeating exactly.
      lfo(g.gain, 0.021 + i * 0.0073, peak * 0.85);
      osc.connect(g).connect(padFilter);
      osc.start();
    });

    // 3. Moving air.
    const air = ctx.createBufferSource();
    air.buffer = noiseBuffer(6);
    air.loop = true;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = 'bandpass';
    airFilter.frequency.value = 760;
    airFilter.Q.value = 0.7;
    const airGain = ctx.createGain();
    airGain.gain.value = 0.07;
    lfo(airGain.gain, 0.026, 0.045);
    lfo(airFilter.frequency, 0.019, 300);
    air.connect(airFilter).connect(airGain).connect(tone);
    air.start();
  }

  // ── sparse falling glints ──────────────────────────────────────────────────
  const scheduleGlint = () => {
    const t = ctx.currentTime + 0.1;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;

    const semitone = GLINT_SEMITONES[Math.floor(Math.random() * GLINT_SEMITONES.length)];
    const octave = Math.random() < 0.35 ? 2 : 1;
    osc.type = 'sine';
    osc.frequency.value = GLINT_BASE * Math.pow(2, semitone / 12) * octave;

    // Deliberately quiet and slow: the glints should read as distant light in the mix,
    // not as bells competing with the pad.
    const peak = 0.007 + Math.random() * 0.015;
    const attack = 0.02 + Math.random() * 0.05;
    const decay = 2.6 + Math.random() * 3.2;

    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);

    osc.connect(g);
    if (pan) {
      pan.pan.value = (Math.random() - 0.5) * 1.6;
      g.connect(pan);
      pan.connect(master);
    } else {
      g.connect(master);
    }

    osc.start(t);
    osc.stop(t + attack + decay + 0.1);
    osc.onended = () => {
      g.disconnect();
      pan?.disconnect();
    };

    glintTimer = setTimeout(scheduleGlint, 2600 + Math.random() * 6500);
  };

  // ── control ────────────────────────────────────────────────────────────────
  // Rain the master gain up to its target. Schedule this only once the context is
  // actually running: a curve scheduled while suspended has its time window expire
  // before playback begins, which leaves the gain pinned at its final value.
  function scheduleFadeIn(seconds = FADE_IN) {
    if (!master || !ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const STEPS = 64;
    const curve = new Float32Array(STEPS);
    for (let i = 0; i < STEPS; i++) {
      curve[i] = Math.max(0.0001, TARGET_GAIN * Math.pow(i / (STEPS - 1), 1.6));
    }
    master.gain.cancelScheduledValues(t);
    master.gain.setValueCurveAtTime(curve, t, seconds);
  }

  function start() {
    if (started) return;
    started = true;

    ctx = new AudioCtx();
    buildGraph();

    // A very slow, very shallow tremolo on the master so the loop never feels static.
    if (master) lfo(master.gain, 0.043, TARGET_GAIN * 0.06);

    // Attempt to run immediately. Chrome allows this when the visitor already has an
    // engagement history with the site; otherwise the context stays suspended until a
    // gesture arrives (onFirstGesture below).
    ctx.resume?.();
    scheduleFadeIn();
    scheduleGlint();
  }

  // A suspended context can take seconds to resume (the browser waits for the gesture to
  // finish, and the main thread may be busy with the first frames). Timeouts therefore
  // miss the transition, so the fade is driven by the context's own state events.
  function promote() {
    if (!ctx) return;
    const running = ctx.state === 'running';
    setButtonState(running && enabled ? 'playing' : enabled ? 'idle' : 'muted', enabled);
    // The fade has to be scheduled while the context is actually running; a curve
    // scheduled earlier has its time window expire before playback begins, which pins
    // the gain at its final value and leaves the page silent.
    if (running && enabled) scheduleFadeIn();
  }

  function watchState() {
    if (!ctx) return;
    const update = () => { if (ctx) promote(); };
    if (!ctx._watched) {
      ctx._watched = true;
      ctx.addEventListener?.('statechange', update);
      ctx.onstatechange = update; // older implementations only support the property
    }
    update();
    // Belt and braces: re-check shortly after, in case no statechange event is emitted.
    setTimeout(update, 200);
    setTimeout(update, 1200);
  }

  function setEnabled(on) {
    enabled = on;
    writePreference(on);
    if (!ctx || !master) {
      if (on) start();
      return;
    }
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), t);
    master.gain.exponentialRampToValueAtTime(on ? TARGET_GAIN : 0.0001, t + (on ? 3 : 1.2));
    setButtonState(on ? 'playing' : 'muted', on);
  }

  // Fall back to the first real gesture when the browser refused autoplay, then stop
  // listening for good.
  const onFirstGesture = () => {
    if (!listening) return;
    listening = false;
    window.removeEventListener('pointerdown', onFirstGesture, true);
    window.removeEventListener('wheel', onFirstGesture, true);
    window.removeEventListener('keydown', onFirstGesture, true);
    window.removeEventListener('touchstart', onFirstGesture, true);
    clearHint();
    if (enabled) {
      start();
      // A real gesture always permits the context to run; this is also what promotes a
      // previously-suspended autoplay attempt.
      watchState();
    } else {
      setButtonState('muted', false);
    }
  };

  window.addEventListener('pointerdown', onFirstGesture, true);
  window.addEventListener('wheel', onFirstGesture, true);
  window.addEventListener('keydown', onFirstGesture, true);
  window.addEventListener('touchstart', onFirstGesture, true);

  // Keep the context alive if the tab is restored, and pause nothing else.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && ctx && ctx.state === 'suspended' && enabled) ctx.resume?.();
  });

  button?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!started) {
      setEnabled(true);
      return;
    }
    setEnabled(!enabled);
  });

  // ── attempt to start straight away ─────────────────────────────────────────
  // Browsers only allow this when the visitor already has an engagement history with
  // the site (Chrome's Media Engagement Index) or has granted autoplay; elsewhere the
  // context is created suspended and the gesture listeners above take over. Either way
  // the sound button stays available so it can be turned off.
  if (enabled) {
    start();
    watchState();
    // Decide a moment later whether autoplay was actually permitted — the hint is only
    // shown when a gesture is still needed.
    setTimeout(() => {
      if (ctx && ctx.state === 'running') clearHint();
    }, 900);
  } else {
    setButtonState('muted', false);
    clearHint();
  }

  // Read-only inspection handle, surfaced as window.__undertow.sound().
  return () => ({
    started,
    enabled,
    state: ctx ? ctx.state : 'none',
    gain: master ? Number(master.gain.value.toFixed(5)) : null,
    hint: !!document.getElementById('sound-hint'),
    glyph: button ? (button.dataset.state || '') : 'none',
  });
}
