import { describe, expect, it } from "vitest";
import { type Clause, parseCommand, wordsOf } from "./grammar.ts";

const clauses = (text: string): Clause[] | null => parseCommand(text)?.clauses ?? null;

describe("reading a transcript", () => {
  it("separates numbers from units, drops punctuation and takes commas as and", () => {
    expect(wordsOf("Move 3m, then rotate 90°.")).toEqual([
      "move",
      "3",
      "m",
      "and",
      "then",
      "rotate",
      "90",
      "degrees",
    ]);
    expect(wordsOf("x-axis")).toEqual(["x", "axis"]);
  });
});

describe("move", () => {
  it("takes a distance and a direction in either order", () => {
    expect(clauses("move 3 m along x")).toEqual([{ kind: "translate", by: [3000, 0, 0] }]);
    expect(clauses("move up 2000")).toEqual([{ kind: "translate", by: [0, 0, 2000] }]);
    expect(clauses("Move it 30 centimetres west")).toEqual([{ kind: "translate", by: [-300, 0, 0] }]);
    expect(clauses("move 3m north")).toEqual([{ kind: "translate", by: [0, 3000, 0] }]);
  });

  it("understands numbers in words, decimals and a minus", () => {
    expect(clauses("move three metres east")).toEqual([{ kind: "translate", by: [3000, 0, 0] }]);
    expect(clauses("move twenty five centimetres up")).toEqual([{ kind: "translate", by: [0, 0, 250] }]);
    expect(clauses("move two point five metres y")).toEqual([{ kind: "translate", by: [0, 2500, 0] }]);
    expect(clauses("move a hundred x")).toEqual([{ kind: "translate", by: [100, 0, 0] }]);
    expect(clauses("move minus 2 m x")).toEqual([{ kind: "translate", by: [-2000, 0, 0] }]);
  });

  it("adds a second distance after and", () => {
    expect(clauses("move 2 m up and 3 m east")).toEqual([{ kind: "translate", by: [3000, 0, 2000] }]);
  });

  it("is left to the agent when a part is missing", () => {
    expect(parseCommand("move 3 metres")).toBeNull();
    expect(parseCommand("move east")).toBeNull();
    expect(parseCommand("move the wall to the corner")).toBeNull();
  });
});

describe("copy", () => {
  it("is one copy, or an array with a count", () => {
    expect(clauses("copy 6 m y")).toEqual([{ kind: "copy", count: 1, by: [0, 6000, 0] }]);
    expect(clauses("copy 4 times 6 m along y")).toEqual([{ kind: "copy", count: 4, by: [0, 6000, 0] }]);
    expect(clauses("copy twice 3 metres east")).toEqual([{ kind: "copy", count: 2, by: [3000, 0, 0] }]);
    expect(clauses("duplicate this")).toEqual([{ kind: "copy", count: 1, by: null }]);
  });

  it("refuses a count that is not a whole number or is too big", () => {
    expect(parseCommand("copy 2.5 times 3 m x")).toBeNull();
    expect(parseCommand("copy 500 times 3 m x")).toBeNull();
  });
});

describe("rotate, scale and mirror", () => {
  it("rotates by degrees, counter-clockwise unless it says clockwise", () => {
    expect(clauses("rotate 90")).toEqual([{ kind: "rotate", deg: 90 }]);
    expect(clauses("rotate 45 degrees clockwise")).toEqual([{ kind: "rotate", deg: -45 }]);
    expect(clauses("rotate thirty anticlockwise")).toEqual([{ kind: "rotate", deg: 30 }]);
    expect(clauses("rotate minus 30")).toEqual([{ kind: "rotate", deg: -30 }]);
    expect(parseCommand("rotate")).toBeNull();
    expect(parseCommand("rotate 0")).toBeNull();
  });

  it("scales by a factor, a percentage, half or double", () => {
    expect(clauses("scale 2")).toEqual([{ kind: "scale", factor: 2 }]);
    expect(clauses("scale by 0.5")).toEqual([{ kind: "scale", factor: 0.5 }]);
    expect(clauses("scale 50 percent")).toEqual([{ kind: "scale", factor: 0.5 }]);
    expect(clauses("scale half")).toEqual([{ kind: "scale", factor: 0.5 }]);
    expect(clauses("scale double")).toEqual([{ kind: "scale", factor: 2 }]);
    expect(parseCommand("scale 0")).toBeNull();
    expect(parseCommand("scale 1")).toBeNull();
  });

  it("mirrors across x or y, and nothing else", () => {
    expect(clauses("mirror x")).toEqual([{ kind: "mirror", axis: "x" }]);
    expect(clauses("flip north")).toEqual([{ kind: "mirror", axis: "y" }]);
    expect(parseCommand("mirror z")).toBeNull();
    expect(parseCommand("mirror")).toBeNull();
  });
});

