# CMS & Softwares — setup, deployment, rollback

## Verdict

**Feasible.** The site stays a static GitHub Pages site; content stays in JSON files in the
repository. Browser editing is provided by **Pages CMS** (MIT, open source, hosted at
`app.pagescms.org`), which authenticates through a GitHub App and commits directly to `main`.
No server, database, OAuth proxy or token is added to the public site.

### Why Pages CMS, not Decap CMS

| | Pages CMS (chosen) | Decap CMS |
|---|---|---|
| GitHub auth | Hosted GitHub App | Needs an OAuth server/proxy (e.g. Netlify) |
| Infrastructure | None | OAuth proxy + `/admin` bundle |
| Credentials in client | None | OAuth client setup required |
| Nested JSON lists | Supported (`type: object`, `list: true`) | Supported (`list` widget) |
| Maintenance | Lowest | Higher (auth proxy, CMS bundle updates) |

Pages CMS was verified against its official docs for `type: file`, `format: json`,
nested object lists, image fields, media folders and GitHub App authentication.

## Architecture

```
Browser (app.pagescms.org)
        │  GitHub App auth (server-side token)
        ▼
GitHub repo: soleda2026/macxinhtot  (main)
        │  commit on Save
        ▼
GitHub Pages (custom domain macxinhtot.com)
        │
        ├── index.html        static layout + client-side render
        ├── products.json     existing 13 products, unchanged
        ├── softwares.json    new macOS/iOS software catalogue
        └── assets/uploads/   images uploaded through the CMS
```

- `products.json` was **not modified**. All 13 products remain byte-for-byte identical to `HEAD`.
- The old hard-coded “Apps hữu ích” cards were migrated into `softwares.json` (all 8 apps,
  same names, descriptions, icons and download URLs). The section keeps `id="apps"`, so
  `#apps` links and the footer link still work.
- The site renders `softwares.json` into the same section under the “Softwares” heading with
  **Tất cả / macOS / iOS** filters.
- Images are stored in `assets/uploads/` and referenced by relative path, so they work on the
  custom domain and on a GitHub Pages project URL.

## Content model

`products.json` (unchanged shape):

```json
{ "laptops": [ { "tag": "", "name": "", "image": "", "desc": "", "chips": [], "price": "" } ] }
```

`softwares.json`:

| Field | Type | Notes |
|---|---|---|
| `name` | string | required |
| `icon` | string | emoji fallback, e.g. `🔒` |
| `image` | string | uploaded icon path (optional) |
| `version` | string | shown as “Phiên bản v…” when filled |
| `platform` | `macos` / `ios` | required; drives the filter |
| `category` | string | e.g. Bảo mật, Đồng bộ |
| `desc` | string | required |
| `screenshots` | string[] | up to 6, uploaded through CMS |
| `free` | boolean | free/paid status |
| `price` | string | display text, e.g. “Miễn phí 15GB” |
| `url` | string | http(s) download / App Store / buy URL |
| `osNote` | string | optional legacy note, e.g. “macOS · Win” |

## Admin setup (human, one time)

1. Push the implementation to `main` (see deployment checklist).
2. Go to <https://app.pagescms.org> and sign in with GitHub.
3. Install the **Pages CMS GitHub App** on the `soleda2026` account, limited to the
   `macxinhtot` repository only.
4. Open the repository. Pages CMS reads `.pages.yml` automatically.
5. Content menus:
   - **Sản phẩm (13)** → Laptops / Desktops / Hard Drive / Accessories. Add, edit, delete,
     upload product images, then Save.
   - **Softwares (macOS & iOS)** → add/edit/delete apps, pick platform, icon/image,
     screenshots, free toggle, price and URL, then Save.
6. **Save = publish.** Pages CMS creates a commit on `main`; GitHub Pages deploys it.
   There is no draft/staging workflow, so every save is live after the Pages build (~1 min).
7. To revoke access later: GitHub → Settings → Applications → Pages CMS → Uninstall.
   No credential or token is stored in this repository.

> Test the CMS on a fork or private copy first if you want a dry run. A first save on the
> production repo is a live change; use `tools/backup-content.sh` before bulk edits.

## Local validation

```bash
# 1. Data, links, CMS config and token checks
node tools/validate-content.mjs

# 2. Serve locally (fetch() needs http, not file://)
python3 -m http.server 8765
# open http://127.0.0.1:8765/

# 3. Confirm products.json is unchanged
git diff --exit-code -- products.json
```

Expected render: 13 product cards, 8 software cards, tabs Tất cả/macOS/iOS.
The filter was tested headlessly: `iOS = 0` (empty state), `macOS = 8`, `Tất cả = 8`.

## Deployment checklist (human does all git writes)

1. Review `git status` / `git diff`; confirm `products.json` has no changes.
2. Back up local content: `bash tools/backup-content.sh`.
3. Add and commit:
   - `index.html`
   - `softwares.json`
   - `.pages.yml`
   - `assets/uploads/.gitkeep`
   - `tools/validate-content.mjs`
   - `tools/backup-content.sh`
   - `.gitignore`
   - `CMS.md`
4. Push to `main`. Do not force-push.
5. Confirm GitHub Pages is configured as **Deploy from a branch → main → / (root)**.
   The repository has no workflow file; the custom domain is set by `CNAME`.
   **Pre-existing issue found during preflight:** `https://macxinhtot.com/` currently
   presents a `*.github.io` certificate (hostname mismatch), while `http://` returns 200.
   The live files still match `HEAD` exactly, so this is not caused by these changes.
   In **Settings → Pages**, confirm the custom domain is `macxinhtot.com`, wait for the
   certificate to be issued, then enable **Enforce HTTPS**. Check both apex and `www`.
6. After the Pages build succeeds:
   - `curl -I https://macxinhtot.com/` → 200
   - `curl -I https://macxinhtot.com/softwares.json` → 200
   - `curl -I https://macxinhtot.com/assets/uploads/` → directory may 404; upload one image
     through the CMS and confirm the returned `assets/uploads/...` URL loads.
7. Open the site in a private window and on mobile widths: 5 category tiles, product grids,
   Softwares filters, contact form, `#apps` anchor and footer links.
8. Then install Pages CMS and make one small test edit; verify the Pages deployment and revert
   the test change (via the CMS or a normal revert commit).

## Rollback

There is no database and no live data migration.

- **Content change:** every CMS save is a commit. `git revert <commit>` restores it.
  `tools/backup-content.sh` keeps timestamped local copies in `backups/` (git-ignored).
- **Implementation rollback:** revert the implementation commit. This restores the old
  hard-coded “Apps hữu ích” markup and removes `softwares.json` / `.pages.yml`.
  The pre-migration state is commit `9f931d5` on `main`.
- **CMS access:** uninstall the GitHub App; the site keeps working as static files.

## Risks and limitations

- Pages CMS is a third-party hosted service with write access to this repo through a GitHub
  App. Scope the install to this repository and uninstall when not needed.
- Saves go straight to `main` and deploy immediately; no draft or approval step.
- Two editors saving the same file can conflict; keep edits small and coordinate.
- Images increase repository size; keep them compressed (JPG/PNG/WebP, ideally < 1–2 MB).
- Current 8 apps are all macOS; the iOS filter is empty until iOS entries are added.
- Apps and products are rendered client-side from JSON. Search engines that do not execute JS
  see less product/app content (products already worked this way before this change).
- Product/app text is escaped before insertion, and software URLs must be `http(s)`; CMS
  editors are still trusted users with repository write access.
- The existing Web3Forms access key in the contact form is a public form key, not an admin
  credential. No GitHub/admin secret is stored in the site.
