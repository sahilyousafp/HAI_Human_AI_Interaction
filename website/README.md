# hai.spairl.si

The public build log for HAI: one stage per week, each with its recording and the LinkedIn post that went out with it. It is a static [Astro](https://astro.build) site in the visual language of [spairl.si](https://spairl.si), hosted on Catalyst Slate (project **HAI**, app **hai**).

It is a standalone npm project, separate from the pnpm workspace.

## Add a stage

1. **Recording** (skip for a stage without one). This command writes `public/media/<slug>.mp4` and a poster frame (`.jpg`, also used as the page's social image, and `.webp`), then prints the duration:

   ```sh
   npm run encode -- "C:/path/to/recording.mp4" week-04-tools 12
   ```

   The last argument is the second to take the poster from. Pick a frame that shows the feature.

2. **Card preview**: the short loop that plays on the stage's card. Use about 8 seconds of the key moment:

   ```sh
   node scripts/make-preview.mjs week-04-tools public/media/week-04-tools.mp4 37 8
   ```

   A stage without a recording can loop through stills instead: `node scripts/make-preview.mjs <slug> a.png b.png c.png`. Such a stage also needs a 1200x630 `public/media/<slug>.jpg` for its social image.

3. **Content**: add `src/content/stages/<slug>.md` with the same slug, copying an existing stage. In it:
   - `order` sets the position.
   - `video.duration` is the printed value. A stage without a recording lists `images` instead.
   - `linkedin.url` and `linkedin.urn` come from the published post: the URN is the number in the post URL, written as `urn:li:ugcPost:<id>` or `urn:li:share:<id>`.

   The schema in `src/content.config.ts` rejects anything missing.

4. Check and deploy (below).

`public/media/` is gitignored to keep large binaries out of the repository, so the clips live on the machine that deploys. These are the commands that built the current set:

| Slug | Source | Poster | Preview |
|---|---|---|---|
| `week-01-research` | `docs/linkedin/0{1,2,3}-*-light.png` | first still | the three stills |
| `week-02-tracking` | `brave_VFgF7mx8EO.mp4` | 40 s | 37 s, 8 s long |
| `week-03-orbit` | `brave_4m5KBDEUKl.mp4` | 20 s | 104 s, 8 s long |

## Run it locally

```sh
npm install
catalyst serve --only slate
```

Open the `hai:` URL that the CLI prints, not Astro's own port. `npm run check` type-checks and `npm run build` builds into `dist/`.

## Deploy

```sh
catalyst deploy slate hai -m "what changed" -ni               # Development
catalyst deploy slate hai -m "what changed" --production -ni  # Production, after checking Development
```

Slate installs and builds the app itself (see `.catalyst/slate-config.toml`, managed by the CLI). The custom domain `hai.spairl.si` is mapped in the Catalyst console under Slate > hai > Domains, with a CNAME at the DNS provider for spairl.si.

## How the moving parts work

- **Hero hand** (`scripts/hero-hand.ts`, `lib/rig.ts`): a 3D rig of the 21 hand landmarks, projected onto an SVG drawn like HAI's tracking overlay. It waves "Hi" on load, turns towards the pointer and pinches while the mouse is held. Clicking it, or 7 quiet seconds, plays a random gesture.
- **Point cloud** (`scripts/pointcloud.ts`): spairl.si's contour landscape, drawn as a point cloud. The pointer lifts it and a click sends a ripple across it.
- **Cursor** (`scripts/cursor.ts`): a solid hand whose index fingertip is the hotspot. It only appears with a mouse and without reduced motion.
- **"HAI" in the header** (`scripts/brand.ts`): unfolds into "Human AI Interaction" when the logo flips and on hover.
- **Light and dark** (`scripts/theme.ts`): follows the system setting until the header switch is used, then remembers the choice.

Everything that moves stays still with `prefers-reduced-motion`.

## Privacy

The page makes no third-party requests when it loads. The LinkedIn embed loads only after a visitor clicks "Show it here". If a content blocker stops it, the card stays with a link to the post.
