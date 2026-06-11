#!/usr/bin/env node
/**
 * Lookup tool for the form-relay submission log in Neon.
 * Read-only, except --resend (which re-queues a row and triggers the
 * production retry endpoint, so the send runs through the real pipeline).
 *
 * Usage: npm run lookup -- [flags]
 * Full documentation: README → "Querying the submission log".
 */

import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const env = {};
  let text;
  try {
    text = readFileSync(resolve(ROOT, '.env'), 'utf8');
  } catch {
    return env;
  }
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

const HELP = `
form-relay submission lookup

  npm run lookup                              latest 20 submissions
  npm run lookup -- --form <id>               filter by form
  npm run lookup -- --status <s>              pending | sent | failed | bounced
  npm run lookup -- --since 2026-06-01        on/after a date (also --until)
  npm run lookup -- --search <text>           text search across the payload
  npm run lookup -- --limit 50                show more rows
  npm run lookup -- --id <uuid>               full detail for one submission
  npm run lookup -- --resend <uuid> [--force] re-send a submission's email
`;

const { values: args } = parseArgs({
  options: {
    form: { type: 'string' },
    status: { type: 'string' },
    since: { type: 'string' },
    until: { type: 'string' },
    search: { type: 'string' },
    id: { type: 'string' },
    resend: { type: 'string' },
    force: { type: 'boolean', default: false },
    limit: { type: 'string', default: '20' },
    help: { type: 'boolean', default: false },
  },
});

if (args.help) {
  console.log(HELP);
  process.exit(0);
}

const env = loadEnv();
const dbUrl = env.DATABASE_URL ?? env.form_relay_DATABASE_URL;
if (!dbUrl) {
  console.error('No DATABASE_URL in .env — nothing to query.');
  process.exit(1);
}
const sql = neon(dbUrl);

const summarize = (row) => ({
  id: row.id,
  form: row.form_id,
  status: row.status,
  attempts: row.attempts,
  created: new Date(row.created_at).toISOString().replace('T', ' ').slice(0, 16),
  from: [row.payload?.name, row.payload?.email].filter(Boolean).join(' · '),
  message: (row.payload?.message ?? '').replace(/\s+/g, ' ').slice(0, 48),
});

function printDetail(row) {
  console.log(`
Submission ${row.id}
  form:        ${row.form_id}
  status:      ${row.status} (${row.attempts} attempt${row.attempts === 1 ? '' : 's'})
  created:     ${row.created_at}
  sent:        ${row.sent_at ?? '—'}
  resend id:   ${row.resend_email_id ?? '—'}  (searchable in the Resend dashboard)
  payload:
${JSON.stringify(row.payload, null, 4).replace(/^/gm, '    ')}
`);
}

// ── --id: one row, full detail ──────────────────────────────────────────────
if (args.id) {
  const rows = await sql.query('SELECT * FROM submissions WHERE id = $1::uuid', [args.id]);
  if (!rows.length) {
    console.error(`No submission with id ${args.id}`);
    process.exit(1);
  }
  printDetail(rows[0]);
  process.exit(0);
}

// ── --resend: re-queue, then trigger the production retry endpoint ─────────
if (args.resend) {
  const rows = await sql.query('SELECT * FROM submissions WHERE id = $1::uuid', [args.resend]);
  if (!rows.length) {
    console.error(`No submission with id ${args.resend}`);
    process.exit(1);
  }
  const row = rows[0];

  if (row.status === 'bounced' && !args.force) {
    console.error(
      'This submission BOUNCED — its recipient address is bad, and re-sending would\n' +
        'hammer it (deliverability rule 5). Fix the address in the form config first.\n' +
        'If you have fixed it, re-run with --force.'
    );
    process.exit(1);
  }
  if (row.status === 'sent' && !args.force) {
    console.error(
      'This submission was already SENT — re-sending will deliver a duplicate email.\n' +
        'If that is what you want, re-run with --force.'
    );
    process.exit(1);
  }

  if (!env.CRON_SECRET) {
    console.error('No CRON_SECRET in .env — cannot trigger the retry endpoint.');
    process.exit(1);
  }
  const endpoint = env.FORM_RELAY_URL ?? 'https://form-relay-eta.vercel.app';

  await sql.query(
    "UPDATE submissions SET status = 'failed', attempts = 0 WHERE id = $1::uuid",
    [args.resend]
  );
  console.log('Row re-queued; triggering the production retry endpoint…');

  const res = await fetch(`${endpoint}/cron/retry`, {
    headers: { authorization: `Bearer ${env.CRON_SECRET}` },
  });
  console.log(`retry endpoint: HTTP ${res.status} ${await res.text()}`);

  const after = await sql.query('SELECT * FROM submissions WHERE id = $1::uuid', [args.resend]);
  printDetail(after[0]);
  process.exit(after[0].status === 'sent' ? 0 : 1);
}

// ── default: filtered list ──────────────────────────────────────────────────
const where = [];
const params = [];
const add = (clause, value) => {
  params.push(value);
  where.push(clause.replace('?', `$${params.length}`));
};

if (args.form) add('form_id = ?', args.form);
if (args.status) {
  if (!['pending', 'sent', 'failed', 'bounced'].includes(args.status)) {
    console.error(`Unknown status "${args.status}" — use pending, sent, failed or bounced.`);
    process.exit(1);
  }
  add('status = ?', args.status);
}
if (args.since) add('created_at >= ?::date', args.since);
if (args.until) add("created_at < ?::date + interval '1 day'", args.until);
if (args.search) add('payload::text ILIKE ?', `%${args.search}%`);

const limit = Math.min(parseInt(args.limit, 10) || 20, 200);
const query = `
  SELECT id, form_id, status, attempts, created_at, payload
  FROM submissions
  ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
  ORDER BY created_at DESC
  LIMIT ${limit}
`;

const rows = await sql.query(query, params);
if (!rows.length) {
  console.log('No matching submissions.');
} else {
  console.table(rows.map(summarize));
  console.log(`${rows.length} row${rows.length === 1 ? '' : 's'}. Use --id <uuid> for full detail.`);
}
