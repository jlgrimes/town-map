import { createApp } from "./app.js";

const app = await createApp();

// Railway sends SIGTERM on deploy. Without this the process dies immediately and
// in-flight requests are dropped; `close()` drains them and runs the onClose hook.
// Registered before listening so a signal during a slow start is still handled.
const shutdownTimeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 15_000);
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, "Draining connections before shutdown");
    const forceExit = setTimeout(() => {
      app.log.error({ signal }, "Shutdown timed out with requests still in flight");
      process.exit(1);
    }, shutdownTimeoutMs);
    forceExit.unref();
    try {
      await app.close();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, "Shutdown failed");
      process.exit(1);
    }
  });
}

const port = Number(process.env.PORT ?? 3001);
await app.listen({ host: "0.0.0.0", port });
