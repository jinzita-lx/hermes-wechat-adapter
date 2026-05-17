import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { splitDirectives, isRemoteUrl, resolveWithinRoots } from '../src/directives.js';

test('isRemoteUrl distinguishes http(s) URLs from local paths', () => {
  assert.equal(isRemoteUrl('https://fal.media/files/a.png'), true);
  assert.equal(isRemoteUrl('http://example.com/x'), true);

  assert.equal(isRemoteUrl('/root/.hermes/secret.txt'), false);
  assert.equal(isRemoteUrl('file:///etc/passwd'), false);
  assert.equal(isRemoteUrl('not a url'), false);
  assert.equal(isRemoteUrl(''), false);
  assert.equal(isRemoteUrl(undefined), false);
});

test('splitDirectives captures https URL targets', () => {
  const { text, attachments } = splitDirectives(
    '生成好了 [[send_image:https://fal.media/files/abc.png]]',
  );

  assert.equal(text, '生成好了');
  assert.deepEqual(attachments, [
    { kind: 'send_image', path: 'https://fal.media/files/abc.png' },
  ]);
});

test('splitDirectives still captures local-path targets', () => {
  const { attachments } = splitDirectives('[[send_file:/tmp/report.pdf]]');

  assert.deepEqual(attachments, [
    { kind: 'send_file', path: '/tmp/report.pdf' },
  ]);
});

test('resolveWithinRoots accepts files inside a root, rejects everything else', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'other-'));
  try {
    const inside = path.join(root, 'img.png');
    fs.writeFileSync(inside, 'x');
    const outsideFile = path.join(outside, 'secret.txt');
    fs.writeFileSync(outsideFile, 'x');

    assert.equal(resolveWithinRoots(inside, [root]).ok, true);
    assert.equal(resolveWithinRoots(outsideFile, [root]).ok, false);          // outside the root
    assert.equal(resolveWithinRoots(path.join(root, 'nope.png'), [root]).ok, false); // missing file
    assert.equal(resolveWithinRoots(root, [root]).ok, false);                 // a directory, not a file
    assert.equal(resolveWithinRoots('relative/path.png', [root]).ok, false);  // not absolute
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
