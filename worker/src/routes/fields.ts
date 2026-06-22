import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware } from '../auth'

const fields = new Hono<Env>()

fields.use('*', authMiddleware)

fields.get('/', async (c) => {
  const userId = c.get('userId')
  const { results } = await c.env.DB
    .prepare('SELECT id, field_name AS name, field_type AS type, field_options AS options, sort_order FROM user_field_definitions WHERE user_id = ? ORDER BY sort_order')
    .bind(userId)
    .all()
  return c.json(results)
})

fields.post('/', async (c) => {
  const userId = c.get('userId')
  const { name, type = 'text' } = await c.req.json<{ name: string; type?: string }>()
  if (!name?.trim()) return c.json({ error: 'Name required' }, 400)
  const VALID_TYPES = ['text', 'integer', 'select']
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
    return c.json({ id: result.meta.last_row_id, name: name.trim(), type, sort_order: (maxOrder?.max_order ?? -1) + 1 }, 201)
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint failed')) return c.json({ error: 'A field with that name already exists' }, 409)
    return c.json({ error: 'Failed to create field' }, 500)
  }
})

fields.delete('/:id', async (c) => {
  const userId = c.get('userId')
  const result = await c.env.DB
    .prepare('DELETE FROM user_field_definitions WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), userId)
    .run()
  if (!result.meta.changes) return c.json({ error: 'Not found' }, 404)
  return c.json({ ok: true })
})

export default fields
