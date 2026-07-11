import { Injectable } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter } from 'prom-client';

import {
  COMMENTS_CREATED_TOTAL,
  OFFERS_CREATED_TOTAL,
  REPORTS_CREATED_TOTAL,
} from './metrics.constants';

export type ReportTarget = 'offer' | 'comment';

@Injectable()
export class MetricsService {
  constructor(
    @InjectMetric(OFFERS_CREATED_TOTAL)
    private readonly offersCreated: Counter<string>,
    @InjectMetric(REPORTS_CREATED_TOTAL)
    private readonly reportsCreated: Counter<string>,
    @InjectMetric(COMMENTS_CREATED_TOTAL)
    private readonly commentsCreated: Counter<string>,
  ) {}

  offerCreated(official: boolean): void {
    this.offersCreated.inc({ official: String(official) });
  }

  reportCreated(target: ReportTarget): void {
    this.reportsCreated.inc({ target });
  }

  commentCreated(): void {
    this.commentsCreated.inc();
  }
}
