const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
dayjs.extend(customParseFormat);

/**
 * Chuyển chuỗi ngày tiếng Việt thành định dạng SQL (YYYY-MM-DD HH:mm:ss)
 * @param {string} input - Chuỗi ngày, ví dụ: "21 Tháng Sáu 2025 9:25 SA"
 * @returns {string|null} Chuỗi định dạng SQL hoặc null nếu lỗi
 */
function convertVietnameseDateToSQL(input) {
  const vietnameseMonths = {
    'Tháng Giêng': 1,
    'Tháng Một': 1,
    'Tháng Hai': 2,
    'Tháng Ba': 3,
    'Tháng Tư': 4,
    'Tháng Năm': 5,
    'Tháng Sáu': 6,
    'Tháng Bảy': 7,
    'Tháng Tám': 8,
    'Tháng Chín': 9,
    'Tháng Mười': 10,
    'Tháng Mười Một': 11,
    'Tháng Mười Hai': 12,
  };

  const regex =
    /(\d{1,2})\s+Tháng\s+([^\s]+)\s+(\d{4})\s+(\d{1,2}):(\d{2})\s+(SA|CH)/;
  const match = input.match(regex);

  if (!match) return null;

  const [_, day, monthName, year, hourStr, minuteStr, period] = match;
  const month = vietnameseMonths[`Tháng ${monthName}`];

  if (!month) return null;

  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);

  // Tạo chuỗi parse được bởi dayjs
  const formatted = `${year}-${String(month).padStart(2, '0')}-${String(
    day
  ).padStart(2, '0')} ${hour}:${minute} ${period}`;

  const parsed = dayjs(formatted, 'YYYY-MM-DD h:m A');

  if (!parsed.isValid()) return null;

  return parsed.format('YYYY-MM-DD HH:mm:ss');
}

function toVietnameseDateString(date) {
  const vietnameseMonths = [
    'Tháng Giêng',
    'Tháng Hai',
    'Tháng Ba',
    'Tháng Tư',
    'Tháng Năm',
    'Tháng Sáu',
    'Tháng Bảy',
    'Tháng Tám',
    'Tháng Chín',
    'Tháng Mười',
    'Tháng Mười Một',
    'Tháng Mười Hai',
  ];

  const d = new Date(date); // input là ISO string
  let hour = d.getHours();
  const minute = d.getMinutes();
  const period = hour >= 12 ? 'CH' : 'SA';

  // Chuyển sang 12h
  hour = hour % 12;
  if (hour === 0) hour = 12;

  return `${d.getDate()} ${
    vietnameseMonths[d.getMonth()]
  } ${d.getFullYear()} ${hour}:${String(minute).padStart(2, '0')} ${period}`;
}

function toSQLDateTime(date) {
  const d = new Date(date); // input là ISO string

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');

  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

module.exports = {
  convertVietnameseDateToSQL,
  toVietnameseDateString,
  toSQLDateTime,
};
