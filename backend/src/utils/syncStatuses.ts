import dotenv from 'dotenv';
import path from 'path';

dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'backend/.env') });

async function main() {
  // Disabled: Status configurations are customized and managed by the user in Settings > Status.
  // This script must never overwrite or delete user custom statuses.
  console.log('[syncStatuses] Preserving user custom status configuration. Skipping automatic reset.');
}

main().catch(console.error);
