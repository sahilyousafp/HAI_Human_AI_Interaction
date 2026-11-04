#! python 3
import contextlib, ctypes, io, json, sys, threading, traceback
import Rhino, scriptcontext

def _hai_run(code_path, result_path, timeout_seconds):
    scriptcontext.doc = Rhino.RhinoDoc.ActiveDoc
    output = io.StringIO()
    scope = {"__name__": "__main__", "__file__": "agent_script.py", "__rhino_doc__": scriptcontext.doc}
    error = None
    timed_out = []
    thread = threading.get_ident()
    def stop():
        timed_out.append(True)
        ctypes.pythonapi.PyThreadState_SetAsyncExc(ctypes.c_ulong(thread), ctypes.py_object(TimeoutError))
    timer = threading.Timer(timeout_seconds, stop) if timeout_seconds > 0 else None
    try:
        with open(code_path, encoding="utf8") as file:
            source = file.read()
        if timer:
            timer.daemon = True
            timer.start()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            exec(compile(source, "agent_script.py", "exec"), scope)
    except SystemExit as stopped:
        if stopped.code not in (None, 0):
            error = "The script exited with " + str(stopped.code)
    except BaseException:
        kind, value, trace = sys.exc_info()
        error = "".join(traceback.format_exception(kind, value, trace.tb_next))
        if timed_out:
            error = "The script ran past its time limit and was stopped." + "\n" + error
    finally:
        if timer:
            timer.cancel()
    result = scope.get("result")
    with open(result_path, "w", encoding="utf8") as file:
        json.dump({"stdout": output.getvalue(), "result": None if result is None else str(result), "error": error}, file)

_hai_run("CODE_PATH", "RESULT_PATH", 1)
