# Spec Delta

## Purpose

The installed HAI app: a window that runs the existing web app and bridge on the user's own computer, with no developer tools needed, while keeping the same privacy and local-access guarantees as the development setup.

## ADDED Requirements

### Requirement: The app runs the whole product from one launch
Starting the installed app SHALL start the bridge and open a window with the web app, with no other program, terminal or installation required. Closing the last window SHALL stop the bridge and every agent process it started.

#### Scenario: Launch from a clean machine
- **GIVEN** a machine with no Node, pnpm or git
- **WHEN** the user starts the app
- **THEN** a window opens, the bridge reports as connected within 10 seconds, and the viewer is shown

#### Scenario: Quitting stops everything
- **WHEN** the user closes the last window
- **THEN** the bridge process and any agent process exit, and the session file is removed

### Requirement: The web app is served from one fixed secure origin
The app SHALL serve the web app from a fixed origin that does not change between launches or versions, and that browsers treat as a secure context, so camera access works and the settings kept by the page stay with the user. The installed app's bridge SHALL accept connections from that origin only.

#### Scenario: Camera is available
- **WHEN** the page asks for the camera
- **THEN** the request is answered by the app itself and the camera starts

#### Scenario: Settings survive a restart
- **GIVEN** the user changed a gesture setting
- **WHEN** the app is closed and started again
- **THEN** the setting is still changed

#### Scenario: Other origins rejected by the bridge
- **WHEN** a page from any other origin opens a connection to the bridge with the right token
- **THEN** the connection is rejected

### Requirement: The page receives its bridge session without any network step
The app SHALL give the page the bridge port and the session token before the page's own code runs, without placing the token in an address, a file the page can fetch, or a log. A restarted bridge SHALL give the page its new session on reload.

#### Scenario: Page connects without a lookup
- **WHEN** the window loads
- **THEN** the page connects to the bridge using the session it was given, and no request for the token appears in the network log

#### Scenario: Token absent from logs
- **WHEN** the app has run a session
- **THEN** its log files contain no session token

### Requirement: The window cannot leave the app or reach the computer
The window SHALL show only the app's own pages. Navigation to any other address SHALL be refused and, for web addresses, opened in the user's own browser. Page code SHALL have no access to Node or to the file system beyond what the web app already has in a browser, and only the camera and microphone permissions SHALL be granted, and only to the app's own origin.

#### Scenario: External link
- **WHEN** a link to an address outside the app is activated
- **THEN** the window does not navigate and the address opens in the user's default browser

#### Scenario: Other permissions refused
- **WHEN** the page asks for a permission other than camera or microphone
- **THEN** it is refused

#### Scenario: Page has no Node
- **WHEN** page code checks for Node globals
- **THEN** none exist

### Requirement: Camera frames stay inside the app
The desktop app SHALL keep the existing privacy guarantee: camera frames never leave the perception worker, and the app SHALL NOT send them, or any usage data, to any server. The one request it makes of its own accord is the check for a newer version, which the user can turn off and which carries nothing beyond what any web request does.

#### Scenario: No outbound traffic during tracking
- **GIVEN** all first-run downloads are complete
- **WHEN** tracking runs for 60 seconds
- **THEN** the app makes no network request other than to the bridge on 127.0.0.1 and, if automatic update checks are on, to the update feed

#### Scenario: No traffic at all with update checks off
- **GIVEN** automatic update checks are turned off and all first-run downloads are complete
- **WHEN** the app runs
- **THEN** it makes no network request except one the user asks for (a check for updates, a download, an install)

### Requirement: Only one copy runs, and it keeps the user's data apart from the program
Starting the app while it is running SHALL focus the running window instead of starting a second bridge. Settings, the session file, the agent conversations and the default project SHALL live in the user's own folders, not in the program's install folder, so updating or reinstalling does not touch them.

#### Scenario: Second launch
- **WHEN** the user starts the app while it is already running
- **THEN** the existing window is brought to the front and no second bridge starts

#### Scenario: Data outside the install folder
- **WHEN** the app has created a project
- **THEN** the project and the `.hai` settings are under the user's folders and nothing is written under the install folder

#### Scenario: Reinstall keeps data
- **WHEN** a newer version is installed over the old one
- **THEN** the user's projects and settings are still there
