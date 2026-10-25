using System.Collections.Generic;
using HAI.Rhino.Core.Protocol;
using Newtonsoft.Json.Linq;
using Xunit;

namespace HAI.Rhino.Core.Tests
{
    public class CodecTests
    {
        private const string Id = "message-1";

        [Fact]
        public void HelloAsRhinoWithPythonReady()
        {
            var json = Codec.Write(
                Wire.Hello,
                new Hello { RhinoVersion = "8.12.24010.10", PluginVersion = "0.1.0", Document = "tower.3dm" },
                Id);
            Golden.Json("message-hello.json", json);
        }

        [Fact]
        public void HelloWithPythonUnavailableAndAnUnsavedDocument()
        {
            var json = Codec.Write(
                Wire.Hello,
                new Hello
                {
                    RhinoVersion = "8.12.24010.10",
                    PluginVersion = "0.1.0",
                    Python = PythonStatus.Unavailable("Rhino has no Python 3 runtime yet"),
                    Document = null,
                },
                Id);
            Golden.Json("message-hello-no-python.json", json);
            Assert.Equal(JTokenType.Null, JObject.Parse(json)["payload"]!["document"]!.Type);
        }

        [Fact]
        public void ABatchWritesNullColourAndAssetBecauseTheBridgeRequiresThem()
        {
            var batch = new ObjectBatch
            {
                Reset = true,
                ChangedAt = 1_792_790_022_951,
                Sync = new SyncProgress { Done = 2, Total = 40 },
                NotDrawn = new NotDrawn { Curves = 12, Annotations = 1, Heavy = 1 },
                Changed =
                {
                    new RhinoObjectInfo
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
                    new RhinoObjectInfo
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
                    new StatusChanged { Python = PythonStatus.Unavailable("no engine"), Document = "tower.3dm" },
                    Id));
        }

        [Fact]
        public void PythonResultsLeaveOutWhatTheScriptDidNotSet()
        {
            var ok = Codec.Write(
                Wire.PythonResult,
                new PythonResult { Id = "run-1", Ok = true, Stdout = "42\n", Result = "{\"a\": 1}", DurationMs = 12.5 },
                Id);
            Golden.Json("message-python-result.json", ok);
            var failed = Codec.Write(
                Wire.PythonResult,
                new PythonResult { Id = "run-2", Ok = false, Stdout = "", Error = "NameError: name x is not defined", DurationMs = 3 },
                Id);
            Golden.Json("message-python-error.json", failed);
            var okPayload = (JObject)JObject.Parse(ok)["payload"]!;
            Assert.False(okPayload.ContainsKey("error"));
            var failedPayload = (JObject)JObject.Parse(failed)["payload"]!;
            Assert.False(failedPayload.ContainsKey("result"));
        }

        [Fact]
        public void ReadsARunRequestFromTheBridge()
        {
            var incoming = Codec.Read(Golden.Read("bridge-python-run.json"));
            Assert.NotNull(incoming);
            Assert.Equal(Wire.PythonRun, incoming!.Type);
            var run = incoming.As<PythonRunRequest>();
            Assert.Equal("run-1", run!.Id);
            Assert.Equal("# r: ladybug-core\nimport Rhino\nprint(1)\nresult = 42\n", run.Code);
            Assert.Equal(60000, run.TimeoutMs);
        }

        [Fact]
        public void ReadsARunRequestThatNamesTheAgentItsPartAndItsClaim()
        {
            var incoming = Codec.Read(Golden.Read("bridge-python-run-claimed.json"));
            Assert.NotNull(incoming);
            var run = incoming!.As<PythonRunRequest>()!;
            Assert.Equal("architect", run.Agent);
            Assert.Equal("Add the dome", run.Title);
            Assert.Equal("dome", run.Part);
            Assert.Equal("dome", (string?)run.Claim!["part"]);
            // A request that says nothing of this reads as before.
            var plain = Codec.Read(Golden.Read("bridge-python-run.json"))!.As<PythonRunRequest>()!;
            Assert.Null(plain.Agent);
            Assert.Null(plain.Claim);
        }

        [Fact]
        public void ReadsAnUndoRequest()
        {
            var incoming = Codec.Read(Golden.Read("bridge-undo.json"));
            Assert.NotNull(incoming);
            Assert.Equal(Wire.Undo, incoming!.Type);
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
                Wire.PythonResult,
                new PythonResult { Id = "run-3", Ok = true, Stdout = "", DurationMs = 7, Changes = changes },
                Id);
            Golden.Json("message-python-result-changes.json", json);
            // A result with no comparison leaves the field out.
            var plain = JObject.Parse(Codec.Write(Wire.PythonResult, new PythonResult { Id = "run-4", Ok = true, DurationMs = 1 }, Id));
            Assert.False(((JObject)plain["payload"]!).ContainsKey("changes"));
        }

        [Fact]
        public void ReadsSelectAndOpenRequests()
        {
            var select = Codec.Read(Golden.Read("bridge-select.json"))!;
            Assert.Equal(
                new List<string> { "7f1c0b0e-3f0a-4a53-9d0e-5d3f1c9a1b11", "a2d4c6e8-0000-4000-8000-000000000002" },
                select.As<SelectRequest>()!.Ids);
            var clear = Codec.Read(Golden.Read("bridge-select-clear.json"))!;
            Assert.Empty(clear.As<SelectRequest>()!.Ids);
            var open = Codec.Read(Golden.Read("bridge-open.json"))!;
            Assert.Equal("C:\\Users\\sahil\\project\\box.3dm", open.As<OpenRequest>()!.Path);
        }

        [Theory]
        [InlineData("not json")]
        [InlineData("[]")]
        [InlineData("{\"id\":\"x\",\"payload\":{}}")]
        [InlineData("{\"type\":\"rhino.select\",\"payload\":{}}")]
        [InlineData("{\"type\":1,\"id\":\"x\"}")]
        public void RefusesWhatIsNotAnEnvelope(string text)
        {
            Assert.Null(Codec.Read(text));
        }

        [Fact]
        public void APayloadOfTheWrongShapeIsNull()
        {
            var incoming = Codec.Read("{\"type\":\"rhino.select\",\"id\":\"s\",\"payload\":{\"ids\":\"nope\"}}")!;
            Assert.Null(incoming.As<SelectRequest>());
        }

        [Fact]
        public void LongTextIsClippedToWhatTheBridgeAccepts()
        {
            var status = PythonStatus.Unavailable(new string('x', 900));
            Assert.Equal(500, status.Reason!.Length);
            Assert.EndsWith("\u2026", status.Reason);
        }

        [Fact]
        public void TheProtocolConstantsMatchTheBridge()
        {
            Assert.Equal(1, Wire.ProtocolVersion);
            Assert.Equal("/ws", Wire.Path);
            Assert.Equal("hai.v1", Wire.Subprotocol);
            Assert.Equal("hai.token.", Wire.TokenSubprotocolPrefix);
        }
    }
}
