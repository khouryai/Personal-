# 🏷️ PriceTag Studio

Upload a photo, drop customizable **price-tag stickers** on top, then export the
result as PNG/JPG and (optionally) save the project to Supabase.

Built with **React + Vite + Fabric.js**. Mobile-first, no login required.

## Features

- 📷 Image upload → instant editor canvas (original-resolution export)
- 🏷️ Price-tag stickers: text-only, rounded rectangle, circle badge, tag shape
- 🎨 Per-sticker styling: price text, font size, bold, text/background color,
  rotation, scale, opacity, drop shadow
- 🖐️ Drag · resize · rotate · layer (forward/back) · duplicate · delete
- 🔲 Optional snap-to-grid
- ⚡ Quick templates: Amazon style · Clearance tag · Luxury label · Sale sticker
- 🔍 Zoom & pan (scroll / pinch / Alt-drag), ↶ undo
- 💾 Export PNG/JPG at original resolution + best-effort save to Supabase
- ⌨️ Shortcuts: `Ctrl/⌘+Z` undo · `Ctrl/⌘+D` duplicate · `Delete` remove

The whole canvas is **deterministic from `sticker_json`** — see the contract below.

## Project structure

```
.
├── index.html
├── vite.config.js              # base: './' so it works on GitHub Pages
├── .env.example                # VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
├── supabase/schema.sql         # projects table + storage buckets + RLS
├── .github/workflows/deploy.yml# GitHub Pages CI
└── src/
    ├── main.jsx
    ├── App.jsx                 # layout, toolbars, mobile sheet, shortcuts
    ├── index.css               # mobile-first styles + desktop 3-pane layout
    ├── hooks/useEditor.js      # Fabric canvas lifecycle, undo, zoom, export
    ├── lib/
    │   ├── supabase.js         # client (no-op if keys absent)
    │   ├── storage.js          # upload original/export to Storage
    │   ├── projects.js         # save/load project rows
    │   ├── stickers.js         # Fabric sticker factory + (de)serialization
    │   └── templates.js        # preset templates
    └── components/
        ├── PropertiesPanel.jsx
        └── TemplatePanel.jsx
```

## Setup

```bash
npm install
npm run dev               # http://localhost:5173 — works immediately
```

A live Supabase backend is **already wired in** (dedicated project
`pricetag-studio`, ref `uhyslmfvseliykfhhwyh`) via the committed public config
in [`src/lib/supabaseConfig.js`](src/lib/supabaseConfig.js) — uploads, exports
and project saves work out of the box, no `.env` needed.

### Pointing at your own Supabase project (optional)

1. In the Dashboard → **SQL Editor**, run [`supabase/schema.sql`](supabase/schema.sql)
   (creates the `projects` table, `images` + `exports` buckets, anon RLS policies).
2. Copy `.env.example` → `.env` and set your project URL + anon/publishable key.
   Env vars override the committed config:

   ```
   VITE_SUPABASE_URL=https://YOUR-REF.supabase.co
   VITE_SUPABASE_ANON_KEY=sb_publishable_...
   ```

## sticker_json contract

Each overlay is stored as:

```json
{
  "id": "uuid",
  "type": "price_tag",
  "text": "$19.99",
  "x": 120,
  "y": 300,
  "scale": 1.2,
  "rotation": 0,
  "fontSize": 32,
  "fontWeight": "bold",
  "textColor": "#000000",
  "bgColor": "#FFD700",
  "shape": "rounded_rect",
  "opacity": 1,
  "shadow": null
}
```

`shape` ∈ `text` · `rounded_rect` · `circle` · `tag`. A project stores the full
array in `projects.sticker_json`, so any saved project reloads exactly.

## Deploy (GitHub Pages)

1. Repo **Settings → Pages → Source: GitHub Actions** (one-time, manual).
2. Push to `main` (or this feature branch) — [`deploy.yml`](.github/workflows/deploy.yml)
   builds and publishes `dist/`. `base: './'` keeps asset paths correct on the
   `/<repo>/` subpath. The Supabase config is committed, so **no secrets are
   required**; optionally set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
   repo secrets to override it.

> Prefer Vercel? Import the repo, set the two env vars, framework **Vite** —
> the relative base path works there too.
