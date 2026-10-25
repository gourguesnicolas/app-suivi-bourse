import type { ReactNode } from 'react';

interface Props {
  tone: 'info' | 'error';
  children: ReactNode;
  action?: { label: string; onClick: () => void };
}

export default function Notice({ tone, children, action }: Props) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <p>{children}</p>
      {action && (
        <button type="button" className="btn" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
