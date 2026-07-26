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
- 📲 **Save sheet** — on iPad/iPhone, save straight into **Photos** (share sheet
  → "Save Image") or into **Files**; plain download + open-in-tab as fallbacks
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
    │   ├── download.js         # share-sheet / blob download / open-in-tab helpers
    │   ├── supabase.js         # client (no-op if keys absent)
    │   ├── storage.js          # upload original/export to Storage
    │   ├── projects.js         # save/load project rows
    │   ├── stickers.js         # Fabric sticker factory + (de)serialization
    │   └── templates.js        # preset templates
    └── components/
        ├── PropertiesPanel.jsx
        ├── SaveSheet.jsx       # "Save your photo" chooser (Photos / Files / tab)
        └── TemplatePanel.jsx
```

## Saving the finished photo

Tapping **Save / Download** renders the image at full resolution and opens a
chooser with three routes, best first:

| Route | What it does | Where it lands |
| --- | --- | --- |
| **Save to Photos or Files** | `navigator.share({ files })` → the native share sheet | Photos/albums via "Save Image", or Files via "Save to Files" |
| **Download the file** | `<a download>` on a `blob:` URL | Files › Downloads (browser download folder on desktop) |
| **Open the image in a new tab** | `window.open` on a `blob:` URL | Press and hold → "Add to Photos" (right-click → "Save image as…" on desktop) |

The share option is only offered when `navigator.canShare({ files })` says yes
(Safari on iPadOS/iOS 15+, Android Chrome). Two iOS constraints shape this code:

- The export is decoded to a `Blob` **synchronously** (`dataUrlToBlob`) — any
  `await` between the tap and `navigator.share()` makes Safari drop the
  transient user activation and throw `NotAllowedError`.
- The file is prepared when the sheet *opens*, so each button press shares or
  downloads something that already exists in memory.

The Supabase backup runs *after* the file reaches the device, so a cloud
failure never blocks saving.

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

## Saved photos

The gallery grid renders `thumb_url` — a ~480px JPEG written on every save.
It used to render `final_image_url`, a full-resolution PNG that routinely
weighs 20-38 MB, once per card; that alone is why opening "Saved photos" and
reopening a project felt broken.

Reopening a project (`openProject`) is built around three rules:

- **Fetch, then swap.** The new photo is downloaded and decoded *before* the
  canvas is touched. The previous version cleared the canvas first and then
  awaited the network, so a slow or failed load stranded the old photo with
  its overlays already deleted.
- **Newest load wins.** Every load takes a token; a load whose token is stale
  when it finishes discards its result instead of painting over whatever the
  user did in the meantime.
- **The caller learns the outcome.** `openProject` resolves to
  `{ ok, reason }` once the photo is genuinely on screen, so the gallery can
  hold its spinner, close only on success, and show the failure otherwise.

Saves are also much lighter: the editable backdrop only gets its own file
once a **crop** has actually changed it (otherwise `scene_json.bg` just points
at the stored original), and re-saving a project deletes the render it
replaced instead of leaving it in the bucket forever.

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
  "textAngle": 0,
  "opacity": 1,
  "shadow": null,
  "boxW": 180,
  "boxH": 64
}
```

`shape` ∈ `text` · `rounded_rect` · `rect` · `pill` · `circle` · `tag` ·
`diamond` · `banner` · `starburst`. `textAngle` rotates only the price text;
`boxW`/`boxH` pin the shape size so editing the text doesn't resize it (use
"Fit shape to text" to re-fit). A project stores the full array in
`projects.sticker_json`.

## Deploy (GitHub Pages)

1. Repo **Settings → Pages → Source: GitHub Actions** (one-time, manual).
2. Push to `main` (or this feature branch) — [`deploy.yml`](.github/workflows/deploy.yml)
   builds and publishes `dist/`. `base: './'` keeps asset paths correct on the
   `/<repo>/` subpath. The Supabase config is committed, so **no secrets are
   required**; optionally set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
   repo secrets to override it.

> Prefer Vercel? Import the repo, set the two env vars, framework **Vite** —
> the relative base path works there too.
