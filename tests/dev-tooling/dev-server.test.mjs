import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  buildAstroArgs,
  DEFAULT_PORT,
  findMissingMapArtifacts,
  formatMissingArtifactsError,
  parseDevServerArgs,
  REQUIRED_MAP_ARTIFACTS,
} from "../../scripts/dev-server-config.mjs";

test("uses the established default port", () => {
  assert.deepEqual(parseDevServerArgs([]), {
    port: DEFAULT_PORT,
    forwardedArgs: [],
  });
});

test("parses every supported port form", () => {
  for (const args of [
    ["6010"],
    ["--port", "6010"],
    ["-p", "6010"],
    ["--port=6010"],
  ]) {
    assert.equal(parseDevServerArgs(args).port, 6010);
  }
});

test("rejects invalid and duplicate ports", () => {
  for (const args of [
    ["0"],
    ["65536"],
    ["--port", "1.5"],
    ["--port", "not-a-port"],
  ]) {
    assert.throws(() => parseDevServerArgs(args), /integer from 1 to 65535/);
  }

  assert.throws(
    () => parseDevServerArgs(["6010", "--port=6011"]),
    /provide the port only once/,
  );
  assert.throws(
    () => parseDevServerArgs(["--port"]),
    /a port number is required/,
  );
});

test("forwards unrelated Astro arguments in their original order", () => {
  const parsed = parseDevServerArgs([
    "--open",
    "--port=6010",
    "--verbose",
    "--host",
    "127.0.0.1",
  ]);

  assert.deepEqual(parsed.forwardedArgs, [
    "--open",
    "--verbose",
    "--host",
    "127.0.0.1",
  ]);
  assert.deepEqual(buildAstroArgs(parsed), [
    "dev",
    "--host",
    "0.0.0.0",
    "--port",
    "6010",
    "--open",
    "--verbose",
    "--host",
    "127.0.0.1",
  ]);
});

async function withArtifactFixture(artifacts, callback) {
  const fixture = await mkdtemp(join(tmpdir(), "astro-dev-tooling-"));

  try {
    for (const artifact of artifacts) {
      const artifactPath = join(fixture, artifact);
      await mkdir(dirname(artifactPath), { recursive: true });
      await writeFile(artifactPath, "fixture");
    }
    await callback(fixture);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}

test("preflight succeeds when both artifacts are present", async () => {
  await withArtifactFixture(REQUIRED_MAP_ARTIFACTS, async (fixture) => {
    assert.deepEqual(await findMissingMapArtifacts(fixture), []);
  });
});

test("preflight identifies either missing artifact", async () => {
  for (const presentArtifact of REQUIRED_MAP_ARTIFACTS) {
    await withArtifactFixture([presentArtifact], async (fixture) => {
      const expectedMissing = REQUIRED_MAP_ARTIFACTS.filter(
        (artifact) => artifact !== presentArtifact,
      );
      assert.deepEqual(await findMissingMapArtifacts(fixture), expectedMissing);
    });
  }
});

test("preflight identifies both missing artifacts", async () => {
  await withArtifactFixture([], async (fixture) => {
    assert.deepEqual(
      await findMissingMapArtifacts(fixture),
      REQUIRED_MAP_ARTIFACTS,
    );
  });
});

test("preflight failure includes the complete portable regeneration workflow", async () => {
  await withArtifactFixture([], async (fixture) => {
    const output = formatMissingArtifactsError(
      fixture,
      await findMissingMapArtifacts(fixture),
    );

    for (const expected of [
      "public/viz/gta-crime-map.html",
      "public/viz/gta-crime-map-lite.html",
      'gta_map_source="$(mktemp -d)/gta-urban-analytics"',
      'git clone https://github.com/mcwoodle/gta-urban-analytics.git "$gta_map_source"',
      'cd "$gta_map_source"',
      "uv sync",
      "uv run full-pipeline",
      "uv run build-map",
      "visualize-kepler-map/dist/standalone.html",
      "visualize-kepler-map/dist/standalone-lite.html",
      join(fixture, "public", "viz", "gta-crime-map.html"),
      join(fixture, "public", "viz", "gta-crime-map-lite.html"),
    ]) {
      assert.match(
        output,
        new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    }

    assert.doesNotMatch(output, /\/workspace\//);
  });
});
