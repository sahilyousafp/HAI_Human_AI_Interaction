using System.Collections.Generic;
using HAI.Rhino.Core.Protocol;
using Newtonsoft.Json.Linq;
using Xunit;

namespace HAI.Rhino.Core.Tests
{
    public class CodecTests
    {
        private const string Id = "message-1";

        private static Hello AHello(RunStatus run, string? document) =>
            new Hello
            {
                App = new AppInfo { Name = "Rhino 8", Version = "8.36.25180.15001" },
                ConnectorVersion = "0.2.0",
                Run = run,
                Document = document,
            };

        [Fact]
        public void HelloAsRhinoWithEverythingItCanDo()
        {
            var json = Codec.Write(Wire.Hello, AHello(RunStatus.Ready(), "tower.3dm"), Id);
            Golden.Json("message-hello.json", json);
            var payload = JObject.Parse(json)["payload"]!;
            Assert.Equal("rhino", (string?)payload["client"]);
            Assert.Equal(2, (int)payload["protocolVersion"]!);
            Assert.Equal("python", (string?)payload["capabilities"]!["languages"]![0]);
        }

        [Fact]
        public void HelloWithRunUnavailableAndAnUnsavedDocument()
        {
            var json = Codec.Write(Wire.Hello, AHello(RunStatus.Unavailable("Rhino has no Python 3 runtime yet"), null), Id);
            Golden.Json("message-hello-run-unavailable.json", json);
            Assert.Equal(JTokenType.Null, JObject.Parse(json)["payload"]!["document"]!.Type);
        }

        [Fact]
        public void EveryMessageTheConnectorSendsNamesItsHost()
        {
            foreach (var payload in new object[]
                     {
                         new StatusChanged(), new ObjectBatch(), new SelectionChanged(), new RunResult(), new Captured(),
                         new ImagePlaced(), new ApiResult(), new Described(),
                     })
            {
                Assert.Equal("rhino", (string?)JObject.Parse(Codec.Write("x", payload, Id))["payload"]!["host"]);
            }
        }

        [Fact]
        public void ABatchWritesNullColourAndAssetBecauseTheBridgeRequiresThem()
        {
            var batch = new ObjectBatch
            {
                Reset = true,
                ChangedAt = 1_792_790_022_951,
                Sync = new SyncProgress { Done = 2, Total = 40 },
                NotDrawn = new NotDrawn { Curves = 12, Annotations = 1, Heavy = 1, Simplified = 40 },
                Changed =
                {
                    new HostObjectInfo
                    {
                        Id = "7f1c0b0e-3f0a-4a53-9d0e-5d3f1c9a1b11",
                        Name = "Canopy",
                        Type = "brep",
                        Layer = "Roof::Canopy",
                        Color = "#3c6ec8",
                        Bounds = new Bounds { Min = new[] { 0.0, 0.0, 3000.0 }, Max = new[] { 6000.0, 6000.0, 3900.0 } },
                        Asset = "0f8fad5b-d9cb-469f-a165-70867728950e",
                        Triangles = 1152,
                        Tags = new Dictionary<string, string> { ["hai.owner"] = "architect" },
                    },
                    new HostObjectInfo
                    {
                        Id = "a2d4c6e8-0000-4000-8000-000000000002",
                        Name = "",
                        Type = "mesh",
                        Layer = "Default",
                        Color = null,
                        Bounds = new Bounds { Min = new[] { -1.5, 0.0, 0.0 }, Max = new[] { 1.5, 2.0, 4.0 } },
                        Asset = null,
                        Triangles = 0,
                    },
                    new HostObjectInfo
                    {
                        Id = "b3e5d7f9-0000-4000-8000-000000000003",
                        Name = "Tree",
                        Type = "block",
                        Layer = "Garden",
                        Color = "#325023",
                        Bounds = new Bounds { Min = new[] { 9000.0, 0.0, 0.0 }, Max = new[] { 13000.0, 4000.0, 6000.0 } },
                        Asset = "1f8fad5b-d9cb-469f-a165-70867728950e",
                        Triangles = 800,
                        Transform = new[] { 1.0, 0, 0, 11000, 0, 1, 0, 2000, 0, 0, 1, 0, 0, 0, 0, 1 },
                        PartColors = new List<string?> { "#463223", null },
                    },
                },
                Deleted = { "b3e5d7f9-0000-4000-8000-000000000003" },
            };
            var json = Codec.Write(Wire.Objects, batch, Id);
            Golden.Json("message-objects.json", json);
            var changed = JObject.Parse(json)["payload"]!["changed"]!;
            Assert.Equal(JTokenType.Null, changed[1]!["color"]!.Type);
            Assert.Equal(JTokenType.Null, changed[1]!["asset"]!.Type);
        }

