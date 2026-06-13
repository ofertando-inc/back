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

    const results = await this.throttled(() => this.fetchFromNominatim(query));
    this.cache.set(key, {
      value: results,
      expiresAt: Date.now() + this.num('geocoding.cacheTtlMs'),
    });
    return results;
  }

  private async fetchFromNominatim(
    query: string,
  ): Promise<GeocodeSuggestion[]> {
    const url = new URL('/search', this.str('geocoding.baseUrl'));
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', String(this.num('geocoding.limit')));

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

      const data = (await response.json()) as NominatimResult[];
      return data.map((result) => this.toSuggestion(result));
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
