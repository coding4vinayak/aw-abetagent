import { prisma } from "./db";

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be",
  "to", "of", "in", "on", "for", "with", "at", "by", "do", "does", "did",
  "what", "when", "where", "who", "how", "why", "which", "can", "could",
  "would", "should", "it", "its", "this", "that", "these", "those", "i",
  "you", "we", "they", "he", "she", "my", "your", "our", "me", "us",
  "have", "has", "had", "will", "just", "about", "there", "here", "your",
]);

export function tokenize(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
  return [...new Set(tokens)];
}

function splitChunks(text: string, size = 800, overlap = 120): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    chunks.push(words.slice(start, start + size).join(" "));
    if (start + size >= words.length) break;
    start += size - overlap;
  }
  return chunks;
}

export async function ingestDocument(knowledgeBaseId: string, title: string, text: string, source?: string) {
  const doc = await prisma.document.create({
    data: { knowledgeBaseId, title, ...(source != null ? { source } : {}) },
  });
  const parts = splitChunks(text);
  for (let i = 0; i < parts.length; i++) {
    await prisma.chunk.create({
      data: { documentId: doc.id, position: i, text: parts[i], tokens: tokenize(parts[i]) },
    });
  }
  return { documentId: doc.id, chunks: parts.length };
}

export interface ScoredChunk {
  chunkId: string;
  documentTitle: string;
  text: string;
  overlap: number;
}

/** Keyword-overlap retrieval: deterministic, explainable, needs no vectors. */
export async function searchKnowledge(workspaceId: string, knowledgeBaseId: string | null, query: string, limit = 3): Promise<ScoredChunk[]> {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return [];

  const chunks = await prisma.chunk.findMany({
    where: knowledgeBaseId
      ? { document: { knowledgeBaseId, knowledgeBase: { workspaceId } } }
      : { document: { knowledgeBase: { workspaceId } } },
    include: { document: { select: { title: true } } },
    take: 500,
  });

  const scored: ScoredChunk[] = [];
  for (const c of chunks) {
    const tokens = c.tokens as unknown as string[];
    if (!Array.isArray(tokens)) continue;
    let overlap = 0;
    for (const t of tokens) if (queryTokens.has(t)) overlap++;
    if (overlap > 0) {
      scored.push({ chunkId: c.id, documentTitle: c.document.title, text: c.text, overlap });
    }
  }

  scored.sort((a, b) => b.overlap - a.overlap || a.text.length - b.text.length);
  return scored.slice(0, limit);
}
