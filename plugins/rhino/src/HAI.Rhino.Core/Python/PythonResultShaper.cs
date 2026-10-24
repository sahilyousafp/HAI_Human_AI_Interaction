using System;
using System.Linq;
using HAI.Rhino.Core.Protocol;

namespace HAI.Rhino.Core.Python
{
    /// <summary>
    /// Shapes what a script run in Rhino produced into the answer the agent reads, the way the Python workbench does
    /// (apps/bridge/src/python): output cut to 20 000 characters keeping its start and end, the value of a variable named
    /// <c>result</c> as text, and for an error its message with the end of the traceback.
    /// </summary>
    public static class PythonResultShaper
    {
        public const int OutputLimit = 20_000;
        public const int TracebackLines = 12;

        /// <summary>
        /// What is kept of an error, so that it and the marker that says how much was left out stay within the 10 000
        /// characters the bridge accepts for one.
        /// </summary>
        public const int ErrorLimit = 9_900;

        /// <summary>Cuts text longer than the limit in the middle, keeping the start and the end.</summary>
        public static string Cap(string text, int limit = OutputLimit)
        {
            if (text.Length <= limit) return text;
            var half = limit / 2;
            return text.Substring(0, half)
                + "\n[... " + (text.Length - limit) + " characters left out ...]\n"
                + text.Substring(text.Length - half);
        }

        /// <summary>The last lines of an error and its traceback; the end is where the cause is.</summary>
        public static string ErrorTail(string error, int lines = TracebackLines)
        {
            var all = error.Replace("\r\n", "\n").Trim().Split('\n');
            return string.Join("\n", all.Skip(Math.Max(0, all.Length - lines)));
        }

        /// <summary>The answer for a run that finished: its output, and its <c>result</c> when it set one.</summary>
        public static PythonResult Finished(string id, string stdout, string? result, TimeSpan took) =>
            new PythonResult
            {
                Id = id,
                Ok = true,
                Stdout = Cap(Normalize(stdout)),
                Result = string.IsNullOrEmpty(result) ? null : Cap(result!),
                DurationMs = took.TotalMilliseconds,
            };

        /// <summary>The answer for a run that failed: the output so far and the end of the traceback.</summary>
        public static PythonResult Failed(string id, string stdout, string error, TimeSpan took) =>
            new PythonResult
            {
                Id = id,
                Ok = false,
                Stdout = Cap(Normalize(stdout)),
                Error = Cap(ErrorTail(error), ErrorLimit),
                DurationMs = took.TotalMilliseconds,
            };

        // Rhino's output uses Windows line ends; the agent and the kept script read plain line feeds.
        private static string Normalize(string text) => text.Replace("\r\n", "\n");
    }
}
