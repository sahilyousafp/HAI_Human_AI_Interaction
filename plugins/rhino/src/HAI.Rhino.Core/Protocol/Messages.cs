using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace HAI.Rhino.Core.Protocol
{
    /// <summary>The names and numbers of the wire protocol (packages/protocol/src/envelope.ts, host.ts and messages.ts).</summary>
    public static class Wire
    {
        public const int ProtocolVersion = 2;
        public const string Path = "/ws";
        public const string Subprotocol = "hai.v1";
        public const string TokenSubprotocolPrefix = "hai.token.";

        /// <summary>The host this connector is, on every message it sends.</summary>
        public const string HostId = "rhino";

        public const string Hello = "hello";

        // Connector to bridge.
        public const string Status = "host.status";
        public const string Objects = "host.objects";
        public const string Selection = "host.selection";
        public const string RunResult = "host.result";
        public const string Captured = "host.captured";
        public const string ImagePlaced = "host.image.placed";
        public const string ApiResult = "host.api.result";
        public const string Described = "host.described";

        // Bridge to connector.
        public const string Refused = "host.refused";
        public const string Run = "host.run";
        public const string Select = "host.select";
        public const string Open = "host.open";
        public const string Undo = "host.undo";
        public const string Capture = "host.capture";
        public const string ImagePlace = "host.image.place";
        public const string Api = "host.api";
        public const string Describe = "host.describe";
    }

    /// <summary>Whether the agent can run code in Rhino now: ready, or unavailable with the reason.</summary>
    public sealed class RunStatus
    {
        [JsonProperty("state")] public string State { get; set; } = "ready";

        [JsonProperty("reason", NullValueHandling = NullValueHandling.Ignore)]
        public string? Reason { get; set; }

        public static RunStatus Ready() => new RunStatus { State = "ready" };

        public static RunStatus Unavailable(string reason) =>
            new RunStatus { State = "unavailable", Reason = Limits.Clip(reason, 500) };
    }

    /// <summary>The application on this end: "Rhino 8" and its full version.</summary>
    public sealed class AppInfo
    {
        [JsonProperty("name")] public string Name { get; set; } = "Rhino";
        [JsonProperty("version")] public string Version { get; set; } = "";
    }

    /// <summary>What this connector can do for the agent.</summary>
    public sealed class Capabilities
    {
        [JsonProperty("languages")] public List<string> Languages { get; set; } = new List<string> { "python" };
        [JsonProperty("capture")] public bool Capture { get; set; } = true;
        [JsonProperty("placeImage")] public bool PlaceImage { get; set; } = true;
        [JsonProperty("apiLookup")] public bool ApiLookup { get; set; } = true;
        [JsonProperty("describe")] public bool Describe { get; set; } = true;
    }

    /// <summary>What the connector tells the bridge about itself when it connects.</summary>
    public sealed class Hello
    {
        [JsonProperty("client")] public string Client { get; set; } = Wire.HostId;
        [JsonProperty("protocolVersion")] public int ProtocolVersion { get; set; } = Wire.ProtocolVersion;
        [JsonProperty("app")] public AppInfo App { get; set; } = new AppInfo();
        [JsonProperty("connectorVersion")] public string ConnectorVersion { get; set; } = "";
        [JsonProperty("run")] public RunStatus Run { get; set; } = RunStatus.Ready();

        /// <summary>The open document's name, or null for an unsaved one.</summary>
        [JsonProperty("document")] public string? Document { get; set; }

        [JsonProperty("capabilities")] public Capabilities Capabilities { get; set; } = new Capabilities();
    }

    /// <summary>The bridge will not take this connector (it is built for an older protocol).</summary>
    public sealed class Refused
    {
        [JsonProperty("reason")] public string Reason { get; set; } = "";
    }

    /// <summary>The run status or the open document changed.</summary>
    public sealed class StatusChanged
    {
        [JsonProperty("host")] public string Host { get; set; } = Wire.HostId;
        [JsonProperty("run")] public RunStatus Run { get; set; } = RunStatus.Ready();
        [JsonProperty("document")] public string? Document { get; set; }
    }

    public sealed class Bounds
    {
        /// <summary>Millimetres, Z up.</summary>
        [JsonProperty("min")] public double[] Min { get; set; } = new double[3];

        [JsonProperty("max")] public double[] Max { get; set; } = new double[3];
    }

    /// <summary>One object as the viewer needs it (packages/protocol/src/host.ts, HostObject).</summary>
    public sealed class HostObjectInfo
    {
        /// <summary>The Rhino object id (a GUID).</summary>
        [JsonProperty("id")] public string Id { get; set; } = "";

        [JsonProperty("name")] public string Name { get; set; } = "";

        /// <summary>brep, extrusion, mesh, surface, subd or block.</summary>
        [JsonProperty("type")] public string Type { get; set; } = "mesh";

        /// <summary>The layer's full path, "Parent::Child".</summary>
        [JsonProperty("layer")] public string Layer { get; set; } = "";

        /// <summary>The display colour as #rrggbb, or null to use the layer's.</summary>
        [JsonProperty("color")] public string? Color { get; set; }

        [JsonProperty("bounds")] public Bounds Bounds { get; set; } = new Bounds();

        /// <summary>The mesh asset's id, or null for an object too heavy to mirror in full (drawn as its box).</summary>
        [JsonProperty("asset")] public string? Asset { get; set; }

        [JsonProperty("triangles")] public int Triangles { get; set; }

        /// <summary>A block's placement: where its shared asset goes, row by row, millimetres. Absent for anything else.</summary>
        [JsonProperty("transform", NullValueHandling = NullValueHandling.Ignore)]
        public double[]? Transform { get; set; }

        /// <summary>A block's colour per part of its asset; null where a part takes this object's own colour.</summary>
        [JsonProperty("partColors", NullValueHandling = NullValueHandling.Ignore)]
        public List<string?>? PartColors { get; set; }

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

        /// <summary>Placed blocks drawn, but with less detail, because the model is too heavy to draw in full.</summary>
        [JsonProperty("simplified")] public int Simplified { get; set; }
    }

    public sealed class SyncProgress
    {
        [JsonProperty("done")] public int Done { get; set; }
        [JsonProperty("total")] public int Total { get; set; }
    }

    /// <summary>A batch of changes in the document: what to add or replace, and what to remove.</summary>
    public sealed class ObjectBatch
    {
        [JsonProperty("host")] public string Host { get; set; } = Wire.HostId;
        [JsonProperty("changed")] public List<HostObjectInfo> Changed { get; set; } = new List<HostObjectInfo>();
        [JsonProperty("deleted")] public List<string> Deleted { get; set; } = new List<string>();
        [JsonProperty("notDrawn")] public NotDrawn NotDrawn { get; set; } = new NotDrawn();

        /// <summary>Set during the first sync of a document, null once every object is in.</summary>
        [JsonProperty("sync")] public SyncProgress? Sync { get; set; }

        /// <summary>True for the first batch of a document: everything held so far is dropped first.</summary>
        [JsonProperty("reset")] public bool Reset { get; set; }

        /// <summary>When the connector sent it (epoch milliseconds), so the web app can measure how long a change took to be drawn.</summary>
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
        [JsonProperty("host")] public string Host { get; set; } = Wire.HostId;
        [JsonProperty("objects")] public List<SelectedObject> Objects { get; set; } = new List<SelectedObject>();
    }

    /// <summary>The result of a run in Rhino; output is capped by <see cref="HAI.Rhino.Core.Python.PythonResultShaper"/>.</summary>
    public sealed class RunResult
    {
        [JsonProperty("host")] public string Host { get; set; } = Wire.HostId;
        [JsonProperty("id")] public string Id { get; set; } = "";
        [JsonProperty("ok")] public bool Ok { get; set; }
        [JsonProperty("stdout")] public string Stdout { get; set; } = "";

        [JsonProperty("result", NullValueHandling = NullValueHandling.Ignore)]
        public string? Result { get; set; }

        [JsonProperty("error", NullValueHandling = NullValueHandling.Ignore)]
        public string? Error { get; set; }

        [JsonProperty("durationMs")] public double DurationMs { get; set; }

        /// <summary>What the run added, changed and deleted; absent when the document could not be compared.</summary>
        [JsonProperty("changes", NullValueHandling = NullValueHandling.Ignore)]
        public RunChanges? Changes { get; set; }
    }

    /// <summary>One object a script added, changed or deleted, as far as the bridge needs it to compare with a claim.</summary>
    public sealed class ObjectChange
    {
        [JsonProperty("id")] public string Id { get; set; } = "";
        [JsonProperty("name")] public string Name { get; set; } = "";

        /// <summary>The object's "hai." user strings (a deleted object's as they were).</summary>
        [JsonProperty("tags")] public Dictionary<string, string> Tags { get; set; } = new Dictionary<string, string>();

        /// <summary>Where it is (a deleted object's as it was); null when it has no box.</summary>
        [JsonProperty("bounds")] public Bounds? Bounds { get; set; }
    }

    /// <summary>What a script did to the document, found by comparing every object before and after the run.</summary>
    public sealed class RunChanges
    {
        [JsonProperty("added")] public List<ObjectChange> Added { get; set; } = new List<ObjectChange>();
        [JsonProperty("changed")] public List<ObjectChange> Changed { get; set; } = new List<ObjectChange>();
        [JsonProperty("deleted")] public List<ObjectChange> Deleted { get; set; } = new List<ObjectChange>();

        /// <summary>More objects changed than are listed.</summary>
        [JsonProperty("truncated")] public bool Truncated { get; set; }
    }

    /// <summary>The viewport as a PNG the connector uploaded to the bridge's capture store, or why it could not.</summary>
    public sealed class Captured
    {
        [JsonProperty("host")] public string Host { get; set; } = Wire.HostId;
        [JsonProperty("id")] public string Id { get; set; } = "";
        [JsonProperty("ok")] public bool Ok { get; set; }

        [JsonProperty("asset", NullValueHandling = NullValueHandling.Ignore)]
        public string? Asset { get; set; }

        [JsonProperty("error", NullValueHandling = NullValueHandling.Ignore)]
        public string? Error { get; set; }

        [JsonProperty("durationMs")] public double DurationMs { get; set; }
    }

    /// <summary>The picture frame placed, or why not.</summary>
    public sealed class ImagePlaced
    {
        [JsonProperty("host")] public string Host { get; set; } = Wire.HostId;
        [JsonProperty("id")] public string Id { get; set; } = "";
        [JsonProperty("ok")] public bool Ok { get; set; }

        [JsonProperty("objectId", NullValueHandling = NullValueHandling.Ignore)]
        public string? ObjectId { get; set; }

        [JsonProperty("error", NullValueHandling = NullValueHandling.Ignore)]
        public string? Error { get; set; }
    }

    /// <summary>One type or member of RhinoCommon, found by reflection inside the running Rhino.</summary>
    public sealed class ApiEntry
    {
        /// <summary>The full name, "Rhino.Geometry.Brep.CreateFromLoft".</summary>
        [JsonProperty("name")] public string Name { get; set; } = "";

        /// <summary>type, method, property, field or event.</summary>
        [JsonProperty("kind")] public string Kind { get; set; } = "method";

        [JsonProperty("signature")] public string Signature { get; set; } = "";

        [JsonProperty("summary", NullValueHandling = NullValueHandling.Ignore)]
        public string? Summary { get; set; }
    }

    public sealed class ApiResult
    {
        [JsonProperty("host")] public string Host { get; set; } = Wire.HostId;
        [JsonProperty("id")] public string Id { get; set; } = "";
        [JsonProperty("entries")] public List<ApiEntry> Entries { get; set; } = new List<ApiEntry>();

        /// <summary>More entries matched than are listed.</summary>
        [JsonProperty("truncated")] public bool Truncated { get; set; }

        /// <summary>The index is still being built: these are the entries indexed so far.</summary>
        [JsonProperty("partial")] public bool Partial { get; set; }
    }

    /// <summary>How big a component is; only what applies is written.</summary>
    public sealed class Quantities
    {
        [JsonProperty("areaMm2", NullValueHandling = NullValueHandling.Ignore)]
        public double? AreaMm2 { get; set; }

        [JsonProperty("volumeMm3", NullValueHandling = NullValueHandling.Ignore)]
        public double? VolumeMm3 { get; set; }

        [JsonProperty("lengthMm", NullValueHandling = NullValueHandling.Ignore)]
        public double? LengthMm { get; set; }
    }

    /// <summary>One component as Rhino describes it (packages/protocol/src/host.ts, HostComponent).</summary>
    public sealed class Component
    {
        [JsonProperty("id")] public string Id { get; set; } = "";
        [JsonProperty("name")] public string Name { get; set; } = "";

        /// <summary>Rhino's own word for it: "Closed Brep", "Open Surface", "Block: Tree".</summary>
        [JsonProperty("type")] public string Type { get; set; } = "";

        [JsonProperty("layer")] public string Layer { get; set; } = "";
        [JsonProperty("bounds")] public Bounds? Bounds { get; set; }
        [JsonProperty("quantities")] public Quantities Quantities { get; set; } = new Quantities();

        /// <summary>Quantities were left out because working them out took too long.</summary>
        [JsonProperty("quantitiesSkipped")] public bool QuantitiesSkipped { get; set; }

        [JsonProperty("material")] public string? Material { get; set; }

        /// <summary>Every user string of the object (not only "hai." ones): at most 100, values at most 200 characters.</summary>
        [JsonProperty("properties")] public Dictionary<string, string> Properties { get; set; } = new Dictionary<string, string>();
    }

    public sealed class Described
    {
        [JsonProperty("host")] public string Host { get; set; } = Wire.HostId;
        [JsonProperty("id")] public string Id { get; set; } = "";
        [JsonProperty("components")] public List<Component> Components { get; set; } = new List<Component>();
    }

    /// <summary>Bridge to Rhino: run a script in the open document.</summary>
    public sealed class RunRequest
    {
        [JsonProperty("id")] public string Id { get; set; } = "";

        /// <summary>Always "python" for Rhino.</summary>
        [JsonProperty("language")] public string Language { get; set; } = "python";

        [JsonProperty("code")] public string Code { get; set; } = "";
        [JsonProperty("timeoutMs")] public int TimeoutMs { get; set; }

        /// <summary>The agent that asked and the run's title: they name the undo step.</summary>
        [JsonProperty("agent", NullValueHandling = NullValueHandling.Ignore)] public string? Agent { get; set; }

        [JsonProperty("title", NullValueHandling = NullValueHandling.Ignore)] public string? Title { get; set; }

        /// <summary>The part the agent's task works on: objects the run adds are stamped "hai.part" with it.</summary>
        [JsonProperty("part", NullValueHandling = NullValueHandling.Ignore)] public string? Part { get; set; }

        /// <summary>What the agent's task may change, as the bridge sent it; the connector does not interpret it.</summary>
        [JsonProperty("claim", NullValueHandling = NullValueHandling.Ignore)] public JToken? Claim { get; set; }
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

    /// <summary>Bridge to Rhino: capture the viewport, a named view or the active one, at this size.</summary>
    public sealed class CaptureRequest
    {
        [JsonProperty("id")] public string Id { get; set; } = "";

        /// <summary>perspective, top, bottom, front, back, left or right; null for the active view.</summary>
        [JsonProperty("view")] public string? View { get; set; }

        [JsonProperty("width")] public int Width { get; set; }
        [JsonProperty("height")] public int Height { get; set; }
    }

    /// <summary>Bridge to Rhino: place this image (an absolute path the bridge has checked) on a plane, embedded.</summary>
    public sealed class ImagePlaceRequest
    {
        [JsonProperty("id")] public string Id { get; set; } = "";
        [JsonProperty("path")] public string Path { get; set; } = "";

        /// <summary>The picture's centre, millimetres.</summary>
        [JsonProperty("origin")] public double[] Origin { get; set; } = new double[3];

        /// <summary>The direction the picture faces.</summary>
        [JsonProperty("normal")] public double[] Normal { get; set; } = { 0, 0, 1 };

        [JsonProperty("widthMm")] public double WidthMm { get; set; }

        /// <summary>Null to keep the image's own proportions.</summary>
        [JsonProperty("heightMm")] public double? HeightMm { get; set; }

        [JsonProperty("agent")] public string? Agent { get; set; }
        [JsonProperty("title")] public string? Title { get; set; }
    }

    public sealed class ApiRequest
    {
        [JsonProperty("id")] public string Id { get; set; } = "";
        [JsonProperty("query")] public string Query { get; set; } = "";
    }

    public sealed class DescribeRequest
    {
        [JsonProperty("id")] public string Id { get; set; } = "";
        [JsonProperty("ids")] public List<string> Ids { get; set; } = new List<string>();
    }

    /// <summary>Limits the bridge's schemas enforce, applied here so the connector never sends a message it would refuse.</summary>
    public static class Limits
    {
        public const int ObjectName = 200;
        public const int LayerPath = 400;
        public const int TagKey = 64;
        public const int TagValue = 200;
        public const int TagsPerObject = 20;
        public const int PartsPerObject = 64;
        public const int ObjectsPerBatch = 500;
        public const int DeletedPerBatch = 2000;
        public const int SelectedObjects = 2000;
        public const int DocumentName = 260;
        public const int DescribedComponents = 50;
        public const int PropertiesPerComponent = 100;
        public const int PropertyKey = 120;
        public const int PropertyValue = 200;
        public const int ComponentType = 200;
        public const int ApiEntries = 50;
        public const int ApiName = 300;
        public const int ApiSignature = 1000;
        public const int ApiSummary = 1000;
        public const int Error = 2000;

        public static string Clip(string text, int max) =>
            text.Length <= max ? text : text.Substring(0, max - 1) + "…";
    }
}
