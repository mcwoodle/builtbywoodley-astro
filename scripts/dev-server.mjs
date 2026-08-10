#!/usr/bin/env node

import { spawn } from "node:child_process";

const DEFAULT_PORT = 5572;
const forwardedArgs = [];
let portValue;

function fail(message) {
  console.error(`[dev-server] ${message}`);
  console.error(
    "Usage: npm run dev -- [PORT] or npm run dev -- --port PORT",
  );
  process.exit(1);
}

function setPort(value) {
  if (portValue !== undefined) fail("provide the port only once.");
  if (value === undefined || value === "") fail("a port number is required.");
  portValue = value;
}

const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];

  if (arg === "--port" || arg === "-p") {
    setPort(args[index + 1]);
    index += 1;
  } else if (arg.startsWith("--port=")) {
    setPort(arg.slice("--port=".length));
  } else if (/^\d+$/.test(arg)) {
    setPort(arg);
  } else {
    forwardedArgs.push(arg);
  }
}

const port = Number(portValue ?? DEFAULT_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  fail(`port must be an integer from 1 to 65535; received ${portValue}.`);
}

const astroCommand = process.platform === "win32" ? "astro.cmd" : "astro";
const child = spawn(
  astroCommand,
  ["dev", "--host", "0.0.0.0", "--port", String(port), ...forwardedArgs],
  { stdio: "inherit" },
);

child.on("error", (error) => {
  console.error(`[dev-server] failed to start Astro: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
