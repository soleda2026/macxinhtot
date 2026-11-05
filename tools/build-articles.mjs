// Build script for article publishing pipeline.
// Discovers article JSON files in articles/, validates them, excludes drafts
// from the public index and from the deployment artifact,
// and generates articles/articles.json deterministically.
// Published article files are never modified.
// Draft article JSON files are physically removed from the articles directory
// so they cannot be served from the deployed site.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const articlesDir = path.join(root, 'articles');
const indexPath = path.join(articlesDir, 'articles.json');

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
  if (typeof itemCoverImage(article) !== 'string' || itemCoverImage(article).trim() === '') {
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

function itemCoverImage(article) {
  return article.coverImage || '';
}

function main() {
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
    if (seenSlugs.has(slug)) {
      fail(`Duplicate slug "${slug}" in ${path.relative(root, filePath)}`);
      continue;
    }
    seenSlugs.add(slug);

    if (article.draft === true) {
      // Draft excluded from public index
      continue;
    }

    published.push({
      name: article.title.trim(),
      slug: slug,
      category: article.category.trim(),
      coverImage: article.coverImage ? article.coverImage.trim() : '',
      summary: article.summary.trim(),
      publishedDate: article.publishedDate || '',
    });
  }

  // Deterministic output: sort by slug
  published.sort((a, b) => a.slug.localeCompare(b.slug));

  // Write index (deterministic JSON with 2-space indent)
  const indexJson = JSON.stringify(published, null, 2) + '\n';
  try {
    fs.writeFileSync(indexPath, indexJson, 'utf8');
  } catch (err) {
    fail(`Cannot write ${path.relative(root, indexPath)}: ${err.message}`);
    process.exit(1);
  }

  // Physically remove draft article JSON files from the articles directory
  // so they are not included in the GitHub Pages deployment artifact and
  // cannot be accessed via direct URL.
  let removedDrafts = 0;
  for (const filePath of jsonFiles) {
    const article = readJsonFile(filePath);
    if (!article) continue;
    if (article.draft === true) {
      try {
        fs.unlinkSync(filePath);
        removedDrafts++;
        console.log(`Removed draft article from deployment artifact: ${path.relative(root, filePath)}`);
      } catch (err) {
        fail(`Cannot remove draft article ${path.relative(root, filePath)}: ${err.message}`);
      }
    }
  }

  console.log(`Build complete: ${published.length} published article(s) indexed, ${removedDrafts} draft(s) removed from artifact`);
  if (failures > 0) {
    console.error(`Build completed with ${failures} error(s)`);
    process.exit(1);
  }
}

main();
