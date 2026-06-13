import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import type { PublicUser } from '../users/types/public-user.type';
import { CreateStoreDto } from './dto/create-store.dto';
import { GeocodeQueryDto } from './dto/geocode-query.dto';
import { ListStoresQueryDto } from './dto/list-stores-query.dto';
import { GeocodingService } from './geocoding.service';
import { StoresService } from './stores.service';
import type { GeocodeSuggestion } from './types/geocode-suggestion.type';
import type { StoreResponse } from './types/store-response.type';

@Controller('stores')
export class StoresController {
  constructor(
    private readonly storesService: StoresService,
    private readonly geocodingService: GeocodingService,
  ) {}

  // Public: autocomplete of existing stores for the offer-creation flow.
  @Get()
  search(@Query() query: ListStoresQueryDto): Promise<StoreResponse[]> {
    return this.storesService.search(query);
  }

  // Declared before ':id' so the static segment wins the route match.
  // Authenticated to keep the external Nominatim lookups from being abused.
  @Get('geocode')
  @UseGuards(JwtAuthGuard)
  geocode(@Query() query: GeocodeQueryDto): Promise<GeocodeSuggestion[]> {
    return this.geocodingService.search(query.q);
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<StoreResponse> {
    return this.storesService.findById(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(
    @CurrentUser() user: PublicUser,
    @Body() dto: CreateStoreDto,
  ): Promise<StoreResponse> {
    return this.storesService.create(user.id, dto);
  }
}
