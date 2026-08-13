/**
 * aco.ts — bridges the AI Coding Orchestrator's hooks onto pi's extension events.
 *
 * Claude Code registers the hooks in .claude/settings.json against PostToolUse / Stop /
 * SessionStart. pi has no equivalent config, but its event surface is richer, so this
 * extension subscribes to the closest pi events and shells out to the same bash scripts.
 * The scripts are unchanged and stay the single source of truth for hook behaviour.
 *
 * Install: this file is project-local, so pi auto-discovers it from .pi/extensions/.
 * Run `/reload` or restart pi after changing it.
 *
 * ── STATUS: UNTESTED ──────────────────────────────────────────────────────────────
 * Written against the documented event list without a live pi to run it. The event
 * names come from the docs; the *payload field names* are inferred, so file-path and
 * tool-name extraction below reads several plausible shapes defensively. If a hook does
 * not fire, log `JSON.stringify(event)` in the handler and correct the field names —
 * that is the expected first-run fix. Every handler is wrapped so a mistake here can
 * never break the agent loop.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// The docs type the argument as ExtensionAPI from the published package. Kept loose so
// this file type-checks without the dependency installed.
type PiApi = {
  on: (event: string, handler: (event: any, ctx: any) => unknown) => void;
  registerCommand?: (
    name: string,
    spec: { description: string; handler: (args: string, ctx: any) => unknown },
  ) => void;
};

const HOOKS = ".claude/hooks";
const HOOK_TIMEOUT_MS = 10_000;

/** Tool names that mean "a file was just written", across harness naming conventions. */
const EDIT_TOOLS = new Set([
  "edit", "write", "create", "str_replace", "apply_patch", "multiedit",
  "Edit", "Write", "MultiEdit", "NotebookEdit",
]);

/**
 * Run a hook script. Never rejects and never blocks the agent: hooks are advisory, so a
 * missing script, a non-zero exit or a hang must all degrade to silence.
 */
function runHook(
  script: string,
  opts: { env?: Record<string, string>; stdin?: string } = {},
): Promise<string> {
  return new Promise((resolve) => {
    const path = join(process.cwd(), HOOKS, script);
    if (!existsSync(path)) return resolve("");

    let done = false;
    const finish = (out: string) => {
      if (!done) { done = true; resolve(out); }
    };

    try {
      const child = spawn("bash", [path], {
        cwd: process.cwd(),
        // ACO_PLATFORM is what makes portable.sh tag telemetry as pi and pick the pi row
        // out of the tier map. Without it the hooks would report "unknown".
        env: { ...process.env, ACO_PLATFORM: "pi", ...(opts.env ?? {}) },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let out = "";
      child.stdout?.on("data", (d) => { out += String(d); });
      child.stderr?.on("data", () => { /* hook diagnostics are not agent-facing */ });
      child.on("error", () => finish(""));
      child.on("close", () => finish(out.trim()));

      const timer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* already gone */ }
        finish("");
      }, HOOK_TIMEOUT_MS);
      timer.unref?.();

      if (opts.stdin !== undefined) {
        child.stdin?.end(opts.stdin);
      } else {
        child.stdin?.end("");
      }
    } catch {
      finish("");
    }
  });
}

/** Pull a file path out of an event whose exact shape we cannot confirm. */
function extractFilePath(event: any): string {
  const candidates = [
    event?.input?.file_path, event?.input?.filePath, event?.input?.path,
    event?.input?.target_file, event?.toolInput?.file_path, event?.toolInput?.path,
    event?.args?.file_path, event?.args?.path, event?.filePath, event?.path,
  ];
  for (const c of candidates) if (typeof c === "string" && c) return c;
  return "";
}

function extractToolName(event: any): string {
  const n = event?.toolName ?? event?.tool ?? event?.name;
  return typeof n === "string" ? n : "";
}

/** Surface hook output without derailing the turn. */
function notify(ctx: any, text: string, level: "info" | "warn" = "info") {
  if (!text) return;
  try {
    ctx?.ui?.notify?.(text, level);
  } catch {
    /* older/newer ctx shape — swallow */
  }
}

export default function (pi: PiApi) {
  // ── SessionStart → detect an interrupted /task and surface the handoff ──
  pi.on("session_start", async (_event, ctx) => {
    const out = await runHook("session-start-load.sh");
    notify(ctx, out);
  });

  // ── PostToolUse → lint the written file, then nudge about missing tests ──
  // pi fires tool_result after execution. Claude Code's PostToolUse is the analogue.
  pi.on("tool_result", async (event, ctx) => {
    const tool = extractToolName(event);
    if (!EDIT_TOOLS.has(tool)) return;

    const file = extractFilePath(event);
    if (!file) return;

    // The scripts accept the path via env (see aco_resolve_edited_file in portable.sh).
    const env = { CHANGED_FILE: file, CLAUDE_FILE: file };
    const lint = await runHook("post-write-lint.sh", { env });
    notify(ctx, lint, "warn");

    const tdd = await runHook("tdd-reminder.sh", { env });
    notify(ctx, tdd);
  });

  // ── Context pressure: Claude Code has no direct equivalent event, so track turns ──
  pi.on("turn_end", async (_event, ctx) => {
    const out = await runHook("context-monitor.sh");
    notify(ctx, out, "warn");
  });

  // ── Stop → warn about work left in progress ──
  pi.on("agent_end", async (_event, ctx) => {
    const out = await runHook("stop-verify.sh");
    notify(ctx, out, "warn");
  });

  // ── Convenience: run a pipeline sub-agent by tier from inside a session ──
  // The orchestrator normally invokes .claude/bin/aco-agent through bash; this just
  // makes it reachable as /aco-agent <tier> <prompt> for manual use and debugging.
  pi.registerCommand?.("aco-agent", {
    description: "Run an orchestrator sub-agent: /aco-agent <fast|balanced|strong> <prompt>",
    handler: async (args: string, ctx: any) => {
      const trimmed = (args ?? "").trim();
      const sep = trimmed.indexOf(" ");
      if (sep < 0) {
        notify(ctx, "usage: /aco-agent <fast|balanced|strong> <prompt>", "warn");
        return;
      }
      const tier = trimmed.slice(0, sep);
      const prompt = trimmed.slice(sep + 1);
      if (!["fast", "balanced", "strong"].includes(tier)) {
        notify(ctx, `unknown tier "${tier}" — expected fast, balanced or strong`, "warn");
        return;
      }
      notify(ctx, `Running ${tier}-tier sub-agent…`);
      const out = await new Promise<string>((resolve) => {
        const child = spawn(join(process.cwd(), ".claude/bin/aco-agent"), [tier, "-"], {
          cwd: process.cwd(),
          env: { ...process.env, ACO_PLATFORM: "pi" },
          stdio: ["pipe", "pipe", "pipe"],
        });
        let out = "";
        child.stdout?.on("data", (d) => { out += String(d); });
        child.stderr?.on("data", (d) => { out += String(d); });
        child.on("error", (e) => resolve(`sub-agent failed: ${e.message}`));
        child.on("close", () => resolve(out.trim()));
        child.stdin?.end(prompt);
      });
      notify(ctx, out);
    },
  });
}
