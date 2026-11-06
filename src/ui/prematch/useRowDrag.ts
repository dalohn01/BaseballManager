import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/*
 * Drag a row by its handle with the pointer (mouse, pen or touch: HTML5 drag
 * and drop does not work on phones). While dragging, the row follows the
 * finger and the row it would land on is marked; on release `onDrop(from, to)`
 * gets the two indexes. Rows are found by `data-row` inside the list.
 * `accepts(from, to)` can refuse a target (it is then not marked).
 * Mode 'insert' moves the row between others (batting order); 'swap' marks
 * the target row itself (two pitchers exchange roles).
 * The live drag is kept in a ref as well, so a quick drag whose events come
 * before React re-renders still lands where the pointer let go.
 */
export interface RowDrag {
  from: number;
  over: number;
  dy: number;
}

export function useRowDrag(onDrop: (from: number, to: number) => void, accepts: (from: number, to: number) => boolean = () => true, mode: 'insert' | 'swap' = 'insert') {
  const listRef = useRef<HTMLOListElement>(null);
  const [drag, setDragState] = useState<RowDrag | null>(null);
  const live = useRef<RowDrag | null>(null);
  const startY = useRef(0);
  const mids = useRef<number[]>([]);
  const setDrag = (d: RowDrag | null) => {
    live.current = d;
    setDragState(d);
  };

  /** The row under the pointer; over a row that does not accept him, he stays where he was. */
  const targetAt = (y: number, from: number) => {
    let best = from;
    let dist = Infinity;
    mids.current.forEach((m, i) => {
      const d = Math.abs(m - y);
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    return best === from || accepts(from, best) ? best : from;
  };

  const handle = (index: number) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* no capture (synthetic pointer): moves still arrive while over the handle */
      }
      const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])];
      mids.current = rows.map((r) => {
        const b = r.getBoundingClientRect();
        return b.top + b.height / 2;
      });
      startY.current = e.clientY;
      setDrag({ from: index, over: index, dy: 0 });
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      const d = live.current;
      if (!d || d.from !== index) return;
      setDrag({ from: index, over: targetAt(e.clientY, index), dy: e.clientY - startY.current });
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
      const d = live.current;
      if (!d || d.from !== index) return;
      const to = targetAt(e.clientY, index);
      setDrag(null);
      if (to !== d.from) onDrop(d.from, to);
    },
    onPointerCancel: () => setDrag(null),
  });

  /** Classes and style for a row while a drag is on. */
  const rowProps = (index: number) => {
    if (!drag) return { className: '', style: undefined };
    if (index === drag.from) return { className: 'dragging', style: { transform: `translateY(${drag.dy}px)` } };
    if (index === drag.over) return { className: mode === 'swap' ? 'mark-replace' : drag.over < drag.from ? 'mark-before' : 'mark-after', style: undefined };
    return { className: '', style: undefined };
  };

  return { listRef, drag, handle, rowProps };
}
