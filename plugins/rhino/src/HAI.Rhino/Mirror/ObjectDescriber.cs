using System;
using System.Collections.Generic;
using HAI.Rhino.Core.Protocol;
using Rhino;
using Rhino.DocObjects;

namespace HAI.Rhino.Mirror
{
    /// <summary>What kind of thing an object is to the viewer: something it draws, or something it only counts.</summary>
    internal enum Kind
    {
        Drawn,
        Curve,
        Point,
        Annotation,
        Other,
    }

    /// <summary>Describes a Rhino object the way the bridge's schema asks (packages/protocol/src/rhino.ts).</summary>
    internal static class ObjectDescriber
    {
        public static Kind Classify(RhinoObject obj)
        {
            if (TypeName(obj) != null) return Kind.Drawn;
            var type = obj.ObjectType;
            if (type == ObjectType.Curve) return Kind.Curve;
            if (type == ObjectType.Point || type == ObjectType.PointSet) return Kind.Point;
            if (type == ObjectType.Annotation) return Kind.Annotation;
            return Kind.Other;
        }

        /// <summary>The viewer's name for what is drawn (brep, extrusion, mesh, surface or subd), or null.</summary>
        public static string? TypeName(RhinoObject obj)
        {
            switch (obj.ObjectType)
            {
                case ObjectType.Brep: return "brep";
                case ObjectType.Extrusion: return "extrusion";
                case ObjectType.Mesh: return "mesh";
                case ObjectType.Surface: return "surface";
                case ObjectType.SubD: return "subd";
                default: return null;
            }
        }

        /// <summary>Whether the object is on screen in Rhino: its own visibility and its layer's.</summary>
        public static bool IsShown(RhinoDoc doc, RhinoObject obj)
        {
            if (obj.IsDeleted || obj.IsHidden) return false;
            var layer = doc.Layers[obj.Attributes.LayerIndex];
            return layer != null && layer.IsVisible;
        }

        public static string LayerPath(RhinoDoc doc, RhinoObject obj)
        {
            var layer = doc.Layers[obj.Attributes.LayerIndex];
            return Limits.Clip(layer?.FullPath ?? "Default", Limits.LayerPath);
        }

        public static RhinoObjectInfo Describe(RhinoDoc doc, RhinoObject obj, Guid? asset, int triangles)
        {
            var colour = obj.Attributes.DrawColor(doc);
            return new RhinoObjectInfo
            {
                Id = obj.Id.ToString("D"),
                Name = Limits.Clip(obj.Attributes.Name ?? "", Limits.ObjectName),
                Type = TypeName(obj) ?? "mesh",
                Layer = LayerPath(doc, obj),
                // The colour as Rhino draws it (the object's own, else its layer's), so the viewer needs no layer table.
                Color = colour.IsEmpty ? null : $"#{colour.R:x2}{colour.G:x2}{colour.B:x2}",
                Bounds = BoundsMm(doc, obj),
                Asset = asset?.ToString("D"),
                Triangles = triangles,
                Tags = Tags(obj),
            };
        }

        /// <summary>The object's bounding box in millimetres.</summary>
        public static Bounds BoundsMm(RhinoDoc doc, RhinoObject obj)
        {
            var scale = RhinoMath.UnitScale(doc.ModelUnitSystem, UnitSystem.Millimeters);
            var box = obj.Geometry.GetBoundingBox(true);
            return new Bounds
            {
                Min = new[] { box.Min.X * scale, box.Min.Y * scale, box.Min.Z * scale },
                Max = new[] { box.Max.X * scale, box.Max.Y * scale, box.Max.Z * scale },
            };
        }

        /// <summary>The object's user strings whose key starts with "hai.": how parts are named for the agents.</summary>
        public static Dictionary<string, string> Tags(RhinoObject obj)
        {
            var tags = new Dictionary<string, string>();
            var strings = obj.Attributes.GetUserStrings();
            foreach (string? key in strings.AllKeys)
            {
                if (key == null || !key.StartsWith("hai.", StringComparison.Ordinal) || key.Length > Limits.TagKey) continue;
                if (tags.Count >= Limits.TagsPerObject) break;
                tags[key] = Limits.Clip(strings[key] ?? "", Limits.TagValue);
            }

            return tags;
        }
    }
}
