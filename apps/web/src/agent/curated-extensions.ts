/**
 * An extension HAI knows how to describe but never installs by itself: what it is, under what licence, what it needs
 * and how it is run. The user installs it (the app only fills in the form); HAI then talks to it over MCP like any other
 * extension.
 */
export interface CuratedExtension {
  /** The server's name in the project; agents list its tools as `mcp__<name>__*`. */
  name: string;
  title: string;
  /** What it does, in a sentence. */
  summary: string;
  licence: string;
  /** What the licence means for how it is used here. */
  licenceNote: string;
  /** The command the user runs in a terminal to install it and print its settings. */
  installCommand: string;
  /** The arguments of the server's own command (its command is the installed Python the installer prints). */
  args: string[];
  /** The environment variables the installer's settings name. */
  envKeys: string[];
  requirements: string[];
  warnings: string[];
}

/** The Ladybug Tools MCP server (community project, GPL-3.0). */
export const LADYBUG: CuratedExtension = {
  name: "ladybug",
  title: "Ladybug Tools MCP",
  summary:
    "Lets the Simulation agent build and run Ladybug Tools models (sun, daylight, energy, Radiance) in natural language.",
  licence: "GPL-3.0-only",
  licenceNote:
    "It is GPL-3.0 software and stays a separate program that you install on your machine. HAI does not include, download, run or link it: it only talks to it over MCP once you have added it.",
  installCommand: "uvx --isolated --python 3.12 --prerelease allow lbt-mcp@1.2.3 install --generate-config",
  args: ["-I", "-m", "ladybug_tools_mcp.server"],
  envKeys: ["LADYBUG_TOOLS_GARDENS_ROOT", "LADYBUG_TOOLS_MCP_INSTALLATION"],
  requirements: [
    "uv, which provides Python 3.12 (the installer downloads it)",
    "A large first download: scientific libraries, and the simulation engines it uses for some workflows (Radiance, OpenStudio, EnergyPlus)",
    "Windows x86_64 is its main platform",
  ],
  warnings: [
    "It is a community project and says it is experimental.",
    "Each of its tool calls asks for your approval, like any extension's.",
  ],
};
