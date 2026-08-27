import { createApp } from './app.js';
import { closePool } from './db.js';

const PORT = Number(process.env.PORT ?? 3000);

const httpServer = createApp().listen(PORT, () => {
    console.log(`[tutor] listening on :${PORT}`);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
        console.log(`[tutor] ${signal} received, shutting down`);
        httpServer.close(() => {
            void closePool().then(() => process.exit(0));
        });
    });
}
