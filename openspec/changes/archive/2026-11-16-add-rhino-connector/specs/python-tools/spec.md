# Spec Delta

## Purpose

Gives the agent a general capability layer: Python with any library the user approves, working on files in the project, independent of whether Rhino is running. Rhino is the modelling and drafting host; analysis, geometry and data work happens here.

## ADDED Requirements

### Requirement: The agent can run Python in a managed environment
The agent SHALL have a tool that runs a Python 3 script in a virtual environment that HAI manages in the project's `.hai/python` folder, with the project folder as its working directory. The tool SHALL return the output (limited to 20 000 characters), the value of a variable named `result` if the script set one, the duration and, on failure, the error and the end of the traceback. The tool SHALL work with Rhino closed.

#### Scenario: A script runs and answers
- **GIVEN** the managed environment is ready
- **WHEN** the agent runs a script that prints the sum of a list and sets `result` to it
- **THEN** the tool returns the printed output and the result

#### Scenario: Works without Rhino
- **GIVEN** no Rhino is connected
- **WHEN** the agent runs a script
- **THEN** it runs and answers as usual

#### Scenario: An error is returned
- **WHEN** a script raises an exception
- **THEN** the tool answers with the error and the end of the traceback

### Requirement: The environment is created on first use, with the user's approval
HAI SHALL create the environment from a Python 3.10 or newer found on the machine, the first time the tool is used. Before it installs anything, an approval card SHALL list the packages (`rhino3dm`, `ladybug-core` and `numpy` to start). When no suitable Python is found, or an install fails, the tool SHALL answer with the reason and the HUD SHALL say how to fix it.

#### Scenario: First use
- **GIVEN** no environment exists and Python 3.12 is installed
- **WHEN** the agent runs its first script
- **THEN** a card lists `rhino3dm`, `ladybug-core` and `numpy`, and after the user allows it the environment exists and the script runs

#### Scenario: No Python on the machine
- **GIVEN** no Python 3.10 or newer can be found
- **WHEN** the agent runs a script
- **THEN** the tool answers that Python 3.10 or newer is needed, and the HUD says where to get it

### Requirement: Any library can be used, with the user's approval
A request MAY ask for further packages. The approval card SHALL list each of them and the script, and nothing SHALL be installed or run until the user allows it. Packages SHALL be installed only on the user's machine and SHALL NOT be bundled with HAI.

#### Scenario: A new library
- **WHEN** the agent asks to run a script that needs `shapely`
- **THEN** the card lists "shapely" and the script, and after the user allows it the package is installed in the environment and the script runs

#### Scenario: Denied
- **WHEN** the user denies the card
- **THEN** nothing is installed, the script does not run, and the agent is told it was denied

### Requirement: Runs can be stopped and are limited
A run SHALL end at its time limit (60 seconds unless the request sets another, never more than 600) and within 3 seconds of the user stopping the agent, ending its process.

#### Scenario: Stop
- **GIVEN** a script is running
- **WHEN** the user stops the agent
- **THEN** the script's process is gone within 3 seconds

### Requirement: Runs are kept as readable scripts
Every run, whether in the managed environment or in Rhino, SHALL be written to the project's `.hai/scripts` folder as a `.py` file named by time and title, with its packages, outcome, output and result in a header comment, so the human can read and edit it and the agent can find it later.

#### Scenario: A run is kept
- **WHEN** a script finishes
- **THEN** `.hai/scripts` holds a file with that script and a header with its packages, whether it succeeded, its output and its result

### Requirement: A written Rhino file can be brought in with one click
When a run leaves a new or changed `.3dm` file in the project folder, the HUD SHALL offer **Import into viewer**, and when Rhino is connected also **Open in Rhino**. Nothing SHALL be imported or opened until the user chooses it.

#### Scenario: Import a written file
- **GIVEN** a script wrote `study.3dm` with `rhino3dm` in the project folder
- **WHEN** the HUD offers it and the user chooses Import into viewer
- **THEN** its objects appear in the built-in viewer through the existing 3dm import

#### Scenario: Open in Rhino
- **GIVEN** Rhino is connected and a script wrote `study.3dm`
- **WHEN** the user chooses Open in Rhino
- **THEN** Rhino opens the file

#### Scenario: Files are written directly
- **WHEN** the agent runs a script that builds a box with `rhino3dm` and writes it to `box.3dm`, and another that opens `box.3dm`
- **THEN** the second script reads one object back

### Requirement: Python is for files, not the HAI scene
The workbench SHALL NOT change the built-in viewer's scene directly. Its results reach the scene only by an import the user chose.

#### Scenario: The scene is untouched
- **WHEN** a script writes a `.3dm` into the project folder
- **THEN** the built-in viewer's scene is unchanged until the user imports the file

### Requirement: Geometry written by Python can be seen
A `.3dm` written through the workbench's helper SHALL import into the viewer with every Brep, revolve and extrusion drawn, planar trimmed faces drawn with their outline, and no object skipped for lack of a mesh.

#### Scenario: A canopy and a revolved solid draw
- **GIVEN** a script that builds a freeform NURBS canopy and a revolved solid and saves through the helper
- **WHEN** the file is imported into the viewer
- **THEN** both objects are drawn, and the solid's end caps are discs

#### Scenario: A plain save is reported
- **GIVEN** a script that writes a Brep with `rhino3dm` directly, without the helper
- **WHEN** the file is imported
- **THEN** the import says how many objects had no mesh and why

### Requirement: The agent is told what the workbench cannot model
The `python_run` tool description SHALL state which operations the workbench has and which it lacks (loft, sweep, boolean, fillet, offset and meshing of a Brep), so the agent chooses another way instead of calling what does not exist.

#### Scenario: Description lists the limits
- **WHEN** the agent lists its tools
- **THEN** the `python_run` description names the operations it cannot do and says to prefer Rhino for them
