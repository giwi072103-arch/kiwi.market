import { useState, useEffect, type FormEvent } from "react";
import {
  Search,
  Sun,
  Moon,
  ArrowUpRight,
  ShieldCheck,
  Zap,
  MessageCircle,
  UserRound,
  Plus,
  ShoppingBag,
  Wallet,
  LayoutGrid,
  LogOut,
  SlidersHorizontal,
  ChevronRight,
  Gamepad2,
  Package,
  Star,
  Shield,
  Copy,
} from "lucide-react";
import { api, money, date, labels } from "./api";
import { Modal, Field, Badge, Empty, Loading } from "./ui";
import Admin from "./Admin";
declare global {
  interface Window {
    Telegram?: { WebApp?: any };
  }
}
export default function App() {
  const [user, setUser] = useState<any>(null),
    [boot, setBoot] = useState(true),
    [page, setPage] = useState("catalog"),
    [theme, setTheme] = useState(
      () => localStorage.getItem("kiwi-theme") || "dark",
    ),
    [cats, setCats] = useState<any[]>([]),
    [products, setProducts] = useState<any[]>([]),
    [q, setQ] = useState(""),
    [cat, setCat] = useState(""),
    [sort, setSort] = useState("new"),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [modal, setModal] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [rows, setRows] = useState<any[]>([]),
    [wallet, setWallet] = useState<any>(null),
    [config, setConfig] = useState<any>({});
  const notify = (s: string) => setToast(s);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("kiwi-theme", theme);
    window.Telegram?.WebApp?.setHeaderColor(
      theme === "dark" ? "#151813" : "#f6f7f3",
    );
  }, [theme]);
  async function me() {
    const r = await api("/me");
    setUser(r.user);
  }
  useEffect(() => {
    (async () => {
      try {
        const [m, c, cfg] = await Promise.all([
          api("/me"),
          api("/categories"),
          api("/config"),
        ]);
        setUser(m.user);
        setCats(c);
        setConfig(cfg);
        const tg = window.Telegram?.WebApp;
        tg?.ready();
        tg?.expand();
        if (tg?.initData && cfg.telegram && !m.user) {
          const r = await api("/auth/telegram", { initData: tg.initData });
          setUser(r.user);
        }
      } catch (e) {
        notify((e as Error).message);
      } finally {
        setBoot(false);
      }
    })();
  }, []);
  async function loadPage() {
    setLoading(true);
    setError("");
    try {
      if (page === "catalog")
        setProducts(
          await api(
            "/products?" + new URLSearchParams({ q, category: cat, sort }),
          ),
        );
      if (page === "orders") setRows(await api("/orders"));
      if (page === "sell") setRows(await api("/my/products"));
      if (page === "wallet") setWallet(await api("/wallet"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(
      () => {
        if (!cancelled) void loadPage();
      },
      page === "catalog" ? 200 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [page, q, cat, sort, user?.id]);
  function go(p: string) {
    if (p !== "catalog" && !user) {
      setModal({ type: "auth", register: false });
      return;
    }
    setPage(p);
    setError("");
  }
  async function action(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function openProduct(p: any) {
    setModal({ type: "product", p, requestKey: crypto.randomUUID() });
  }
  async function openOrder(oid: string) {
    await action(async () => {
      const o = await api("/orders/" + oid);
      setModal({ type: "order", o });
    });
  }
  async function authSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    await action(async () => {
      const r = await api(
        "/auth/" + (modal.register ? "register" : "login"),
        f,
      );
      setUser(r.user);
      setModal(null);
      notify("Добро пожаловать в Kiwi Market");
    });
  }
  async function productSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    await action(async () => {
      const body = {
        title: f.title,
        description: f.description,
        category_id: f.category_id,
        price: Math.round(Number(f.price) * 100),
        image: f.image,
        auto_delivery: f.auto_delivery === "on",
      };
      await api(
        modal.p ? "/products/" + modal.p.id : "/products",
        body,
        modal.p ? "PATCH" : "POST",
      );
      setModal(null);
      notify("Товар отправлен на модерацию");
      await loadPage();
    });
  }
  async function orderAction(kind: string, body: Record<string, unknown> = {}) {
    await action(async () => {
      await api("/orders/" + modal.o.id + "/action", { action: kind, ...body });
      const o = await api("/orders/" + modal.o.id);
      setModal({ type: "order", o });
      await me();
      await loadPage();
    });
  }
  const isStaff = ["owner", "admin", "moderator"].includes(user?.role);
  const nav = [
    ["catalog", "Каталог", LayoutGrid],
    ["orders", "Заказы и чаты", MessageCircle],
    ["sell", "Мои товары", Package],
    ["wallet", "Кошелёк", Wallet],
  ] as const;
  return (
    <>
      <div className="topline">
        <span>Цифровые товары. Реальные возможности.</span>
        <span>
          Kiwi Market <span className="muted">/</span> Ранний доступ
        </span>
      </div>
      <header className="main-header">
        <button
          className="brand"
          onClick={() => go("catalog")}
          aria-label="Kiwi Market — главная"
        >
          <span className="brand-mark">
            k<span>•</span>
          </span>
          <span>
            kiwi<span className="brand-light">.market</span>
          </span>
        </button>
        <label className="search header-search">
          <Search size={20} />
          <input
            aria-label="Поиск товаров"
            placeholder="Найти игру, подписку или товар"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage("catalog");
            }}
          />
          <kbd>⌕</kbd>
        </label>
        <button
          className="icon theme"
          aria-label={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun /> : <Moon />}
        </button>
        <button
          className="secondary login-button"
          onClick={() =>
            user ? go("profile") : setModal({ type: "auth", register: false })
          }
        >
          <UserRound size={18} />
          {user?.name || "Войти"}
        </button>
        <button
          className="sell-button"
          onClick={() => {
            if (!user) setModal({ type: "auth", register: false });
            else setModal({ type: "edit" });
          }}
        >
          <Plus size={18} />
          Продать
        </button>
      </header>
      <nav className="desktop-nav">
        {nav.map(([p, title, Icon]) => (
          <button
            key={p}
            className={page === p ? "selected" : ""}
            onClick={() => go(p)}
          >
            <Icon size={17} />
            {title}
          </button>
        ))}
        {isStaff && (
          <button
            className={page === "admin" ? "selected" : ""}
            onClick={() => go("admin")}
          >
            <Shield size={17} />
            Админка
          </button>
        )}
        <span className="nav-end">
          <ShieldCheck size={16} />
          Средства удерживаются до подтверждения
        </span>
      </nav>
      <main>
        {page === "catalog" && (
          <>
            <div className="catalog-intro">
              <div>
                <div className="eyebrow">ТВОЙ СЛЕДУЮЩИЙ УРОВЕНЬ</div>
                <h1>
                  Больше игры.
                  <br />
                  <span>Меньше ожидания.</span>
                </h1>
                <p>
                  Игровые товары, подписки и услуги —
                  <br className="desktop-only" /> найди то, что нужно именно
                  тебе.
                </p>
              </div>
              <div className="intro-side">
                <span className="mini-label">
                  <Zap size={14} /> KIWI MARKET
                </span>
                <h2>
                  От выбора
                  <br />
                  до нового уровня.
                </h2>
                <div className="intro-tags">
                  <span>Покупай</span>
                  <span>Продавай</span>
                  <span>
                    Играй <ArrowUpRight size={15} />
                  </span>
                </div>
              </div>
            </div>
            <section className="categories-section">
              <div className="section-heading">
                <h2>Твоя игра здесь</h2>
                <button
                  className="text-button"
                  onClick={() => {
                    setCat("");
                    setQ("");
                  }}
                >
                  Все категории <ArrowUpRight size={16} />
                </button>
              </div>
              <div className="categories">
                {cats.map((c) => (
                  <button
                    key={c.id}
                    className={"category " + (cat === c.id ? "chosen" : "")}
                    onClick={() => setCat(cat === c.id ? "" : c.id)}
                  >
                    <span
                      className="category-symbol"
                      style={{ background: c.color, color: "#162014" }}
                    >
                      {c.name === "Telegram" ? (
                        <MessageCircle />
                      ) : c.name === "Steam" ? (
                        <Gamepad2 />
                      ) : c.name === "Discord" ? (
                        <MessageCircle />
                      ) : (
                        c.name.slice(0, 2).toUpperCase()
                      )}
                    </span>
                    <span>{c.name}</span>
                  </button>
                ))}
              </div>
            </section>
            <section>
              <div className="section-heading product-heading">
                <div>
                  <div className="eyebrow">МАРКЕТПЛЕЙС</div>
                  <h2>
                    {cat
                      ? cats.find((c) => c.id === cat)?.name
                      : "Открой что-то новое"}
                  </h2>
                </div>
                <label className="sort">
                  <SlidersHorizontal size={16} />
                  <select
                    aria-label="Сортировка"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="new">Сначала новые</option>
                    <option value="price">Сначала дешевле</option>
                    <option value="expensive">Сначала дороже</option>
                  </select>
                </label>
              </div>
              <div className="filter-chips">
                <button
                  className={!cat ? "selected" : ""}
                  onClick={() => setCat("")}
                >
                  Все товары
                </button>
                {cats.slice(0, 5).map((c) => (
                  <button
                    className={cat === c.id ? "selected" : ""}
                    key={c.id}
                    onClick={() => setCat(c.id)}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
              {loading ? (
                <Loading />
              ) : error ? (
                <div className="notice error">
                  {error}
                  <button onClick={loadPage}>Повторить</button>
                </div>
              ) : products.length ? (
                <div className="product-grid">
                  {products.map((p) => (
                    <button
                      className="product-card"
                      key={p.id}
                      onClick={() => openProduct(p)}
                    >
                      <div className={"product-art art-" + p.category_id}>
                        {p.image ? (
                          <img
                            src={p.image}
                            alt={p.title}
                            loading="lazy"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        ) : (
                          <>
                            <Gamepad2 size={46} />
                            <strong>
                              {cats.find((c) => c.id === p.category_id)?.name}
                            </strong>
                          </>
                        )}
                        {p.auto_delivery && (
                          <span className="instant">
                            <Zap size={12} />
                            Автовыдача
                          </span>
                        )}
                      </div>
                      <div className="product-copy">
                        <span className="muted">
                          {cats.find((c) => c.id === p.category_id)?.name}
                        </span>
                        <h3>{p.title}</h3>
                        <strong className="price">{money(p.price)}</strong>
                        <div className="seller-line">
                          <span className="avatar small">
                            {p.seller_name[0]}
                          </span>
                          <span>{p.seller_name}</span>
                          <span className="rating">
                            <Star size={12} />
                            {p.rating ? Number(p.rating).toFixed(1) : "Новый"}
                          </span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <Empty
                  title={
                    q || cat
                      ? "Пока ничего не найдено"
                      : "Первые товары — за тобой"
                  }
                >
                  <p>
                    {q || cat
                      ? "Попробуй другую категорию или измени запрос."
                      : "Площадка открыта для продавцов. Добавь объявление — после модерации оно появится здесь."}
                  </p>
                  <button
                    onClick={() => {
                      if (q || cat) {
                        setQ("");
                        setCat("");
                      } else if (user) setModal({ type: "edit" });
                      else setModal({ type: "auth", register: true });
                    }}
                  >
                    {q || cat ? "Сбросить фильтры" : "Стать первым продавцом"}
                    <ArrowUpRight size={16} />
                  </button>
                </Empty>
              )}
              {products.length === 48 && (
                <p className="muted">
                  Уточните поиск или категорию, чтобы увидеть нужные товары.
                </p>
              )}
            </section>
            <section className="trust-strip">
              <div>
                <ShieldCheck />
                <span>
                  <strong>Сделки под контролем</strong>
                  <small>Подтверждение после получения</small>
                </span>
              </div>
              <div>
                <Zap />
                <span>
                  <strong>Автоматическая выдача</strong>
                  <small>Для товаров с соответствующей отметкой</small>
                </span>
              </div>
              <div>
                <MessageCircle />
                <span>
                  <strong>Прямой диалог</strong>
                  <small>Чат с продавцом внутри заказа</small>
                </span>
              </div>
            </section>
          </>
        )}
        {page === "admin" && user && (
          <Admin user={user} notify={notify} openOrder={openOrder} />
        )}
        {["orders", "sell", "wallet", "profile"].includes(page) && (
          <>
            <div className="section-heading page-title">
              <div>
                <p className="eyebrow">ЛИЧНЫЙ КАБИНЕТ</p>
                <h1>
                  {
                    {
                      orders: "Заказы и чаты",
                      sell: "Мои товары",
                      wallet: "Кошелёк",
                      profile: "Мой профиль",
                    }[page]
                  }
                </h1>
              </div>
              {page === "sell" && (
                <button onClick={() => setModal({ type: "edit" })}>
                  <Plus size={18} />
                  Добавить товар
                </button>
              )}
            </div>
            {error ? (
              <div className="notice error">{error}</div>
            ) : page === "profile" ? (
              <div className="panel profile-panel">
                <div className="avatar large">{user?.name[0]}</div>
                <h2>{user?.name}</h2>
                <p>{user?.email || "Аккаунт Telegram"}</p>
                <Badge value={user?.role} />
                <p className="muted">ID: {user?.id}</p>
                {window.Telegram?.WebApp?.initData && !user?.telegram_id && (
                  <button
                    onClick={() =>
                      action(async () => {
                        await api("/auth/link-telegram", {
                          initData: window.Telegram!.WebApp.initData,
                        });
                        await me();
                        notify("Telegram привязан");
                      })
                    }
                  >
                    Привязать Telegram
                  </button>
                )}
                {!isStaff && (
                  <button
                    className="secondary"
                    onClick={() => setModal({ type: "claim" })}
                  >
                    Я владелец площадки
                  </button>
                )}
                <button
                  className="secondary"
                  onClick={() =>
                    action(async () => {
                      await api("/auth/logout", {});
                      setUser(null);
                      setPage("catalog");
                    })
                  }
                >
                  <LogOut size={16} />
                  Выйти
                </button>
              </div>
            ) : loading ? (
              <Loading />
            ) : page === "wallet" ? (
              <>
                <div className="balance-card">
                  <span>Доступный баланс</span>
                  <strong>{money(wallet?.balance || 0)}</strong>
                  <p>Валюта учёта — российский рубль</p>
                </div>
                <div className="notice">
                  Пополнение и вывод пока недоступны: платёжный сервис ещё не
                  подключён.
                </div>
                <h2>История операций</h2>
                {wallet?.entries?.length ? (
                  <div className="records">
                    {wallet.entries.map((r: any) => (
                      <div className="record" key={r.id}>
                        <div>
                          <strong>{labels[r.kind] || r.kind}</strong>
                          <p>{r.note}</p>
                          <small>{date(r.created_at)}</small>
                        </div>
                        <strong>{money(r.amount)}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty title="Операций пока нет" />
                )}
              </>
            ) : rows.length ? (
              <div className="records">
                {rows.map((r) => (
                  <article className="record" key={r.id}>
                    <div className="record-info">
                      <strong>{r.title}</strong>
                      <Badge value={r.status} />
                      <p>
                        {money(r.price || r.amount)}
                        {page === "sell" && r.auto_delivery
                          ? " · Остаток: " + r.stock_count
                          : ""}
                      </p>
                      <small>{date(r.created_at)}</small>
                    </div>
                    <div className="record-actions">
                      {page === "orders" ? (
                        <button onClick={() => openOrder(r.id)}>
                          Открыть чат <ChevronRight size={16} />
                        </button>
                      ) : (
                        <>
                          <button
                            className="secondary"
                            onClick={() => setModal({ type: "edit", p: r })}
                          >
                            Изменить
                          </button>
                          {r.auto_delivery && (
                            <button
                              onClick={() => setModal({ type: "stock", p: r })}
                            >
                              Добавить остатки
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <Empty
                title={
                  page === "orders"
                    ? "Здесь будут твои заказы"
                    : "Пока нет объявлений"
                }
              >
                <p>
                  {page === "orders"
                    ? "Выбирай товар в каталоге — переписка и статус появятся здесь."
                    : "Создай первый товар и отправь его на модерацию."}
                </p>
              </Empty>
            )}
          </>
        )}
      </main>
      <footer>
        <div className="brand">
          kiwi<span className="brand-light">.market</span>
        </div>
        <span>Твоя игра. Твои возможности.</span>
        <small>© {new Date().getFullYear()} Kiwi Market · Ранний доступ</small>
      </footer>
      <nav className="mobile-nav">
        {[
          ...nav,
          ...(isStaff
            ? [["admin", "Админка", Shield] as const]
            : [["profile", "Профиль", UserRound] as const]),
        ].map(([p, title, Icon]) => (
          <button
            className={page === p ? "selected" : ""}
            key={p}
            onClick={() => go(p)}
          >
            <Icon size={20} />
            <span>
              {p === "orders" ? "Заказы" : p === "sell" ? "Продать" : title}
            </span>
          </button>
        ))}
      </nav>
      {toast && (
        <div className="toast" role="status" onClick={() => setToast("")}>
          {toast}
        </div>
      )}
      {modal?.type === "auth" && (
        <Modal
          title={modal.register ? "Добро пожаловать" : "С возвращением"}
          onClose={() => setModal(null)}
        >
          <p className="muted">Твой аккаунт для покупок и продаж.</p>
          <form onSubmit={authSubmit}>
            {modal.register && (
              <Field label="Имя">
                <input
                  name="name"
                  autoComplete="nickname"
                  minLength={2}
                  maxLength={50}
                  required
                />
              </Field>
            )}
            <Field label="Электронная почта">
              <input name="email" type="email" autoComplete="email" required />
            </Field>
            <Field label="Пароль">
              <input
                name="password"
                type="password"
                minLength={modal.register ? 12 : 1}
                maxLength={200}
                autoComplete={
                  modal.register ? "new-password" : "current-password"
                }
                required
              />
            </Field>
            {modal.register && <small>Минимум 12 символов.</small>}
            <button disabled={busy || boot}>
              {busy
                ? "Подождите…"
                : modal.register
                  ? "Создать аккаунт"
                  : "Войти"}
            </button>
          </form>
          <button
            className="text-button"
            onClick={() => setModal({ ...modal, register: !modal.register })}
          >
            {modal.register
              ? "Уже есть аккаунт? Войти"
              : "Нет аккаунта? Зарегистрироваться"}
          </button>
          {config.telegram && (
            <small>
              В Mini App доступен автоматический вход через Telegram.
            </small>
          )}
        </Modal>
      )}
      {modal?.type === "edit" && (
        <Modal
          title={modal.p ? "Изменить товар" : "Новое объявление"}
          onClose={() => setModal(null)}
        >
          <form onSubmit={productSubmit}>
            <Field label="Название товара">
              <input
                name="title"
                defaultValue={modal.p?.title}
                minLength={5}
                maxLength={140}
                required
                placeholder="Например, ключ для игры"
              />
            </Field>
            <Field label="Категория">
              <select
                name="category_id"
                defaultValue={modal.p?.category_id}
                required
              >
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Описание и условия получения">
              <textarea
                name="description"
                defaultValue={modal.p?.description}
                minLength={20}
                maxLength={6000}
                required
                placeholder="Что получит покупатель и как использовать товар"
              />
            </Field>
            <Field label="Цена, ₽">
              <input
                name="price"
                type="number"
                min="1"
                max="1000000"
                step="0.01"
                defaultValue={modal.p ? Number(modal.p.price) / 100 : undefined}
                required
              />
            </Field>
            <Field label="Ссылка на изображение HTTPS (необязательно)">
              <input
                name="image"
                type="url"
                defaultValue={modal.p?.image}
                placeholder="https://…"
              />
            </Field>
            <label className="check">
              <input
                name="auto_delivery"
                type="checkbox"
                defaultChecked={modal.p?.auto_delivery}
              />
              Автоматическая выдача
            </label>
            <p className="muted">
              Для автовыдачи добавь остатки после создания товара. Изменения
              проходят повторную модерацию.
            </p>
            <button disabled={busy}>
              {busy ? "Сохраняем…" : "Отправить на модерацию"}
            </button>
          </form>
        </Modal>
      )}
      {modal?.type === "stock" && (
        <Modal title="Остатки для автовыдачи" onClose={() => setModal(null)}>
          <p>{modal.p.title}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const value = new FormData(e.currentTarget).get(
                "items",
              ) as string;
              void action(async () => {
                await api("/products/" + modal.p.id + "/stock", {
                  items: value.split("\n").filter((s) => s.trim()),
                });
                setModal(null);
                await loadPage();
                notify("Остатки добавлены");
              });
            }}
          >
            <Field label="Одна строка — одна единица товара">
              <textarea
                name="items"
                rows={7}
                required
                placeholder="Код или данные для первого покупателя&#10;Код или данные для второго покупателя"
              />
            </Field>
            <p className="muted">
              Данные хранятся в зашифрованном виде. Покупатель получит одну
              свободную строку.
            </p>
            <button disabled={busy}>Добавить</button>
          </form>
        </Modal>
      )}
      {modal?.type === "product" && (
        <Modal title="Карточка товара" onClose={() => setModal(null)}>
          <div className="product-detail">
            <Badge
              value={
                modal.p.auto_delivery ? "Автовыдача" : "Передача продавцом"
              }
            />
            <h2>{modal.p.title}</h2>
            <p className="description">{modal.p.description}</p>
            <button
              className="seller-profile secondary"
              onClick={() =>
                action(async () => {
                  const s = await api("/sellers/" + modal.p.seller_id);
                  setModal({ type: "seller", s });
                })
              }
            >
              <UserRound size={18} />
              {modal.p.seller_name}
              <Star size={14} />
              {modal.p.rating
                ? Number(modal.p.rating).toFixed(1)
                : "Нет отзывов"}
            </button>
            <strong className="detail-price">{money(modal.p.price)}</strong>
            <p className="muted">
              <ShieldCheck size={16} /> Средства удерживаются до подтверждения
              получения.
            </p>
            {modal.p.auto_delivery && <p>В наличии: {modal.p.stock_count}</p>}
            <button
              disabled={
                busy ||
                (modal.p.auto_delivery && modal.p.stock_count === 0) ||
                modal.p.seller_id === user?.id
              }
              onClick={() => {
                if (!user) {
                  setModal({ type: "auth", register: false });
                  return;
                }
                void action(async () => {
                  const o = await api("/orders", {
                    product_id: modal.p.id,
                    request_key: modal.requestKey,
                  });
                  await me();
                  const order = await api("/orders/" + o.id);
                  setModal({ type: "order", o: order });
                  setPage("orders");
                });
              }}
            >
              {modal.p.seller_id === user?.id
                ? "Это ваш товар"
                : busy
                  ? "Оформляем…"
                  : "Купить за " + money(modal.p.price)}
            </button>
          </div>
        </Modal>
      )}
      {modal?.type === "seller" && (
        <Modal title={modal.s.user.name} onClose={() => setModal(null)}>
          <p>На площадке с {date(modal.s.user.created_at)}</p>
          {modal.s.reviews.length ? (
            modal.s.reviews.map((r: any, i: number) => (
              <article className="review" key={i}>
                <strong>
                  {r.name} · {r.rating} / 5
                </strong>
                <p>{r.body}</p>
                <small>{date(r.created_at)}</small>
              </article>
            ))
          ) : (
            <Empty title="Отзывов пока нет" />
          )}
        </Modal>
      )}
      {modal?.type === "claim" && (
        <Modal title="Доступ владельца" onClose={() => setModal(null)}>
          <p>
            Введи одноразовый код владельца из переменной ADMIN_BOOTSTRAP_TOKEN
            в Railway. После назначения владельца этот способ перестаёт
            работать.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const token = new FormData(e.currentTarget).get("token");
              void action(async () => {
                await api("/admin/claim", { token });
                await me();
                setModal(null);
                setPage("admin");
                notify("Доступ владельца активирован");
              });
            }}
          >
            <Field label="Код владельца">
              <input name="token" type="password" autoComplete="off" required />
            </Field>
            <button disabled={busy}>Активировать</button>
          </form>
        </Modal>
      )}
      {modal?.type === "order" && (
        <Modal title="Заказ и переписка" onClose={() => setModal(null)}>
          <div className="order-detail">
            <small className="muted">#{modal.o.id.slice(0, 8)}</small>
            <h2>{modal.o.title}</h2>
            <Badge value={modal.o.status} />
            <strong>{money(modal.o.amount)}</strong>
            {modal.o.reason && <p className="notice">{modal.o.reason}</p>}
            {modal.o.delivery && (
              <div className="delivery">
                <h3>Ваш товар</h3>
                <pre>{modal.o.delivery}</pre>
                <button
                  className="secondary"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(modal.o.delivery)
                      .then(() => notify("Скопировано"))
                      .catch(() =>
                        notify("Выделите и скопируйте данные вручную"),
                      )
                  }
                >
                  <Copy size={16} />
                  Скопировать
                </button>
              </div>
            )}
            <div className="actions">
              {modal.o.buyer_id === user?.id &&
                modal.o.status === "delivered" && (
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Вы получили и проверили товар? Средства будут зачислены продавцу.",
                        )
                      )
                        void orderAction("confirm");
                    }}
                  >
                    Товар получен
                  </button>
                )}
              {modal.o.seller_id === user?.id && modal.o.status === "paid" && (
                <button onClick={() => setModal({ ...modal, form: "deliver" })}>
                  Передать товар
                </button>
              )}
              {["paid", "delivered"].includes(modal.o.status) &&
                [modal.o.buyer_id, modal.o.seller_id].includes(user?.id) && (
                  <button
                    className="secondary"
                    onClick={() => setModal({ ...modal, form: "dispute" })}
                  >
                    Открыть спор
                  </button>
                )}
              {modal.o.seller_id === user?.id &&
                ["paid", "delivered", "disputed"].includes(modal.o.status) && (
                  <button
                    className="secondary"
                    onClick={() => setModal({ ...modal, form: "refund" })}
                  >
                    Вернуть оплату
                  </button>
                )}
              <button
                className="secondary"
                onClick={() => openOrder(modal.o.id)}
              >
                Обновить чат
              </button>
            </div>
            {modal.form && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = Object.fromEntries(new FormData(e.currentTarget));
                  void orderAction(modal.form, f);
                }}
              >
                <Field
                  label={
                    modal.form === "deliver"
                      ? "Данные товара и инструкция"
                      : "Причина"
                  }
                >
                  <textarea
                    name={modal.form === "deliver" ? "delivery" : "reason"}
                    minLength={modal.form === "deliver" ? 1 : 5}
                    required
                  />
                </Field>
                <button disabled={busy}>Подтвердить</button>
              </form>
            )}
            <h3>Переписка по заказу</h3>
            <div className="messages">
              {modal.o.messages.length ? (
                modal.o.messages.map((m: any) => (
                  <div
                    key={m.id}
                    className={
                      "message " + (m.sender_id === user?.id ? "mine" : "")
                    }
                  >
                    <strong>{m.name}</strong>
                    <p>{m.body}</p>
                    <small>{date(m.created_at)}</small>
                  </div>
                ))
              ) : (
                <p className="muted">Сообщений пока нет.</p>
              )}
            </div>
            {!["completed", "refunded"].includes(modal.o.status) && (
              <form
                className="message-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const body = new FormData(form).get("body");
                  void action(async () => {
                    await api("/orders/" + modal.o.id + "/messages", { body });
                    const o = await api("/orders/" + modal.o.id);
                    setModal({ type: "order", o });
                    form.reset();
                  });
                }}
              >
                <input
                  name="body"
                  aria-label="Сообщение"
                  placeholder="Написать сообщение…"
                  maxLength={4000}
                  required
                />
                <button disabled={busy} aria-label="Отправить сообщение">
                  <ArrowUpRight size={20} />
                </button>
              </form>
            )}
            {modal.o.status === "completed" &&
              modal.o.buyer_id === user?.id &&
              !modal.o.review && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = Object.fromEntries(new FormData(e.currentTarget));
                    void action(async () => {
                      await api("/orders/" + modal.o.id + "/review", {
                        rating: Number(f.rating),
                        body: f.body,
                      });
                      const o = await api("/orders/" + modal.o.id);
                      setModal({ type: "order", o });
                      notify("Отзыв опубликован");
                    });
                  }}
                >
                  <h3>Оцените продавца</h3>
                  <Field label="Оценка">
                    <select name="rating">
                      {[5, 4, 3, 2, 1].map((n) => (
                        <option key={n} value={n}>
                          {n} из 5
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Отзыв">
                    <textarea
                      name="body"
                      minLength={3}
                      maxLength={2000}
                      required
                    />
                  </Field>
                  <button disabled={busy}>Оставить отзыв</button>
                </form>
              )}
            {modal.o.review && (
              <p className="notice">
                Ваша оценка: {modal.o.review.rating} / 5 · {modal.o.review.body}
              </p>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
