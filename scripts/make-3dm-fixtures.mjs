// Small Rhino files for the import tests, written with rhino3dm (no Rhino install needed).
//
//   node scripts/make-3dm-fixtures.mjs            writes test-assets/models/*.3dm (committed, a few KB each)
//   node scripts/make-3dm-fixtures.mjs --big      also writes .hai/models/grid-1000.3dm (1000 boxes, the most objects an
//                                                 import keeps as separate elements; git-ignored)
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const require = createRequire(join(root, "apps", "web", "package.json"));
const rhino = await require("rhino3dm")();

/** The 12 triangles of a box over [min, max], as one mesh. */
function boxMesh(min, max) {
  const mesh = new rhino.Mesh();
  for (const z of [min[2], max[2]]) {
    for (const [x, y] of [
      [min[0], min[1]],
      [max[0], min[1]],
      [max[0], max[1]],
      [min[0], max[1]],
    ]) {
      mesh.vertices().add(x, y, z);
    }
  }
  const tris = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [1, 2, 6],
    [1, 6, 5],
    [2, 3, 7],
    [2, 7, 6],
    [3, 0, 4],
    [3, 4, 7],
  ];
  for (const [a, b, c] of tris) mesh.faces().addTriFace(a, b, c);
  return mesh;
}

/** One quad of a box over [min, max]: the side `side` (0..5) as its own mesh, for a Brep face. */
function boxQuad(min, max, side) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const quads = [
    [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y1, z0],
      [x0, y1, z0],
    ],
    [
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z1],
    ],
    [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y0, z1],
      [x0, y0, z1],
    ],
    [
      [x1, y0, z0],
      [x1, y1, z0],
      [x1, y1, z1],
      [x1, y0, z1],
    ],
    [
      [x1, y1, z0],
      [x0, y1, z0],
      [x0, y1, z1],
      [x1, y1, z1],
    ],
    [
      [x0, y1, z0],
      [x0, y0, z0],
      [x0, y0, z1],
      [x0, y1, z1],
    ],
  ];
  const mesh = new rhino.Mesh();
  for (const [x, y, z] of quads[side]) mesh.vertices().add(x, y, z);
  mesh.faces().addQuadFace(0, 1, 2, 3);
  return mesh;
}

/** A Brep box with a render mesh on each face, as Rhino saves it. */
function brepBox(min, max, withMeshes = true) {
  const brep = rhino.Brep.createFromBoundingBox(new rhino.BoundingBox(min, max));
  if (withMeshes) {
    for (let side = 0; side < 6; side++) {
      brep
        .faces()
        .get(side)
        .setMesh(boxQuad(min, max, side), rhino.MeshType.Render);
    }
  }
  return brep;
}

/** Attributes for an object: a name, a layer and (when given) its own colour. */
function attributes(name, layerIndex = 0, color = null) {
  const a = new rhino.ObjectAttributes();
  a.name = name;
  a.layerIndex = layerIndex;
  if (color) {
    a.colorSource = rhino.ObjectColorSource.ColorFromObject;
    a.objectColor = color;
  }
  return a;
}

function newFile(units) {
  const file = new rhino.File3dm();
  file.settings().modelUnitSystem = units;
  return file;
}

const out = join(root, "test-assets", "models");
mkdirSync(out, { recursive: true });
const save = (dir, name, file) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), file.toByteArray());
  console.log(`wrote ${join(dir, name)}`);
};
const { Millimeters, Meters } = rhino.UnitSystem;

// 3 meshes and 2 Breps with render meshes, in millimetres.
{
  const f = newFile(Millimeters);
  for (let i = 0; i < 3; i++) {
    f.objects().addMesh(
      boxMesh([i * 3000, 0, 0], [i * 3000 + 2000, 2000, 3000]),
      attributes(`Mesh ${i + 1}`),
    );
  }
  for (let i = 0; i < 2; i++) {
    f.objects().addBrep(
      brepBox([i * 3000, 5000, 0], [i * 3000 + 2000, 7000, 3000]),
      attributes(`Brep ${i + 1}`),
    );
  }
  save(out, "meshes-and-breps.3dm", f);
}

