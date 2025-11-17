import path from 'path';

import cloudinary from 'cloudinary';
import dotenv from 'dotenv';

dotenv.config({
  path: path.resolve(
    process.cwd(),
    `.env.${process.env.NODE_ENV || 'development'}`
  ),
});

class Config {
  // Application
  public NODE_ENV: string = process.env.NODE_ENV || 'development';
  public PORT: number = parseInt(process.env.PORT || '4003', 10);

  public API_GATEWAY_URL: string = process.env.API_GATEWAY_URL || 'http://localhost:4000';
  public CLIENT_URL: string = process.env.CLIENT_URL || 'http://localhost:3000';
  // Database
  public DATABASE_URL: string =
    process.env.DATABASE_URL || 'mongodb://127.0.0.1:27017/joblance-users';

  // Messaging / RabbitMQ / Redis
  public RABBITMQ_URL: string =
    process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';

  public REDIS_URL: string =
    process.env.REDIS_URL || 'redis://localhost:6379';

  // Gateway secret for internal JWT
  public GATEWAY_SECRET_KEY: string = process.env.GATEWAY_SECRET_KEY || '';

  // APM
  public ENABLE_APM: boolean = process.env.ENABLE_APM === '1';
  public ELASTIC_APM_SERVER_URL: string = process.env.ELASTIC_APM_SERVER_URL || '';
  public ELASTIC_APM_SECRET_TOKEN: string = process.env.ELASTIC_APM_SECRET_TOKEN || '';

  public CLOUDINARY_CLOUD_NAME: string = process.env.CLOUDINARY_CLOUD_NAME || '';
  public CLOUDINARY_API_KEY: string = process.env.CLOUDINARY_API_KEY || '';
  public CLOUDINARY_API_SECRET: string = process.env.CLOUDINARY_API_SECRET || '';

  public STRIPE_SECRET_KEY: string = process.env.STRIPE_SECRET_KEY || '';
  public STRIPE_WEBHOOK_SECRET: string = process.env.STRIPE_WEBHOOK_SECRET || '';


  public cloudinaryConfig(): void {
    cloudinary.v2.config({
      cloud_name: this.CLOUDINARY_CLOUD_NAME,
      api_key: this.CLOUDINARY_API_KEY,
      api_secret: this.CLOUDINARY_API_SECRET,
      secure: true
    });
  }
}

export const config = new Config();

