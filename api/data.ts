import { neon } from '@neondatabase/serverless'

const DATA_KEY = 'default'

type ApiResponse = {
  status: (code: number) => ApiResponse
  json: (body: unknown) => void
  setHeader: (name: string, value: string | string[]) => void
  end: () => void
}

type ApiRequest = {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}

function getDatabaseUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL
}

function getPassword(req: ApiRequest) {
  const header = req.headers['x-app-password']
  return Array.isArray(header) ? header[0] : header
}

function requireAuth(req: ApiRequest, res: ApiResponse) {
  const appPassword = process.env.APP_PASSWORD

  if (!appPassword) {
    res.status(500).json({ error: 'APP_PASSWORD is not configured.' })
    return false
  }

  if (getPassword(req) !== appPassword) {
    res.status(401).json({ error: 'Invalid app password.' })
    return false
  }

  return true
}

function parseBody(body: unknown) {
  if (!body) return {}
  if (typeof body === 'string') return JSON.parse(body) as Record<string, unknown>
  return body as Record<string, unknown>
}

async function ensureSchema(sql: ReturnType<typeof neon>) {
  await sql`
    CREATE TABLE IF NOT EXISTS scholarship_tracker_data (
      id TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-App-Password')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  if (!requireAuth(req, res)) return

  const databaseUrl = getDatabaseUrl()
  if (!databaseUrl) {
    res.status(500).json({ error: 'DATABASE_URL or POSTGRES_URL is not configured.' })
    return
  }

  const sql = neon(databaseUrl)
  await ensureSchema(sql)

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT payload, updated_at
      FROM scholarship_tracker_data
      WHERE id = ${DATA_KEY}
      LIMIT 1
    `

    const row = rows[0]
    res.status(200).json({
      universities: row?.payload ?? [],
      updatedAt: row?.updated_at ?? null,
    })
    return
  }

  if (req.method === 'POST') {
    const body = parseBody(req.body)
    const universities = Array.isArray(body.universities) ? body.universities : []

    const rows = await sql`
      INSERT INTO scholarship_tracker_data (id, payload, updated_at)
      VALUES (${DATA_KEY}, ${JSON.stringify(universities)}::jsonb, NOW())
      ON CONFLICT (id)
      DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
      RETURNING updated_at
    `

    res.status(200).json({
      ok: true,
      updatedAt: rows[0]?.updated_at ?? null,
    })
    return
  }

  res.status(405).json({ error: 'Method not allowed.' })
}
