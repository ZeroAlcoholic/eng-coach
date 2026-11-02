// A Live model can slip a token from another language into its Chinese or
// English turn. zhTwProblem checks Mainland usage only, so this flags letters
// that neither Taiwan Chinese, Japanese nor English ever uses: the Latin letters
// only Vietnamese has (precomposed tone letters, ă, đ, ơ, ư), Cyrillic, Thai and
// Hangul. Latin-1 accents (café, résumé) stay allowed, because English uses them.
const STRAY =
  /[\u{0102}\u{0103}\u{0110}\u{0111}\u{01A0}\u{01A1}\u{01AF}\u{01B0}\u{1EA0}-\u{1EF9}\u{0400}-\u{04FF}\u{0E00}-\u{0E7F}\u{1100}-\u{11FF}\u{3130}-\u{318F}\u{AC00}-\u{D7AF}]+/gu;
export const strayScript = (text: string): string[] => text.match(STRAY) ?? [];
