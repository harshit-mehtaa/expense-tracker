import React, { createContext, useContext, useEffect, useReducer } from 'react';
import * as Toast from '@radix-ui/react-toast';

export type ToastVariant = 'default' | 'success' | 'error' | 'warning';

interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastState {
  toasts: ToastItem[];
}

type ToastAction =
  | { type: 'ADD'; toast: ToastItem }
  | { type: 'REMOVE'; id: string };

function toastReducer(state: ToastState, action: ToastAction): ToastState {
  switch (action.type) {
    case 'ADD':
      // Cap at 5 simultaneous toasts
      return { toasts: [...state.toasts.slice(-4), action.toast] };
    case 'REMOVE':
      return { toasts: state.toasts.filter((t) => t.id !== action.id) };
    default:
      return state;
  }
}

interface ToastContextValue {
  toast: (opts: { title: string; description?: string; variant?: ToastVariant }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  default: 'bg-white border-gray-200 text-gray-900',
  success: 'bg-white border-green-500 text-gray-900',
  error: 'bg-white border-red-500 text-gray-900',
  warning: 'bg-white border-yellow-500 text-gray-900',
};

const VARIANT_TITLE_CLASSES: Record<ToastVariant, string> = {
  default: 'text-gray-900',
  success: 'text-green-700',
  error: 'text-red-700',
  warning: 'text-yellow-700',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(toastReducer, { toasts: [] });

  const toast = ({
    title,
    description,
    variant = 'default',
  }: {
    title: string;
    description?: string;
    variant?: ToastVariant;
  }) => {
    const id = `${Date.now()}-${Math.random()}`;
    dispatch({ type: 'ADD', toast: { id, title, description, variant } });
  };

  // Listen for api:error custom events dispatched by the Axios interceptor / queryClient
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ message?: string; code?: string }>).detail;
      const message = detail?.message ?? 'Something went wrong. Please try again.';
      toast({ title: 'Error', description: message, variant: 'error' });
    };
    window.addEventListener('api:error', handler);
    return () => window.removeEventListener('api:error', handler);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      <Toast.Provider swipeDirection="right" duration={4000}>
        {children}

        {state.toasts.map((t) => (
          <Toast.Root
            key={t.id}
            className={`flex flex-col gap-1 rounded-md border-l-4 p-4 shadow-lg transition-all w-80 ${VARIANT_CLASSES[t.variant]}`}
            onOpenChange={(open) => {
              if (!open) dispatch({ type: 'REMOVE', id: t.id });
            }}
            defaultOpen
          >
            <Toast.Title className={`text-sm font-semibold ${VARIANT_TITLE_CLASSES[t.variant]}`}>
              {t.title}
            </Toast.Title>
            {t.description && (
              <Toast.Description className="text-sm text-gray-600">
                {t.description}
              </Toast.Description>
            )}
            <Toast.Close className="absolute right-2 top-2 text-gray-400 hover:text-gray-600 text-xs">
              ✕
            </Toast.Close>
          </Toast.Root>
        ))}

        <Toast.Viewport className="fixed bottom-0 right-0 flex flex-col p-4 gap-2 w-96 max-w-full z-50 outline-none" />
      </Toast.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
