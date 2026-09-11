'use server'

import mammoth from 'mammoth'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { curricula } from '@/lib/db/schema'
import { headers } from 'next/headers'

export async function importCurriculum(formData: FormData) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  const file = formData.get('file')
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith('.docx')) throw new Error('Invalid file')
  const buffer = Buffer.from(await file.arrayBuffer())
  const result = await mammoth.extractRawText({ buffer })
  const text = result.value.trim()
  const gradeMatch = text.match(/(?:khối|lớp)\s*(10|11|12)/i)
  const lessonCount = (text.match(/\b(?:tiết|bài)\s*\d+/gi) || []).length
  const [record] = await db.insert(curricula).values({ userId: session.user.id, grade: Number(gradeMatch?.[1] || 10), title: file.name.replace(/\.docx$/i, ''), lessonCount }).returning()
  return record
}
