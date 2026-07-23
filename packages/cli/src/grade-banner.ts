const GLYPH_HEIGHT = 6;
const GLYPH_GAP = " ";

// "ANSI Shadow" style glyphs covering every banner character: grades A-F,
// digits, and the "/" in "32/100". Rows within a glyph share one width.
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  " ": ["   ", "   ", "   ", "   ", "   ", "   "],
  "/": ["    ██╗", "   ██╔╝", "  ██╔╝ ", " ██╔╝  ", "██╔╝   ", "╚═╝    "],
  "0": [
    " ██████╗ ",
    "██╔═████╗",
    "██║██╔██║",
    "████╔╝██║",
    "╚██████╔╝",
    " ╚═════╝ ",
  ],
  "1": [" ██╗", "███║", "╚██║", " ██║", " ██║", " ╚═╝"],
  "2": ["██████╗ ", "╚════██╗", " █████╔╝", "██╔═══╝ ", "███████╗", "╚══════╝"],
  "3": ["██████╗ ", "╚════██╗", " █████╔╝", " ╚═══██╗", "██████╔╝", "╚═════╝ "],
  "4": ["██╗  ██╗", "██║  ██║", "███████║", "╚════██║", "     ██║", "     ╚═╝"],
  "5": ["███████╗", "██╔════╝", "███████╗", "╚════██║", "███████║", "╚══════╝"],
  "6": [
    " ██████╗ ",
    "██╔════╝ ",
    "███████╗ ",
    "██╔═══██╗",
    "╚██████╔╝",
    " ╚═════╝ ",
  ],
  "7": ["███████╗", "╚════██║", "    ██╔╝", "   ██╔╝ ", "   ██║  ", "   ╚═╝  "],
  "8": [" █████╗ ", "██╔══██╗", "╚█████╔╝", "██╔══██╗", "╚█████╔╝", " ╚════╝ "],
  "9": [" █████╗ ", "██╔══██╗", "╚██████║", " ╚═══██║", " █████╔╝", " ╚════╝ "],
  A: [" █████╗ ", "██╔══██╗", "███████║", "██╔══██║", "██║  ██║", "╚═╝  ╚═╝"],
  B: ["██████╗ ", "██╔══██╗", "██████╔╝", "██╔══██╗", "██████╔╝", "╚═════╝ "],
  C: [" ██████╗", "██╔════╝", "██║     ", "██║     ", "╚██████╗", " ╚═════╝"],
  D: ["██████╗ ", "██╔══██╗", "██║  ██║", "██║  ██║", "██████╔╝", "╚═════╝ "],
  F: ["███████╗", "██╔════╝", "█████╗  ", "██╔══╝  ", "██║     ", "╚═╝     "],
};

/**
 * Renders `text` as rows of large shadowed block letters, or null when the
 * text contains a character outside the banner glyph set.
 */
const renderBannerRows = (text: string): string[] | null => {
  const glyphs: (readonly string[])[] = [];

  for (const character of text) {
    const glyph = GLYPHS[character];
    if (glyph === undefined) {
      return null;
    }
    glyphs.push(glyph);
  }

  return Array.from({ length: GLYPH_HEIGHT }, (_, rowIndex) =>
    glyphs
      .map((glyph) => glyph[rowIndex])
      .join(GLYPH_GAP)
      .trimEnd()
  );
};

const getBannerWidth = (text: string): number =>
  Array.from(text).reduce(
    (width, character, index) =>
      width +
      (GLYPHS[character]?.[0].length ?? 0) +
      (index > 0 ? GLYPH_GAP.length : 0),
    0
  );

export { getBannerWidth, renderBannerRows };