        [Fact]
        public void ABatchOutsideASyncWritesNullSync()
        {
            var json = Codec.Write(Wire.Objects, new ObjectBatch { ChangedAt = 5 }, Id);
            Assert.Equal(JTokenType.Null, JObject.Parse(json)["payload"]!["sync"]!.Type);
        }

        [Fact]
        public void SelectionAndStatus()
        {
            Golden.Json(
                "message-selection.json",
                Codec.Write(
                    Wire.Selection,
                    new SelectionChanged
                    {
                        Objects = { new SelectedObject { Id = "7f1c0b0e-3f0a-4a53-9d0e-5d3f1c9a1b11", Type = "brep", Layer = "Roof" } },
                    },
                    Id));
            Golden.Json(
                "message-status.json",
                Codec.Write(
                    Wire.Status,
                    new StatusChanged { Run = RunStatus.Unavailable("no engine"), Document = "tower.3dm" },
                    Id));
        }

        [Fact]
        public void RunResultsLeaveOutWhatTheScriptDidNotSet()
        {
            var ok = Codec.Write(
                Wire.RunResult,
                new RunResult { Id = "run-1", Ok = true, Stdout = "42\n", Result = "{\"a\": 1}", DurationMs = 12.5 },
                Id);
            Golden.Json("message-run-result.json", ok);
            var failed = Codec.Write(
                Wire.RunResult,
                new RunResult { Id = "run-2", Ok = false, Stdout = "", Error = "NameError: name x is not defined", DurationMs = 3 },
                Id);
            Golden.Json("message-run-error.json", failed);
            Assert.False(((JObject)JObject.Parse(ok)["payload"]!).ContainsKey("error"));
            Assert.False(((JObject)JObject.Parse(failed)["payload"]!).ContainsKey("result"));
        }

        [Fact]
        public void WritesWhatARunChangedWithTheResult()
        {
            var changes = new RunChanges
            {
                Added = { new ObjectChange { Id = "a-1", Name = "Surface 1", Tags = { ["hai.owner"] = "architect", ["hai.part"] = "dome" }, Bounds = new Bounds { Min = new double[] { 0, 0, 0 }, Max = new double[] { 1000, 1000, 10 } } } },
                Changed = { new ObjectChange { Id = "c-1", Name = "Dome", Tags = { ["hai.part"] = "dome" } } },
                Deleted = { new ObjectChange { Id = "d-1", Name = "Old wall" } },
            };
            var json = Codec.Write(
                Wire.RunResult,
                new RunResult { Id = "run-3", Ok = true, Stdout = "", DurationMs = 7, Changes = changes },
                Id);
            Golden.Json("message-run-result-changes.json", json);
            var plain = JObject.Parse(Codec.Write(Wire.RunResult, new RunResult { Id = "run-4", Ok = true, DurationMs = 1 }, Id));
            Assert.False(((JObject)plain["payload"]!).ContainsKey("changes"));
        }

