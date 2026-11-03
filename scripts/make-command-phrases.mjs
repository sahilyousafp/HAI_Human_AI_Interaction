// Builds test-assets/commands/phrases.json: the ways people say the offline commands, each with the plain wording the
// grammar must read it as, plus phrases that are the agent's (never guessed) and mishearings to put right.
//
//   node scripts/make-command-phrases.mjs
//
// Everything is generated from the lists below, deterministically, so the file can be rebuilt and reviewed. The unit test
// apps/web/src/commands/phrases.test.ts holds the grammar to it. The same file is the set to measure a language model
// against if one is ever added as a fallback (docs/decisions.md).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const out = join(import.meta.dirname, "..", "test-assets", "commands", "phrases.json");

/** A tiny seeded generator, so the same file comes out every time. */
let seed = 20261101;
const next = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = (list) => list[Math.floor(next() * list.length)];

// Wrappers: talk before and after a command, as people have it.
const LEAD = [
  "",
  "",
  "",
  "please ",
  "okay ",
  "now ",
  "could you ",
  "can you please ",
  "I want to ",
  "I'd like to ",
  "go ahead and ",
  "let's ",
  "um ",
  "so ",
];
const TAIL = ["", "", "", "", " please", ", thanks", " now", " for me", " thank you"];

// Distances: what is said and the plain wording it must equal.
const DISTANCES = [
  ["3 m", "3 m"],
  ["3 metres", "3 m"],
  ["three metres", "3 m"],
  ["3 meters", "3 m"],
  ["three meters", "3 m"],
  ["five metres", "5 m"],
  ["5 meters", "5 m"],
  ["a metre", "1 m"],
  ["one metre", "1 m"],
  ["half a metre", "0.5 m"],
  ["two and a half metres", "2.5 m"],
  ["2.5 metres", "2.5 m"],
  ["twenty centimetres", "20 cm"],
  ["30 cm", "30 cm"],
  ["thirty centimeters", "30 cm"],
  ["fifty centimetres", "50 cm"],
  ["2000", "2000 mm"],
  ["two thousand", "2000 mm"],
  ["1500 millimetres", "1500 mm"],
  ["three hundred millimetres", "300 mm"],
  ["10 m", "10 m"],
  ["ten metres", "10 m"],
  ["twelve thousand five hundred millimetres", "12500 mm"],
  ["two feet", "2 feet"],
  ["6 inches", "6 inches"],
];

// Ways to name a direction: what is said and the plain wording it must equal.
const DIRECTIONS = [
  ["east", "east"],
  ["to the east", "east"],
  ["towards the east", "east"],
  ["west", "west"],
  ["to the west", "west"],
  ["north", "north"],
  ["to the north", "north"],
  ["south", "south"],
  ["to the south", "south"],
  ["up", "up"],
  ["upwards", "up"],
  ["up in the air", null],
  ["down", "down"],
  ["downwards", "down"],
  ["to the right", "east"],
  ["towards the right", "east"],
  ["right", "east"],
  ["to the left", "west"],
  ["left", "west"],
  ["forward", "north"],
  ["forwards", "north"],
  ["backward", "south"],
  ["backwards", "south"],
  ["back", "south"],
  ["along x", "x"],
  ["along the x axis", "x"],
  ["in the x direction", "x"],
  ["along y", "y"],
  ["along the y axis", "y"],
  ["to the y axis", "y"],
  ["along z", "z"],
  ["on the z axis", "z"],
  ["to the y axis towards right", "north"],
  ["on the x axis towards left", "west"],
  ["along the y axis forward", "north"],
  ["along the y axis backwards", "south"],
  ["on the z axis upwards", "up"],
  ["along the x axis to the right", "east"],
].filter(([, plain]) => plain !== null);

