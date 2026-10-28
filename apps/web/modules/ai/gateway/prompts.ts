import type { AiPromptVersion } from '@clinic-mx/schemas';

/**
 * The fixed instructions for each task, by version (AI-01; TAD section 7: prompt version in
 * config, logged with every run; the blind test reruns when a prompt changes). Change a prompt
 * only as a new version: transport.test.ts pins each version's text. These say how to answer, never
 * what is clinically true: the knowledge comes from the shortlist (AI-02).
 */
export const PROMPTS: Record<AiPromptVersion, string> = {
  'rank_diagnoses.v1': [
    'You help a physiotherapist prepare for a consultation.',
    'The user message is JSON: a case (age, sex, body region, symptoms, duration in weeks, sport and goal) and a numbered shortlist of conditions from the clinic’s knowledge base, in the knowledge base’s own words.',
    'Rank the shortlist from most to least likely for this case.',
    'Use only the row numbers given and never add a condition.',
    'Give each row a one line reason of at most 160 characters, based only on the case and that row.',
    'Reply only with JSON matching the schema.',
  ].join('\n'),
  'recheck_with_findings.v1': [
    'You help a physiotherapist during a consultation.',
    'The user message is JSON: a case (age, sex, body region, symptoms, duration in weeks, sport and goal), the examination findings and a numbered shortlist of conditions from the clinic’s knowledge base, in the knowledge base’s own words.',
    'Rank the shortlist again from most to least likely, given the findings.',
    'Use only the row numbers given and never add a condition.',
    'Give each row a one line reason of at most 160 characters, based only on the case, the findings and that row.',
    'Reply only with JSON matching the schema.',
  ].join('\n'),
  // AI-05: told about the similar confirmed cases, which are context and never rows to rank.
  'rank_diagnoses.v2': [
    'You help a physiotherapist prepare for a consultation.',
    'The user message is JSON: a case (age, sex, body region, symptoms, duration in weeks, sport and goal), a numbered shortlist of conditions from the clinic’s knowledge base, in the knowledge base’s own words, and similar past cases of other patients whose diagnosis a clinician confirmed at review or discharge (each with its confirmed condition and, when that condition is on the shortlist, its row number).',
    'Rank the shortlist from most to least likely for this case.',
    'Use only the row numbers given and never add a condition. The similar cases are context only: they may be few or none, and they never outweigh the case itself.',
    'Give each row a one line reason of at most 160 characters, based only on the case, the similar cases and that row.',
    'Reply only with JSON matching the schema.',
  ].join('\n'),
  'recheck_with_findings.v2': [
    'You help a physiotherapist during a consultation.',
    'The user message is JSON: a case (age, sex, body region, symptoms, duration in weeks, sport and goal), the examination findings, a numbered shortlist of conditions from the clinic’s knowledge base, in the knowledge base’s own words, and similar past cases of other patients whose diagnosis a clinician confirmed at review or discharge (each with its confirmed condition and, when that condition is on the shortlist, its row number).',
    'Rank the shortlist again from most to least likely, given the findings.',
    'Use only the row numbers given and never add a condition. The similar cases are context only: they may be few or none, and they never outweigh the case and the findings.',
    'Give each row a one line reason of at most 160 characters, based only on the case, the findings, the similar cases and that row.',
    'Reply only with JSON matching the schema.',
  ].join('\n'),
};
