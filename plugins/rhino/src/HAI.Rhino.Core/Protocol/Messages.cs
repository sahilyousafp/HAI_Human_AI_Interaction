using System.Collections.Generic;
using Newtonsoft.Json;

namespace HAI.Rhino.Core.Protocol
{
    /// <summary>The names and numbers of the wire protocol (packages/protocol/src/envelope.ts and messages.ts).</summary>
    public static class Wire
    {
        public const int ProtocolVersion = 1;
        public const string Path = "/ws";
        public const string Subprotocol = "hai.v1";
        public const string TokenSubprotocolPrefix = "hai.token.";

        public const string Hello = "hello";
        public const string Status = "rhino.status";
        public const string Objects = "rhino.objects";
        public const string Selection = "rhino.selection";
        public const string PythonResult = "rhino.python.result";
        public const string PythonRun = "rhino.python.run";
        public const string Select = "rhino.select";
        public const string Open = "rhino.open";
    }

    /// <summary>Whether Rhino can run Python 3 for the agent: ready, or unavailable with the reason.</summary>
    public sealed class PythonStatus
    {
        [JsonProperty("state")] public string State { get; set; } = "ready";

        [JsonProperty("reason", NullValueHandling = NullValueHandling.Ignore)]
        public string? Reason { get; set; }

        public static PythonStatus Ready() => new PythonStatus { State = "ready" };

        public static PythonStatus Unavailable(string reason) =>
            new PythonStatus { State = "unavailable", Reason = Limits.Clip(reason, 500) };
    }

    /// <summary>What the plugin tells the bridge about itself when it connects.</summary>
    public sealed class Hello
    {
        [JsonProperty("client")] public string Client { get; set; } = "rhino";
        [JsonProperty("protocolVersion")] public int ProtocolVersion { get; set; } = Wire.ProtocolVersion;
        [JsonProperty("rhinoVersion")] public string RhinoVersion { get; set; } = "";
        [JsonProperty("pluginVersion")] public string PluginVersion { get; set; } = "";
        [JsonProperty("python")] public PythonStatus Python { get; set; } = PythonStatus.Ready();

        /// <summary>The open document's name, or null for an unsaved one.</summary>
        [JsonProperty("document")] public string? Document { get; set; }
    }

    /// <summary>The Python status or the open document changed.</summary>
    public sealed class StatusChanged
    {
        [JsonProperty("python")] public PythonStatus Python { get; set; } = PythonStatus.Ready();
        [JsonProperty("document")] public string? Document { get; set; }
    }

    public sealed class Bounds
    {
        /// <summary>Millimetres, Z up.</summary>
        [JsonProperty("min")] public double[] Min { get; set; } = new double[3];

        [JsonProperty("max")] public double[] Max { get; set; } = new double[3];
    }

    /// <summary>One Rhino object as the viewer needs it (packages/protocol/src/rhino.ts, RhinoObject).</summary>
    public sealed class RhinoObjectInfo
    {
        /// <summary>The Rhino object id (a GUID).</summary>
        [JsonProperty("id")] public string Id { get; set; } = "";

        [JsonProperty("name")] public string Name { get; set; } = "";

        /// <summary>brep, extrusion, mesh, surface or subd.</summary>
        [JsonProperty("type")] public string Type { get; set; } = "mesh";

        /// <summary>The layer's full path, "Parent::Child".</summary>
        [JsonProperty("layer")] public string Layer { get; set; } = "";

        /// <summary>The display colour as #rrggbb, or null to use the layer's.</summary>
        [JsonProperty("color")] public string? Color { get; set; }

        [JsonProperty("bounds")] public Bounds Bounds { get; set; } = new Bounds();

        /// <summary>The mesh asset's id, or null for an object too heavy to mirror in full (drawn as its box).</summary>
        [JsonProperty("asset")] public string? Asset { get; set; }

        [JsonProperty("triangles")] public int Triangles { get; set; }

        /// <summary>The object's "hai." user strings.</summary>
        [JsonProperty("tags")] public Dictionary<string, string> Tags { get; set; } = new Dictionary<string, string>();
    }

