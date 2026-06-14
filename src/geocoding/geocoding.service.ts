import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppException } from '../common/exceptions/app.exception';
import { ErrorKey } from '../common/exceptions/error-keys';
import type { GeocodeSuggestion } from './types/geocode-suggestion.type';

type NominatimResult = {
  lat: string;
  lon: string;
  display_name: string;
  address?: Record<string, string>;
};

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  private readonly cache = new Map<
    string,
    { value: GeocodeSuggestion[]; expiresAt: number }
  >();

  // Serializes outbound calls so the OSM min-interval is enforced globally.
  private chain: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(private readonly config: ConfigService) {}

  async search(query: string): Promise<GeocodeSuggestion[]> {
    const key = query.trim().toLowerCase();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const results = await this.throttled(() => this.searchNominatim(query));
    this.cache.set(key, {
      value: results,
      expiresAt: Date.now() + this.num('geocoding.cacheTtlMs'),
    });
    return results;
  }

  // Reverse geocoding: coordinates -> a single address suggestion, to refresh
  // the textual address when the map pin is moved.
  async reverse(
    latitude: number,
    longitude: number,
  ): Promise<GeocodeSuggestion | null> {
    const key = `rev:${latitude.toFixed(5)},${longitude.toFixed(5)}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value[0] ?? null;
    }

    const result = await this.throttled(() =>
      this.reverseNominatim(latitude, longitude),
    );
    this.cache.set(key, {
      value: result ? [result] : [],
      expiresAt: Date.now() + this.num('geocoding.cacheTtlMs'),
    });
    return result;
  }

  private async searchNominatim(query: string): Promise<GeocodeSuggestion[]> {
    const url = new URL('/search', this.str('geocoding.baseUrl'));
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', String(this.num('geocoding.limit')));

    // Restrict results to the configured country (default Colombia).
    const countryCodes = this.str('geocoding.countryCodes');
    if (countryCodes) {
      url.searchParams.set('countrycodes', countryCodes);
    }

    const data = (await this.fetchJson(url)) as NominatimResult[];
    return data.map((result) => this.toSuggestion(result));
  }

  private async reverseNominatim(
    latitude: number,
    longitude: number,
  ): Promise<GeocodeSuggestion | null> {
    const url = new URL('/reverse', this.str('geocoding.baseUrl'));
    url.searchParams.set('lat', String(latitude));
    url.searchParams.set('lon', String(longitude));
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');

    const data = (await this.fetchJson(url)) as NominatimResult & {
      error?: unknown;
    };
    if (data.error !== undefined || !data.lat) {
      return null;
    }
    return this.toSuggestion(data);
  }

  private async fetchJson(url: URL): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.num('geocoding.timeoutMs'),
    );

    try {
      const response = await fetch(url, {
        headers: {
          // Mandatory under the OSM usage policy.
          'User-Agent': this.str('geocoding.userAgent'),
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Nominatim responded ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      this.logger.warn(`Geocoding failed: ${(error as Error).message}`);
      throw new AppException(
        ErrorKey.GeocodingUnavailable,
        HttpStatus.BAD_GATEWAY,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private toSuggestion(result: NominatimResult): GeocodeSuggestion {
    const address = result.address ?? {};
    const street = [address.road, address.house_number]
      .filter(Boolean)
      .join(' ');

    return {
      displayName: result.display_name,
      latitude: Number(result.lat),
      longitude: Number(result.lon),
      city:
        address.city ??
        address.town ??
        address.village ??
        address.municipality ??
        null,
      region: address.state ?? address.region ?? address.county ?? null,
      address: street || null,
    };
  }

  private throttled<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      const wait =
        this.num('geocoding.throttleMs') - (Date.now() - this.lastRequestAt);
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      this.lastRequestAt = Date.now();
      return task();
    });
    // Keep the chain alive regardless of individual task failures.
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private str(key: string): string {
    return this.config.get<string>(key) ?? '';
  }

  private num(key: string): number {
    return this.config.get<number>(key) ?? 0;
  }
}
