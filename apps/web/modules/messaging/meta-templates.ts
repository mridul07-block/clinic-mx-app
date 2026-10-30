import 'server-only';
import { recordTemplateVersion, type Db, type TemplateVersionOnMeta } from '@clinic-mx/db';
import {
  TEMPLATE_LANGUAGE,
  messageTemplates,
  metaTemplateName,
  templateApprovalOf,
  templateCreateBody,
  type MessageTemplateDefinition,
} from '@clinic-mx/schemas';
import { z } from 'zod';
import { systemService } from '../access/service';

/**
 * Submitting the clinic's templates to Meta and reading back its verdict (WA-06; TAD section 6),
 * for `pnpm whatsapp:templates`. Each registry version not on Meta yet is created there, with
 * made-up examples and one generated sample PDF for document headers; what Meta says of each is
 * recorded in `whatsapp_template` as `system:whatsapp-templates`. Nothing of the token or of a
 * patient goes anywhere: the examples are fake and only names and statuses are returned.
 */

export interface MetaConfig {
  accessToken: string;
  businessAccountId: string;
  graphVersion: string;
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export class MetaTemplateError extends Error {
  override name = 'MetaTemplateError';
}

const metaTemplate = z.object({
  id: z.string(),
  name: z.string(),
  language: z.string(),
  status: z.string(),
  category: z.string(),
  rejected_reason: z.string().optional(),
});
type MetaTemplate = z.infer<typeof metaTemplate>;

const listPage = z.object({
  data: z.array(metaTemplate),
  paging: z.object({ next: z.string().optional() }).optional(),
});

export function graph(config: MetaConfig, path: string): string {
  return `https://graph.facebook.com/${config.graphVersion}/${path}`;
}

/** Meta's error title only; never the request, which carries the token in its headers. */
export async function metaJson(response: Response, what: string): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = z
      .object({ error: z.object({ message: z.string(), error_user_msg: z.string().optional() }) })
      .safeParse(body);
    const detail = error.success
      ? (error.data.error.error_user_msg ?? error.data.error.message)
      : `HTTP ${String(response.status)}`;
    throw new MetaTemplateError(`${what}: ${detail}`);
  }
  return body;
}

