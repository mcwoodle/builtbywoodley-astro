import { stat } from "node:fs/promises";
import { join, relative } from "node:path";

export const DEFAULT_PORT = 5572;
export const REQUIRED_MAP_ARTIFACTS = [
  "public/viz/gta-crime-map.html",
  "public/viz/gta-crime-map-lite.html",
];

export const DEV_SERVER_USAGE =
  "Usage: npm run dev -- [PORT] or npm run dev -- --port PORT";

function validatePort(portValue) {
  const port = Number(portValue ?? DEFAULT_PORT);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `port must be an integer from 1 to 65535; received ${portValue}.`,
    );
  }

  return port;
}

export function parseDevServerArgs(args) {
  const forwardedArgs = [];
  let portValue;

  function setPort(value) {
    if (portValue !== undefined) {
      throw new Error("provide the port only once.");
    }
    if (value === undefined || value === "") {
      throw new Error("a port number is required.");
    }
    portValue = value;
  }

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

  return { port: validatePort(portValue), forwardedArgs };
}

export function buildAstroArgs({ port, forwardedArgs }) {
  return [
    "dev",
    "--host",
    "0.0.0.0",
    "--port",
    String(port),
    ...forwardedArgs,
  ];
}

export async function findMissingMapArtifacts(astroDirectory) {
  const availability = await Promise.all(
    REQUIRED_MAP_ARTIFACTS.map(async (artifact) => {
      try {
        const artifactStats = await stat(join(astroDirectory, artifact));
        return artifactStats.isFile() ? null : artifact;
      } catch {
        return artifact;
      }
    }),
  );

  return availability.filter(Boolean);
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function formatMissingArtifactsError(astroDirectory, missingArtifacts) {
  const displayPaths = missingArtifacts
    .map(
      (artifact) =>
        `  - ${relative(astroDirectory, join(astroDirectory, artifact))}`,
    )
    .join("\n");
  const destinationDirectory = join(astroDirectory, "public", "viz");

  return [
    "required GTA map artifacts are missing:",
    displayPaths,
    "",
    "Regenerate and copy both checked-in artifacts with:",
    'gta_map_source="$(mktemp -d)/gta-urban-analytics"',
    'git clone https://github.com/mcwoodle/gta-urban-analytics.git "$gta_map_source"',
    'cd "$gta_map_source"',
    "uv sync",
    "uv run full-pipeline",
    "uv run build-map",
    `mkdir -p ${shellQuote(destinationDirectory)}`,
    `cp visualize-kepler-map/dist/standalone.html ${shellQuote(
      join(destinationDirectory, "gta-crime-map.html"),
    )}`,
    `cp visualize-kepler-map/dist/standalone-lite.html ${shellQuote(
      join(destinationDirectory, "gta-crime-map-lite.html"),
    )}`,
  ].join("\n");
}
