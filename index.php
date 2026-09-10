<?php
declare(strict_types=1);

/**
 * PPCT & Thời khóa biểu — ứng dụng một-file PHP/SQLite.
 * PHP 8.4+, ext-pdo_sqlite, ext-zip, ext-dom are required.
 */
session_start();
date_default_timezone_set('Asia/Ho_Chi_Minh');

const APP_NAME = 'PPCT Kế hoạch dạy học';
// Keep teacher data outside public_html so it cannot be downloaded as a static file.
define('DB_DIR', __DIR__ . '/storage');
define('DB_FILE', DB_DIR . '/ppct.sqlite');
define('UPLOAD_DIR', DB_DIR . '/uploads');
const STATUS_NAMES = ['Bình thường', 'Nghỉ', 'Dạy thay', 'Dạy bù', 'Chèn lịch', 'Dạy chung', 'Phụ đạo', 'Bồi dưỡng', 'Dạy thêm'];
const DAYS = [2 => 'Thứ 2', 3 => 'Thứ 3', 4 => 'Thứ 4', 5 => 'Thứ 5', 6 => 'Thứ 6', 7 => 'Thứ 7', 8 => 'Chủ nhật'];
const SESSIONS = ['Sáng', 'Chiều'];
const IMPORT_KHOI = [10, 11, 12];

if (!is_dir(DB_DIR)) {
    mkdir(DB_DIR, 0755, true);
}
if (!is_dir(UPLOAD_DIR)) {
    mkdir(UPLOAD_DIR, 0755, true);
}

function db(): PDO
{
    static $pdo;
    if ($pdo instanceof PDO) return $pdo;
    $pdo = new PDO('sqlite:' . DB_FILE, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec('PRAGMA journal_mode = WAL');
    initializeDatabase($pdo);
    return $pdo;
}

function initializeDatabase(PDO $db): void
{
    $db->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS subjects (
    id INTEGER PRIMARY KEY, ten_mon TEXT NOT NULL, khoi INTEGER NOT NULL CHECK(khoi BETWEEN 1 AND 12),
    so_tiet_tuan_mac_dinh INTEGER NOT NULL DEFAULT 3, UNIQUE(ten_mon, khoi)
);
CREATE TABLE IF NOT EXISTS ppct_tracks (
    id INTEGER PRIMARY KEY, subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    loai_track TEXT NOT NULL CHECK(loai_track IN ('chinh_khoa','chuyen_de')),
    ten_track TEXT NOT NULL, tong_so_tiet INTEGER, file_nguon TEXT, ngay_import TEXT NOT NULL,
    UNIQUE(subject_id, ten_track)
);
CREATE TABLE IF NOT EXISTS ppct_items (
    id INTEGER PRIMARY KEY, track_id INTEGER NOT NULL REFERENCES ppct_tracks(id) ON DELETE CASCADE,
    tiet_so INTEGER NOT NULL, hoc_ky TEXT, bai_hoc TEXT NOT NULL, phan_mon TEXT,
    noi_dung_chi_tiet TEXT, yeu_cau_can_dat TEXT, canh_bao TEXT,
    UNIQUE(track_id, tiet_so)
);
CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY, ten_lop TEXT NOT NULL, khoi INTEGER NOT NULL,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    UNIQUE(ten_lop, subject_id)
);
CREATE TABLE IF NOT EXISTS class_chuyen_de_assignment (
    id INTEGER PRIMARY KEY, class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    track_id INTEGER NOT NULL REFERENCES ppct_tracks(id) ON DELETE CASCADE,
    so_tiet_tuan INTEGER NOT NULL DEFAULT 1, UNIQUE(class_id, track_id)
);
CREATE TABLE IF NOT EXISTS tkb_slots (
    id INTEGER PRIMARY KEY, class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    thu INTEGER NOT NULL CHECK(thu BETWEEN 2 AND 8), buoi TEXT NOT NULL CHECK(buoi IN ('Sáng','Chiều')),
    tiet_so_trong_buoi INTEGER NOT NULL CHECK(tiet_so_trong_buoi BETWEEN 1 AND 5),
    loai_tiet TEXT NOT NULL DEFAULT 'chinh_khoa' CHECK(loai_tiet IN ('chinh_khoa','chuyen_de')),
    UNIQUE(thu, buoi, tiet_so_trong_buoi)
);
CREATE TABLE IF NOT EXISTS khoi_progress (
    id INTEGER PRIMARY KEY, khoi INTEGER NOT NULL, track_id INTEGER NOT NULL REFERENCES ppct_tracks(id) ON DELETE CASCADE,
    ppct_item_id INTEGER NOT NULL REFERENCES ppct_items(id) ON DELETE CASCADE,
    tuan_hoc INTEGER NOT NULL, slot_order INTEGER NOT NULL,
    UNIQUE(khoi, track_id, tuan_hoc, slot_order)
);
CREATE TABLE IF NOT EXISTS class_progress (
    id INTEGER PRIMARY KEY, class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    track_id INTEGER NOT NULL REFERENCES ppct_tracks(id) ON DELETE CASCADE,
    ppct_item_id INTEGER NOT NULL REFERENCES ppct_items(id) ON DELETE CASCADE,
    tuan_hoc INTEGER NOT NULL, slot_order INTEGER NOT NULL,
    UNIQUE(class_id, track_id, tuan_hoc, slot_order)
);
CREATE TABLE IF NOT EXISTS teaching_statuses (id INTEGER PRIMARY KEY, ten TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS buoi_day (
    id INTEGER PRIMARY KEY, tkb_slot_id INTEGER NOT NULL REFERENCES tkb_slots(id) ON DELETE CASCADE,
    tuan_hoc INTEGER NOT NULL, ngay_duong_lich TEXT NOT NULL, ppct_item_id INTEGER REFERENCES ppct_items(id),
    trang_thai_id INTEGER NOT NULL REFERENCES teaching_statuses(id), ghi_chu TEXT,
    UNIQUE(tkb_slot_id, tuan_hoc)
);
SQL);
    $check = $db->query('SELECT COUNT(*) FROM teaching_statuses')->fetchColumn();
    if (!(int)$check) {
        $insert = $db->prepare('INSERT INTO teaching_statuses(ten) VALUES(?)');
        foreach (STATUS_NAMES as $name) $insert->execute([$name]);
    }
    $defaults = ['teacher_name' => '', 'school_year' => date('Y') . '–' . (date('Y') + 1), 'start_date' => date('Y-m-d', strtotime('monday this week')), 'weeks' => '35'];
    $insert = $db->prepare('INSERT OR IGNORE INTO settings(key, value) VALUES(?, ?)');
    foreach ($defaults as $key => $value) $insert->execute([$key, $value]);
}

function h(?string $value): string { return htmlspecialchars((string)$value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
function value(string $key): string { $s = db()->prepare('SELECT value FROM settings WHERE key = ?'); $s->execute([$key]); return (string)$s->fetchColumn(); }
function csrf(): string { if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(32)); return $_SESSION['csrf']; }
function verifyCsrf(): void { if (!hash_equals($_SESSION['csrf'] ?? '', $_POST['csrf'] ?? '')) throw new RuntimeException('Phiên làm việc đã hết hạn. Hãy tải lại trang và thử lại.'); }
function flash(string $type, string $message): void { $_SESSION['flash'][] = compact('type', 'message'); }
function back(string $page, array $extra = []): never { header('Location: ?' . http_build_query(['page' => $page] + $extra)); exit; }
function scalar(string $sql, array $params = []): mixed { $s = db()->prepare($sql); $s->execute($params); return $s->fetchColumn(); }
function rows(string $sql, array $params = []): array { $s = db()->prepare($sql); $s->execute($params); return $s->fetchAll(); }
function backup(): void { if (is_file(DB_FILE)) @copy(DB_FILE, DB_FILE . '.bak'); }

/** Normalizes headers independently of diacritics and Word line breaks. */
function normalize(string $text): string
{
    $text = trim(preg_replace('/\s+/u', ' ', $text));
    // iconv reliably handles every Vietnamese tone mark, unlike an incomplete hand-written map.
    $ascii = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $text);
    $text = $ascii === false ? $text : $ascii;
    $text = mb_strtoupper($text, 'UTF-8');
    return trim(preg_replace('/\s+/', ' ', preg_replace('/[^A-Z0-9]+/', ' ', $text)));
}
function cellText(string $text): string { return trim(preg_replace('/\s+/u', ' ', $text)); }
/** Preserve Word paragraph boundaries; a newline can separate PPCT periods such as “55-56” and “57-58”. */
function wordCellText(DOMXPath $xpath, DOMNode $cell): string
{
    $paragraphs = [];
    foreach ($xpath->query('.//w:p', $cell) as $paragraph) {
        $text = trim(preg_replace('/[\t ]+/u', ' ', $paragraph->textContent));
        if ($text !== '') $paragraphs[] = $text;
    }
    return implode("\n", $paragraphs);
}

/** The specified PPCT algorithm: tells literal enumerations from condensed ranges using declared count. */
function parseTietField(string $raw, ?int $declared): array
{
    $raw = preg_replace('/-\s*\R\s*/u', '-', $raw) ?? $raw;
    $groups = preg_split('/(?:[;,]|\R)+/u', trim($raw)) ?: [];
    $groups = array_values(array_filter(array_map('trim', $groups), static fn($s) => $s !== ''));
    $build = static function (string $mode) use ($groups): array {
        $result = [];
        foreach ($groups as $group) {
            preg_match_all('/\d+/', $group, $matches);
            $nums = array_map('intval', $matches[0]);
            if ($mode === 'range' && count($nums) === 2 && substr_count($group, '-') === 1) {
                $result = [...$result, ...range($nums[0], $nums[1])];
            } else {
                $result = [...$result, ...$nums];
            }
        }
        return $result;
    };
    $literal = $build('literal');
    if ($declared === null || count($literal) === $declared) return [$literal, 'literal'];
    $ranged = $build('range');
    if (count($ranged) === $declared) return [$ranged, 'range'];
    return [$literal, 'mismatch'];
}

function mapColumns(array $headers): array
{
    $mapping = ['tiet_thu' => null, 'so_tiet_khai_bao' => null, 'ten_bai' => null, 'noi_dung' => null, 'yeu_cau' => null];
    foreach ($headers as $i => $header) {
        $n = normalize($header);
        if (str_contains($n, 'BAI HOC') || str_contains($n, 'CHU DE') || str_contains($n, 'CHUYEN DE')) {
            if ($mapping['ten_bai'] === null) $mapping['ten_bai'] = $i;
            elseif ($mapping['noi_dung'] === null) $mapping['noi_dung'] = $i;
        }
        if (($n === 'SO TIET' || (str_starts_with($n, 'SO') && str_contains($n, 'TIET') && !str_contains($n, 'THU'))) && $mapping['so_tiet_khai_bao'] === null) $mapping['so_tiet_khai_bao'] = $i;
        if (str_contains($n, 'TIET') && str_contains($n, 'THU') && $mapping['tiet_thu'] === null) $mapping['tiet_thu'] = $i;
        if (str_contains($n, 'TIET') && str_contains($n, 'TUAN') && $mapping['tiet_thu'] === null) $mapping['tiet_thu'] = $i;
        if ((str_contains($n, 'NOI DUNG') || str_contains($n, 'HOAT DONG')) && $mapping['noi_dung'] === null) $mapping['noi_dung'] = $i;
        if (str_contains($n, 'YEU CAU CAN DAT') && $mapping['yeu_cau'] === null) $mapping['yeu_cau'] = $i;
    }
    if ($mapping['tiet_thu'] === null && $mapping['so_tiet_khai_bao'] !== null) {
        $mapping['tiet_thu'] = $mapping['so_tiet_khai_bao'];
        $mapping['so_tiet_khai_bao'] = null;
    }
    // A merged “Chủ đề/Bài học” heading often occupies two data columns: title and detailed content.
    if ($mapping['noi_dung'] === null && $mapping['ten_bai'] !== null && $mapping['tiet_thu'] !== null && $mapping['tiet_thu'] > $mapping['ten_bai'] + 1) {
        $mapping['noi_dung'] = $mapping['tiet_thu'] - 1;
    }
    return $mapping;
}

