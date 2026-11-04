using System;
using System.Collections.Generic;
using HAI.Rhino.Core.Protocol;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace HAI.Rhino.Core.Python
{
    /// <summary>
    /// What Rhino's ScriptEditor runs for an agent's script. Rhino reports a script's output and errors only as command
    /// window text, so the agent's script is run from a small wrapper that captures them itself and writes them to a
    /// file: the output, the value of <c>result</c> and the traceback come back as data on Rhino 8 and Rhino 9 alike.
    ///
    /// The wrapper's own "# r:" lines hold only what <see cref="PythonRequirements"/> accepted, which is what the user
    /// approved. The time limit raises an error in the script's thread: it stops Python code, but it cannot interrupt a
    /// call into Rhino or a sleep until that call returns.
    /// </summary>
    public static class PythonWrapper
    {
        public const string TimeLimitMessage = "The script ran past its time limit and was stopped.";

        public static string Compose(IReadOnlyList<string> packages, string codePath, string resultPath, int timeoutMs)
        {
            var lines = new List<string> { "#! python 3" };
            if (packages.Count > 0) lines.Add("# r: " + string.Join(", ", packages));
            lines.AddRange(new[]
            {
                "import contextlib, ctypes, io, json, sys, threading, traceback",
                "import Rhino, scriptcontext",
                "",
                "def _hai_run(code_path, result_path, timeout_seconds):",
                "    scriptcontext.doc = Rhino.RhinoDoc.ActiveDoc",
                "    output = io.StringIO()",
                "    scope = {\"__name__\": \"__main__\", \"__file__\": \"agent_script.py\", \"__rhino_doc__\": scriptcontext.doc}",
                "    error = None",
                "    timed_out = []",
                "    thread = threading.get_ident()",
                "    def stop():",
                "        timed_out.append(True)",
                "        ctypes.pythonapi.PyThreadState_SetAsyncExc(ctypes.c_ulong(thread), ctypes.py_object(TimeoutError))",
                "    timer = threading.Timer(timeout_seconds, stop) if timeout_seconds > 0 else None",
                "    try:",
                "        with open(code_path, encoding=\"utf8\") as file:",
                "            source = file.read()",
                "        if timer:",
                "            timer.daemon = True",
                "            timer.start()",
                "        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):",
                "            exec(compile(source, \"agent_script.py\", \"exec\"), scope)",
                "    except SystemExit as stopped:",
                "        if stopped.code not in (None, 0):",
                "            error = \"The script exited with \" + str(stopped.code)",
                "    except BaseException:",
                "        kind, value, trace = sys.exc_info()",
                "        error = \"\".join(traceback.format_exception(kind, value, trace.tb_next))",
                "        if timed_out:",
                "            error = " + JsonConvert.SerializeObject(TimeLimitMessage) + " + \"\\n\" + error",
                "    finally:",
                "        if timer:",
                "            timer.cancel()",
                "    result = scope.get(\"result\")",
                "    with open(result_path, \"w\", encoding=\"utf8\") as file:",
                "        json.dump({\"stdout\": output.getvalue(), \"result\": None if result is None else str(result), \"error\": error}, file)",
                "",
                "_hai_run("
                    + JsonConvert.SerializeObject(codePath) + ", "
                    + JsonConvert.SerializeObject(resultPath) + ", "
                    + (timeoutMs / 1000.0).ToString("0.###", System.Globalization.CultureInfo.InvariantCulture) + ")",
                "",
            });
            return string.Join("\n", lines);
        }

        /// <summary>
        /// The answer for a run, from what the wrapper wrote. No file, or one that cannot be read, means the wrapper never
        /// finished (a package that would not install, say), and what Rhino printed is all there is to say about it.
        /// </summary>
        public static PythonResult Answer(string id, string? written, string commandOutput, TimeSpan took)
        {
            JObject? outcome = null;
            try
            {
                if (!string.IsNullOrEmpty(written)) outcome = JObject.Parse(written!);
            }
            catch (JsonException)
            {
                outcome = null;
            }

            if (outcome == null)
            {
                var said = commandOutput.Trim();
                return PythonResultShaper.Failed(id, "", said.Length > 0 ? said : "Rhino did not run the script.", took);
            }

            var stdout = (string?)outcome["stdout"] ?? "";
            var error = (string?)outcome["error"];
            return error != null
                ? PythonResultShaper.Failed(id, stdout, error, took)
                : PythonResultShaper.Finished(id, stdout, (string?)outcome["result"], took);
        }
    }
}
