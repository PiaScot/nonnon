/**
 * Repository for interacting with Cloudflare R2 Storage.
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { appConfig } from '../utils/config.js';
import { logError } from '../utils/logger.js';

export class R2Repository {
  private readonly s3Client: S3Client;
  private readonly bucketName: string = 'articles-html';

  constructor() {
    const { r2AccountId, r2AccessKeyId, r2SecretAccessKey } = appConfig;

    if (!r2AccountId || !r2AccessKeyId || !r2SecretAccessKey) {
      throw new Error(
        'R2 credentials are not configured. Please set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.'
      );
    }

    this.s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: r2AccessKeyId,
        secretAccessKey: r2SecretAccessKey,
      },
    });
  }

  /**
   * Uploads an object to the R2 bucket.
   * @param key The object key (e.g., '123.html').
   * @param body The content of the object.
   * @param contentType The MIME type of the object (e.g., 'text/html; charset=utf-8').
   * @returns True if the upload was successful, false otherwise.
   */
  async upload(key: string, body: string, contentType: string): Promise<boolean> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: body,
        ContentType: contentType,
      });
      await this.s3Client.send(command);
      return true;
    } catch (error) {
      logError(`Failed to upload ${key} to R2 bucket ${this.bucketName}`, error);
      return false;
    }
  }
}
