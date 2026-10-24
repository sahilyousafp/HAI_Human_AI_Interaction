"""Runs one script the agent wrote, for HAI's Python workbench.

    python hai_run.py <script.py> <outcome.json>

The script runs as `__main__` in the project folder. What it printed goes to stdout as usual. When it ends, this
writes `<outcome.json>`: {"ok": bool, "result": text | null, "error": text | null}. `result` is the value of a
variable named `result`, if the script set one; `error` is the message and the end of the traceback.

The process then ends with os._exit. rhino3dm can crash (an access violation) while the interpreter shuts down once a
render mesh has been attached to a Brep, after the file was written; ending here, once the outcome is on disk, makes
every run exit cleanly.
"""
import json
import os
import sys
import traceback

RESULT_LIMIT = 20_000
TRACEBACK_LINES = 12


def as_text(value):
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value)
    except (TypeError, ValueError):
        return repr(value)


def main():
    script, outcome_path = sys.argv[1], sys.argv[2]
    with open(script, encoding="utf-8") as handle:
        source = handle.read()
    namespace = {"__name__": "__main__", "__file__": script}
    outcome = {"ok": True, "result": None, "error": None}
    try:
        exec(compile(source, script, "exec"), namespace)  # noqa: S102 - running the script is the purpose
    except SystemExit as stop:
        if stop.code not in (None, 0):
            outcome["ok"] = False
            outcome["error"] = f"The script exited with code {stop.code}"
    except BaseException:  # noqa: BLE001 - everything the script raises is reported, not thrown
        outcome["ok"] = False
        lines = traceback.format_exc().strip().splitlines()
        outcome["error"] = "\n".join(lines[-TRACEBACK_LINES:])
    if outcome["ok"] and "result" in namespace:
        outcome["result"] = as_text(namespace["result"])[:RESULT_LIMIT]
    with open(outcome_path, "w", encoding="utf-8") as handle:
        json.dump(outcome, handle)
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(0 if outcome["ok"] else 1)


if __name__ == "__main__":
    main()