        [Fact]
        public void CapturesAnswerWithTheAssetOrWhyNot()
        {
            Golden.Json(
                "message-captured.json",
                Codec.Write(
                    Wire.Captured,
                    new Captured { Id = "capture-1", Ok = true, Asset = "2f8fad5b-d9cb-469f-a165-70867728950e", DurationMs = 640 },
                    Id));
            var failed = Codec.Write(Wire.Captured, new Captured { Id = "capture-2", Ok = false, Error = "No active view.", DurationMs = 2 }, Id);
            Golden.Json("message-capture-failed.json", failed);
            Assert.False(((JObject)JObject.Parse(failed)["payload"]!).ContainsKey("asset"));
        }

        [Fact]
        public void APlacedImageAnApiAnswerAndADescription()
        {
            Golden.Json(
                "message-image-placed.json",
                Codec.Write(Wire.ImagePlaced, new ImagePlaced { Id = "image-1", Ok = true, ObjectId = "c4e6a8b0-0000-4000-8000-000000000004" }, Id));
            Golden.Json(
                "message-api-result.json",
                Codec.Write(
                    Wire.ApiResult,
                    new ApiResult
                    {
                        Id = "api-1",
                        Entries =
                        {
                            new ApiEntry
                            {
                                Name = "Rhino.Geometry.Brep.CreateFromLoft",
                                Kind = "method",
                                Signature = "static Brep[] CreateFromLoft(IEnumerable<Curve> curves, Point3d start, Point3d end, LoftType loftType, bool closed)",
                                Summary = "Constructs one or more Breps by lofting through a set of curves.",
                            },
                        },
                    },
                    Id));
            Golden.Json(
                "message-described.json",
                Codec.Write(
                    Wire.Described,
                    new Described
                    {
                        Id = "describe-1",
                        Components =
                        {
                            new Component
                            {
                                Id = "7f1c0b0e-3f0a-4a53-9d0e-5d3f1c9a1b11",
                                Name = "Canopy",
                                Type = "Closed Brep",
                                Layer = "Roof::Canopy",
                                Bounds = new Bounds { Min = new[] { 0.0, 0.0, 3000.0 }, Max = new[] { 6000.0, 6000.0, 3900.0 } },
                                Quantities = new Quantities { AreaMm2 = 7.92e7, VolumeMm3 = 3.24e10 },
                                Material = "Timber",
                                Properties = { ["hai.part"] = "canopy", ["fireRating"] = "60" },
                            },
                            new Component
                            {
                                Id = "a2d4c6e8-0000-4000-8000-000000000002",
                                Name = "",
                                Type = "Open Mesh",
                                Layer = "Default",
                                QuantitiesSkipped = true,
                            },
                        },
                    },
                    Id));
        }

        [Fact]
        public void ReadsARunRequestFromTheBridge()
        {
            var incoming = Codec.Read(Golden.Read("bridge-run.json"));
            Assert.NotNull(incoming);
            Assert.Equal(Wire.Run, incoming!.Type);
            var run = incoming.As<RunRequest>();
            Assert.Equal("run-1", run!.Id);
            Assert.Equal("python", run.Language);
            Assert.Equal("# r: ladybug-core\nimport Rhino\nprint(1)\nresult = 42\n", run.Code);
            Assert.Equal(60000, run.TimeoutMs);
        }

        [Fact]
        public void ReadsARunRequestThatNamesTheAgentItsPartAndItsClaim()
        {
            var run = Codec.Read(Golden.Read("bridge-run-claimed.json"))!.As<RunRequest>()!;
            Assert.Equal("architect", run.Agent);
            Assert.Equal("Add the dome", run.Title);
            Assert.Equal("dome", run.Part);
            Assert.Equal("dome", (string?)run.Claim!["part"]);
            var plain = Codec.Read(Golden.Read("bridge-run.json"))!.As<RunRequest>()!;
            Assert.Null(plain.Agent);
            Assert.Null(plain.Claim);
        }

