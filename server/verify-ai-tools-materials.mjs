import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import console from 'node:console';
import { mkdirSync, writeFileSync } from 'node:fs';
import { materialSamples, zipFixture } from './test-data/ai-tools-fixture.mjs';
const report = {
  at: new Date().toISOString(),
  status: 'FAIL',
  data: 'process-local deterministic CODEx_TEST_; no DB/real calls',
  tests: [],
};
try {
  const { extractMaterial } =
    await import('./src/agent/material-extractor.mjs');
  const test = async (name, run) => {
    await run();
    report.tests.push({ name, status: 'PASS' });
  };
  for (const sample of materialSamples())
    await test(`${sample.extension} actual content extraction with source hash`, async () => {
      const parsed = await extractMaterial(sample);
      assert.equal(parsed.status, 'READY');
      assert.equal(parsed.sourceHash, sample.sha256);
      assert.ok(parsed.segments.some((s) => s.text.includes('CODEx_TEST_')));
      if (sample.extension === 'html')
        assert.ok(!JSON.stringify(parsed).includes('SECRET_SCRIPT'));
      if (sample.extension === 'pdf')
        assert.equal(parsed.segments[0].location.page, 1);
      if (sample.extension === 'xlsx')
        assert.ok(
          parsed.segments.some(
            (s) =>
              s.text === '7' &&
              s.location.sheet === '提醒规则' &&
              s.location.cell === 'B1',
          ),
        );
    });
  await test('Malformed documents and unsupported formats fail explicitly', async () => {
    for (const extension of ['docx', 'xlsx', 'pdf', 'json'])
      await assert.rejects(
        extractMaterial({ bytes: Buffer.from('broken'), extension }),
        { code: 'MATERIAL_PARSE_FAILED' },
      );
    await assert.rejects(
      extractMaterial({ bytes: Buffer.from('gif'), extension: 'gif' }),
      { code: 'MATERIAL_FORMAT_UNSUPPORTED' },
    );
  });
  await test('Oversized and compressed-bomb input rejected before parsing', async () => {
    await assert.rejects(
      extractMaterial({
        bytes: Buffer.alloc(10 * 1024 * 1024 + 1),
        extension: 'txt',
      }),
      { code: 'MATERIAL_FILE_TOO_LARGE' },
    );
    const bytes = zipFixture({
      'word/document.xml': 'x'.repeat(2 * 1024 * 1024),
    });
    await assert.rejects(extractMaterial({ bytes, extension: 'docx' }), {
      code: 'MATERIAL_ARCHIVE_LIMIT',
    });
  });
  await test('ZIP path traversal and external relationships rejected', async () => {
    await assert.rejects(
      extractMaterial({
        bytes: zipFixture({ '../secret': 'CODEx_TEST_' }),
        extension: 'docx',
      }),
      { code: 'MATERIAL_ARCHIVE_INVALID' },
    );
    await assert.rejects(
      extractMaterial({
        bytes: zipFixture({
          'word/_rels/document.xml.rels':
            '<Relationship TargetMode="External" Target="file:///secret"/>',
        }),
        extension: 'docx',
      }),
      { code: 'MATERIAL_EXTERNAL_REFERENCE' },
    );
  });
  await test('Truncation is visible and old/new source hashes remain distinct', async () => {
    const a = await extractMaterial({
      bytes: Buffer.from('a'.repeat(200001)),
      extension: 'txt',
    });
    const b = await extractMaterial({
      bytes: Buffer.from('b'),
      extension: 'txt',
    });
    assert.equal(a.status, 'PARTIAL');
    assert.ok(a.warnings.includes('TEXT_TRUNCATED'));
    assert.notEqual(a.sourceHash, b.sourceHash);
  });
  await test('Images remain pending vision, invalid UTF-8 is not silently decoded', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvncAAAAASUVORK5CYII=',
      'base64',
    );
    const image = await extractMaterial({ bytes: png, extension: 'png' });
    assert.equal(image.status, 'NEEDS_VISION');
    assert.equal(image.width, 1);
    assert.equal(image.height, 1);
    assert.equal(image.segments.length, 0);
    await assert.rejects(
      extractMaterial({ bytes: Buffer.from([255, 255]), extension: 'txt' }),
      { code: 'MATERIAL_PARSE_FAILED' },
    );
  });
  report.status = 'PASS';
} catch (error) {
  report.error = {
    code: error.code || 'ASSERTION_FAILED',
    message: String(error.message).slice(0, 180),
  };
  process.exitCode = 1;
} finally {
  const root = 'docs/quality-gate/reports/ai-tools-integration-20260914';
  mkdirSync(root, { recursive: true });
  const file = `${root}/materials-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({
      status: report.status,
      tests: report.tests.length,
      file,
      error: report.error,
    }),
  );
}
