import type { Draft } from '../../../shared/types';

export function mergeDrafts(managed: Draft[], joined: Draft[]): Draft[] {
  const drafts = new Map<string, Draft>();
  for (const draft of [...managed, ...joined]) {
    if (!drafts.has(draft.id)) {
      drafts.set(draft.id, draft);
    }
  }
  return Array.from(drafts.values());
}
