import 'server-only';
import { StyleSheet, Text, View } from '@react-pdf/renderer';
import {
  guardianRelationshipLabels,
  type LetterheadCentre,
  type PaperAnswer,
  type PaperForm,
  type PaperQuestion,
} from '@clinic-mx/schemas';
import { tokenValues } from '@clinic-mx/ui';
import { LetterheadDocument, Paragraph } from './letterhead';

/**
 * The paper health form and Part A consent (OPS-05) on a centre's letterhead: blank, for the desk
 * to print and keep for launch week and outages. Every question of the current form in order, with
 * boxes to tick and lines to write on, readable in black and white; the words are the live form's
 * (`paperForm`). It is about no patient, so it is neither stored nor logged.
 */

const mm = (millimetres: number) => (millimetres * 72) / 25.4;
const body = { fontSize: 10.5, lineHeight: 1.4 } as const;
const small = { fontSize: 9, lineHeight: 1.35 } as const;

const styles = StyleSheet.create({
  section: { marginBottom: mm(4) },
  heading: { fontWeight: 600, fontSize: 12, lineHeight: 1.3, marginBottom: mm(2) },
  question: { marginBottom: mm(3.5) },
  label: { ...body, fontWeight: 500 },
  note: { ...small, color: tokenValues['ink-secondary'] },
  row: { flexDirection: 'row', flexWrap: 'wrap', marginTop: mm(1.2) },
  choice: { flexDirection: 'row', alignItems: 'center', marginRight: mm(5), marginBottom: mm(1.2) },
  box: {
    width: mm(3.6),
    height: mm(3.6),
    borderWidth: 0.75,
    borderColor: tokenValues.ink,
    marginRight: mm(1.5),
  },
  choiceText: { ...body },
  line: {
    borderBottomWidth: 0.5,
    borderBottomColor: tokenValues['ink-secondary'],
    height: mm(7),
  },
  inlineLine: {
    borderBottomWidth: 0.5,
    borderBottomColor: tokenValues['ink-secondary'],
    width: mm(30),
    height: mm(6),
    marginRight: mm(2),
  },
  inline: { flexDirection: 'row', alignItems: 'flex-end', marginTop: mm(1.2) },
  scaleCell: { alignItems: 'center', marginRight: mm(2.2) },
  scaleNumber: { ...small, marginTop: mm(0.6) },
  statement: { ...body, marginBottom: mm(1.5) },
  signRow: { flexDirection: 'row', marginTop: mm(2) },
  signField: { flex: 1, marginRight: mm(6) },
  signLabel: { ...small, color: tokenValues['ink-secondary'] },
});

function Box({ label, note }: { label: string; note?: string | null }) {
  return (
    <View style={styles.choice}>
      <View style={styles.box} />
      <Text style={styles.choiceText}>
        {label}
        {note ? ` (${note.replace(/\.$/, '')})` : ''}
      </Text>
    </View>
  );
}

/** The question's own words already say how to tick ("Tick any that apply"). */
const saysHow = (label: string) => /^tick\s/i.test(label);

