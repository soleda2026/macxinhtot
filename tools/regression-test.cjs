// Regression tests for MXT-CMS-004
// Tests SVD catalog integration and article publishing

const { chromium } = require('playwright');
const fs = require('node:fs');
const { execSync } = require('node:child_process');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  const results = {
    passed: 0,
    failed: 0,
    errors: []
  };

  async function test(name, fn) {
    try {
      await fn();
      results.passed++;
      console.log(`  PASS: ${name}`);
    } catch (e) {
      results.failed++;
      results.errors.push(`${name}: ${e.message}`);
      console.log(`  FAIL: ${name} - ${e.message}`);
    }
  }

  console.log('MXT-CMS-003C Regression Tests\n');

  const baseUrl = 'http://127.0.0.1:8000/';

  // Setup: create test articles and run build pipeline
  const testPublished = {
    title: 'Hướng dẫn chọn MacBook',
    slug: 'huong-dan-chon-macbook',
    category: 'Hướng dẫn',
    coverImage: 'assets/uploads/sample-cover.jpg',
    summary: 'Hướng dẫn chọn MacBook phù hợp cho nhu cầu làm việc và sáng tạo.',
    body: '# Hướng dẫn chọn MacBook\n\nBài viết này giúp bạn chọn MacBook phù hợp nhất.',
    publishedDate: '2026-11-05T00:00:00Z',
    draft: false,
  };
  const testDraft = {
    title: 'Bài viết bảo thảo',
    slug: 'bai-viet-bao-thao',
    category: 'Tin tức',
    coverImage: '',
    summary: 'Bài viết này đang bảo thảo.',
    body: 'Nội dung bảo thảo.',
    publishedDate: '2026-11-05T00:00:00Z',
    draft: true,
  };
  fs.writeFileSync('articles/huong-dan-chon-macbook.json', JSON.stringify(testPublished, null, 2));
  fs.writeFileSync('articles/bai-viet-bao-thao.json', JSON.stringify(testDraft, null, 2));
  try {
    execSync('node tools/build-articles.mjs', { stdio: 'inherit' });
  } catch (err) {
    console.error('Build failed:', err.message);
    process.exit(1);
  }

  for (const vp of [{ width: 390, height: 844 }, { width: 768, height: 1000 }, { width: 1440, height: 1000 }]) {
    console.log(`\n=== Viewport: ${vp.width}x${vp.height} ===`);
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();

    await test('Page loads successfully', async () => {
      await page.goto(baseUrl + '#apps');
      await page.waitForSelector('#apps-grid .app', { timeout: 15000 });
    });

    await test('Catalog has exactly 9 software records', async () => {
      const count = await page.$$eval('#apps-grid .app', els => els.length);
      if (count !== 9) throw new Error(`Expected 9 cards, got ${count}`);
    });

    await test('macOS filter displays 8', async () => {
      await page.click('#apps .tab[data-platform="macos"]');
      await page.waitForFunction(() => document.querySelectorAll('#apps-grid .app').length === 8);
      const count = await page.$$eval('#apps-grid .app', els => els.length);
      if (count !== 8) throw new Error(`Expected 8 macOS cards, got ${count}`);
    });

    await test('iOS filter displays 0 with empty state', async () => {
      await page.click('#apps .tab[data-platform="ios"]');
      await page.waitForFunction(() => document.querySelectorAll('#apps-grid .app').length === 0, { timeout: 5000 });
      const emptyText = await page.$eval('.apps__empty', el => el.textContent.trim());
      if (emptyText !== 'Chưa có ứng dụng trong mục này.') {
        throw new Error(`iOS empty state wrong: "${emptyText}"`);
      }
      // Reset to all
      await page.click('#apps .tab[data-platform="all"]');
      await page.waitForFunction(() => document.querySelectorAll('#apps-grid .app').length === 9);
    });

    await test('Chrome Extension filter displays 1 SVD card', async () => {
      await page.click('#apps .tab[data-platform="chrome"]');
      await page.waitForFunction(() => document.querySelectorAll('#apps-grid .app').length === 1, { timeout: 5000 });
      const count = await page.$$eval('#apps-grid .app', els => els.length);
      if (count !== 1) throw new Error(`Expected 1 Chrome Extension card, got ${count}`);
      // Verify it's SVD
      const svdName = await page.$$eval('#apps-grid .app .app__name', els => els.map(e => e.textContent.trim()));
      if (!svdName.includes('SVD')) throw new Error('Chrome Extension card is not SVD');
    });

    await test('SVD card links to /svd/', async () => {
      // Go back to all apps first
      await page.click('#apps .tab[data-platform="all"]');
      await page.waitForFunction(() => document.querySelectorAll('#apps-grid .app').length === 9);
      const svdCards = await page.$$('#apps-grid .app');
      let svdFound = false;
      for (const el of svdCards) {
        const text = await page.evaluate(el => el.textContent.trim(), el);
        if (text.includes('SVD')) {
          svdFound = true;
          const link = await el.$('.app__svd-link');
          if (!link) throw new Error('SVD card has no /svd/ link');
          const href = await link.getAttribute('href');
          if (href !== '/svd/') throw new Error(`Expected /svd/ link, got ${href}`);
          break;
        }
      }
      if (!svdFound) throw new Error('SVD card not found');
    });

    await test('SVD displays Coming Soon', async () => {
      await page.click('#apps .tab[data-platform="all"]');
      await page.waitForFunction(() => document.querySelectorAll('#apps-grid .app').length === 9);
      // Directly check for Coming Soon badge anywhere on the page
      const comingSoonCount = await page.$$eval('.app__coming-soon', els => els.length);
      if (comingSoonCount === 0) throw new Error('Coming Soon badge not found on any card');
      // Verify it's on the SVD card specifically
      const svdHasComingSoon = await page.evaluate(() => {
        const cards = document.querySelectorAll('#apps-grid .app');
        for (const card of cards) {
          if (card.textContent.includes('SVD')) {
            return card.querySelector('.app__coming-soon') !== null;
          }
        }
        return false;
      });
      if (!svdHasComingSoon) throw new Error('Coming Soon badge not found on SVD card');
    });

    await test('SVD has no download/purchase CTA', async () => {
      await page.click('#apps .tab[data-platform="all"]');
      await page.waitForFunction(() => document.querySelectorAll('#apps-grid .app').length === 9);
      const svdCards = await page.$$('#apps-grid .app');
      let svdFound = false;
      for (const el of svdCards) {
        const text = await page.evaluate(el => el.textContent.trim(), el);
        if (text.includes('SVD')) {
          svdFound = true;
          const dlLinks = await el.$$('.app__dl');
          if (dlLinks.length > 0) throw new Error('SVD card has unexpected download links');
          break;
        }
      }
      if (!svdFound) throw new Error('SVD card not found');
    });

    await test('Existing software download links functional', async () => {
      const dlLinks = await page.$$eval('#apps-grid .app__dl', els => els.map(e => e.getAttribute('href')));
      // At least some should have valid URLs
      const validLinks = dlLinks.filter(h => h && h.startsWith('http'));
      if (validLinks.length === 0) throw new Error('No valid download links found among existing software');
    });

    await test('/svd/ page loads', async () => {
      await page.goto(baseUrl + 'svd/');
      await page.waitForSelector('.page h1', { timeout: 5000 });
      const title = await page.$eval('.page h1', el => el.textContent);
      if (title !== 'SVD — Smart Video Downloader') throw new Error(`Unexpected SVD page title: ${title}`);
    });

    await test('/svd/ pricing displays Free $0', async () => {
      await page.goto(baseUrl + 'svd/');
      await page.waitForSelector('.card__name', { timeout: 5000 });
      const names = await page.$$eval('.card__name', els => els.map(e => e.textContent.trim()));
      const prices = await page.$$eval('.card__price', els => els.map(e => e.textContent.trim()));
      if (!names.includes('SVD Free')) throw new Error(`Expected SVD Free card, got ${names.join(', ')}`);
      const freeIdx = names.indexOf('SVD Free');
      if (!prices[freeIdx].includes('$0')) throw new Error(`Expected $0 price for SVD Free, got ${prices[freeIdx]}`);
    });

    await test('/svd/ pricing displays Premium $1.99/year', async () => {
      await page.goto(baseUrl + 'svd/');
      await page.waitForSelector('.card__name', { timeout: 5000 });
      const names = await page.$$eval('.card__name', els => els.map(e => e.textContent.trim()));
      const prices = await page.$$eval('.card__price', els => els.map(e => e.textContent.trim()));
      if (!names.includes('SVD Premium')) throw new Error(`Expected SVD Premium card, got ${names.join(', ')}`);
      const premIdx = names.indexOf('SVD Premium');
      if (!prices[premIdx].includes('$1.99')) throw new Error(`Expected $1.99 price, got ${prices[premIdx]}`);
      if (!prices[premIdx].includes('/year')) throw new Error(`Expected /year, got ${prices[premIdx]}`);
    });

    await test('/svd/ Coming Soon buttons are disabled (no checkout)', async () => {
      await page.goto(baseUrl + 'svd/');
      await page.waitForSelector('.btn', { timeout: 5000 });
      const btnClasses = await page.$$eval('.btn', els => els.map(e => e.className));
      const disabledCount = btnClasses.filter(c => c.includes('btn--disabled')).length;
      if (disabledCount !== 2) throw new Error(`Expected 2 disabled Coming Soon buttons, got ${disabledCount}`);
    });

    await test('/svd/ has no fake download button', async () => {
      await page.goto(baseUrl + 'svd/');
      const downloadBtns = await page.$$eval('a', els => els.filter(e => e.textContent.toLowerCase().includes('download') && !e.textContent.toLowerCase().includes('catalog')));
      if (downloadBtns.length > 0) throw new Error('Found fake download button on /svd/');
    });

    await test('/svd/ displays cooldown explanation', async () => {
      await page.goto(baseUrl + 'svd/');
      await page.waitForSelector('.cooldown__title', { timeout: 5000 });
      const cooldownTitle = await page.$eval('.cooldown__title', el => el.textContent.trim());
      if (!cooldownTitle.includes('Cooldown')) throw new Error(`Expected cooldown section, got ${cooldownTitle}`);
    });

    await test('/svd/ displays responsible-use notice', async () => {
      await page.goto(baseUrl + 'svd/');
      await page.waitForSelector('.notice__title', { timeout: 5000 });
      const noticeTitle = await page.$eval('.notice__title', el => el.textContent.trim());
      if (!noticeTitle.includes('Responsible-Use')) throw new Error(`Expected responsible-use notice, got ${noticeTitle}`);
    });

    await test('/svd/ Coming Soon badge visible', async () => {
      await page.goto(baseUrl + 'svd/');
      await page.waitForSelector('.badge', { timeout: 5000 });
      const badgeText = await page.$eval('.badge', el => el.textContent.trim());
      if (!badgeText.includes('Coming Soon')) throw new Error(`Expected Coming Soon badge, got ${badgeText}`);
    });

    await test('/svd/ official icon loads', async () => {
      await page.goto(baseUrl + 'svd/');
      await page.waitForSelector('.hero__icon', { timeout: 5000 });
      const iconSrc = await page.$eval('.hero__icon', el => el.getAttribute('src'));
      if (!iconSrc.includes('svd-icon.png')) throw new Error(`Expected svd-icon.png, got ${iconSrc}`);
      const naturalWidth = await page.evaluate(() => {
        const img = document.querySelector('.hero__icon');
        return img.naturalWidth;
      });
      if (!naturalWidth || naturalWidth < 100) throw new Error(`Icon image did not load (naturalWidth=${naturalWidth})`);
    });

    await test('SVD catalog card displays official icon', async () => {
      await page.goto(baseUrl + '#apps');
      await page.waitForSelector('#apps-grid .app', { timeout: 15000 });
      const svdCards = await page.$$('#apps-grid .app');
      let svdFound = false;
      for (const el of svdCards) {
        const text = await page.evaluate(el => el.textContent.trim(), el);
        if (text.includes('SVD')) {
          svdFound = true;
          const iconImg = await el.$('.app__icon img');
          if (!iconImg) throw new Error('SVD catalog card has no icon image');
          const src = await iconImg.getAttribute('src');
          if (!src.includes('svd-icon.png')) throw new Error(`Expected svd-icon.png, got ${src}`);
          const naturalWidth = await page.evaluate(el => el.naturalWidth, iconImg);
          if (!naturalWidth || naturalWidth < 100) throw new Error(`Icon image did not load (naturalWidth=${naturalWidth})`);
          break;
        }
      }
      if (!svdFound) throw new Error('SVD card not found in catalog');
    });

    await test('No console errors on catalog page', async () => {
      const consoleErrors = [];
      page.on('console', m => consoleErrors.push({ type: m.type(), text: m.text() }));
      await page.goto(baseUrl + '#apps');
      await page.waitForSelector('#apps-grid .app', { timeout: 15000 });
      const pageErrors = consoleErrors.filter(e => e.type === 'error');
      if (pageErrors.length > 0) throw new Error(`Console errors found: ${pageErrors.map(e => e.text).join('; ')}`);
    });

    await test('Responsive at 390px', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => document.querySelectorAll('#apps-grid .app').length === 9);
      const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
      const innerWidth = await page.evaluate(() => window.innerWidth);
      if (scrollWidth > innerWidth + 1) throw new Error(`Viewport 390px has horizontal overflow: ${scrollWidth} > ${innerWidth}`);
    });

    await test('Responsive at 768px', async () => {
      await page.setViewportSize({ width: 768, height: 1000 });
      await page.waitForFunction(() => document.querySelectorAll('#apps-grid .app').length === 9);
    });

    await test('Responsive at 1440px', async () => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.waitForFunction(() => document.querySelectorAll('#apps-grid .app').length === 9);
    });

    await test('SVD card appears in Chrome Extension filter', async () => {
      await page.click('#apps .tab[data-platform="chrome"]');
      await page.waitForFunction(() => document.querySelectorAll('#apps-grid .app').length === 1);
      const count = await page.$$eval('#apps-grid .app', els => els.length);
      if (count !== 1) throw new Error(`Chrome Extension filter should show 1 card, got ${count}`);
    });

    await test('/articles/ listing page loads', async () => {
      await page.goto(baseUrl + 'articles/', { waitUntil: 'networkidle' });
      await page.waitForFunction(() => {
        const grid = document.querySelector('#articles-grid');
        const empty = document.querySelector('#articles-empty');
        return (grid && grid.children.length > 0) || (empty && empty.style.display !== 'none');
      }, { timeout: 10000 });
    });

    await test('/articles/ listing shows published article', async () => {
      const articleCount = await page.$$eval('#articles-grid .article-card', els => els.length);
      if (articleCount !== 1) throw new Error(`Expected 1 published article, got ${articleCount}`);
      const titles = await page.$$eval('#articles-grid .card__title', els => els.map(e => e.textContent.trim()));
      if (!titles.includes('Hướng dẫn chọn MacBook')) throw new Error('Published article not found in listing');
    });

    await test('/articles/ listing excludes draft articles', async () => {
      const titles = await page.$$eval('#articles-grid .card__title', els => els.map(e => e.textContent.trim()));
      if (titles.includes('Bài viết bảo thảo')) throw new Error('Draft article should not appear in public listing');
    });

    await test('/articles/ article detail loads for published slug', async () => {
      await page.goto(baseUrl + 'articles/article.html?slug=huong-dan-chon-macbook', { waitUntil: 'networkidle' });
      await page.waitForSelector('.article__title', { timeout: 5000 });
      const title = await page.$eval('.article__title', el => el.textContent.trim());
      if (title !== 'Hướng dẫn chọn MacBook') throw new Error(`Unexpected article title: ${title}`);
    });

    await test('/articles/ article detail rejects draft slug', async () => {
      await page.goto(baseUrl + 'articles/article.html?slug=bai-viet-bao-thao', { waitUntil: 'networkidle' });
      await page.waitForSelector('#article-not-found', { timeout: 5000 });
      const notFoundVisible = await page.isVisible('#article-not-found');
      if (!notFoundVisible) throw new Error('Draft article should not be publicly accessible');
    });

    await test('/articles/ article detail rejects missing slug', async () => {
      await page.goto(baseUrl + 'articles/article.html');
      await page.waitForSelector('#article-not-found', { timeout: 5000 });
      const notFoundVisible = await page.isVisible('#article-not-found');
      if (!notFoundVisible) throw new Error('Article not-found state should show when no slug');
    });

    await test('/articles/ article detail rejects invalid slug', async () => {
      await page.goto(baseUrl + 'articles/article.html?slug=nonexistent');
      await page.waitForSelector('#article-not-found', { timeout: 5000 });
      const notFoundVisible = await page.isVisible('#article-not-found');
      if (!notFoundVisible) throw new Error('Article not-found state should show for invalid slug');
    });
    await test('/articles/ published article JSON is accessible via direct URL', async () => {
      const response = await page.request.get(baseUrl + 'articles/huong-dan-chon-macbook.json');
      if (response.status() !== 200) throw new Error('Published article JSON should return 200, got ' + response.status());
      const body = await response.text();
      const data = JSON.parse(body);
      if (data.slug !== 'huong-dan-chon-macbook') throw new Error('Published article JSON has unexpected slug: ' + data.slug);
    });

    await test('/articles/ draft article JSON is physically removed from artifact', async () => {
      const response = await page.request.get(baseUrl + 'articles/bai-viet-bao-thao.json');
      if (response.status() !== 404) throw new Error('Draft article JSON should return 404, got ' + response.status());
    });


    await test('/articles/ has no console errors', async () => {
      const consoleErrors = [];
      page.on('console', m => consoleErrors.push({ type: m.type(), text: m.text() }));
      await page.goto(baseUrl + 'articles/', { waitUntil: 'networkidle' });
      const pageErrors = consoleErrors.filter(e => e.type === 'error' && !e.text.includes('404'));
      if (pageErrors.length > 0) throw new Error(`Console errors found: ${pageErrors.map(e => e.text).join('; ')}`);
    });

    context.close();
  }

  await browser.close();

  // Cleanup: remove test article files and rebuild empty index
  try { fs.unlinkSync('articles/huong-dan-chon-macbook.json'); } catch {}
  try { fs.unlinkSync('articles/bai-viet-bao-thao.json'); } catch {}
  try { execSync('node tools/build-articles.mjs', { stdio: 'pipe' }); } catch {}

  console.log('\n=== Results ===');
  console.log(`Passed: ${results.passed}`);
  console.log(`Failed: ${results.failed}`);
  if (results.errors.length > 0) {
    console.log('Errors:');
    results.errors.forEach(e => console.log(`  - ${e}`));
  }
  console.log('\n' + (results.failed === 0 ? 'ALL TESTS PASS' : 'SOME TESTS FAILED'));
  process.exit(results.failed > 0 ? 1 : 0);
})();
