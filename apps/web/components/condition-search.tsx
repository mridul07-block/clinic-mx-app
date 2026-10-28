'use client';

import {
  knowledgeRegions,
  searchConditions,
  type AssessmentCatalog,
  type AssessmentCondition,
  type KnowledgeRegion,
} from '@clinic-mx/schemas';
import { useId, useMemo, useState, type KeyboardEvent } from 'react';

const input =
  'w-full min-w-0 rounded-control border border-line-control bg-surface px-3 py-2 text-md shadow-xs hover:border-ink-muted read-only:bg-surface-sunken';

export const workbooksOf = (condition: AssessmentCondition) =>
  [...new Set(condition.listings.map((listing) => knowledgeRegions[listing.region].label))].join(
    ', ',
  );

/**
 * The tissue diagnosis: a search over the version's conditions (name, synonyms, each workbook's
 * name and the ID), as a combobox with its list; the chosen condition shows as a card.
 */
export function ConditionSearch({
  condition,
  catalog,
  region,
  readOnly,
  onChoose,
  label = 'Tissue diagnosis',
}: {
  condition: AssessmentCondition | undefined;
  catalog: AssessmentCatalog;
  region: KnowledgeRegion | undefined;
  readOnly: boolean;
  onChoose: (condition: AssessmentCondition) => void;
  label?: string;
}) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputId = useId();
  const results = useMemo(
    () => searchConditions(catalog.conditions, query, region ?? ''),
    [catalog.conditions, query, region],
  );
  const optionId = (index: number) => [listId, 'option', String(index)].join('-');
  const pick = (next: AssessmentCondition) => {
    onChoose(next);
    setSearching(false);
    setQuery('');
    setActive(0);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((at) => Math.min(at + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((at) => Math.max(at - 1, 0));
    } else if (event.key === 'Enter') {
      const next = results[active];
      if (next) {
        event.preventDefault();
        pick(next);
      }
    } else if (event.key === 'Escape') {
      setQuery('');
      if (condition) setSearching(false);
    }
  };

  if (condition && !searching) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="font-medium">{label}</span>
        <div
          data-testid="chosen-condition"
          className="flex items-start justify-between gap-3 rounded-panel border border-line px-3 py-2.5"
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-medium">{condition.name}</span>
            <span className="text-sm text-ink-muted">
              {condition.conditionId} · {workbooksOf(condition)}
            </span>
          </div>
          {readOnly ? null : (
            <button
              type="button"
              onClick={() => {
                setSearching(true);
              }}
              className="text-sm underline underline-offset-2"
            >
              Change
            </button>
          )}
        </div>
      </div>
    );
  }

  const open = query.trim() !== '';
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="font-medium">
        {label}
      </label>
      <input
        id={inputId}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && results.length > 0 ? optionId(active) : undefined}
        autoComplete="off"
        readOnly={readOnly}
        placeholder="Search conditions by name"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        className={input}
      />
      {open ? (
        results.length > 0 ? (
          <ul
            id={listId}
            role="listbox"
            aria-label="Conditions"
            className="flex flex-col divide-y divide-line rounded-panel border border-line"
          >
            {results.map((result, index) => (
              <li
                key={result.conditionId}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => {
                  // Keeps focus in the search until the click lands.
                  event.preventDefault();
                }}
                onClick={() => {
                  pick(result);
                }}
                className={[
                  'flex cursor-pointer flex-col gap-0.5 px-3 py-2 pointer-coarse:py-3',
                  index === active ? 'bg-surface-hover' : '',
                ].join(' ')}
              >
                <span className="font-medium">{result.name}</span>
                <span className="text-sm text-ink-muted">
                  {result.conditionId} · {workbooksOf(result)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p id={listId} className="text-sm text-ink-muted">
            No condition matches. Anything outside the knowledge base goes in Notes.
          </p>
        )
      ) : null}
      {condition ? (
        <button
          type="button"
          onClick={() => {
            setSearching(false);
            setQuery('');
          }}
          className="self-start text-sm underline underline-offset-2"
        >
          Keep {condition.name}
        </button>
      ) : null}
    </div>
  );
}
