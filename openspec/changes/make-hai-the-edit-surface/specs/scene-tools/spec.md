# Spec Delta

## REMOVED Requirements

### Requirement: Agent can create, update and delete elements
**Reason**: Agents model in the host applications, by code the user approves (`host_run`), not in HAI's scene.
**Migration**: The agent uses `host_run`, or `python_run` to write a `.3dm` the user can import.

### Requirement: One agent turn is one undoable transaction
**Reason**: Agents no longer change HAI's scene, so they make no scene transactions; each run in a host is one undo step there.
**Migration**: See `host-code`, "A run is one undo step in the host".

## ADDED Requirements

### Requirement: No agent writes HAI's scene
No agent SHALL have a tool that creates, changes, groups, tags or deletes elements of HAI's scene, or that builds geometry in it. Agents SHALL still read the scene's sketches, markers and references.

#### Scenario: No scene write tools
- **WHEN** the tools of every default agent are listed
- **THEN** none of `create_elements`, `update_elements`, `transform_elements`, `delete_elements`, `group_elements`, `ungroup_elements`, `set_tags`, `context_adopt` or a `geometry_` tool is among them

#### Scenario: The scene can still be read
- **WHEN** Architect's tools are listed
- **THEN** `get_scene_summary`, `get_elements` and `get_user_context` are among them
