import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { UserError } from '../lib/ops';
import { fmtNum, parseMoney } from '../lib/format';

// ---------- Toasts ----------

type Toast = { id: number; text: string; kind: 'ok' | 'error' };
const ToastCtx = createContext<(text: string, kind?: Toast['kind']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 5000 : 2800);
  }, []);
  const ref = useRef<HTMLDivElement>(null);
  // Como popover queda en la capa superior, visible incluso sobre un <dialog> abierto.
  useEffect(() => {
    const el = ref.current;
    if (!el?.showPopover) return;
    try {
      if (el.matches(':popover-open')) el.hidePopover();
      if (toasts.length) el.showPopover();
    } catch {
      /* navegador sin soporte de popover */
    }
  }, [toasts]);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div ref={ref} popover="manual" className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/** Ejecuta una acción mostrando el error al usuario si falla. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> => {
      setBusy(true);
      try {
        const r = await fn();
        if (okMsg) toast(okMsg);
        return r;
      } catch (e) {
        console.error(e);
        toast(e instanceof UserError ? e.message : `Error: ${(e as Error).message}`, 'error');
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { run, busy };
}

// ---------- Confirmación ----------

// Reemplaza window.confirm, que algunos navegadores embebidos y apps instaladas bloquean en silencio.
type ConfirmOpts = { confirmLabel?: string; danger?: boolean };
type ConfirmReq = ConfirmOpts & { message: string; resolve: (ok: boolean) => void };
const ConfirmCtx = createContext<(message: string, opts?: ConfirmOpts) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<ConfirmReq | null>(null);
  const ask = useCallback(
    (message: string, opts: ConfirmOpts = {}) => new Promise<boolean>((resolve) => setReq({ message, resolve, ...opts })),
    [],
  );
  const close = (ok: boolean) => {
    req?.resolve(ok);
    setReq(null);
  };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      {req && (
        <Modal
          title="Confirmar"
          onClose={() => close(false)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => close(false)}>
                Cancelar
              </button>
              <button className={`btn ${req.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)} autoFocus>
                {req.confirmLabel ?? 'Aceptar'}
              </button>
            </>
          }
        >
          <p className="pre-line">{req.message}</p>
        </Modal>
      )}
    </ConfirmCtx.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmCtx);

// ---------- Modal ----------

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
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
      className={`modal ${wide ? 'modal-wide' : ''}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="modal-head">
        <h2>{title}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
          ✕
        </button>
      </header>
      <div className="modal-body">{children}</div>
      {footer && <footer className="modal-foot">{footer}</footer>}
    </dialog>
  );
}

// ---------- Inputs ----------

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** Input de dinero que muestra separadores de miles mientras se escribe. */
export function MoneyInput({
  value,
  onChange,
  ...rest
}: { value: number; onChange: (n: number) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <div className="money-input">
      <span>$</span>
      <input
        inputMode="numeric"
        value={value ? fmtNum(value) : ''}
        placeholder="0"
        onChange={(e) => onChange(parseMoney(e.target.value))}
        {...rest}
      />
    </div>
  );
}

export function NumberInput({
  value,
  onChange,
  min = 0,
  ...rest
}: { value: number | null; onChange: (n: number | null) => void; min?: number } & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'min'
>) {
  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      value={value ?? ''}
      onChange={(e) => {
        if (e.target.value === '') return onChange(null);
        const n = Math.max(min, Math.floor(Number(e.target.value)));
        onChange(Number.isNaN(n) ? null : n);
      }}
      onFocus={(e) => e.target.select()}
      {...rest}
    />
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (s: string) => void; placeholder: string }) {
  return (
    <div className="search">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
        <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Tabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="tabs" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          className={value === o.value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Acciones de la página. El título y subtítulo se muestran en la barra superior (Layout). */
export function PageHeader({ actions, children }: { title?: string; actions?: ReactNode; children?: ReactNode }) {
  if (!actions && !children) return null;
  return (
    <div className="page-head">
      {children}
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

/** Abre el selector de archivos del sistema. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
