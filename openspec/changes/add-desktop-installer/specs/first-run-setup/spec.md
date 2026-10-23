# Spec Delta

## Purpose

Gets a first-time user from a fresh install to a working app without a terminal or a manual download: the large voice models are fetched and verified, and Claude Code is installed and signed in with the user's consent and under their own account.

## ADDED Requirements

### Requirement: Required runtimes and small models ship with the app
The installer SHALL include everything hand and face tracking and the viewer need, so the app can show the camera and track hands with no network connection. Only the large voice models SHALL be downloaded after install.

#### Scenario: Tracking works offline
- **GIVEN** the app was just installed and the computer has no network
- **WHEN** the user starts the camera
- **THEN** hand and face tracking run

### Requirement: Voice models download once, verified, with visible progress
On first run the app SHALL download each missing voice model from its pinned address, SHALL check each file's SHA-256 against the value pinned in the repository before using it, and SHALL show per-file progress and the total size before it starts. A file whose hash does not match SHALL be discarded and never loaded.

#### Scenario: Progress shown
- **WHEN** the voice models are missing
- **THEN** the first-run screen lists them with their total size and shows progress while they download

#### Scenario: Corrupt download rejected
- **GIVEN** a model download whose content does not match its pinned hash
- **WHEN** the download finishes
- **THEN** the file is deleted, the screen says which file failed, and the model is not used

#### Scenario: Already present files skipped
- **GIVEN** every model is present and verified
- **WHEN** the app starts
- **THEN** nothing is downloaded and the first-run screen does not appear for models

### Requirement: Interrupted downloads resume
A download that stops (connection lost, app closed) SHALL leave a partial file that the next attempt continues from, and SHALL NOT leave a partial file where a finished model is expected.

#### Scenario: Resume after interruption
- **GIVEN** a download stopped half way
- **WHEN** the app starts again
- **THEN** it requests only the rest of the file and the verified result is used

#### Scenario: Offline at first run
- **WHEN** the models are missing and the computer has no network
- **THEN** the screen says the voice models could not be downloaded, offers Retry and Continue without voice, and the rest of the app works

### Requirement: The app is usable before the voice models finish
The user SHALL be able to continue into the app while the voice models are still downloading. Voice input and spoken replies SHALL report that they are still preparing, with progress, until their models are ready, and then start without a restart.

#### Scenario: Continue while downloading
- **WHEN** the user chooses Continue during the download
- **THEN** the viewer and tracking are usable and the voice controls show that the voice is downloading

#### Scenario: Voice becomes ready
- **WHEN** the download completes while the app is open
- **THEN** voice input becomes available without restarting the app

### Requirement: Claude Code is guided, not assumed
The first-run screen SHALL run the existing installation and login checks and show the result in plain words: ready, not installed, installed but did not start, or not signed in. It SHALL offer the matching next step and SHALL re-check on request and whenever the window regains focus.

#### Scenario: Ready
- **WHEN** Claude Code is installed and signed in
- **THEN** the screen shows it as ready with its version and offers nothing to do

#### Scenario: Not installed
- **WHEN** no `claude` is found
- **THEN** the screen says Claude Code is not installed and offers to install it

#### Scenario: Not signed in
- **WHEN** Claude Code is installed and no account is signed in
- **THEN** the screen offers to open a terminal window running `claude` so the user can sign in, and shows ready after the user signs in and returns

### Requirement: Installing Claude Code needs the user's agreement and shows what runs
The app SHALL install Claude Code only after the user presses an install button that names the source and shows the exact command that will run. It SHALL run Anthropic's own installer for the user's account without administrator rights, SHALL show its output, and SHALL NOT bundle, copy or modify the `claude` executable.

#### Scenario: Command shown before running
- **WHEN** the user opens the install step
- **THEN** the exact command and its source address are shown and nothing runs until the user presses Install

#### Scenario: Install succeeds
- **WHEN** the installer finishes successfully
- **THEN** the screen re-checks and proceeds to the sign-in step without restarting the app

#### Scenario: Install fails
- **WHEN** the installer exits with an error or cannot be reached
- **THEN** the screen shows the error output and the address of the manual install instructions, and keeps the rest of the app usable

### Requirement: Sign-in stays between the user and Claude
The app SHALL NOT read, store, log or transmit Claude credentials or sign-in tokens during setup. Sign-in SHALL happen in Claude Code's own interface, in a terminal window the user can see, and the app SHALL learn the result only from `claude auth status`.

#### Scenario: Credential boundary holds
- **WHEN** the repository's credential-boundary check runs
- **THEN** it passes for the desktop app's source

### Requirement: Setup can be skipped and is reachable later
The user SHALL be able to leave the first-run screen without finishing, and SHALL be able to open the same setup again from the app's settings.

#### Scenario: Skip and return
- **WHEN** the user skips Claude Code setup and later opens setup from settings
- **THEN** the same screen appears with the current state of each step
