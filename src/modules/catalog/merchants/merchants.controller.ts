import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CreateMerchantDto } from './dto/create-merchant.dto';
import { ListMerchantsQueryDto } from './dto/list-merchants-query.dto';
import { MerchantsService } from './merchants.service';
import type { MerchantResponse } from './types/merchant-response.type';

@Controller('merchants')
export class MerchantsController {
  constructor(private readonly merchantsService: MerchantsService) {}

  // Public: autocomplete of existing merchants for the offer-creation flow.
  @Get()
  search(@Query() query: ListMerchantsQueryDto): Promise<MerchantResponse[]> {
    return this.merchantsService.search(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<MerchantResponse> {
    return this.merchantsService.findById(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() dto: CreateMerchantDto): Promise<MerchantResponse> {
    return this.merchantsService.findOrCreate(dto.name);
  }
}
