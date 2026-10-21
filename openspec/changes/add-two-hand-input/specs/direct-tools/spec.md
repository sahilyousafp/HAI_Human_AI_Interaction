## ADDED Requirements

### Requirement: Wall draws a wall between two points
With Wall active, a pinch-drag (or mouse drag) on the ground SHALL draw a wall centred on the line from where it started to where it is, with both ends snapped to 100 mm, 200 mm thick and 3000 mm high, on the ground level. While dragging, a see-through draft and the length SHALL show. Releasing SHALL add the wall as one undo step named after it ("Add Wall 3"). A drag shorter than 300 mm SHALL add nothing and say why.

#### Scenario: Drawing a wall
- **GIVEN** Wall is active
- **WHEN** the user pinches on the ground at (2000, 2000) mm and drags to (6210, 2000) mm
- **THEN** a draft follows the hand, and on release a 4200 mm wall from (2000, 2000) to (6200, 2000), 200 mm thick and 3000 mm high, is added as one undo step

#### Scenario: Too short
- **WHEN** the user drags 200 mm with Wall
- **THEN** nothing is added and the notice says a wall is at least 300 mm long

### Requirement: Slab fills a rectangle
With Slab active, a pinch-drag (or mouse drag) on the ground between two corners SHALL add a 200 mm thick slab filling that rectangle, on the ground level. The corners SHALL snap to 100 mm, and the outline SHALL be counter-clockwise. A see-through draft and its size SHALL show while dragging. Each side SHALL be at least 300 mm, or nothing is added. The slab SHALL be added as one undo step.

#### Scenario: Drawing a slab
- **GIVEN** Slab is active
- **WHEN** the user drags from (8000, 6000) mm to (2000, 1000) mm
- **THEN** a slab with the outline (2000, 1000), (8000, 1000), (8000, 6000), (2000, 6000) is added

### Requirement: Column places a column
With Column active, a tap (or click) on the ground SHALL place a 400 x 400 mm column, 3000 mm high, on the ground level. It SHALL be centred on the tap snapped to 100 mm, and added as one undo step.

#### Scenario: Placing a column
- **GIVEN** Column is active
- **WHEN** the user taps the ground at (3040, 7960) mm
- **THEN** a column at (3000, 8000) is added

### Requirement: Copy drags out a copy of an element
With Copy active, a pinch-drag (or mouse drag) that starts on an element SHALL show a see-through copy following the hand, offset by whole 100 mm steps. Releasing SHALL add the copy, named "<name> copy", as one undo step, leaving the original where it was. A drag that starts on empty space SHALL orbit the view instead.

#### Scenario: Copying a block
- **GIVEN** Copy is active
- **WHEN** the user drags Block B 13 m north
- **THEN** "Block B copy" is added 13000 mm north of Block B, and Block B has not moved
