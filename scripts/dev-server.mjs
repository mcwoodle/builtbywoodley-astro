#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildAstroArgs,
  DEV_SERVER_USAGE,
  findMissingMapArtifacts,
  formatMissingArtifactsError,
  parseDevServerArgs,
} from "./dev-server-config.mjs";

const astroDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  console.error(`[dev-server] ${message}`);
  console.error(DEV_SERVER_USAGE);
  process.exit(1);
}

let devServerOptions;
try {
  devServerOptions = parseDevServerArgs(process.argv.slice(2));
} catch (error) {
  fail(error.message);
}

const missingArtifacts = await findMissingMapArtifacts(astroDirectory);
if (missingArtifacts.length > 0) {
  console.error(
    `[dev-server] ${formatMissingArtifactsError(
      astroDirectory,
      missingArtifacts,
    )}`,
  );
  process.exit(1);
}

const astroCommand = process.platform === "win32" ? "astro.cmd" : "astro";
const child = spawn(
  astroCommand,
  buildAstroArgs(devServerOptions),
  { cwd: astroDirectory, stdio: "inherit" },
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
