import { ConfigService } from '@nestjs/config';

import { ErrorKey } from '../common/exceptions/error-keys';
import { GeocodingService } from './geocoding.service';

const config = {
  'geocoding.baseUrl': 'https://nominatim.test',
  'geocoding.userAgent': 'Ofertando-Test/1.0',
  'geocoding.countryCodes': 'co',
  'geocoding.limit': 5,
  'geocoding.timeoutMs': 5000,
  'geocoding.throttleMs': 0, // no real delay in tests
  'geocoding.cacheTtlMs': 60000,
} as Record<string, unknown>;

function buildService(): GeocodingService {
  const configService = {
    get: <T>(key: string): T => config[key] as T,
  } as ConfigService;
  return new GeocodingService(configService);
}

function mockFetch(impl: jest.Mock): void {
  global.fetch = impl as unknown as typeof fetch;
}

describe('GeocodingService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('maps Nominatim results and sends the required User-Agent', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            lat: '4.598056',
            lon: '-74.075833',
            display_name: 'Carrera 7, Bogotá, Colombia',
            address: { road: 'Carrera 7', city: 'Bogotá', state: 'Bogotá' },
          },
        ]),
    });
    mockFetch(fetchMock);

    const result = await buildService().search('Carrera 7 Bogota');

    expect(result).toEqual([
      {
        displayName: 'Carrera 7, Bogotá, Colombia',
        latitude: 4.598056,
        longitude: -74.075833,
        city: 'Bogotá',
        region: 'Bogotá',
        address: 'Carrera 7',
      },
    ]);

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toContain('https://nominatim.test/search?q=');
    expect(url.searchParams.get('format')).toBe('jsonv2');
    expect(url.searchParams.get('countrycodes')).toBe('co');
    expect((init.headers as Record<string, string>)['User-Agent']).toBe(
      'Ofertando-Test/1.0',
    );
  });

  it('serves a second identical query from cache without re-fetching', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });
    mockFetch(fetchMock);

    const service = buildService();
    await service.search('same query');
    await service.search('  SAME Query  ');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws geocoding.unavailable when Nominatim responds with an error status', async () => {
    mockFetch(jest.fn().mockResolvedValue({ ok: false, status: 503 }));

    await expect(buildService().search('boom')).rejects.toMatchObject({
      key: ErrorKey.GeocodingUnavailable,
    });
  });

  it('throws geocoding.unavailable when the request fails outright', async () => {
    mockFetch(jest.fn().mockRejectedValue(new Error('network down')));

    await expect(buildService().search('boom')).rejects.toMatchObject({
      key: ErrorKey.GeocodingUnavailable,
    });
  });

  describe('reverse', () => {
    it('maps a single Nominatim reverse result for the given coordinates', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            lat: '4.61',
            lon: '-74.08',
            display_name: 'Carrera 7, Bogotá, Colombia',
            address: { road: 'Carrera 7', city: 'Bogotá', state: 'Bogotá' },
          }),
      });
      mockFetch(fetchMock);

      const result = await buildService().reverse(4.61, -74.08);

      expect(result).toEqual({
        displayName: 'Carrera 7, Bogotá, Colombia',
        latitude: 4.61,
        longitude: -74.08,
        city: 'Bogotá',
        region: 'Bogotá',
        address: 'Carrera 7',
      });

      const [url] = fetchMock.mock.calls[0] as [URL];
      expect(url.toString()).toContain('https://nominatim.test/reverse?');
      expect(url.searchParams.get('lat')).toBe('4.61');
      expect(url.searchParams.get('lon')).toBe('-74.08');
    });

    it('returns null when Nominatim has no match', async () => {
      mockFetch(
        jest.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ error: 'Unable to geocode' }),
        }),
      );

      await expect(buildService().reverse(0, 0)).resolves.toBeNull();
    });

    it('throws geocoding.unavailable on an upstream error', async () => {
      mockFetch(jest.fn().mockResolvedValue({ ok: false, status: 503 }));

      await expect(buildService().reverse(4.61, -74.08)).rejects.toMatchObject({
        key: ErrorKey.GeocodingUnavailable,
      });
    });
  });
});
