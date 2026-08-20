import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { loadConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  // Validated before the application starts, so a missing secret or database
  // URL fails here with a clear message rather than at the first login.
  const config = loadConfig();

  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());

  app.use(
    helmet({
      // Swagger UI needs inline styles; the API itself serves no HTML, so the
      // remaining protections are what matter here.
      contentSecurityPolicy: config.nodeEnv === 'production' ? undefined : false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.enableCors({ origin: config.corsOrigins, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // Unknown properties are rejected rather than quietly dropped, so a
      // client sending the wrong field name finds out immediately.
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Smart Collateral Inspection API')
    .setDescription(
      'Collateral inspection workflow for financial institutions: assignment, ' +
        'offline field capture, supervisory review and official reporting.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  await app.listen(config.port);

  logger.log(`API listening on http://localhost:${config.port}/api/v1`);
  logger.log(`Documentation at http://localhost:${config.port}/api/docs`);
}

bootstrap().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('\nFailed to start the API:\n');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