/** Reads all Word tables directly from DOCX XML, including tables with merged cells. */
function docxTables(string $path): array
{
    $zip = new ZipArchive();
    if ($zip->open($path) !== true) throw new RuntimeException('Không thể mở tệp .docx. Tệp có thể bị hỏng.');
    $xml = $zip->getFromName('word/document.xml');
    $zip->close();
    if ($xml === false) throw new RuntimeException('Không tìm thấy nội dung tài liệu Word.');
    $doc = new DOMDocument();
    if (!@$doc->loadXML($xml)) throw new RuntimeException('Không thể đọc cấu trúc XML của tệp Word.');
    $xp = new DOMXPath($doc); $xp->registerNamespace('w', 'http://schemas.openxmlformats.org/wordprocessingml/2006/main');
    $tables = [];
    foreach ($xp->query('//w:tbl') as $table) {
        $allRows = [];
        foreach ($xp->query('./w:tr', $table) as $tr) {
            $cells = [];
            foreach ($xp->query('./w:tc', $tr) as $tc) {
                $cells[] = wordCellText($xp, $tc);
                $span = $xp->query('./w:tcPr/w:gridSpan', $tc)->item(0);
                $spanCount = $span instanceof DOMElement ? max(1, (int)$span->getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'val')) : 1;
                for ($i = 1; $i < $spanCount; $i++) $cells[] = '';
            }
            if ($cells) $allRows[] = $cells;
        }
        if ($allRows) $tables[] = $allRows;
    }
    // Retain the nearest preceding paragraph so a multi-grade document can suggest its khối.
    $tableGrades = []; $tableTypes = []; $nearbyParagraphs = [];
    foreach ($xp->query('/w:document/w:body/*') as $node) {
        if ($node->localName === 'p') {
            $paragraph = cellText($node->textContent);
            if ($paragraph !== '') { $nearbyParagraphs[] = $paragraph; $nearbyParagraphs = array_slice($nearbyParagraphs, -8); }
        } elseif ($node->localName === 'tbl') {
            $context = implode(' ', $nearbyParagraphs);
            preg_match_all('/(?:khối|lớp)\s*(10|11|12)\b/iu', $context, $matches);
            $tableGrades[] = $matches[1] ? (int)end($matches[1]) : null;
            $tableTypes[] = trackTypeFromText($context);
        }
    }
    $text = cellText($doc->textContent);
    preg_match('/Tổng\s*số\s*tiết\s*[:\s]+(\d+)/iu', $text, $m);
    return [$tables, isset($m[1]) ? (int)$m[1] : null, $tableGrades, $tableTypes, $text];
}
function findCandidates(array $tables, array $tableGrades = [], array $tableTypes = []): array
{
    $found = [];
    foreach ($tables as $tableIndex => $table) {
        $best = ['score' => -1, 'row' => 0, 'mapping' => []];
        foreach (array_slice($table, 0, min(5, count($table)), true) as $rowIndex => $header) {
            $map = mapColumns($header);
            $score = ($map['tiet_thu'] !== null ? 3 : 0) + ($map['ten_bai'] !== null ? 3 : 0) + ($map['so_tiet_khai_bao'] !== null ? 1 : 0) + ($map['noi_dung'] !== null ? 1 : 0);
            if ($score > $best['score']) {
                $best = ['score' => $score, 'row' => $rowIndex, 'mapping' => $map];
            }
        }
        $flatHeader = normalize(implode(' ', $table[$best['row']] ?? []));
        if ($best['score'] >= 3 || (str_contains($flatHeader, 'TIET') && str_contains($flatHeader, 'TUAN'))) {
            $headerType = trackTypeFromText($flatHeader);
            $found[] = ['table' => $tableIndex, 'header_row' => $best['row'], 'mapping' => $best['mapping'], 'score' => $best['score'], 'columns' => $table[$best['row']], 'grade_hint' => $tableGrades[$tableIndex] ?? null, 'type_hint' => $headerType ?? ($tableTypes[$tableIndex] ?? null)];
        }
    }
    return $found;
}
function parseTable(array $table, int $headerRow, array $map): array
{
    if ($map['tiet_thu'] === null || $map['ten_bai'] === null) return [];
    $items = []; $lastLesson = '';
    foreach (array_slice($table, $headerRow + 1) as $cells) {
        // Keep paragraph breaks intact for parseTietField(), then trim every individual cell.
        $cells = array_map(static fn($text) => trim((string)$text), $cells);
        if (!$cells || !array_filter($cells)) continue;
        if (str_starts_with(mb_strtolower($cells[0] ?? '', 'UTF-8'), 'tổng')) continue;
        if (count(array_unique($cells)) === 1) continue;
        $tietRaw = $cells[$map['tiet_thu']] ?? '';
        $lesson = $cells[$map['ten_bai']] ?? '';
        // Word vertical merges leave following title cells empty: inherit the last valid title.
        if ($lesson !== '') $lastLesson = cellText($lesson);
        else $lesson = $lastLesson;
        if ($tietRaw === '' || $lesson === '') continue;
        $declaredRaw = $map['so_tiet_khai_bao'] !== null ? ($cells[$map['so_tiet_khai_bao']] ?? '') : '';
        preg_match('/\d+/', $declaredRaw, $declaredMatch);
        $declared = isset($declaredMatch[0]) ? (int)$declaredMatch[0] : null;
        [$numbers, $meaning] = parseTietField($tietRaw, $declared);
        foreach ($numbers as $number) {
            if ($number < 1) continue;
            $items[] = ['tiet_so' => $number, 'bai_hoc' => $lesson, 'noi_dung_chi_tiet' => $map['noi_dung'] !== null ? cellText($cells[$map['noi_dung']] ?? '') : '', 'yeu_cau_can_dat' => $map['yeu_cau'] !== null ? cellText($cells[$map['yeu_cau']] ?? '') : '', 'canh_bao' => $meaning === 'mismatch' ? "Cột số tiết không khớp: “$tietRaw”" : ''];
        }
    }
    usort($items, static fn($a, $b) => $a['tiet_so'] <=> $b['tiet_so']);
    return $items;
}
function validateItems(array $items, ?int $expected): array
{
    $numbers = array_column($items, 'tiet_so');
    $max = $numbers ? max($numbers) : 0;
    $missing = array_values(array_diff(range(1, $max ?: 1), array_unique($numbers)));
    if ($max === 0) $missing = [];
    $counts = array_count_values($numbers); $duplicates = array_keys(array_filter($counts, static fn($n) => $n > 1));
    $warnings = count(array_filter($items, static fn($item) => !empty($item['canh_bao'])));
    return compact('max', 'missing', 'duplicates', 'warnings') + ['expected' => $expected, 'total_mismatch' => $expected !== null && $max !== $expected];
}

function isKhoi(int $khoi): bool { return in_array($khoi, IMPORT_KHOI, true); }

function trackTypeFromText(string $text): ?string
{
    $n = normalize($text);
    if (str_contains($n, 'CHUYEN DE')) return 'chuyen_de';
    if (str_contains($n, 'CHINH KHOA') || str_contains($n, 'BAT BUOC')) return 'chinh_khoa';
    return null;
}

function classifyCandidate(array $candidate): string
{
    if (!empty($candidate['type_hint'])) return $candidate['type_hint'];
    $header = normalize(implode(' ', $candidate['columns'] ?? []));
    return trackTypeFromText($header) ?? 'chinh_khoa';
}

function guessSubjectName(string $filename, string $docText = ''): string
{
    if (preg_match('/Môn\s*(?:học)?\s*[:\-–]?\s*([^\r\n,;]+)/iu', $docText, $m)) {
        $name = trim(preg_replace('/\s+/u', ' ', $m[1]));
        if ($name !== '') return $name;
    }
    $base = pathinfo($filename, PATHINFO_FILENAME);
    $base = preg_replace('/[_\-]+/u', ' ', $base) ?? $base;
    $base = preg_replace('/\b(ppct|phan phoi chuong trinh|khoi|lop|10|11|12|chinh khoa|chuyen de)\b/iu', '', $base) ?? $base;
    return trim(preg_replace('/\s+/u', ' ', $base) ?? $base);
}

function uniquifyItems(array $items): array
{
    $unique = [];
    $seen = [];
    $skipped = [];
    foreach ($items as $item) {
        $number = (int)($item['tiet_so'] ?? 0);
        $lesson = trim((string)($item['bai_hoc'] ?? ''));
        if ($number < 1 || $lesson === '') continue;
        if (isset($seen[$number])) {
            $skipped[] = $number;
            continue;
        }
        $seen[$number] = true;
        $item['tiet_so'] = $number;
        $item['bai_hoc'] = $lesson;
        $item['noi_dung_chi_tiet'] = trim((string)($item['noi_dung_chi_tiet'] ?? ''));
        $item['yeu_cau_can_dat'] = trim((string)($item['yeu_cau_can_dat'] ?? ''));
        $item['canh_bao'] = trim((string)($item['canh_bao'] ?? ''));
        $unique[] = $item;
    }
    return [$unique, $skipped];
}

function khoiOverview(): array
{
    $out = [];
    foreach (IMPORT_KHOI as $khoi) {
        $tracks = rows('SELECT t.*, s.ten_mon, s.so_tiet_tuan_mac_dinh FROM ppct_tracks t JOIN subjects s ON s.id = t.subject_id WHERE s.khoi = ? ORDER BY t.loai_track, t.id', [$khoi]);
        $core = 0;
        $cd = 0;
        $file = '';
        $date = '';
        $subject = '';
        $weekly = 3;
        foreach ($tracks as $track) {
            $subject = (string)$track['ten_mon'];
            $file = (string)$track['file_nguon'];
            $date = (string)$track['ngay_import'];
            $weekly = (int)$track['so_tiet_tuan_mac_dinh'];
            if ($track['loai_track'] === 'chinh_khoa') $core += (int)$track['tong_so_tiet'];
            else $cd += (int)$track['tong_so_tiet'];
        }
        $out[$khoi] = ['tracks' => $tracks, 'core' => $core, 'cd' => $cd, 'file' => $file, 'date' => $date, 'subject' => $subject, 'weekly' => $weekly, 'ready' => $tracks !== []];
    }
    return $out;
}

function upsertTrack(PDO $db, int $subjectId, string $trackType, string $trackName, array $items, string $filename): int
{
    $trackId = (int)scalar('SELECT id FROM ppct_tracks WHERE subject_id = ? AND loai_track = ?', [$subjectId, $trackType]);
    if ($trackId) {
        $db->prepare('UPDATE buoi_day SET ppct_item_id = NULL WHERE ppct_item_id IN (SELECT id FROM ppct_items WHERE track_id = ?)')->execute([$trackId]);
        $db->prepare('DELETE FROM ppct_items WHERE track_id = ?')->execute([$trackId]);
        $db->prepare('UPDATE ppct_tracks SET ten_track = ?, tong_so_tiet = ?, file_nguon = ?, ngay_import = ? WHERE id = ?')->execute([$trackName, count($items), $filename, date('c'), $trackId]);
    } else {
        $db->prepare('INSERT INTO ppct_tracks(subject_id, loai_track, ten_track, tong_so_tiet, file_nguon, ngay_import) VALUES(?,?,?,?,?,?)')->execute([$subjectId, $trackType, $trackName, count($items), $filename, date('c')]);
        $trackId = (int)$db->lastInsertId();
    }
    $insert = $db->prepare('INSERT INTO ppct_items(track_id, tiet_so, bai_hoc, noi_dung_chi_tiet, yeu_cau_can_dat, canh_bao) VALUES(?,?,?,?,?,?)');
    foreach ($items as $item) {
        $insert->execute([$trackId, (int)$item['tiet_so'], $item['bai_hoc'], $item['noi_dung_chi_tiet'] ?? '', $item['yeu_cau_can_dat'] ?? '', $item['canh_bao'] ?? '']);
    }
    return $trackId;
}