const MOVE_VERBS = [
  "move",
  "move this",
  "move it",
  "shift",
  "shift this",
  "slide",
  "push",
  "push this",
  "nudge",
  "nudge it",
  "relocate this",
];
const COPY_VERBS = ["copy", "copy this", "duplicate", "duplicate this", "clone", "clone it", "make a copy"];
const COUNTS = [
  ["2", "2"],
  ["two", "2"],
  ["3", "3"],
  ["three", "3"],
  ["4 times", "4 times"],
  ["four times", "4 times"],
  ["5 times", "5 times"],
  ["five times", "5 times"],
  ["6 times", "6 times"],
  ["ten times", "10 times"],
];
const ANGLES = [
  ["90", "90"],
  ["ninety", "90"],
  ["45", "45"],
  ["forty five", "45"],
  ["30", "30"],
  ["thirty", "30"],
  ["180", "180"],
  ["one hundred and eighty", "180"],
  ["15", "15"],
  ["sixty", "60"],
];
const FACTORS = [
  ["2", "2"],
  ["two", "2"],
  ["0.5", "0.5"],
  ["half", "half"],
  ["double", "double"],
  ["50 percent", "50 percent"],
  ["three", "3"],
  ["0.75", "0.75"],
  ["triple", "triple"],
];

const entries = [];
const seen = new Set();
const add = (group, text, plain, extra = {}) => {
  const key = `${group}|${text}`;
  if (seen.has(key)) return;
  seen.add(key);
  entries.push({ group, kind: "offline", text, plain, ...extra });
};
const wrap = (text) => `${pick(LEAD)}${text}${pick(TAIL)}`;

// Move: every direction wording with a spread of distances and verbs.
for (const [say, plain] of DIRECTIONS) {
  for (let i = 0; i < 4; i++) {
    const [d, dPlain] = pick(DISTANCES);
    const verb = pick(MOVE_VERBS);
    const order = next() < 0.7;
    const body = order ? `${verb} ${d} ${say}` : `${verb} ${say} ${d}`;
    const plainWay = ["x", "y", "z"].includes(plain) ? `${plain}` : plain;
    add("move", wrap(body), `move ${dPlain} ${plainWay}`);
  }
}
// Move, two distances in one breath.
for (let i = 0; i < 12; i++) {
  const [d1, p1] = pick(DISTANCES);
  const [d2, p2] = pick(DISTANCES);
  const a = pick([
    ["up", "up"],
    ["east", "east"],
    ["to the right", "east"],
  ]);
  const b = pick([
    ["north", "north"],
    ["to the left", "west"],
    ["forward", "north"],
    ["down", "down"],
  ]);
  add(
    "move",
    wrap(`${pick(MOVE_VERBS)} ${d1} ${a[0]} and ${d2} ${b[0]}`),
    `move ${p1} ${a[1]} and ${p2} ${b[1]}`,
  );
}

// Copy and array.
for (const verb of COPY_VERBS) {
  add("copy", wrap(verb), "copy");
  for (let i = 0; i < 5; i++) {
    const [d, dPlain] = pick(DISTANCES);
    const [say, plain] = pick(DIRECTIONS);
    add("copy", wrap(`${verb} ${d} ${say}`), `copy ${dPlain} ${plain}`);
  }
}
for (const [c, cPlain] of COUNTS.filter(([, p]) => p.includes("times"))) {
  for (let i = 0; i < 4; i++) {
    const [d, dPlain] = pick(DISTANCES);
    const [say, plain] = pick(DIRECTIONS);
    add("copy", wrap(`${pick(COPY_VERBS)} ${c} ${d} ${say}`), `copy ${cPlain} ${dPlain} ${plain}`);
    add("copy", wrap(`array ${c} ${d} ${say}`), `copy ${cPlain} ${dPlain} ${plain}`);
  }
  add("array", wrap(`array ${c}`), `array ${cPlain}`);
  add("array", wrap(`array this ${c}`), `array ${cPlain}`);
  add("array", wrap(`make an array ${c}`), `array ${cPlain}`, { skip: "not a verb the grammar has" });
}
for (const [say, plain] of DIRECTIONS.filter(([, p]) =>
  ["x", "y", "z", "up", "east", "north", "west"].includes(p),
)) {
  const [c, cPlain] = pick(COUNTS.filter(([, p]) => p.includes("times")));
  add("array", wrap(`array ${c} ${say}`), `array ${cPlain} ${plain}`);
}

