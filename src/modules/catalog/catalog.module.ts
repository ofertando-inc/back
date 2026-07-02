import { Module } from '@nestjs/common';

import { CategoriesModule } from './categories/categories.module';
import { GeocodingModule } from './geocoding/geocoding.module';
import { MerchantsModule } from './merchants/merchants.module';
import { OffersModule } from './offers/offers.module';

// Catalog domain: what is on offer and where (offers, merchants/locations,
// categories, geocoding).
@Module({
  imports: [OffersModule, MerchantsModule, CategoriesModule, GeocodingModule],
  exports: [OffersModule, MerchantsModule, CategoriesModule, GeocodingModule],
})
export class CatalogModule {}
