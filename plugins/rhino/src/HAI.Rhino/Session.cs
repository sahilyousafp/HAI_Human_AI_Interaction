using System;
using System.IO;
using HAI.Rhino.Bridge;
using HAI.Rhino.Core.Protocol;
using HAI.Rhino.Mirror;
using Rhino;

namespace HAI.Rhino
{
    /// <summary>
    /// One connection between this Rhino and a bridge: the client, and the mirror of the open document. It answers what
    /// the bridge asks (select these objects, open this file, run this script, capture the view, place an image, look up
    /// the API, describe these objects) and shares the document once the connection is up, and again after a reconnection.
    /// </summary>
    internal sealed class Session : IDisposable
    {
        private readonly BridgeClient client;
        private readonly DocumentMirror mirror;
        private readonly ApiLookup api = new ApiLookup();
        private string? documentName;

        public Session(BridgeAddress first)
        {
            // The bridge may have restarted since the last attempt: each connection reads the discovery file again.
            client = new BridgeClient(() => Discovery.Find() ?? first, BuildHello);
            mirror = new DocumentMirror(client);
            client.Received += OnReceived;
            client.ConnectionChanged += OnConnectionChanged;
            client.Refused += OnRefused;
        }

        public void Start()
        {
            documentName = NameOf(RhinoDoc.ActiveDoc);
            RhinoDoc.EndOpenDocument += OnDocumentOpened;
            RhinoDoc.EndSaveDocument += OnDocumentSaved;
            client.Start();
        }

        private Hello BuildHello() =>
            new Hello
            {
                App = new AppInfo
                {
                    Name = "Rhino " + RhinoApp.ExeVersion,
                    Version = Limits.Clip(RhinoApp.Version.ToString(), 40),
                },
                ConnectorVersion = Limits.Clip(HaiPlugin.PluginVersion, 40),
                Run = RunStatus.Ready(),
                Document = documentName,
            };

        private static string? NameOf(RhinoDoc? doc)
        {
            var name = doc?.Name;
            return string.IsNullOrEmpty(name) ? null : Limits.Clip(name!, Limits.DocumentName);
        }

        private void OnConnectionChanged(bool connected)
        {
            if (!connected) return;
            api.StartBuilding();
            RhinoApp.InvokeOnUiThread(new Action(ShareActiveDocument));
        }

        /// <summary>The bridge will not take this connector: say what to do, and stop trying.</summary>
        private void OnRefused(string reason)
        {
            RhinoApp.InvokeOnUiThread(new Action(() =>
            {
                RhinoApp.WriteLine("HAI: " + reason);
                var plugin = HaiPlugin.Instance;
                if (plugin?.Session != this) return;
                plugin.Session = null;
                Dispose();
            }));
        }

        private void ShareActiveDocument()
        {
            var doc = RhinoDoc.ActiveDoc;
            if (doc == null) return;
            documentName = NameOf(doc);
            mirror.Attach(doc);
        }

        private void OnDocumentOpened(object? sender, DocumentOpenEventArgs e)
        {
            if (!client.Connected) return;
            RhinoApp.InvokeOnUiThread(new Action(() =>
            {
                ShareActiveDocument();
                _ = client.Send(Wire.Status, new StatusChanged { Run = RunStatus.Ready(), Document = documentName });
            }));
        }

        private void OnDocumentSaved(object? sender, DocumentSaveEventArgs e)
        {
            var name = NameOf(e.Document);
            if (name == documentName) return;
            documentName = name;
            _ = client.Send(Wire.Status, new StatusChanged { Run = RunStatus.Ready(), Document = documentName });
        }

