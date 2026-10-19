import { connectPostgres, disconnectPostgres } from './postgres';

export const connectDB = async (): Promise<void> => {
  await connectPostgres();
};

export const disconnectDB = async (): Promise<void> => {
  await disconnectPostgres();
};

