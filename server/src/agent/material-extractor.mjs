import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { Buffer } from 'node:buffer';
import { TextDecoder } from 'node:util';
import { URL } from 'node:url';
import { setTimeout, clearTimeout } from 'node:timers';
const FILE_LIMIT = 10 * 1024 * 1024;
const ARCHIVE_LIMIT = 50 * 1024 * 1024;
const TEXT_LIMIT = 200000;
const extensions = new Set([
  'txt',
  'md',
  'json',
  'csv',
  'html',
  'pdf',
  'docx',
  'xlsx',
  'png',
  'jpg',
  'jpeg',
]);
const knownErrors = new Set([
  'MATERIAL_FILE_TOO_LARGE',
  'MATERIAL_FORMAT_UNSUPPORTED',
  'MATERIAL_PARSE_FAILED',
  'MATERIAL_ARCHIVE_LIMIT',
  'MATERIAL_ARCHIVE_INVALID',
  'MATERIAL_EXTERNAL_REFERENCE',
  'MATERIAL_PARSE_TIMEOUT',
  'MATERIAL_IMAGE_TOO_LARGE',
]);
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};

// Inspect ZIP metadata AND bounded inflated bytes before invoking OOXML libraries.
// No entry is extracted to the filesystem and external relationships are rejected.
function inspectArchive(bytes) {
  if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x04034b50)
    fail('MATERIAL_PARSE_FAILED');
  let end = -1;
  for (
    let at = bytes.length - 22;
    at >= Math.max(0, bytes.length - 65557);
    at--
  ) {
    if (
      bytes.readUInt32LE(at) === 0x06054b50 &&
      at + 22 + bytes.readUInt16LE(at + 20) === bytes.length
    ) {
      end = at;
      break;
    }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6))
    fail('MATERIAL_ARCHIVE_INVALID');
  const count = bytes.readUInt16LE(end + 10),
    centralSize = bytes.readUInt32LE(end + 12);
  let at = bytes.readUInt32LE(end + 16),
    total = 0;
  if (!count || count > 2000 || at + centralSize !== end)
    fail('MATERIAL_ARCHIVE_LIMIT');
  const names = new Set();
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || bytes.readUInt32LE(at) !== 0x02014b50)
      fail('MATERIAL_ARCHIVE_INVALID');
    const flags = bytes.readUInt16LE(at + 8),
      method = bytes.readUInt16LE(at + 10);
    const compressed = bytes.readUInt32LE(at + 20),
      size = bytes.readUInt32LE(at + 24);
    const length = bytes.readUInt16LE(at + 28),
      extra = bytes.readUInt16LE(at + 30),
      comment = bytes.readUInt16LE(at + 32),
      local = bytes.readUInt32LE(at + 42);
    if (at + 46 + length + extra + comment > end)
      fail('MATERIAL_ARCHIVE_INVALID');
    const name = bytes.subarray(at + 46, at + 46 + length).toString('utf8');
    if (
      !name ||
      /[\\:\0]/.test(name) ||
      name.startsWith('/') ||
      name.split('/').some((p) => p === '..' || p === '.') ||
      names.has(name) ||
      flags & 1 ||
      ![0, 8].includes(method)
    )
      fail('MATERIAL_ARCHIVE_INVALID');
    names.add(name);
    total += size;
    if (
      total > ARCHIVE_LIMIT ||
      size / Math.max(1, compressed) > 100 ||
      local + 30 > bytes.length
    )
      fail('MATERIAL_ARCHIVE_LIMIT');
    if (bytes.readUInt32LE(local) !== 0x04034b50)
      fail('MATERIAL_ARCHIVE_INVALID');
    const localNameLength = bytes.readUInt16LE(local + 26),
      localExtraLength = bytes.readUInt16LE(local + 28),
      dataAt = local + 30 + localNameLength + localExtraLength;
    if (
      dataAt + compressed > bytes.readUInt32LE(end + 16) ||
      bytes
        .subarray(local + 30, local + 30 + localNameLength)
        .toString('utf8') !== name
    )
      fail('MATERIAL_ARCHIVE_INVALID');
    const packed = bytes.subarray(dataAt, dataAt + compressed);
    let content;
    try {
      content =
        method === 8
          ? inflateRawSync(packed, {
              maxOutputLength: Math.min(size + 1, ARCHIVE_LIMIT),
            })
          : packed;
    } catch {
      fail('MATERIAL_ARCHIVE_LIMIT');
    }
    if (content.length !== size) fail('MATERIAL_ARCHIVE_INVALID');
    if (
      name.endsWith('.rels') &&
      /TargetMode\s*=\s*["']External["']/i.test(content.toString('utf8'))
    )
      fail('MATERIAL_EXTERNAL_REFERENCE');
    if (
      name.endsWith('.xml') &&
      /<!DOCTYPE|<!ENTITY/i.test(content.toString('utf8'))
    )
      fail('MATERIAL_ARCHIVE_INVALID');
    at += 46 + length + extra + comment;
  }
  if (at !== end) fail('MATERIAL_ARCHIVE_INVALID');
}