// Rotate, scale, mirror.
for (const [a, aPlain] of ANGLES) {
  for (const say of ["rotate", "rotate this", "turn", "turn it", "spin", "spin this"]) {
    add("rotate", wrap(`${say} ${a} degrees`), `rotate ${aPlain}`);
  }
  add("rotate", wrap(`rotate ${a} degrees clockwise`), `rotate ${aPlain} clockwise`);
  add("rotate", wrap(`rotate this ${a} degrees anticlockwise`), `rotate ${aPlain} anticlockwise`);
  add("rotate", wrap(`rotate it ${a} degrees counter clockwise`), `rotate ${aPlain} anticlockwise`);
  add("rotate", wrap(`rotate ${a} degrees about marker B`), `rotate ${aPlain} about marker B`);
  add("rotate", wrap(`turn it ${a} degrees around marker A`), `rotate ${aPlain} about marker A`);
}
for (const [f, fPlain] of FACTORS) {
  for (const say of [
    "scale",
    "scale this",
    "resize",
    "enlarge",
    "shrink",
    "scale it up to",
    "scale this to",
  ]) {
    if (say === "enlarge" && ["half", "0.5", "50 percent", "0.75"].includes(f)) continue;
    if (say === "shrink" && !["half", "0.5", "50 percent", "0.75"].includes(f)) continue;
    add("scale", wrap(`${say} ${f}`), `scale ${fPlain}`);
  }
  add("scale", wrap(`scale ${f} about marker A`), `scale ${fPlain} about marker A`);
}
for (const [say, plain] of [
  ["mirror x", "mirror x"],
  ["mirror y", "mirror y"],
  ["mirror this across x", "mirror x"],
  ["flip x", "mirror x"],
  ["flip this y", "mirror y"],
  ["mirror it about the y axis", "mirror y"],
  ["mirror x at marker C", "mirror x at marker C"],
]) {
  add("mirror", wrap(say), plain);
}

// Select, delete, hide.
for (const [say, plain] of [
  ["select all", "select all"],
  ["select everything", "select all"],
  ["select all walls", "select all walls"],
  ["select the walls", "select walls"],
  ["pick all columns", "select all columns"],
  ["choose all slabs", "select all slabs"],
  ["select columns", "select columns"],
  ["select level 2", "select level 2"],
  ["select level two", "select level 2"],
  ["select none", "select none"],
  ["deselect", "deselect"],
  ["clear the selection", "deselect"],
  ["unselect", "deselect"],
  ["select all massings", "select all massing"],
  ["select all blocks", "select all massing"],
  ["select all walls and move 2 m up", "select all walls and move 2 m up"],
  ["select all columns and move three metres to the right", "select all columns and move 3 m east"],
  ["delete this", "delete"],
  ["delete all columns", "delete all columns"],
  ["erase this", "delete"],
  ["remove this", "delete"],
  ["delete all walls", "delete all walls"],
  ["hide", "hide"],
  ["hide this", "hide"],
  ["hide the selection", "hide"],
  ["conceal this", "hide"],
  ["isolate", "isolate"],
  ["isolate this", "isolate"],
  ["isolate the selection", "isolate"],
  ["group", "group"],
  ["group this", "group"],
  ["group these", "group"],
  ["group the selection", "group"],
  ["ungroup", "ungroup"],
  ["ungroup this", "ungroup"],
  ["ungroup these", "ungroup"],
  ["ungroup the selection", "ungroup"],
  ["show all", "show all"],
  ["show everything", "show all"],
  ["unhide", "show all"],
  ["reveal all", "show all"],
  ["hide all walls", "hide all walls"],
]) {
  add("select", wrap(say), plain);
}
for (const [say, plain] of [
  ["move to marker A", "move to marker A"],
  ["move this to marker B", "move to marker B"],
  ["take this to marker C", null],
  ["move it onto marker A", "move to marker A"],
].filter(([, p]) => p))
  add("marker", wrap(say), plain);

