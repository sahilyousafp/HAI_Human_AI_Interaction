using System;
using System.Collections.Generic;
using System.Linq;
using HAI.Rhino.Core.Edit;
using HAI.Rhino.Core.Protocol;
using Rhino;
using Rhino.Geometry;

namespace HAI.Rhino
{
    /// <summary>
    /// Applies the user's own edits made in HAI: a transform or a delete of named objects, as one undo record labelled
    /// after the tool ("HAI: Move"). It runs no code; an object that is gone is reported, and nothing is half done.
    /// </summary>
    internal static class HostEdits
    {
        public static Edited Apply(RhinoDoc doc, EditRequest request)
        {
            var answer = new Edited { Id = request.Id };
            var ids = new List<Guid>();
            foreach (var text in request.Op.Ids)
            {
                if (!Guid.TryParse(text, out var id) || doc.Objects.FindId(id) == null)
                {
                    answer.Error = Limits.Clip("There is no object " + text + " in Rhino any more.", Limits.Error);
                    return answer;
                }

                ids.Add(id);
            }

            if (ids.Count == 0)
            {
                answer.Error = "The edit names no object.";
                return answer;
            }

            Transform? transform = null;
            if (request.Op.Op == "transform")
            {
                var scale = RhinoMath.UnitScale(UnitSystem.Millimeters, doc.ModelUnitSystem);
                var m = EditMatrix.ToDocument(request.Op.Matrix, scale);
                if (m == null)
                {
                    answer.Error = "The edit's matrix is not 16 numbers.";
                    return answer;
                }

                if (EditMatrix.IsIdentity(m))
                {
                    answer.Ok = true;
                    return answer;
                }

                var t = new Transform();
                for (var row = 0; row < 4; row++)
                for (var col = 0; col < 4; col++)
                    t[row, col] = m[row * 4 + col];
                transform = t;
            }
            else if (request.Op.Op != "delete")
            {
                answer.Error = "Rhino does not know the edit \"" + request.Op.Op + "\".";
                return answer;
            }

            var record = doc.BeginUndoRecord("HAI: " + Limits.Clip(request.Label, 80));
            try
            {
                var done = transform.HasValue
                    ? ids.Count(id => doc.Objects.Transform(id, transform.Value, true) != Guid.Empty)
                    : ids.Count(id => doc.Objects.Delete(id, true));
                answer.Ok = done == ids.Count;
                if (!answer.Ok) answer.Error = $"Rhino changed {done} of the {ids.Count} objects; one Undo takes back what it did.";
                return answer;
            }
            finally
            {
                doc.EndUndoRecord(record);
                doc.Views.Redraw();
            }
        }
    }
}
