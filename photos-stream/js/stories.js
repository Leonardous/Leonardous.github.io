import { clamp, mulberry } from './math.js';
export const NF = 2400;
// 章节上限来自纹理打包：每个故事占 4 个 texel —— 第 0 个存章节数与颜色，
// 第 1、2 个存章节 0-7 的层号，第 3 个存章节 8-15。所以是 16 章。
// 详见 app.js 的 uploadStories() 与 shaders.js 里的取用方式。
export const MAX_CHAPTERS = 16;

// Every thread gets a story. Authored stories in stories.json claim their lines; every other
// line is drawn from a single city's photographs, so a thread always shows one coherent place
// instead of a random mix, and its title is that city's name.
export function buildStories(photos, authored = [], journal = []) {
  const stories = new Array(NF);
  for (const s of authored) stories[s.line] = { ...s };

  // 按城市分组：photo id 形如 {城市}-{文件名}，所以取第一个连字符之前的部分。
  const byCity = new Map();
  photos.forEach((p, j) => {
    const city = String(p.id).split('-')[0];
    if (!byCity.has(city)) byCity.set(city, []);
    byCity.get(city).push(j);
  });
  const cities = [...byCity.entries()].map(([city, idx]) => ({
    city,
    idx,
    // 显示名优先用相册里的中文名（photos.json 的 city 字段），没有就退回目录名。
    name: photos[idx[0]].city || city,
  }));

  for (let i = 0; i < NF; i++) {
    if (stories[i]) continue;
    const r = mulberry(i * 2654435761 + 97);

    if (!cities.length) {                       // 没有照片时保持原样的空故事
      stories[i] = { id: `line-${i + 1}`, line: i, title: `Line ${i + 1}`, chapters: [] };
      continue;
    }

    const { name, idx } = cities[Math.floor(r() * cities.length)];
    // 章节数不超过该城市的照片数：否则同一张照片会在一条丝线里重复出现，
    // 放大后就是"一条线里全是同一张图"。
    const n = Math.min(idx.length, 4 + Math.floor(r() * 5));
    // 起点也按种子轮换，这样同一座城市的不同丝线不会每次都从同一张照片开始。
    const start = Math.floor(r() * idx.length);
    const chapters = [];
    for (let c = 0; c < n; c++) {
      const j = idx[(start + c) % idx.length];
      chapters.push({ photo: photos[j].id, caption: photos[j].description });
    }
    stories[i] = { id: `line-${i + 1}`, line: i, title: `${name} · ${start + 1}`, chapters };
  }
  const byId = new Map(photos.map((p, j) => [p.id, j]));
  for (const s of stories) {
    s.chapters = s.chapters.map(c => {
      const layer = byId.get(String(c.photo)), p = photos[layer];
      // LOCAL ADDITION (photos-stream): carry the reduced sizes through so the story view
      // can show a thumbnail immediately and swap in the larger file once it has loaded.
      return { ...c, layer, src: p.src, thumb: p.thumb, full: p.full, aspect: p.aspect, caption: c.caption ?? p.description, credit: c.credit ?? p.photographer };
    });
    // Journal entries: authored text wins; otherwise the shared template, spread so that every
    // story, however short, begins with the first entry and ends with the last.
    const n = s.chapters.length, T = journal.length;
    s.chapters.forEach((c, k) => {
      const t = T ? journal[Math.round(k * (T - 1) / Math.max(1, n - 1))] : {};
      c.date = c.date ?? t.date ?? '';
      c.text = c.text ?? t.text ?? '';
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
