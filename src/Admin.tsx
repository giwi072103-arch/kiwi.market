import { useState, useEffect, useRef } from "react";
import {
  Users,
  Package,
  ShieldAlert,
  ReceiptText,
  Settings,
  ScrollText,
  LayoutGrid,
  Activity,
  Search,
} from "lucide-react";
import { api, money, date, labels } from "./api";
import { Modal, Field, Badge, Empty, Loading } from "./ui";
export default function Admin({
  user,
  notify,
  openOrder,
}: {
  user: any;
  notify: (s: string) => void;
  openOrder: (id: string) => void;
}) {
  const [tab, setTab] = useState("overview"),
    [loaded, setLoaded] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [edit, setEdit] = useState<any>(null),
    [search, setSearch] = useState("");
  const request = useRef(0);
  const data = loaded?.tab === tab ? loaded.value : null;
  const isAdmin = ["owner", "admin"].includes(user.role);
  async function load() {
    setError("");
    const current = ++request.current;
    setLoaded(null);
    try {
      const value = await api(
        "/admin/" + (tab === "settings" ? "overview" : tab),
      );
      if (current === request.current) setLoaded({ tab, value });
    } catch (e) {
      if (current === request.current) setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [tab]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = Object.fromEntries(new FormData(e.currentTarget));
    try {
      let route = edit.route;
      let body: any = { ...edit.body, reason: f.reason };
      if (edit.type === "balance")
        body.amount = Math.round(Number(f.amount) * 100);
      if (edit.type === "role") body.role = f.role;
      if (edit.type === "category")
        body = {
          id: f.id,
          name: f.name,
          color: f.color,
          enabled: f.enabled === "on",
        };
      if (edit.type === "settings")
        body = {
          commission_bps: Math.round(Number(f.commission) * 100),
          maintenance: f.maintenance === "on",
        };
      await api(route, body);
      setEdit(null);
      notify("Изменения сохранены");
      await load();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const tabs: [string, string, typeof Activity][] = [
    ["overview", "Обзор", Activity],
    ["users", "Пользователи", Users],
    ["products", "Модерация", Package],
    ["orders", "Сделки и споры", ShieldAlert],
    ...(isAdmin
      ? ([
          ["ledger", "Операции", ReceiptText],
          ["categories", "Категории", LayoutGrid],
          ["audit", "Журнал", ScrollText],
          ["settings", "Настройки", Settings],
        ] as [string, string, typeof Activity][])
      : []),
  ];
  return (
    <div className="admin-layout">
      <aside className="admin-nav">
        <p className="eyebrow">УПРАВЛЕНИЕ</p>
        {tabs.map(([key, title, Icon]) => (
          <button
            className={tab === key ? "selected" : ""}
            key={key as string}
            onClick={() => setTab(key as string)}
          >
            <Icon size={18} />
            {title as string}
          </button>
        ))}
        <div className="admin-note">
          <Badge value={user.role} />
          <p>Все финансовые изменения фиксируются в журнале.</p>
        </div>
      </aside>
      <section className="admin-main">
        <div className="section-heading">
          <div>
            <p className="eyebrow">KIWI CONTROL</p>
            <h1>{tabs.find((t) => t[0] === tab)?.[1] as string}</h1>
          </div>
          <button className="secondary" onClick={load}>
            Обновить
          </button>
        </div>
        {error ? (
          <div className="notice error">{error}</div>
        ) : !data ? (
          <Loading />
        ) : tab === "overview" ? (
          <>
            <div className="stats">
              {[
                ["Пользователей", data.users],
                ["На модерации", data.products],
                ["Открытых споров", data.disputes],
                ["Оборот", money(data.volume)],
                ["Комиссия", money(data.fees)],
              ].map(([k, v]) => (
                <article className="stat" key={k}>
                  <span>{k}</span>
                  <strong>{v}</strong>
                </article>
              ))}
            </div>
            <div className="panel">
              <h2>Очередь действий</h2>
              <p>
                Проверьте новые объявления и открытые споры. Отзывы, остатки и
                история операций берутся из базы.
              </p>
              <div className="actions">
                <button onClick={() => setTab("products")}>
                  Модерация товаров
                </button>
                <button className="secondary" onClick={() => setTab("orders")}>
                  Перейти к сделкам
                </button>
              </div>
            </div>
          </>
        ) : tab === "settings" ? (
          <div className="panel">
            <h2>Правила площадки</h2>
            <p>
              Комиссия применяется к новым заказам. Режим обслуживания
              останавливает новые покупки.
            </p>
            <button
              onClick={async () => {
                const cfg = await api("/config");
                setEdit({
                  type: "settings",
                  title: "Настройки площадки",
                  route: "/admin/settings",
                  ...cfg,
                });
              }}
            >
              Изменить настройки
            </button>
            <hr />
            <h3>Подключения</h3>
            <p>
              Платёжный провайдер ещё не подключён. Пополнение и вывод реальных
              денег недоступны.
            </p>
            <p>
              Вход Telegram включится после настройки токена бота на сервере.
            </p>
          </div>
        ) : (
          <>
            <div className="toolbar">
              <label className="search">
                <Search size={18} />
                <input
                  aria-label="Поиск в таблице"
                  placeholder="Поиск по записям…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              {tab === "categories" && (
                <button
                  onClick={() =>
                    setEdit({
                      type: "category",
                      title: "Новая категория",
                      route: "/admin/categories",
                    })
                  }
                >
                  Добавить категорию
                </button>
              )}
            </div>
            {data.length === 0 ? (
              <Empty title="Записей пока нет" />
            ) : (
              <div className="records">
                {data
                  .filter((r: any) =>
                    JSON.stringify(r)
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((r: any) => (
                    <article className="record" key={r.id}>
                      <div className="record-info">
                        <strong>
                          {r.title || r.name || r.action || r.kind}
                        </strong>
                        {r.status && <Badge value={r.status} />}
                        <small>
                          {r.email || r.seller_name || r.actor || r.id}
                        </small>
                        {r.created_at && <small>{date(r.created_at)}</small>}
                        {r.reason && <p>{r.reason}</p>}
                        {tab === "users" && (
                          <>
                            <Badge value={r.role} />
                            <span>
                              {r.banned ? "Заблокирован" : "Активен"}
                              {r.balance !== undefined
                                ? " · " + money(r.balance)
                                : ""}
                            </span>
                          </>
                        )}
                        {tab === "products" && (
                          <p>
                            {money(r.price)} · {r.description}
                            <br />
                            Автовыдача: {r.auto_delivery ? "да" : "нет"} ·
                            Остаток: {r.stock_count}
                          </p>
                        )}
                        {tab === "orders" && (
                          <p>
                            {money(r.amount)} · Комиссия {money(r.fee)} ·{" "}
                            {r.buyer_name} → {r.seller_name}
                          </p>
                        )}
                        {tab === "ledger" && (
                          <p>
                            {money(r.amount)} · {labels[r.kind] || r.kind}
                            <br />
                            {r.note}
                          </p>
                        )}
                        {tab === "audit" && (
                          <pre>{JSON.stringify(r.detail, null, 2)}</pre>
                        )}
                        {tab === "categories" && (
                          <Badge value={r.enabled ? "Включена" : "Скрыта"} />
                        )}
                      </div>
                      <div className="record-actions">
                        {tab === "users" &&
                          isAdmin &&
                          r.id !== user.id &&
                          r.role !== "owner" && (
                            <>
                              <button
                                className="secondary"
                                onClick={() =>
                                  setEdit({
                                    title: r.banned
                                      ? "Разблокировать пользователя"
                                      : "Заблокировать пользователя",
                                    route: "/admin/users/" + r.id,
                                    body: { banned: !r.banned },
                                  })
                                }
                              >
                                {r.banned ? "Разблокировать" : "Заблокировать"}
                              </button>
                              {user.role === "owner" && (
                                <>
                                  <button
                                    className="secondary"
                                    onClick={() =>
                                      setEdit({
                                        type: "role",
                                        title: "Изменить роль",
                                        role: r.role,
                                        route: "/admin/users/" + r.id,
                                      })
                                    }
                                  >
                                    Роль
                                  </button>
                                  <button
                                    className="secondary"
                                    onClick={() =>
                                      setEdit({
                                        type: "balance",
                                        title: "Коррекция баланса",
                                        route:
                                          "/admin/users/" + r.id + "/balance",
                                      })
                                    }
                                  >
                                    Баланс
                                  </button>
                                </>
                              )}
                            </>
                          )}
                        {tab === "products" && (
                          <>
                            {["active", "rejected", "archived"].map((s) => (
                              <button
                                className="secondary"
                                key={s}
                                onClick={() =>
                                  setEdit({
                                    title: "Модерация: " + labels[s],
                                    route: "/admin/products/" + r.id,
                                    body: { status: s },
                                  })
                                }
                              >
                                {s === "active"
                                  ? "Опубликовать"
                                  : s === "rejected"
                                    ? "Отклонить"
                                    : "В архив"}
                              </button>
                            ))}
                          </>
                        )}
                        {tab === "orders" && (
                          <>
                            <button
                              className="secondary"
                              onClick={() => openOrder(r.id)}
                            >
                              Открыть заказ
                            </button>
                            {r.status === "disputed" && isAdmin && (
                              <>
                                {["refunded", "completed"].map((s) => (
                                  <button
                                    key={s}
                                    onClick={() =>
                                      setEdit({
                                        title:
                                          s === "refunded"
                                            ? "Вернуть деньги покупателю"
                                            : "Выплатить продавцу",
                                        route:
                                          "/admin/orders/" + r.id + "/resolve",
                                        body: { outcome: s },
                                      })
                                    }
                                  >
                                    {s === "refunded" ? "Возврат" : "Выплата"}
                                  </button>
                                ))}
                              </>
                            )}
                          </>
                        )}
                        {tab === "categories" && (
                          <button
                            className="secondary"
                            onClick={() =>
                              setEdit({
                                type: "category",
                                title: "Изменить категорию",
                                route: "/admin/categories",
                                ...r,
                              })
                            }
                          >
                            Изменить
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
              </div>
            )}
            <p className="muted">
              Показаны последние {data.length} записей, максимум 200.
            </p>
          </>
        )}
      </section>
      {edit && (
        <Modal title={edit.title} onClose={() => setEdit(null)}>
          <form onSubmit={submit}>
            {edit.type === "balance" && (
              <>
                <p className="notice">
                  Это ручная коррекция учёта, а не банковский перевод. Укажите
                  основание.
                </p>
                <Field label="Изменение в рублях (минус для списания)">
                  <input name="amount" type="number" step="0.01" required />
                </Field>
              </>
            )}
            {edit.type === "role" && (
              <Field label="Роль">
                <select name="role" defaultValue={edit.role}>
                  {["user", "moderator", "admin"].map((r) => (
                    <option key={r} value={r}>
                      {labels[r]}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {edit.type === "category" && (
              <>
                <Field label="Идентификатор">
                  <input
                    name="id"
                    defaultValue={edit.id}
                    pattern="[a-z0-9-]{2,60}"
                    required
                    readOnly={!!edit.id}
                  />
                </Field>
                <Field label="Название">
                  <input name="name" defaultValue={edit.name} required />
                </Field>
                <Field label="Цвет">
                  <input
                    name="color"
                    type="color"
                    defaultValue={edit.color || "#b8ee54"}
                  />
                </Field>
                <label className="check">
                  <input
                    name="enabled"
                    type="checkbox"
                    defaultChecked={edit.enabled ?? true}
                  />
                  Категория включена
                </label>
              </>
            )}
            {edit.type === "settings" && (
              <>
                <Field label="Комиссия, %">
                  <input
                    name="commission"
                    type="number"
                    min="0"
                    max="30"
                    step="0.01"
                    defaultValue={edit.commission_bps / 100}
                    required
                  />
                </Field>
                <label className="check">
                  <input
                    name="maintenance"
                    type="checkbox"
                    defaultChecked={edit.maintenance}
                  />
                  Приостановить покупки
                </label>
              </>
            )}
            {!["category", "settings"].includes(edit.type) && (
              <Field label="Причина / основание">
                <textarea
                  name="reason"
                  minLength={5}
                  maxLength={2000}
                  required
                />
              </Field>
            )}
            <button disabled={busy}>
              {busy ? "Сохраняем…" : "Подтвердить"}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
