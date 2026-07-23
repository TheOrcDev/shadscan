const GLYPH_HEIGHT = 5;
const GLYPH_GAP = " ";
const SPACE_GLYPH_WIDTH = 3;

// 5x5 block glyphs covering every banner character: grades A-F, digits,
// and the "/" in "32/100". "X" marks a filled cell.
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  "/": ["....X", "...X.", "..X..", ".X...", "X...."],
  "0": [".XXX.", "X...X", "X...X", "X...X", ".XXX."],
  "1": ["..X..", ".XX..", "..X..", "..X..", ".XXX."],
  "2": ["XXXX.", "....X", ".XXX.", "X....", "XXXXX"],
  "3": ["XXXX.", "....X", ".XXX.", "....X", "XXXX."],
  "4": ["X..X.", "X..X.", "XXXXX", "...X.", "...X."],
  "5": ["XXXXX", "X....", "XXXX.", "....X", "XXXX."],
  "6": [".XXX.", "X....", "XXXX.", "X...X", ".XXX."],
  "7": ["XXXXX", "....X", "...X.", "..X..", "..X.."],
  "8": [".XXX.", "X...X", ".XXX.", "X...X", ".XXX."],
  "9": [".XXX.", "X...X", ".XXXX", "....X", ".XXX."],
  A: [".XXX.", "X...X", "XXXXX", "X...X", "X...X"],
  B: ["XXXX.", "X...X", "XXXX.", "X...X", "XXXX."],
  C: [".XXXX", "X....", "X....", "X....", ".XXXX"],
  D: ["XXXX.", "X...X", "X...X", "X...X", "XXXX."],
  F: ["XXXXX", "X....", "XXXX.", "X....", "X...."],
};

const getGlyphRows = (character: string): readonly string[] | null => {
  if (character === " ") {
    return Array.from({ length: GLYPH_HEIGHT }, () =>
      ".".repeat(SPACE_GLYPH_WIDTH)
    );
  }

  return GLYPHS[character] ?? null;
};

/**
 * Renders `text` as rows of large block letters, or null when the text
 * contains a character outside the banner glyph set.
 */
const renderBannerRows = (
  text: string,
  fillCharacter: string
): string[] | null => {
  const glyphs: (readonly string[])[] = [];

  for (const character of text) {
    const glyph = getGlyphRows(character);
    if (glyph === null) {
      return null;
    }
    glyphs.push(glyph);
  }

  return Array.from({ length: GLYPH_HEIGHT }, (_, rowIndex) =>
    glyphs
      .map((glyph) => glyph[rowIndex])
      .join(GLYPH_GAP)
      .replaceAll("X", fillCharacter)
      .replaceAll(".", " ")
      .trimEnd()
  );
};

const getBannerWidth = (text: string): number =>
  Array.from(text).reduce(
    (width, character, index) =>
      width +
      (character === " " ? SPACE_GLYPH_WIDTH : GLYPH_HEIGHT) +
      (index > 0 ? GLYPH_GAP.length : 0),
    0
  );

export { getBannerWidth, renderBannerRows };
