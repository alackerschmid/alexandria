import DOMPurify from "dompurify";
import { marked } from "marked";

// The single place in the app that turns user-authored text into HTML. Everything rendered with
// v-html must come from here — reviews are the only such content today (MarkdownText.vue).
//
// `breaks: true` because a review is prose-with-notes, not a document: people expect a single
// Enter to break the line, the way it does in every note-taking app.
marked.use({ gfm: true, breaks: true });

// Images are dropped rather than sanitized. A remote <img> in a review would hand the reader's IP
// to a third-party host on every render — the same reason fonts are self-hosted rather than pulled
// from a CDN (see src/CLAUDE.md). Everything else CommonMark/GFM produces is allowed through.
const ALLOWED_TAGS = [
  "p", "br", "hr", "strong", "em", "del", "code", "pre", "blockquote",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "a",
  "table", "thead", "tbody", "tr", "th", "td",
];

const ALLOWED_ATTR = ["href", "title"];

// External links open in a new tab; noopener/noreferrer so the opened page can't reach back
// through window.opener or leak the referrer.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.getAttribute("href")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

export function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false });
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Blocks javascript:/data: URIs in links; http(s)/mailto only.
    ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
  });
}
