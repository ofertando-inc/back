import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Offer } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AppException } from '../common/exceptions/app.exception';
import { ErrorKey } from '../common/exceptions/error-keys';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import type { PaginatedResult } from '../common/pagination/paginated-result.type';
import type { PublicUser } from '../users/types/public-user.type';
import { CreateOfferDto } from './dto/create-offer.dto';
import { ListOffersQueryDto } from './dto/list-offers-query.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';
import { OfferOwnerGuard } from './guards/offer-owner.guard';
import { OffersService } from './offers.service';

@Controller('offers')
export class OffersController {
  constructor(private readonly offersService: OffersService) {}

  @Get()
  list(@Query() query: ListOffersQueryDto): Promise<PaginatedResult<Offer>> {
    return this.offersService.findAll(query);
  }

  @UseGuards(JwtAuthGuard)
  @Get('mine')
  listMine(
    @CurrentUser() user: PublicUser,
    @Query() query: ListOffersQueryDto,
  ): Promise<PaginatedResult<Offer>> {
    return this.offersService.findAll(query, { ownerId: user.id });
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Offer> {
    const offer = await this.offersService.findById(id);
    if (!offer) {
      throw new AppException(ErrorKey.OfferNotFound, HttpStatus.NOT_FOUND);
    }
    return offer;
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(
    @CurrentUser() user: PublicUser,
    @Body() dto: CreateOfferDto,
  ): Promise<Offer> {
    return this.offersService.create(dto, user.id);
  }

  @UseGuards(JwtAuthGuard, OfferOwnerGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateOfferDto): Promise<Offer> {
    return this.offersService.update(id, dto);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, OfferOwnerGuard)
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    await this.offersService.softDelete(id);
  }
}
