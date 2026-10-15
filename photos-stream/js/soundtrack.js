// The full mix is rendered locally at build time. Visits only download and decode it.
export async function loadSoundtrack(ctx) {
  const controller = new AbortController();
  let timer;
  const read = async () => {
    const response = await fetch('./audio/yantu-loop.mp3?v=3eddaa089417', { cache: 'force-cache', signal: controller.signal });
    if (!response.ok) throw new Error(`Could not load soundtrack (${response.status}).`);
    const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
    if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) throw new Error('The soundtrack is empty.');
    return { buffer, duration: buffer.duration, openingChord: 'Dm(add9) — D3 F3 A3 E4' };
  };
  try {
    return await Promise.race([
      read(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('Soundtrack loading timed out.'));
        }, 6000);
      }),
    ]);
  } finally { clearTimeout(timer); }
}
