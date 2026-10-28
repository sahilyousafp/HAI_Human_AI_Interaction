## ADDED Requirements

### Requirement: The agent can copy an element along a curve
The agent SHALL have a `geometry_array_along_curve` tool that copies an element along a curve given as a line element or as points, either a copy every `spacing` millimetres or `count` copies spread evenly, between a start and an end measured along the curve. Each copy SHALL be centred on its place on the curve (its height following the curve's rise) and, unless told otherwise, turned to run the way the curve does there. The width of a massing or column across the curve, and the scale of any element, MAY change in a straight line from a value at the first copy to a value at the last. The change SHALL be validated as a whole, be one undo step and leave the original where it is. The tool SHALL NOT need the geometry kernel.

#### Scenario: A tapering array
- **WHEN** the agent copies a massing along a 3 m line with spacing 300 mm and a width from 150 mm to 50 mm
- **THEN** eleven copies exist, centred 300 mm apart, whose widths fall in equal steps from 150 mm to 50 mm, and the original is unchanged

#### Scenario: Copies follow a corner
- **WHEN** the curve turns 90 degrees and the array is aligned
- **THEN** the copies after the corner are turned 90 degrees more than those before it

#### Scenario: Too many copies
- **WHEN** the spacing would make more than 500 copies
- **THEN** nothing is made and the answer says how many it would have been and the most allowed

### Requirement: The agent can loft, sweep, combine and offset with a geometry kernel
The agent SHALL have `geometry_loft`, `geometry_sweep`, `geometry_boolean` and `geometry_offset`, backed by the OpenCascade kernel in the project's Python environment. A loft through two or more sections and a sweep of a profile along a rail SHALL make a solid when the section or profile is closed and a surface when it is open. A boolean SHALL take lists of massings, columns, walls and slabs as the extrusions of their footprints and make their union, difference or intersection; an imported model or a line SHALL be refused by name. An offset SHALL make the flat curve's offset as line elements, a closed curve growing for a positive distance and an open one moving to the right of the way it runs. A loft, sweep or boolean SHALL be created as an imported model whose mesh is stored as a project asset; the result and the deletion of any inputs the caller asked to delete SHALL be one undo step. If the scene refuses the change, the stored mesh SHALL be removed.

#### Scenario: A boolean replaces its solids
- **WHEN** the agent unites two massings with `geometry_boolean`
- **THEN** one imported model exists in their place, in one undo step, and undo brings the two massings back

#### Scenario: The kernel is not available
- **WHEN** the operating system refuses to load the kernel's native library
- **THEN** nothing is changed and the answer says the kernel cannot run on this machine and not to work round it

#### Scenario: A section that is not a line
- **WHEN** a section given by id is a massing
- **THEN** nothing is made, the kernel is not run, and the answer names the element and its type