    /// <summary>What the viewer does not draw, so a missing object is explained.</summary>
    public sealed class NotDrawn
    {
        [JsonProperty("curves")] public int Curves { get; set; }
        [JsonProperty("points")] public int Points { get; set; }
        [JsonProperty("annotations")] public int Annotations { get; set; }
        [JsonProperty("other")] public int Other { get; set; }

        /// <summary>Objects drawn as their bounding box because they are over the triangle cap.</summary>
        [JsonProperty("heavy")] public int Heavy { get; set; }
    }

    public sealed class SyncProgress
    {
        [JsonProperty("done")] public int Done { get; set; }
        [JsonProperty("total")] public int Total { get; set; }
    }

    /// <summary>A batch of changes in the document: what to add or replace, and what to remove.</summary>
    public sealed class ObjectBatch
    {
        [JsonProperty("changed")] public List<RhinoObjectInfo> Changed { get; set; } = new List<RhinoObjectInfo>();
        [JsonProperty("deleted")] public List<string> Deleted { get; set; } = new List<string>();
        [JsonProperty("notDrawn")] public NotDrawn NotDrawn { get; set; } = new NotDrawn();

        /// <summary>Set during the first sync of a document, null once every object is in.</summary>
        [JsonProperty("sync")] public SyncProgress? Sync { get; set; }

        /// <summary>True for the first batch of a document: everything held so far is dropped first.</summary>
        [JsonProperty("reset")] public bool Reset { get; set; }

        /// <summary>When the plugin sent it (epoch milliseconds), so the web app can measure how long a change took to be drawn.</summary>
        [JsonProperty("changedAt")] public long ChangedAt { get; set; }
    }

    public sealed class SelectedObject
    {
        [JsonProperty("id")] public string Id { get; set; } = "";
        [JsonProperty("type")] public string Type { get; set; } = "";
        [JsonProperty("layer")] public string Layer { get; set; } = "";
    }

    /// <summary>The selection in Rhino changed.</summary>
    public sealed class SelectionChanged
    {
        [JsonProperty("objects")] public List<SelectedObject> Objects { get; set; } = new List<SelectedObject>();
    }

    /// <summary>The result of a Python run in Rhino; output is capped by <see cref="HAI.Rhino.Core.Python.PythonResultShaper"/>.</summary>
    public sealed class PythonResult
    {
        [JsonProperty("id")] public string Id { get; set; } = "";
        [JsonProperty("ok")] public bool Ok { get; set; }
        [JsonProperty("stdout")] public string Stdout { get; set; } = "";

        [JsonProperty("result", NullValueHandling = NullValueHandling.Ignore)]
        public string? Result { get; set; }

        [JsonProperty("error", NullValueHandling = NullValueHandling.Ignore)]
        public string? Error { get; set; }

        [JsonProperty("durationMs")] public double DurationMs { get; set; }
    }

    /// <summary>Bridge to Rhino: run a Python script in the open document.</summary>
    public sealed class PythonRunRequest
    {
        [JsonProperty("id")] public string Id { get; set; } = "";
        [JsonProperty("code")] public string Code { get; set; } = "";
        [JsonProperty("timeoutMs")] public int TimeoutMs { get; set; }
    }

    /// <summary>Bridge to Rhino: select these objects (a pick in the viewer). Empty clears the selection.</summary>
    public sealed class SelectRequest
    {
        [JsonProperty("ids")] public List<string> Ids { get; set; } = new List<string>();
    }

    /// <summary>Bridge to Rhino: open this file (an absolute path the bridge has checked).</summary>
    public sealed class OpenRequest
    {
        [JsonProperty("path")] public string Path { get; set; } = "";
    }

    /// <summary>Limits the bridge's schemas enforce, applied here so the plugin never sends a message it would refuse.</summary>
    public static class Limits
    {
        public const int ObjectName = 200;
        public const int LayerPath = 400;
        public const int TagKey = 64;
        public const int TagValue = 200;
        public const int TagsPerObject = 20;
        public const int ObjectsPerBatch = 500;
        public const int DeletedPerBatch = 2000;
        public const int SelectedObjects = 2000;
        public const int DocumentName = 260;

        public static string Clip(string text, int max) =>
            text.Length <= max ? text : text.Substring(0, max - 1) + "…";
    }
}
