# Proposal

## Why

The team strip showed each agent as a text pill, which did not match the rest of the interface, hid who was doing what behind small words, and let the team's summary and Stop all be pushed off the edge of the rail while agents worked.

## What Changes

- **Faces.** Each specialist is a small face in its colour with the mark of its role (a hard hat, a sun, a cube, glasses, an orbit, a skyline, or an antenna for any other agent). The face is animated by what the agent is doing: resting, working, queued or waiting for the user. Motion stops for people who ask for less.
- **Name and detail.** The name sits under the face while the agent is busy or selected; its task and scope are in its tooltip and for a screen reader.
- **Reachable summary.** What the team is doing and Stop all sit on their own line under the faces.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-panel`: the team strip.

## Impact

- `apps/web`: `AgentFace`, the team chips and their styles.
