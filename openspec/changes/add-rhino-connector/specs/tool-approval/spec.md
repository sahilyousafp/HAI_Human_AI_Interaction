# Spec Delta

## ADDED Requirements

### Requirement: Python approvals show the code and its packages
The approval card for a Python tool (in the managed environment or in Rhino) SHALL show the whole script, in full and scrollable, and every package the run would install. Always allow SHALL remember the tool and the packages the user has approved for the project, and a run that names a package outside that set SHALL ask again.

#### Scenario: The card shows the script and the packages
- **WHEN** the agent calls a Python tool with a script that needs two packages
- **THEN** the card shows the script in full and lists both packages

#### Scenario: Always allow does not cover a new package
- **GIVEN** the user chose always allow for the Python tool with `numpy` approved
- **WHEN** the agent runs a script that also needs `shapely`
- **THEN** an approval card appears listing "shapely", and a script that needs only `numpy` still runs without one