// Chains.
for (const [say, plain] of [
  ["copy and rotate 90", "copy and rotate 90"],
  ["copy this and rotate it ninety degrees", "copy and rotate 90"],
  ["copy 3 m east then scale 0.5", "copy 3 m east then scale 0.5"],
  ["copy three metres to the right and then scale it half", "copy 3 m east then scale half"],
  ["move 2 m up and rotate 45", "move 2 m up and rotate 45"],
  ["rotate 90 and then move 3 m north", "rotate 90 and move 3 m north"],
  ["copy 4 times 6 m along y and rotate 90", "copy 4 times 6 m y and rotate 90"],
  ["mirror x then move 1 m up", "mirror x and move 1 m up"],
  ["rotate ninety degrees, then copy three metres along x", "rotate 90 and copy 3 m x"],
  ["scale 2 and move 5 m east", "scale 2 and move 5 m east"],
])
  add("chain", wrap(say), plain);

// What a speech model writes wrong, and what it was.
const mishear = [
  ["scale to", "scale 2"],
  ["scale too", "scale 2"],
  ["rotate ate degrees", "rotate 8 degrees"],
  ["move won metre east", "move 1 m east"],
  ["copy for times six metres along y", "copy 4 times 6 m y"],
  ["high the selection", "hide the selection"],
  ["rotate ninety degrees clockwize", "rotate 90 clockwise"],
  ["move to metres up", "move 2 m up"],
  ["copy to times three metres east", "copy 2 times 3 m east"],

  ["scale half", "scale half"],
].map(([text, plain]) => [text, plain]);
for (const [text, plain] of mishear)
  entries.push({ group: "misheard", kind: "offline", text, plain, corrected: true });

// Corrections of the last command: "make it 4 m". `expect` is what the number is taken to be (parseCorrection).
const corrections = [
  ["make it 4 m", { kind: "length", mm: 4000 }],
  ["make it 4m", { kind: "length", mm: 4000 }],
  ["make it four metres", { kind: "length", mm: 4000 }],
  ["change it to 4 m", { kind: "length", mm: 4000 }],
  ["change it to 4m", { kind: "length", mm: 4000 }],
  ["change that to four metres", { kind: "length", mm: 4000 }],
  ["no, 4 metres", { kind: "length", mm: 4000 }],
  ["no 4 meters", { kind: "length", mm: 4000 }],
  ["actually 4 m", { kind: "length", mm: 4000 }],
  ["I meant 4 metres", { kind: "length", mm: 4000 }],
  ["sorry, make it 4 metres", { kind: "length", mm: 4000 }],
  ["4 metres instead", { kind: "length", mm: 4000 }],
  ["make the distance 2.5 metres", { kind: "length", mm: 2500 }],
  ["change the distance to two and a half metres", { kind: "length", mm: 2500 }],
  ["make it 30 cm", { kind: "length", mm: 300 }],
  ["change it to fifty centimetres", { kind: "length", mm: 500 }],
  ["make it 1500 millimetres", { kind: "length", mm: 1500 }],
  ["make it a metre", { kind: "length", mm: 1000 }],
  ["make it 3 feet", { kind: "length", mm: 914.4 }],
  ["make it 6 times", { kind: "count", count: 6 }],
  ["change it to six times", { kind: "count", count: 6 }],
  ["make it 6 copies", { kind: "count", count: 6 }],
  ["no, 3 times", { kind: "count", count: 3 }],
  ["actually ten times", { kind: "count", count: 10 }],
  ["make the count 8 times", { kind: "count", count: 8 }],
  ["make it 45 degrees", { kind: "angle", deg: 45 }],
  ["change it to forty five degrees", { kind: "angle", deg: 45 }],
  ["no, 30 degrees", { kind: "angle", deg: 30 }],
  ["make the angle 60 degrees", { kind: "angle", deg: 60 }],
  ["actually 90 degrees", { kind: "angle", deg: 90 }],
  ["make it 50 percent", { kind: "factor", factor: 0.5 }],
  ["change it to 75 percent", { kind: "factor", factor: 0.75 }],
  ["make it 4", { kind: "number", value: 4 }],
  ["change it to 4", { kind: "number", value: 4 }],
  ["make it four", { kind: "number", value: 4 }],
  ["no, 4", { kind: "number", value: 4 }],
  ["actually 2.5", { kind: "number", value: 2.5 }],
  ["make that 3 please", { kind: "number", value: 3 }],
];
for (const [text, expect] of corrections)
  entries.push({ group: "correction", kind: "correction", text, expect });
