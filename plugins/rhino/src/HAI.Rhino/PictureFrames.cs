using System;
using System.Drawing;
using System.IO;
using HAI.Rhino.Core.Protocol;
using Rhino;
using Rhino.Geometry;

namespace HAI.Rhino
{
    /// <summary>
    /// Places an image in the document as a picture frame (a site photo, a reference), embedded so the document keeps it
    /// when the project moves, as one undo step named after the agent and the title.
    /// </summary>
    internal static class PictureFrames
    {
        public static ImagePlaced Place(RhinoDoc doc, ImagePlaceRequest request)
        {
            var answer = new ImagePlaced { Id = request.Id };
            if (!File.Exists(request.Path))
            {
                answer.Error = "There is no such image: " + request.Path;
                return answer;
            }

            if (request.Origin.Length != 3 || request.Normal.Length != 3 || request.WidthMm <= 0)
            {
                answer.Error = "The plane or the size is not valid.";
                return answer;
            }

            double heightMm;
            try
            {
                heightMm = request.HeightMm ?? HeightFor(request.Path, request.WidthMm);
            }
            catch (Exception error) when (error is OutOfMemoryException || error is ArgumentException || error is IOException)
            {
                answer.Error = Limits.Clip("Rhino could not read the image: " + error.Message, Limits.Error);
                return answer;
            }

            // The request is in millimetres; the document may be in any unit.
            var scale = RhinoMath.UnitScale(UnitSystem.Millimeters, doc.ModelUnitSystem);
            var width = request.WidthMm * scale;
            var height = heightMm * scale;
            var plane = PlaneFacing(
                new Point3d(request.Origin[0] * scale, request.Origin[1] * scale, request.Origin[2] * scale),
                new Vector3d(request.Normal[0], request.Normal[1], request.Normal[2]));
            // AddPictureFrame puts the plane's origin at a corner: move it so the picture is centred on the origin asked for.
            plane.Origin = plane.Origin - plane.XAxis * (width / 2) - plane.YAxis * (height / 2);

            var label = "HAI: " + (request.Agent ?? "agent") + ": " + (request.Title ?? "Place an image");
            var record = doc.BeginUndoRecord(label);
            try
            {
                var id = doc.Objects.AddPictureFrame(plane, request.Path, false, width, height, true, true);
                if (id == Guid.Empty)
                {
                    answer.Error = "Rhino did not add the picture frame.";
                    return answer;
                }

                var added = doc.Objects.FindId(id);
                if (added != null && request.Agent != null)
                {
                    added.Attributes.SetUserString("hai.owner", request.Agent);
                    added.CommitChanges();
                }

                answer.Ok = true;
                answer.ObjectId = id.ToString("D");
                return answer;
            }
            finally
            {
                doc.EndUndoRecord(record);
                doc.Views.Redraw();
            }
        }

        /// <summary>The height that keeps the image's own proportions at this width.</summary>
        private static double HeightFor(string path, double widthMm)
        {
            using (var image = Image.FromFile(path))
                return image.Width > 0 ? widthMm * image.Height / image.Width : widthMm;
        }

        /// <summary>A plane facing along the normal, with its X axis level, so a picture stands upright on a wall.</summary>
        private static Plane PlaneFacing(Point3d origin, Vector3d normal)
        {
            if (!normal.Unitize()) normal = Vector3d.ZAxis;
            var x = Vector3d.CrossProduct(Vector3d.ZAxis, normal);
            // A picture facing straight up or down lies flat, with X along the world's.
            if (!x.Unitize()) x = Vector3d.XAxis;
            var y = Vector3d.CrossProduct(normal, x);
            y.Unitize();
            return new Plane(origin, x, y);
        }
    }
}
