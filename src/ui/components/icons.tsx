import type { SVGProps } from 'react';

type IconName =
  | 'cash'
  | 'time'
  | 'influence'
  | 'gear'
  | 'bat'
  | 'glove'
  | 'recovery'
  | 'fans'
  | 'trophy'
  | 'chat'
  | 'clipboard'
  | 'stadium'
  | 'chevron'
  | 'back'
  | 'check'
  | 'play'
  | 'forward'
  | 'person'
  | 'rest'
  | 'chart'
  | 'warning'
  | 'mic'
  | 'pause'
  | 'list';

const PATHS: Record<IconName, string> = {
  cash: 'M3 7h18v10H3z M12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5 M6 9.5v5 M18 9.5v5',
  time: 'M12 5a8 8 0 1 0 0 16a8 8 0 1 0 0-16 M12 9v4.5l3 2 M10 2h4 M18.5 5.5l1.5-1.5',
  influence: 'M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3.1-5.4 3.1 1.2-6-4.5-4.2 6.1-.7z',
  gear: 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M4.9 4.9l2.1 2.1 M17 17l2.1 2.1 M4.9 19.1L7 17 M17 7l2.1-2.1',
  bat: 'M4 20l2-2 M5.5 18.5l10-12a2.5 2.5 0 0 1 3.5 3.5l-12 10z M18 18a2 2 0 1 0 0.01 0',
  glove: 'M7 21c-2-2-3-5-3-8V7a1.5 1.5 0 0 1 3 0v4 M7 11V4.5a1.5 1.5 0 0 1 3 0V10 M10 10V3.5a1.5 1.5 0 0 1 3 0V10 M13 10V5a1.5 1.5 0 0 1 3 0v6l2-2a1.5 1.5 0 0 1 2 2l-4 6c-1.5 2-3 3-5 3z',
  recovery: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z M12 10v5 M9.5 12.5h5',
  fans: 'M8 11a3 3 0 1 0 0-6a3 3 0 1 0 0 6 M16 11a3 3 0 1 0 0-6a3 3 0 1 0 0 6 M2 20c0-3.3 2.7-5 6-5s6 1.7 6 5 M14 15.2c.6-.1 1.3-.2 2-.2 3.3 0 6 1.7 6 5',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0z M8 6H5a3 3 0 0 0 3 4 M16 6h3a3 3 0 0 1-3 4 M12 13v4 M8 20h8 M9.5 17h5',
  chat: 'M4 5h16v11H9l-5 4z M8.5 10.5h.01 M12 10.5h.01 M15.5 10.5h.01',
  clipboard: 'M8 4h8v3H8z M6 5.5H5v15h14v-15h-1 M8.5 11h7 M8.5 14.5h7 M8.5 18h4',
  stadium: 'M3 10c0-2 4-4 9-4s9 2 9 4v8c0 1-4 3-9 3s-9-2-9-3z M3 10c0 2 4 4 9 4s9-2 9-4 M12 14v7',
  chevron: 'M9 5l7 7-7 7',
  back: 'M15 5l-7 7 7 7 M8 12h12',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  play: 'M7 4.5v15l12-7.5z',
  forward: 'M4 5v14l8-7z M12 5v14l8-7z',
  person: 'M12 12a4 4 0 1 0 0-8a4 4 0 1 0 0 8 M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5',
  rest: 'M10 12a3.5 3.5 0 1 0 0-7a3.5 3.5 0 1 0 0 7 M3 21c0-3.5 3-6 7-6 M15 4h4l-4 4h4 M16 12h3l-3 3h3',
  chart: 'M4 20V10 M10 20V4 M16 20v-7 M3 20h18',
  warning: 'M12 3l10 18H2z M12 10v5 M12 18h.01',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M5.5 11a6.5 6.5 0 0 0 13 0 M12 17.5V21 M8.5 21h7',
  pause: 'M8 5v14 M16 5v14',
  list: 'M9 6h11 M9 12h11 M9 18h11 M4.5 6h.01 M4.5 12h.01 M4.5 18h.01',
};

const FILLED: Partial<Record<IconName, boolean>> = { influence: true, play: true, forward: true };

export function Icon({ name, size = 20, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  const filled = FILLED[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 1 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
