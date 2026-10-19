# Test clips

Short webcam recordings that Chromium's fake camera plays during end-to-end tests, so hand and face tracking is tested in CI without a person in front of a camera.

License: CC BY 4.0, recorded by the AEX maintainer for this project.

## Recording (about 10 minutes)

Use the Windows Camera app (or OBS). Recordings must not be mirrored (the Windows Camera app saves unmirrored video) at 640x480 or 1280x720, 30 fps, in normal room light. Sit as you would at your desk, about 50-70 cm from the laptop. Each clip is 5-8 seconds. Name each file after the clip:

| File | What to do |
|---|---|
| `no-hands` | Face the camera, hands out of view (in your lap). Small natural head movement. |
| `one-hand-pinch` | Raise your right hand, palm toward the camera. Pinch thumb and index finger together and apart three times, slowly. |
| `two-hands` | Raise both hands, palms toward the camera, fingers spread, and hold them still in front of your chest for the whole clip. |
| `head-turn` | Hands down. Look straight ahead, turn your head to your right, then to your left, then look up, then back to the front. |
| `open-palm` | Raise both hands (or just your right hand), open palms facing the camera, and hold them still for the whole clip. |

## Importing

```sh
node scripts/convert-clips.mjs import <folder-with-your-recordings>
```

This writes `<clip>.mp4` files here (640x480, 30 fps, trimmed to 8 s, H.264, no audio), typically a few hundred KB each, committed normally.

Chromium's fake camera needs uncompressed `.y4m` (about 14 MB per second), so those are generated on demand into `.aex/clips/` (git-ignored) when Playwright starts, and cached. Playwright adds one test project per clip that has both a recording here and a spec in `e2e/clips/`, so a missing recording never shows up as a skipped test.
