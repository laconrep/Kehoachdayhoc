'use server'

import { addClass, assignElective, assignTeacher } from '@/lib/ppct/api'
import { requireUser } from '@/lib/session'

export async function createClass(formData: FormData) {
  const user = await requireUser()
  const name = String(formData.get('name') || '').trim()
  const teacher = String(formData.get('teacher') || '').trim()
  const subjectId = Number(formData.get('subjectId'))
  if (!name || !teacher || !Number.isInteger(subjectId) || subjectId < 1) throw new Error('Chọn môn–khối và nhập tên lớp, giáo viên.')
  return addClass(user.id, name, subjectId, teacher)
}

export async function assignClassTeacher(formData: FormData) {
  const user = await requireUser()
  const classId = Number(formData.get('classId'))
  const teacher = String(formData.get('teacher') || '').trim()
  if (!Number.isInteger(classId) || classId < 1 || !teacher) throw new Error('Thiếu lớp hoặc tên giáo viên.')
  await assignTeacher(user.id, classId, teacher)
}

export async function assignClassElective(formData: FormData) {
  const user = await requireUser()
  const classId = Number(formData.get('classId'))
  const trackId = Number(formData.get('trackId'))
  const hours = Number(formData.get('hours') || 1)
  if (!Number.isInteger(classId) || !Number.isInteger(trackId)) throw new Error('Lớp hoặc chuyên đề không hợp lệ.')
  await assignElective(user.id, classId, trackId, hours)
}
