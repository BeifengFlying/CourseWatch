export interface MediaSample { id: string; current: number; playing: boolean; seeking: boolean; rate: number; }
export interface ActivitySample { media: MediaSample[]; reading: boolean; }

// A local observation counter, not a client for any platform's reporting API.
// Count real 1x advancement, once per wall-clock interval even with two players.
export class StudyTiming {
  mediaSeconds = 0;
  readingSeconds = 0;
  private previous?: { at: number; sample: ActivitySample };
  reset() { this.previous = undefined; }
  observe(at: number, sample: ActivitySample) {
    const previous = this.previous;
    this.previous = { at, sample };
    if (!previous) return;
    const elapsed = (at - previous.at) / 1000;
    if (elapsed <= 0 || elapsed > 5) return; // timer suspension/OS sleep isn't study
    let advancing = 0;
    for (const media of sample.media) {
      const before = previous.sample.media.find(m => m.id === media.id);
      if (!before || !media.playing || !before.playing || media.seeking || before.seeking || media.rate !== 1 || before.rate !== 1) continue;
      const delta = media.current - before.current;
      if (Number.isFinite(delta) && delta > 0 && delta <= elapsed + .4) advancing = Math.max(advancing, Math.min(elapsed, delta));
    }
    this.mediaSeconds += advancing;
    if (advancing === 0 && !sample.media.some(m => m.playing) && !previous.sample.media.some(m => m.playing) && sample.reading && previous.sample.reading) this.readingSeconds += elapsed;
  }
  snapshot(targetMinutes: number) { return { mediaSeconds: Math.floor(this.mediaSeconds), readingSeconds: Math.floor(this.readingSeconds), targetSeconds: targetMinutes * 60 }; }
  reached(targetMinutes: number) { return targetMinutes > 0 && this.mediaSeconds + this.readingSeconds >= targetMinutes * 60; }
}
