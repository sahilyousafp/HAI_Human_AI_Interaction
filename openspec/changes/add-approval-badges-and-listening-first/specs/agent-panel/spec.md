## ADDED Requirements

### Requirement: The collapsed rail shows what the user chose, by priority
When the rail is collapsed it SHALL show the items chosen in Settings > Chat rail (waiting for you, state, team, name, last line of the reply, microphone) in the order of their priority, from a preset (Quiet, Needs you first, Team) or the user's own list. When the strip is too short the items lower in the list SHALL drop first, an item with a smaller form SHALL use it before it drops, and the microphone, if chosen, SHALL stay. A request waiting for the user, when listed first, SHALL take the strip over in the alert colour while it waits.

#### Scenario: Needs you first
- **WHEN** the rail is collapsed with Needs you first and a request waits
- **THEN** the strip is in the alert colour with a large count, and the state is not shown

### Requirement: A long reply is cut
A finished reply longer than about 320 characters SHALL show its first whole sentences and a Show more button that shows the rest.

#### Scenario: Show more
- **WHEN** a finished reply is long and the user presses Show more
- **THEN** the whole reply is shown
