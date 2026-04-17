# Security Audit Report

I just finished auditing the execution pipeline. We found two major holes in how commands were routed, which are now patched. 

## 1. Docker Sandbox Fallback (Host Execution Leak)

**Status:** Patched  
**Severity:** Critical  
**Location:** `contop-server/tools/docker_sandbox.py` (`_fallback_run`) and `contop-server/core/dual_tool_evaluator.py`

**What happened:**
The `DualToolEvaluator` does a decent job separating safe commands (run on the host) from dangerous ones (sent to the Docker sandbox). 

The problem was in what happened when Docker broke. If the sandbox container wasn't running or Docker wasn't installed, the `_fallback_run()` method caught the failure and just ran the restricted command directly on the host machine anyway. It slapped a shorter timeout on it, but stripped away all isolation. 

If a bad actor—or a hallucinating model—fired off something destructive when the Docker daemon happened to crash, the host machine took the hit.

**The Fix:**
I gutted the fallback execution logic entirely. `_fallback_run()` now hard-fails, returning an error response that the LLM parses exactly the same way it reads a standard failure. If we can't find Docker, the command dies right there.

## 2. Naive Path Traversal Bypass

**Status:** Patched  
**Severity:** High  
**Location:** `contop-server/core/dual_tool_evaluator.py` (`_path_referenced`)

**What happened:**
To keep agents out of sensitive directories like `/etc/passwd` or `C:\Windows`, the evaluator checked if those exact strings showed up in the command text. 

This was completely trivial to bypass using basic path normalization tricks. An agent could just ask for `/etc/./passwd` or `/tmp/../etc/passwd`. Because the exact string `/etc/passwd` wasn't technically in the prompt, the evaluator flagged it as safe and executed it directly on the host.

**The Fix:**
We dropped the naive string matching. The `_path_referenced` method now runs user inputs through `os.path.abspath(os.path.expanduser())`. It forces the OS to resolve the true absolute path before we compare it against our restricted list. If an attacker tries `../` climbing, python resolves it first, sees where it lands, and blocks it.

## Is it safe to use now?

Yes, assuming you know what you're deploying. We closed the two worst vectors: failing-open to the host, and bypassable path filters. 

That said, it's still a remote desktop relay sitting on your machine. Keep your API keys rotated, only pair with clients you control, and don't assume the sandbox is impenetrable.
