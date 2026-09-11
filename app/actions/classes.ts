'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { classes } from '@/lib/db/schema'
import { headers } from 'next/headers'

export async function createClass(formData: FormData) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  const name = String(formData.get('name') || '').trim()
  const teacher = String(formData.get('teacher') || '').trim()
  const grade = Number(formData.get('grade') || 10)
  if (!name || !teacher || ![10, 11, 12].includes(grade)) throw new Error('Invalid class')
  return db.insert(classes).values({ userId: session.user.id, name, teacher, grade }).returning()
}
