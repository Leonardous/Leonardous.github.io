// Progressive texture loading.
//
// The curtain does not need 1920px photographs: far away each thread is a couple of
// pixels, and the mosaic is a few hundred. So we upload small thumbnails first, start
// rendering immediately, then build a 1024px array in the background. Story details
// load album originals independently and never wait for this pass.
//
// Both arrays are 2D arrays so they share one sampler and one set of shader uniforms,
// and so a single `gl.bindTexture` swaps between them.

// 256px first paint, 1024px curtain detail. Keep the large album originals out of
// the GPU array: 49 layers at 1536px consumed about 617MB including mipmaps.
export const THUMB_LAYER = 256;
export const FULL_LAYER = 1024;

function decode(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.decoding = 'async';
    img.fetchPriority = 'low';
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(`Could not load photo: ${src}`));
    img.src = src;
  });
}

// Resume after a paint, so cached photographs cannot monopolize one long task.
const yieldToFrame = () => new Promise(resolve => {
  if (document.hidden) setTimeout(resolve, 16);
  else requestAnimationFrame(() => setTimeout(resolve, 0));
});

function setArrayParams(gl) {
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function makeScratch(size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  return { canvas, ctx: canvas.getContext('2d') };
}

function measureAspect(photos, i, img) {
  // Thumbnails have the same aspect as their originals, so either pass may set this.
  if (!photos[i].aspect) photos[i].aspect = img.naturalWidth / img.naturalHeight;
}

/**
 * Upload one pass of photographs into a fresh 2D texture array.
 *
 * @param {object} opts
 * @param {number} opts.size          layer edge in pixels (THUMB_LAYER or FULL_LAYER)
 * @param {(photo, i) => string} opts.srcOf  which file to read for this pass
 * @param {number} opts.workers       concurrent decodes
 * @param {(done:number, total:number) => void} [opts.onProgress]
 */
export async function loadPass(gl, photos, { size, srcOf, workers = 4, onProgress }) {
  const limit = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS);
  if (photos.length > limit) {
    throw new Error(`This device supports at most ${limit} photos; the catalog has ${photos.length}.`);
  }
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  if (size > maxTex) throw new Error(`This device supports textures up to ${maxTex}px; asked for ${size}.`);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  const levels = 1 + Math.floor(Math.log2(size));
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.RGBA8, size, size, photos.length);

  let scratch;

  // Average colour, used by the shader to tint far threads. Sampled from a downscale
  // of whichever pass is being uploaded, so it is available from the thumbnail pass on.
  const avgSize = 8;
  const tiny = size === THUMB_LAYER ? document.createElement('canvas') : null;
  if (tiny) tiny.width = tiny.height = avgSize;
  const tctx = tiny?.getContext('2d', { willReadFrequently: true });

  const queue = photos.map((_, i) => i);
  let done = 0;
  let uploads = Promise.resolve(), budgetStart = performance.now();

  const worker = async () => {
    while (queue.length) {
      const i = queue.shift();
      const img = await decode(srcOf(photos[i], i));
      // Decode/resize away from the upload task. Uploading a canvas can force a
      // synchronous pixel readback; an ImageBitmap is already ready for the GPU.
      const bitmap = typeof createImageBitmap === 'function'
        ? await createImageBitmap(img, { resizeWidth: size, resizeHeight: size, resizeQuality: 'high' }).catch(() => null)
        : null;
      // Decodes overlap, but all workers share one upload budget and scratch canvas.
      // Never yield between drawing a photograph and uploading its matching layer.
      uploads = uploads.then(async () => {
        if (performance.now() - budgetStart >= 6) {
          await yieldToFrame();
          budgetStart = performance.now();
        }
        measureAspect(photos, i, img);
        let pixels = bitmap;
        if (!pixels) {
          scratch ??= makeScratch(size);
          scratch.ctx.imageSmoothingQuality = 'high';
          scratch.ctx.clearRect(0, 0, size, size);
          scratch.ctx.drawImage(img, 0, 0, size, size);
          pixels = scratch.canvas;
        }
        if (tctx) {
          tctx.drawImage(pixels, 0, 0, avgSize, avgSize);
          const px = tctx.getImageData(0, 0, avgSize, avgSize).data;
          let r = 0, g = 0, b = 0;
          for (let j = 0; j < px.length; j += 4) { r += px[j]; g += px[j + 1]; b += px[j + 2]; }
          const cells = avgSize * avgSize;
          photos[i].avg = [r / cells / 255, g / cells / 255, b / cells / 255];
        }
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        onProgress?.(++done, photos.length);
      });
      try { await uploads; }
      finally { bitmap?.close(); }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, workers) }, worker));
  // This texture is not sampled until loadPass resolves. Build its whole mip
  // chain once, after every layer is present, instead of rebuilding it in batches.
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  setArrayParams(gl);
  return tex;
}
