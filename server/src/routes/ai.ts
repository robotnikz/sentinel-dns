import type { FastifyInstance } from 'fastify';
import type { FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Db } from '../db.js';
import { requireAdmin } from '../auth.js';
import { getSecret } from '../secretsStore.js';
import 'fastify-rate-limit';

type AiProvider = 'gemini' | 'openai';

async function getActiveProvider(db: Db): Promise<AiProvider | null> {
  try {
    const res = await db.pool.query("SELECT value FROM settings WHERE key = 'ai_active_provider' LIMIT 1");
    const raw = res.rows?.[0]?.value;
    const provider =
      typeof raw === 'string'
        ? raw
        : raw && typeof raw === 'object' && typeof (raw as any).provider === 'string'
          ? String((raw as any).provider)
          : '';
    return provider === 'gemini' || provider === 'openai' ? provider : null;
  } catch {
    return null;
  }
}

async function setActiveProvider(db: Db, provider: AiProvider): Promise<void> {
  await db.pool.query(
    'INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()',
    ['ai_active_provider', { provider }]
  );
}

export async function registerAiRoutes(app: FastifyInstance, config: AppConfig, db: Db): Promise<void> {
  app.get(
    '/api/ai/status',
    {
      config: {
        rateLimit: { max: 120, timeWindow: '1 minute' }
      }
    },
    async (request) => {
      await requireAdmin(db, request);
      const [geminiSecret, openaiSecret] = await Promise.all([
        getSecret(db, config, 'gemini_api_key'),
        getSecret(db, config, 'openai_api_key')
      ]);

      const configuredGemini = Boolean(config.GEMINI_API_KEY || geminiSecret);
      const configuredOpenai = Boolean(openaiSecret);

      const storedActive = await getActiveProvider(db);
      const activeProvider: AiProvider | null = storedActive
        ? storedActive
        : configuredGemini && !configuredOpenai
          ? 'gemini'
          : configuredOpenai && !configuredGemini
            ? 'openai'
            : null;

      return {
        providers: {
          gemini: configuredGemini,
          openai: configuredOpenai
        },
        activeProvider
      };
    }
  );

  app.post(
    '/api/ai/active-provider',
    {
      config: {
        rateLimit: { max: 60, timeWindow: '1 minute' }
      },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['provider'],
          properties: {
            provider: { type: 'string', enum: ['gemini', 'openai'] }
          }
        }
      }
    },
    async (request: FastifyRequest<{ Body: { provider: AiProvider } }>) => {
      await requireAdmin(db, request);

      const provider = request.body.provider;

      const geminiKey = config.GEMINI_API_KEY || (await getSecret(db, config, 'gemini_api_key'));
      const openaiKey = await getSecret(db, config, 'openai_api_key');

      if (provider === 'gemini' && !geminiKey) {
        return {
          error: 'AI_NOT_CONFIGURED',
          message: 'Gemini API key not configured on the server'
        };
      }
      if (provider === 'openai' && !openaiKey) {
        return {
          error: 'AI_NOT_CONFIGURED',
          message: 'OpenAI API key not configured on the server'
        };
      }

      await setActiveProvider(db, provider);
      return { ok: true, activeProvider: provider };
    }
  );

  app.post(
    '/api/ai/analyze-domain',
    {
      config: {
        rateLimit: { max: 20, timeWindow: '1 minute' }
      },
      schema: {
        body: {
          type: 'object',
          required: ['domain'],
          properties: {
            domain: { type: 'string', minLength: 1, maxLength: 253 },
            provider: { type: 'string', enum: ['gemini', 'openai'] }
          }
        }
      }
    },
    async (request: FastifyRequest<{ Body: { domain: string; provider?: 'gemini' | 'openai' } }>) => {
      await requireAdmin(db, request);

      const { domain } = request.body;

      const geminiKey = config.GEMINI_API_KEY || (await getSecret(db, config, 'gemini_api_key'));
      const openaiKey = await getSecret(db, config, 'openai_api_key');

      const storedActive = await getActiveProvider(db);
      const provider: AiProvider =
        (request.body.provider as AiProvider | undefined) ??
        storedActive ??
        (!geminiKey && openaiKey ? 'openai' : 'gemini');

      if (provider === 'openai') {
        if (!openaiKey) {
          return {
            error: 'AI_NOT_CONFIGURED',
            message: 'OpenAI API key not configured on the server'
          };
        }

        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${openaiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'user',
                content: `Analyze the domain "${domain}" for a network firewall/DNS blocker.\n\nProvide a structured, technical response with these exact headers:\n\n[CATEGORY]\n(Choose one: Telemetry, OS Service, Ad Tracking, Malware, CDN, Social Media, Unknown)\n\n[PURPOSE]\n(1 sentence technical explanation of what this domain hosts)\n\n[BLOCKING IMPACT]\n(Crucial: What breaks if blocked?)\n\nKeep it concise (max 60 words total).`
              }
            ],
            temperature: 0.2
          })
        });

        if (!r.ok) {
          return {
            error: 'AI_FAILED',
            message: `OpenAI returned ${r.status}`
          };
        }

        const data: any = await r.json().catch(() => ({}));
        const text = String(data?.choices?.[0]?.message?.content ?? '');
        return { text };
      }

      if (!geminiKey) {
        return {
          error: 'AI_NOT_CONFIGURED',
          message: 'Gemini API key not configured on the server'
        };
      }

      // Lazy import to keep cold start light.
      const { GoogleGenAI } = await import('@google/genai');

      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Analyze the domain "${domain}" for a network firewall/DNS blocker.

Provide a structured, technical response with these exact headers:

[CATEGORY]
(Choose one: Telemetry, OS Service, Ad Tracking, Malware, CDN, Social Media, Unknown)

[PURPOSE]
(1 sentence technical explanation of what this domain hosts)

[BLOCKING IMPACT]
(Crucial: What breaks if blocked?)

Keep it concise (max 60 words total).`,
        config: {
          thinkingConfig: { thinkingBudget: 0 }
        }
      });

      return { text: response.text || '' };
    }
  );
}
