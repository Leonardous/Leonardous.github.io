// Progressive texture loading.
//
// The curtain does not need 1920px photographs: far away each thread is a couple of
// pixels, and the mosaic is a few hundred. So we upload small thumbnails first, start
// rendering immediately, then build the full-resolution array in the background and
// swap it in — the swap is deferred to the moment a story is opened, where the images
// are large on screen and the change is invisible.
//
// Both arrays are 2D arrays so they share one sampler and one set of shader uniforms,
// and so a single `gl.bindTexture` swaps between them.

// 两层纹理数组。256 让首屏先出画面，1920 的那层在后台构建完成后自动替换整幕。
// 为什么最高档要跟相册原图一样大：照片在屏幕上被放大时，着色器按"贴图层边长 / 屏幕像素"
// 取 mip，层越小就越早掉进更粗的 mip，看起来越糊。1920 让最大缩放下仍停留在第 0 级。
export const THUMB_LAYER = 256;
export const FULL_LAYER = 1920;

function decode(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(`Could not load photo: ${src}`));
    img.src = src;
  });
}

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
  const levels = 1 + Math.log2(size);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.RGBA8, size, size, photos.length);

  const { canvas: scratch, ctx } = makeScratch(size);
  ctx.imageSmoothingQuality = 'high';

  // Average colour, used by the shader to tint far threads. Sampled from a downscale
  // of whichever pass is being uploaded, so it is available from the thumbnail pass on.
  const avgSize = 8;
  const tiny = document.createElement('canvas');
  tiny.width = tiny.height = avgSize;
  const tctx = tiny.getContext('2d', { willReadFrequently: true });

  const queue = photos.map((_, i) => i);
  let done = 0;
  let sinceMipmap = 0;
  const MIPMAP_BATCH = 8;

  const refreshMipmaps = () => {
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    sinceMipmap = 0;
  };

  const worker = async () => {
    while (queue.length) {
      const i = queue.shift();
      const img = await decode(srcOf(photos[i], i));

      measureAspect(photos, i, img);

      ctx.clearRect(0, 0, size, size);
      // Stretched to a square layer; the stream restores the aspect from photos[i].aspect.
      ctx.drawImage(img, 0, 0, size, size);

      tctx.drawImage(scratch, 0, 0, avgSize, avgSize);
      const px = tctx.getImageData(0, 0, avgSize, avgSize).data;
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < px.length; j += 4) { r += px[j]; g += px[j + 1]; b += px[j + 2]; }
      const cells = avgSize * avgSize;
      // The low-res pass owns the average colour; the full pass keeps whatever is set.
      if (!photos[i].avg) photos[i].avg = [r / cells / 255, g / cells / 255, b / cells / 255];

      gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, scratch);

      done++;
      onProgress?.(done, photos.length);
      // generateMipmap redoes the whole array, so batch it. Intermediate passes only
      // need *some* valid chain; the final one is always exact.
      if (++sinceMipmap >= MIPMAP_BATCH && queue.length) refreshMipmaps();
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, workers) }, worker));
  refreshMipmaps();
  setArrayParams(gl);
  return tex;
}
