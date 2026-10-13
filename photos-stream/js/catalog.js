import { NF, MAX_CHAPTERS } from './stories.js?v=fc4b61c98ec5';

// Local relaxation for progressive loading: the page keeps three sizes of each photograph
// (thumb = 256px for first paint, medium = 1024px for the curtain, and the album's own
// 1920px copy for the highest tier), so these four roots are accepted while keeping the
// original intent — a relative local path with no traversal.
// full 用站点绝对路径（/photos/albums/...），其它两个是相对页面的路径，所以斜杠可有可无。
const LOCAL_PHOTO = /^\/?(assets\/photos|medium|thumb|photos\/albums)\/[\w./-]+$/;

// Shared by the browser and the offline catalog check. No DOM or WebGL dependencies.
export function validateCatalog(catalog, data) {
  const fail = message => { throw new Error(message); };
  const text = value => typeof value === 'string' && value.trim().length > 0;
  if (!Array.isArray(catalog?.photos) || !catalog.photos.length) fail('photos.json must contain at least one photo.');
  if (!Array.isArray(data?.stories)) fail('stories.json must contain a stories array.');
  const ids = new Set();
  const photos = catalog.photos.map(p => {
    if (!text(p?.id) || ids.has(p.id)) fail(`Missing or duplicate photo id: ${p?.id}`);
    if (!text(p.src) || !LOCAL_PHOTO.test(p.src) || p.src.split('/').includes('..')) {
      fail(`Photo ${p.id}: src must be a local path under assets/photos/, medium/ or thumb/ (no spaces, no "..").`);
    }
    for (const key of ['thumb', 'full']) {
      if (p[key] == null) continue;
      if (!text(p[key]) || !LOCAL_PHOTO.test(p[key]) || p[key].split('/').includes('..')) {
        fail(`Photo ${p.id}: ${key} must be a local path under medium/, thumb/, assets/photos/ or /photos/albums/.`);
      }
    }
    ids.add(p.id);
    const aspect = Number.isFinite(p.width) && Number.isFinite(p.height) && p.width > 0 && p.height > 0
      ? p.width / p.height : undefined;
    return { ...p, aspect, description: p.description ?? '', photographer: p.photographer ?? '', city: p.city ?? '', avg: [0.5, 0.5, 0.5] };
  });
  const lines = new Set(), storyIds = new Set();
  const authored = data.stories.map((s, k) => {
    if (!text(s?.id) || storyIds.has(s.id)) fail(`Missing or duplicate story id: ${s?.id}`);
    if (/^line-\d+$/.test(s.id)) fail(`Story ${s.id}: line-N ids are reserved for generated stories.`);
    if (!text(s.title)) fail(`Story ${s.id} needs a title.`);
    const line = s.line ?? Math.min(NF - 1, Math.round((k + 0.5) * NF / data.stories.length));
    if (!Number.isInteger(line) || line < 0 || line >= NF || lines.has(line)) fail(`Story ${s.id}: invalid or occupied line ${line}.`);
    if (!Array.isArray(s.chapters) || s.chapters.length < 1 || s.chapters.length > MAX_CHAPTERS) {
      fail(`Story ${s.id} must have 1–${MAX_CHAPTERS} chapters.`);
    }
    for (const c of s.chapters) {
      if (!ids.has(String(c?.photo))) fail(`Story ${s.id} references an unknown photo: ${c?.photo}`);
    }
    lines.add(line); storyIds.add(s.id);
    return { ...s, line };
  });
  const journal = data.journal ?? [];
  if (!Array.isArray(journal) || journal.some(entry => !entry || typeof entry !== 'object')) {
    fail('journal must be an array of date/text entries.');
  }
  return { photos, authored, journal };
}

export async function loadCatalog() {
  const read = async path => {
    const response = await fetch(path, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Could not load ${path} (${response.status}).`);
    return response.json();
  };
  const [catalog, data] = await Promise.all([read('./photos.json?v=fc4b61c98ec5'), read('./stories.json?v=fc4b61c98ec5')]);
  return validateCatalog(catalog, data);
}