export function metaTemplateClient(config: MetaConfig, send: Fetch = fetch) {
  const auth = { Authorization: `Bearer ${config.accessToken}` };
  return {
    /** Every template on the business account, Meta's samples included. */
    async list(): Promise<MetaTemplate[]> {
      const templates: MetaTemplate[] = [];
      let url: string | undefined = graph(
        config,
        `${config.businessAccountId}/message_templates?fields=id,name,language,status,category,rejected_reason&limit=100`,
      );
      while (url) {
        const page = listPage.parse(
          await metaJson(await send(url, { headers: auth }), 'Listing templates'),
        );
        templates.push(...page.data);
        url = page.paging?.next;
      }
      return templates;
    },
    /**
     * Uploads a sample PDF for a document header's example (Meta's resumable upload, under the
     * app the token belongs to); its handle goes in the template.
     */
    async uploadSample(pdf: Uint8Array<ArrayBuffer>): Promise<string> {
      const app = z
        .object({ id: z.string() })
        .parse(
          await metaJson(await send(graph(config, 'app'), { headers: auth }), 'Finding the app'),
        );
      const session = z
        .object({ id: z.string() })
        .parse(
          await metaJson(
            await send(
              graph(
                config,
                `${app.id}/uploads?file_name=sample.pdf&file_length=${String(pdf.byteLength)}&file_type=application/pdf`,
              ),
              { method: 'POST', headers: auth },
            ),
            'Starting the sample upload',
          ),
        );
      const uploaded = z.object({ h: z.string() }).parse(
        await metaJson(
          await send(graph(config, session.id), {
            method: 'POST',
            headers: { Authorization: `OAuth ${config.accessToken}`, file_offset: '0' },
            body: pdf,
          }),
          'Uploading the sample PDF',
        ),
      );
      return uploaded.h;
    },
    async create(body: ReturnType<typeof templateCreateBody>) {
      return z.object({ id: z.string(), status: z.string(), category: z.string() }).parse(
        await metaJson(
          await send(graph(config, `${config.businessAccountId}/message_templates`), {
            method: 'POST',
            headers: { ...auth, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
          `Creating ${body.name}`,
        ),
      );
    },
  };
}

export type MetaTemplateClient = ReturnType<typeof metaTemplateClient>;

const record = systemService({
  component: 'whatsapp-templates',
  input: z.object({ versions: z.array(z.custom<TemplateVersionOnMeta>()) }),
  run: async (tx, { versions }) => {
    for (const version of versions) await recordTemplateVersion(tx, version);
  },
});

/** Meta's template as a recorded version of ours; none for one not in the registry. */
function asVersion(found: MetaTemplate): TemplateVersionOnMeta | null {
  const match = /^([a-z][a-z0-9_]*)_v(\d+)$/.exec(found.name);
  const status = templateApprovalOf(found.status);
  if (!match?.[1] || !status || !messageTemplates.some((entry) => entry.key === match[1])) {
    return null;
  }
  return {
    key: match[1],
    version: Number(match[2]),
    language: found.language,
    metaName: found.name,
    metaId: found.id,
    category: found.category,
    status,
    reason:
      found.rejected_reason && found.rejected_reason !== 'NONE' ? found.rejected_reason : null,
  };
}

export interface SubmitResult {
  key: string;
  version: number;
  status: string;
  /**
   * Created now, already on Meta, waiting (held for another ticket, or a Flow button without
   * its Flow on this number), or refused by Meta (its message as the status).
   */
  outcome: 'submitted' | 'on_meta' | 'held' | 'refused';
}

/**
 * Creates each registry version Meta does not have yet, then records what Meta says of every
 * version of ours it holds. A held template, or one with a Flow button when `flowId` (the
 * reschedule Flow on this number, WA-05) is not given, is left out; Meta refusing one is reported
 * for it, and the others go on.
 */
export async function submitTemplates(
  db: Db,
  meta: MetaTemplateClient,
  options: { origin: string; samplePdf: () => Uint8Array<ArrayBuffer>; flowId?: string },
  templates: readonly MessageTemplateDefinition[] = messageTemplates,
): Promise<SubmitResult[]> {
  const onMeta = await meta.list();
  const has = (name: string) =>
    onMeta.find((found) => found.name === name && found.language === TEMPLATE_LANGUAGE);
  const waiting = (template: MessageTemplateDefinition) =>
    Boolean(template.held) ||
    (!options.flowId && template.buttons.some((button) => button.kind === 'flow'));
  const toCreate = templates.filter(
    (template) => !waiting(template) && !has(metaTemplateName(template.key, template.version)),
  );
  const documentHandle = toCreate.some((template) => template.header === 'document')
    ? await meta.uploadSample(options.samplePdf())
    : undefined;

  const results: SubmitResult[] = [];
  for (const template of templates) {
    const name = metaTemplateName(template.key, template.version);
    if (waiting(template)) {
      results.push({
        key: template.key,
        version: template.version,
        status: 'held',
        outcome: 'held',
      });
      continue;
    }
    if (toCreate.includes(template)) {
      let created: Awaited<ReturnType<MetaTemplateClient['create']>>;
      try {
        created = await meta.create(
          templateCreateBody(template, {
            origin: options.origin,
            documentHandle,
            flowId: options.flowId,
          }),
        );
      } catch (error) {
        if (!(error instanceof MetaTemplateError)) throw error;
        results.push({
          key: template.key,
          version: template.version,
          status: error.message,
          outcome: 'refused',
        });
        continue;
      }
      onMeta.push({
        id: created.id,
        name,
        language: TEMPLATE_LANGUAGE,
        status: created.status,
        category: created.category,
      });
    }
    results.push({
      key: template.key,
      version: template.version,
      status: has(name)?.status.toLowerCase() ?? 'unknown',
      outcome: toCreate.includes(template) ? 'submitted' : 'on_meta',
    });
  }
  await record(db, { versions: onMeta.flatMap((found) => asVersion(found) ?? []) });
  return results;
}

/** Reads Meta's verdict on every version of ours it holds into `whatsapp_template`. */
export async function syncTemplates(db: Db, meta: MetaTemplateClient): Promise<number> {
  const versions = (await meta.list()).flatMap((found) => asVersion(found) ?? []);
  await record(db, { versions });
  return versions.length;
}

/**
 * A one page PDF reading "Sample document": the example Meta reviews a document header with.
 * Built by hand so no patient or real document is ever uploaded.
 */
export function samplePdf(): Uint8Array<ArrayBuffer> {
  const text = 'BT /F1 18 Tf 72 720 Td (Movementology sample document) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${String(text.length)} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
