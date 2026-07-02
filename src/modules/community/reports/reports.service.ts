import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OfferStatus, Report, ReportStatus } from '@prisma/client';

import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorKey } from '../../../common/exceptions/error-keys';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportResponse } from './types/report-response.type';

const DEFAULT_THRESHOLD = 10;

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async create(
    userId: string,
    offerId: string,
    dto: CreateReportDto,
  ): Promise<ReportResponse> {
    return this.prisma.$transaction(async (tx) => {
      const offer = await tx.offer.findUnique({ where: { id: offerId } });

      if (!offer || offer.status === OfferStatus.DELETED) {
        throw new AppException(ErrorKey.OfferNotFound, HttpStatus.NOT_FOUND);
      }

      const dateExpired = offer.endDate.getTime() < Date.now();
      const reportable =
        offer.status === OfferStatus.REPORTED ||
        (offer.status === OfferStatus.ACTIVE && !dateExpired);

      if (!reportable) {
        throw new AppException(
          ErrorKey.ReportOfferNotReportable,
          HttpStatus.BAD_REQUEST,
        );
      }

      const existing = await tx.report.findUnique({
        where: { userId_offerId: { userId, offerId } },
      });

      // A still-open report from this user is a no-op (one report per cycle).
      if (existing && existing.status === ReportStatus.PENDING) {
        return { status: offer.status };
      }

      if (existing) {
        // The user's previous report was resolved/dismissed: re-open it so the
        // count can climb again and the offer can re-trigger REPORTED.
        await tx.report.update({
          where: { id: existing.id },
          data: {
            status: ReportStatus.PENDING,
            resolvedAt: null,
            reason: dto.reason,
            comment: dto.comment ?? null,
          },
        });
      } else {
        await tx.report.create({
          data: {
            userId,
            offerId,
            reason: dto.reason,
            comment: dto.comment ?? null,
          },
        });
      }

      const incremented = await tx.offer.update({
        where: { id: offerId },
        data: { reportCount: { increment: 1 } },
      });

      const threshold = this.threshold();
      const shouldTransition =
        incremented.reportCount >= threshold &&
        incremented.status === OfferStatus.ACTIVE;

      if (shouldTransition) {
        const transitioned = await tx.offer.update({
          where: { id: offerId },
          data: { status: OfferStatus.REPORTED },
        });
        return { status: transitioned.status };
      }

      return { status: incremented.status };
    });
  }

  findUserReport(userId: string, offerId: string): Promise<Report | null> {
    return this.prisma.report.findUnique({
      where: { userId_offerId: { userId, offerId } },
    });
  }

  private threshold(): number {
    const value = this.configService.get<number>('reports.threshold');
    return typeof value === 'number' && value > 0 ? value : DEFAULT_THRESHOLD;
  }
}
