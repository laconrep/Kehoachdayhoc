'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { lessons } from '@/lib/db/schema'
import { headers } from 'next/headers'

export async function generateSchedule(formData: FormData) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  const classId = Number(formData.get('classId'))
  const weeks = Number(formData.get('weeks'))
  const title = String(formData.get('title') || '').trim()
  if (!Number.isInteger(classId) || classId < 1 || !Number.isInteger(weeks) || weeks < 1 || weeks > 52 || !title) throw new Error('Invalid schedule')
  const rows = Array.from({ length: weeks }, (_, index) => ({ userId: session.user.id, classId, week: index + 1, day: 'Thứ Hai', period: 1, title, status: 'Bình thường', note: null }))
  return db.insert(lessons).values(rows).returning()
}

export async function updateLessonStatus(formData: FormData) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return { ok: true, userId: session.user.id, status: String(formData.get('status') || 'Bình thường') }
}
