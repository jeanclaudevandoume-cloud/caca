// Follower names: normalisation, shard file keys and build-time cleaning (split from town.js).

export function normName(s) {
  return String(s).trim().toLowerCase().replace(/^@/, '').replace(/[^a-z0-9._]/g, '');
}
export function shardKey(norm, len) {
  let k = norm.slice(0, len);
  while (k.length < len) k += '-';
  return k.replace(/\./g, '~');
}
// Pick the shard file for a name given the manifest's list of split prefixes.
export function shardFor(norm, split) {
  let len = 2;
  while (split && split.includes(shardKey(norm, len)) && len < 6) len++;
  return shardKey(norm, len);
}

// ---- follower names (build time) ----
// NFC; no control or format characters (bidi overrides, zero-width spaces, line separators) except a ZWJ
// inside an emoji sequence, ZWJ/ZWNJ inside Arabic/Indic/Sinhala words and tag characters after a black flag (England, Scotland, Wales);
// runs of combining marks capped at 4 (no "zalgo" towers; Hebrew and Tibetan names keep theirs); truncated to
// 40 grapheme clusters so no emoji is split. A name with nothing visible left becomes ''.
const SEG = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
// scripts whose words need ZWJ / ZWNJ to render correctly (elsewhere they are only invisible spoofing material)
const JOINING = /[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}]/u;
const ZWJ = String.fromCharCode(0x200d), ZWNJ = String.fromCharCode(0x200c), BLACK_FLAG = String.fromCodePoint(0x1f3f4);
export function cleanName(s) {
  const cps = Array.from(String(s).normalize('NFC'));
  const pict = (c) => c !== undefined && /\p{Extended_Pictographic}/u.test(c);
  const isTag = (c) => { const v = c.codePointAt(0); return v >= 0xe0020 && v <= 0xe007f; };
  const out = [];
  let marks = 0;
  for (let k = 0; k < cps.length; k++) {
    const c = cps[k];
    if (c === ZWJ || c === ZWNJ) {
      // ZWJ inside an emoji sequence (over skin tones and variation selectors), and ZWJ / ZWNJ between letters
      // (Persian and Indic scripts need them to render words correctly)
      let p = out.length - 1;
      while (p >= 0 && /[\p{M}\p{Emoji_Modifier}\uFE0F]/u.test(out[p])) p--;
      const next = cps[k + 1];
      if ((c === ZWJ && pict(out[p]) && pict(next)) || (JOINING.test(out[p] || '') && next !== undefined && /[\p{L}\p{M}]/u.test(next))) out.push(c);
      continue;
    }
    if (isTag(c)) {                                          // tag characters only in a run right after a black flag
      let p = out.length - 1;
      while (p >= 0 && isTag(out[p])) p--;
      if (out[p] === BLACK_FLAG) out.push(c);
      continue;
    }
    if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(c)) continue;
    if (/\p{M}/u.test(c)) { if (++marks > 4) continue; } else marks = 0;
    out.push(c);
  }
  const t = out.join('').trim();
  if (!/[\p{L}\p{N}\p{S}\p{P}]/u.test(t)) return '';
  const g = SEG ? Array.from(SEG.segment(t), (x) => x.segment) : Array.from(t);
  return g.slice(0, 40).join('');
}
