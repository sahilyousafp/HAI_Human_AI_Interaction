# LinkedIn post 02 - Weeks 2 and 3 together

## Post

My webcam now knows the difference between my left hand and my right. It took one bug to get there.

Weeks 2 and 3 of building hand-controlled AI design tools:

Week 2: tracking. 21 points on each hand and 478 on the face, at about 20 frames a second on my laptop's GPU, inside the browser. The video never leaves the tab: a test watches all network traffic and fails if a single image goes out.

Week 3: gestures. Open palm to get its attention, pinch to tap or drag, a fist as a clutch, two hands for zoom, nod for yes, shake for no. Nothing fires until you engage, so talking with your hands doesn't move the model.

What surprised me:
- The library's docs said it assumes a mirrored image. It doesn't, so my right hand came out as "left". I only caught it because I tested on recordings of my own hands instead of trusting the docs.
- The 3D hand coordinates are too noisy to see a pinch. The flat 2D image catches it cleanly (0.13 pinched vs 1.2 open).
- A tight pinch with all fingers folded is, to the tracker, the same shape as a fist. So that's a rule now: pinch like an OK sign.

The gesture logic takes under 0.1 ms per frame. Next week: flying around a building with these gestures.

If you've used gesture or VR interfaces for design: which gesture felt natural, and which never did?

Code is open: link in the first comment.

@Google for Developers @Robert McNeel & Associates

#AEC #ComputationalDesign #HCI #ComputerVision #OpenSource #BuildInPublic

## First comment

- Repo: https://github.com/sahilyousafp/HAI_Human_AI_Interaction
- Gesture vocabulary and thresholds: https://github.com/sahilyousafp/HAI_Human_AI_Interaction/blob/main/docs/gestures.md
- MediaPipe hand tracking: https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker

## Images or video (in this folder)

1. Your Week 3 screen recording (see demos/03-gestures.md); a video gets far more reach than stills
2. 05-tracking-and-gestures-dark.png - tracking overlay plus the Gestures card ("Engaged", hand states)
3. 07-raw-vs-smoothed.png - hollow dots are raw points, the skeleton is smoothed
4. 06-two-hands-overlay-light.png - both hands, left amber and right teal

## Before posting

- Replace "about 20 frames a second" with the frame rate your real webcam shows in the HUD.
- The repository is already public, so the links work as soon as the latest commit is pushed.

## Alternative hooks

- "I trusted the docs. My right hand became my left."
- "Two weeks in: my laptop camera can tell a pinch from a fist. Mostly."
