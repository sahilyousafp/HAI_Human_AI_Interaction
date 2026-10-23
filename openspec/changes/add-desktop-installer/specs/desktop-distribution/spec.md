# Spec Delta

## Purpose

How HAI reaches a user: a single signed per-user installer downloaded from the project website, a published checksum, and updates that are verified before they are applied, so a non-technical person can install and keep HAI current without a security warning or a terminal.

## ADDED Requirements

### Requirement: One per-user installer, no administrator rights
The project SHALL publish one Windows installer that installs for the current user only, without an administrator prompt, creates a Start menu entry, and starts the app on request when it finishes.

#### Scenario: Install as a standard user
- **GIVEN** a Windows account that is not an administrator
- **WHEN** the user double clicks the installer
- **THEN** it completes without asking for administrator credentials and the app appears in the Start menu

#### Scenario: Install location
- **WHEN** the installer finishes
- **THEN** program files are under the user's local application folder and nothing is written under Program Files

### Requirement: The installer and the program are signed by the project
The installer, the uninstaller and the app executable SHALL carry a valid code signature from the project's publisher identity, with a trusted timestamp. A build without a valid signature SHALL NOT be published.

#### Scenario: Signature verifies
- **WHEN** the signature of a published installer is verified
- **THEN** it is valid and names the project's publisher

#### Scenario: Unsigned build blocked
- **WHEN** the release pipeline produces an installer whose signature is missing or invalid
- **THEN** the pipeline fails and nothing is uploaded

### Requirement: The download page publishes a checksum
The download page SHALL show the installer's version, size and SHA-256, and the SHA-256 SHALL match the published file.

#### Scenario: Checksum matches
- **WHEN** the file behind the download button is hashed
- **THEN** the result equals the SHA-256 shown on the page

### Requirement: Updates are verified before they apply
The app SHALL check for a newer version on start and at most once a day while open (unless the user turned that off), SHALL tell the user before downloading, and SHALL apply an update only when its hash matches the feed and, for a signed release, its signature is valid. It SHALL NOT restart while an agent turn is running.

#### Scenario: Update offered
- **GIVEN** the feed lists a newer signed version
- **WHEN** the app checks
- **THEN** it tells the user a new version is available and downloads only after they agree

#### Scenario: Tampered update refused
- **GIVEN** an update whose hash or signature does not match
- **WHEN** the app downloads it
- **THEN** it is discarded, the user is told the update failed, and the installed version keeps working

#### Scenario: Restart waits
- **GIVEN** an update is ready and an agent turn is running
- **WHEN** the user looks at the update
- **THEN** the restart is held and says the agent is working, and it is offered when the turn ends

#### Scenario: Nothing is installed behind the user's back
- **GIVEN** an update is available or ready
- **WHEN** the user closes the app without pressing Restart to update
- **THEN** the installed version is unchanged

### Requirement: The user controls update checks
Settings > Setup SHALL show the version that is running, SHALL offer Check for updates at any time, and SHALL have a switch for automatic checks, on by default, that is kept across restarts. A check the user asks for SHALL run whatever the switch says; a quiet check that cannot reach the feed SHALL NOT show an error.

#### Scenario: Check on request
- **GIVEN** automatic checks are off and the feed lists a newer version
- **WHEN** the user presses Check for updates
- **THEN** the new version is offered, and the next start still does not look by itself

#### Scenario: A pill in the top bar
- **GIVEN** a newer version is available or an update is ready
- **WHEN** the user looks at the top bar
- **THEN** a pill names it, and pressing it opens Settings on the Setup page

#### Scenario: Quiet when offline
- **GIVEN** the feed cannot be reached
- **WHEN** the check on start runs
- **THEN** no error is shown, and a check the user asks for says it could not look

#### Scenario: Running from the source
- **GIVEN** the app is running from the repository
- **WHEN** the user opens Settings > Setup
- **THEN** it says updating is not available in this copy and offers no update action

### Requirement: Uninstalling removes the program, not the user's work
Uninstalling SHALL remove the program, its shortcuts and its registry entries, and SHALL leave the user's projects and settings in place unless the user explicitly chooses to remove them.

#### Scenario: Default uninstall
- **WHEN** the user uninstalls with default choices
- **THEN** the program is gone and the projects folder and settings are still present

### Requirement: Every release is reproducible from a tag
A published installer SHALL be built by the release pipeline from a version tag in the repository, and its file name and the update feed SHALL carry that version.

#### Scenario: Release from tag
- **WHEN** a version tag is pushed
- **THEN** the pipeline builds, signs and verifies the installer and publishes the file, its checksum and the update feed for that version
