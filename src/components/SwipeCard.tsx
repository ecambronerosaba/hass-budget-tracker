import { useEffect, useRef, useState, type ReactNode } from 'react';

const THRESHOLD = 96;
const MAX_ROTATION = 9;

/**
 * The swipe card (§5, motion). It follows the finger exactly — translation
 * plus a little rotation proportional to distance — and springs back if
 * released short of the threshold, so the gesture always feels answerable.
 * Everything it does is also reachable from the buttons underneath, so the
 * flow works fine with a keyboard or a mouse.
 */
export function SwipeCard({
  cardKey,
  children,
  leftLabel,
  rightLabel,
  onSwipeLeft,
  onSwipeRight,
  disabled = false,
}: {
  /** Identity of the card on top — resets the gesture when it changes. */
  cardKey: string;
  children: ReactNode;
  leftLabel: string;
  rightLabel: string;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  disabled?: boolean;
}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [exiting, setExiting] = useState<null | 'left' | 'right'>(null);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDx(0);
    setExiting(null);
    setDragging(false);
    start.current = null;
  }, [cardKey]);

  const fly = (direction: 'left' | 'right') => {
    if (exiting) return;
    setExiting(direction);
    setDragging(false);
    setDx(direction === 'left' ? -520 : 520);
    window.setTimeout(() => {
      if (direction === 'left') onSwipeLeft();
      else onSwipeRight();
    }, 190);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || exiting) return;
    if ((e.target as HTMLElement).closest('button')) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    cardRef.current?.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || !start.current || start.current.id !== e.pointerId) return;
    setDx(e.clientX - start.current.x);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragging || !start.current) return;
    const distance = e.clientX - start.current.x;
    start.current = null;
    setDragging(false);
    if (distance <= -THRESHOLD) fly('left');
    else if (distance >= THRESHOLD) fly('right');
    else setDx(0);
  };

  const progress = Math.min(1, Math.abs(dx) / THRESHOLD);
  const rotation = Math.max(-MAX_ROTATION, Math.min(MAX_ROTATION, dx * 0.05));

  return (
    <div className="deck">
      <div className="deck__card deck__card--behind" aria-hidden="true" />
      <div
        ref={cardRef}
        className="deck__card deck__card--top"
        style={{
          transform: `translate3d(${dx}px, ${Math.abs(dx) * 0.03}px, 0) rotate(${rotation}deg)`,
          transition: dragging ? 'none' : `transform ${exiting ? 190 : 320}ms var(--ease)`,
          opacity: exiting ? 0 : 1,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span
          className="deck__hint deck__hint--left"
          style={{ opacity: dx < 0 ? progress : 0 }}
          aria-hidden="true"
        >
          {leftLabel}
        </span>
        <span
          className="deck__hint deck__hint--right"
          style={{ opacity: dx > 0 ? progress : 0 }}
          aria-hidden="true"
        >
          {rightLabel}
        </span>
        {children}
      </div>
    </div>
  );
}
