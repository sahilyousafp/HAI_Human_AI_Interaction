using System;
using System.Collections.Generic;
using HAI.Rhino.Core.Changes;
using HAI.Rhino.Core.Protocol;
using HAI.Rhino.Mirror;
using Rhino;
using Rhino.DocObjects;

namespace HAI.Rhino
{
    /// <summary>
    /// One agent script's run in the document, as the bridge needs to see it: the run is a single undo step named after
    /// the agent and the run's title, every object the script adds is stamped "hai.owner" (and "hai.part") without the
    /// script having to, and the document is compared before and after so the bridge can tell what the script touched.
    ///
    /// A script is not sandboxed: this cannot stop it from changing anything. It makes the change visible, owned and
    /// undoable. Use it on the UI thread around the script; Finish returns the comparison and closes the undo step.
    /// Needs a real Rhino 8 to run (the Python runner that uses it is task 5.1 of add-rhino-connector); the comparison
    /// and the stamp it rely on are tested in HAI.Rhino.Core.Tests.
    /// </summary>
    internal sealed class RunScope : IDisposable
    {
        private readonly RhinoDoc doc;
        private readonly string? agent;
        private readonly string? part;
        private readonly uint undoRecord;
        private readonly Dictionary<string, ObjectSnapshot> before;
        private bool finished;

        private RunScope(RhinoDoc doc, PythonRunRequest request)
        {
            this.doc = doc;
            agent = string.IsNullOrWhiteSpace(request.Agent) ? null : request.Agent;
            part = string.IsNullOrWhiteSpace(request.Part) ? null : request.Part;
            var label = agent == null ? request.Title : agent + ": " + request.Title;
            undoRecord = doc.BeginUndoRecord(Limits.Clip(string.IsNullOrWhiteSpace(label) ? "HAI script" : label!, 120));
            before = Snapshot(doc);
        }

        /// <summary>Starts the undo step and remembers what the document holds.</summary>
        public static RunScope Begin(RhinoDoc doc, PythonRunRequest request) => new RunScope(doc, request);

        /// <summary>Stamps what the script added, closes the undo step and returns what changed.</summary>
        public RunChanges Finish()
        {
            if (finished) throw new InvalidOperationException("The run was already finished.");
            finished = true;
            try
            {
                if (agent != null) StampAdded();
            }
            finally
            {
                doc.EndUndoRecord(undoRecord);
            }

            return RunDiff.Compare(before, Snapshot(doc));
        }

        public void Dispose()
        {
            if (finished) return;
            finished = true;
            doc.EndUndoRecord(undoRecord);
        }

        private void StampAdded()
        {
            foreach (var obj in Objects(doc))
            {
                if (before.ContainsKey(obj.Id.ToString("D"))) continue;
                var stamp = OwnerStamp.Apply(ObjectDescriber.Tags(obj), agent!, part);
                var attributes = obj.Attributes.Duplicate();
                foreach (var tag in stamp) attributes.SetUserString(tag.Key, tag.Value);
                doc.Objects.ModifyAttributes(obj, attributes, true);
            }
        }

        private static IEnumerable<RhinoObject> Objects(RhinoDoc doc) =>
            doc.Objects.GetObjectList(new ObjectEnumeratorSettings
            {
                NormalObjects = true,
                LockedObjects = true,
                HiddenObjects = true,
                ReferenceObjects = true,
                IncludeLights = false,
                IncludeGrips = false,
                DeletedObjects = false,
            });

        /// <summary>Every object in the document, drawn or not, with what changes when a script modifies it.</summary>
        private static Dictionary<string, ObjectSnapshot> Snapshot(RhinoDoc doc)
        {
            var objects = new Dictionary<string, ObjectSnapshot>();
            foreach (var obj in Objects(doc))
            {
                var bounds = ObjectDescriber.BoundsMm(doc, obj);
                var id = obj.Id.ToString("D");
                objects[id] = new ObjectSnapshot
                {
                    Id = id,
                    Name = obj.Attributes.Name ?? "",
                    // A replaced or transformed object gets a new serial number; its box catches a change in place.
                    Fingerprint = obj.RuntimeSerialNumber + ":" + string.Join(",", bounds.Min) + ":" + string.Join(",", bounds.Max),
                    Tags = ObjectDescriber.Tags(obj),
                    Bounds = bounds,
                };
            }

            return objects;
        }
    }
}
