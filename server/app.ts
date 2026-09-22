import express from "express";
import type { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import path from "node:path";
import type { Database, DB } from "./db.ts";
import {
  hashPassword,
  checkPassword,
  digest,
  encrypt,
  decrypt,
  verifyTelegram,
} from "./security.ts";
const id = () => randomUUID();
const fail = (status: number, message: string): never => {
  throw Object.assign(new Error(message), { status });
};
const uuid = z.string().uuid();
const reason = z
  .string()
  .trim()
  .min(5, "Укажите причину: минимум 5 символов")
  .max(2000);
const userFields = "id,email,telegram_id,name,role,banned,balance,created_at";
async function audit(
  db: DB,
  actor: string,
  action: string,
  target: string,
  detail: unknown = {},
) {
  await db.query(
    "INSERT INTO audit(id,actor_id,action,target,detail) VALUES($1,$2,$3,$4,$5)",
    [id(), actor, action, target, JSON.stringify(detail)],
  );
}
async function entry(
  db: DB,
  user: string,
  amount: number,
  kind: string,
  order: string | null,
  note = "",
) {
  await db.query(
    "INSERT INTO ledger(id,user_id,amount,kind,order_id,note) VALUES($1,$2,$3,$4,$5,$6)",
    [id(), user, amount, kind, order, note],
  );
}
const productSchema = z.object({
  title: z.string().trim().min(5).max(140),
  description: z.string().trim().min(20).max(6000),
  category_id: z.string().min(1).max(60),
  price: z.number().int().min(100).max(100000000),
  image: z
    .union([
      z.literal(""),
      z
        .url()
        .max(1500)
        .refine((s) => s.startsWith("https://"), "Используйте HTTPS"),
    ])
    .default(""),
  auto_delivery: z.boolean().default(false),
});
export function createApp(db: Database) {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "script-src": ["'self'", "https://telegram.org"],
          "img-src": ["'self'", "https:", "data:"],
          "frame-ancestors": [
            "'self'",
            "https://web.telegram.org",
            "https://*.telegram.org",
          ],
          "upgrade-insecure-requests":
            process.env.NODE_ENV === "production" ? [] : null,
        },
      },
      frameguard: false,
    }),
  );
  app.use(express.json({ limit: "100kb" }), cookieParser());
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 180,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Слишком много запросов. Попробуйте через минуту." },
    }),
  );
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.headers["x-kiwi-request"] !== "1")
        return next(
          Object.assign(new Error("Запрос отклонён"), { status: 403 }),
        );
      const origin = req.get("origin");
      const allowed =
        process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
      if (
        origin &&
        origin !== allowed &&
        !(
          process.env.NODE_ENV !== "production" &&
          /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
        )
      )
        return next(
          Object.assign(new Error("Недопустимый источник запроса"), {
            status: 403,
          }),
        );
    }
    next();
  });
  app.use("/api", async (req, res, next) => {
    try {
      const token = req.cookies.kiwi_session;
      if (token) {
        const r = await db.query(
          `SELECT u.${userFields.split(",").join(",u.")} FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=$1 AND s.expires_at>now()`,
          [digest(token)],
        );
        if (r.rows[0] && !r.rows[0].banned) res.locals.user = r.rows[0];
      }
      next();
    } catch (e) {
      next(e);
    }
  });
  const auth = (req: Request, res: Response, next: NextFunction) =>
    res.locals.user
      ? next()
      : next(Object.assign(new Error("Войдите в аккаунт"), { status: 401 }));
  const staff = (req: Request, res: Response, next: NextFunction) =>
    ["moderator", "admin", "owner"].includes(res.locals.user?.role)
      ? next()
      : next(
          Object.assign(new Error("Доступ только для администрации"), {
            status: 403,
          }),
        );
  const admin = (req: Request, res: Response, next: NextFunction) =>
    ["admin", "owner"].includes(res.locals.user?.role)
      ? next()
      : next(Object.assign(new Error("Недостаточно прав"), { status: 403 }));
  async function session(res: Response, user: any) {
    if (user.banned) fail(403, "Аккаунт заблокирован");
    const token = randomBytes(32).toString("hex");
    await db.query(
      "INSERT INTO sessions(token,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",
      [digest(token), user.id],
    );
    res.cookie("kiwi_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 86400000,
      path: "/",
    });
    res.json({ user });
  }
  const authLimit = rateLimit({
    windowMs: 15 * 60000,
    limit: 20,
    message: { error: "Слишком много попыток входа. Подождите 15 минут." },
  });
  app.get("/api/health", async (req, res) => {
    await db.query("SELECT 1");
    res.json({ ok: true });
  });
  app.get("/api/config", async (req, res) => {
    res.json({
      currency: "RUB",
      payments: false,
      telegram: !!process.env.TELEGRAM_BOT_TOKEN,
      ...(await db.query("SELECT * FROM settings WHERE id=1")).rows[0],
    });
  });
  app.get("/api/me", (req, res) => res.json({ user: res.locals.user || null }));
  app.post("/api/auth/register", authLimit, async (req, res) => {
    const p = z
      .object({
        email: z.email().max(200),
        name: z.string().trim().min(2).max(50),
        password: z
          .string()
          .min(12, "Пароль должен содержать минимум 12 символов")
          .max(200),
      })
      .parse(req.body);
    const r = await db.query(
      `INSERT INTO users(id,email,name,password) VALUES($1,$2,$3,$4) RETURNING ${userFields}`,
      [id(), p.email.toLowerCase(), p.name, await hashPassword(p.password)],
    );
    await session(res, r.rows[0]);
  });
  app.post("/api/auth/login", authLimit, async (req, res) => {
    const p = z
      .object({ email: z.email().max(200), password: z.string().max(200) })
      .parse(req.body);
    const r = await db.query("SELECT * FROM users WHERE email=$1", [
      p.email.toLowerCase(),
    ]);
    const u = r.rows[0];
    if (!u?.password || !(await checkPassword(p.password, u.password)))
      fail(401, "Неверная почта или пароль");
    delete u.password;
    await session(res, u);
  });
  app.post("/api/auth/telegram", authLimit, async (req, res) => {
    const p = z
      .object({ initData: z.string().min(1).max(10000) })
      .parse(req.body);
    const t = verifyTelegram(p.initData);
    const r = await db.query(
      `INSERT INTO users(id,telegram_id,name) VALUES($1,$2,$3) ON CONFLICT(telegram_id) DO UPDATE SET name=EXCLUDED.name RETURNING ${userFields}`,
      [
        id(),
        String(t.id),
        String(t.first_name || t.username || "Игрок").slice(0, 50),
      ],
    );
    await session(res, r.rows[0]);
  });
  app.post("/api/auth/logout", async (req, res) => {
    if (req.cookies.kiwi_session)
      await db.query("DELETE FROM sessions WHERE token=$1", [
        digest(req.cookies.kiwi_session),
      ]);
    res.clearCookie("kiwi_session", { path: "/" }).json({ ok: true });
  });
  app.post("/api/auth/link-telegram", auth, async (req, res) => {
    const t = verifyTelegram(z.string().max(10000).parse(req.body.initData));
    await db.query("UPDATE users SET telegram_id=$1 WHERE id=$2", [
      String(t.id),
      res.locals.user.id,
    ]);
    res.json({ ok: true });
  });
  app.post("/api/admin/claim", auth, authLimit, async (req, res) => {
    const token = z.string().min(1).max(200).parse(req.body.token);
    const expected = process.env.ADMIN_BOOTSTRAP_TOKEN;
    if (
      !expected ||
      !timingSafeEqual(
        Buffer.from(digest(token)),
        Buffer.from(digest(expected)),
      )
    )
      fail(403, "Неверный код владельца");
    await db.transaction(async (tx) => {
      await tx.query("SELECT * FROM settings WHERE id=1 FOR UPDATE");
      if (
        (await tx.query("SELECT id FROM users WHERE role='owner'")).rows.length
      )
        fail(409, "Владелец уже назначен");
      await tx.query("UPDATE users SET role='owner' WHERE id=$1", [
        res.locals.user.id,
      ]);
      await audit(tx, res.locals.user.id, "owner.claim", res.locals.user.id);
    });
    res.json({ ok: true });
  });
  app.get("/api/categories", async (req, res) =>
    res.json(
      (
        await db.query(
          "SELECT * FROM categories WHERE enabled=true ORDER BY name",
        )
      ).rows,
    ),
  );
  const catalog = `SELECT p.*,u.name AS seller_name,(SELECT avg(rating)::float FROM reviews WHERE seller_id=u.id) AS rating,(SELECT count(*)::int FROM reviews WHERE seller_id=u.id) AS review_count,(SELECT count(*)::int FROM stock WHERE product_id=p.id AND sold=false) AS stock_count FROM products p JOIN users u ON u.id=p.seller_id JOIN categories c ON c.id=p.category_id`;
  app.get("/api/products", async (req, res) => {
    const q = String(req.query.q || "").slice(0, 100),
      cat = String(req.query.category || "").slice(0, 60);
    const sort =
      req.query.sort === "price"
        ? "p.price ASC"
        : req.query.sort === "expensive"
          ? "p.price DESC"
          : "p.created_at DESC";
    const offset = Math.max(0, Math.min(10000, Number(req.query.offset) || 0));
    res.json(
      (
        await db.query(
          `${catalog} WHERE p.status='active' AND u.banned=false AND c.enabled=true AND ($1='' OR p.title ILIKE '%'||$1||'%' OR p.description ILIKE '%'||$1||'%') AND ($2='' OR p.category_id=$2) ORDER BY ${sort} LIMIT 48 OFFSET $3`,
          [q, cat, offset],
        )
      ).rows,
    );
  });
  app.get("/api/products/:id", async (req, res) => {
    const p = (
      await db.query(`${catalog} WHERE p.id=$1`, [uuid.parse(req.params.id)])
    ).rows[0];
    if (
      !p ||
      (p.status !== "active" &&
        p.seller_id !== res.locals.user?.id &&
        !["admin", "owner", "moderator"].includes(res.locals.user?.role))
    )
      fail(404, "Товар не найден");
    res.json(p);
  });
  app.get("/api/sellers/:id", async (req, res) => {
    const sid = uuid.parse(req.params.id);
    const user = (
      await db.query(
        "SELECT id,name,created_at,banned FROM users WHERE id=$1",
        [sid],
      )
    ).rows[0];
    if (!user) fail(404, "Продавец не найден");
    res.json({
      user,
      reviews: (
        await db.query(
          "SELECT r.rating,r.body,r.created_at,u.name FROM reviews r JOIN users u ON u.id=r.buyer_id WHERE r.seller_id=$1 ORDER BY r.created_at DESC LIMIT 50",
          [sid],
        )
      ).rows,
    });
  });
  app.get("/api/my/products", auth, async (req, res) =>
    res.json(
      (
        await db.query(
          `${catalog} WHERE p.seller_id=$1 ORDER BY p.created_at DESC`,
          [res.locals.user.id],
        )
      ).rows,
    ),
  );
  app.post("/api/products", auth, async (req, res) => {
    const p = productSchema.parse(req.body);
    if (
      !(
        await db.query(
          "SELECT id FROM categories WHERE id=$1 AND enabled=true",
          [p.category_id],
        )
      ).rows.length
    )
      fail(400, "Категория недоступна");
    const r = await db.query(
      "INSERT INTO products(id,seller_id,category_id,title,description,price,image,auto_delivery) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [
        id(),
        res.locals.user.id,
        p.category_id,
        p.title,
        p.description,
        p.price,
        p.image,
        p.auto_delivery,
      ],
    );
    res.status(201).json(r.rows[0]);
  });
  app.patch("/api/products/:id", auth, async (req, res) => {
    const p = productSchema.parse(req.body);
    const r = await db.query(
      "UPDATE products SET title=$1,description=$2,category_id=$3,price=$4,image=$5,auto_delivery=$6,status='pending' WHERE id=$7 AND seller_id=$8 RETURNING id",
      [
        p.title,
        p.description,
        p.category_id,
        p.price,
        p.image,
        p.auto_delivery,
        uuid.parse(req.params.id),
        res.locals.user.id,
      ],
    );
    if (!r.rows.length) fail(404, "Товар не найден");
    res.json({ ok: true });
  });
  app.post("/api/products/:id/stock", auth, async (req, res) => {
    const pid = uuid.parse(req.params.id);
    const items = z
      .array(z.string().trim().min(1).max(6000))
      .min(1)
      .max(100)
      .parse(req.body.items);
    await db.transaction(async (tx) => {
      const p = (
        await tx.query("SELECT * FROM products WHERE id=$1 FOR UPDATE", [pid])
      ).rows[0];
      if (!p || p.seller_id !== res.locals.user.id)
        fail(404, "Товар не найден");
      if (!p.auto_delivery) fail(400, "Включите автовыдачу в товаре");
      for (const secret of items)
        await tx.query(
          "INSERT INTO stock(id,product_id,secret) VALUES($1,$2,$3)",
          [id(), pid, encrypt(secret)],
        );
    });
    res.json({ ok: true, count: items.length });
  });
  app.get("/api/wallet", auth, async (req, res) =>
    res.json({
      balance: res.locals.user.balance,
      entries: (
        await db.query(
          "SELECT * FROM ledger WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
          [res.locals.user.id],
        )
      ).rows,
    }),
  );
  app.post("/api/orders", auth, async (req, res) => {
    const data = z
      .object({ product_id: uuid, request_key: uuid })
      .parse(req.body);
    const buyer = res.locals.user.id;
    const order = await db.transaction(async (tx) => {
      const buyerRow = (
        await tx.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [buyer])
      ).rows[0];
      if (buyerRow.banned) fail(403, "Аккаунт заблокирован");
      const existing = (
        await tx.query(
          "SELECT * FROM orders WHERE buyer_id=$1 AND request_key=$2",
          [buyer, data.request_key],
        )
      ).rows[0];
      if (existing) return { id: existing.id };
      const cfg = (await tx.query("SELECT * FROM settings WHERE id=1")).rows[0];
      if (cfg.maintenance) fail(503, "Покупки временно приостановлены");
      const p = (
        await tx.query(
          "SELECT p.*,u.banned,c.enabled FROM products p JOIN users u ON u.id=p.seller_id JOIN categories c ON c.id=p.category_id WHERE p.id=$1 FOR UPDATE OF p",
          [data.product_id],
        )
      ).rows[0];
      if (!p || p.status !== "active" || p.banned || !p.enabled)
        fail(409, "Товар недоступен");
      if (p.seller_id === buyer) fail(400, "Нельзя купить собственный товар");
      if (Number(buyerRow.balance) < Number(p.price))
        fail(400, "Недостаточно средств. Пополнение пока не подключено.");
      let delivery = null;
      if (p.auto_delivery) {
        const s = (
          await tx.query(
            "SELECT * FROM stock WHERE product_id=$1 AND sold=false ORDER BY id LIMIT 1 FOR UPDATE",
            [p.id],
          )
        ).rows[0];
        if (!s) fail(409, "Товар закончился");
        delivery = s.secret;
        await tx.query("UPDATE stock SET sold=true WHERE id=$1", [s.id]);
      }
      const oid = id();
      await tx.query("UPDATE users SET balance=balance-$1 WHERE id=$2", [
        p.price,
        buyer,
      ]);
      await tx.query(
        "INSERT INTO orders(id,product_id,buyer_id,seller_id,title,amount,fee,status,delivery,request_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          oid,
          p.id,
          buyer,
          p.seller_id,
          p.title,
          p.price,
          Math.floor((Number(p.price) * cfg.commission_bps) / 10000),
          delivery ? "delivered" : "paid",
          delivery,
          data.request_key,
        ],
      );
      await entry(tx, buyer, -Number(p.price), "purchase_hold", oid);
      return { id: oid };
    });
    res.status(201).json(order);
  });
  const ordersSelect =
    "SELECT o.*,b.name AS buyer_name,s.name AS seller_name FROM orders o JOIN users b ON b.id=o.buyer_id JOIN users s ON s.id=o.seller_id";
  app.get("/api/orders", auth, async (req, res) => {
    const rows = (
      await db.query(
        `${ordersSelect} WHERE o.buyer_id=$1 OR o.seller_id=$1 ORDER BY o.created_at DESC LIMIT 100`,
        [res.locals.user.id],
      )
    ).rows;
    res.json(rows.map(({ delivery, ...o }) => o));
  });
  async function getOrder(tx: DB, oid: string, u: any, lock = false) {
    const o = (
      await tx.query(
        `SELECT * FROM orders WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
        [oid],
      )
    ).rows[0];
    if (
      !o ||
      (![o.buyer_id, o.seller_id].includes(u.id) &&
        !["moderator", "admin", "owner"].includes(u.role))
    )
      fail(404, "Заказ не найден");
    return o;
  }
  app.get("/api/orders/:id", auth, async (req, res) => {
    const o = await getOrder(db, uuid.parse(req.params.id), res.locals.user);
    const messages = (
      await db.query(
        "SELECT m.*,u.name FROM messages m JOIN users u ON u.id=m.sender_id WHERE order_id=$1 ORDER BY created_at LIMIT 500",
        [o.id],
      )
    ).rows;
    res.json({
      ...o,
      delivery:
        o.delivery && o.buyer_id === res.locals.user.id
          ? decrypt(o.delivery)
          : null,
      messages,
      review:
        (await db.query("SELECT * FROM reviews WHERE order_id=$1", [o.id]))
          .rows[0] || null,
    });
  });
  app.post("/api/orders/:id/messages", auth, async (req, res) => {
    const oid = uuid.parse(req.params.id),
      body = z.string().trim().min(1).max(4000).parse(req.body.body);
    const o = await getOrder(db, oid, res.locals.user);
    if (["completed", "refunded"].includes(o.status))
      fail(409, "Чат завершённого заказа закрыт");
    await db.query(
      "INSERT INTO messages(id,order_id,sender_id,body) VALUES($1,$2,$3,$4)",
      [id(), oid, res.locals.user.id, body],
    );
    res.json({ ok: true });
  });
  async function settle(
    tx: DB,
    o: any,
    outcome: "completed" | "refunded",
    actor: string,
    note: string,
  ) {
    if (!["paid", "delivered", "disputed"].includes(o.status))
      fail(409, "Заказ уже закрыт");
    const uid = outcome === "completed" ? o.seller_id : o.buyer_id;
    const amount =
      outcome === "completed"
        ? Number(o.amount) - Number(o.fee)
        : Number(o.amount);
    await tx.query("UPDATE users SET balance=balance+$1 WHERE id=$2", [
      amount,
      uid,
    ]);
    await entry(tx, uid, amount, outcome, o.id, note);
    await tx.query("UPDATE orders SET status=$1,reason=$2 WHERE id=$3", [
      outcome,
      note,
      o.id,
    ]);
    await audit(tx, actor, "order." + outcome, o.id, {
      reason: note,
      amount,
      fee: outcome === "completed" ? o.fee : 0,
    });
  }
  app.post("/api/orders/:id/action", auth, async (req, res) => {
    const action = z
      .enum(["deliver", "confirm", "dispute", "refund"])
      .parse(req.body.action);
    await db.transaction(async (tx) => {
      const o = await getOrder(
        tx,
        uuid.parse(req.params.id),
        res.locals.user,
        true,
      );
      const me = res.locals.user.id;
      if (action === "deliver") {
        if (o.seller_id !== me || o.status !== "paid")
          fail(409, "Нельзя передать товар");
        const delivery = z
          .string()
          .trim()
          .min(1)
          .max(6000)
          .parse(req.body.delivery);
        await tx.query(
          "UPDATE orders SET status='delivered',delivery=$1 WHERE id=$2",
          [encrypt(delivery), o.id],
        );
      }
      if (action === "confirm") {
        if (o.buyer_id !== me || o.status !== "delivered")
          fail(409, "Нельзя подтвердить заказ");
        await settle(tx, o, "completed", me, "Покупатель подтвердил получение");
      }
      if (action === "dispute") {
        if (
          ![o.buyer_id, o.seller_id].includes(me) ||
          !["paid", "delivered"].includes(o.status)
        )
          fail(409, "Нельзя открыть спор");
        const r = reason.parse(req.body.reason);
        await tx.query(
          "UPDATE orders SET status='disputed',reason=$1 WHERE id=$2",
          [r, o.id],
        );
        await audit(tx, me, "order.dispute", o.id, { reason: r });
      }
      if (action === "refund") {
        if (
          o.seller_id !== me ||
          !["paid", "delivered", "disputed"].includes(o.status)
        )
          fail(409, "Нельзя вернуть оплату");
        await settle(tx, o, "refunded", me, reason.parse(req.body.reason));
      }
    });
    res.json({ ok: true });
  });
  app.post("/api/orders/:id/review", auth, async (req, res) => {
    const p = z
      .object({
        rating: z.number().int().min(1).max(5),
        body: z.string().trim().min(3).max(2000),
      })
      .parse(req.body);
    const o = await getOrder(db, uuid.parse(req.params.id), res.locals.user);
    if (o.buyer_id !== res.locals.user.id || o.status !== "completed")
      fail(403, "Отзыв доступен после завершения покупки");
    await db.query(
      "INSERT INTO reviews(id,order_id,buyer_id,seller_id,rating,body) VALUES($1,$2,$3,$4,$5,$6)",
      [id(), o.id, o.buyer_id, o.seller_id, p.rating, p.body],
    );
    res.json({ ok: true });
  });
  app.get("/api/admin/overview", auth, staff, async (req, res) => {
    res.json({
      users: (await db.query("SELECT count(*)::int AS n FROM users")).rows[0].n,
      products: (
        await db.query(
          "SELECT count(*)::int AS n FROM products WHERE status='pending'",
        )
      ).rows[0].n,
      disputes: (
        await db.query(
          "SELECT count(*)::int AS n FROM orders WHERE status='disputed'",
        )
      ).rows[0].n,
      volume: (
        await db.query(
          "SELECT coalesce(sum(amount),0) AS n FROM orders WHERE status='completed'",
        )
      ).rows[0].n,
      fees: (
        await db.query(
          "SELECT coalesce(sum(fee),0) AS n FROM orders WHERE status='completed'",
        )
      ).rows[0].n,
    });
  });
  app.get("/api/admin/users", auth, staff, async (req, res) => {
    const fields = ["admin", "owner"].includes(res.locals.user.role)
      ? userFields
      : "id,name,role,banned,created_at";
    res.json(
      (
        await db.query(
          `SELECT ${fields} FROM users WHERE name ILIKE '%'||$1||'%' ORDER BY created_at DESC LIMIT 200`,
          [String(req.query.q || "").slice(0, 100)],
        )
      ).rows,
    );
  });
  app.post("/api/admin/users/:id", auth, admin, async (req, res) => {
    const p = z
      .object({
        banned: z.boolean().optional(),
        role: z.enum(["user", "moderator", "admin"]).optional(),
        reason,
      })
      .parse(req.body);
    const uid = uuid.parse(req.params.id);
    if (uid === res.locals.user.id)
      fail(400, "Нельзя изменить собственные права");
    await db.transaction(async (tx) => {
      const u = (
        await tx.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [uid])
      ).rows[0];
      if (!u) fail(404, "Пользователь не найден");
      if (
        u.role === "owner" ||
        (res.locals.user.role !== "owner" && (u.role !== "user" || p.role))
      )
        fail(403, "Недостаточно прав");
      await tx.query(
        "UPDATE users SET banned=coalesce($1,banned),role=coalesce($2,role) WHERE id=$3",
        [p.banned ?? null, p.role ?? null, uid],
      );
      if (p.banned)
        await tx.query("DELETE FROM sessions WHERE user_id=$1", [uid]);
      await audit(tx, res.locals.user.id, "user.update", uid, p);
    });
    res.json({ ok: true });
  });
  app.post("/api/admin/users/:id/balance", auth, admin, async (req, res) => {
    if (res.locals.user.role !== "owner")
      fail(403, "Коррекция доступна только владельцу");
    const p = z
      .object({
        amount: z
          .number()
          .int()
          .min(-100000000)
          .max(100000000)
          .refine((n) => n !== 0),
        reason,
      })
      .parse(req.body);
    await db.transaction(async (tx) => {
      const uid = uuid.parse(req.params.id);
      const u = (
        await tx.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [uid])
      ).rows[0];
      if (!u) fail(404, "Пользователь не найден");
      if (Number(u.balance) + p.amount < 0)
        fail(400, "Баланс не может быть отрицательным");
      await tx.query("UPDATE users SET balance=balance+$1 WHERE id=$2", [
        p.amount,
        uid,
      ]);
      await entry(tx, uid, p.amount, "adjustment", null, p.reason);
      await audit(tx, res.locals.user.id, "balance.adjust", uid, p);
    });
    res.json({ ok: true });
  });
  app.get("/api/admin/products", auth, staff, async (req, res) =>
    res.json(
      (await db.query(`${catalog} ORDER BY p.created_at DESC LIMIT 200`)).rows,
    ),
  );
  app.post("/api/admin/products/:id", auth, staff, async (req, res) => {
    const p = z
      .object({ status: z.enum(["active", "rejected", "archived"]), reason })
      .parse(req.body);
    await db.transaction(async (tx) => {
      const r = await tx.query(
        "UPDATE products SET status=$1 WHERE id=$2 RETURNING id",
        [p.status, uuid.parse(req.params.id)],
      );
      if (!r.rows.length) fail(404, "Товар не найден");
      await audit(
        tx,
        res.locals.user.id,
        "product.moderate",
        String(req.params.id),
        p,
      );
    });
    res.json({ ok: true });
  });
  app.get("/api/admin/orders", auth, staff, async (req, res) =>
    res.json(
      (
        await db.query(`${ordersSelect} ORDER BY o.created_at DESC LIMIT 200`)
      ).rows.map(({ delivery, ...o }) => o),
    ),
  );
  app.post("/api/admin/orders/:id/resolve", auth, admin, async (req, res) => {
    const p = z
      .object({ outcome: z.enum(["completed", "refunded"]), reason })
      .parse(req.body);
    await db.transaction(async (tx) => {
      const o = await getOrder(
        tx,
        uuid.parse(req.params.id),
        res.locals.user,
        true,
      );
      if (o.status !== "disputed")
        fail(409, "Решение доступно только для спора");
      await settle(tx, o, p.outcome, res.locals.user.id, p.reason);
    });
    res.json({ ok: true });
  });
  app.get("/api/admin/audit", auth, admin, async (req, res) =>
    res.json(
      (
        await db.query(
          "SELECT a.*,u.name AS actor FROM audit a JOIN users u ON u.id=a.actor_id ORDER BY created_at DESC LIMIT 200",
        )
      ).rows,
    ),
  );
  app.get("/api/admin/ledger", auth, admin, async (req, res) =>
    res.json(
      (
        await db.query(
          "SELECT l.*,u.name FROM ledger l JOIN users u ON u.id=l.user_id ORDER BY created_at DESC LIMIT 200",
        )
      ).rows,
    ),
  );
  app.get("/api/admin/categories", auth, staff, async (req, res) =>
    res.json((await db.query("SELECT * FROM categories ORDER BY name")).rows),
  );
  app.post("/api/admin/categories", auth, admin, async (req, res) => {
    const p = z
      .object({
        id: z.string().regex(/^[a-z0-9-]{2,60}$/),
        name: z.string().trim().min(2).max(60),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        enabled: z.boolean(),
      })
      .parse(req.body);
    await db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO categories(id,name,color,enabled) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,color=EXCLUDED.color,enabled=EXCLUDED.enabled",
        [p.id, p.name, p.color, p.enabled],
      );
      await audit(tx, res.locals.user.id, "category.update", p.id, p);
    });
    res.json({ ok: true });
  });
  app.post("/api/admin/settings", auth, admin, async (req, res) => {
    const p = z
      .object({
        commission_bps: z.number().int().min(0).max(3000),
        maintenance: z.boolean(),
      })
      .parse(req.body);
    await db.transaction(async (tx) => {
      await tx.query(
        "UPDATE settings SET commission_bps=$1,maintenance=$2 WHERE id=1",
        [p.commission_bps, p.maintenance],
      );
      await audit(tx, res.locals.user.id, "settings.update", "1", p);
    });
    res.json({ ok: true });
  });
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "Маршрут не найден" }),
  );
  app.use(express.static(path.resolve("dist")));
  app.get("/{*path}", (req, res) =>
    res.sendFile(path.resolve("dist/index.html")),
  );
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof z.ZodError)
      return void res
        .status(400)
        .json({ error: err.issues.map((e) => e.message).join("; ") });
    if (err.code === "23505")
      return void res
        .status(409)
        .json({ error: "Такая запись уже существует" });
    if (err.code === "23503")
      return void res
        .status(400)
        .json({ error: "Связанная запись не найдена" });
    if (!err.status) console.error("Request failed", err.code || err.name, process.env.NODE_ENV === "production" ? "" : err.message);
    res
      .status(err.status || 500)
      .json({
        error: err.status ? err.message : "Ошибка сервера. Попробуйте позже.",
      });
  });
  return app;
}
