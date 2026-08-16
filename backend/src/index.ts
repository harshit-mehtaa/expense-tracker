import { env, isTest } from './config/env';
import { createApp } from './app';
import { startRecurringScheduler } from './services/recurringScheduler';

const app = createApp();

// Guarded so importing this module in a test neither binds a port nor starts timers.
if (!isTest) {
  app.listen(env.PORT, () => {
    console.log(`🚀 Family Finance API running on port ${env.PORT} [${env.NODE_ENV}]`);
  });
  startRecurringScheduler();
}
