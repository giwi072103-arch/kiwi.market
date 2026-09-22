import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { connect, migrate } from "../server/db.ts";
import { createApp } from "../server/app.ts";
import { encrypt, decrypt, verifyTelegram } from "../server/security.ts";
process.env.LOCAL_DB = "1";
process.env.DATA_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.ADMIN_BOOTSTRAP_TOKEN = randomBytes(32).toString("hex");
test("marketplace: access controls, stock, escrow, disputes, audit and Telegram signatures", async (t) => {
  const db = await connect();
  await migrate(db);
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  function client() {
    let cookie = "";
    return async (route: string, body?: any, method?: string) => {
      const r = await fetch(base + "/api" + route, {
        method: method || (body ? "POST" : "GET"),
        headers: {
          "Content-Type": "application/json",
          "X-Kiwi-Request": "1",
          Cookie: cookie,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (r.headers.get("set-cookie"))
        cookie = r.headers.get("set-cookie")!.split(";")[0];
      return { status: r.status, data: await r.json() };
    };
  }
  const owner = client(),
    seller = client(),
    buyer = client(),
    other = client();
  const people: any = {};
  try {
    for (const [name, c] of [
      ["owner", owner],
      ["seller", seller],
      ["buyer", buyer],
      ["other", other],
    ] as const) {
      const r = await c("/auth/register", {
        name,
        email: name + "@example.test",
        password: "test-password-long-123",
      });
      assert.equal(r.status, 200);
      people[name] = r.data.user.id;
    }
    await t.test(
      "owner can be claimed once; ordinary users cannot access admin or alter balances",
      async () => {
        assert.equal((await buyer("/admin/overview")).status, 403);
        assert.equal(
          (
            await owner("/admin/claim", {
              token: process.env.ADMIN_BOOTSTRAP_TOKEN,
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await buyer("/admin/claim", {
              token: process.env.ADMIN_BOOTSTRAP_TOKEN,
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await buyer("/admin/users/" + people.buyer + "/balance", {
              amount: 10000,
              reason: "test fund",
            })
          ).status,
          403,
        );
      },
    );
    for (const key of ["buyer", "other"])
      assert.equal(
        (
          await owner("/admin/users/" + people[key] + "/balance", {
            amount: 20000,
            reason: "Test opening balance",
          })
        ).status,
        200,
      );
    const r = await seller("/products", {
      title: "Integration test key",
      description: "Digital product for integration testing only",
      price: 10000,
      category_id: "steam",
      auto_delivery: true,
    });
    assert.equal(r.status, 201);
    const pid = r.data.id;
    await t.test(
      "moderation gates catalog, secrets never appear in catalog",
      async () => {
        assert.equal((await buyer("/products")).data.length, 0);
        assert.equal(
          (await other("/products/" + pid + "/stock", { items: ["stolen"] }))
            .status,
          404,
        );
        assert.equal(
          (
            await seller("/products/" + pid + "/stock", {
              items: ["SECRET-KEY-ONE"],
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await owner("/admin/products/" + pid, {
              status: "active",
              reason: "Reviewed test product",
            })
          ).status,
          200,
        );
        const c = await buyer("/products");
        assert.equal(c.data.length, 1);
        assert.equal(c.data[0].stock_count, 1);
        assert.ok(!JSON.stringify(c.data).includes("SECRET-KEY"));
      },
    );
    let orderId = "";
    const requestKey = randomUUID();
    await t.test(
      "concurrent purchase of last unit succeeds once; request replay cannot double debit",
      async () => {
        const results = await Promise.all([
          buyer("/orders", { product_id: pid, request_key: requestKey }),
          other("/orders", { product_id: pid, request_key: randomUUID() }),
        ]);
        assert.equal(results.filter((r) => r.status === 201).length, 1);
        assert.equal(results[0].status, 201);
        orderId = results[0].data.id;
        const replay = await buyer("/orders", {
          product_id: pid,
          request_key: requestKey,
        });
        assert.equal(replay.data.id, orderId);
        assert.equal(Number((await buyer("/wallet")).data.balance), 10000);
        assert.equal(Number((await seller("/wallet")).data.balance), 0);
        assert.equal((await other("/orders/" + orderId)).status, 404);
        const o = await buyer("/orders/" + orderId);
        assert.equal(o.data.delivery, "SECRET-KEY-ONE");
        assert.equal((await seller("/orders/" + orderId)).data.delivery, null);
        assert.equal(
          (
            await other("/orders/" + orderId + "/messages", {
              body: "unauthorized",
            })
          ).status,
          404,
        );
      },
    );
    await t.test(
      "dispute prevents buyer release; admin resolution pays once and records fee",
      async () => {
        assert.equal(
          (
            await buyer("/orders/" + orderId + "/action", {
              action: "dispute",
              reason: "Key needs investigation",
            })
          ).status,
          200,
        );
        assert.equal(
          (await buyer("/orders/" + orderId + "/action", { action: "confirm" }))
            .status,
          409,
        );
        assert.equal(
          (
            await owner("/admin/orders/" + orderId + "/resolve", {
              outcome: "completed",
              reason: "Seller delivery verified",
            })
          ).status,
          200,
        );
        assert.equal(Number((await seller("/wallet")).data.balance), 9500);
        assert.equal(
          (
            await owner("/admin/orders/" + orderId + "/resolve", {
              outcome: "completed",
              reason: "Repeated resolution",
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await buyer("/orders/" + orderId + "/review", {
              rating: 5,
              body: "Works correctly",
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await buyer("/orders/" + orderId + "/review", {
              rating: 5,
              body: "Duplicate review",
            })
          ).status,
          409,
        );
        assert.equal(Number((await owner("/admin/overview")).data.fees), 500);
      },
    );
    await t.test(
      "refund restores buyer funds without recycling disclosed stock",
      async () => {
        await seller("/products/" + pid + "/stock", { items: ["SECRET-TWO"] });
        const r = await buyer("/orders", {
          product_id: pid,
          request_key: randomUUID(),
        });
        assert.equal(r.status, 201);
        assert.equal(
          (
            await seller("/orders/" + r.data.id + "/action", {
              action: "refund",
              reason: "Customer requested refund",
            })
          ).status,
          200,
        );
        assert.equal(Number((await buyer("/wallet")).data.balance), 10000);
        assert.equal((await buyer("/products")).data[0].stock_count, 0);
      },
    );
    await t.test(
      "ban invalidates sessions, moderator cannot change balances, audit is present",
      async () => {
        await owner("/admin/users/" + people.other, {
          role: "moderator",
          reason: "Assign test moderator",
        });
        assert.equal(
          (
            await other("/admin/users/" + people.buyer + "/balance", {
              amount: 1,
              reason: "Unauthorized correction",
            })
          ).status,
          403,
        );
        await owner("/admin/users/" + people.buyer, {
          banned: true,
          reason: "Test account ban",
        });
        assert.equal((await buyer("/wallet")).status, 401);
        assert.ok((await owner("/admin/audit")).data.length >= 6);
      },
    );
    await t.test(
      "CSRF headers, encryption integrity and signed Telegram data",
      async () => {
        const r = await fetch(base + "/api/auth/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        assert.equal(r.status, 403);
        const value = encrypt("sensitive");
        assert.equal(decrypt(value), "sensitive");
        assert.throws(() => decrypt(value.slice(0, -2) + "ff"));
        process.env.TELEGRAM_BOT_TOKEN = "test-only-token";
        const p = new URLSearchParams({
          auth_date: String(Math.floor(Date.now() / 1000)),
          user: JSON.stringify({ id: 123456, first_name: "Tester" }),
        });
        const lines = [...p]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => k + "=" + v)
          .join("\n");
        const secret = createHmac("sha256", "WebAppData")
          .update(process.env.TELEGRAM_BOT_TOKEN)
          .digest();
        p.set("hash", createHmac("sha256", secret).update(lines).digest("hex"));
        assert.equal(verifyTelegram(p.toString()).id, 123456);
        p.set("user", JSON.stringify({ id: 999 }));
        assert.throws(() => verifyTelegram(p.toString()));
      },
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await db.close();
  }
});
