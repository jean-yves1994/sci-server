import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { loadConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const config = loadConfig();

  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  // 1. Enable CORS with dynamic origin reflection
  // This allows any origin (Web, Mobile, Localhost) while supporting cookies/credentials
  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: 'Content-Type, Authorization, Accept, X-Requested-With',
  });

  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());

  // 2. Configure Helmet
  app.use(
    helmet({
      // Disable CSP in development for easier debugging; enable in production
      contentSecurityPolicy: config.nodeEnv === 'production' ? undefined : false,
      // CRITICAL: Set to 'cross-origin' so external sites can load your resources
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Smart Collateral Inspection API')
    .setDescription('Collateral inspection workflow.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  await app.listen(config.port);
  logger.log(`API listening on port ${config.port}`);
}

bootstrap().catch((error: unknown) => {
  console.error('\nFailed to start the API:\n');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
