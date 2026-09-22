import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import sharp from 'sharp';
import stagePhotoMasters from '../src/integrations/stage-photo-masters.mjs';

// Child CLIs are ordinary programs, not nested Node test-runner workers.
const childEnv = { ...process.env };
delete childEnv.NODE_TEST_CONTEXT;
const exec = (file, args) => promisify(execFile)(file, args, { env: childEnv });
const prepare = resolve('scripts/prepare-master.mjs');
async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), 'photo-import-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8]) {
  test(`preparation honors the cap and rotation for EXIF orientation ${orientation}`, async (t) => {
    const root = await temporary(t);
    const source = join(root, 'source.jpg');
    const target = join(root, 'prepared.jpg');
    await sharp({ create: { width: 400, height: 300, channels: 3, background: '#336699' } })
      .jpeg().withMetadata({ orientation }).toFile(source);
    await exec(process.execPath, [prepare, '--max-long-edge=256', `--out=${target}`, source]);
    const metadata = await sharp(target).metadata();
    assert.deepEqual([metadata.width, metadata.height], orientation >= 5 ? [192, 256] : [256, 192]);
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.xmp, undefined);
    assert.equal(metadata.iptc, undefined);

    const original = await readFile(source);
    if (orientation !== 1) {
      await assert.rejects(exec(process.execPath, [prepare, '--strip-only', '--in-place', source]),
        { code: 1 });
      assert.deepEqual(await readFile(source), original, 'rejected imports must not overwrite the source');
    } else {
      const pixels = await sharp(source).raw().toBuffer();
      await exec(process.execPath, [prepare, '--strip-only', '--in-place', source]);
      assert.deepEqual(await sharp(source).raw().toBuffer(), pixels);
      assert.equal((await sharp(source).metadata()).exif, undefined);
    }
  });
}

test('preparation never enlarges smaller images and dry-run writes nothing', async (t) => {
  const root = await temporary(t);
  const source = join(root, 'small.jpg');
  const target = join(root, 'out.jpg');
  await sharp({ create: { width: 60, height: 80, channels: 3, background: '#336699' } }).jpeg().toFile(source);
  await exec(process.execPath, [prepare, '--max-long-edge=256', '--dry-run', `--out=${target}`, source]);
  await assert.rejects(readFile(target), { code: 'ENOENT' });
  await exec(process.execPath, [prepare, '--max-long-edge=256', `--out=${target}`, source]);
  const meta = await sharp(target).metadata();
  assert.deepEqual([meta.width, meta.height], [60, 80]);
});

test('staging validates paths and regular masters before replacing existing output', async (t) => {
  const root = await temporary(t);
  const content = join(root, 'src/content/photos');
  await mkdir(join(content, 'images'), { recursive: true });
  await mkdir(join(content, '_deploy'));
  await writeFile(join(content, 'images/master.jpg'), 'image fixture');
  await writeFile(join(content, 'outside.jpg'), 'outside');
  await mkdir(join(content, 'images/directory.jpg'));
  await symlink(join(content, 'outside.jpg'), join(content, 'images/link.jpg'));
  const manifest = join(content, 'manifest.mdx');
  const sentinel = join(content, '_deploy/previous.jpg');
  await writeFile(sentinel, 'previous');
  const warnings = [];
  const stage = () => stagePhotoMasters().hooks['astro:config:setup']({
    config: { root: pathToFileURL(`${root}/`) },
    logger: { info() {}, warn(message) { warnings.push(message); } },
  });
  for (const entry of [
    '  - master: ../outside.jpg\n    src: ./_deploy/test.jpg',
    `  - master: ${join(content, 'outside.jpg')}\n    src: ./_deploy/test.jpg`,
    '  - master: link.jpg\n    src: ./_deploy/test.jpg',
    '  - master: directory.jpg\n    src: ./_deploy/test.jpg',
    '  - master: master.jpg\n    src: ../_deploy/test.jpg',
    '  - master: master.jpg\n    src: ./other/_deploy/test.jpg',
    '  - master: master.jpg\n    src: ./_deploy/Bad Name.jpg',
    '  - master: master.jpg\n    src: ./_deploy/test.jpg\n  - master: master.jpg\n    src: ./_deploy/test.jpg',
  ]) {
    await writeFile(manifest, `---\nphotos:\n${entry}\n---\n`);
    await assert.rejects(stage(), /manifest.mdx/);
    assert.equal(await readFile(sentinel, 'utf8'), 'previous');
  }
  await writeFile(manifest, '---\nphotos:\n  - master: master.jpg\n    src: ./_deploy/test.jpg\n---\n');
  await stage();
  assert.equal(await readFile(join(content, '_deploy/test.jpg'), 'utf8'), 'image fixture');
  await assert.rejects(readFile(sentinel), { code: 'ENOENT' });
  await writeFile(manifest, '---\nphotos:\n  - src: ./images/master.jpg\n---\n');
  await stage();
  await assert.rejects(readFile(join(content, '_deploy/test.jpg')), { code: 'ENOENT' });
  assert.ok(warnings.some((message) => message.includes('link.jpg')));
});