// Said like a correction but not one: they name something, or are a new request.
for (const text of [
  "make this 300 thick",
  "make this wall three hundred thick",
  "make it taller",
  "make it red",
  "change it to a column",
  "set the wall height to 2.8 metres",
  "no",
  "4 m",
  "move 4 m",
  "make it 4 m thick",
])
  entries.push({ group: "correction", kind: "not-correction", text });

// The agent's: said clearly, but not something the offline commands do. They must never be guessed into a command.
const agent = [
  "add three floors to this block",
  "make this wall three hundred thick",
  "make this column four hundred by four hundred",
  "set the wall height to two point eight metres",
  "extrude this outline eighteen metres",
  "loft these curves",
  "sweep this profile along the rail",
  "offset this curve by one point five metres",
  "fillet these corners",
  "trim the walls at the slab",
  "join these two walls",
  "put a window one point two metres wide here",
  "add a door here",
  "draw a wall along this sketch",
  "a canopy from here to here",
  "copy this along the curve every thirty centimetres",
  "array this along line two with the width tapering",
  "what is everyone doing",
  "Mochi, what is everyone doing",
  "Architect, add a stair core here",
  "how tall is this",
  "measure the distance between these towers",
  "make this taller",
  "make the third floor three point six metres high",
  "extend this wall to that one",
  "what is the area of this slab",
  "rename this to block A",
  "colour this red",
  "don't move this",
  "do not copy that",
  "never delete the columns",
  "stop moving this",
  "move this somewhere nice",
  "move this a bit",
  "I want a wall here",
  "what would you like to move",
  "can you move this to the right of the wall",
  "I want to know what is selected",
  "undo the last three changes and explain them",
  "move this next to the other tower",
  "rotate this so it faces the street",
  "scale this to fit the plot",
  "copy this onto every floor",
  "align these walls",
  "snap this to the grid",
  "array this around marker A",
  "mirror this across the street",
  "explode this",
  "make this a wall",
  "turn this into a column",
];
for (const text of agent) entries.push({ group: "agent", kind: "agent", text });

mkdirSync(dirname(out), { recursive: true });
const offline = entries.filter((e) => e.kind === "offline");
writeFileSync(
  out,
  `${JSON.stringify(
    {
      about:
        "Ways people say the offline commands (kind offline: `plain` is the wording the grammar must read it as; corrected: true means a speech-model mishearing put right first), and phrases that are the agent's (kind agent: never guessed into a command), and corrections of the last command (make it 4 m, with what number it is taken to be). Built by scripts/make-command-phrases.mjs.",
      counts: {
        offline: offline.length,
        agent: entries.filter((e) => e.kind === "agent").length,
        corrections: entries.filter((e) => e.group === "correction").length,
      },
      entries,
    },
    null,
    1,
  )}\n`,
);
console.log(
  `wrote ${entries.length} phrases (${offline.length} offline, ${entries.length - offline.length} agent) to ${out}`,
);
