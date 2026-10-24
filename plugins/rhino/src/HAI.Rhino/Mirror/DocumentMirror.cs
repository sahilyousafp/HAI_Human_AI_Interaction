using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using HAI.Rhino.Bridge;
using HAI.Rhino.Core.Changes;
using HAI.Rhino.Core.Mesh;
using HAI.Rhino.Core.Protocol;
using Rhino;
using Rhino.DocObjects;
using Rhino.DocObjects.Tables;

namespace HAI.Rhino.Mirror
{
    /// <summary>
    /// Shares the open document with HAI: every object the viewer draws is meshed and its mesh uploaded, then described
    /// to the bridge in a batch. Changes in the document (a command, a script, the mouse) are collected for 100 ms and sent
    /// as one batch; the meshing is done in slices of at most 10 ms on Rhino's idle time so Rhino stays responsive; the first
    /// sync of a document sends the small objects first and says how far it has got.
    /// </summary>
    internal sealed class DocumentMirror : IDisposable
    {
        private const int SliceMilliseconds = 10;
        private const int SyncChunk = 40;
        private const int ParallelUploads = 6;
        private static readonly TimeSpan Window = TimeSpan.FromMilliseconds(100);
        private static readonly TimeSpan SelectionDebounce = TimeSpan.FromMilliseconds(50);

        private sealed class Job
        {
            public List<Guid> Ids = new List<Guid>();
            public List<Guid> Deleted = new List<Guid>();
            public bool Reset;
            public SyncProgress? Sync;
            public int Next;
            public readonly List<RhinoObjectInfo> Described = new List<RhinoObjectInfo>();
            public readonly List<KeyValuePair<Guid, byte[]>> Uploads = new List<KeyValuePair<Guid, byte[]>>();
            public int Generation;
        }

        private readonly BridgeClient client;
        private readonly Queue<Job> jobs = new Queue<Job>();
        private readonly HashSet<Guid> mirrored = new HashSet<Guid>();
        private readonly HashSet<Guid> heavy = new HashSet<Guid>();
        private readonly SemaphoreSlim uploads = new SemaphoreSlim(ParallelUploads, ParallelUploads);
        private RhinoDoc? doc;
        private ChangeCoalescer? coalescer;
        private Job? current;
        private bool running;
        private int generation;
        private Task sendChain = Task.CompletedTask;
        private Timer? selectionTimer;

        public DocumentMirror(BridgeClient client)
        {
            this.client = client;
        }

        // --- Attaching to a document ---------------------------------------------------------------------------

        /// <summary>Starts sharing this document: subscribes to its changes and sends it whole, small objects first.</summary>
        public void Attach(RhinoDoc target)
        {
            Detach();
            doc = target;
            generation++;
            coalescer = new ChangeCoalescer(Window, new TimerScheduler(), set => Ui(() => Enqueue(set.Changed, set.Deleted)));
            RhinoDoc.AddRhinoObject += OnAdded;
            RhinoDoc.UndeleteRhinoObject += OnAdded;
            RhinoDoc.ReplaceRhinoObject += OnReplaced;
            RhinoDoc.DeleteRhinoObject += OnDeleted;
            RhinoDoc.ModifyObjectAttributes += OnModified;
            RhinoDoc.LayerTableEvent += OnLayerChanged;
            RhinoDoc.SelectObjects += OnSelectionChanged;
            RhinoDoc.DeselectObjects += OnSelectionChanged;
            RhinoDoc.DeselectAllObjects += OnAllDeselected;
            StartSync(target);
            ScheduleSelection();
        }

        public void Detach()
        {
            RhinoDoc.AddRhinoObject -= OnAdded;
            RhinoDoc.UndeleteRhinoObject -= OnAdded;
            RhinoDoc.ReplaceRhinoObject -= OnReplaced;
            RhinoDoc.DeleteRhinoObject -= OnDeleted;
            RhinoDoc.ModifyObjectAttributes -= OnModified;
            RhinoDoc.LayerTableEvent -= OnLayerChanged;
            RhinoDoc.SelectObjects -= OnSelectionChanged;
            RhinoDoc.DeselectObjects -= OnSelectionChanged;
            RhinoDoc.DeselectAllObjects -= OnAllDeselected;
            coalescer?.Dispose();
            coalescer = null;
            selectionTimer?.Dispose();
            selectionTimer = null;
            generation++;
            jobs.Clear();
            current = null;
            mirrored.Clear();
            heavy.Clear();
            doc = null;
        }

        public void Dispose() => Detach();

        // --- What Rhino tells us ---------------------------------------------------------------------------------

        private bool Mine(RhinoObject? obj) => obj != null && doc != null && ReferenceEquals(obj.Document, doc);

        private void OnAdded(object? sender, RhinoObjectEventArgs e)
        {
            if (Mine(e.TheObject)) coalescer?.Changed(e.TheObject.Id);
        }

