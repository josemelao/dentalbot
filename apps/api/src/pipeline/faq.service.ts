import { normalizeText } from '../common/text';
import { KnowledgeRepository } from '../db/repositories/knowledge.repository';
import { KnowledgeEntry } from '../db/repositories/rows';

export type FaqAnswer =
  | { found: true; entry: KnowledgeEntry }
  | { found: false; reason: 'NO_APPROVED_ENTRY' };

export class FaqService {
  constructor(private readonly knowledge: KnowledgeRepository) {}

  async answer(tenantId: string, text: string, now: Date = new Date()): Promise<FaqAnswer> {
    const entries = await this.knowledge.listApproved(tenantId, now);
    if (entries.length === 0) {
      return { found: false, reason: 'NO_APPROVED_ENTRY' };
    }

    const normalizedText = normalizeText(text);
    const matches: Array<{ entry: KnowledgeEntry; score: number }> = [];

    for (const entry of entries) {
      const matchedKeywords = entry.keywords
        .map((keyword) => normalizeText(keyword))
        .filter((keyword) => keyword.length > 0 && normalizedText.includes(keyword));

      if (matchedKeywords.length === 0) continue;

      matches.push({
        entry,
        score: Math.max(...matchedKeywords.map((keyword) => keyword.length)),
      });
    }

    if (matches.length === 0) {
      return { found: false, reason: 'NO_APPROVED_ENTRY' };
    }

    matches.sort(
      (left, right) =>
        right.score - left.score ||
        new Date(right.entry.validFrom).getTime() - new Date(left.entry.validFrom).getTime(),
    );

    return { found: true, entry: matches[0].entry };
  }
}
