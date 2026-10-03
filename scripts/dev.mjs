// Starts the three parts together, with each line of output prefixed by its
// part, and stops all three on Ctrl-C:
//
//   ml      python ml/service.py      :8000  the live predictor, taint and freeze
//   server  pnpm --dir server start   :4000  REST, Socket.IO, replay and live mode
//   client  pnpm --dir client dev     :3000  the dashboard
//
//   pnpm dev                 the server uses server/.env (MONGO_URL for replay)
//   pnpm dev:live            no database: live mode only (STREAM_ONLY=true)
//
// The live data generator is not started here: the server starts one for each
// live run, from the dashboard's Live switch. See docs/STREAMING.md.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const streamOnly = process.argv.includes("--stream-only");
const windows = process.platform === "win32";

const venvPython = [path.join(root, "ml", ".venv", "Scripts", "python.exe"), path.join(root, "ml", ".venv", "bin", "python")].find(existsSync);
const python = process.env.PYTHON_BIN ?? venvPython ?? (windows ? "python" : "python3");
if (!venvPython && !process.env.PYTHON_BIN) {
  console.warn("[dev] no ml/.venv found; using the system Python. Set one up with: python -m venv ml/.venv && ml/.venv/bin/pip install -r ml/requirements.txt");
}

const parts = [
  { name: "ml", color: 35, cmd: python, args: ["service.py"], cwd: path.join(root, "ml"), env: {} },
  {
    name: "server",
    color: 36,
    cmd: "pnpm",
    args: ["start"],
    cwd: path.join(root, "server"),
    env: { PYTHON_BIN: python, ...(streamOnly ? { STREAM_ONLY: "true" } : {}) },
  },
  { name: "client", color: 33, cmd: "pnpm", args: ["dev"], cwd: path.join(root, "client"), env: {} },
];

const children = [];
let stopping = false;

const prefix = (name, color) => `\x1b[${color}m${name.padEnd(6)}\x1b[0m │ `;

for (const part of parts) {
  const child = spawn(part.cmd, part.args, {
    cwd: part.cwd,
    env: { ...process.env, PYTHONUNBUFFERED: "1", ...part.env },
    // pnpm is a .cmd shim on Windows, which only a shell can run.
    shell: windows && part.cmd === "pnpm",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const tag = prefix(part.name, part.color);
  let carry = { out: "", err: "" };
  const relay = (key, stream) => (chunk) => {
    const text = carry[key] + chunk.toString();
    const lines = text.split(/\r?\n/);
    carry[key] = lines.pop() ?? "";
    for (const line of lines) stream.write(tag + line + "\n");
  };
  child.stdout.on("data", relay("out", process.stdout));
  child.stderr.on("data", relay("err", process.stderr));
  child.on("exit", (code) => {
    process.stdout.write(`${tag}exited with ${code}\n`);
    if (!stopping) stopAll(code ?? 1);
  });
  children.push(child);
}

function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null) continue;
    // On Windows a shell-wrapped child needs its whole tree ended.
    if (windows) spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    else child.kill("SIGINT");
  }
  setTimeout(() => process.exit(code), 1500);
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
