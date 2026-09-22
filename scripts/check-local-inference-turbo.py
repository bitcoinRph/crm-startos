import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[1]
KEYS = (
    "CRM_INFERENCE_MODE",
    "CRM_LOCAL_INFERENCE_ALLOWED_HOSTS",
    "CRM_LOCAL_INFERENCE_JSON",
)
CANARY = "synthetic-canary"
TASKS = ("dev", "dev:headless", "build", "test", "check-types", "lint")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bun", default=shutil.which("bun"))
    parser.add_argument("--turbo", default=str(ROOT / "node_modules/.bin/turbo"))
    parser.add_argument("--evidence", type=Path)
    args = parser.parse_args()
    if not args.bun:
        parser.error("Bun is required; supply --bun.")
    bun = str(Path(args.bun).resolve())
    turbo = str(Path(args.turbo).absolute())
    expected = {key: f"{key}={hashlib.sha256(CANARY.encode()).hexdigest()}" for key in KEYS}
    results = []
    failures = []
    with tempfile.TemporaryDirectory(prefix="crm-turbo-check-") as home:
        for task in TASKS:
            command = [
                "env", "-i",
                f"PATH={Path(bun).parent}:/usr/local/bin:/usr/bin:/bin",
                f"HOME={home}", *(f"{key}={CANARY}" for key in KEYS), "DO_NOT_TRACK=1",
                bun, "--no-env-file", turbo, "run", task,
                "--filter=agent", "--dry=json", "--env-mode=strict",
            ]
            run = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=120)
            result = {"task": task, "command": command, "exitCode": run.returncode, "stderr": run.stderr}
            results.append(result)
            if run.returncode:
                failures.append(f"{task}: Turbo exits {run.returncode}")
                continue
            report = json.loads(run.stdout)
            global_env = report["globalCacheInputs"]["environmentVariables"]
            matches = [entry for entry in report["tasks"] if entry["taskId"] == f"agent#{task}"]
            result.update(envMode=report["envMode"], globalEnvironment=global_env, tasks=[
                {"taskId": entry["taskId"], "envMode": entry["envMode"],
                 "command": entry["command"], "environmentVariables": entry["environmentVariables"]}
                for entry in matches
            ])
            if report["envMode"] != "strict" or len(matches) != 1:
                failures.append(f"{task}: Expected strict mode and one agent task")
                continue
            entry = matches[0]
            task_env = entry["environmentVariables"]
            passed = (global_env.get("passthrough") or []) + (task_env.get("passthrough") or [])
            hashed = [value for scope in (global_env, task_env)
                      for field in ("configured", "inferred") for value in (scope.get(field) or [])]
            if entry["envMode"] != "strict" or not entry["command"]:
                failures.append(f"{task}: Agent task is not executable in strict mode")
            for key in KEYS:
                if expected[key] not in passed:
                    failures.append(f"{task}: {key} is absent from resolved passthrough")
                if any(value.startswith(f"{key}=") for value in hashed):
                    failures.append(f"{task}: {key} incorrectly affects cache keys")
    summary = {"keys": KEYS, "tasksChecked": len(results), "failures": failures, "results": results}
    if args.evidence:
        args.evidence.write_text(json.dumps(summary, indent=2) + "\n")
    for failure in failures:
        print(f"FAIL {failure}")
    if failures:
        return 1
    print(f"PASS {len(results)} agent tasks preserve all inference keys in strict-mode passthrough, outside cache-key inputs.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
