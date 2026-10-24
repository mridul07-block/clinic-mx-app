import 'server-only';
import { Document, Page, Path, StyleSheet, Svg, Text, View } from '@react-pdf/renderer';
import {
  CLINIC_NAME,
  documentDateTime,
  letterheadLines,
  type LetterheadCentre,
} from '@clinic-mx/schemas';
import { tokenValues } from '@clinic-mx/ui';
import type { ReactNode } from 'react';
import { MONO, SANS } from './fonts';
import { logoPaths, logoViewBox } from './logo-paths';

/**
 * The letterhead every patient document is printed on (ALT-05, Frontend Specification section
 * 11): A4 with 18 mm margins; the logo top left and the centre's details top right over a thin
 * gold rule (decorative only); IBM Plex Sans 10.5 pt, titles 14 pt, weights 400 to 600; hairline
 * tables with tabular figures (Plex's own) and rupee amounts right aligned; a footer with the
 * version, when it was generated, the clinic and "Page n of N". Everything reads in black and
 * white: status is written in words, never colour alone.
 */

/** Millimetres in PDF points. */
const mm = (millimetres: number) => (millimetres * 72) / 25.4;

/**
 * Body text: 10.5 pt, lines 1.4 apart. react-pdf reads a line height against the size in the same
 * style (an inherited size is not used), so each text style carries both.
 */
const body = { fontSize: 10.5, lineHeight: 1.4 } as const;

const styles = StyleSheet.create({
  // No line height on the page: react-pdf then drops the fixed footer. Text styles set it (body).
  page: {
    fontFamily: SANS,
    fontSize: 10.5,
    color: tokenValues.ink,
    paddingTop: mm(18),
    paddingHorizontal: mm(18),
    // The footer sits in the bottom margin's upper part, clear of the text.
    paddingBottom: mm(28),
  },
  header: { marginBottom: mm(8) },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  logo: { width: mm(52), height: mm(6.2) },
  centre: {
    maxWidth: mm(80),
    alignItems: 'flex-end',
    fontSize: 9,
    color: tokenValues['ink-secondary'],
  },
  centreLine: { textAlign: 'right' },
  clinic: { fontWeight: 600, color: tokenValues.ink },
  rule: { marginTop: mm(4), borderBottomWidth: 0.75, borderBottomColor: tokenValues.brand },
  footer: {
    position: 'absolute',
    bottom: mm(14),
    left: mm(18),
    right: mm(18),
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 8,
    color: tokenValues['ink-muted'],
    borderTopWidth: 0.5,
    borderTopColor: tokenValues['ink-faint'],
    paddingTop: mm(2),
  },
  title: { fontSize: 14, lineHeight: 1.25, fontWeight: 600, marginBottom: mm(5) },
  section: { marginBottom: mm(5) },
  heading: { fontWeight: 600, ...body, marginBottom: mm(1.5) },
  fieldRow: { flexDirection: 'row', marginBottom: mm(0.8) },
  fieldLabel: { width: mm(38), ...body, color: tokenValues['ink-secondary'] },
  fieldValue: { flex: 1, ...body },
  mono: { fontFamily: MONO },
  table: { borderTopWidth: 0.5, borderTopColor: tokenValues['ink-faint'] },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: tokenValues['ink-faint'],
  },
  cell: { flex: 1, ...body, paddingVertical: mm(1.5), paddingRight: mm(2) },
  headCell: { fontWeight: 500, color: tokenValues['ink-secondary'] },
  end: { textAlign: 'right', paddingRight: 0 },
  signOff: { marginTop: mm(8) },
  signedBy: { fontWeight: 600, ...body },
  muted: { ...body, color: tokenValues['ink-secondary'] },
  paragraph: { ...body, marginBottom: mm(2) },
});

function Logo() {
  return (
    <Svg viewBox={logoViewBox} style={styles.logo}>
      {logoPaths.map((path) => (
        <Path key={path.d.slice(0, 40)} d={path.d} fill={path.fill} />
      ))}
    </Svg>
  );
}

