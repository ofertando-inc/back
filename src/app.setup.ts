import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';

import { AppExceptionFilter } from './common/filters/app-exception.filter';
import { validationExceptionFactory } from './common/validation/validation-exception.factory';

export function configureApp(app: INestApplication) {
  app.use(helmet());

  const corsOrigins = getCorsOrigins();

  if (corsOrigins.length > 0) {
    app.enableCors({
      origin: corsOrigins,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    });
  }

  app.useGlobalFilters(new AppExceptionFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );

  app.enableShutdownHooks();
}

function getCorsOrigins(): string[] {
  return (
    process.env.CORS_ORIGINS?.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean) ?? []
  );
}