function parseImportGroups(array $tables, array $candidates): array
{
    $groups = ['chinh_khoa' => [], 'chuyen_de' => []];
    $hinted = array_values(array_filter($candidates, static fn($c) => !empty($c['type_hint'])));
    $unhinted = count($hinted) === 0 && count($candidates) >= 2;
    foreach ($candidates as $index => $candidate) {
        $items = parseTable($tables[(int)$candidate['table']], (int)$candidate['header_row'], $candidate['mapping']);
        if (!$items) continue;
        $type = $unhinted ? ($index === 0 ? 'chinh_khoa' : 'chuyen_de') : classifyCandidate($candidate);
        $groups[$type] = [...$groups[$type], ...$items];
    }
    foreach ($groups as $type => $items) {
        $counts = array_count_values(array_column($items, 'tiet_so'));
        foreach ($groups[$type] as &$item) {
            if (($counts[$item['tiet_so']] ?? 0) > 1) {
                $item['canh_bao'] = trim(($item['canh_bao'] ? $item['canh_bao'] . ' · ' : '') . 'Trùng số tiết PPCT ' . $item['tiet_so']);
            }
        }
        unset($item);
    }
    return $groups;
}

function settingAll(): array { return rows('SELECT key, value FROM settings'); }
function statusId(string $name): int { return (int)scalar('SELECT id FROM teaching_statuses WHERE ten = ?', [$name]); }
function subjectTracks(int $subjectId, string $type = 'chinh_khoa'): array { return rows('SELECT * FROM ppct_tracks WHERE subject_id = ? AND loai_track = ? ORDER BY id', [$subjectId, $type]); }
function getWeekStart(int $week): DateTimeImmutable { return (new DateTimeImmutable(value('start_date')))->modify('+' . (($week - 1) * 7) . ' days'); }
function teachingDate(int $week, int $day): string { return getWeekStart($week)->modify('+' . ($day - 2) . ' days')->format('Y-m-d'); }
function timetableWarnings(): array
{
    return rows("SELECT c.id, c.ten_lop, s.so_tiet_tuan_mac_dinh,
        COUNT(CASE WHEN ts.loai_tiet = 'chinh_khoa' THEN 1 END) AS so_tiet_da_gan
        FROM classes c JOIN subjects s ON s.id = c.subject_id
        LEFT JOIN tkb_slots ts ON ts.class_id = c.id
        GROUP BY c.id HAVING so_tiet_da_gan <> s.so_tiet_tuan_mac_dinh
        ORDER BY c.khoi, c.ten_lop");
}
function itemBelongsToClass(int $itemId, int $classId): bool
{
    return (bool) scalar("SELECT 1 FROM ppct_items i
        JOIN ppct_tracks t ON t.id = i.track_id
        JOIN classes c ON c.id = ? AND c.subject_id = t.subject_id
        LEFT JOIN class_chuyen_de_assignment a ON a.class_id = c.id AND a.track_id = t.id
        WHERE i.id = ? AND (t.loai_track = 'chinh_khoa' OR a.id IS NOT NULL)", [$classId, $itemId]);
}

/** Recreates planned shared core progress and class-specific elective progress. */
function generateSchedule(): void
{
    $db = db(); backup(); $db->beginTransaction();
    try {
        $db->exec('DELETE FROM buoi_day'); $db->exec('DELETE FROM khoi_progress'); $db->exec('DELETE FROM class_progress');
        $weeks = max(1, (int)value('weeks'));
        $tracks = rows("SELECT t.*, s.khoi, s.so_tiet_tuan_mac_dinh FROM ppct_tracks t JOIN subjects s ON s.id=t.subject_id ORDER BY t.id");
        foreach ($tracks as $track) {
            $items = rows('SELECT id FROM ppct_items WHERE track_id=? ORDER BY tiet_so,id', [(int)$track['id']]);
            if (!$items) continue;
            if ($track['loai_track'] === 'chinh_khoa') {
                $insert = $db->prepare('INSERT INTO khoi_progress(khoi,track_id,ppct_item_id,tuan_hoc,slot_order) VALUES(?,?,?,?,?)');
                $pointer = 0;
                for ($w = 1; $w <= $weeks && $pointer < count($items); $w++) for ($order = 1; $order <= (int)$track['so_tiet_tuan_mac_dinh'] && $pointer < count($items); $order++) $insert->execute([(int)$track['khoi'], (int)$track['id'], (int)$items[$pointer++]['id'], $w, $order]);
            } else {
                $assignments = rows('SELECT * FROM class_chuyen_de_assignment WHERE track_id=?', [(int)$track['id']]);
                $insert = $db->prepare('INSERT INTO class_progress(class_id,track_id,ppct_item_id,tuan_hoc,slot_order) VALUES(?,?,?,?,?)');
                foreach ($assignments as $assignment) {
                    $pointer = 0;
                    for ($w = 1; $w <= $weeks && $pointer < count($items); $w++) for ($order = 1; $order <= (int)$assignment['so_tiet_tuan'] && $pointer < count($items); $order++) $insert->execute([(int)$assignment['class_id'], (int)$track['id'], (int)$items[$pointer++]['id'], $w, $order]);
                }
            }
        }
        fillWeeks($weeks); $db->commit();
    } catch (Throwable $e) { $db->rollBack(); throw $e; }
}
function fillWeeks(int $weeks): void
{
    $db = db(); $db->exec('DELETE FROM buoi_day');
    $slots = rows('SELECT ts.*, c.khoi,c.subject_id FROM tkb_slots ts JOIN classes c ON c.id=ts.class_id ORDER BY ts.class_id,ts.thu,CASE ts.buoi WHEN "Sáng" THEN 0 ELSE 1 END,ts.tiet_so_trong_buoi');
    $coreTracks = [];
    foreach (rows("SELECT * FROM ppct_tracks WHERE loai_track='chinh_khoa'") as $track) $coreTracks[$track['subject_id']] = $track['id'];
    $electives = [];
    foreach (rows('SELECT class_id,track_id FROM class_chuyen_de_assignment') as $x) $electives[$x['class_id']] = $x['track_id'];
    $insert = $db->prepare('INSERT INTO buoi_day(tkb_slot_id,tuan_hoc,ngay_duong_lich,ppct_item_id,trang_thai_id) VALUES(?,?,?,?,?)');
    $normal = statusId('Bình thường');
    foreach (range(1, $weeks) as $week) {
        $slotOrders = [];
        foreach ($slots as $slot) {
            $key = $slot['class_id'] . ':' . $slot['loai_tiet']; $slotOrders[$key] = ($slotOrders[$key] ?? 0) + 1;
            $itemId = null;
            if ($slot['loai_tiet'] === 'chinh_khoa' && isset($coreTracks[$slot['subject_id']])) $itemId = scalar('SELECT ppct_item_id FROM khoi_progress WHERE khoi=? AND track_id=? AND tuan_hoc=? AND slot_order=?', [(int)$slot['khoi'], $coreTracks[$slot['subject_id']], $week, $slotOrders[$key]]);
            if ($slot['loai_tiet'] === 'chuyen_de' && isset($electives[$slot['class_id']])) $itemId = scalar('SELECT ppct_item_id FROM class_progress WHERE class_id=? AND track_id=? AND tuan_hoc=? AND slot_order=?', [(int)$slot['class_id'], $electives[$slot['class_id']], $week, $slotOrders[$key]]);
            $insert->execute([(int)$slot['id'], $week, teachingDate($week, (int)$slot['thu']), $itemId ?: null, $normal]);
        }
    }
}

function columnLetter(int $number): string { $out = ''; while ($number) { $number--; $out = chr(65 + ($number % 26)) . $out; $number = intdiv($number, 26); } return $out; }
function xlsxCell(int $column, int $row, mixed $value): string
{
    $ref = columnLetter($column) . $row;
    if ($value === null || $value === '') return '<c r="' . $ref . '"/>';
    if (is_int($value) || is_float($value)) return '<c r="' . $ref . '"><v>' . $value . '</v></c>';
    return '<c r="' . $ref . '" t="inlineStr"><is><t xml:space="preserve">' . htmlspecialchars((string)$value, ENT_XML1 | ENT_QUOTES, 'UTF-8') . '</t></is></c>';
}
function xlsxSheet(array $grid, array $merges = []): string
{
    $xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
    foreach ($grid as $r => $cols) { $xml .= '<row r="' . $r . '">'; foreach ($cols as $c => $v) $xml .= xlsxCell((int)$c, (int)$r, $v); $xml .= '</row>'; }
    $xml .= '</sheetData>';
    if ($merges) { $xml .= '<mergeCells count="' . count($merges) . '">'; foreach ($merges as $range) $xml .= '<mergeCell ref="' . $range . '"/>'; $xml .= '</mergeCells>'; }
    return $xml . '</worksheet>';
}
function downloadLbg(int $week): never
{
    $week = max(1, min((int)value('weeks'), $week)); $start = getWeekStart($week);
    $records = rows('SELECT b.*, ts.thu,ts.buoi,ts.tiet_so_trong_buoi,c.ten_lop,s.ten_mon,i.tiet_so,i.phan_mon,i.bai_hoc,st.ten AS trang_thai FROM buoi_day b JOIN tkb_slots ts ON ts.id=b.tkb_slot_id JOIN classes c ON c.id=ts.class_id JOIN subjects s ON s.id=c.subject_id LEFT JOIN ppct_items i ON i.id=b.ppct_item_id JOIN teaching_statuses st ON st.id=b.trang_thai_id WHERE b.tuan_hoc=?', [$week]);
    $lookup = []; foreach ($records as $r) $lookup[$r['thu'].'|'.$r['buoi'].'|'.$r['tiet_so_trong_buoi']] = $r;
    $grid = [1 => [1 => 'KẾ HOẠCH DẠY HỌC'], 2 => [1 => 'Giáo viên:', 5 => value('teacher_name'), 9 => 'Từ ngày:', 10 => $start->format('d/m/Y')], 3 => [1 => 'Tuần:', 5 => 'Tuần ' . $week, 9 => 'Đến ngày:', 10 => $start->modify('+6 days')->format('d/m/Y')], 4 => [1 => 'Thứ, ngày', 3 => 'Buổi', 4 => 'Tiết TKB', 5 => 'Môn học', 6 => 'Lớp', 7 => 'Tiết PPCT', 8 => 'Phân môn', 9 => 'Tên bài dạy', 10 => 'Ghi chú', 11 => 'Trạng thái']];
    $merges = ['A1:K1','A2:D2','E2:G2','A3:D3','E3:G3']; $row = 5;
    foreach (DAYS as $day => $dayName) foreach (SESSIONS as $session) { $first = $row; for ($period = 1; $period <= 5; $period++, $row++) { $record = $lookup[$day.'|'.$session.'|'.$period] ?? null; $grid[$row] = [1 => $period === 1 ? ($session === 'Sáng' ? ($day === 8 ? 'CN' : $day) : $start->modify('+' . ($day - 2) . ' days')->format('d/m/Y')) : '', 3 => $period === 1 ? $session : '', 4 => $period]; if ($record) $grid[$row] += [5 => $record['ten_mon'], 6 => $record['ten_lop'], 7 => $record['tiet_so'], 8 => $record['phan_mon'], 9 => $record['bai_hoc'], 10 => $record['ghi_chu'], 11 => $record['trang_thai']]; } $merges[] = 'A' . $first . ':A' . ($row - 1); $merges[] = 'C' . $first . ':C' . ($row - 1); }
    $sign = $row + 1; $grid[$sign] = [1 => 'Duyệt của TCM', 8 => 'Duyệt của Hiệu trưởng']; $merges[] = 'A'.$sign.':G'.$sign; $merges[] = 'H'.$sign.':K'.$sign;
    $classes = rows('SELECT c.ten_lop,s.ten_mon FROM classes c JOIN subjects s ON s.id=c.subject_id ORDER BY c.ten_lop'); $grid2 = [1 => [] , 2 => []]; foreach ($classes as $i => $class) { $grid2[1][$i+1] = $class['ten_lop']; $grid2[2][$i+1] = $class['ten_mon']; }
    $grid3 = [1 => [1 => 'STT', 2 => 'Trạng thái']]; foreach (STATUS_NAMES as $i => $name) $grid3[$i + 2] = [1 => $i + 1, 2 => $name];
    $zip = new ZipArchive(); $tmp = tempnam(sys_get_temp_dir(), 'lbg_'); $zip->open($tmp, ZipArchive::OVERWRITE);
    $zip->addFromString('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
    $zip->addFromString('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    $zip->addFromString('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="LBG" sheetId="1" r:id="rId1"/><sheet name="Môn học - Lớp học" sheetId="2" r:id="rId2"/><sheet name="Kiểu giảng dạy" sheetId="3" r:id="rId3"/></sheets></workbook>');
    $zip->addFromString('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/></Relationships>');
    $zip->addFromString('xl/worksheets/sheet1.xml', xlsxSheet($grid, $merges)); $zip->addFromString('xl/worksheets/sheet2.xml', xlsxSheet($grid2)); $zip->addFromString('xl/worksheets/sheet3.xml', xlsxSheet($grid3)); $zip->close();
    $filename = 'Lich-bao-giang-tuan-' . $week . '.xlsx'; header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); header('Content-Disposition: attachment; filename="' . $filename . '"'); header('Content-Length: ' . filesize($tmp)); readfile($tmp); unlink($tmp); exit;
}

function handlePost(): void
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') return;
    verifyCsrf(); $action = $_POST['action'] ?? '';
    try {
        switch ($action) {
            case 'settings':
                $st = db()->prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
                foreach (['teacher_name','school_year','start_date','weeks'] as $key) $st->execute([$key, trim((string)($_POST[$key] ?? ''))]);
                flash('success', 'Đã lưu thông tin năm học. Hãy sinh lại lịch nếu đã thay đổi ngày khai giảng hoặc số tuần.'); back('settings');
            case 'import_upload':
                $khoi = (int)($_POST['khoi'] ?? 0);
                if (!isKhoi($khoi)) throw new RuntimeException('Chọn khối 10, 11 hoặc 12.');
                if (empty($_FILES['docx']) || $_FILES['docx']['error'] !== UPLOAD_ERR_OK) throw new RuntimeException('Hãy chọn một tệp Word .docx hợp lệ.');
                $file = $_FILES['docx']; $extension = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
                if ($extension === 'doc') throw new RuntimeException('Tệp .doc cũ chưa thể đọc trực tiếp trên máy chủ. Hãy mở bằng Word, chọn Save As → Word Document (.docx), rồi import lại.');
                if ($extension !== 'docx') throw new RuntimeException('Chỉ hỗ trợ tệp Word .docx.');
                if ((int)$file['size'] > 20 * 1024 * 1024) throw new RuntimeException('Tệp quá lớn (tối đa 20 MB).');
                $saved = bin2hex(random_bytes(10)) . '.docx'; if (!move_uploaded_file($file['tmp_name'], UPLOAD_DIR . '/' . $saved)) throw new RuntimeException('Máy chủ không thể lưu tệp tải lên.');
                [$tables, $expected, $tableGrades, $tableTypes, $docText] = docxTables(UPLOAD_DIR . '/' . $saved);
                $candidates = findCandidates($tables, $tableGrades, $tableTypes);
                if (!$candidates) throw new RuntimeException('Không tìm thấy bảng PPCT. Bạn có thể thử một tệp Word khác có hàng tiêu đề chứa “Tiết” và “Bài học”.');
                $groups = parseImportGroups($tables, $candidates);
                if (!$groups['chinh_khoa'] && !$groups['chuyen_de']) throw new RuntimeException('Không thể tách tiết chính khóa / chuyên đề từ tệp này.');
                $_SESSION['import'] = [
                    'khoi' => $khoi,
                    'filename' => $file['name'],
                    'saved' => $saved,
                    'expected' => $expected,
                    'subject_guess' => guessSubjectName($file['name'], $docText),
                    'groups' => $groups,
                ];
                flash('success', 'Đã tách chính khóa và chuyên đề. Kiểm tra rồi lưu.'); back('import');
            case 'import_save':
                $import = $_SESSION['import'] ?? null; if (!$import) throw new RuntimeException('Phiên import đã hết hạn.');
                $khoi = (int)($import['khoi'] ?? 0);
                if (!isKhoi($khoi)) throw new RuntimeException('Khối không hợp lệ.');
                $subjectName = trim((string)$_POST['subject_name']);
                $weekly = max(1, (int)$_POST['weekly']);
                if ($subjectName === '') throw new RuntimeException('Nhập tên môn học.');
                $posted = $_POST['groups'] ?? [];
                $savedTypes = [];
                $skippedAll = [];
                backup(); $db = db(); $db->beginTransaction();
                try {
                    $subjectId = (int)scalar('SELECT id FROM subjects WHERE khoi = ? ORDER BY id LIMIT 1', [$khoi]);
                    if ($subjectId) {
                        $db->prepare('UPDATE subjects SET ten_mon = ?, so_tiet_tuan_mac_dinh = ? WHERE id = ?')->execute([$subjectName, $weekly, $subjectId]);
                    } else {
                        $db->prepare('INSERT INTO subjects(ten_mon,khoi,so_tiet_tuan_mac_dinh) VALUES(?,?,?)')->execute([$subjectName, $khoi, $weekly]);
                        $subjectId = (int)$db->lastInsertId();
                    }
                    foreach (['chinh_khoa' => 'Chính khóa', 'chuyen_de' => 'Chuyên đề'] as $type => $label) {
                        $raw = $posted[$type] ?? [];
                        [$items, $skipped] = uniquifyItems(is_array($raw) ? $raw : []);
                        if (!$items) continue;
                        upsertTrack($db, $subjectId, $type, $label, $items, (string)$import['filename']);
                        $savedTypes[] = $label . ' ' . count($items) . ' tiết';
                        if ($skipped) $skippedAll = [...$skippedAll, ...$skipped];
                    }
                    if (!$savedTypes) throw new RuntimeException('Không có dòng PPCT hợp lệ để lưu.');
                    $cdTrackId = (int)scalar('SELECT id FROM ppct_tracks WHERE subject_id = ? AND loai_track = ?', [$subjectId, 'chuyen_de']);
                    if ($cdTrackId) {
                        $assign = $db->prepare('INSERT INTO class_chuyen_de_assignment(class_id,track_id,so_tiet_tuan) VALUES(?,?,1) ON CONFLICT(class_id,track_id) DO NOTHING');
                        foreach (rows('SELECT id FROM classes WHERE subject_id = ?', [$subjectId]) as $class) {
                            $assign->execute([(int)$class['id'], $cdTrackId]);
                        }
                    }
                    $db->commit();
                    unset($_SESSION['import']);
                    $message = 'Đã lưu PPCT khối ' . $khoi . ': ' . implode(', ', $savedTypes) . '.';
                    if ($skippedAll) $message .= ' Đã bỏ qua dòng trùng tiết: ' . implode(', ', array_values(array_unique($skippedAll))) . '.';
                    flash($skippedAll ? 'warning' : 'success', $message);
                    back('import');
                } catch (Throwable $e) { $db->rollBack(); throw $e; }
            case 'import_cancel':
                unset($_SESSION['import']);
                flash('success', 'Đã hủy bản xem trước.'); back('import');
            case 'import_update_saved':
                $khoi = (int)($_POST['khoi'] ?? 0);
                if (!isKhoi($khoi)) throw new RuntimeException('Khối không hợp lệ.');
                $posted = $_POST['groups'] ?? [];
                $tracks = rows('SELECT t.id, t.loai_track, t.file_nguon, t.ten_track FROM ppct_tracks t JOIN subjects s ON s.id = t.subject_id WHERE s.khoi = ?', [$khoi]);
                if (!$tracks) throw new RuntimeException('Khối này chưa có PPCT để sửa.');
                backup(); $db = db(); $db->beginTransaction();
                try {
                    $updated = [];
                    foreach ($tracks as $track) {
                        $raw = $posted[$track['loai_track']] ?? [];
                        [$items, $skipped] = uniquifyItems(is_array($raw) ? $raw : []);
                        if (!$items) continue;
                        $db->prepare('UPDATE buoi_day SET ppct_item_id = NULL WHERE ppct_item_id IN (SELECT id FROM ppct_items WHERE track_id = ?)')->execute([(int)$track['id']]);
                        $db->prepare('DELETE FROM ppct_items WHERE track_id = ?')->execute([(int)$track['id']]);
                        $db->prepare('UPDATE ppct_tracks SET tong_so_tiet = ?, ngay_import = ? WHERE id = ?')->execute([count($items), date('c'), (int)$track['id']]);
                        $insert = $db->prepare('INSERT INTO ppct_items(track_id, tiet_so, bai_hoc, noi_dung_chi_tiet, yeu_cau_can_dat, canh_bao) VALUES(?,?,?,?,?,?)');
                        foreach ($items as $item) {
                            $insert->execute([(int)$track['id'], (int)$item['tiet_so'], $item['bai_hoc'], $item['noi_dung_chi_tiet'] ?? '', $item['yeu_cau_can_dat'] ?? '', $item['canh_bao'] ?? '']);
                        }
                        $updated[] = ($track['loai_track'] === 'chinh_khoa' ? 'Chính khóa' : 'Chuyên đề') . ' ' . count($items) . ' tiết';
                    }
                    $db->commit();
                    flash('success', 'Đã cập nhật PPCT khối ' . $khoi . ($updated ? ': ' . implode(', ', $updated) : '') . '.');
                    back('import', ['edit' => $khoi]);
                } catch (Throwable $e) { $db->rollBack(); throw $e; }
            case 'add_class':
                $name = trim((string)$_POST['class_name']); $subjectId = (int)$_POST['subject_id']; $grade = (int)scalar('SELECT khoi FROM subjects WHERE id=?', [$subjectId]); if ($name === '' || !$grade) throw new RuntimeException('Chọn môn–khối và nhập tên lớp.'); db()->prepare('INSERT INTO classes(ten_lop,khoi,subject_id) VALUES(?,?,?)')->execute([$name,$grade,$subjectId]); $classId=(int)db()->lastInsertId(); $cdTrackId=(int)scalar('SELECT id FROM ppct_tracks WHERE subject_id=? AND loai_track=?', [$subjectId,'chuyen_de']); if ($cdTrackId) db()->prepare('INSERT OR IGNORE INTO class_chuyen_de_assignment(class_id,track_id,so_tiet_tuan) VALUES(?,?,1)')->execute([$classId,$cdTrackId]); flash('success', 'Đã thêm lớp.'); back('classes');
            case 'delete_class': db()->prepare('DELETE FROM classes WHERE id=?')->execute([(int)$_POST['class_id']]); flash('success','Đã xóa lớp và các tiết đã gán.'); back('classes');
            case 'assign_elective':
                $classId=(int)$_POST['class_id']; $trackId=(int)$_POST['track_id']; $hours=max(1,(int)$_POST['hours']); db()->prepare('INSERT INTO class_chuyen_de_assignment(class_id,track_id,so_tiet_tuan) VALUES(?,?,?) ON CONFLICT(class_id,track_id) DO UPDATE SET so_tiet_tuan=excluded.so_tiet_tuan')->execute([$classId,$trackId,$hours]); flash('success','Đã gán chuyên đề cho lớp.'); back('classes');
            case 'save_timetable':
                backup(); $db=db(); $db->beginTransaction(); try { $db->exec('DELETE FROM tkb_slots'); $st=$db->prepare('INSERT INTO tkb_slots(class_id,thu,buoi,tiet_so_trong_buoi,loai_tiet) VALUES(?,?,?,?,?)'); foreach ($_POST['slot'] ?? [] as $day=>$sessions) foreach ($sessions as $session=>$periods) foreach ($periods as $period=>$selection) { if (!$selection) continue; [$classId,$type] = explode(':',$selection,2); $st->execute([(int)$classId,(int)$day,$session,(int)$period,$type === 'chuyen_de' ? 'chuyen_de':'chinh_khoa']); } $db->commit(); flash('success','Đã lưu thời khóa biểu. Nhấn “Sinh lịch” để cập nhật kế hoạch.'); } catch(Throwable $e){$db->rollBack();throw $e;} back('classes');
            case 'generate_schedule': generateSchedule(); flash('success','Đã sinh lịch toàn bộ năm học từ PPCT và thời khóa biểu.'); back('schedule');
            case 'update_lesson':
                $id = (int)$_POST['lesson_id']; $status = trim((string)$_POST['status']); $note = trim((string)$_POST['note']);
                $lesson = rows('SELECT b.id, b.ppct_item_id, ts.class_id FROM buoi_day b JOIN tkb_slots ts ON ts.id=b.tkb_slot_id WHERE b.id=?', [$id])[0] ?? null;
                if (!$lesson) throw new RuntimeException('Không tìm thấy buổi dạy cần cập nhật.');
                if (!in_array($status, STATUS_NAMES, true)) throw new RuntimeException('Trạng thái giảng dạy không hợp lệ.');
                $chosenItemId = (int)($_POST['ppct_item_id'] ?? 0);
                if ($chosenItemId && !itemBelongsToClass($chosenItemId, (int)$lesson['class_id'])) throw new RuntimeException('Tiết PPCT được chọn không thuộc chương trình của lớp này.');
                $itemId = $status === 'Nghỉ' ? null : ($chosenItemId ?: null);
                db()->prepare('UPDATE buoi_day SET trang_thai_id=?, ghi_chu=?, ppct_item_id=? WHERE id=?')->execute([statusId($status), $note, $itemId, $id]);
                $message = $status === 'Nghỉ'
                    ? 'Đã đánh dấu nghỉ. Tiết PPCT được để trống để bạn chủ động bố trí dạy bù.'
                    : ($status === 'Dạy bù' ? 'Đã lưu buổi dạy bù và tiết PPCT đã chọn.' : 'Đã cập nhật buổi dạy.');
                flash($status === 'Nghỉ' ? 'warning' : 'success', $message); back('schedule',['week'=>(int)$_POST['week']]);
            case 'download_xlsx': downloadLbg((int)$_POST['week']);
            default: throw new RuntimeException('Yêu cầu không được nhận diện.');
        }
    } catch (Throwable $e) { flash('error', $e->getMessage()); back($_POST['return_page'] ?? 'dashboard'); }
}
handlePost();

$page = $_GET['page'] ?? 'dashboard'; $allowed = ['dashboard','import','classes','schedule','progress','export','settings']; if (!in_array($page,$allowed,true)) $page='dashboard';
if ($page === 'import' && isset($_GET['reset'])) unset($_SESSION['import']);
$importEditKhoi = isKhoi((int)($_GET['edit'] ?? 0)) ? (int)$_GET['edit'] : 0;
$khoiStatus = khoiOverview();
$stats = ['tracks'=>(int)scalar('SELECT COUNT(*) FROM ppct_tracks'),'classes'=>(int)scalar('SELECT COUNT(*) FROM classes'),'slots'=>(int)scalar('SELECT COUNT(*) FROM tkb_slots'),'lessons'=>(int)scalar('SELECT COUNT(*) FROM buoi_day')];
function nav(string $current): string { $items=['dashboard'=>['⌂','Tổng quan'],'import'=>['⇧','Import PPCT'],'classes'=>['▦','Lớp & TKB'],'schedule'=>['◷','Lịch giảng dạy'],'progress'=>['◔','Tiến độ'],'export'=>['⇩','Xuất báo cáo'],'settings'=>['⚙','Thiết lập']]; $out=''; foreach($items as $p=>[$i,$label]) $out.='<a class="nav-link '.($current===$p?'active':'').'" href="?page='.$p.'"><span>'.$i.'</span>'.$label.'</a>'; return $out; }
?>
<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= h(APP_NAME) ?></title>
<style>
:root{--ink:#162031;--muted:#667085;--paper:#f5f7fb;--white:#fff;--line:#e4e8f0;--brand:#4f46e5;--brand-deep:#3730a3;--mint:#e7f8f1;--green:#148260;--amber:#b55d09;--red:#bc3030;--radius:18px;--shadow:0 12px 34px rgba(25,34,64,.08)}*{box-sizing:border-box}html{background:var(--paper)}body{margin:0;font:14px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:var(--paper)}button,input,select,textarea{font:inherit}button{cursor:pointer}.app{min-height:100vh;display:grid;grid-template-columns:252px 1fr}.sidebar{background:#171c34;color:#dbe2ff;padding:24px 14px;position:sticky;top:0;height:100vh;display:flex;flex-direction:column}.logo{display:flex;gap:10px;align-items:center;padding:0 10px 28px;font-weight:800;font-size:15px;color:#fff}.logo-mark{height:34px;width:34px;border-radius:11px;background:linear-gradient(145deg,#a5b4fc,#4f46e5);display:grid;place-items:center;color:#fff;font-size:18px}.logo small{display:block;color:#a7b0d7;font-weight:500;font-size:11px}.nav-link{display:flex;align-items:center;gap:12px;color:#bac4e9;padding:11px 12px;margin:2px 0;border-radius:10px;text-decoration:none;font-weight:600}.nav-link span{font-size:19px;width:20px;text-align:center}.nav-link:hover,.nav-link.active{background:#303760;color:#fff}.side-foot{margin-top:auto;border-top:1px solid #383e60;padding:16px 10px 0;color:#a7b0d7;font-size:12px}.main{min-width:0}.topbar{height:76px;background:rgba(255,255,255,.9);border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 clamp(20px,4vw,56px);position:sticky;top:0;z-index:2;backdrop-filter:blur(10px)}.crumb{color:var(--muted);font-size:13px}.crumb strong{display:block;color:var(--ink);font-size:17px}.term{border:1px solid #d7dcf7;color:var(--brand-deep);background:#f4f3ff;padding:7px 11px;border-radius:99px;font-weight:700;font-size:12px}.content{max-width:1440px;margin:auto;padding:30px clamp(20px,4vw,56px) 56px}.hero{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;margin:3px 0 25px}.hero h1{font-size:28px;letter-spacing:-.6px;line-height:1.18;margin:0 0 7px}.hero p{margin:0;color:var(--muted);max-width:700px}.btn{border:0;border-radius:10px;padding:10px 14px;background:var(--brand);color:#fff;font-weight:750;text-decoration:none;display:inline-flex;gap:8px;align-items:center;justify-content:center;box-shadow:0 5px 12px rgba(79,70,229,.2)}.btn:hover{background:var(--brand-deep)}.btn.secondary{color:var(--brand-deep);background:#eeefff;box-shadow:none}.btn.quiet{color:var(--muted);background:#fff;border:1px solid var(--line);box-shadow:none}.btn.danger{background:#fff0f0;color:var(--red);box-shadow:none}.card{background:var(--white);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:22px}.card h2,.card h3{margin:0 0 7px;font-size:17px}.card h3{font-size:15px}.subtle{color:var(--muted);margin:0}.grid{display:grid;gap:18px}.grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}.grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.stat{background:#fff;border:1px solid var(--line);border-radius:15px;padding:17px}.stat strong{font-size:28px;display:block;letter-spacing:-1px}.stat small{color:var(--muted);font-weight:600}.stat .icon{float:right;padding:7px;background:#efefff;border-radius:9px;color:var(--brand);font-size:18px}.notice{border-radius:12px;padding:12px 14px;margin-bottom:18px;border:1px solid}.notice.success{background:#edfbf5;color:#126448;border-color:#c9efdf}.notice.error{background:#fff1f1;color:#9e2929;border-color:#f8cccc}.notice.warning{background:#fff8e9;color:#87550b;border-color:#f4dfa7}.steps{display:flex;gap:7px;flex-wrap:wrap;margin:0 0 21px}.step{padding:7px 10px;border-radius:99px;background:#edf0f7;color:var(--muted);font-weight:700;font-size:12px}.step.on{background:#e7e7ff;color:var(--brand-deep)}form{margin:0}.form-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:14px}.field{grid-column:span 4}.field.six{grid-column:span 6}.field.twelve{grid-column:1/-1}label{display:block;font-weight:700;font-size:12px;margin:0 0 6px}input,select,textarea{width:100%;border:1px solid #d7dce6;background:#fff;border-radius:9px;padding:9px 10px;color:var(--ink);outline:none}textarea{min-height:68px;resize:vertical}input:focus,select:focus,textarea:focus{border-color:#918bfd;box-shadow:0 0 0 3px #e8e7ff}.action-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:19px}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:12px}.table{border-collapse:collapse;width:100%;min-width:650px}.table th{background:#f8f9fc;color:#4d5870;font-size:11px;letter-spacing:.2px;text-align:left;text-transform:uppercase;white-space:nowrap}.table th,.table td{padding:11px 12px;border-bottom:1px solid var(--line);vertical-align:top}.table tr:last-child td{border-bottom:0}.table td input,.table td textarea{padding:6px 7px;font-size:12px;min-width:80px}.table td textarea{min-height:35px}.badge{font-size:11px;font-weight:800;padding:4px 8px;border-radius:99px;white-space:nowrap;display:inline-block}.badge.ok{background:#e6f8f0;color:#137354}.badge.warn{background:#fff4dc;color:#965805}.badge.core{background:#e9e8ff;color:#4840c7}.badge.elective{background:#e5f7fb;color:#0c7184}.empty{text-align:center;padding:45px 20px;color:var(--muted)}.empty .empty-icon{font-size:34px;display:block;margin-bottom:8px}.upload{border:2px dashed #babdf4;border-radius:15px;padding:30px;text-align:center;background:#fbfbff}.upload strong{display:block;font-size:16px;margin:8px}.upload input{max-width:400px;margin:14px auto}.schedule-row{display:grid;grid-template-columns:110px 100px 90px 1fr 135px;gap:14px;align-items:center;padding:14px;border-bottom:1px solid var(--line)}.schedule-row:last-child{border:0}.schedule-title{font-weight:750}.schedule-title small{display:block;color:var(--muted);font-weight:500}.slot-grid{overflow:auto}.slot-grid table{border-collapse:separate;border-spacing:4px;min-width:720px;width:100%}.slot-grid th{font-size:12px;color:var(--muted);text-align:center}.slot-grid td{background:#f8f9fc;border-radius:8px;padding:2px;min-width:100px}.slot-grid select{border:0;background:transparent;padding:8px;font-size:12px}.help{font-size:12px;color:var(--muted);margin:5px 0 0}.inline-form{display:inline}.list{padding:0;margin:0;list-style:none}.list li{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 0;border-bottom:1px solid var(--line)}.list li:last-child{border:0}.check{width:20px;height:20px;display:inline-grid;place-items:center;border-radius:50%;background:#e4f8ef;color:var(--green);font-size:11px}.mini{font-size:12px;color:var(--muted)}.progress-bar{height:9px;border-radius:99px;background:#ebedf3;overflow:hidden}.progress-bar span{height:100%;display:block;background:linear-gradient(90deg,#4f46e5,#7c74fc);border-radius:inherit}.mobile-nav{display:none}.khoi-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-bottom:18px}.khoi-card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px;box-shadow:var(--shadow);display:flex;flex-direction:column;gap:10px}.khoi-card.ready{border-color:#c9efdf}.khoi-card h2{margin:0;font-size:16px;display:flex;align-items:center;justify-content:space-between}.khoi-meta{display:flex;gap:8px;flex-wrap:wrap}.khoi-card .file{font-size:12px;color:var(--muted);margin:0;word-break:break-all}.khoi-card form.upload-mini{display:flex;flex-direction:column;gap:8px}.khoi-card form.upload-mini input[type=file]{font-size:12px;padding:7px}
@media(max-width:920px){.app{display:block}.sidebar{display:none}.mobile-nav{display:flex;overflow:auto;gap:5px;background:#171c34;padding:9px;position:sticky;top:0;z-index:5}.mobile-nav .nav-link{font-size:11px;white-space:nowrap;padding:7px 9px;margin:0}.mobile-nav .nav-link span{display:none}.topbar{position:static;height:62px}.content{padding-top:24px}.stats{grid-template-columns:repeat(2,1fr)}.grid.two,.grid.three,.khoi-grid{grid-template-columns:1fr}.schedule-row{grid-template-columns:80px 90px 1fr}.schedule-row .lesson-meta{display:none}.schedule-row form{grid-column:1/-1}.field{grid-column:span 6}.field.six{grid-column:span 12px}}
@media(max-width:560px){.topbar{padding:0 18px}.topbar .term{display:none}.content{padding:21px 14px 38px}.hero{align-items:flex-start;flex-direction:column}.hero h1{font-size:24px}.stats{gap:9px}.stat{padding:13px}.stat strong{font-size:23px}.card{padding:16px;border-radius:14px}.field,.field.six{grid-column:1/-1}.form-grid{gap:11px}.action-row .btn{width:100%}.schedule-row{gap:8px;padding:12px 0;grid-template-columns:70px 74px 1fr}.schedule-row .btn{padding:8px}.hide-mobile{display:none}}
</style>
</head>
<body>
<div class="app"><aside class="sidebar"><div class="logo"><span class="logo-mark">✦</span><span>PPCT <small>Kế hoạch dạy học</small></span></div><?= nav($page) ?><div class="side-foot">Dữ liệu được lưu riêng trong SQLite<br>và tự tạo bản sao lưu khi thay đổi lớn.</div></aside>
<div class="main"><nav class="mobile-nav"><?= nav($page) ?></nav><header class="topbar"><div class="crumb">Quản lý giảng dạy <strong><?= h(['dashboard'=>'Tổng quan','import'=>'Import PPCT','classes'=>'Lớp học & thời khóa biểu','schedule'=>'Lịch giảng dạy','progress'=>'Tiến độ giảng dạy','export'=>'Xuất báo cáo','settings'=>'Thiết lập'][$page]) ?></strong></div><span class="term">Năm học <?= h(value('school_year')) ?></span></header><main class="content">
<?php foreach ($_SESSION['flash'] ?? [] as $message): ?><div class="notice <?= h($message['type']) ?>"><?= h($message['message']) ?></div><?php endforeach; unset($_SESSION['flash']); ?>
<?php if ($page === 'dashboard'): ?>
<section class="hero"><div><h1>Chào <?= h(value('teacher_name') ?: 'thầy/cô') ?> 👋</h1><p>Quản lý phân phối chương trình, thời khóa biểu và lịch báo giảng tại một nơi — rõ ràng, nhất quán, sẵn sàng để xuất báo cáo.</p></div><a class="btn" href="?page=import">⇧ Import PPCT mới</a></section>
<div class="stats"><div class="stat"><span class="icon">▤</span><strong><?= $stats['tracks'] ?></strong><small>Chương trình PPCT</small></div><div class="stat"><span class="icon">♙</span><strong><?= $stats['classes'] ?></strong><small>Lớp đang phụ trách</small></div><div class="stat"><span class="icon">▦</span><strong><?= $stats['slots'] ?></strong><small>Tiết trong TKB/tuần</small></div><div class="stat"><span class="icon">◷</span><strong><?= $stats['lessons'] ?></strong><small>Buổi đã sinh lịch</small></div></div>
<div class="grid two" style="margin-top:18px"><section class="card"><h2>Bắt đầu theo từng bước</h2><p class="subtle">Thiết lập nhanh cho một năm học mới.</p><ol class="list" style="margin-top:10px"><?php $steps=[['Import PPCT khối 10, 11, 12','import',$stats['tracks']>0],['Thêm lớp và gán thời khóa biểu','classes',$stats['classes']>0&&$stats['slots']>0],['Sinh lịch giảng dạy','schedule',$stats['lessons']>0],['Theo dõi, cập nhật và xuất báo cáo','export',false]]; foreach($steps as $n=>$step): ?><li><span><span class="check"><?= $step[2]?'✓':$n+1 ?></span> <strong><?= h($step[0]) ?></strong></span><a class="btn quiet" href="?page=<?= $step[1] ?>">Mở</a></li><?php endforeach ?></ol></section>
<section class="card"><h2>PPCT theo khối</h2><ul class="list"><?php foreach(IMPORT_KHOI as $khoi): $st=$khoiStatus[$khoi]; ?><li><span><strong>Khối <?=$khoi?></strong><span class="mini"><br><?php if($st['ready']): ?><?=h($st['subject'])?> · CK <?=$st['core']?> tiết<?php if($st['cd']): ?> · CĐ <?=$st['cd']?> tiết<?php endif ?><?php else: ?>Chưa upload<?php endif ?></span></span><span class="badge <?=$st['ready']?'ok':'warn'?>"><?=$st['ready']?'Đã parse':'Chưa có'?></span></li><?php endforeach ?></ul></section></div>
<?php elseif ($page === 'import'): $import=$_SESSION['import']??null; ?>
<section class="hero"><div><h1>Import PPCT theo khối</h1><p>Mỗi khối một tệp Word. Ứng dụng tự tách chính khóa và chuyên đề. Có thể mở lại để sửa sau khi lưu.</p></div></section>
<div class="khoi-grid">
<?php foreach (IMPORT_KHOI as $khoi): $st=$khoiStatus[$khoi]; $pending=($import['khoi']??null)===$khoi; ?>
<article class="khoi-card <?=$st['ready']?'ready':''?>">
<h2>Khối <?=$khoi?> <?php if($pending): ?><span class="badge warn">Đang xem trước</span><?php elseif($st['ready']): ?><span class="badge ok">Đã parse</span><?php else: ?><span class="badge">Chưa upload</span><?php endif ?></h2>
<?php if($st['ready']): ?>
<div class="khoi-meta"><span class="badge core">Chính khóa <?=$st['core']?> tiết</span><?php if($st['cd']): ?><span class="badge elective">Chuyên đề <?=$st['cd']?> tiết</span><?php else: ?><span class="badge">Chưa có chuyên đề</span><?php endif ?></div>
<p class="file"><?=h($st['subject']?:'Chưa có môn')?><?php if($st['file']): ?> · <?=h($st['file'])?><?php endif ?><?php if($st['date']): ?> · <?=h(date('d/m/Y H:i', strtotime($st['date'])))?><?php endif ?></p>
<div class="action-row" style="margin-top:4px"><a class="btn quiet" href="?page=import&amp;edit=<?=$khoi?>">Mở sửa</a></div>
<?php else: ?>
<p class="file">Chưa có PPCT. Tải tệp .docx có cả chính khóa và chuyên đề.</p>
<?php endif ?>
<form class="upload-mini" method="post" enctype="multipart/form-data">
<input type="hidden" name="csrf" value="<?=csrf()?>">
<input type="hidden" name="action" value="import_upload">
<input type="hidden" name="return_page" value="import">
<input type="hidden" name="khoi" value="<?=$khoi?>">
<input type="file" name="docx" accept=".docx,.doc" required>
<button class="btn <?=$st['ready']?'secondary':''?>" type="submit"><?=$st['ready']?'Upload lại':'Upload PPCT'?></button>
</form>
</article>
<?php endforeach ?>
</div>
<?php if($import): $groups=$import['groups']??[]; $khoi=(int)$import['khoi']; ?>
<section class="card" style="margin-bottom:18px"><h2>Xem trước khối <?=$khoi?></h2><p class="subtle">Đã tách từ “<?=h($import['filename'])?>”. Sửa dòng rồi lưu. Có thể hủy để quay lại.</p>
<form method="post" style="margin-top:14px">
<input type="hidden" name="csrf" value="<?=csrf()?>">
<input type="hidden" name="action" value="import_save">
<input type="hidden" name="return_page" value="import">
<div class="form-grid">
<div class="field six"><label>Môn học *</label><input name="subject_name" required value="<?=h((string)($import['subject_guess']??''))?>"></div>
<div class="field six"><label>Số tiết chính khóa / tuần *</label><input type="number" min="1" max="20" name="weekly" value="3" required></div>
</div>
<?php foreach (['chinh_khoa'=>'Chính khóa','chuyen_de'=>'Chuyên đề'] as $type=>$label): $items=$groups[$type]??[]; $report=$items?validateItems($items,$type==='chinh_khoa'?($import['expected']??null):null):null; ?>
<h3 style="margin:22px 0 8px"><?=h($label)?> · <?=count($items)?> tiết</h3>
<?php if(!$items): ?><p class="help">Không tìm thấy bảng <?=h(strtolower($label))?> trong tệp.</p>
<?php else: ?>
<?php if($report): ?><p class="help">Tiết lớn nhất <?=$report['max']?> · thiếu <?=count($report['missing'])?><?php if($report['missing']): ?> (<?=h(implode(', ',$report['missing']))?>)<?php endif ?> · trùng <?=count($report['duplicates'])?></p><?php endif ?>
<div class="table-wrap" style="margin-top:8px"><table class="table"><thead><tr><th>Tiết</th><th>Bài học / Chủ đề</th><th>Nội dung chi tiết</th><th>Yêu cầu cần đạt</th><th>Cảnh báo</th></tr></thead><tbody>
<?php foreach($items as $i=>$item): ?>
<tr>
<td><input name="groups[<?=$type?>][<?=$i?>][tiet_so]" value="<?=h((string)$item['tiet_so'])?>" type="number" min="1"></td>
<td><textarea name="groups[<?=$type?>][<?=$i?>][bai_hoc]" required><?=h($item['bai_hoc'])?></textarea></td>
<td><textarea name="groups[<?=$type?>][<?=$i?>][noi_dung_chi_tiet]"><?=h($item['noi_dung_chi_tiet'])?></textarea></td>
<td><textarea name="groups[<?=$type?>][<?=$i?>][yeu_cau_can_dat]"><?=h($item['yeu_cau_can_dat'])?></textarea></td>
<td><input name="groups[<?=$type?>][<?=$i?>][canh_bao]" value="<?=h((string)$item['canh_bao'])?>"></td>
</tr>
<?php endforeach ?>
</tbody></table></div>
<?php endif; endforeach ?>
<div class="action-row"><button class="btn" type="submit">Lưu PPCT khối <?=$khoi?></button></div>
</form>
<form method="post" style="margin-top:8px"><input type="hidden" name="csrf" value="<?=csrf()?>"><input type="hidden" name="action" value="import_cancel"><button class="btn quiet" type="submit">Hủy xem trước</button></form>
</section>
<?php elseif($importEditKhoi): $edit=$khoiStatus[$importEditKhoi]; ?>
<section class="card"><h2>Sửa PPCT khối <?=$importEditKhoi?></h2>
<?php if(!$edit['ready']): ?><p class="empty">Khối này chưa có dữ liệu.</p>
<?php else: ?>
<p class="subtle"><?=h($edit['subject'])?> · <?=h($edit['file'])?></p>
<form method="post" style="margin-top:14px">
<input type="hidden" name="csrf" value="<?=csrf()?>">
<input type="hidden" name="action" value="import_update_saved">
<input type="hidden" name="return_page" value="import">
<input type="hidden" name="khoi" value="<?=$importEditKhoi?>">
<?php foreach ($edit['tracks'] as $track): $items=rows('SELECT * FROM ppct_items WHERE track_id=? ORDER BY tiet_so,id',[(int)$track['id']]); $type=$track['loai_track']; ?>
<h3 style="margin:18px 0 8px"><?=$type==='chinh_khoa'?'Chính khóa':'Chuyên đề'?> · <?=count($items)?> tiết</h3>
<div class="table-wrap"><table class="table"><thead><tr><th>Tiết</th><th>Bài học / Chủ đề</th><th>Nội dung chi tiết</th><th>Yêu cầu cần đạt</th><th>Cảnh báo</th></tr></thead><tbody>
<?php foreach($items as $i=>$item): ?>
<tr>
<td><input name="groups[<?=$type?>][<?=$i?>][tiet_so]" value="<?=h((string)$item['tiet_so'])?>" type="number" min="1"></td>
<td><textarea name="groups[<?=$type?>][<?=$i?>][bai_hoc]" required><?=h($item['bai_hoc'])?></textarea></td>
<td><textarea name="groups[<?=$type?>][<?=$i?>][noi_dung_chi_tiet]"><?=h((string)$item['noi_dung_chi_tiet'])?></textarea></td>
<td><textarea name="groups[<?=$type?>][<?=$i?>][yeu_cau_can_dat]"><?=h((string)$item['yeu_cau_can_dat'])?></textarea></td>
<td><input name="groups[<?=$type?>][<?=$i?>][canh_bao]" value="<?=h((string)$item['canh_bao'])?>"></td>
</tr>
<?php endforeach ?>
</tbody></table></div>
<?php endforeach ?>
<div class="action-row"><button class="btn" type="submit">Lưu chỉnh sửa</button><a class="btn quiet" href="?page=import">Đóng</a></div>
</form>
<?php endif ?>
</section>
<?php endif ?>
<?php elseif ($page === 'classes'): $subjects=rows('SELECT * FROM subjects ORDER BY khoi,ten_mon'); $classes=rows('SELECT c.*,s.ten_mon,s.so_tiet_tuan_mac_dinh FROM classes c JOIN subjects s ON s.id=c.subject_id ORDER BY c.khoi,c.ten_lop'); $slots=rows('SELECT * FROM tkb_slots'); $slotMap=[];foreach($slots as $slot)$slotMap[$slot['thu']][$slot['buoi']][$slot['tiet_so_trong_buoi']]=$slot; $timetableWarnings=timetableWarnings(); ?>
<section class="hero"><div><h1>Lớp học & thời khóa biểu</h1><p>Khai báo lớp trước, sau đó gán từng tiết trên lưới thời khóa biểu cố định hằng tuần.</p></div><?php if($stats['slots']): ?><form method="post"><input type="hidden" name="csrf" value="<?=csrf()?>"><input type="hidden" name="action" value="generate_schedule"><button class="btn" type="submit">◷ Sinh lịch giảng dạy</button></form><?php endif ?></section>
<?php if($timetableWarnings): ?><div class="notice warning"><strong>Kiểm tra số tiết chính khóa/tuần.</strong> <?php foreach($timetableWarnings as $warning): ?>Lớp <strong><?=h($warning['ten_lop'])?></strong> đang có <?=$warning['so_tiet_da_gan']?>/<?=$warning['so_tiet_tuan_mac_dinh']?> tiết<?php if($warning !== end($timetableWarnings)): ?> · <?php endif; endforeach ?>. Vẫn có thể sinh lịch, nhưng PPCT có thể không khớp dự kiến.</div><?php endif ?>
<div class="grid two"><section class="card"><h2>Thêm lớp phụ trách</h2><?php if(!$subjects): ?><p class="empty">Hãy import PPCT trước để có môn–khối.</p><?php else:?><form method="post" style="margin-top:15px"><input type="hidden" name="csrf" value="<?=csrf()?>"><input type="hidden" name="action" value="add_class"><input type="hidden" name="return_page" value="classes"><div class="form-grid"><div class="field six"><label>Tên lớp *</label><input name="class_name" placeholder="Ví dụ: 11A1" required></div><div class="field six"><label>Môn học – khối *</label><select name="subject_id"><?php foreach($subjects as $subject): ?><option value="<?=$subject['id']?>"><?=h($subject['ten_mon'])?> · Khối <?=$subject['khoi']?> · <?=$subject['so_tiet_tuan_mac_dinh']?> tiết/tuần</option><?php endforeach ?></select></div></div><div class="action-row"><button class="btn">+ Thêm lớp</button></div></form><?php endif ?></section><section class="card"><h2>Lớp đã khai báo</h2><?php if(!$classes): ?><p class="empty">Chưa có lớp nào.</p><?php else:?><ul class="list"><?php foreach($classes as $class): ?><li><span><strong><?=h($class['ten_lop'])?></strong><span class="mini"><br><?=h($class['ten_mon'])?> · Khối <?=$class['khoi']?> · <?=$class['so_tiet_tuan_mac_dinh']?> tiết/tuần</span></span><form class="inline-form" method="post" onsubmit="return confirm('Xóa lớp này và dữ liệu lịch liên quan?')"><input type="hidden" name="csrf" value="<?=csrf()?>"><input type="hidden" name="action" value="delete_class"><input type="hidden" name="class_id" value="<?=$class['id']?>"><button class="btn danger">Xóa</button></form></li><?php endforeach ?></ul><?php endif ?></section></div>
<?php if($classes): ?><section class="card" style="margin-top:18px"><h2>Gán chuyên đề (nếu có)</h2><p class="subtle">Chuyên đề có tiến độ riêng cho từng lớp; chỉ cần gán nếu lớp đó thực sự học chuyên đề.</p><?php $electives=rows("SELECT t.*,s.ten_mon,s.khoi FROM ppct_tracks t JOIN subjects s ON s.id=t.subject_id WHERE t.loai_track='chuyen_de' ORDER BY s.khoi"); if($electives): ?><form method="post" style="margin-top:14px"><input type="hidden" name="csrf" value="<?=csrf()?>"><input type="hidden" name="action" value="assign_elective"><input type="hidden" name="return_page" value="classes"><div class="form-grid"><div class="field"><label>Lớp</label><select name="class_id"><?php foreach($classes as $c):?><option value="<?=$c['id']?>"><?=h($c['ten_lop'])?> · Khối <?=$c['khoi']?></option><?php endforeach?></select></div><div class="field"><label>Chuyên đề</label><select name="track_id"><?php foreach($electives as $track):?><option value="<?=$track['id']?>"><?=h($track['ten_mon'].' – '.$track['ten_track'])?></option><?php endforeach?></select></div><div class="field"><label>Số tiết/tuần</label><input name="hours" type="number" min="1" max="10" value="1"></div></div><div class="action-row"><button class="btn secondary">Gán chuyên đề</button></div></form><?php else:?><p class="help" style="margin-top:10px">Chưa có track “Chuyên đề” nào. Có thể import thêm một PPCT và chọn loại Chuyên đề.</p><?php endif ?></section>
<section class="card" style="margin-top:18px"><h2>Khung thời khóa biểu hằng tuần</h2><p class="subtle">Mỗi ô là một buổi dạy của giáo viên. “CĐ” là tiết chuyên đề; mặc định là chính khóa. Chỉ gán được một lớp cho mỗi khung thời gian.</p><form method="post"><input type="hidden" name="csrf" value="<?=csrf()?>"><input type="hidden" name="action" value="save_timetable"><input type="hidden" name="return_page" value="classes"><div class="slot-grid" style="margin-top:14px"><table><thead><tr><th>Buổi · tiết</th><?php foreach(DAYS as $day):?><th><?=h($day)?></th><?php endforeach?></tr></thead><tbody><?php foreach(SESSIONS as $session): for($period=1;$period<=5;$period++): ?><tr><th><?=$session?><br>Tiết <?=$period?></th><?php foreach(DAYS as $day=>$name): $selectedSlot=$slotMap[$day][$session][$period]??null;?><td><select name="slot[<?=$day?>][<?=$session?>][<?=$period?>]"><option value="">— Trống —</option><?php foreach($classes as $class): ?><option value="<?=$class['id']?>:chinh_khoa" <?=($selectedSlot && $selectedSlot['class_id']==$class['id'] && $selectedSlot['loai_tiet']==='chinh_khoa')?'selected':''?>><?=h($class['ten_lop'])?></option><?php $hasElective=(bool)scalar('SELECT 1 FROM class_chuyen_de_assignment WHERE class_id=?',[$class['id']]); if($hasElective):?><option value="<?=$class['id']?>:chuyen_de" <?=($selectedSlot && $selectedSlot['class_id']==$class['id'] && $selectedSlot['loai_tiet']==='chuyen_de')?'selected':''?>><?=h($class['ten_lop'])?> · CĐ</option><?php endif; endforeach?></select></td><?php endforeach?></tr><?php endfor; endforeach?></tbody></table></div><div class="action-row"><button class="btn" type="submit">Lưu thời khóa biểu</button></div></form></section><?php endif ?>
<?php elseif ($page === 'schedule'): $week=max(1,min((int)value('weeks'),(int)($_GET['week']??1))); $records=rows('SELECT b.*,ts.thu,ts.buoi,ts.tiet_so_trong_buoi,ts.loai_tiet,c.id AS class_id,c.ten_lop,c.khoi,c.subject_id,s.ten_mon,i.tiet_so,i.bai_hoc,i.noi_dung_chi_tiet,st.ten AS trang_thai FROM buoi_day b JOIN tkb_slots ts ON ts.id=b.tkb_slot_id JOIN classes c ON c.id=ts.class_id JOIN subjects s ON s.id=c.subject_id LEFT JOIN ppct_items i ON i.id=b.ppct_item_id JOIN teaching_statuses st ON st.id=b.trang_thai_id WHERE b.tuan_hoc=? ORDER BY ts.thu,CASE ts.buoi WHEN "Sáng" THEN 0 ELSE 1 END,ts.tiet_so_trong_buoi',[$week]); $ppctItemsByClass=[]; foreach(rows("SELECT c.id AS class_id,i.id,i.tiet_so,i.bai_hoc,t.loai_track FROM classes c JOIN ppct_tracks t ON t.subject_id=c.subject_id JOIN ppct_items i ON i.track_id=t.id LEFT JOIN class_chuyen_de_assignment a ON a.class_id=c.id AND a.track_id=t.id WHERE t.loai_track='chinh_khoa' OR a.id IS NOT NULL ORDER BY c.id,i.tiet_so,i.id") as $ppctItem) $ppctItemsByClass[$ppctItem['class_id']][]=$ppctItem; $coreSequences=[]; foreach($records as $record) if($record['loai_tiet']==='chinh_khoa') $coreSequences[$record['khoi'].':'.$record['subject_id']][$record['class_id']][]=$record['ppct_item_id'] ?: 0; $syncWarnings=[]; foreach($coreSequences as $group=>$sequences) if(count($sequences)>1 && count(array_unique(array_map(static fn($sequence)=>implode(',',$sequence),$sequences)))>1) { $classNames=[]; foreach($records as $record) if($record['loai_tiet']==='chinh_khoa' && $record['khoi'].':'.$record['subject_id']===$group) $classNames[$record['class_id']]=$record['ten_lop']; $syncWarnings[]=implode(', ',$classNames); } ?>
<section class="hero"><div><h1>Lịch giảng dạy</h1><p>Tuần <?=$week?> · <?=h(getWeekStart($week)->format('d/m/Y'))?> — <?=h(getWeekStart($week)->modify('+6 days')->format('d/m/Y'))?></p></div><?php if($records):?><form method="post"><input type="hidden" name="csrf" value="<?=csrf()?>"><input type="hidden" name="action" value="download_xlsx"><input type="hidden" name="week" value="<?=$week?>"><button class="btn secondary">⇩ Xuất LBG .xlsx</button></form><?php endif?></section>
<?php if($syncWarnings): ?><div class="notice warning"><strong>⚠ Cảnh báo đồng bộ theo khối:</strong> lịch chính khóa của <?=h(implode(' · ',$syncWarnings))?> đang không hoàn toàn giống nhau trong tuần này. Việc lệch có thể là chủ đích do dạy bù, vì vậy hệ thống chỉ nhắc và không tự sửa.</div><?php endif ?>
<div class="card"><div class="action-row" style="margin-top:0"><a class="btn quiet <?=$week<=1?'hide-mobile':''?>" href="?page=schedule&week=<?=$week-1?>">← Tuần trước</a><form method="get" class="inline-form"><input type="hidden" name="page" value="schedule"><select name="week" onchange="this.form.submit()" style="width:auto"><?php for($w=1;$w<=(int)value('weeks');$w++):?><option value="<?=$w?>" <?=$w===$week?'selected':''?>>Tuần <?=$w?></option><?php endfor?></select></form><a class="btn quiet <?=$week>=(int)value('weeks')?'hide-mobile':''?>" href="?page=schedule&week=<?=$week+1?>">Tuần sau →</a></div><?php if(!$records):?><div class="empty"><span class="empty-icon">◷</span><strong>Chưa có lịch để hiển thị</strong><p>Hãy khai báo lớp, thời khóa biểu, rồi nhấn “Sinh lịch giảng dạy”.</p><a class="btn" href="?page=classes">Đi tới Lớp & TKB</a></div><?php else:?><div style="margin-top:12px"><?php foreach($records as $record): ?><div class="schedule-row"><div><strong><?=h(DAYS[$record['thu']])?></strong><small class="mini"><?=h(date('d/m',strtotime($record['ngay_duong_lich'])))?></small></div><div><strong><?=h($record['buoi'])?></strong><small class="mini">Tiết TKB <?=$record['tiet_so_trong_buoi']?></small></div><div><span class="badge core"><?=h($record['ten_lop'])?></span><small class="mini" style="display:block;margin-top:5px"><?=h($record['ten_mon'])?></small></div><div class="schedule-title"><?php if($record['tiet_so']): ?>Tiết PPCT <?=$record['tiet_so']?> · <?=h($record['bai_hoc'])?><small><?=h($record['noi_dung_chi_tiet'] ?: 'Chưa có nội dung chi tiết')?></small><?php else:?><span class="badge warn">Chưa có PPCT</span><small>Kiểm tra số tiết/tuần hoặc bố trí tiết dạy bù.</small><?php endif?></div><form method="post"><input type="hidden" name="csrf" value="<?=csrf()?>"><input type="hidden" name="action" value="update_lesson"><input type="hidden" name="return_page" value="schedule"><input type="hidden" name="lesson_id" value="<?=$record['id']?>"><input type="hidden" name="week" value="<?=$week?>"><select name="ppct_item_id" aria-label="Tiết PPCT" title="Chọn tiết PPCT, đặc biệt khi dạy bù"><option value="">— Chưa gán PPCT —</option><?php foreach($ppctItemsByClass[$record['class_id']]??[] as $option): ?><option value="<?=$option['id']?>" <?=$record['ppct_item_id']==$option['id']?'selected':''?>>PPCT <?=$option['tiet_so']?> · <?=h(mb_strimwidth($option['bai_hoc'],0,38,'…','UTF-8'))?><?= $option['loai_track']==='chuyen_de'?' (CĐ)':'' ?></option><?php endforeach ?></select><select name="status" aria-label="Trạng thái" style="margin-top:5px"><?php foreach(STATUS_NAMES as $status):?><option <?=$record['trang_thai']===$status?'selected':''?>><?=h($status)?></option><?php endforeach?></select><input name="note" value="<?=h($record['ghi_chu'])?>" placeholder="Ghi chú" style="margin-top:5px"><button class="btn quiet" style="margin-top:5px;width:100%">Lưu</button></form></div><?php endforeach ?></div><?php endif?></div>
<?php elseif($page === 'progress'): $classes=rows('SELECT c.*,s.ten_mon FROM classes c JOIN subjects s ON s.id=c.subject_id ORDER BY c.khoi,c.ten_lop'); $selectedClass=(int)($_GET['class']??($classes[0]['id']??0)); $lessons=$selectedClass?rows('SELECT b.*,i.tiet_so,i.bai_hoc,st.ten AS trang_thai FROM buoi_day b JOIN tkb_slots ts ON ts.id=b.tkb_slot_id LEFT JOIN ppct_items i ON i.id=b.ppct_item_id JOIN teaching_statuses st ON st.id=b.trang_thai_id WHERE ts.class_id=? ORDER BY b.tuan_hoc,ts.thu,ts.buoi,ts.tiet_so_trong_buoi',[$selectedClass]):[]; $done=count(array_filter($lessons,fn($x)=>$x['trang_thai']!=='Nghỉ'&&$x['tiet_so'])); $total=count($lessons); ?>
<section class="hero"><div><h1>Tiến độ theo lớp</h1><p>Xem các tiết đã lên lịch, các buổi nghỉ và tiến độ thực hiện của từng lớp.</p></div></section><section class="card"><?php if(!$classes):?><div class="empty">Chưa có lớp để theo dõi.</div><?php else:?><form method="get"><input type="hidden" name="page" value="progress"><div class="form-grid"><div class="field"><label>Chọn lớp</label><select name="class" onchange="this.form.submit()"><?php foreach($classes as $c):?><option value="<?=$c['id']?>" <?=$c['id']==$selectedClass?'selected':''?>><?=h($c['ten_lop'].' · '.$c['ten_mon'])?></option><?php endforeach?></select></div></div></form><div class="grid three" style="margin:22px 0"><div><strong style="font-size:25px"><?=$done?></strong><span class="mini"> tiết đã lên lịch</span></div><div><strong style="font-size:25px"><?=$total?></strong><span class="mini"> buổi trong năm</span></div><div><strong style="font-size:25px"><?= $total?round($done/$total*100):0 ?>%</strong><span class="mini"> tiến độ kế hoạch</span></div></div><div class="progress-bar"><span style="width:<?=$total?min(100,$done/$total*100):0?>%"></span></div><div class="table-wrap" style="margin-top:20px"><table class="table"><thead><tr><th>Tuần</th><th>Ngày</th><th>Tiết PPCT</th><th>Bài học</th><th>Trạng thái</th></tr></thead><tbody><?php foreach($lessons as $lesson):?><tr><td>Tuần <?=$lesson['tuan_hoc']?></td><td><?=h(date('d/m/Y',strtotime($lesson['ngay_duong_lich'])))?></td><td><?=$lesson['tiet_so']?:'—'?></td><td><?=h($lesson['bai_hoc']?:'Chưa gán PPCT')?></td><td><span class="badge <?=$lesson['trang_thai']==='Nghỉ'?'warn':'ok'?>"><?=h($lesson['trang_thai'])?></span></td></tr><?php endforeach?></tbody></table></div><?php endif?></section>
<?php elseif($page === 'export'): ?>
<section class="hero"><div><h1>Xuất báo cáo</h1><p>Tải Lịch báo giảng tuần dưới dạng Excel (.xlsx), gồm các sheet LBG, Môn học – Lớp học và Kiểu giảng dạy.</p></div></section><section class="card"><h2>Lịch báo giảng tuần</h2><p class="subtle">Báo cáo tạo sẵn khung 7 ngày × 2 buổi × 5 tiết theo đúng cấu trúc biểu mẫu. Dữ liệu lấy từ lịch đã sinh và các cập nhật thực tế.</p><form method="post" style="margin-top:18px"><input type="hidden" name="csrf" value="<?=csrf()?>"><input type="hidden" name="action" value="download_xlsx"><div class="form-grid"><div class="field"><label>Chọn tuần</label><select name="week"><?php for($w=1;$w<=(int)value('weeks');$w++):?><option value="<?=$w?>">Tuần <?=$w?> · <?=h(getWeekStart($w)->format('d/m'))?></option><?php endfor?></select></div></div><div class="action-row"><button class="btn">⇩ Tải Lịch báo giảng .xlsx</button></div></form></section><section class="card" style="margin-top:18px"><h3>Ghi chú</h3><ul class="subtle"><li>Mỗi lần tải được tạo mới từ dữ liệu mới nhất trong hệ thống.</li><li>Trạng thái “Nghỉ” được giữ lại và tiết PPCT trống để bạn chủ động bố trí dạy bù.</li><li>Hệ thống không gửi dữ liệu giảng dạy của bạn tới dịch vụ bên thứ ba.</li></ul></section>
<?php elseif($page === 'settings'): ?>
<section class="hero"><div><h1>Thiết lập năm học</h1><p>Thông tin này được dùng khi sinh lịch và tạo báo cáo Lịch báo giảng.</p></div></section><section class="card"><form method="post"><input type="hidden" name="csrf" value="<?=csrf()?>"><input type="hidden" name="action" value="settings"><input type="hidden" name="return_page" value="settings"><div class="form-grid"><div class="field six"><label>Họ và tên giáo viên</label><input name="teacher_name" value="<?=h(value('teacher_name'))?>" placeholder="Ví dụ: Nguyễn Văn A"></div><div class="field six"><label>Năm học</label><input name="school_year" value="<?=h(value('school_year'))?>"></div><div class="field six"><label>Ngày bắt đầu tuần 1</label><input type="date" name="start_date" value="<?=h(value('start_date'))?>"><p class="help">Nên chọn Thứ 2 của tuần học đầu tiên.</p></div><div class="field six"><label>Số tuần học</label><input type="number" min="1" max="52" name="weeks" value="<?=h(value('weeks'))?>"></div></div><div class="action-row"><button class="btn">Lưu thiết lập</button></div></form></section><section class="card" style="margin-top:18px"><h3>Sao lưu dữ liệu</h3><p class="subtle">Cơ sở dữ liệu SQLite được lưu tại <code>storage/ppct.sqlite</code>. Trước các thay đổi lớn (import và sinh lại lịch), ứng dụng tự sao chép sang <code>storage/ppct.sqlite.bak</code>.</p></section>
<?php endif ?></main></div></div>
<?php if(isset($_GET['reset']) && $page==='import') unset($_SESSION['import']); ?>
</body></html>