export interface LetterheadDocumentProps {
  /** The PDF's title, also in its properties. */
  title: string;
  centre: LetterheadCentre;
  /** The footer's first words: "Version 2", or "Letterhead preview" for one never stored. */
  versionLabel: string;
  generatedAt: Date;
  children: ReactNode;
}

/** A whole document on the centre's letterhead; its pages flow and repeat the header and footer. */
export function LetterheadDocument({
  title,
  centre,
  versionLabel,
  generatedAt,
  children,
}: LetterheadDocumentProps) {
  const [clinic, ...lines] = letterheadLines(centre);
  return (
    <Document
      title={title}
      author={CLINIC_NAME}
      creator="Clinic Mx"
      producer="Clinic Mx"
      language="en-IN"
    >
      <Page size="A4" style={styles.page}>
        <View fixed style={styles.header}>
          <View style={styles.headerRow}>
            <Logo />
            <View style={styles.centre}>
              <Text style={[styles.centreLine, styles.clinic]}>{clinic}</Text>
              {lines.map((line) => (
                <Text key={line} style={styles.centreLine}>
                  {line}
                </Text>
              ))}
            </View>
          </View>
          <View style={styles.rule} />
        </View>
        <Text style={styles.title}>{title}</Text>
        {children}
        <View fixed style={styles.footer}>
          <Text>
            {[versionLabel, `Generated ${documentDateTime(generatedAt)}`, CLINIC_NAME].join(' · ')}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** A titled part of a document. `breakBefore` starts it on a new page. */
export function Section({
  heading,
  breakBefore = false,
  children,
}: {
  heading: string;
  breakBefore?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={styles.section} break={breakBefore}>
      <Text style={styles.heading}>{heading}</Text>
      {children}
    </View>
  );
}

export function Paragraph({ children }: { children: ReactNode }) {
  return <Text style={styles.paragraph}>{children}</Text>;
}

/** Label and value pairs, such as a patient's details. */
export function Fields({ rows }: { rows: readonly (readonly [string, ReactNode])[] }) {
  return (
    <View>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.fieldRow} wrap={false}>
          <Text style={styles.fieldLabel}>{label}</Text>
          <Text style={styles.fieldValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

/** An OP number or bill number, in Plex Mono. */
export function Mono({ children }: { children: string }) {
  return <Text style={styles.mono}>{children}</Text>;
}

export interface TableColumn {
  label: string;
  /** Rupee amounts and counts sit at the end of their cell. */
  align?: 'start' | 'end';
}

/** A hairline table; a row never splits across pages. */
export function Table({
  columns,
  rows,
}: {
  columns: readonly TableColumn[];
  rows: readonly (readonly string[])[];
}) {
  const cell = (column: TableColumn | undefined) =>
    column?.align === 'end' ? [styles.cell, styles.end] : [styles.cell];
  return (
    <View style={styles.table}>
      <View style={styles.tableRow} fixed>
        {columns.map((column) => (
          <Text key={column.label} style={[...cell(column), styles.headCell]}>
            {column.label}
          </Text>
        ))}
      </View>
      {rows.map((row) => (
        <View key={row.join('|')} style={styles.tableRow} wrap={false}>
          {row.map((value, index) => (
            <Text key={[index, value].join('-')} style={cell(columns[index])}>
              {value}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * Who signed, with their credentials and when (Frontend Specification section 11). The signature
 * image waits for the clinic (DECISION ALT-05); until then the document says it was signed
 * digitally.
 */
export function SignOff({
  name,
  credentials,
  signedAt,
}: {
  name: string;
  credentials: string | null;
  signedAt: Date;
}) {
  return (
    <View style={styles.signOff} wrap={false}>
      <Text style={styles.signedBy}>{name}</Text>
      {credentials ? <Text style={styles.muted}>{credentials}</Text> : null}
      <Text style={styles.muted}>Digitally signed {documentDateTime(signedAt)}</Text>
    </View>
  );
}
