'use server'

import { parseDocx } from '@/lib/ppct/parse-docx'
import { saveImport, updateSavedPpct } from '@/lib/ppct/api'
import { requireUser } from '@/lib/session'
import { GRADES, type TrackType } from '@/lib/ppct/constants'
import type { ImportPreview, PpctItemDraft } from '@/lib/ppct/types'

function postedGroups(raw: string): Record<TrackType, PpctItemDraft[]> {
  const parsed = JSON.parse(raw || '{}') as Record<string, PpctItemDraft[]>
  return {
    chinh_khoa: Array.isArray(parsed.chinh_khoa) ? parsed.chinh_khoa : [],
    chuyen_de: Array.isArray(parsed.chuyen_de) ? parsed.chuyen_de : [],
  }
}

export async function previewCurriculum(formData: FormData): Promise<ImportPreview> {
  await requireUser()
  const grade = Number(formData.get('grade'))
  if (!GRADES.includes(grade as 10 | 11 | 12)) throw new Error('Chọn khối 10, 11 hoặc 12.')
  const file = formData.get('file')
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith('.docx')) throw new Error('Chỉ hỗ trợ tệp Word .docx.')
  if (file.size > 20 * 1024 * 1024) throw new Error('Tệp quá lớn (tối đa 20 MB).')
  const buffer = Buffer.from(await file.arrayBuffer())
  const parsed = await parseDocx(buffer, file.name)
  return { grade, filename: file.name, expected: parsed.expected, subjectGuess: parsed.subjectGuess, groups: parsed.groups }
}

export async function commitCurriculum(formData: FormData) {
  const user = await requireUser()
  const preview = JSON.parse(String(formData.get('preview') || '{}')) as ImportPreview
  const subjectName = String(formData.get('subjectName') || '').trim()
  const weekly = Number(formData.get('weekly') || 3)
  const result = await saveImport(user.id, preview, subjectName, weekly, postedGroups(String(formData.get('groups') || '{}')))
  return result
}

export async function updateCurriculum(formData: FormData) {
  const user = await requireUser()
  const subjectId = Number(formData.get('subjectId'))
  if (!Number.isInteger(subjectId) || subjectId < 1) throw new Error('Môn không hợp lệ.')
  const updated = await updateSavedPpct(user.id, subjectId, postedGroups(String(formData.get('groups') || '{}')))
  return { updated }
}

export async function importCurriculum(formData: FormData) {
  return previewCurriculum(formData)
}
