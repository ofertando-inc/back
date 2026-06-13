export const geocodingConfig = () => ({
  geocoding: {
    baseUrl:
      process.env.GEOCODING_BASE_URL ?? 'https://nominatim.openstreetmap.org',
    // OSM usage policy requires an identifying User-Agent with a contact.
    userAgent:
      process.env.GEOCODING_USER_AGENT ??
      'Ofertando/1.0 (+https://ofertando.co)',
    limit: Number(process.env.GEOCODING_LIMIT ?? 5),
    timeoutMs: Number(process.env.GEOCODING_TIMEOUT_MS ?? 5000),
    // Minimum delay between outbound requests (OSM allows at most 1 req/s).
    throttleMs: Number(process.env.GEOCODING_THROTTLE_MS ?? 1000),
    // How long identical queries are cached to avoid hammering the service.
    cacheTtlMs: Number(process.env.GEOCODING_CACHE_TTL_MS ?? 300_000),
  },
});
