// Adaptive quality: measures the display's refresh interval, then every second compares the average time of
// active, rendered frames with it and steps pixel ratio / detail scale down (fast) or up (slowly). No DOM:
// the stats object, the quality object and `hidden` are injected.
export function createGovernor({ quality, stats, hidden = () => false }) {
  const refresh = { samples: [], ms: 16.7 };
  let acc = 0, n = 0, last = -Infinity, good = 0;
  return {
    refresh,
    sample(dtMs) {           // every frame: refresh-interval estimate from the first 90 frames
      if (refresh.samples.length < 90) { refresh.samples.push(dtMs); if (refresh.samples.length === 90) { const s = refresh.samples.slice(30).sort((a, b) => a - b); refresh.ms = Math.max(6.9, s[s.length >> 1]); } }
    },
    count(dtMs) { acc += dtMs; n++; },   // only active, rendered frames are judged
    tick(now) {
      if (now - last < 1000) return;
      if (n < 10) { last = now; return; }                 // idle: nothing to judge
      const avg = acc / Math.max(1, n);
      stats.fps = Math.round(1000 / avg); stats.ms = avg;
      acc = 0; n = 0; last = now;
      if (quality.mode !== 'auto' || hidden() || refresh.samples.length < 90) return;
      const target = refresh.ms < 12 ? 16.7 : refresh.ms;   // high refresh displays: aim for 60
      if (avg > target * 1.3) {
        good = -3;
        if (quality.pr > 1) quality.pr = Math.max(1, quality.pr - 0.25);
        else if (quality.s > 0.45) quality.s = Math.max(0.45, quality.s - 0.1);
        else if (quality.pr > 0.6) quality.pr = Math.max(0.6, quality.pr - 0.1);
      } else if (avg < target * 1.08) {
        if (++good >= 4) {
          good = 0;
          if (quality.pr < 1) quality.pr = Math.min(1, quality.pr + 0.1);
          else if (quality.s < quality.maxS) quality.s = Math.min(quality.maxS, quality.s + 0.05);
          else if (quality.pr < quality.maxPr) quality.pr = Math.min(quality.maxPr, quality.pr + 0.25);
        }
      } else good = 0;
    },
  };
}
