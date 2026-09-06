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

  const app = await NestFactory.create(AppModule, {
    bufferLogs: false,
  });

  // 1. Enable CORS
  // Allow HTTPS origins in production and local HTTP origins used by
  // Flutter Web during development. Native Flutter clients normally do not
  // send an Origin header, so those requests are also allowed.
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      const isHttpsOrigin = origin.startsWith('https://');
      const isLocalDevelopmentOrigin =
        origin.startsWith('http://localhost:') ||
        origin.startsWith('http://127.0.0.1:') ||
        origin.startsWith('http://[::1]:');

      if (isHttpsOrigin || isLocalDevelopmentOrigin) {
        callback(null, true);
        return;
      }

      callback(new Error('CORS origin not allowed'), false);
    },
    methods: [
      'GET',
      'HEAD',
      'PUT',
      'PATCH',
      'POST',
      'DELETE',
      'OPTIONS',
    ],
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Origin',
      'X-Requested-With',
      'X-Client-Request-Id',
      'X-Client-Platform',
    ],
  });

  app.setGlobalPrefix('api/v1');

  app.use(cookieParser());

  // 2. Configure Helmet
  app.use(
    helmet({
      contentSecurityPolicy:
        config.nodeEnv === 'production' ? undefined : false,
      crossOriginResourcePolicy: {
        policy: 'cross-origin',
      },
    }),
  );

  // 3. Global validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: false,
      },
    }),
  );

  // 4. Swagger configuration
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Smart Collateral Inspection API')
    .setDescription('Collateral inspection workflow.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);

  SwaggerModule.setup('api/docs', app, document);

  // 5. Start server
  await app.listen(config.port);

  logger.log(`API listening on port ${config.port}`);
}

bootstrap().catch((error: unknown) => {
  console.error('\nFailed to start the API:\n');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
