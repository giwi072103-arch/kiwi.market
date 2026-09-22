import { useEffect, useRef, type ReactNode } from "react";
import { X, PackageOpen, LoaderCircle } from "lucide-react";
import { labels } from "./api";
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button className="icon" aria-label="Закрыть" onClick={onClose}>
          <X />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function Badge({ value }: { value: string }) {
  return <span className={"badge " + value}>{labels[value] || value}</span>;
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <PackageOpen size={36} />
      <h3>{title}</h3>
      {children}
    </div>
  );
}
export function Loading() {
  return (
    <div className="empty" role="status">
      <LoaderCircle className="spin" />
      Загружаем…
    </div>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
