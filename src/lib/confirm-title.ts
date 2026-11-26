/**
 * The title convention: a question ending in "?", unless the caller already
 * wrote one. Kept apart from the dialog component so pages can build a title
 * without importing the modal (and its markup) into their first-load bundle.
 */
export function confirmTitle(subject: string): string {
  const trimmed = subject.trim();
  if (!trimmed) return "";
  return trimmed.endsWith("?") ? trimmed : `${trimmed}?`;
}
