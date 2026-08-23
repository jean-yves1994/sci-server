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

  // 1. Enable CORS BEFORE other middleware and routes
  app.enableCors({
    // Allow your specific frontend and localhost for development
    origin: [
      'https://sci-rwanda.vercel.app',
      'http://localhost:3000', // Adjust if your local port differs
    ],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());

  app.use(
    helmet({
      contentSecurityPolicy: config.nodeEnv === 'production' ? undefined : false,
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
