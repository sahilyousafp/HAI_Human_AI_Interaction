# Spec Delta

## Purpose

Shows the user exactly what their agent changed in each turn and lets them keep or revert the whole turn with one gesture, in the built-in viewer and in Rhino.

## ADDED Requirements

### Requirement: Changed turns start a review
When an agent turn ends having changed the model, the system SHALL start a review that highlights added elements in teal, modified elements in amber, and keeps deleted elements visible as red ghosts, with a summary card counting each.

#### Scenario: Review after adding columns
- **WHEN** an agent turn adds four columns and modifies one slab
- **THEN** the four columns are highlighted as added, the slab as modified, and the card reads "4 added, 1 changed, 0 deleted"

#### Scenario: No review for read-only turns
- **WHEN** an agent turn only reads the scene and answers in text
- **THEN** no review starts

### Requirement: Accept keeps the turn
A nod, the Accept button or Enter SHALL end the review, remove the highlights and keep all of the turn's changes.

#### Scenario: Nod accepts
- **GIVEN** a review is pending
- **WHEN** the user nods
- **THEN** highlights disappear and the changes remain

### Requirement: Reject reverts the whole turn
A shake, the Reject button or Escape SHALL revert every change of the turn in one step and end the review.

#### Scenario: Shake rejects
- **GIVEN** a review is pending for a turn that added four columns and modified one slab
- **WHEN** the user shakes their head
- **THEN** the four columns are gone and the slab is back to its previous state

### Requirement: New activity accepts the pending review
Starting a new agent request or making a direct edit while a review is pending SHALL accept that review and show a notice that it was accepted. The accepted turn SHALL remain undoable as one step.

#### Scenario: New request accepts
- **GIVEN** a review is pending
- **WHEN** the user sends a new request
- **THEN** the review is accepted, a notice says so, and the new turn starts

### Requirement: Review policy is configurable
The user SHALL be able to choose to review every turn (default), only turns that delete something, or no turns. The policy SHALL persist per project.

#### Scenario: Deletions only
- **GIVEN** the policy is "only turns that delete something"
- **WHEN** a turn adds elements without deleting any
- **THEN** no review starts and the changes are kept

### Requirement: Rhino turns are grouped and reviewable
When Rhino is the active host, all Rhino document changes made during an agent turn, whichever tool made them, SHALL be grouped so that reject, or a single undo in Rhino, reverts the whole turn. During review the changed Rhino objects SHALL be highlighted in the viewport.

#### Scenario: Reject in Rhino
- **GIVEN** Rhino is the active host and an agent turn created five surfaces through Rhino tools
- **WHEN** the user shakes their head during review
- **THEN** all five surfaces are removed from the Rhino document

#### Scenario: One undo in Rhino
- **GIVEN** an accepted agent turn created five surfaces in Rhino
- **WHEN** the user runs Undo once in Rhino
- **THEN** all five surfaces are removed
