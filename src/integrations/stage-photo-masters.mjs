// Gives every photograph a short, stable filename in the deployed site while
// the repository keeps the archival one.
//
// The problem it solves: Astro derives the name of every emitted asset from the
// source file's basename. A master committed as
//
//   2015-06-17 - Allium - IMG_20150617_134550.jpg
//
// therefore ships eleven derivatives all called
// `/_astro/2015-06-17%20-%20Allium%20-%20IMG_20150617_134550.O8sh2kp3_JQpDB.webp`
// — percent-encoded, forty characters of noise repeated in every `srcset`, and
// awkward for anything that has to round-trip a URL. Renaming the masters would
// fix it and lose the provenance the filenames carry, which is the reason they
// are worth keeping: the capture date and the camera's own frame number.
//
// So both. `master` in the manifest is the archival file, committed and never
// touched. `src` points at a short name under _deploy/, which this integration
// materialises from the master before Astro reads the content collection.
// _deploy/ is generated and gitignored; deleting it costs one rebuild.
//
// Runs on `astro:config:setup`, so it covers dev, build and check alike rather
// than only whichever one remembered to call a prebuild script.

import { copyFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTENT_DIR = 'src/content/photos';
const MANIFEST = `${CONTENT_DIR}/manifest.mdx`;
const MASTERS_DIR = `${CONTENT_DIR}/images`;
const STAGE_DIR = `${CONTENT_DIR}/_deploy`;

/** A deployed name has to survive being a URL without being encoded. */
const SIMPLE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:jpg|jpeg|png|webp|avif)$/;

/**
 * Pull `master` / `src` pairs out of the manifest's YAML frontmatter.
 *
 * Deliberately a small hand-rolled reader rather than a YAML dependency: this
 * has to run before Astro has loaded anything, it only needs two keys, and the
 * shape it accepts is asserted below — a manifest it cannot read fails the
 * build with the reason rather than silently staging nothing.
 */
function readPairs(source) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!frontmatter) throw new Error(`${MANIFEST} has no YAML frontmatter.`);

  const unquote = (value) => value.trim().replace(/^["']|["']$/g, '');
  const pairs = [];
  let current = null;

  for (const line of frontmatter[1].split('\n')) {
    // A new list item starts a new entry; `- master:` or `- src:` both count.
    const item = /^\s*-\s+(master|src):\s*(.+)$/.exec(line);
    const field = /^\s+(master|src):\s*(.+)$/.exec(line);

    if (item) {
      if (current) pairs.push(current);
      current = { [item[1]]: unquote(item[2]) };
    } else if (/^\s*-\s/.test(line)) {
      if (current) pairs.push(current);
      current = {};
    } else if (field && current) {
      current[field[1]] = unquote(field[2]);
    }
  }
  if (current) pairs.push(current);

  return pairs.filter((entry) => entry.master || entry.src);
}

export default function stagePhotoMasters() {
  return {
    name: 'stage-photo-masters',
    hooks: {
      'astro:config:setup': async ({ config, logger }) => {
        const root = fileURLToPath(config.root);
        const manifestPath = join(root, MANIFEST);
        const stageDir = join(root, STAGE_DIR);

        const entries = readPairs(await readFile(manifestPath, 'utf8'));
        const staged = entries.filter((entry) => entry.master);

        if (staged.length === 0) {
          // Nothing declares a master, so nothing needs staging. Not an error:
          // a manifest may legitimately point straight at its images.
          await rm(stageDir, { recursive: true, force: true });
          return;
        }

        // Rebuilt from scratch every run, so a photograph removed from the
        // manifest cannot leave a stale file behind for Astro to emit.
        await rm(stageDir, { recursive: true, force: true });
        await mkdir(stageDir, { recursive: true });

        const seen = new Set();
        for (const entry of staged) {
          if (!entry.src) {
            throw new Error(
              `${MANIFEST}: "${entry.master}" declares a master but no src to stage it as.`,
            );
          }

          const deployName = basename(entry.src);
          if (!SIMPLE_NAME.test(deployName)) {
            throw new Error(
              `${MANIFEST}: "${deployName}" is not a usable deployed name. ` +
                'Use lowercase words separated by single hyphens, e.g. ./_deploy/allium.jpg — ' +
                'this becomes a public URL, and anything else has to be percent-encoded.',
            );
          }
          if (seen.has(deployName)) {
            throw new Error(`${MANIFEST}: two photographs both deploy as "${deployName}".`);
          }
          seen.add(deployName);

          // `src` is resolved relative to the manifest, so its directory has to
          // be the staging directory or the copy lands somewhere Astro is not
          // looking.
          const srcDir = basename(dirname(entry.src));
          if (srcDir !== basename(STAGE_DIR)) {
            throw new Error(
              `${MANIFEST}: "${entry.src}" must live in ./${basename(STAGE_DIR)}/ ` +
                'when a master is declared.',
            );
          }

          const from = join(root, MASTERS_DIR, entry.master);
          if (!(await stat(from).catch(() => null))) {
            throw new Error(`${MANIFEST}: master "${entry.master}" is not in ${MASTERS_DIR}/.`);
          }

          await copyFile(from, join(stageDir, deployName));
        }

        // Masters nobody references are dead weight in the repository, and the
        // usual reason is a manifest edit that forgot one. Worth a word.
        const masters = (await readdir(join(root, MASTERS_DIR)).catch(() => [])).filter((name) =>
          /\.(jpe?g|png|webp|avif)$/i.test(name),
        );
        const referenced = new Set(staged.map((entry) => entry.master));
        const direct = new Set(
          entries.filter((entry) => !entry.master && entry.src).map((entry) => basename(entry.src)),
        );
        const unused = masters.filter((name) => !referenced.has(name) && !direct.has(name));
        if (unused.length > 0) {
          logger.warn(
            `${unused.length} master(s) in ${MASTERS_DIR}/ are in no manifest entry: ${unused.join(', ')}`,
          );
        }

        logger.info(`Staged ${staged.length} master(s) under ${STAGE_DIR}/ with deployed names.`);
      },
    },
  };
}