        private void OnReceived(Incoming message)
        {
            switch (message.Type)
            {
                case Wire.Select:
                    var select = message.As<SelectRequest>();
                    if (select != null) RhinoApp.InvokeOnUiThread(new Action(() => mirror.SelectFromBridge(select.Ids)));
                    break;
                case Wire.Open:
                    var open = message.As<OpenRequest>();
                    if (open != null && !string.IsNullOrWhiteSpace(open.Path)) OpenFile(open.Path);
                    break;
                case Wire.Undo:
                    // The user chose to undo a script that went outside its claim. Each run is one undo step.
                    RhinoApp.InvokeOnUiThread(new Action(() => RhinoApp.RunScript("_Undo", false)));
                    break;
                case Wire.Run:
                    var run = message.As<RunRequest>();
                    if (run != null)
                        RhinoApp.InvokeOnUiThread(new Action(() => _ = client.Send(Wire.RunResult, PythonRunner.Run(run))));
                    break;
                case Wire.Capture:
                    var capture = message.As<CaptureRequest>();
                    if (capture != null) RhinoApp.InvokeOnUiThread(new Action(() => CaptureView(capture)));
                    break;
                case Wire.ImagePlace:
                    var place = message.As<ImagePlaceRequest>();
                    if (place != null)
                        RhinoApp.InvokeOnUiThread(new Action(() => _ = client.Send(Wire.ImagePlaced, PlaceImage(place))));
                    break;
                case Wire.Api:
                    var query = message.As<ApiRequest>();
                    if (query != null) _ = client.Send(Wire.ApiResult, api.Index.Find(query.Id, query.Query));
                    break;
                case Wire.Describe:
                    var describe = message.As<DescribeRequest>();
                    if (describe != null)
                        RhinoApp.InvokeOnUiThread(new Action(() => _ = client.Send(Wire.Described, DescribeObjects(describe))));
                    break;
            }
        }

        /// <summary>Renders the view on the UI thread, then uploads the picture and answers off it.</summary>
        private void CaptureView(CaptureRequest request)
        {
            var doc = RhinoDoc.ActiveDoc;
            if (doc == null)
            {
                _ = client.Send(Wire.Captured, new Captured { Id = request.Id, Error = "No document is open." });
                return;
            }

            var (png, error, ms) = Capture.Take(doc, request);
            _ = System.Threading.Tasks.Task.Run(async () =>
            {
                if (png == null)
                {
                    await client.Send(Wire.Captured, new Captured { Id = request.Id, Error = error, DurationMs = ms })
                        .ConfigureAwait(false);
                    return;
                }

                var asset = Guid.NewGuid();
                var uploaded = await client.UploadCapture(asset, png).ConfigureAwait(false);
                await client.Send(
                        Wire.Captured,
                        uploaded
                            ? new Captured { Id = request.Id, Ok = true, Asset = asset.ToString("D"), DurationMs = ms }
                            : new Captured { Id = request.Id, Error = "The picture could not be sent to HAI.", DurationMs = ms })
                    .ConfigureAwait(false);
            });
        }

        private static ImagePlaced PlaceImage(ImagePlaceRequest request)
        {
            var doc = RhinoDoc.ActiveDoc;
            return doc == null
                ? new ImagePlaced { Id = request.Id, Error = "No document is open." }
                : PictureFrames.Place(doc, request);
        }

        private static Described DescribeObjects(DescribeRequest request)
        {
            var doc = RhinoDoc.ActiveDoc;
            return doc == null ? new Described { Id = request.Id } : ComponentDescriber.Describe(doc, request);
        }

        /// <summary>
        /// Opens exactly this file. The path is made native first and must exist: Rhino's Open does not take every spelling
        /// of a path, and when it refuses one the Enter that ends the command opens the most recent file instead.
        /// </summary>
        private static void OpenFile(string path)
        {
            string full;
            try
            {
                full = Path.GetFullPath(path);
            }
            catch (Exception error) when (error is ArgumentException || error is NotSupportedException || error is PathTooLongException)
            {
                RhinoApp.WriteLine("HAI: could not open \"" + path + "\": " + error.Message);
                return;
            }

            if (!File.Exists(full))
            {
                RhinoApp.WriteLine("HAI: could not open \"" + full + "\": there is no such file.");
                return;
            }

            RhinoApp.InvokeOnUiThread(new Action(() => RhinoApp.RunScript($"-_Open \"{full}\" _Enter", false)));
        }

        public void Dispose()
        {
            RhinoDoc.EndOpenDocument -= OnDocumentOpened;
            RhinoDoc.EndSaveDocument -= OnDocumentSaved;
            client.Received -= OnReceived;
            client.ConnectionChanged -= OnConnectionChanged;
            client.Refused -= OnRefused;
            mirror.Dispose();
            client.Dispose();
        }
    }
}