function imageDimensions(bytes, extension) {
  if (extension === 'png') {
    if (
      bytes.length < 33 ||
      !bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      bytes.toString('ascii', 12, 16) !== 'IHDR'
    )
      fail('MATERIAL_PARSE_FAILED');
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  }
  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8)
    fail('MATERIAL_PARSE_FAILED');
  let at = 2;
  while (at + 4 < bytes.length) {
    if (bytes[at++] !== 255) fail('MATERIAL_PARSE_FAILED');
    while (bytes[at] === 255) at++;
    const marker = bytes[at++];
    if ([0xd8, 0x01].includes(marker)) continue;
    if ([0xd9, 0xda].includes(marker) || at + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(at);
    if (length < 2 || at + length > bytes.length) fail('MATERIAL_PARSE_FAILED');
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 7) fail('MATERIAL_PARSE_FAILED');
      return [bytes.readUInt16BE(at + 5), bytes.readUInt16BE(at + 3)];
    }
    at += length;
  }
  fail('MATERIAL_PARSE_FAILED');
}
function columnName(index) {
  let text = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    text = String.fromCharCode(65 + ((n - 1) % 26)) + text;
  return text;
}

async function parse(bytes, extension) {
  const sourceHash = createHash('sha256').update(bytes).digest('hex');
  const result = {
    status: 'READY',
    sourceHash,
    format: extension,
    parser: 'pfc-text-v1',
    segments: [],
    warnings: [],
  };
  let characters = 0;
  const warning = (code) => {
    result.status = 'PARTIAL';
    if (!result.warnings.includes(code)) result.warnings.push(code);
  };
  const add = (text, location) => {
    if (!text) return;
    const remaining = TEXT_LIMIT - characters;
    if (text.length > remaining) {
      text = text.slice(0, remaining);
      warning('TEXT_TRUNCATED');
    }
    if (!text) return;
    characters += text.length;
    const id = createHash('sha256')
      .update(sourceHash + JSON.stringify(location) + text)
      .digest('hex');
    result.segments.push({ id, location, text });
  };
  if (['png', 'jpg', 'jpeg'].includes(extension)) {
    const [width, height] = imageDimensions(bytes, extension);
    if (!width || !height || width * height > 20000000)
      fail('MATERIAL_IMAGE_TOO_LARGE');
    return {
      ...result,
      status: 'NEEDS_VISION',
      width,
      height,
      parser: 'pfc-image-metadata-v1',
      warnings: ['VISION_PROVIDER_NOT_YET_VERIFIED'],
    };
  }
  if (['docx', 'xlsx'].includes(extension)) inspectArchive(bytes);
  if (extension === 'docx') {
    const mammoth = await import('mammoth');
    const extracted = await mammoth.default.extractRawText({ buffer: bytes });
    result.parser = 'mammoth@1.12.3';
    extracted.value
      .split(/\n\n/)
      .forEach((text, index) => add(text.trim(), { paragraph: index + 1 }));
    if (extracted.messages?.length) warning('DOCUMENT_PARSE_WARNINGS');
  } else if (extension === 'xlsx') {
    const read = (await import('read-excel-file/node')).default;
    const sheets = await read(bytes);
    result.parser = 'read-excel-file@9.3.10';
    if (sheets.length > 20) warning('SHEETS_TRUNCATED');
    let cells = 0;
    for (const sheet of sheets.slice(0, 20))
      for (const [row, values] of sheet.data.entries())
        for (const [column, value] of values.entries()) {
          if (value === null || value === undefined || value === '') continue;
          if (++cells > 20000) {
            warning('CELLS_TRUNCATED');
            continue;
          }
          add(value instanceof Date ? value.toISOString() : String(value), {
            sheet: sheet.sheet,
            row: row + 1,
            column: column + 1,
            cell: `${columnName(column)}${row + 1}`,
          });
        }
  } else if (extension === 'pdf') {
    if (bytes.toString('ascii', 0, 5) !== '%PDF-')
      fail('MATERIAL_PARSE_FAILED');
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loading = getDocument({
      data: new Uint8Array(bytes),
      disableFontFace: true,
      useSystemFonts: false,
      stopAtErrors: true,
      isEvalSupported: false,
      verbosity: 0,
    });
    try {
      const doc = await loading.promise;
      result.parser = 'pdfjs-dist@6.3.289';
      if (doc.numPages > 100) warning('PAGES_TRUNCATED');
      let missingText = false;
      for (let page = 1; page <= Math.min(doc.numPages, 100); page++) {
        const content = await (await doc.getPage(page)).getTextContent();
        const text = content.items
          .map((item) => (typeof item.str === 'string' ? item.str : ''))
          .filter(Boolean)
          .join(' ');
        if (!text.trim()) missingText = true;
        add(text, { page });
      }
      if (missingText) warning('PAGES_WITHOUT_TEXT_OCR_UNSUPPORTED');
    } finally {
      await loading.destroy();
    }
  } else {
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      fail('MATERIAL_PARSE_FAILED');
    }
    if (extension === 'json') {
      try {
        JSON.parse(text);
      } catch {
        fail('MATERIAL_PARSE_FAILED');
      }
    }
    if (extension === 'html')
      text = text
        .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
        .replace(/<!--[^]*?-->/g, '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
    text
      .split(/\r?\n/)
      .forEach((line, index) => add(line, { line: index + 1 }));
  }
  result.characters = characters;
  if (!result.segments.length) warning('NO_EXTRACTABLE_TEXT');
  return result;
}