// A 2 m wide box in a file saved in metres.
{
  const f = newFile(Meters);
  f.objects().addMesh(boxMesh([0, 0, 0], [2, 1, 1]), attributes("Metre box"));
  save(out, "metres-box.3dm", f);
}

// An object on the layer "Facade" displayed in red, and one that takes its colour from its layer.
{
  const f = newFile(Millimeters);
  const facade = f.layers().addLayer("Facade", { r: 0, g: 0, b: 255, a: 255 });
  f.objects().addMesh(
    boxMesh([0, 0, 0], [1000, 1000, 1000]),
    attributes("Red panel", facade, { r: 255, g: 0, b: 0, a: 255 }),
  );
  f.objects().addMesh(boxMesh([2000, 0, 0], [3000, 1000, 1000]), attributes("Blue panel", facade));
  save(out, "layers-and-colours.3dm", f);
}

// 2 meshes, 4 curves and 1 text note.
{
  const f = newFile(Millimeters);
  f.objects().addMesh(boxMesh([0, 0, 0], [1000, 1000, 1000]), attributes("Box A"));
  f.objects().addMesh(boxMesh([2000, 0, 0], [3000, 1000, 1000]), attributes("Box B"));
  for (let i = 0; i < 4; i++) f.objects().addLine([0, i * 100, 0], [1000, i * 100, 0]);
  f.objects().addTextDot("Note", [0, 0, 0], attributes("Note"));
  save(out, "with-curves-and-note.3dm", f);
}

// A Brep saved without render meshes (as with "Save small").
{
  const f = newFile(Millimeters);
  f.objects().addBrep(brepBox([0, 0, 0], [1000, 1000, 1000], false), attributes("Bare Brep"));
  save(out, "brep-without-meshes.3dm", f);
}

// A block definition of one mesh, placed twice.
{
  const f = newFile(Millimeters);
  const index = f
    .instanceDefinitions()
    .add(
      "Column",
      "",
      "",
      "",
      [0, 0, 0],
      [boxMesh([0, 0, 0], [400, 400, 3000])],
      [attributes("Column mesh")],
    );
  const definition = f.instanceDefinitions().get(index);
  for (const x of [1000, 5000]) {
    f.objects().addInstanceObject(
      new rhino.InstanceReference(definition.id, rhino.Transform.translationXYZ(x, 0, 0)),
      attributes("Column"),
    );
  }
  save(out, "blocks.3dm", f);
}

// A facade of 100 small blocks as one mesh (1200 triangles, sharp edges everywhere), three of them side by side:
// the kind of detailed object that edge lines used to turn black at a distance.
{
  const f = newFile(Millimeters);
  for (let k = 0; k < 3; k++) {
    const facade = new rhino.Mesh();
    let base = 0;
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 10; j++) {
        const cube = boxMesh(
          [k * 6000 + i * 400, j * 400, 0],
          [k * 6000 + i * 400 + 200, j * 400 + 200, 200],
        );
        for (let v = 0; v < cube.vertices().count; v++) {
          const [x, y, z] = cube.vertices().get(v);
          facade.vertices().add(x, y, z);
        }
        for (let t = 0; t < cube.faces().count; t++) {
          const [a, b, c] = cube.faces().get(t);
          facade.faces().addTriFace(a + base, b + base, c + base);
        }
        base += 8;
      }
    }
    f.objects().addMesh(facade, attributes(`Facade ${k + 1}`));
  }
  save(out, "dense-facade.3dm", f);
}

// Not a Rhino file at all.
writeFileSync(join(out, "not-a-3dm.3dm"), "this is plain text, not a Rhino file\n");
console.log(`wrote ${join(out, "not-a-3dm.3dm")}`);

if (process.argv.includes("--big")) {
  const f = newFile(Millimeters);
  for (let i = 0; i < 1000; i++) {
    const x = (i % 50) * 1500;
    const y = Math.floor(i / 50) * 1500;
    f.objects().addMesh(
      boxMesh([x, y, 0], [x + 1000, y + 1000, 1000 + (i % 7) * 500]),
      attributes(`Box ${i}`),
    );
  }
  save(join(root, ".hai", "models"), "grid-1000.3dm", f);
}
