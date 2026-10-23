# Demo 13 - "From download to first command"

A bonus clip (the installer). Target length 45-60 s, 16:9, captions burned in. On a clean Windows 11 computer: click Download on the page, double click the file, watch the first screens install Claude Code and download the voice, then pinch-orbit a building and say a command to the agent. Show my hands is on. This is also the clean-machine check of the installer (task 6.4): every box in the checklist at the end is filled in on the recording machine.

## Setup (before recording)

The recording computer is a clean Windows 11 virtual machine or spare laptop, **not your own computer**: the reset script below removes HAI and Claude Code from it.

1. Windows 11, a standard user, no Node, git or Claude Code. **Smart App Control on** (Windows Security > App & browser control > Smart App Control), so the clip shows what a person with a normal PC sees. A webcam (a virtual machine needs a passed-through camera).
2. A Claude account to sign in with, and a good network connection (the voice models are about 393 MB).
3. The release you are showing is published and the download page is up (see "The download page" in [docs/desktop.md](../docs/desktop.md)). Open the page in Edge, light theme, and keep the Downloads folder empty.
4. Front light on both hands; Windows Studio Effects off.
5. To take it again, run the reset script (see below) and empty the Downloads folder.
6. Recorder at 1080p, 30 fps, capturing the whole screen (the installer and the sign-in windows are not part of the browser).

## Reset between takes

`demos/13-desktop-installer.ps1` puts the computer back to "never installed HAI":

```powershell
powershell -ExecutionPolicy Bypass -File demos\13-desktop-installer.ps1            # shows what it would do, changes nothing
powershell -ExecutionPolicy Bypass -File demos\13-desktop-installer.ps1 -Run -ThisIsADemoMachine
```

It uninstalls HAI, deletes HAI's data folder, signs Claude Code out with Claude Code's own `claude auth logout` and removes the `claude.exe` the installer put in `%USERPROFILE%\.local\bin`. It does nothing without `-Run` and `-ThisIsADemoMachine` together. Run twice, it leaves the computer in the same state (the second run finds nothing to remove).

## Shot list

| # | Time | Do | Voice-over / caption |
|---|---|---|---|
| 1 | 0-6 s | The download page: the headline and the button. Click **Download HAI for Windows**. | "One download." |
| 2 | 6-14 s | Open the file from the browser's downloads. Windows may show its warning (say so if it does; with a signed release it names the publisher). The installer finishes and HAI opens. | "Double click. No administrator, no terminal." |
| 3 | 14-24 s | First screen: **Install Claude Code**. Point at the command shown, press **Install Claude Code**; the installer's lines scroll. | "HAI shows exactly what it will run, and asks first." |
| 4 | 24-32 s | **Sign in to Claude**: press **Open the sign-in window**, sign in in the browser. The screen moves on by itself to "Claude Code is ready". | "You sign in in Claude's own window. HAI never sees your login." |
| 5 | 32-38 s | Step 2: **Download the voice models**. Press **Download**, then **Continue**: the app opens while the pill in the top bar counts up. | "Voice downloads once, in the background." |
| 6 | 38-52 s | Pinch-orbit the sample building with the right hand. Hold the talk key and say "Mochi, add three floors"; the agent builds them. | "Hands in, voice in, your own Claude." |

## Check after recording (fill in, task 6.4)

- Clean machine: Windows 11, Smart App Control on, no Node, git or Claude Code: ______
- The download was signed by (or the warning shown said): ______ ; Windows blocked it outright: yes / no
- Time from clicking Download to the first screen of HAI: ______ s
- Claude Code installed from the first screen without a terminal: yes / no ; signed in from the first screen: yes / no
- Voice models downloaded in ______ s on ______ Mbit/s; the app was usable meanwhile: yes / no
- A hand was tracked and an agent request was answered: yes / no
- Updating: the **Check for updates** button in Settings > Setup answered: yes / no
- Uninstalled from Settings > Apps: the projects folder and settings were kept: yes / no
- No private names, paths or account details in frame (the Claude sign-in page shows an email: crop or blur it)
- The reset script, run twice, left the machine as it was: yes / no
