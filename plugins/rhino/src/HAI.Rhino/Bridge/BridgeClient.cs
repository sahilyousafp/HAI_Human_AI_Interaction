using System;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using HAI.Rhino.Core.Protocol;

namespace HAI.Rhino.Bridge
{
    /// <summary>
    /// The plugin's connection to the bridge: a WebSocket on this computer (the session token travels as a second
    /// subprotocol, and there is no Origin, which is how the bridge tells a program from a web page), and plain HTTP for
    /// the meshes. It reconnects, reading the discovery file again each time, so a restarted bridge is found within
    /// a few seconds.
    /// </summary>
    internal sealed class BridgeClient : IDisposable
    {
        private static readonly TimeSpan[] Backoff =
        {
            TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(3), TimeSpan.FromSeconds(5),
        };

        private readonly Func<BridgeAddress?> find;
        private readonly Func<Hello> hello;
        private readonly CancellationTokenSource stop = new CancellationTokenSource();
        private readonly SemaphoreSlim sending = new SemaphoreSlim(1, 1);
        private readonly HttpClient http = new HttpClient();
        private ClientWebSocket? socket;
        private BridgeAddress? address;
        private Task? loop;

        /// <summary>A message arrived from the bridge.</summary>
        public event Action<Incoming>? Received;

        /// <summary>The connection is up and hello has been sent (the document can be shared now), or it went down.</summary>
        public event Action<bool>? ConnectionChanged;

        public bool Connected => socket?.State == WebSocketState.Open;

        public BridgeClient(Func<BridgeAddress?> find, Func<Hello> hello)
        {
            this.find = find;
            this.hello = hello;
        }

        public void Start()
        {
            loop = Task.Run(Run);
        }

        private async Task Run()
        {
            var attempt = 0;
            while (!stop.IsCancellationRequested)
            {
                var found = find();
                if (found != null && await TryConnect(found).ConfigureAwait(false))
                {
                    attempt = 0;
                    await Listen().ConfigureAwait(false);
                    ConnectionChanged?.Invoke(false);
                }

                if (stop.IsCancellationRequested) return;
                var wait = Backoff[Math.Min(attempt++, Backoff.Length - 1)];
                try
                {
                    await Task.Delay(wait, stop.Token).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    return;
                }
            }
        }

        private async Task<bool> TryConnect(BridgeAddress found)
        {
            var candidate = new ClientWebSocket();
            candidate.Options.AddSubProtocol(Wire.Subprotocol);
            candidate.Options.AddSubProtocol(Wire.TokenSubprotocolPrefix + found.Token);
            try
            {
                using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop.Token))
                {
                    timeout.CancelAfter(TimeSpan.FromSeconds(4));
                    await candidate.ConnectAsync(new Uri($"ws://127.0.0.1:{found.Port}{Wire.Path}"), timeout.Token)
                        .ConfigureAwait(false);
                }
            }
            catch (Exception e) when (e is WebSocketException || e is OperationCanceledException || e is HttpRequestException)
            {
                candidate.Dispose();
                return false;
            }

            socket = candidate;
            address = found;
            await Send(Wire.Hello, hello()).ConfigureAwait(false);
            ConnectionChanged?.Invoke(true);
            return true;
        }

        private async Task Listen()
        {
            var current = socket;
            if (current == null) return;
            var buffer = new byte[16 * 1024];
            try
            {
                while (current.State == WebSocketState.Open && !stop.IsCancellationRequested)
                {
                    using (var text = new MemoryStream())
                    {
                        WebSocketReceiveResult result;
                        do
                        {
                            result = await current.ReceiveAsync(new ArraySegment<byte>(buffer), stop.Token)
                                .ConfigureAwait(false);
                            if (result.MessageType == WebSocketMessageType.Close) return;
                            text.Write(buffer, 0, result.Count);
                        }
                        while (!result.EndOfMessage);

                        var incoming = Codec.Read(Encoding.UTF8.GetString(text.ToArray()));
                        if (incoming != null) Received?.Invoke(incoming);
                    }
                }
            }
            catch (Exception e) when (e is WebSocketException || e is OperationCanceledException || e is IOException)
            {
                // The connection went away; Run connects again.
            }
            finally
            {
                current.Dispose();
                if (ReferenceEquals(socket, current)) socket = null;
            }
        }

        /// <summary>Sends one message; false when there is no connection (the caller decides whether that matters).</summary>
        public async Task<bool> Send(string type, object payload)
        {
            var current = socket;
            if (current == null || current.State != WebSocketState.Open) return false;
            var bytes = Encoding.UTF8.GetBytes(Codec.Write(type, payload));
            await sending.WaitAsync(stop.Token).ConfigureAwait(false);
            try
            {
                await current.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, stop.Token)
                    .ConfigureAwait(false);
                return true;
            }
            catch (Exception e) when (e is WebSocketException || e is OperationCanceledException || e is ObjectDisposedException)
            {
                return false;
            }
            finally
            {
                sending.Release();
            }
        }

        /// <summary>Stores one mesh asset in the bridge before the descriptor that names it is sent.</summary>
        public async Task<bool> UploadMesh(Guid asset, byte[] bytes)
        {
            var target = address;
            if (target == null) return false;
            using (var request = new HttpRequestMessage(HttpMethod.Put, $"http://127.0.0.1:{target.Port}/mirror/{asset:D}"))
            {
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", target.Token);
                request.Content = new ByteArrayContent(bytes);
                request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
                try
                {
                    using (var response = await http.SendAsync(request, stop.Token).ConfigureAwait(false))
                        return (int)response.StatusCode == 204;
                }
                catch (Exception e) when (e is HttpRequestException || e is OperationCanceledException)
                {
                    return false;
                }
            }
        }

        public void Dispose()
        {
            stop.Cancel();
            try
            {
                socket?.Abort();
            }
            catch (ObjectDisposedException)
            {
                // Already gone.
            }

            http.Dispose();
            try
            {
                loop?.Wait(TimeSpan.FromSeconds(1));
            }
            catch (AggregateException)
            {
                // The loop was cancelled.
            }
        }
    }
}
