import { describe, expect, it } from 'vitest';
import {
  readAge,
  readOnset,
  readSex,
  redFlagTier,
  subregionName,
  synonymsOf,
  tagsIn,
} from './knowledge';

// SET-05 done when: normalised age, onset, sex, tags, red flag tier.
describe('reading the knowledge base workbooks', () => {
  it('reads ages as ranges, never narrower than the text', () => {
    expect(readAge('20-50')).toEqual({ min: 20, max: 50, plain: true });
    expect(readAge('50+')).toEqual({ min: 50, max: null, plain: true });
    expect(readAge('Any')).toEqual({ min: null, max: null, plain: false });
    expect(readAge('Any (peak under 5)')).toEqual({ min: null, max: null, plain: false });
    expect(readAge('Under 45 at onset')).toEqual({ min: null, max: 44, plain: false });
    expect(readAge('10-20 (onset)')).toEqual({ min: 10, max: 20, plain: false });
    expect(readAge('20-40 (athletes) / 70+ (insufficiency)')).toEqual({
      min: 20,
      max: null,
      plain: false,
    });
    expect(readAge('60+ (also young with high energy)')).toEqual({
      min: null,
      max: null,
      plain: false,
    });
    for (const unreadable of ['', 'adults', '50-20', 'about 40']) {
      expect(readAge(unreadable), unreadable).toBeUndefined();
    }
  });

  it('reads onsets and keeps what follows "after"', () => {
    expect(readOnset('Slow')).toEqual({ onsets: ['gradual'], note: null });
    expect(readOnset('Sudden/Slow')).toEqual({ onsets: ['sudden', 'gradual'], note: null });
    expect(readOnset('Slow/Sudden')).toEqual({ onsets: ['sudden', 'gradual'], note: null });
    expect(readOnset('Sudden/Recurrent')).toEqual({ onsets: ['sudden', 'recurrent'], note: null });
    expect(readOnset('Slow/Subacute')).toEqual({ onsets: ['gradual', 'subacute'], note: null });
    expect(readOnset('Slow after repeated sprains')).toEqual({
      onsets: ['gradual'],
      note: 'after repeated sprains',
    });
    expect(readOnset('Gradual')).toBeUndefined();
  });

  it('reads sex predominance and athletes', () => {
    expect(readSex('Male')).toEqual({ sex: 'male', athlete: false });
    expect(readSex('Equal')).toEqual({ sex: 'equal', athlete: false });
    expect(readSex('Female athletes')).toEqual({ sex: 'female', athlete: true });
    expect(readSex('Mostly men')).toBeUndefined();
  });

  it('reads the red flag tier from the wording', () => {
    expect(redFlagTier('No')).toBe('none');
    expect(redFlagTier('Screen: exclude a fracture')).toBe('screen');
    expect(redFlagTier('YES if there is progressive motor weakness')).toBe('conditional');
    expect(redFlagTier('YES for the VASCULAR subtypes')).toBe('conditional');
    expect(redFlagTier('YES - EMERGENCY. Same day referral')).toBe('red_flag');
    expect(redFlagTier('YES acutely')).toBe('red_flag');
    expect(redFlagTier('Possibly')).toBeUndefined();
  });

  it('tags activity text from the vocabulary', () => {
    expect(tagsIn('Overhead worker, painter, gym lifter, swimmer; also sedentary')).toEqual([
      'overhead',
      'weightlifting',
      'sedentary',
    ]);
    expect(tagsIn('Distance runner, military recruit')).toEqual(['running', 'military']);
    expect(tagsIn('Older adult after a fall onto an outstretched hand')).toEqual([
      'older_adult',
      'trauma_fall',
    ]);
    expect(tagsIn('Anyone')).toEqual([]);
  });

  it('finds synonyms and spells subregions one way', () => {
    expect(synonymsOf('Frozen Shoulder (Adhesive Capsulitis)')).toEqual(['Adhesive Capsulitis']);
    expect(synonymsOf('Subacromial Impingement (now: RCRSP)')).toEqual(['RCRSP']);
    expect(synonymsOf('Rotator Cuff Tear')).toEqual([]);
    expect(subregionName(' Pediatric ')).toBe('Paediatric');
    expect(subregionName('Anterior/Groin')).toBe('Anterior / Groin');
  });
});
