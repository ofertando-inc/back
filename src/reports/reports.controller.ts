import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import type { PublicUser } from '../users/types/public-user.type';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportsService } from './reports.service';
import type { ReportResponse } from './types/report-response.type';
import type { UserReportResponse } from './types/user-report-response.type';

@UseGuards(JwtAuthGuard)
@Controller('offers/:offerId/reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  create(
    @Param('offerId') offerId: string,
    @CurrentUser() user: PublicUser,
    @Body() dto: CreateReportDto,
  ): Promise<ReportResponse> {
    return this.reportsService.create(user.id, offerId, dto);
  }

  @Get('me')
  async findMine(
    @Param('offerId') offerId: string,
    @CurrentUser() user: PublicUser,
  ): Promise<UserReportResponse> {
    const report = await this.reportsService.findUserReport(user.id, offerId);
    return { reason: report?.reason ?? null };
  }
}
