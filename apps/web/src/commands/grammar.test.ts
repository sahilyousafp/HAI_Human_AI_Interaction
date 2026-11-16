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

describe("commands that made geometry", () => {
  const removed = (what: string) => [{ kind: "removed", what }];

  it("copy, array and scale are heard, however they go on, so the reply can say to ask the agent", () => {
    expect(clauses("copy 6 m y")).toEqual(removed("copy"));
    expect(clauses("copy 4 times 6 m along y")).toEqual(removed("copy"));
    expect(clauses("duplicate this")).toEqual(removed("copy"));
    expect(clauses("array 5 times")).toEqual(removed("array"));
    expect(clauses("array this 5 times along y")).toEqual(removed("array"));
    expect(clauses("scale 2")).toEqual(removed("scale"));
    expect(clauses("shrink this by half")).toEqual(removed("scale"));
    expect(clauses("copy and rotate 90")).toEqual(removed("copy"));
  });

  it("with something else the grammar does not know, the transcript is still the agent's", () => {
    expect(parseCommand("copy and paint it red")).toBeNull();
    expect(parseCommand("do not copy that")).toBeNull();
  });
});

describe("rotate and mirror", () => {
  it("rotates by degrees, counter-clockwise unless it says clockwise", () => {
    expect(clauses("rotate 90")).toEqual([{ kind: "rotate", deg: 90 }]);
    expect(clauses("rotate 45 degrees clockwise")).toEqual([{ kind: "rotate", deg: -45 }]);
    expect(clauses("rotate thirty anticlockwise")).toEqual([{ kind: "rotate", deg: 30 }]);
    expect(clauses("rotate minus 30")).toEqual([{ kind: "rotate", deg: -30 }]);
    expect(parseCommand("rotate")).toBeNull();
    expect(parseCommand("rotate 0")).toBeNull();
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
    expect(clauses("move 2 m east and rotate 90")).toEqual([
      { kind: "translate", by: [2000, 0, 0] },
      { kind: "rotate", deg: 90 },
    ]);
    expect(clauses("rotate 90 then mirror y")).toEqual([
      { kind: "rotate", deg: 90 },
      { kind: "mirror", axis: "y" },
    ]);
    expect(clauses("please move 1 m up, rotate 10 and mirror y")).toEqual([
      { kind: "translate", by: [0, 0, 1000] },
      { kind: "rotate", deg: 10 },
      { kind: "mirror", axis: "y" },
    ]);
  });

  it("take a comma and then, or and then, as one break", () => {
    expect(clauses("mirror x, then rotate 90")).toEqual([
      { kind: "mirror", axis: "x" },
      { kind: "rotate", deg: 90 },
    ]);
    expect(clauses("mirror x and then rotate 90")).toEqual(clauses("mirror x and rotate 90"));
  });

  it("are all or nothing: one clause the grammar does not know hands the whole transcript to the agent", () => {
    expect(parseCommand("move 1 m up and paint it red")).toBeNull();
    expect(parseCommand("rotate 90 and make it taller")).toBeNull();
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
  it("rotates and mirrors about a marker", () => {
    expect(clauses("rotate 45 about marker B")).toEqual([{ kind: "rotate", deg: 45, about: "B" }]);
    expect(clauses("mirror x at marker c")).toEqual([{ kind: "mirror", axis: "x", about: "C" }]);
  });

  it("moves to a marker", () => {
    expect(clauses("move to marker A")).toEqual([{ kind: "moveTo", marker: "A" }]);
  });

  it("chains with the other clauses", () => {
    expect(clauses("move to marker A and rotate 90 about marker B")).toEqual([
      { kind: "moveTo", marker: "A" },
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

describe("an axis called x", () => {
  it("leaves an axis called x alone", () => {
    expect(parseCommand("move 3 m along x")).toEqual(parseCommand("move 3 m east"));
  });
});

const same = (said: string, plain: string) => {
  const spoken = parseCommand(said);
  expect(spoken, said).not.toBeNull();
  expect(spoken, said).toEqual(parseCommand(plain));
};

describe("how people actually say it", () => {
  it("talk before the verb is dropped, clause by clause", () => {
    same("I want to move this three metres to the right", "move 3 m east");
    same("could you please copy this and then rotate it ninety degrees", "copy and rotate 90");
    same("go ahead and delete all columns", "delete all columns");
    same("um, please spin it forty five degrees, thanks", "rotate 45");
    same("let's scale this to two", "scale 2");
  });

  it("left, right, forward, back and the like are directions, as seen on a plan with north at the top", () => {
    same("move this two metres to the left", "move 2 m west");
    same("push it 5 metres forward", "move 5 m north");
    same("nudge this 30 centimetres back", "move 30 cm south");
    same("shift it 1 metre upwards", "move 1 m up");
  });

  it("other verbs and units for the same things", () => {
    same("slide this 3 metres east", "move 3 m east");
    same("pick all walls", "select all walls");
    same("conceal the selection", "hide");
    same("move this 2 feet east", "move 609.6 mm east");
    same("move it 4 inches up", "move 101.6 mm up");
  });

  it("a unit with no number is one of it", () => {
    same("move this a metre up", "move 1 m up");
    same("move it half a metre east", "move 0.5 m east");
  });

  it("anything that would change what it does is still the agent's", () => {
    for (const said of [
      "don't move this",
      "never delete the columns",
      "stop moving this",
      "do not copy that",
      "move this somewhere nice",
      "I want a wall here",
      "what would you like to move",
      "can you move this to the right of the wall",
      "I want to know what is selected",
    ])
      expect(parseCommand(said), said).toBeNull();
  });
});

describe("an axis and its way", () => {
  it("an axis letter and a way along it can both be said, in either order", () => {
    same("move 5 meters to the y axis towards right", "move 5 m north");
    same("move 5 meters along y towards left", "move 5 m south");
    same("move 5 meters towards right along the y axis", "move 5 m north");
    same("move y 5 meters forward", "move 5 m north");
    same("move this 3 m x right", "move 3 m east");
    same("move this 2 m z downwards", "move 2 m down");
  });

  it("two ways, or two letters, for one distance are not guessed", () => {
    expect(parseCommand("move 5 m right left")).toBeNull();
    expect(parseCommand("move 5 m x y")).toBeNull();
  });
});
