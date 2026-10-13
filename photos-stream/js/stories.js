import { clamp, mulberry } from './math.js?v=e8b40f6f86ec';
export const NF = 2400;
// One RGBA texel stores the chapter count and colour, followed by four chapter
// indices per texel. Keep the CPU packing and both shader stages on this layout.
export const MAX_CHAPTERS = 16;
export const STORY_TEXELS = 1 + Math.ceil(MAX_CHAPTERS / 4);

export function packStoryTexture(stories) {
  const width = 1024, height = Math.ceil(stories.length * STORY_TEXELS / width);
  const data = new Float32Array(width * height * 4);
  stories.forEach((story, i) => {
    if (story.chapters.length > MAX_CHAPTERS) {
      throw new RangeError(`Story ${story.id ?? i} exceeds ${MAX_CHAPTERS} chapters.`);
    }
    const base = i * STORY_TEXELS * 4;
    data.set([story.chapters.length, ...story.col], base);
    story.chapters.forEach((chapter, k) => { data[base + 4 + k] = chapter.layer; });
  });
  return { width, height, data };
}

// Interleave cities throughout the dense curtain, with no equal neighbours and
// a stable seed per line.
// Every thread contains that city's complete album, in its authored story order.
export function buildStories(photos, authored = [], journal = []) {
  const stories = new Array(NF);
  for (const s of authored) stories[s.line] = { ...s };

  // 按城市分组：photo id 形如 {城市}-{文件名}，所以取第一个连字符之前的部分。
  const cityOf = id => String(id).split('-')[0];
  const byCity = new Map();
  photos.forEach((p, j) => {
    const city = cityOf(p.id);
    if (!byCity.has(city)) byCity.set(city, []);
    byCity.get(city).push(j);
  });
  const completeChapters = (chapters, idx) => {
    const seen = new Set(), complete = [];
    for (const chapter of chapters) {
      const id = String(chapter.photo);
      if (seen.has(id)) continue;
      seen.add(id);
      complete.push({ ...chapter });
    }
    for (const j of idx) {
      const photo = photos[j];
      if (seen.has(String(photo.id))) continue;
      seen.add(String(photo.id));
      complete.push({ photo: photo.id, caption: photo.description });
    }
    return complete;
  };
  const cities = [...byCity.entries()].map(([city, idx]) => {
    const template = authored.find(story => story.chapters.length && story.chapters.every(chapter => cityOf(chapter.photo) === city));
    return {
      city,
      idx,
      // 显示名优先用相册里的中文名，没有就退回目录名。
      name: photos[idx[0]].city || city,
      chapters: completeChapters(template?.chapters ?? [], idx),
    };
  });

  // Work backwards from authored lines before choosing randomly. A city is
  // feasible here if the next line can use a different one. This also handles
  // two-city albums, where an authored line fixes the alternating sequence.
  const cityChoices = new Array(NF);
  if (cities.length > 1) {
    for (let i = NF - 1; i >= 0; i--) {
      let choices = stories[i]
        ? cities.filter(candidate => candidate.city === cityOf(stories[i].chapters[0].photo))
        : cities;
      const next = cityChoices[i + 1];
      if (next?.length === 1) choices = choices.filter(candidate => candidate.city !== next[0].city);
      if (!choices.length) throw new Error('Authored story positions cannot be arranged without adjacent cities repeating.');
      cityChoices[i] = choices;
    }
  }

  for (let i = 0; i < NF; i++) {
    if (stories[i]) {
      const story = stories[i];
      const city = cityOf(story.chapters[0].photo);
      if (story.chapters.some(chapter => cityOf(chapter.photo) !== city)) {
        throw new Error(`Story ${story.id} must contain photos from one city.`);
      }
      story.chapters = completeChapters(story.chapters, byCity.get(city));
      continue;
    }

    if (!cities.length) {                       // 没有照片时保持原样的空故事
      stories[i] = { id: `line-${i + 1}`, line: i, title: `Line ${i + 1}`, chapters: [] };
      continue;
    }

    const previousCity = i > 0 ? cityOf(stories[i - 1].chapters[0].photo) : null;
    const choices = cities.length > 1
      ? cityChoices[i].filter(candidate => candidate.city !== previousCity)
      : cities;
    const random = mulberry(i * 2654435761 + 97);
    const { name, chapters } = choices[Math.floor(random() * choices.length)];
    stories[i] = { id: `line-${i + 1}`, line: i, title: name, chapters: chapters.map(chapter => ({ ...chapter })) };
  }
  const byId = new Map(photos.map((p, j) => [p.id, j]));
  for (const s of stories) {
    s.chapters = s.chapters.map(c => {
      const layer = byId.get(String(c.photo)), p = photos[layer];
      // LOCAL ADDITION (photos-stream): carry the reduced sizes through so the story view
      // can show a thumbnail immediately and swap in the larger file once it has loaded.
      return { ...c, layer, src: p.src, thumb: p.thumb, full: p.full, aspect: p.aspect, date: c.date ?? p.date, caption: c.caption ?? p.description, credit: c.credit ?? p.photographer };
    });
    // Journal entries: authored text wins; otherwise the shared template, spread so that every
    // story, however short, begins with the first entry and ends with the last.
    const n = s.chapters.length, T = journal.length;
    s.chapters.forEach((c, k) => {
      const t = T ? journal[Math.round(k * (T - 1) / Math.max(1, n - 1))] : {};
      c.date = c.date ?? t.date ?? '';
      c.text = c.text ?? t.text ?? c.caption ?? '';
    });
    colourStory(s, photos);
  }
  return stories;
}

// A luminous version of the story's average colour: its thread's colour and its page's accent.
function colourStory(s, photos) {
  let r = 0, g = 0, b = 0;
  for (const c of s.chapters) { const a = photos[c.layer].avg; r += a[0]; g += a[1]; b += a[2]; }
  const n = s.chapters.length; r /= n; g /= n; b /= n;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  const sat = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (mx !== mn) h = mx === r ? ((g - b) / (mx - mn) + 6) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4;
  const S = clamp(sat * 1.9 + 0.2, 0.45, 0.9), L = 0.62;
  const C = (1 - Math.abs(2 * L - 1)) * S, X = C * (1 - Math.abs((h % 2) - 1)), m = L - C / 2;
  const [rr, gg, bb] = h < 1 ? [C, X, 0] : h < 2 ? [X, C, 0] : h < 3 ? [0, C, X] : h < 4 ? [0, X, C] : h < 5 ? [X, 0, C] : [C, 0, X];
  s.col = [rr + m, gg + m, bb + m];
  s.rgb = s.col.map(v => Math.round(v * 255)).join(' ');
}
