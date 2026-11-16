using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using HAI.Rhino.Core.Describe;
using HAI.Rhino.Core.Protocol;
using Rhino;
using Rhino.DocObjects;
using Rhino.Geometry;

namespace HAI.Rhino.Mirror
{
    /// <summary>
    /// Describes selected objects for the agent and the selection card: what each is in Rhino's own words, its layer, its
    /// box, its area, volume or length, its material and every user string. Area and volume are worked out only where that
    /// is quick, and the whole description stops measuring once it has taken a quarter of a second.
    /// </summary>
    internal static class ComponentDescriber
    {
        private static readonly TimeSpan MeasureBudget = TimeSpan.FromMilliseconds(250);

        public static Described Describe(RhinoDoc doc, DescribeRequest request)
        {
            var answer = new Described { Id = request.Id };
            var clock = Stopwatch.StartNew();
            foreach (var text in request.Ids.Take(Limits.DescribedComponents))
            {
                if (!Guid.TryParse(text, out var id)) continue;
                var obj = doc.Objects.FindId(id);
                if (obj == null || obj.IsDeleted) continue;
                answer.Components.Add(Of(doc, obj, clock.Elapsed < MeasureBudget));
            }

            return answer;
        }

        private static Component Of(RhinoDoc doc, RhinoObject obj, bool measure)
        {
            var strings = obj.Attributes.GetUserStrings();
            var component = new Component
            {
                Id = obj.Id.ToString("D"),
                Name = Limits.Clip(obj.Attributes.Name ?? "", Limits.ObjectName),
                Type = Limits.Clip(TypeOf(doc, obj), Limits.ComponentType),
                Layer = ObjectDescriber.LayerPath(doc, obj),
                Bounds = obj.Geometry == null ? null : ObjectDescriber.BoundsMm(doc, obj),
                Material = MaterialOf(obj),
                Properties = ComponentProperties.From(
                    strings.AllKeys.Select(k => new KeyValuePair<string?, string?>(k, k == null ? null : strings[k]))),
            };
            if (!measure)
            {
                component.QuantitiesSkipped = obj.Geometry is Brep || obj.Geometry is Mesh || obj.Geometry is Extrusion;
                return component;
            }

            var scale = RhinoMath.UnitScale(doc.ModelUnitSystem, UnitSystem.Millimeters);
            try
            {
                Measure(obj.Geometry, scale, component);
            }
            catch (Exception)
            {
                // A shape Rhino cannot measure is described without its quantities.
                component.QuantitiesSkipped = true;
            }

            return component;
        }

        private static void Measure(GeometryBase? geometry, double scale, Component component)
        {
            var area = scale * scale;
            var volume = area * scale;
            switch (geometry)
            {
                case Extrusion extrusion:
                    Measure(extrusion.ToBrep(), scale, component);
                    return;
                case Brep brep:
                    if (!ComponentProperties.QuickToMeasure(brep.Faces.Count, isMesh: false))
                    {
                        component.QuantitiesSkipped = true;
                        return;
                    }

                    component.Quantities.AreaMm2 = AreaMassProperties.Compute(brep)?.Area * area;
                    if (brep.IsSolid) component.Quantities.VolumeMm3 = VolumeMassProperties.Compute(brep)?.Volume * volume;
                    return;
                case Mesh mesh:
                    if (!ComponentProperties.QuickToMeasure(mesh.Faces.Count, isMesh: true))
                    {
                        component.QuantitiesSkipped = true;
                        return;
                    }

                    component.Quantities.AreaMm2 = AreaMassProperties.Compute(mesh)?.Area * area;
                    if (mesh.IsClosed) component.Quantities.VolumeMm3 = VolumeMassProperties.Compute(mesh)?.Volume * volume;
                    return;
                case Surface surface:
                    component.Quantities.AreaMm2 = AreaMassProperties.Compute(surface)?.Area * area;
                    return;
                case Curve curve:
                    component.Quantities.LengthMm = curve.GetLength() * scale;
                    return;
            }
        }

        /// <summary>Rhino's own words for an object: "Closed Brep", "Open Mesh", "Block: Tree".</summary>
        private static string TypeOf(RhinoDoc doc, RhinoObject obj)
        {
            switch (obj.Geometry)
            {
                case Extrusion extrusion:
                    return extrusion.IsCappedAtBottom && extrusion.IsCappedAtTop ? "Closed Extrusion" : "Open Extrusion";
                case Brep brep:
                    return (brep.IsSolid ? "Closed " : "Open ") + (brep.Faces.Count == 1 ? "Surface" : "Polysurface");
                case Mesh mesh:
                    return mesh.IsClosed ? "Closed Mesh" : "Open Mesh";
                case SubD _:
                    return "SubD";
                case Surface _:
                    return "Surface";
                case Curve curve:
                    return curve.IsClosed ? "Closed Curve" : "Curve";
                case InstanceReferenceGeometry _:
                    var definition = (obj as InstanceObject)?.InstanceDefinition;
                    return "Block: " + (definition?.Name ?? "unnamed");
                default:
                    return obj.ObjectType.ToString();
            }
        }

        /// <summary>The object's render material, else its display material, by name; null when it has the default.</summary>
        private static string? MaterialOf(RhinoObject obj)
        {
            var render = obj.RenderMaterial?.Name;
            if (!string.IsNullOrWhiteSpace(render)) return Limits.Clip(render!, Limits.ObjectName);
            var material = obj.GetMaterial(true);
            var name = material?.Name;
            return string.IsNullOrWhiteSpace(name) ? null : Limits.Clip(name!, Limits.ObjectName);
        }
    }
}
