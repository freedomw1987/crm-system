/**
 * Hand-rolled multipart/form-data parser.
 *
 * Day 30: extracted from apps/api/src/routes/activity.ts so the
 * AI Quotation import feature (which also needs a multipart file
 * upload) can share the implementation. Keeping the dep list short
 * — we don't depend on busboy because the format is well-defined and
 * our needs are small.
 *
 * Usage:
 *   const contentType = request.headers.get('content-type') ?? '';
 *   const boundary = contentType.match(/boundary="?([^";]+)"?/)?.[1];
 *   if (!boundary) throw new Error('No boundary');
 *   const { files, fields } = await parseMultipart(request, boundary);
 *   const xlsx = files[0].buffer;  // bytes of the uploaded xlsx
 *
 * Returns: { files: Array<{fieldName, fileName, mimeType, buffer}>, fields: Record<string,string> }
 */

export interface ParsedFile {
  fieldName: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}

export interface ParsedMultipart {
  files: ParsedFile[];
  fields: Record<string, string>;
}

export class MultipartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MultipartError';
  }
}

export async function parseMultipart(
  request: Request,
  boundary: string,
  maxFileBytes = 50 * 1024 * 1024,
): Promise<ParsedMultipart> {
  const reader = request.body?.getReader();
  if (!reader) throw new MultipartError('No body');
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxFileBytes * 2) {
      throw new MultipartError('Upload too large');
    }
    chunks.push(value);
  }
  const raw = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  const delim = Buffer.from(`--${boundary}`);
  const files: ParsedFile[] = [];
  const fields: Record<string, string> = {};
  let pos = 0;
  while (pos < raw.length) {
    const partStart = raw.indexOf(delim, pos);
    if (partStart === -1) break;
    pos = partStart + delim.length;
    if (raw[pos] === 0x2d && raw[pos + 1] === 0x2d) break;
    if (raw[pos] === 0x0d && raw[pos + 1] === 0x0a) pos += 2;
    const headerEnd = raw.indexOf(Buffer.from('\r\n\r\n'), pos);
    if (headerEnd === -1) break;
    const headerText = raw.subarray(pos, headerEnd).toString('utf-8');
    pos = headerEnd + 4;
    const nextBoundary = raw.indexOf(delim, pos);
    if (nextBoundary === -1) break;
    let partEnd = nextBoundary;
    if (raw[partEnd - 2] === 0x0d && raw[partEnd - 1] === 0x0a) partEnd -= 2;
    const partBody = raw.subarray(pos, partEnd);
    const disposition = headerText.match(
      /Content-Disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i,
    );
    const ctype = headerText.match(/Content-Type:\s*([^\r\n]+)/i);
    if (!disposition) {
      pos = nextBoundary;
      continue;
    }
    const fieldName = disposition[1]!;
    const fileName = disposition[2] ?? '';
    const mimeType = ctype ? ctype[1]!.trim() : 'application/octet-stream';
    if (fileName) {
      if (partBody.byteLength > maxFileBytes) {
        throw new MultipartError(
          `File "${fileName}" exceeds ${maxFileBytes / 1024 / 1024} MB limit`,
        );
      }
      files.push({
        fieldName,
        fileName,
        mimeType,
        buffer: Buffer.from(partBody),
      });
    } else {
      fields[fieldName] = partBody.toString('utf-8');
    }
    pos = nextBoundary;
  }
  return { files, fields };
}

/** Extract boundary from a Content-Type header. Returns null if absent. */
export function extractBoundary(contentType: string | null | undefined): string | null {
  if (!contentType) return null;
  const m = contentType.match(/boundary="?([^";]+)"?/i);
  return m?.[1] ?? null;
}