        private void OnReplaced(object? sender, RhinoReplaceObjectEventArgs e)
        {
            if (!Mine(e.NewRhinoObject)) return;
            if (e.OldRhinoObject != null && e.OldRhinoObject.Id != e.NewRhinoObject.Id) coalescer?.Deleted(e.OldRhinoObject.Id);
            coalescer?.Changed(e.NewRhinoObject.Id);
        }

        private void OnDeleted(object? sender, RhinoObjectEventArgs e)
        {
            if (Mine(e.TheObject)) coalescer?.Deleted(e.TheObject.Id);
        }

        private void OnModified(object? sender, RhinoModifyObjectAttributesEventArgs e)
        {
            if (Mine(e.RhinoObject)) coalescer?.Changed(e.RhinoObject.Id);
        }

        // A layer's colour or visibility changed: every object on it is drawn or hidden differently.
        private void OnLayerChanged(object? sender, LayerTableEventArgs e)
        {
            if (doc == null || !ReferenceEquals(e.Document, doc) || e.EventType != LayerTableEventType.Modified) return;
            var layer = doc.Layers.FindIndex(e.LayerIndex);
            if (layer == null) return;
            foreach (var obj in doc.Objects.FindByLayer(layer)) coalescer?.Changed(obj.Id);
        }

        private void OnSelectionChanged(object? sender, RhinoObjectSelectionEventArgs e) => ScheduleSelection();

        private void OnAllDeselected(object? sender, RhinoDeselectAllObjectsEventArgs e) => ScheduleSelection();

        // --- The first sync, and the batches that follow -----------------------------------------------------------

        private void StartSync(RhinoDoc target)
        {
            jobs.Clear();
            current = null;
            mirrored.Clear();
            heavy.Clear();
            var shown = ShownObjects(target).Where(o => ObjectDescriber.Classify(o) == Kind.Drawn).ToList();
            // Small objects first: the model is recognisable early, and one huge object does not hold the rest back.
            var ordered = shown.OrderBy(o => o.Geometry.GetBoundingBox(true).Diagonal.Length).Select(o => o.Id).ToList();
            if (ordered.Count == 0)
            {
                jobs.Enqueue(new Job { Reset = true, Generation = generation });
            }
            else
            {
                for (var start = 0; start < ordered.Count; start += SyncChunk)
                {
                    var ids = ordered.Skip(start).Take(SyncChunk).ToList();
                    var done = start + ids.Count;
                    jobs.Enqueue(
                        new Job
                        {
                            Ids = ids,
                            Reset = start == 0,
                            Sync = done < ordered.Count ? new SyncProgress { Done = done, Total = ordered.Count } : null,
                            Generation = generation,
                        });
                }
            }

            Pump();
        }

        private void Enqueue(IReadOnlyCollection<Guid> changed, IReadOnlyCollection<Guid> deleted)
        {
            if (doc == null) return;
            var ids = changed.ToList();
            for (var start = 0; start < ids.Count; start += Limits.ObjectsPerBatch)
                jobs.Enqueue(new Job { Ids = ids.Skip(start).Take(Limits.ObjectsPerBatch).ToList(), Generation = generation });
            var gone = deleted.ToList();
            for (var start = 0; start < gone.Count; start += Limits.DeletedPerBatch)
                jobs.Enqueue(new Job { Deleted = gone.Skip(start).Take(Limits.DeletedPerBatch).ToList(), Generation = generation });
            Pump();
        }

        private void Pump()
        {
            if (running) return;
            running = true;
            Step();
        }

        // Works through the queue for at most one slice, then lets Rhino have the thread back until its next idle time.
        private void Step()
        {
            var slice = Stopwatch.StartNew();
            while (true)
            {
                if (current == null)
                {
                    if (jobs.Count == 0)
                    {
                        running = false;
                        return;
                    }

                    current = jobs.Dequeue();
                }

                var job = current;
                if (job.Generation != generation)
                {
                    current = null;
                    continue;
                }

                while (job.Next < job.Ids.Count)
                {
                    Prepare(job, job.Ids[job.Next++]);
                    if (slice.ElapsedMilliseconds < SliceMilliseconds) continue;
                    RhinoApp.Idle += ContinueOnIdle;
                    return;
                }

                Complete(job);
                current = null;
            }
        }

        private void ContinueOnIdle(object? sender, EventArgs e)
        {
            RhinoApp.Idle -= ContinueOnIdle;
            Step();
        }

        private static IEnumerable<RhinoObject> ShownObjects(RhinoDoc target)
        {
            var settings = new ObjectEnumeratorSettings { NormalObjects = true, LockedObjects = true, HiddenObjects = false, DeletedObjects = false };
            return target.Objects.GetObjectList(settings).Where(o => ObjectDescriber.IsShown(target, o));
        }

