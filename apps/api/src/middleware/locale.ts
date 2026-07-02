/**
 * Locale context — derive the request's locale for error messages.
 *
 * Mount AFTER `authContext` (so `userId` is available) but BEFORE
 * any route that wants `ctx.locale`. The derive is async because
 * we hit the DB on authenticated requests to read the persisted
 * `users.locale` preference — the DB hit is one PK lookup on the
 * `User` row (~1ms) and avoids baking locale into the JWT (which
 * would require re-issuing tokens on every preference change).
 *
 * Resolution order (first match wins):
 *   1. Authenticated user → read `user.locale` from DB.
 *   2. Else parse `Accept-Language` header.
 *   3. Else `DEFAULT_LOCALE` ('en').
 *
 * The result is guaranteed to be a `SupportedLocale` (never
 * `undefined`) so route handlers can pass `ctx.locale` straight
 * into `tApi()` without a runtime check.
 */
import { Elysia } from 'elysia';
import { prisma } from '@crm/db';
import { DEFAULT_LOCALE, type SupportedLocale } from '@crm/shared/i18n';
import { isSupportedLocale } from '../lib/i18n';
import { parseAcceptLanguage } from '../lib/i18n';

export const localeContext = new Elysia({ name: 'locale-context' })
  .derive({ as: 'scoped' }, async ({ request, userId }) => {
    let locale: SupportedLocale = DEFAULT_LOCALE;

    // 1. Authenticated: read persisted preference
    if (userId) {
      try {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { locale: true },
        });
        if (user && isSupportedLocale(user.locale)) {
          locale = user.locale;
        }
      } catch {
        // DB error — fall through to Accept-Language. Don't fail
        // the request because we couldn't read the preference.
      }
    }

    // 2. Fallback: parse Accept-Language (also runs if step 1
    //    produced an unsupported locale — gives the best guess).
    if (locale === DEFAULT_LOCALE) {
      const fromHeader = parseAcceptLanguage(request.headers.get('accept-language'));
      if (fromHeader !== DEFAULT_LOCALE) locale = fromHeader;
    }

    return { locale };
  });