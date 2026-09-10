/// <reference types="astro/client" />

/**
 * Build-time configuration this site reads from the environment.
 *
 * Both are PUBLIC_ and therefore inlined into the client bundle — which is
 * correct for both: a PostHog project token is publishable by design, and the
 * enablement switch has to be readable by the code it gates. Neither is a
 * secret, and neither should be stored as one. See .env.example.
 */
interface ImportMetaEnv {
  /** PostHog project API key (`phc_…`). Absent means analytics stays off. */
  readonly PUBLIC_POSTHOG_KEY?: string;
  /** The explicit production switch. Only the exact string 'true' enables it. */
  readonly PUBLIC_ANALYTICS_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
