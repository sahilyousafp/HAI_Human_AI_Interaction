using System.Reflection;
using System.Runtime.InteropServices;
using Rhino.PlugIns;

[assembly: Guid("5b8e0f1e-6a2d-4f3b-9c47-2d1e8a7c3b90")]
[assembly: PlugInDescription(DescriptionType.Organization, "HAI, Human AI Interface")]
[assembly: PlugInDescription(DescriptionType.WebSite, "https://github.com/")]

namespace HAI.Rhino
{
    /// <summary>
    /// Connects Rhino to the HAI bridge on this computer: the model Rhino holds is shown in HAI's viewer, a pick there
    /// selects here, and the agent can run Python in the open document. Nothing runs until HaiConnect is entered.
    /// </summary>
    public sealed class HaiPlugin : PlugIn
    {
        public static HaiPlugin? Instance { get; private set; }

        /// <summary>The one connection this Rhino has to a bridge, while HaiConnect is on.</summary>
        internal Session? Session { get; set; }

        public HaiPlugin()
        {
            Instance = this;
        }

        public static string PluginVersion =>
            typeof(HaiPlugin).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
            ?? "0.0.0";

        protected override void OnShutdown()
        {
            Session?.Dispose();
            Session = null;
            base.OnShutdown();
        }
    }
}
