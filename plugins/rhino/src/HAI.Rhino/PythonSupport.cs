using System;
using HAI.Rhino.Core.Protocol;
using HAI.Rhino.Core.Python;

namespace HAI.Rhino
{
    /// <summary>
    /// Running the agent's Python in Rhino is not part of this build: how to run Python 3 in process, with output and error
    /// capture, cancellation and "# r:" requirement lines, has to be found out on a real Rhino 8 first (task 5.1). Until
    /// then the plugin says so in its hello, so the agent is told Rhino cannot run Python and uses the workbench, and it
    /// answers a run request with an error instead of leaving the bridge waiting.
    /// </summary>
    internal static class PythonSupport
    {
        public const string Reason = "this version of the HAI plugin cannot run Python in Rhino yet; use the Python workbench";

        public static PythonStatus Status => PythonStatus.Unavailable(Reason);

        public static PythonResult Refuse(string id) =>
            PythonResultShaper.Failed(id, "", "Python cannot be run in Rhino by this version of the HAI plugin yet.", TimeSpan.Zero);
    }
}
