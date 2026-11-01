import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Combobox } from './combobox';

interface Person {
  id: string;
  name: string;
  op: string;
}

const people: Person[] = [
  { id: 'a', name: 'Test Person One', op: 'OP-0001' },
  { id: 'b', name: 'Test Person Two', op: 'OP-0002' },
];

const common = {
  items: people,
  itemToString: (person: Person) => person.name,
  itemKey: (person: Person) => person.id,
};

describe('Combobox', () => {
  it('is an input with the Input look that opens a list box, closed at first', () => {
    const html = renderToStaticMarkup(
      <Combobox {...common} aria-label="Patient" placeholder="Name or mobile" />,
    );
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Patient"');
    expect(html).toContain('placeholder="Name or mobile"');
    expect(html).toContain('border-line-control');
    expect(html).toContain('pointer-coarse:h-row-touch');
    expect(html).not.toContain('Test Person One');
  });

  it("takes a Field's id, description and invalid state on its input", () => {
    const html = renderToStaticMarkup(
      <Combobox {...common} id="patient" aria-describedby="patient-error" aria-invalid />,
    );
    expect(html).toMatch(/<input[^>]*id="patient"/);
    expect(html).toContain('aria-describedby="patient-error"');
    expect(html).toContain('aria-invalid="true"');
  });

  it('shows the list under the input when inline (search in a dialog), drawn by renderItem', () => {
    const html = renderToStaticMarkup(
      <Combobox
        {...common}
        inline
        searched
        aria-label="Search"
        renderItem={(person) => (
          <span>
            {person.name} <span className="font-mono">{person.op}</span>
          </span>
        )}
      />,
    );
    expect(html).toContain('role="listbox"');
    expect(html.match(/role="option"/g)).toHaveLength(2);
    expect(html).toContain('<span class="font-mono">OP-0002</span>');
    expect(html).toContain('pointer-coarse:min-h-11');
  });

  it('says so when nothing matches, and shows a status line over the options', () => {
    const html = renderToStaticMarkup(
      <Combobox
        {...common}
        items={[]}
        inline
        searched
        aria-label="Search"
        status="Searching"
        emptyText="No patients match"
      />,
    );
    expect(html).toContain('>No patients match</div>');
    expect(html).toMatch(/role="status"[^>]*>Searching</);
  });
});
