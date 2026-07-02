import { HttpStatus, Injectable } from '@nestjs/common';

import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorKey } from '../../../common/exceptions/error-keys';
import { PrismaService } from '../../../prisma/prisma.service';
import { locationResponseSelect } from './location-response.select';
import type { LocationResponse } from './types/location-response.type';

export type LocationInput = {
  address: string;
  city: string;
  region?: string;
  latitude?: number;
  longitude?: number;
};

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  // Find-or-create a location under a merchant, deduped on address + city
  // (case-insensitive), to avoid duplicate addresses for the same merchant.
  async findOrCreate(
    merchantId: string,
    input: LocationInput,
  ): Promise<LocationResponse> {
    const existing = await this.prisma.location.findFirst({
      where: {
        merchantId,
        address: { equals: input.address, mode: 'insensitive' },
        city: { equals: input.city, mode: 'insensitive' },
      },
      select: locationResponseSelect,
    });

    if (existing) {
      return existing;
    }

    return this.prisma.location.create({
      data: {
        merchantId,
        address: input.address,
        city: input.city,
        region: input.region ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
      },
      select: locationResponseSelect,
    });
  }

  // Ensures a location exists and belongs to the given merchant.
  async findForMerchant(
    id: string,
    merchantId: string,
  ): Promise<LocationResponse> {
    const location = await this.prisma.location.findUnique({
      where: { id },
      select: locationResponseSelect,
    });

    if (!location || location.merchantId !== merchantId) {
      throw new AppException(ErrorKey.LocationNotFound, HttpStatus.NOT_FOUND);
    }

    return location;
  }
}
