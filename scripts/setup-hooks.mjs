#!/usr/bin/env node
// Set up local git hooks for secret scanning. Run automatically via the
// `prepare` npm script. Two responsibilities:
//
//   1. Fetch the official, version-pinned gitleaks binary and verify its
//      SHA-256 before use. We deliberately avoid the unofficial `gitleaks` npm
//      package (a stale v1.0.0 from an unknown maintainer) — for a security
//      tool that is a supply-chain risk. The binary is pulled straight from the
//      upstream GitHub release; anything whose checksum does not match the
//      pinned value is rejected, so a tampered or swapped artifact fails closed.
//   2. Install the lefthook git hooks (which run gitleaks on staged changes).
//
// Skips gitleaks download in CI (the GitHub Actions workflow uses
// gitleaks-action instead) and when the pinned version is already installed.
// If lefthook isn't present (e.g. a production install that omits devDeps),
// the hook install is skipped with a notice rather than failing the install.

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";

// --- Pinned release ---------------------------------------------------------
// To upgrade: bump VERSION and replace CHECKSUMS with the values from
// https://github.com/gitleaks/gitleaks/releases/download/v<VERSION>/gitleaks_<VERSION>_checksums.txt
const VERSION = "8.30.1";

// SHA-256 of each platform tarball, copied from the upstream checksums file.
const CHECKSUMS = {
  "darwin_arm64": "b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5",
  "darwin_x64": "dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709",
  "linux_arm64": "e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080",
  "linux_x64": "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const binDir = join(repoRoot, "node_modules", ".bin");
const binPath = join(binDir, "gitleaks");
const stampPath = join(repoRoot, "node_modules", ".gitleaks-version");

const lefthookBin = join(binDir, "lefthook");

function log(msg) {
  console.log(`[setup-hooks] ${msg}`);
}

// Map Node's platform/arch to the gitleaks release asset suffix.
function assetKey() {
  const platform = process.platform; // 'linux' | 'darwin' | 'win32'
  const arch = process.arch; // 'x64' | 'arm64'
  if (platform === "win32") return null; // hooks run gitleaks via Git Bash on Windows; skip auto-install
  const key = `${platform}_${arch}`;
  return key in CHECKSUMS ? key : null;
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  hash.update(await readFile(filePath));
  return hash.digest("hex");
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`download failed: ${res.status} ${res.statusText} for ${url}`);
  }
  await pipeline(res.body, createWriteStream(dest));
}

async function installGitleaks() {
  if (process.env.SKIP_GITLEAKS_INSTALL) {
    log("SKIP_GITLEAKS_INSTALL set — skipping gitleaks download.");
    return;
  }

  const key = assetKey();
  if (!key) {
    log(
      `no pinned binary for ${process.platform}/${process.arch}; ` +
        "install gitleaks manually (https://github.com/gitleaks/gitleaks) for local secret scanning.",
    );
    return;
  }

  // Already installed at the pinned version? Nothing to do.
  if (existsSync(binPath) && existsSync(stampPath)) {
    const stamped = (await readFile(stampPath, "utf8")).trim();
    if (stamped === VERSION) {
      log(`gitleaks ${VERSION} already installed.`);
      return;
    }
  }

  const asset = `gitleaks_${VERSION}_${key}.tar.gz`;
  const url = `https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/${asset}`;
  const expected = CHECKSUMS[key];

  const workDir = await mkdtemp(join(tmpdir(), "gitleaks-"));
  const tarPath = join(workDir, asset);
  try {
    log(`downloading ${asset} ...`);
    await download(url, tarPath);

    const actual = await sha256(tarPath);
    if (actual !== expected) {
      throw new Error(
        `SHA-256 mismatch for ${asset}\n  expected ${expected}\n  actual   ${actual}\n` +
          "Refusing to install a binary that does not match the pinned checksum.",
      );
    }
    log("checksum verified.");

    await mkdir(binDir, { recursive: true });
    // Extract just the `gitleaks` member straight into the bin dir. (We can't
    // extract to a temp dir and rename, because the OS tmpdir is often on a
    // different filesystem than the repo, which makes rename fail with EXDEV.)
    const res = spawnSync("tar", ["-xzf", tarPath, "-C", binDir, "gitleaks"], {
      stdio: "inherit",
    });
    if (res.status !== 0) {
      throw new Error("failed to extract gitleaks from the release tarball.");
    }
    await chmod(binPath, 0o755);
    await writeFile(stampPath, `${VERSION}\n`);
    log(`installed gitleaks ${VERSION} -> ${binPath}`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

// Install the lefthook-managed git hooks. Skipped (not failed) when lefthook
// isn't present — e.g. a production install that omits devDependencies, where
// hooks aren't wanted anyway.
function installLefthookHooks() {
  if (!existsSync(lefthookBin)) {
    log("lefthook not installed (devDependencies omitted?) — skipping hook install.");
    return;
  }
  const res = spawnSync(lefthookBin, ["install"], { stdio: "inherit" });
  if (res.status !== 0) {
    throw new Error("lefthook install failed.");
  }
}

async function main() {
  if (process.env.CI) {
    log("CI detected — skipping local hook setup (CI uses gitleaks-action).");
    return;
  }
  await installGitleaks();
  installLefthookHooks();
}

main().catch((err) => {
  console.error(`[setup-hooks] ERROR: ${err.message}`);
  process.exit(1);
});
