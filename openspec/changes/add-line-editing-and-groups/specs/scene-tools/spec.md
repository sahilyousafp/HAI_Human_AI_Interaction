## ADDED Requirements

### Requirement: Agents keep groups together
`group_elements` and `ungroup_elements` SHALL make and take apart groups. `transform_elements` on any member SHALL take the whole group, turning about its middle, and each copy of a group SHALL be a new group. `update_elements` SHALL refuse a patch to where a member is (`origin`, `position`, `translation`, `rotationDeg`), naming `transform_elements`, and SHALL allow reshaping it. `set_selection` SHALL take the rest of the group. `set_tags` SHALL NOT set `hai.group`.

#### Scenario: An agent turns one member
- **GIVEN** a group of two elements
- **WHEN** an agent calls `transform_elements` with a half turn and the id of one
- **THEN** both turn about their middle, and they keep their distance apart

#### Scenario: An agent patches a member's rotation
- **GIVEN** a group
- **WHEN** an agent calls `update_elements` with `rotationDeg` on one member
- **THEN** nothing changes, and the error names `transform_elements`
