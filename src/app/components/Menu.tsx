import { useEffect, useRef, useState, type ReactNode } from 'react';

interface MenuProps {
  /** Renders the trigger; spread the props onto a button. */
  trigger: (props: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  className?: string;
}

/** A dropdown anchored to its trigger. Closes on outside click and Escape. */
export function Menu({ trigger, children, align = 'left', className }: MenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    // Capture, so an open menu takes Escape before the grid clears its selection.
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div className={`menu-anchor ${className ?? ''}`} ref={ref}>
      {trigger({ onClick: () => setOpen((o) => !o), 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      {open && (
        <div className={`menu ${align === 'right' ? 'right' : ''}`} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
