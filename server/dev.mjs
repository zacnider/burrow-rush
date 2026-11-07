import { spawn } from "node:child_process";

const children = [
  spawn(process.execPath, ["server/index.mjs"], { stdio: "inherit" }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "0.0.0.0"], { stdio: "inherit" }),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (!child.killed) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 150);
}

for (const child of children) {
  child.on("error", (error) => { console.error(error); stop(1); });
  child.on("exit", (code) => { if (!stopping && code !== 0) stop(code ?? 1); });
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
