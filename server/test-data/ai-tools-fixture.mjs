import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';

// All fixture bytes are constructed from public formats and synthetic content.
const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};
export function zipFixture(entries) {
  const locals = [],
    central = [];
  let offset = 0;
  for (const [filename, source] of Object.entries(entries)) {
    const name = Buffer.from(filename),
      bytes = Buffer.from(source),
      packed = deflateRawSync(bytes),
      crc = crc32(bytes);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(8, 8);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(bytes.length, 22);
    head.writeUInt16LE(name.length, 26);
    locals.push(head, name, packed);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(packed.length, 20);
    dir.writeUInt32LE(bytes.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += head.length + name.length + packed.length;
  }
  const table = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(table.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, table, end]);
}
const xml = (s) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${s}`;
const rel = (items) =>
  xml(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items}</Relationships>`,
  );
const contentTypes = (part, type) =>
  xml(
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="${part}" ContentType="${type}"/></Types>`,
  );

export function docxFixture() {
  return zipFixture({
    '[Content_Types].xml': contentTypes(
      '/word/document.xml',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    ),
    '_rels/.rels': rel(
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    ),
    'word/document.xml': xml(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>CODEx_TEST_积分在到期前7天提醒。</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>提醒次数</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
    ),
  });
}
export function xlsxFixture() {
  return zipFixture({
    '[Content_Types].xml': contentTypes(
      '/xl/workbook.xml',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
    ),
    '_rels/.rels': rel(
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
    ),
    'xl/workbook.xml': xml(
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="提醒规则" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': rel(
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>',
    ),
    'xl/worksheets/sheet1.xml': xml(
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>CODEx_TEST_提前天数</t></is></c><c r="B1"><v>7</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>次数</t></is></c><c r="B2"><v>1</v></c></row></sheetData></worksheet>',
    ),
  });
}
export function pdfFixture(text = 'CODEx_TEST_remind_7_days') {
  if (!/^[\w .-]+$/.test(text)) throw Error('SYNTHETIC_PDF_TEXT_INVALID');
  const content = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = Buffer.byteLength(body);
  body += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((x) => String(x).padStart(10, '0') + ' 00000 n ')
    .join(
      '\n',
    )}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(body);
}
export function materialSamples() {
  return [
    {
      extension: 'txt',
      bytes: Buffer.from('CODEx_TEST_规则\n积分到期前7天提醒。'),
    },
    {
      extension: 'md',
      bytes: Buffer.from('# CODEx_TEST_规则\n提前7天，最多1次。'),
    },
    {
      extension: 'json',
      bytes: Buffer.from('{"case":"CODEx_TEST_rule","days":7}'),
    },
    { extension: 'csv', bytes: Buffer.from('case,days\nCODEx_TEST_rule,7') },
    {
      extension: 'html',
      bytes: Buffer.from(
        '<html><script>SECRET_SCRIPT()</script><p>CODEx_TEST_规则：提前7天</p></html>',
      ),
    },
    { extension: 'docx', bytes: docxFixture() },
    { extension: 'xlsx', bytes: xlsxFixture() },
    { extension: 'pdf', bytes: pdfFixture() },
  ].map((x) => ({
    ...x,
    sha256: createHash('sha256').update(x.bytes).digest('hex'),
  }));
}

export function textConversationFixture(Conversation, cwd) {
  const calls = [];
  const state = { closed: false };
  const session = new Conversation();
  session.threadId = 'CODEx_TEST_thread';
  session.connection = {
    cwd,
    summary: { model: 'synthetic' },
    rpc: {
      child: {
        kill: () => {
          state.closed = true;
        },
      },
      request: async (method) => {
        calls.push(method);
        if (method === 'turn/start') return { turn: { id: 'CODEx_TEST_turn' } };
        return {};
      },
    },
    close: async () => {
      state.closed = true;
      return { process: { closed: true } };
    },
  };
  return { session, calls, state };
}

export async function instructionSourceFixture() {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { resolve, join } = await import('node:path');
  const root = resolve('.local/ai-tools-integration-20260914');
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'CODEx_TEST_context_'));
  const file = join(dir, 'AGENTS.md');
  const content = Buffer.from('CODEx_TEST_explicit_global_methodology\n');
  await writeFile(file, content);
  return {
    file,
    approval: {
      path: file,
      bytes: content.length,
      sha256: createHash('sha256').update(content).digest('hex'),
    },
    change: () => writeFile(file, 'CODEx_TEST_changed_methodology\n'),
    addOverride: () =>
      writeFile(join(dir, 'AGENTS.override.md'), 'CODEx_TEST_override'),
    cleanup: () => rm(dir, { recursive: true }),
  };
}

export async function aiDatabaseFixture(scope = 'api') {
  const { createRequire } = await import('node:module');
  const { readFileSync } = await import('node:fs');
  const { parseEnv } = await import('node:util');
  const { randomUUID } = await import('node:crypto');
  const require = createRequire(import.meta.url);
  const { Pool } = require('pg');
  const {
    validateTarget,
    openDatabase,
  } = require('../src/persistence/connection');
  if (!['api', 'real', 'browser', 'exec', 'execbrowser', 'exece2e', 'closedloop'].includes(scope))
    throw Error('TEST_SCOPE_INVALID');
  const schema = 'codex_test_ai_tools_20260914_' + scope;
  const runId =
    'CODEx_TEST_M2C_AI_TOOLS_20260914_' + scope + '_' + randomUUID();
  const options = {
    mode: 'pg',
    schema,
    authorizedSchema: schema,
    targetVersion: '007',
    connectionString: parseEnv(
      readFileSync(new URL('../../.env.local', import.meta.url), 'utf8'),
    ).DATABASE_URL,
  };
  const { pg } = validateTarget(options);
  if (pg.port !== 5432) throw Error('TEST_PORT_INVALID');
  const admin = new Pool({
    ...pg,
    max: 1,
    connectionTimeoutMillis: 3000,
    statement_timeout: 3000,
  });
  let ownedOid, db, before;
  const createdIds = [];
  const marker = runId;
  const fingerprint = async () =>
    createHash('sha256')
      .update(
        JSON.stringify(
          (
            await admin.query(
              "SELECT n.nspname,c.relname,c.relkind,a.attname,a.atttypid,a.attnotnull FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND n.nspname<>$1 ORDER BY 1,2,3,4",
              [schema],
            )
          ).rows,
        ),
      )
      .digest('hex');
  const cleanup = async () => {
    await db?.close();
    try {
      let totalRows = 0;
      if (ownedOid) {
        const owner = (
          await admin.query(
            "SELECT oid,obj_description(oid,'pg_namespace') marker FROM pg_namespace WHERE nspname=$1 AND nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)",
            [schema],
          )
        ).rows[0];
        if (owner?.oid !== ownedOid || owner.marker !== marker)
          throw Error('TEST_OWNERSHIP_CHANGED');
        const m = require('../src/persistence/migrations');
        const allowed = [
          ...m.tables,
          ...m.domainTables,
          ...m.governanceTables,
          ...m.artifactTables,
          ...require('../src/persistence/verification-readiness').tables,
          ...require('../src/persistence/release-readiness').tables,
          ...require('../src/persistence/agent-jobs').tables,
        ];
        const actual = (
          await admin.query(
            'SELECT tablename FROM pg_tables WHERE schemaname=$1',
            [schema],
          )
        ).rows.map((r) => r.tablename);
        if (actual.some((t) => !allowed.includes(t)))
          throw Error('TEST_TABLE_UNEXPECTED');
        for (const table of actual)
          totalRows += Number(
            (await admin.query(`SELECT count(*) n FROM "${schema}"."${table}"`))
              .rows[0].n,
          );
        if (totalRows > 10000) throw Error('TEST_ROW_LIMIT');
        if (
          actual.includes('tenants') &&
          (
            await admin.query(
              `SELECT id FROM "${schema}".tenants WHERE left(name,$1)<>$2`,
              [runId.length, runId],
            )
          ).rowCount
        )
          throw Error('NON_SYNTHETIC_TEST_DATA');
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
      const remaining = (
        await admin.query('SELECT oid FROM pg_namespace WHERE nspname=$1', [
          schema,
        ])
      ).rowCount;
      const unchanged = !before || before === (await fingerprint());
      if (remaining || !unchanged) throw Error('TEST_CLEANUP_MISMATCH');
      return {
        schema,
        runId,
        createdIds,
        totalRows,
        remaining,
        externalSchemaMetadataUnchanged: unchanged,
        poolsClosed: true,
      };
    } finally {
      await admin.end();
    }
  };
  try {
    const target = (
      await admin.query(
        "SELECT current_database() db,current_user role,current_setting('listen_addresses') listen,current_setting('server_version_num')::int version",
      )
    ).rows[0];
    if (
      target.db !== 'pfc_local' ||
      target.role !== 'pfc_app_local' ||
      target.listen !== '127.0.0.1' ||
      target.version < 180000 ||
      target.version >= 190000
    )
      throw Error('TEST_TARGET_MISMATCH');
    if (
      (
        await admin.query('SELECT oid FROM pg_namespace WHERE nspname=$1', [
          schema,
        ])
      ).rowCount
    )
      throw Error('TEST_SCHEMA_EXISTS');
    before = await fingerprint();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    ownedOid = (
      await admin.query('SELECT oid FROM pg_namespace WHERE nspname=$1', [
        schema,
      ])
    ).rows[0].oid;
    await admin.query(`COMMENT ON SCHEMA "${schema}" IS '${marker}'`);
    db = await openDatabase({ ...options, requireReady: false });
    const seed = async () => {
      const ctx = {
        tenantId: randomUUID(),
        memberId: randomUUID(),
        actor: runId + '_owner',
        role: 'owner',
      };
      await db.pool.query(
        `INSERT INTO "${schema}".tenants(id,name) VALUES($1,$2)`,
        [ctx.tenantId, runId],
      );
      await db.pool.query(
        `INSERT INTO "${schema}".members(id,tenant_id,public_id,name,role,active) VALUES($1,$2,$3,$4,'owner',true)`,
        [ctx.memberId, ctx.tenantId, 'MEM-' + randomUUID(), ctx.actor],
      );
      const result =
        await require('../src/persistence/requirements').createRequirement(
          db,
          ctx,
          { name: runId + '_积分提醒', goal: '提前7天提醒', scope: '合成数据' },
        );
      createdIds.push(ctx.tenantId, ctx.memberId, result.requirement.id);
      return { ctx, req: result.requirement };
    };
    return { db, admin, options, runId, createdIds, cleanup, seed };
  } catch (e) {
    if (ownedOid) await cleanup();
    else await admin.end();
    throw e;
  }
}
