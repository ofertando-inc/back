import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { GeocodeQueryDto } from './dto/geocode-query.dto';
import { ReverseGeocodeQueryDto } from './dto/reverse-geocode-query.dto';
import { GeocodingService } from './geocoding.service';
import type { GeocodeSuggestion } from './types/geocode-suggestion.type';

@Controller('geocode')
export class GeocodingController {
  constructor(private readonly geocodingService: GeocodingService) {}

  // Authenticated to keep the external Nominatim lookups from being abused.
  @Get()
  @UseGuards(JwtAuthGuard)
  search(@Query() query: GeocodeQueryDto): Promise<GeocodeSuggestion[]> {
    return this.geocodingService.search(query.q);
  }

  // Coordinates -> a single address suggestion (e.g. after dragging the pin).
  @Get('reverse')
  @UseGuards(JwtAuthGuard)
  reverse(
    @Query() query: ReverseGeocodeQueryDto,
  ): Promise<GeocodeSuggestion | null> {
    return this.geocodingService.reverse(query.lat, query.lng);
  }
}
