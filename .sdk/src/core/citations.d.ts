/**
 * TUTOR CITATIONS (2026-10-31; design follows T3 Code's assistant citations,
 * MIT): a citation is an ordinary markdown link inside the learner's plain
 * text, so drafts, the clipboard and the saved record carry it with no
 * separate store. Only the wire (toLlmMessages) and the document renderers
 * (compaction summary input, session markdown) rewrite it.
 *
 * The selector is a W3C-style text quote: the exact selected text plus its
 * UTF-16 offsets into the whitespace-normalised message text and up to 32
 * units of normalised context on each side. Re-finding a quote prefers the
 * context and never guesses between equal candidates.
 */
export declare const CITATION_MAX_TEXT_LENGTH = 8000;
export declare const CITATION_MAX_COMMENT_LENGTH = 8000;
export declare const CITATION_CONTEXT_LENGTH = 32;
export declare const CITATION_LABEL = "Tutor quote";
export interface TextSelector {
    text: string;
    start: number;
    end: number;
    prefix: string;
    suffix: string;
}
export interface TutorCitation extends TextSelector {
    version: 1;
    chatId: string;
    messageId: string;
    comment?: string;
}
export interface CitationOccurrence {
    citation: TutorCitation;
    /** The exact link text in the source string. */
    source: string;
    start: number;
    end: number;
}
export declare function serializeCitation(c: TutorCitation): string;
/** Strict: anything unexpected returns null and the link stays ordinary text. */
export declare function parseCitationHref(href: string): TutorCitation | null;
/** Blank comments drop the key; only the comment's outer whitespace is trimmed. */
export declare function withCitationComment(c: TutorCitation, comment: string | undefined): TutorCitation;
/** Chip label: the comment when there is one, else the quote; 64 characters. */
export declare function citationLabel(c: TutorCitation): string;
export declare function collectCitations(text: string): CitationOccurrence[];
/** The wire form: [tutor-quote-N] markers inline, one delimited JSON block after. */
export declare function expandCitationsForModel(text: string): string;
/** The document form (compaction summary input, session markdown). */
export declare function citationsToReadableText(text: string): string;
export declare function createTextSelector(text: string, rawStart: number, rawEnd: number): TextSelector | null;
/** Normalised offsets of the quote, or null when it is gone or ambiguous. */
export declare function findCitationText(text: string, selector: TextSelector): {
    start: number;
    end: number;
} | null;
