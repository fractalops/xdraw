/**
 * Size limits for text the compiler must measure.
 *
 * Display text is measured grapheme by grapheme and wrapped before placement,
 * at = roughly 13 microseconds per character, so an uncapped label can hold
 * compilation for tens of seconds. Code is budgeted separately and far more
 * generously: a code block is expected to be long, and is measured per line.
 */
export const MAX_TEXT_CHARACTERS = 10_000;

export const MAX_CODE_SOURCE_CHARACTERS = 100_000;
export const MAX_CODE_LINES = 2_000;
export const MAX_CODE_LINE_CHARACTERS = 10_000;

export const MAX_HIGHLIGHT_SOURCE_CHARACTERS = 20_000;
export const MAX_HIGHLIGHT_LINES = 80;
export const MAX_HIGHLIGHT_LINE_CHARACTERS = 2_000;
export const MAX_HIGHLIGHT_RUNS = 240;
export const MAX_DRAWING_HIGHLIGHT_RUNS = 800;
