import { connect, migrate } from "./db.ts";
import { createApp } from "./app.ts";
const db = await connect();
await migrate(db);
const server = createApp(db).listen(
  Number(process.env.PORT) || 3000,
  "0.0.0.0",
  () => console.log("Kiwi Market ready"),
);
process.on("SIGTERM", () =>
  server.close(async () => {
    await db.close();
    process.exit(0);
  }),
);
