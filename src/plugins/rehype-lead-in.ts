/**
 * rehype-lead-in
 *
 * Wraps the opening words of each entry's first prose paragraph in
 * <span class="entry-leadin">…</span> at build time, so CSS can style the
 * opening as a tracked lead-in line (the editorial theme's alternative to a
 * drop cap). The cut is context-aware: it prefers the first natural clause
 * boundary (comma, dash, sentence end…) so the styled run reads as a phrase,
 * not an arbitrary word count.
 *
 * The span carries no styling of its own — themes that don't style
 * `.entry-leadin` (the preserved original family) render the text unchanged.
 */

// Minimal structural types for the HAST nodes we touch, to avoid a type-only
// dependency just for this small transform.
type HastText = { type: "text"; value: string };
type HastElement = {
  type: "element";
  tagName: string;
  properties?: Record<string, unknown>;
  children: HastNode[];
};
type HastNode = (HastText | HastElement | { type: string }) & {
  [key: string]: unknown;
};
type HastRoot = { type: "root"; children: HastNode[] };

/** Words considered before giving up on a clause boundary. */
const MAX_WORDS = 8;
/** A boundary inside the first couple of words is too abrupt to use. */
const MIN_WORDS = 3;
/** Words taken when no clause boundary lands within MAX_WORDS. */
const FALLBACK_WORDS = 4;

/** Clause boundaries we are happy to end the lead-in on. */
const BOUNDARY = /[,;:.!?…—–]$/;

/**
 * Where to cut `text` for the lead-in, in characters. Returns 0 when the
 * paragraph is too short to bother (the whole thing would be styled).
 */
function leadInLength(text: string): number {
  const words = [...text.matchAll(/\S+/g)];
  // Needs to be a real paragraph: a lead-in that swallows most of it reads
  // like shouting, so require a clear remainder after the fallback cut.
  if (words.length < FALLBACK_WORDS + MIN_WORDS) return 0;

  for (let i = MIN_WORDS - 1; i < Math.min(words.length, MAX_WORDS); i++) {
    const word = words[i];
    if (BOUNDARY.test(word[0])) return word.index! + word[0].length;
  }

  const last = words[FALLBACK_WORDS - 1];
  return last.index! + last[0].length;
}

function isElement(node: HastNode, tagName?: string): node is HastElement {
  return (
    node.type === "element" &&
    (tagName === undefined || (node as HastElement).tagName === tagName)
  );
}

export default function rehypeLeadIn() {
  return (tree: HastRoot) => {
    // The first top-level paragraph that *starts with text* — image-only
    // paragraphs (cover shots) and other blocks are passed over.
    const opening = tree.children.find(
      (node): node is HastElement =>
        isElement(node, "p") &&
        (node as HastElement).children[0]?.type === "text" &&
        ((node as HastElement).children[0] as HastText).value.trim().length > 0,
    );
    if (!opening) return;

    const textNode = opening.children[0] as HastText;
    const cut = leadInLength(textNode.value);
    if (!cut) return;

    const lead: HastElement = {
      type: "element",
      tagName: "span",
      properties: { className: ["entry-leadin"] },
      children: [{ type: "text", value: textNode.value.slice(0, cut) }],
    };
    const rest: HastText = { type: "text", value: textNode.value.slice(cut) };
    opening.children.splice(0, 1, lead, rest);
  };
}
