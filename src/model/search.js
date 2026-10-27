/*
  The advanced search: entries whose name and/or size contain the search text, in archive order.
  Port of KPod's SearchForm matching. Find Next/Previous wrap around.
*/

/**
 * @param {object[]} entries
 * @param {{text: string, names?: boolean, sizes?: boolean, matchCase?: boolean}} query
 */
export function findEntries(entries, { text, names = true, sizes = false, matchCase = false }) {
  const needle = matchCase ? String(text ?? "") : String(text ?? "").toUpperCase();
  if (!needle || (!names && !sizes)) return [];
  return entries.filter((entry) => {
    const name = matchCase ? entry.name : entry.name.toUpperCase();
    if (names && name.includes(needle)) return true;
    return sizes && String(entry.length).includes(needle);
  });
}

/** The index after (step 1) or before (step -1) `current`, wrapping around. */
export function stepIndex(current, count, step) {
  if (count === 0) return -1;
  if (current < 0) return step > 0 ? 0 : count - 1;
  return (current + step + count) % count;
}
