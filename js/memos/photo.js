// 本地相册过滤与瀑布流布局

function whenDOMReady() {
  if (location.pathname == '/photos/') {
    const localPhotos = document.querySelectorAll('.gallery-photo[data-category]');
    if (localPhotos.length > 0) {
      // 本地模式：先渲染本地照片，再追加 memos 照片
      imgStatus.watch('.photo-img', () => { waterfall('.gallery-photos'); });
      window.Lately && Lately.init({ target: '.photo-time' });
      appendMemosPhotos();
    } else {
      // 纯 memos 模式（本地无照片时）
      photos();
    }
  }
}
whenDOMReady();
document.addEventListener("pjax:complete", whenDOMReady);

window.onresize = () => {
  if (location.pathname == '/photos/') waterfall('.gallery-photos');
};

// 本地相册分类过滤
function filterPhotos(category, el) {
  // 更新选中状态
  document.querySelectorAll('#bar-box .status-bar-item').forEach(item => {
    item.classList.remove('selected');
  });
  if (el) {
    el.closest('.status-bar-item').classList.add('selected');
  } else {
    const first = document.querySelector('#bar-box .status-bar-item');
    if (first) first.classList.add('selected');
  }

  // 显示/隐藏对应分类的照片
  document.querySelectorAll('.gallery-photo').forEach(photo => {
    if (category === 'all' || photo.dataset.category === category) {
      photo.style.display = '';
    } else {
      photo.style.display = 'none';
    }
  });

  // 重新计算瀑布流布局
  waterfall('.gallery-photos');
}

// 构建 memos 照片 HTML 片段
function buildMemosHtml(data, url) {
  let html = '', imgs = [];
  data.forEach(item => {
    let ls = item.content.match(/\!\[.*?\]\(.*?\)/g);
    if (ls) imgs = imgs.concat(ls);
    if (item.resourceList && item.resourceList.length) {
      item.resourceList.forEach(t => {
        if (t.externalLink) imgs.push(`![](${t.externalLink})`);
        else imgs.push(`![](${url}/o/r/${t.id}/${t.publicId}/${t.filename})`);
      });
    }
  });
  imgs.forEach(item => {
    let img = item.replace(/!\[.*?\]\((.*?)\)/g, '$1'),
        time, title, tat = item.replace(/!\[(.*?)\]\(.*?\)/g, '$1');
    if (tat.indexOf(' ') != -1) {
      time = tat.split(' ')[0];
      title = tat.split(' ')[1];
    } else title = tat;
    html += `<div class="gallery-photo"><a href="${img}" data-fancybox="gallery" class="fancybox" data-thumb="${img}"><img class="no-lazyload photo-img" loading='lazy' decoding="async" src="${img}"></a>`;
    if (title) html += `<span class="photo-title">${title}</span>`;
    if (time) html += `<span class="photo-time">${time}</span>`;
    html += `</div>`;
  });
  return html;
}

// 纯 memos 模式：替换整个相册区域
function photos(tag) {
  let url = 'https://memos.meuicat.com';
  let apiUrl = tag ? `${url}/api/v1/memo?creatorId=2&tag=${tag}` : `${url}/api/v1/memo?creatorId=2&tag=相册`;
  fetch(apiUrl).then(res => res.json()).then(data => {
    const html = buildMemosHtml(data, url);
    const container = document.querySelector('.gallery-photos.page');
    if (container) container.innerHTML = html;
    imgStatus.watch('.photo-img', () => { waterfall('.gallery-photos'); });
    window.Lately && Lately.init({ target: '.photo-time' });
  }).catch(() => {});
}

// 追加模式：在本地照片之后追加 memos 照片
function appendMemosPhotos(tag) {
  let url = 'https://memos.meuicat.com';
  let apiUrl = tag ? `${url}/api/v1/memo?creatorId=2&tag=${tag}` : `${url}/api/v1/memo?creatorId=2&tag=相册`;
  const container = document.querySelector('.gallery-photos.page');
  if (!container) return;
  fetch(apiUrl).then(res => res.json()).then(data => {
    const html = buildMemosHtml(data, url);
    if (html) {
      container.insertAdjacentHTML('beforeend', html);
      // 新图片加载完后重新排布瀑布流
      imgStatus.watch('.photo-img', () => { waterfall('.gallery-photos'); });
      window.Lately && Lately.init({ target: '.photo-time' });
    }
  }).catch(() => {});
}

// 分类栏滚动翻页
function statusbar(elementId) {
  const container = document.getElementById(elementId);
  if (container) {
    const buttonId = (elementId === "category-bar-items") ? "category-bar-button" : "status-bar-button";
    const button = document.getElementById(buttonId);
    const maxScroll = container.scrollWidth - container.clientWidth;

    if (container.scrollLeft + container.clientWidth >= maxScroll - 8) {
      container.scrollTo({ left: 0, behavior: "smooth" });
    } else {
      container.scrollBy({ left: container.clientWidth, behavior: "smooth" });
    }

    container.addEventListener("scroll", function () {
      button.style.transform = (container.scrollLeft + container.clientWidth >= maxScroll - 8) ? "rotate(180deg)" : "";
    }, { once: true });
  }
}

  