## ADDED Requirements

### Requirement: A tool that needs a large installation asks before installing
A geometry tool that needs the OpenCascade kernel SHALL show an approval card, before anything is installed, that lists the packages that would be installed on the user's machine. Once the kernel is installed such a tool SHALL run without asking, like the app's other scene tools. A geometry tool that needs no kernel SHALL NOT ask.

#### Scenario: The first loft
- **WHEN** the agent calls `geometry_loft` and the kernel is not installed
- **THEN** a card names the packages to be installed and the tool waits for the user's answer

#### Scenario: Declined
- **WHEN** the user declines the card
- **THEN** nothing is installed or changed and the agent is told the user declined

#### Scenario: Later lofts
- **WHEN** the agent calls `geometry_loft` after the kernel has been installed
- **THEN** it runs without a card
