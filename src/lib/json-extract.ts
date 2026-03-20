/**
 * Extract the first valid JSON object from a string that may contain
 * surrounding text (e.g. markdown, explanation).
 * Uses brace-depth tracking with proper string/escape handling.
 */
export function extractJSON(text: string): object | null {
  for (let offset = 0; offset < text.length; offset++) {
    if (text[offset] !== "{") continue;

    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;

    for (let i = offset; i < text.length; i++) {
      const ch = text[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\" && inString) {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }

    if (end === -1) continue;

    try {
      return JSON.parse(text.slice(offset, end + 1)) as object;
    } catch {
      continue;
    }
  }

  return null;
}