function Answer({ answer, label }: { answer: PaperAnswer; label: string }) {
  switch (answer.kind) {
    case 'yes_no':
      return (
        <View style={styles.row}>
          <Box label="Yes" />
          <Box label="No" />
        </View>
      );
    case 'number':
      return (
        <View style={styles.inline}>
          <View style={styles.inlineLine} />
          <Text style={styles.choiceText}>{answer.unit}</Text>
        </View>
      );
    case 'date':
      return (
        <View style={styles.inline}>
          <View style={styles.inlineLine} />
          <Text style={styles.note}>Day / month / year</Text>
        </View>
      );
    case 'text':
      return (
        <View>
          <View style={styles.line} />
          <View style={styles.line} />
        </View>
      );
    case 'scale':
      return (
        <View>
          <View style={styles.row}>
            {Array.from(
              { length: answer.max - answer.min + 1 },
              (_, index) => answer.min + index,
            ).map((value) => (
              <View key={value} style={styles.scaleCell}>
                <View style={styles.box} />
                <Text style={styles.scaleNumber}>{String(value)}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.note}>
            {`${String(answer.min)}: ${answer.minLabel}. ${String(answer.max)}: ${answer.maxLabel}. Tick one.`}
          </Text>
        </View>
      );
    case 'choice':
      return (
        <View>
          {saysHow(label) ? null : (
            <Text style={styles.note}>
              {answer.multiple ? 'Tick any that apply.' : 'Tick one.'}
            </Text>
          )}
          <View style={styles.row}>
            {answer.options.map((option, index) => (
              <Box key={index} label={option.label} note={option.note} />
            ))}
          </View>
        </View>
      );
  }
}

function Question({ question }: { question: PaperQuestion }) {
  return (
    <View style={styles.question} wrap={false}>
      <Text style={styles.label}>{question.label}</Text>
      {question.note ? <Text style={styles.note}>{question.note}</Text> : null}
      <Answer answer={question.answer} label={question.label} />
    </View>
  );
}

function SignField({ label }: { label: string }) {
  return (
    <View style={styles.signField}>
      <View style={styles.line} />
      <Text style={styles.signLabel}>{label}</Text>
    </View>
  );
}

export function PaperForms({
  centre,
  form,
  adultAge,
  generatedAt,
}: {
  centre: LetterheadCentre;
  form: PaperForm;
  /** Under this age a parent or guardian signs (`patients.adult_age_years`). */
  adultAge: number;
  generatedAt: Date;
}) {
  return (
    <LetterheadDocument
      title="Health form and consent"
      centre={centre}
      versionLabel={form.versionLabel}
      generatedAt={generatedAt}
    >
      <Paragraph>
        For when the form cannot be filled in on a phone. Please write clearly and tick the boxes
        that apply.
      </Paragraph>
      <View style={styles.section} wrap={false}>
        <Text style={styles.heading}>Patient</Text>
        <View style={styles.signRow}>
          <SignField label="Full name" />
          <SignField label="Mobile number" />
        </View>
        <View style={styles.signRow}>
          <SignField label="Date" />
          <SignField label="OP number (filled in by the clinic)" />
        </View>
      </View>
      {form.sections.map((section) =>
        section.kind === 'consent' ? (
          <View key={section.key} style={styles.section}>
            {section.statements.map((statement, index) => (
              // The heading never ends a page alone: it stays with the first statement.
              <View key={statement.key} style={styles.question} wrap={false}>
                {index === 0 ? (
                  <>
                    <Text style={styles.heading}>{section.title}</Text>
                    {section.note ? <Text style={styles.note}>{section.note}</Text> : null}
                  </>
                ) : null}
                <Text style={styles.statement}>{statement.text}</Text>
                <View style={styles.row}>
                  <Box label="I agree" />
                  <Box label="I do not agree" />
                </View>
              </View>
            ))}
            <View wrap={false}>
              <Text style={styles.statement}>
                {`A parent or guardian signs for a patient under ${String(adultAge)}.`}
              </Text>
              <View style={styles.signRow}>
                <SignField label="Signature" />
                <SignField label="Name of the person signing" />
              </View>
              <Text style={[styles.note, { marginTop: mm(2) }]}>
                If a parent or guardian signs, their relationship to the patient:
              </Text>
              <View style={styles.row}>
                {Object.values(guardianRelationshipLabels).map((label) => (
                  <Box key={label} label={label} />
                ))}
              </View>
            </View>
          </View>
        ) : (
          <View key={section.key} style={styles.section}>
            {/* The heading never ends a page alone: it stays with the first question. */}
            <View wrap={false}>
              <Text style={styles.heading}>{section.title}</Text>
              {section.note ? <Text style={styles.note}>{section.note}</Text> : null}
              {section.questions[0] ? <Question question={section.questions[0]} /> : null}
            </View>
            {section.questions.slice(1).map((question) => (
              <Question key={question.key} question={question} />
            ))}
          </View>
        ),
      )}
    </LetterheadDocument>
  );
}
