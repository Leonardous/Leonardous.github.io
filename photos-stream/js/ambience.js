// A pre-rendered piano and ambient mix, prepared silently during loading.
// Preparation is silent; reveal() is called when the waterfall first appears.
import { loadSoundtrack } from './soundtrack.js?v=3eddaa089417';

const STORAGE_KEY = 'photos-stream-sound';
const TARGET_GAIN = 0.65;

function readPreference() {
  try { return localStorage.getItem(STORAGE_KEY) !== 'off'; } catch { return true; }
}
function writePreference(on) {
  try { localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off'); } catch { /* optional storage */ }
}

export function initAmbience({ createScore = loadSoundtrack } = {}) {
  const button = document.getElementById('sound-toggle');
  const hint = document.getElementById('sound-hint');
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let ctx, master, piano, score, preparation;
  let enabled = readPreference(), revealed = false, started = false, disposed = false, failed = false;
  let startTime = null;

  function updateUI() {
    if (!AudioCtx || failed) {
      if (button) button.hidden = true;
      if (hint) hint.hidden = true;
      return;
    }
    const running = ctx?.state === 'running';
    const playing = enabled && started && running;
    if (button) {
      button.dataset.state = !enabled ? 'muted' : playing ? 'playing' : 'idle';
      button.setAttribute('aria-pressed', String(enabled && running));
      button.setAttribute('aria-label', enabled && running ? '静音' : '开启声音');
    }
    if (hint) {
      hint.dataset.done = String(!enabled || playing);
      hint.textContent = running && !revealed
        ? '加载完成后，钢琴将随瀑布响起'
        : revealed ? '点击任意处开启音乐' : '点击任意处，让钢琴随瀑布响起';
    }
  }

  function buildGraph() {
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
  }
  function begin() {
    if (disposed || failed || !enabled || !revealed || !score || ctx?.state !== 'running' || document.hidden) return;
    if (!started) {
      const t = ctx.currentTime + 0.02;
      piano = ctx.createBufferSource();
      piano.buffer = score.buffer;
      piano.loop = true;
      piano.loopStart = 0; piano.loopEnd = score.duration;
      piano.connect(master);
      piano.start(t);
      startTime = t;
      started = true;
      master.gain.setValueAtTime(0, t);
      master.gain.linearRampToValueAtTime(TARGET_GAIN, t + 0.025);
    }
    updateUI();
  }

  function resume() {
    if (!ctx || !enabled || disposed) return;
    try {
      // Unlock in the gesture itself, before waiting for download or decoding.
      const pending = ctx.resume();
      pending?.then(() => { begin(); updateUI(); }).catch(() => updateUI());
    } catch { updateUI(); }
    begin();
  }

  function prepare() {
    if (preparation) return preparation;
    if (!AudioCtx || disposed) return Promise.resolve(false);
    try {
      ctx = new AudioCtx();
      ctx.addEventListener('statechange', onStateChange);
      buildGraph();
      preparation = Promise.resolve().then(() => createScore(ctx)).then(result => {
        if (disposed) return false;
        score = result;
        begin(); updateUI();
        return true;
      }).catch(error => {
        failed = true;
        console.warn('Piano ambience could not be prepared.', error);
        ctx.close()?.catch(() => {});
        updateUI();
        return false;
      });
      if (enabled) resume();
    } catch (error) {
      failed = true;
      console.warn('Web Audio is unavailable.', error);
      ctx?.close()?.catch(() => {});
      preparation = Promise.resolve(false);
    }
    updateUI();
    return preparation;
  }

  function onStateChange() { begin(); updateUI(); }

  function setEnabled(on) {
    enabled = on;
    writePreference(on);
    if (master && started) {
      const t = ctx.currentTime, gain = master.gain;
      if (gain.cancelAndHoldAtTime) gain.cancelAndHoldAtTime(t);
      else { const value = gain.value; gain.cancelScheduledValues(t); gain.setValueAtTime(value, t); }
      gain.linearRampToValueAtTime(on ? TARGET_GAIN : 0, t + (on ? 0.6 : 0.25));
    }
    if (on) { prepare(); resume(); }
    updateUI();
  }

  function onGesture(event) {
    // The button has its own handler: a single click must not toggle twice.
    if (event.target?.closest?.('#sound-toggle') || !enabled) return;
    prepare(); resume();
  }
  function onToggle(event) {
    event.preventDefault(); event.stopPropagation();
    setEnabled(!(enabled && ctx?.state === 'running'));
  }
  function onVisible() { if (!document.hidden && enabled) resume(); }
  const gestures = ['pointerdown', 'keydown', 'touchend'];
  for (const event of gestures) window.addEventListener(event, onGesture, true);
  button?.addEventListener('click', onToggle);
  document.addEventListener('visibilitychange', onVisible);

  const inspect = () => ({
    started, enabled, revealed, prepared: !!score,
    state: !AudioCtx ? 'unsupported' : failed ? 'error' : ctx?.state ?? 'none',
    gain: master ? Number(master.gain.value.toFixed(5)) : null,
    loopSeconds: score?.duration ?? null,
    openingChord: score?.openingChord ?? null,
    startTime,
    elapsed: started ? Math.max(0, ctx.currentTime - startTime) : 0,
    hint: !!hint && !hint.hidden && hint.dataset.done !== 'true',
    glyph: button?.dataset.state ?? 'none',
  });
  inspect.prepare = prepare;
  // Unlock within the entrance click; the mix remains silent until reveal().
  inspect.enter = () => { setEnabled(true); return prepare(); };
  inspect.reveal = () => { if (!disposed) { revealed = true; begin(); updateUI(); } };
  inspect.dispose = () => {
    disposed = true;
    for (const event of gestures) window.removeEventListener(event, onGesture, true);
    button?.removeEventListener('click', onToggle);
    document.removeEventListener('visibilitychange', onVisible);
    ctx?.removeEventListener('statechange', onStateChange);
    ctx?.close()?.catch(() => {});
  };
  updateUI();
  return inspect;
}

