using HAI.Rhino.Bridge;
using Rhino;
using Rhino.Commands;

namespace HAI.Rhino.Commands
{
    /// <summary>HaiConnect: finds the running HAI bridge and connects to it, and shows Rhino's model there.</summary>
    public sealed class HaiConnectCommand : Command
    {
        public override string EnglishName => "HaiConnect";

        protected override Result RunCommand(RhinoDoc doc, RunMode mode)
        {
            var plugin = HaiPlugin.Instance;
            if (plugin == null) return Result.Failure;
            if (plugin.Session != null)
            {
                RhinoApp.WriteLine("HAI: already connected. HaiDisconnect stops it.");
                return Result.Success;
            }

            var found = Discovery.Find();
            if (found == null)
            {
                RhinoApp.WriteLine(
                    "HAI: the bridge is not running. Start HAI, then enter HaiConnect again.");
                return Result.Failure;
            }

            plugin.Session = new Session(found);
            plugin.Session.Start();
            RhinoApp.WriteLine("HAI: connecting to the bridge on this computer. The model will appear in HAI.");
            return Result.Success;
        }
    }

    /// <summary>HaiDisconnect: stops sharing the model and closes the connection.</summary>
    public sealed class HaiDisconnectCommand : Command
    {
        public override string EnglishName => "HaiDisconnect";

        protected override Result RunCommand(RhinoDoc doc, RunMode mode)
        {
            var plugin = HaiPlugin.Instance;
            if (plugin?.Session == null)
            {
                RhinoApp.WriteLine("HAI: not connected.");
                return Result.Nothing;
            }

            plugin.Session.Dispose();
            plugin.Session = null;
            RhinoApp.WriteLine("HAI: disconnected.");
            return Result.Success;
        }
    }
}