        private void Prepare(Job job, Guid id)
        {
            if (doc == null) return;
            var obj = doc.Objects.FindId(id);
            if (obj == null || !ObjectDescriber.IsShown(doc, obj) || ObjectDescriber.Classify(obj) != Kind.Drawn)
            {
                // Gone, hidden, or not something the viewer draws; only an object the viewer has needs removing.
                if (mirrored.Remove(id)) job.Deleted.Add(id);
                heavy.Remove(id);
                return;
            }

            var scale = RhinoMath.UnitScale(doc.ModelUnitSystem, UnitSystem.Millimeters);
            var meshed = ObjectMesher.Mesh(obj, scale);
            Guid? asset = null;
            var triangles = 0;
            if (meshed != null)
            {
                triangles = meshed.Triangles;
                if (meshed.TooHeavy)
                {
                    heavy.Add(id);
                }
                else
                {
                    heavy.Remove(id);
                    asset = Guid.NewGuid();
                    job.Uploads.Add(new KeyValuePair<Guid, byte[]>(asset.Value, MeshAssetWriter.Encode(meshed.Parts.ToList())));
                }
            }

            mirrored.Add(id);
            job.Described.Add(ObjectDescriber.Describe(doc, obj, asset, triangles));
        }

        // The job is meshed: count what is not drawn now, then upload the meshes and send the batch, in order.
        private void Complete(Job job)
        {
            if (doc == null) return;
            var notDrawn = CountNotDrawn(doc);
            var batch = new ObjectBatch
            {
                Changed = job.Described,
                Deleted = job.Deleted.Select(g => g.ToString("D")).ToList(),
                NotDrawn = notDrawn,
                Sync = job.Sync,
                Reset = job.Reset,
            };
            var uploadList = job.Uploads;
            var stamp = job.Generation;
            sendChain = sendChain.ContinueWith(_ => UploadAndSend(batch, uploadList, stamp), TaskScheduler.Default).Unwrap();
        }

        private async Task UploadAndSend(ObjectBatch batch, List<KeyValuePair<Guid, byte[]>> list, int stamp)
        {
            if (stamp != generation) return;
            var failed = new HashSet<string>();
            await Task.WhenAll(list.Select(async item =>
            {
                await uploads.WaitAsync().ConfigureAwait(false);
                try
                {
                    if (!await client.UploadMesh(item.Key, item.Value).ConfigureAwait(false)) failed.Add(item.Key.ToString("D"));
                }
                finally
                {
                    uploads.Release();
                }
            })).ConfigureAwait(false);
            // An object whose mesh did not arrive is drawn as its box rather than named by an asset the bridge does not have.
            foreach (var described in batch.Changed.Where(o => o.Asset != null && failed.Contains(o.Asset))) described.Asset = null;
            if (stamp != generation) return;
            // Stamped when sent: the Rhino to HAI time is how long the bridge and the viewer take after this point.
            batch.ChangedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            await client.Send(Wire.Objects, batch).ConfigureAwait(false);
        }

        private NotDrawn CountNotDrawn(RhinoDoc target)
        {
            var counts = new NotDrawn { Heavy = heavy.Count };
            foreach (var obj in ShownObjects(target))
            {
                switch (ObjectDescriber.Classify(obj))
                {
                    case Kind.Curve: counts.Curves++; break;
                    case Kind.Point: counts.Points++; break;
                    case Kind.Annotation: counts.Annotations++; break;
                    case Kind.Other: counts.Other++; break;
                }
            }

            return counts;
        }

        // --- Selection ------------------------------------------------------------------------------------------

        private void ScheduleSelection()
        {
            selectionTimer?.Dispose();
            selectionTimer = new Timer(_ => Ui(SendSelection), null, SelectionDebounce, Timeout.InfiniteTimeSpan);
        }

        private void SendSelection()
        {
            var target = doc;
            if (target == null) return;
            var selected = target.Objects.GetSelectedObjects(false, false)
                .Take(Limits.SelectedObjects)
                .Select(o => new SelectedObject
                {
                    Id = o.Id.ToString("D"),
                    Type = Limits.Clip(o.ObjectType.ToString(), 40),
                    Layer = ObjectDescriber.LayerPath(target, o),
                })
                .ToList();
            _ = client.Send(Wire.Selection, new SelectionChanged { Objects = selected });
        }

        /// <summary>A pick in HAI's viewer: these objects become the selection in Rhino (none clears it).</summary>
        public void SelectFromBridge(IEnumerable<string> ids)
        {
            var target = doc;
            if (target == null) return;
            target.Objects.UnselectAll();
            foreach (var text in ids)
                if (Guid.TryParse(text, out var id)) target.Objects.Select(id);
            target.Views.Redraw();
        }

        private static void Ui(Action action) => RhinoApp.InvokeOnUiThread(action);
    }
}
