using System;
using System.IO;
using Newtonsoft.Json.Linq;

namespace HAI.Rhino.Bridge
{
    /// <summary>Where the running bridge is, and the token that lets this program in.</summary>
    public sealed class BridgeAddress
    {
        public int Port { get; }
        public string Token { get; }

        public BridgeAddress(int port, string token)
        {
            Port = port;
            Token = token;
        }
    }

    /// <summary>
    /// Finds the bridge through the file it writes for the current user only (<c>%LOCALAPPDATA%\HAI\bridge.json</c>,
    /// apps/bridge/src/discovery-file.ts). The file is read each time a connection is made: a restarted bridge has a
    /// new port and token.
    /// </summary>
    public static class Discovery
    {
        public static string FilePath()
        {
            var named = Environment.GetEnvironmentVariable("HAI_DISCOVERY_FILE");
            if (!string.IsNullOrEmpty(named)) return named!;
            var local = Environment.GetEnvironmentVariable("LOCALAPPDATA");
            var baseFolder = !string.IsNullOrEmpty(local)
                ? local!
                : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local", "share");
            return Path.Combine(baseFolder, "HAI", "bridge.json");
        }

        public static BridgeAddress? Find() => Read(FilePath());

        public static BridgeAddress? Read(string path)
        {
            try
            {
                var json = JObject.Parse(File.ReadAllText(path));
                var port = json["port"];
                var token = json["token"];
                if (port?.Type != JTokenType.Integer || token?.Type != JTokenType.String) return null;
                var number = (int)port;
                var text = (string)token!;
                return number is > 0 and <= 65535 && text.Length > 0 ? new BridgeAddress(number, text) : null;
            }
            catch (Exception e) when (e is IOException || e is UnauthorizedAccessException || e is Newtonsoft.Json.JsonException)
            {
                return null;
            }
        }
    }
}
