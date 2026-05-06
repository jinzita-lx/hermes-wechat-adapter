export function chunkText(text, maxLength) {
  const normalized = String(text || '').trim();
  if (!normalized) return [];
  if (normalized.length <= maxLength) return [normalized];

  const chunks = [];
  let remaining = normalized;
  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf('\n\n', maxLength);
    if (splitAt < maxLength * 0.5) splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt < maxLength * 0.5) splitAt = remaining.lastIndexOf('。', maxLength);
    if (splitAt < maxLength * 0.5) splitAt = maxLength;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks.filter(Boolean);
}

export function stripActivationPrefix(text, prefixes) {
  let value = String(text || '').trim();
  for (const prefix of prefixes) {
    if (value.startsWith(prefix)) return value.slice(prefix.length).trim();
  }
  return value;
}

export function hasActivationPrefix(text, prefixes) {
  const value = String(text || '').trim();
  return prefixes.some((prefix) => value.startsWith(prefix));
}

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
