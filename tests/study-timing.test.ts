import { it, expect } from "vitest";
import { StudyTiming, type ActivitySample } from "../packages/study/src/timing.js";
const sample = (current: number, extra = {}): ActivitySample => ({ media: [{ id: "video", current, playing: true, seeking: false, rate: 1, ...extra }], reading: false });
it("只累计正常播放实际推进，多个播放器不重复计时", () => {
  const t = new StudyTiming();
  t.observe(0, sample(0)); t.observe(1000, sample(1));
  const two = sample(2); two.media.push({ ...two.media[0], id: "second" });
  t.observe(2000, two); const next = { ...two, media: two.media.map(m => ({ ...m, current: 3 })) }; t.observe(3000, next);
  expect(t.snapshot(1)).toEqual({ mediaSeconds: 3, readingSeconds: 0, targetSeconds: 60 });
});
it("暂停、缓冲、拖动、倍速、休眠间隔不记媒体时长", () => {
  for (const [a, b, at] of [[sample(0), sample(0), 1000], [sample(0), sample(1, { playing: false }), 1000], [sample(0), sample(100), 1000], [sample(0), sample(1, { seeking: true }), 1000], [sample(0), sample(2, { rate: 2 }), 1000], [sample(0), sample(90), 90000]] as const) {
    const t = new StudyTiming(); t.observe(0, a); t.observe(at, b); expect(t.mediaSeconds).toBe(0);
  }
});
it("前台阅读单独累计，重置仅清基线，目标以有效时间判断", () => {
  const t = new StudyTiming(), reading = { media: [], reading: true };
  t.observe(0, reading); for (let i = 1; i <= 60; i++) t.observe(i * 1000, reading);
  expect(t.reached(1)).toBe(true); expect(t.reached(0)).toBe(false);
  t.reset(); t.observe(120000, reading); expect(t.readingSeconds).toBe(60);
  t.observe(121000, { media: [], reading: false }); expect(t.readingSeconds).toBe(60);
});
