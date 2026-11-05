// Build script for article publishing pipeline.
// Discovers article JSON files in articles/, validates them, excludes drafts
// from the public index and from the deployment artifact,
// and generates articles/articles.json deterministically into a staging directory.
// Published article source files are never modified.
// Draft article source files are never deleted from the developer's working tree.
// Deployment-only filtering occurs in the isolated staging directory.
//
// The staging copy uses an explicit ALLOWLIST of public website resources.
// Anything not on the allowlist (.git, .github, .pages.yml, tools/, backups/,
// node_modules, env files, credentials, fixtures, etc.) is excluded from dist/.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const articlesDir = path.join(root, 'articles');
const outDir = path.join(root, process.argv[2] || 'dist');
const outArticlesDir = path.join(outDir, 'articles');

// Explicit allowlist of public website resources.
// Files not on this list are never deployed, even if newly created.
const ALLOWED_ROOT_FILES = new Set([
  'index.html',   // homepage
  'CNAME',        // custom domain
  'products.json', // product data
  'softwares.json', // software data
  'MacXinhTot-01.jpg', // public asset
]);

const ALLOWED_ROOT_DIRS = new Set([
  'articles', // index.html, article.html + regenerated articles.json + published article JSONs
  'assets',   // svd-icon.png, uploads/, vendor/ (marked + DOMPurify)
  'svd',      // svd/index.html
]);

// Within articles/, only these files are copied as-is from source.
// Source article *.json files are excluded — they are regenerated below
// from validated, published articles only.
const ALLOWED_ARTICLES_FILES = new Set([
  'index.html',
  'article.html',
]);

let failures = 0;
const fail = (message) => {
  console.error(`BUILD ERROR: ${message}`);
  failures++;
};

function readJsonFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    fail(`Cannot read ${path.relative(root, filePath)}: ${err.message}`);
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(`Invalid JSON in ${path.relative(root, filePath)}: ${err.message}`);
    return null;
  }
}

function validateArticle(article, filePath) {
  const rel = path.relative(root, filePath);
  const errors = [];

  if (typeof article.title !== 'string' || article.title.trim() === '') {
    errors.push('missing or empty "title"');
  }
  if (typeof article.slug !== 'string' || article.slug.trim() === '') {
    errors.push('missing or empty "slug"');
  }
  if (typeof article.category !== 'string') {
    errors.push('missing "category"');
  }
  if (typeof article.coverImage !== 'string' || article.coverImage.trim() === '') {
    // coverImage is optional per schema; skip hard failure
  }
  if (typeof article.summary !== 'string') {
    errors.push('missing "summary"');
  }
  if (typeof article.body !== 'string') {
    errors.push('missing "body"');
  }
  if (article.publishedDate && isNaN(Date.parse(article.publishedDate))) {
    errors.push('invalid "publishedDate"');
  }
  if (article.draft !== true && article.draft !== false) {
    errors.push('missing or invalid "draft" (boolean)');
  }

  if (errors.length > 0) {
    fail(`${rel}: ${errors.join(', ')}`);
    return false;
  }
  return true;
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDirContents(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirContents(src, dest);
    } else {
      copyFile(src, dest);
    }
  }
}

function copyAllowedArticles(srcDir, destDir) {
  // Copy only explicitly allowed non-JSON files (index.html, article.html).
  // Source article *.json files are excluded — regenerated below.
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of ALLOWED_ARTICLES_FILES) {
    const src = path.join(srcDir, name);
    if (fs.existsSync(src)) {
      copyFile(src, path.join(destDir, name));
    }
  }
}

function main() {
  // Clean and recreate the isolated staging directory.
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  // Copy only explicitly allowed public resources from root into staging.
  // Denylist approach replaced by allowlist: new dev files are never accidentally deployed.
  for (const name of ALLOWED_ROOT_FILES) {
    const src = path.join(root, name);
    if (fs.existsSync(src)) {
      copyFile(src, path.join(outDir, name));
    } else {
      fail(`Allowed public resource missing: ${name}`);
    }
  }

  for (const name of ALLOWED_ROOT_DIRS) {
    const src = path.join(root, name);
    if (!fs.existsSync(src)) {
      fail(`Allowed public directory missing: ${name}`);
      continue;
    }
    if (name === 'articles') {
      copyAllowedArticles(src, path.join(outDir, name));
    } else {
      copyDirContents(src, path.join(outDir, name));
    }
  }

  // Discover article JSON files, excluding articles.json itself
  let files;
  try {
    files = fs.readdirSync(articlesDir);
  } catch (err) {
    fail(`Cannot read articles directory: ${err.message}`);
    process.exit(1);
  }

  const jsonFiles = files
    .filter((f) => f.endsWith('.json') && f !== 'articles.json')
    .sort()
    .map((f) => path.join(articlesDir, f));

  const published = [];
  const seenSlugs = new Set();

  for (const filePath of jsonFiles) {
    const article = readJsonFile(filePath);
    if (!article) continue;

    if (!validateArticle(article, filePath)) continue;

    const slug = article.slug.trim();
    const expectedFile = `${slug}.json`;
    const actualFile = path.basename(filePath);
    if (actualFile !== expectedFile) {
      fail(`Filename mismatch in ${path.relative(root, filePath)}: expected "${expectedFile}", got "${actualFile}"`);
      continue;
    }
    if (seenSlugs.has(slug)) {
      fail(`Duplicate slug "${slug}" in ${path.relative(root, filePath)}`);
      continue;
    }
    seenSlugs.add(slug);

    if (article.draft === true) {
      // Draft excluded from public index and deployment artifact.
      // Source file is left untouched in the developer's working tree.
      continue;
    }

    published.push({
      title: article.title.trim(),
      slug: slug,
      category: article.category.trim(),
      coverImage: article.coverImage ? article.coverImage.trim() : '',
      summary: article.summary.trim(),
      publishedDate: article.publishedDate || '',
    });

    // Copy published article JSON to staging (drafts are not copied).
    try {
      fs.mkdirSync(outArticlesDir, { recursive: true });
      fs.copyFileSync(filePath, path.join(outArticlesDir, `${slug}.json`));
    } catch (err) {
      fail(`Cannot copy published article to staging ${path.relative(root, filePath)}: ${err.message}`);
    }
  }

  // Deterministic output: sort by slug
  published.sort((a, b) => a.slug.localeCompare(b.slug));

  // Write index to staging (deterministic JSON with 2-space indent)
  const indexJson = JSON.stringify(published, null, 2) + '\n';
  try {
    fs.mkdirSync(outArticlesDir, { recursive: true });
    fs.writeFileSync(path.join(outArticlesDir, 'articles.json'), indexJson, 'utf8');
  } catch (err) {
    fail(`Cannot write articles index to staging: ${err.message}`);
    process.exit(1);
  }

  console.log(`Build complete: ${published.length} published article(s) indexed into staging at ${outDir}`);
  if (failures > 0) {
    console.error(`Build completed with ${failures} error(s)`);
    process.exit(1);
  }
}

main();
