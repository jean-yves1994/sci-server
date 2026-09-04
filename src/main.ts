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
  // Allows Web, Flutter Web, mobile clients, and localhost development.
  // `origin: true` dynamically reflects the requesting origin.
  app.enableCors({
    origin: true,
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
    ],
  });

  app.setGlobalPrefix('api/v1');

  app.use(cookieParser());

  // 2. Configure Helmet
  app.use(
    helmet({
      // Disable CSP in development for easier debugging;
      // enable the default Helmet CSP configuration in production.
      contentSecurityPolicy:
        config.nodeEnv === 'production' ? undefined : false,

      // Allow resources to be loaded across origins.
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
