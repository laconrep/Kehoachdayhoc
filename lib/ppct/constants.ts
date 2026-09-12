export const GRADES = [10, 11, 12] as const
export const DAYS: Record<number, string> = { 2: 'Thứ 2', 3: 'Thứ 3', 4: 'Thứ 4', 5: 'Thứ 5', 6: 'Thứ 6', 7: 'Thứ 7', 8: 'Chủ nhật' }
export const DAY_NUMBERS = [2, 3, 4, 5, 6, 7, 8] as const
export const SESSIONS = ['Sáng', 'Chiều'] as const
export const PERIODS = [1, 2, 3, 4, 5] as const
export const STATUSES = ['Bình thường', 'Nghỉ', 'Dạy thay', 'Dạy bù', 'Chèn lịch', 'Dạy chung', 'Phụ đạo', 'Bồi dưỡng', 'Dạy thêm'] as const
export const TRACK_TYPES = ['chinh_khoa', 'chuyen_de'] as const
export const TRACK_LABELS: Record<(typeof TRACK_TYPES)[number], string> = { chinh_khoa: 'Chính khóa', chuyen_de: 'Chuyên đề' }
export const NAV = [
  ['Tổng quan', 'dashboard'],
  ['Phân phối chương trình', 'import'],
  ['Lớp học', 'classes'],
  ['Thời khóa biểu', 'timetable'],
  ['Tiến độ', 'progress'],
  ['Xuất báo cáo', 'export'],
  ['Cài đặt', 'settings'],
] as const

export type Grade = (typeof GRADES)[number]
export type TrackType = (typeof TRACK_TYPES)[number]
export type SessionName = (typeof SESSIONS)[number]
export type StatusName = (typeof STATUSES)[number]
