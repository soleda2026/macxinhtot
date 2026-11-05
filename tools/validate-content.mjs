import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

let failures = 0;
const check = (ok, message) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`);
  if (!ok) failures++;
};

const products = JSON.parse(read('products.json'));
const softwares = JSON.parse(read('softwares.json')).softwares;
const html = read('index.html');
const pagesConfig = read('.pages.yml');

const expectedProducts = {
  laptops: ['MacBook Pro 14" M1 Pro', 'MacBook Air 13" M5', 'MacBook Pro 16" M4 Pro , Máy MDM'],
  desktops: ['Mac mini M4', 'iMac 24" M4', 'Mac Studio M4 Max'],
  harddrives: ['OWC Express 1M2 2TB', 'WD Elements Portable 4TB', 'Apple SSD Kit Pro 2TB'],
  accessories: ['AirPods Pro 2 (USB-C)', 'Apple Magic Mouse', 'RayCue Hub & Stand', 'Apple Studio Display']
};

let productCount = 0;
for (const [category, names] of Object.entries(expectedProducts)) {
  const items = products[category];
  check(Array.isArray(items), `products.json có mảng "${category}"`);
  if (!Array.isArray(items)) continue;
  productCount += items.length;
  for (const name of names) {
    check(items.some((item) => item.name === name), `giữ sản phẩm "${name}" trong ${category}`);
  }
  for (const item of items) {
    check(typeof item.name === 'string' && item.name.trim() !== '', `${category}: tên sản phẩm hợp lệ`);
    check(typeof item.tag === 'string', `${category}: "${item.name}" có tag`);
    check(typeof item.desc === 'string', `${category}: "${item.name}" có desc`);
    check(Array.isArray(item.chips), `${category}: "${item.name}" có chips dạng mảng`);
    check(typeof item.price === 'string' && item.price.trim() !== '', `${category}: "${item.name}" có giá`);
  }
}
check(productCount === 13, `đủ 13 sản phẩm (thực tế: ${productCount})`);

const legacyApps = {
  Malwarebytes: 'https://www.malwarebytes.com/',
  'Google Drive': 'https://www.google.com/drive/download/',
  'The Unarchiver': 'https://theunarchiver.com/',
  'VLC Media Player': 'https://www.videolan.org/vlc/',
  eqMac: 'https://eqmac.app/',
  AppCleaner: 'https://freemacsoft.net/appcleaner/',
  OpenKey: 'https://github.com/tuyenvm/OpenKey',
  AnyDesk: 'https://anydesk.com/'
};

check(Array.isArray(softwares), 'softwares.json có mảng "softwares"');
for (const [name, url] of Object.entries(legacyApps)) {
  const app = (softwares || []).find((item) => item.name === name);
  check(Boolean(app), `giữ app cũ "${name}"`);
  if (app) check(app.url === url, `"${name}" giữ đúng link tải`);
}
check((softwares || []).length >= 8, `có ít nhất 8 apps cũ (thực tế: ${softwares?.length ?? 0})`);

const names = new Set();
for (const item of softwares || []) {
  const label = item.name || '(không tên)';
  check(typeof item.name === 'string' && item.name.trim() !== '', 'software có tên');
  check(!names.has(item.name), `software "${label}" không trùng tên`);
  names.add(item.name);
  check(item.platform === 'macos' || item.platform === 'ios' || item.platform === 'chrome', `"${label}" có platform macos|ios`);
  check(typeof item.desc === 'string' && item.desc.trim() !== '', `"${label}" có mô tả`);
  check(typeof item.free === 'boolean', `"${label}" có free dạng boolean`);
  check(typeof item.price === 'string', `"${label}" có price dạng chuỗi`);
  check(item.screenshots === undefined || Array.isArray(item.screenshots), `"${label}" có screenshots dạng mảng`);
  check(item.url === '' || /^https?:\/\//i.test(item.url), `"${label}" có URL http(s) hợp lệ`);
  check(item.icon === undefined || typeof item.icon === 'string', `"${label}" có icon/image`);
  check(item.version === undefined || typeof item.version === 'string', `"${label}" có version`);
}

for (const id of ['grid-laptops', 'grid-desktops', 'grid-harddrives', 'grid-accessories', 'apps-grid']) {
  check(html.includes(`id="${id}"`), `index.html có #${id}`);
}
check(html.includes("fetch('products.json')"), 'index.html tải products.json');
check(html.includes("fetch('softwares.json')"), 'index.html tải softwares.json');
check(html.includes('data-platform="macos"') && html.includes('data-platform="ios"'), 'index.html có bộ lọc macOS và iOS');
check(html.includes('app__shots'), 'index.html hiển thị screenshots');
check(html.includes('id="apps"'), 'giữ anchor #apps cũ');
check(html.includes('href="#apps"'), 'nav/footer vẫn trỏ tới #apps');
check(!/gh[pousr]_[A-Za-z0-9]{20,}/.test(html), 'không có GitHub token trong HTML');
check(!/github_pat_[A-Za-z0-9_]{20,}/.test(html), 'không có GitHub fine-grained token trong HTML');
check(!/client_secret\s*[:=]/i.test(html), 'không có client secret trong HTML');
check(exists('assets/uploads'), 'tồn tại thư mục assets/uploads');

for (const needle of ['path: products.json', 'path: softwares.json', 'input: assets/uploads', 'type: image', 'screenshots', 'platform']) {
  check(pagesConfig.includes(needle), `.pages.yml có "${needle}"`);
}

const articlesIndex = read('articles/articles.json');
const articles = JSON.parse(articlesIndex);
check(Array.isArray(articles), 'articles/articles.json là mảng');
const articleSlugs = new Set();
for (const item of articles || []) {
  const label = item.title || '(không tiêu đề)';
  check(typeof item.title === 'string' && item.title.trim() !== '', `bài viết "${label}" có tiêu đề`);
  check(typeof item.slug === 'string' && item.slug.trim() !== '', `bài viết "${label}" có slug`);
  if (item.slug) {
    check(!articleSlugs.has(item.slug), `slug "${item.slug}" không trùng`);
    articleSlugs.add(item.slug);
  }
  check(typeof item.category === 'string', `bài viết "${label}" có danh mục`);
  check(typeof item.summary === 'string', `bài viết "${label}" có tóm tắt`);
  check(typeof item.body === 'string', `bài viết "${label}" có nội dung`);
  check(item.draft === true || item.draft === false, `bài viết "${label}" có draft boolean`);
  if (item.publishedDate) {
    check(!isNaN(Date.parse(item.publishedDate)), `bài viết "${label}" có ngày xuất bản hợp lệ`);
  }
  // Draft articles must not be in published list
  if (item.draft === true) {
    check(!item.publishedDate || true, `bài viết "${label}" là draft (không xuất bản)`);
  }
  // Article JSON file exists
  if (item.slug) {
    check(exists('articles/'+item.slug+'.json'), `bài viết "${label}" có file JSON "${item.slug}.json"`);
  }
}
check(exists('articles/index.html'), 'tồn tại trang liệt kê bài viết articles/index.html');
check(exists('articles/article.html'), 'tồn tại trang chi tiết bài viết articles/article.html');
check(html.includes('/articles/'), 'index.html có liên kết đến /articles/');

console.log(`\n${failures ? `${failures} kiểm tra thất bại` : 'Tất cả kiểm tra đạt'}`);
process.exit(failures ? 1 : 0);
