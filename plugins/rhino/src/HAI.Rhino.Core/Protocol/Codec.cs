using System;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace HAI.Rhino.Core.Protocol
{
    /// <summary>A message read from the bridge: its type, its id and its payload as JSON.</summary>
    public sealed class Incoming
    {
        public string Type { get; }
        public string Id { get; }
        public JToken Payload { get; }

        public Incoming(string type, string id, JToken payload)
        {
            Type = type;
            Id = id;
            Payload = payload;
        }

        /// <summary>The payload as a request the plugin acts on, or null when it does not have the expected shape.</summary>
        public T? As<T>() where T : class
        {
            try
            {
                return Payload.ToObject<T>(Codec.Serializer);
            }
            catch (JsonException)
            {
                return null;
            }
        }
    }

    /// <summary>Writes and reads the envelope every message travels in: { type, id, payload }.</summary>
    public static class Codec
    {
        // Optional fields carry their own NullValueHandling; the ones the bridge requires (a colour or asset that is
        // null, for example) must be written as null, so nulls are included by default.
        public static readonly JsonSerializerSettings Settings = new JsonSerializerSettings
        {
            NullValueHandling = NullValueHandling.Include,
            Formatting = Formatting.None,
            MissingMemberHandling = MissingMemberHandling.Ignore,
        };

        internal static readonly JsonSerializer Serializer = JsonSerializer.Create(Settings);

        /// <summary>The JSON text of a message to send.</summary>
        public static string Write(string type, object payload, string? id = null) =>
            JsonConvert.SerializeObject(
                new JObject
                {
                    ["type"] = type,
                    ["id"] = id ?? Guid.NewGuid().ToString(),
                    ["payload"] = JToken.FromObject(payload, Serializer),
                },
                Settings);

        /// <summary>Reads a message from the bridge; null when it is not an envelope.</summary>
        public static Incoming? Read(string json)
        {
            JObject root;
            try
            {
                root = JObject.Parse(json);
            }
            catch (JsonException)
            {
                return null;
            }

            var type = root["type"]?.Type == JTokenType.String ? (string?)root["type"] : null;
            var id = root["id"]?.Type == JTokenType.String ? (string?)root["id"] : null;
            if (string.IsNullOrEmpty(type) || string.IsNullOrEmpty(id)) return null;
            return new Incoming(type!, id!, root["payload"] ?? JValue.CreateNull());
        }
    }
}
