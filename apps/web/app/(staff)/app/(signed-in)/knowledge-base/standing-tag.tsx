import { knowledgeVersionStandingLabels, type KnowledgeVersionStanding } from '@clinic-mx/schemas';
import type { Tone } from '@clinic-mx/ui';
import { Tag } from '../../../../../components/tag';

const standingTone: Record<KnowledgeVersionStanding, Tone> = {
  live: 'done',
  superseded: 'neutral',
  awaiting: 'waiting',
  passed_over: 'outline',
};

/** Where a knowledge base version stands (SET-06), as a tag with its word. */
export function StandingTag({ standing }: { standing: KnowledgeVersionStanding }) {
  return <Tag tone={standingTone[standing]}>{knowledgeVersionStandingLabels[standing]}</Tag>;
}
