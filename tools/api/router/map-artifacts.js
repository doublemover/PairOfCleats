import { sendJson, sendError } from '../response.js';
import { parseJsonBodyOrSendError, resolveRepoOrSendError } from './request-helpers.js';
export async function handleMapArtifactsRoute({ req, res, requestUrl, corsHeaders, parseJsonBody, resolveRepo, browser }) {
  const parsed = await parseJsonBodyOrSendError(req, res, parseJsonBody, corsHeaders); if (!parsed.ok) return;
  const input = parsed.payload;
  if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['repoRoot', 'name', 'generation', 'cursor'].includes(key))
    || (input.repoRoot != null && typeof input.repoRoot !== 'string')) { sendError(res, 400, 'INVALID_REQUEST', 'Invalid artifact request.', {}, corsHeaders); return; }
  const resolved = await resolveRepoOrSendError(res, resolveRepo, input.repoRoot, corsHeaders); if (!resolved.ok) return;
  const controller = new AbortController(); const abort = () => controller.abort(); req.on('aborted', abort); res.on('close', abort); res.on('error', abort);
  try {
    if (requestUrl.pathname === '/map/artifact' && (typeof input.name !== 'string' || !/^[a-z][a-z0-9_]*$/.test(input.name)
      || typeof input.generation !== 'string' || (input.cursor != null && typeof input.cursor !== 'string'))) throw Object.assign(new Error('Invalid logical artifact name, generation or cursor.'), { status: 400 });
    const result = requestUrl.pathname === '/map/catalog' ? await browser.catalog(resolved.repoPath, controller.signal) : await browser.read(resolved.repoPath, input, controller.signal);
    sendJson(res, 200, { ok: true, result }, corsHeaders);
  } catch (error) { sendError(res, error.status || 400, 'ARTIFACT_UNAVAILABLE', error.message, {}, corsHeaders); }
  finally { req.off('aborted', abort); res.off('close', abort); res.off('error', abort); }
}
