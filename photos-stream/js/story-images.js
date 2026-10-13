// Detail photographs load independently of the waterfall's GPU texture pass.
// One request serves every repeated copy of a photograph in the endless column.
const ready = new Set();
const pending = new Map();
const queue = [];
const MAX_LOADS = 4;
let active = 0;

function flush() {
  while (active < MAX_LOADS && queue.length) {
    const task = queue.shift();
    task.targets = task.targets.filter(img => img.isConnected && img.dataset.hi === task.src);
    if (!task.targets.length) { pending.delete(task.src); continue; }
    active++;
    const preload = new Image();
    preload.decoding = 'async';
    preload.fetchPriority = 'high';
    let settled = false;
    const finish = ok => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      preload.onload = preload.onerror = null;
      active--;
      pending.delete(task.src);
      if (ok) {
        ready.add(task.src);
        for (const img of task.targets) {
          if (!img.isConnected || img.dataset.hi !== task.src) continue;
          img.src = task.src;
          img.dataset.tier = 'full';
        }
      }
      // Failure leaves the displayed medium/thumbnail intact and frees the slot.
      flush();
    };
    const timer = setTimeout(() => finish(false), 20000);
    preload.onload = async () => {
      try {
        if (preload.decode) await preload.decode();
        finish(true);
      } catch { finish(false); }
    };
    preload.onerror = () => finish(false);
    preload.src = task.src;
  }
}

export function upgradeStoryPhotos(root) {
  // Put visible photographs first, so offscreen copies never hold up the view.
  const images = [...root.querySelectorAll('img[data-hi]')].sort((a, b) => {
    const distance = img => Math.abs(img.getBoundingClientRect().top - innerHeight / 2);
    return distance(a) - distance(b);
  });
  for (const img of images) {
    const src = img.dataset.hi;
    if (!src) continue;
    if (ready.has(src)) {
      img.src = src;
      img.dataset.tier = 'full';
      continue;
    }
    let task = pending.get(src);
    if (!task) {
      task = { src, targets: [] };
      pending.set(src, task);
      queue.push(task);
    }
    if (!task.targets.includes(img)) task.targets.push(img);
  }
  flush();
}
