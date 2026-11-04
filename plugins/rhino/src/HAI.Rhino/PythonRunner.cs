using System;
using System.Diagnostics;
using System.IO;
using HAI.Rhino.Core.Protocol;
using HAI.Rhino.Core.Python;
using Rhino;
using Rhino.Commands;

namespace HAI.Rhino
{
    /// <summary>
    /// Runs an agent's Python script in the open document through Rhino's ScriptEditor, which brings Rhino's own Python
    /// and installs the "# r:" packages. Call it on the UI thread: Rhino is busy until the script ends. A script cannot
    /// run while a command is waiting for the user, so the agent is told to try again rather than interrupting them.
    /// </summary>
    internal static class PythonRunner
    {
        public static PythonResult Run(PythonRunRequest request)
        {
            var clock = Stopwatch.StartNew();
            var doc = RhinoDoc.ActiveDoc;
            if (doc == null) return Failed(request, "Rhino has no open document.", clock);
            if (Command.InCommand())
                return Failed(request, "Rhino is in the middle of a command. Try again when it has finished.", clock);

            var requirements = PythonRequirements.Parse(request.Code);
            if (requirements.Invalid.Count > 0)
                return Failed(request, "These are not package names: " + string.Join(", ", requirements.Invalid), clock);

            var folder = Path.Combine(Path.GetTempPath(), "HAI", "run-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(folder);
            try
            {
                var codePath = Path.Combine(folder, "agent_script.py");
                var resultPath = Path.Combine(folder, "result.json");
                var wrapperPath = Path.Combine(folder, "run.py");
                File.WriteAllText(codePath, request.Code);
                File.WriteAllText(wrapperPath, PythonWrapper.Compose(requirements.Packages, codePath, resultPath, request.TimeoutMs));

                RunChanges changes;
                string said;
                using (var scope = RunScope.Begin(doc, request))
                {
                    said = RunInEditor(doc, wrapperPath);
                    changes = scope.Finish();
                }

                var written = File.Exists(resultPath) ? File.ReadAllText(resultPath) : null;
                var answer = PythonWrapper.Answer(request.Id, written, said, clock.Elapsed);
                answer.Changes = changes;
                return answer;
            }
            catch (Exception error)
            {
                return Failed(request, error.Message, clock);
            }
            finally
            {
                TryDelete(folder);
            }
        }

        /// <summary>Runs the file and returns what Rhino printed meanwhile, which is all it says when the run fails to start.</summary>
        private static string RunInEditor(RhinoDoc doc, string path)
        {
            RhinoApp.CommandWindowCaptureEnabled = true;
            try
            {
                RhinoApp.RunScript(doc.RuntimeSerialNumber, $"_-ScriptEditor _Run \"{path}\"", false);
                return string.Concat(RhinoApp.CapturedCommandWindowStrings(true) ?? Array.Empty<string>());
            }
            finally
            {
                RhinoApp.CommandWindowCaptureEnabled = false;
            }
        }

        private static PythonResult Failed(PythonRunRequest request, string message, Stopwatch clock) =>
            PythonResultShaper.Failed(request.Id, "", message, clock.Elapsed);

        private static void TryDelete(string folder)
        {
            try
            {
                Directory.Delete(folder, true);
            }
            catch (IOException)
            {
                // A file still held open stays in the temp folder; Windows cleans it up.
            }
            catch (UnauthorizedAccessException)
            {
                // The same.
            }
        }
    }
}
