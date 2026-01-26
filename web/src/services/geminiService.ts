export const analyzeDomain = async (domain: string): Promise<string> => {
  try {
    const { getAuthHeaders } = await import('./apiClient');

    const res = await fetch('/api/ai/analyze-domain', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({ domain })
    });

    const data = await res.json().catch(() => ({} as any));
    if (!res.ok) {
      return data?.message || 'Error contacting AI service.';
    }

    if (data?.error === 'AI_NOT_CONFIGURED') {
      return data?.message || 'AI is not configured on the server.';
    }

    return data?.text || 'No analysis available.';
  } catch (error) {
    console.error('AI Analysis Error:', error);
    return 'AI backend not reachable.';
  }
};