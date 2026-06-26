/**
 * Shared attachment download util. Lives in lib/ (not inside any single
 * component) because three places render attachment chips and all need
 * the same download behavior:
 *   - AttachmentList (full list with explicit "下載" button)
 *   - ActivityFeed (inline chips inside each activity)
 *   - DealsActivityPanel (inline chips in the pipeline summary)
 *
 * Why fetch + blob + anchor (not a plain <a href>):
 * The download endpoint requires a JWT Bearer token. A plain <a href>
 * would hit the backend with no Authorization header, get 401, and
 * (worst case) leak the file body in the error response. The proper
 * path is fetch + Authorization header + blob + object URL, which lets
 * the browser save the file under its real Content-Disposition name.
 *
 * Caller is responsible for any per-row "busy" / "error" UI; this util
 * only does the I/O and either resolves (download triggered) or rejects
 * with a descriptive Error.
 */
import { getToken, type Attachment } from './api';
import { apiUrl } from './runtime-paths';

export async function downloadAttachment(att: Attachment): Promise<void> {
  const token = getToken();
  const res = await fetch(apiUrl(`/attachments/${att.id}/download`), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) {
    throw new Error(`Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // Trust the backend's Content-Disposition filename, but fall back
  // to the metadata fileName if the header is missing.
  const dispo = res.headers.get('content-disposition') ?? '';
  const m = dispo.match(/filename="?([^";]+)"?/i);
  a.download = m?.[1] ?? att.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer revoke so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
