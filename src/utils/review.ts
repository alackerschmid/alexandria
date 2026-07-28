/**
 * Words in a markdown review, for the detail view's metadata line and the All view's section
 * summary. Markdown syntax that carries no prose — fence markers, list bullets, heading hashes,
 * link URLs — is stripped first, so a review full of links doesn't read as twice its length.
 */
export function reviewWordCount(review: string | null | undefined): number {
  if (!review) return 0;
  const prose = review
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks
    .replace(/`[^`]*`/g, " ") // inline code
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // links/images → their text
    .replace(/^\s{0,3}(#{1,6}|[-*+>]|\d+\.)\s+/gm, " ") // heading/list/quote markers
    .replace(/[*_~]/g, " ");
  const words = prose.match(/\S+/g);
  return words ? words.length : 0;
}
