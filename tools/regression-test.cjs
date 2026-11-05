// Regression tests for MXT-CMS-003C
// Tests SVD catalog integration

const { chromium } = require('playwright');

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

    context.close();
  }

  await browser.close();

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
