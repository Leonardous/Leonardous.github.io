// One comet carries the entrance into the waterfall; its position follows real readiness.
export function createEntrance(root, { reduced = false } = {}) {
  const win = root.ownerDocument.defaultView;
  const light = root.querySelector('.entrance-light');
  const copy = root.querySelector('.entrance-copy');
  const progress = root.querySelector('[role="progressbar"]');
  const waits = new Map();
  let phase = 'idle', target = 0, shown = 0, fall = 0, travel = 0;
  let last = 0, raf = 0, completion, resolveComplete;

  function wait(ms) {
    if (!ms) return Promise.resolve(true);
    return new Promise(resolve => {
      const id = win.setTimeout(() => { waits.delete(id); resolve(true); }, ms);
      waits.set(id, resolve);
    });
  }
  function measure() {
    const origin = light.getBoundingClientRect().bottom - fall;
    travel = Math.max(60, win.innerHeight * .78 - origin);
  }
  function paint() {
    fall = reduced ? 0 : shown * travel;
    light.style.setProperty('--fall', `${fall.toFixed(2)}px`);
    progress.setAttribute('aria-valuenow', String(Math.floor(shown * 100)));
  }
  function stop() {
    win.cancelAnimationFrame(raf);
    win.removeEventListener('resize', measure);
  }
  function uncover() {
    phase = 'uncovering';
    stop();
    root.classList.add('is-uncovering');
    root.setAttribute('aria-busy', 'false');
    // Remove the opaque backdrop before the first waterfall frame or piano note.
    wait(reduced ? 0 : 400).then(ok => {
      if (!ok || phase === 'failed') return;
      phase = 'uncovered';
      resolveComplete(true);
    });
  }
  function tick(now) {
    const dt = Math.min((now - last) / 1000, .05);
    last = now;
    const gap = target - shown;
    shown += Math.min(gap, dt * .75, gap * (1 - Math.exp(-dt * 7)));
    if (target === 1 && 1 - shown < .003) shown = 1;
    paint();
    if (resolveComplete && shown === 1) uncover();
    else raf = win.requestAnimationFrame(tick);
  }

  return {
    start() {
      if (phase !== 'idle') return Promise.resolve(false);
      phase = 'loading';
      // Starting preparation launches the comet with the copy fade, even before
      // the first resource callback. Later readiness stages continue its fall.
      target = .08;
      copy.inert = true;
      copy.setAttribute('aria-hidden', 'true');
      root.querySelector('button').disabled = true;
      progress.hidden = false;
      root.setAttribute('aria-busy', 'true');
      measure();
      root.classList.add('is-loading');
      win.addEventListener('resize', measure);
      last = win.performance.now();
      if (!reduced) raf = win.requestAnimationFrame(tick);
      return wait(reduced ? 0 : 450);
    },
    progress(value) {
      if (phase !== 'loading' || !Number.isFinite(value)) return;
      // Resource callbacks can arrive out of order. Never move the comet back.
      target = Math.max(target, Math.min(.98, Math.max(0, value)));
      if (reduced) { shown = target; paint(); }
    },
    complete() {
      if (completion) return completion;
      if (phase !== 'loading') return Promise.resolve(false);
      completion = new Promise(resolve => { resolveComplete = resolve; });
      target = 1;
      if (reduced) { shown = 1; paint(); uncover(); }
      return completion;
    },
    async reveal() {
      if (phase !== 'uncovered') return false;
      phase = 'revealing';
      root.classList.add('is-revealed');
      const ok = await wait(reduced ? 0 : 650);
      if (!ok || phase === 'failed') return false;
      root.hidden = true;
      phase = 'done';
      return true;
    },
    fail() {
      phase = 'failed';
      stop();
      for (const [id, resolve] of waits) { win.clearTimeout(id); resolve(false); }
      waits.clear();
      resolveComplete?.(false);
      root.hidden = true;
      root.setAttribute('aria-busy', 'false');
    },
  };
}
