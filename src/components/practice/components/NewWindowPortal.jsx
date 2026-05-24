/**
 * Renders its children into a real browser popup window via a React portal.
 * The popup shares the same JS heap so dispatch/state work with no message-passing.
 * Stylesheets are copied from the parent window on mount.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function NewWindowPortal({
  children,
  title = 'Debug',
  onClose,
  width = 500,
  height = 720,
}) {
  const [container, setContainer] = useState(null);
  const winRef = useRef(null);

  useEffect(() => {
    // Open to the right of the current window
    const left = window.screenX + window.outerWidth;
    const top  = window.screenY;

    const win = window.open(
      '',
      'state-simulator',
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`,
    );

    if (!win) {
      alert('Popup blocked — allow popups for this site and try again.');
      onClose?.();
      return;
    }

    winRef.current = win;
    win.document.title = title;
    win.document.body.style.margin  = '0';
    win.document.body.style.padding = '0';
    win.document.body.style.backgroundColor = '#0f172a';
    win.document.body.style.overflow = 'hidden';

    // Copy all stylesheets so Tailwind classes work in the popup
    Array.from(document.styleSheets).forEach(sheet => {
      try {
        if (sheet.href) {
          const link = win.document.createElement('link');
          link.rel  = 'stylesheet';
          link.href = sheet.href;
          win.document.head.appendChild(link);
        } else {
          const style = win.document.createElement('style');
          style.textContent = Array.from(sheet.cssRules).map(r => r.cssText).join('\n');
          win.document.head.appendChild(style);
        }
      } catch (_) {
        // Cross-origin sheet — skip
      }
    });

    const div = win.document.createElement('div');
    div.style.height = '100vh';
    div.style.display = 'flex';
    div.style.flexDirection = 'column';
    win.document.body.appendChild(div);
    setContainer(div);

    const handleUnload = () => onClose?.();
    win.addEventListener('beforeunload', handleUnload);

    return () => {
      win.removeEventListener('beforeunload', handleUnload);
      if (!win.closed) win.close();
    };
  }, []); // eslint-disable-line

  if (!container) return null;
  return createPortal(children, container);
}