        [Fact]
        public void ReadsAnUndoRequest()
        {
            Assert.Equal(Wire.Undo, Codec.Read(Golden.Read("bridge-undo.json"))!.Type);
        }

        [Fact]
        public void ReadsSelectAndOpenRequests()
        {
            var select = Codec.Read(Golden.Read("bridge-select.json"))!;
            Assert.Equal(
                new List<string> { "7f1c0b0e-3f0a-4a53-9d0e-5d3f1c9a1b11", "a2d4c6e8-0000-4000-8000-000000000002" },
                select.As<SelectRequest>()!.Ids);
            Assert.Empty(Codec.Read(Golden.Read("bridge-select-clear.json"))!.As<SelectRequest>()!.Ids);
            Assert.Equal("C:\\Users\\sahil\\project\\box.3dm", Codec.Read(Golden.Read("bridge-open.json"))!.As<OpenRequest>()!.Path);
        }

        [Fact]
        public void ReadsCaptureRequestsForANamedViewAndForTheActiveOne()
        {
            var top = Codec.Read(Golden.Read("bridge-capture.json"))!;
            Assert.Equal(Wire.Capture, top.Type);
            var request = top.As<CaptureRequest>()!;
            Assert.Equal(("capture-1", "top", 1280, 720), (request.Id, request.View, request.Width, request.Height));
            Assert.Null(Codec.Read(Golden.Read("bridge-capture-active.json"))!.As<CaptureRequest>()!.View);
        }

        [Fact]
        public void ReadsAnImageToPlaceTheApiQueryAndWhatToDescribe()
        {
            var place = Codec.Read(Golden.Read("bridge-image-place.json"))!.As<ImagePlaceRequest>()!;
            Assert.Equal(40000, place.WidthMm);
            Assert.Null(place.HeightMm);
            Assert.Equal(new double[] { 0, -1, 0 }, place.Normal);
            Assert.Equal("Brep.CreateFromLoft", Codec.Read(Golden.Read("bridge-api.json"))!.As<ApiRequest>()!.Query);
            Assert.Single(Codec.Read(Golden.Read("bridge-describe.json"))!.As<DescribeRequest>()!.Ids);
            var refused = Codec.Read(Golden.Read("bridge-refused.json"))!;
            Assert.Equal(Wire.Refused, refused.Type);
            Assert.Contains("install the new one", refused.As<Refused>()!.Reason);
        }

        [Theory]
        [InlineData("not json")]
        [InlineData("[]")]
        [InlineData("{\"id\":\"x\",\"payload\":{}}")]
        [InlineData("{\"type\":\"host.select\",\"payload\":{}}")]
        [InlineData("{\"type\":1,\"id\":\"x\"}")]
        public void RefusesWhatIsNotAnEnvelope(string text)
        {
            Assert.Null(Codec.Read(text));
        }

        [Fact]
        public void APayloadOfTheWrongShapeIsNull()
        {
            var incoming = Codec.Read("{\"type\":\"host.select\",\"id\":\"s\",\"payload\":{\"ids\":\"nope\"}}")!;
            Assert.Null(incoming.As<SelectRequest>());
        }

        [Fact]
        public void LongTextIsClippedToWhatTheBridgeAccepts()
        {
            var status = RunStatus.Unavailable(new string('x', 900));
            Assert.Equal(500, status.Reason!.Length);
            Assert.EndsWith("\u2026", status.Reason);
        }

        [Fact]
        public void TheProtocolConstantsMatchTheBridge()
        {
            Assert.Equal(2, Wire.ProtocolVersion);
            Assert.Equal("/ws", Wire.Path);
            Assert.Equal("hai.v1", Wire.Subprotocol);
            Assert.Equal("hai.token.", Wire.TokenSubprotocolPrefix);
            Assert.Equal("rhino", Wire.HostId);
        }
    }
}