export async function extractMaterial({ bytes, extension }) {
  if (!(bytes instanceof Uint8Array)) fail('MATERIAL_PARSE_FAILED');
  if (bytes.byteLength > FILE_LIMIT) fail('MATERIAL_FILE_TOO_LARGE');
  if (!extensions.has(extension)) fail('MATERIAL_FORMAT_UNSUPPORTED');
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { bytes, extension },
      resourceLimits: {
        maxOldGenerationSizeMb: 128,
        maxYoungGenerationSizeMb: 16,
        stackSizeMb: 4,
      },
      stdout: true,
      stderr: true,
    });
    // Library warnings can contain document fragments. Keep raw output out of logs.
    worker.stdout.resume();
    worker.stderr.resume();
    let settled = false;
    const finish = async (value, code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      await worker.terminate();
      if (code) reject(Object.assign(new Error(code), { code }));
      else resolve(value);
    };
    const timer = setTimeout(() => {
      void finish(null, 'MATERIAL_PARSE_TIMEOUT');
    }, 10000);
    worker.once('message', (message) => {
      void finish(message.result, message.error);
    });
    worker.once('error', () => {
      void finish(null, 'MATERIAL_PARSE_FAILED');
    });
    worker.once('exit', () => {
      if (!settled) void finish(null, 'MATERIAL_PARSE_FAILED');
    });
  });
}

if (!isMainThread) {
  try {
    parentPort.postMessage({
      result: await parse(Buffer.from(workerData.bytes), workerData.extension),
    });
  } catch (e) {
    parentPort.postMessage({
      error: knownErrors.has(e.code) ? e.code : 'MATERIAL_PARSE_FAILED',
    });
  }
}
