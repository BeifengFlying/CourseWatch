// UTC+8 has whole-hour offset, so these boundaries are also Beijing 00/30 minutes.
export const COURSE_SCAN_INTERVAL_MS = 30 * 60 * 1000;
export const courseScanSlot = (now = Date.now()) => Math.floor(now / COURSE_SCAN_INTERVAL_MS);
export const nextCourseScanAt = (now = Date.now()) => (courseScanSlot(now) + 1) * COURSE_SCAN_INTERVAL_MS;
