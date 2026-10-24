using System;
using HAI.Rhino.Bridge;
using HAI.Rhino.Core.Protocol;
using HAI.Rhino.Core.Python;
using HAI.Rhino.Mirror;
using Rhino;

namespace HAI.Rhino
{
    /// <summary>
    /// One connection between this Rhino and a bridge: the client, and the mirror of the open document. It answers what
    /// the bridge asks (select these objects, open this file, run this script) and shares the document once the
    /// connection is up, and again after a reconnection.
    /// </summary>
    internal sealed class Session : IDisposable
    {
        private readonly BridgeClient client;
        private readonly DocumentMirror mirror;
        private string? documentName;

        public Session(BridgeAddress first)
        {
            // The bridge may have restarted since the last attempt: each connection reads the discovery file again.
            client = new BridgeClient(() => Discovery.Find() ?? first, BuildHello);
            mirror = new DocumentMirror(client);
            client.Received += OnReceived;
            client.ConnectionChanged += OnConnectionChanged;
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
                RhinoVersion = Limits.Clip(RhinoApp.Version.ToString(), 40),
                PluginVersion = Limits.Clip(HaiPlugin.PluginVersion, 40),
                Python = PythonSupport.Status,
                Document = documentName,
            };

        private static string? NameOf(RhinoDoc? doc)
        {
            var name = doc?.Name;
            return string.IsNullOrEmpty(name) ? null : Limits.Clip(name!, Limits.DocumentName);
        }

        private void OnConnectionChanged(bool connected)
        {
            if (connected) RhinoApp.InvokeOnUiThread(new Action(ShareActiveDocument));
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
                _ = client.Send(Wire.Status, new StatusChanged { Python = PythonSupport.Status, Document = documentName });
            }));
        }

        private void OnDocumentSaved(object? sender, DocumentSaveEventArgs e)
        {
            var name = NameOf(e.Document);
            if (name == documentName) return;
            documentName = name;
            _ = client.Send(Wire.Status, new StatusChanged { Python = PythonSupport.Status, Document = documentName });
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
                    if (open != null && !string.IsNullOrWhiteSpace(open.Path))
                        RhinoApp.InvokeOnUiThread(new Action(() => RhinoApp.RunScript($"-_Open \"{open.Path}\" _Enter", false)));
                    break;
                case Wire.PythonRun:
                    var run = message.As<PythonRunRequest>();
                    if (run != null) _ = client.Send(Wire.PythonResult, PythonSupport.Refuse(run.Id));
                    break;
            }
        }

        public void Dispose()
        {
            RhinoDoc.EndOpenDocument -= OnDocumentOpened;
            RhinoDoc.EndSaveDocument -= OnDocumentSaved;
            client.Received -= OnReceived;
            client.ConnectionChanged -= OnConnectionChanged;
            mirror.Dispose();
            client.Dispose();
        }
    }
}
