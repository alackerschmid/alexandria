import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware } from '../auth'
import { parseTagArray } from '../library-query'

const fields = new Hono<Env>()

const VALID_TYPES = ['text', 'integer', 'select', 'tag', 'date']

fields.use('*', authMiddleware)

fields.get('/', async (c) => {
  const userId = c.get('userId')
  const { results } = await c.env.DB
    .prepare('SELECT id, field_name AS name, field_type AS type, field_options AS options, sort_order, required FROM user_field_definitions WHERE user_id = ? ORDER BY sort_order')
    .bind(userId)
    .all()
  return c.json(results)
})

fields.post('/', async (c) => {
  const userId = c.get('userId')
  const { name, type = 'text' } = await c.req.json<{ name: string; type?: string }>()
  if (!name?.trim()) return c.json({ error: 'Name required' }, 400)
  if (!VALID_TYPES.includes(type)) return c.json({ error: 'Invalid type' }, 400)

  const maxOrder = await c.env.DB
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM user_field_definitions WHERE user_id = ?')
    .bind(userId)
    .first<{ max_order: number }>()

  try {
    const result = await c.env.DB
      .prepare('INSERT INTO user_field_definitions (user_id, field_name, field_type, sort_order) VALUES (?, ?, ?, ?)')
      .bind(userId, name.trim(), type, (maxOrder?.max_order ?? -1) + 1)
      .run()
    return c.json({ id: result.meta.last_row_id, name: name.trim(), type, required: false, sort_order: (maxOrder?.max_order ?? -1) + 1 }, 201)
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint failed')) return c.json({ error: 'A field with that name already exists' }, 409)
    return c.json({ error: 'Failed to create field' }, 500)
  }
})

fields.patch('/:id', async (c) => {
  const userId = c.get('userId')
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{ name?: string; type?: string; required?: boolean }>()

  if (body.type !== undefined && !VALID_TYPES.includes(body.type)) {
    return c.json({ error: 'Invalid type' }, 400)
  }

  const setClauses: string[] = []
  const bindings: unknown[] = []

  if (typeof body.name === 'string') {
    const trimmed = body.name.trim()
    if (!trimmed) return c.json({ error: 'Name cannot be empty' }, 400)
    setClauses.push('field_name = ?')
    bindings.push(trimmed)
  }
  if (typeof body.type === 'string') {
    setClauses.push('field_type = ?')
    bindings.push(body.type)
  }
  if (typeof body.required === 'boolean') {
    setClauses.push('required = ?')
    bindings.push(body.required ? 1 : 0)
  }

  if (setClauses.length === 0) return c.json({ error: 'Nothing to update' }, 400)

  bindings.push(id, userId)
  try {
    const result = await c.env.DB
      .prepare(`UPDATE user_field_definitions SET ${setClauses.join(', ')} WHERE id = ? AND user_id = ?`)
      .bind(...bindings)
      .run()
    if (!result.meta.changes) return c.json({ error: 'Not found' }, 404)

    const updated = await c.env.DB
      .prepare('SELECT id, field_name AS name, field_type AS type, field_options AS options, sort_order, required FROM user_field_definitions WHERE id = ?')
      .bind(id)
      .first()
    return c.json(updated)
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint failed')) return c.json({ error: 'A field with that name already exists' }, 409)
    return c.json({ error: 'Failed to update field' }, 500)
  }
})

fields.delete('/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const owned = await c.env.DB
    .prepare('SELECT 1 FROM user_field_definitions WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first()
  if (!owned) return c.json({ error: 'Not found' }, 404)
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM book_custom_fields WHERE field_def_id = ? AND user_id = ?').bind(id, userId),
    c.env.DB.prepare('DELETE FROM user_field_definitions WHERE id = ? AND user_id = ?').bind(id, userId),
  ])
  return c.json({ ok: true })
})


async function userOwnsField(db: D1Database, userId: number, id: number): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM user_field_definitions WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first()
  return !!row
}

// Distinct tag values used across the user's books for a field — powers the tag autocomplete.
fields.get('/:id/values', async (c) => {
  const userId = c.get('userId')
  const id = Number(c.req.param('id'))
  if (!(await userOwnsField(c.env.DB, userId, id))) return c.json({ error: 'Not found' }, 404)

  const { results } = await c.env.DB
    .prepare('SELECT field_value FROM book_custom_fields WHERE user_id = ? AND field_def_id = ? AND field_value IS NOT NULL')
    .bind(userId, id)
    .all<{ field_value: string }>()

  const distinct = new Set<string>()
  for (const r of results) for (const t of parseTagArray(r.field_value)) distinct.add(t)
  return c.json([...distinct].sort((a, b) => a.localeCompare(b)))
})

// Remove a tag value from every book the user owns (global tag delete).
fields.delete('/:id/values', async (c) => {
  const userId = c.get('userId')
  const id = Number(c.req.param('id'))
  const value = c.req.query('value')
  if (!value) return c.json({ error: 'Value required' }, 400)
  if (!(await userOwnsField(c.env.DB, userId, id))) return c.json({ error: 'Not found' }, 404)

  const { results } = await c.env.DB
    .prepare('SELECT id, field_value FROM book_custom_fields WHERE user_id = ? AND field_def_id = ? AND field_value IS NOT NULL')
    .bind(userId, id)
    .all<{ id: number; field_value: string }>()

  const updates = []
  for (const r of results) {
    const tags = parseTagArray(r.field_value)
    if (!tags.includes(value)) continue
    const remaining = tags.filter(t => t !== value)
    updates.push(
      c.env.DB
        .prepare('UPDATE book_custom_fields SET field_value = ? WHERE id = ?')
        .bind(remaining.length ? JSON.stringify(remaining) : null, r.id),
    )
  }
  if (updates.length) await c.env.DB.batch(updates)
  return c.json({ ok: true })
})

export default fields
