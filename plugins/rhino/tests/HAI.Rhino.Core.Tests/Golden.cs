using System;
using System.IO;
using System.Runtime.CompilerServices;
using Newtonsoft.Json.Linq;
using Xunit;

namespace HAI.Rhino.Core.Tests
{
    /// <summary>
    /// Files the TypeScript side checks too (scripts/rhino-plugin-contract.test.mjs reads the same ones): what the plugin
    /// sends must be accepted by the bridge's schemas, and what it writes must be read by HAI's own reader. Set
    /// HAI_UPDATE_FIXTURES=1 to write them again after a deliberate change.
    /// </summary>
    internal static class Golden
    {
        private static string Folder([CallerFilePath] string here = "") =>
            Path.GetFullPath(Path.Combine(Path.GetDirectoryName(here)!, "..", "fixtures"));

        private static bool Updating => Environment.GetEnvironmentVariable("HAI_UPDATE_FIXTURES") == "1";

        /// <summary>A message's JSON, indented so a difference reads, compared with the file of that name.</summary>
        public static void Json(string name, string actualJson)
        {
            var text = JToken.Parse(actualJson).ToString().Replace("\r\n", "\n") + "\n";
            var path = Path.Combine(Folder(), name);
            if (Updating)
            {
                File.WriteAllText(path, text);
                return;
            }

            Assert.True(File.Exists(path), $"Missing fixture {name}; run the tests with HAI_UPDATE_FIXTURES=1 to write it.");
            Assert.Equal(File.ReadAllText(path).Replace("\r\n", "\n"), text);
        }

        /// <summary>A message the bridge sends the plugin, as the TypeScript test also reads it.</summary>
        public static string Read(string name) => File.ReadAllText(Path.Combine(Folder(), name));

        public static void Bytes(string name, byte[] actual)
        {
            var path = Path.Combine(Folder(), name);
            if (Updating)
            {
                File.WriteAllBytes(path, actual);
                return;
            }

            Assert.True(File.Exists(path), $"Missing fixture {name}; run the tests with HAI_UPDATE_FIXTURES=1 to write it.");
            Assert.Equal(File.ReadAllBytes(path), actual);
        }
    }
}
