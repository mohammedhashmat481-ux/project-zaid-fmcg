import { connectPostgres, disconnectPostgres } from './postgres';
import { PgObjectId } from '../models/PgModel';

export const connectDB = async (): Promise<void> => {
  await connectPostgres();
};

export const disconnectDB = async (): Promise<void> => {
  await disconnectPostgres();
};

export const mongoose = {
  Types: {
    ObjectId: PgObjectId
  }
};
