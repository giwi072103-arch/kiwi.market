export async function api<T = any>(
  url: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const r = await fetch("/api" + url, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: { "Content-Type": "application/json", "X-Kiwi-Request": "1" },
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Не удалось выполнить запрос");
  return data;
}
export const money = (n: number | string) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 2,
  }).format(Number(n) / 100);
export const date = (s: string) =>
  new Date(s).toLocaleString("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  });
export const labels: Record<string, string> = {
  pending: "На модерации",
  active: "Опубликован",
  rejected: "Отклонён",
  archived: "В архиве",
  paid: "Оплачен",
  delivered: "Товар передан",
  disputed: "Открыт спор",
  completed: "Завершён",
  refunded: "Возврат",
  user: "Пользователь",
  moderator: "Модератор",
  admin: "Администратор",
  owner: "Владелец",
  purchase_hold: "Оплата заказа",
  adjustment: "Коррекция баланса",
};