describe("chains", () => {
  it("run in the order said", () => {
    expect(clauses("copy and rotate 90")).toEqual([
      { kind: "copy", count: 1, by: null },
      { kind: "rotate", deg: 90 },
    ]);
    expect(clauses("copy 3 m x then scale 0.5")).toEqual([
      { kind: "copy", count: 1, by: [3000, 0, 0] },
      { kind: "scale", factor: 0.5 },
    ]);
    expect(clauses("please move 1 m up, rotate 10 and mirror y")).toEqual([
      { kind: "translate", by: [0, 0, 1000] },
      { kind: "rotate", deg: 10 },
      { kind: "mirror", axis: "y" },
    ]);
  });

  it("take a comma and then, or and then, as one break", () => {
    expect(clauses("copy, then rotate 90")).toEqual([
      { kind: "copy", count: 1, by: null },
      { kind: "rotate", deg: 90 },
    ]);
    expect(clauses("copy and then rotate 90")).toEqual(clauses("copy and rotate 90"));
  });

  it("are all or nothing: one clause the grammar does not know hands the whole transcript to the agent", () => {
    expect(parseCommand("copy and paint it red")).toBeNull();
    expect(parseCommand("rotate 90 and make it taller")).toBeNull();
    expect(parseCommand("copy and copy 3 m x")).toBeNull();
  });
});

describe("select, delete, hide and isolate", () => {
  it("selects everything, nothing, a type or a level", () => {
    expect(clauses("select all")).toEqual([{ kind: "select", selector: { kind: "all" } }]);
    expect(clauses("select all walls")).toEqual([
      { kind: "select", selector: { kind: "type", type: "wall" } },
    ]);
    expect(clauses("select columns")).toEqual([
      { kind: "select", selector: { kind: "type", type: "column" } },
    ]);
    expect(clauses("select none")).toEqual([{ kind: "select", selector: { kind: "none" } }]);
    expect(clauses("clear the selection")).toEqual([{ kind: "select", selector: { kind: "none" } }]);
    expect(clauses("select level two")).toEqual([
      { kind: "select", selector: { kind: "level", name: "level 2" } },
    ]);
    expect(parseCommand("select the red wall")).toBeNull();
  });

  it("can select and then act", () => {
    expect(clauses("select all walls and move 2 m up")).toEqual([
      { kind: "select", selector: { kind: "type", type: "wall" } },
      { kind: "translate", by: [0, 0, 2000] },
    ]);
    expect(clauses("select all slabs then hide")).toEqual([
      { kind: "select", selector: { kind: "type", type: "slab" } },
      { kind: "hide", selector: null },
    ]);
  });

  it("deletes, hides and isolates what is meant, but a whole type only when asked with all", () => {
    expect(clauses("delete this")).toEqual([{ kind: "delete", selector: null }]);
    expect(clauses("hide selection")).toEqual([{ kind: "hide", selector: null }]);
    expect(clauses("isolate")).toEqual([{ kind: "isolate", selector: null }]);
    expect(clauses("delete all columns")).toEqual([
      { kind: "delete", selector: { kind: "type", type: "column" } },
    ]);
    expect(parseCommand("remove the wall")).toBeNull();
    expect(clauses("show all")).toEqual([{ kind: "showAll" }]);
    expect(clauses("unhide")).toEqual([{ kind: "showAll" }]);
  });

  it("does not mix a change of place with an action, or name a selection twice", () => {
    expect(parseCommand("move 3 m x and delete")).toBeNull();
    expect(parseCommand("select all walls and delete all columns")).toBeNull();
    expect(parseCommand("hide and rotate 90")).toBeNull();
  });
});

describe("requests for the agent", () => {
  it.each([
    "make the building taller",
    "what is the area of this slab",
    "move the sofa next to the window",
    "turn on the lights",
    "show me the north elevation",
    "",
    "   ",
  ])("%j is not a command", (text) => {
    expect(parseCommand(text)).toBeNull();
  });
});

describe("markers", () => {
  it("rotates, scales and mirrors about a marker", () => {
    expect(clauses("rotate 45 about marker B")).toEqual([{ kind: "rotate", deg: 45, about: "B" }]);
    expect(clauses("scale half about marker a")).toEqual([{ kind: "scale", factor: 0.5, about: "A" }]);
    expect(clauses("mirror x at marker c")).toEqual([{ kind: "mirror", axis: "x", about: "C" }]);
  });

  it("moves to a marker", () => {
    expect(clauses("move to marker A")).toEqual([{ kind: "moveTo", marker: "A" }]);
    // The copy is the one that goes: "copy and move to marker b".
    expect(clauses("copy and move to marker b")).toEqual([
      { kind: "copy", count: 1, by: null },
      { kind: "moveTo", marker: "B" },
    ]);
  });

  it("chains with the other clauses", () => {
    expect(clauses("copy and rotate 90 about marker B")).toEqual([
      { kind: "copy", count: 1, by: null },
      { kind: "rotate", deg: 90, about: "B" },
    ]);
  });

  it("is the agent's when the marker is not one letter or the verb takes none", () => {
    expect(clauses("rotate 45 about marker")).toBeNull();
    expect(clauses("rotate 45 about marker bee")).toBeNull();
    expect(clauses("delete marker a")).toBeNull();
    expect(clauses("move to marker a and b")).toBeNull();
  });
});
