export function ARIcon({ name }: { name: 'back' | 'camera' | 'switch' | 'refit' | 'photo' | 'hand' }) {
  const paths = {
    back: <path d="m14 5-7 7 7 7M7 12h14" />,
    camera: <><path d="M8 5 6 8H3v12h18V8h-3l-2-3H8Z" /><circle cx="12" cy="13" r="4" /></>,
    switch: <><path d="M4 8a9 9 0 0 1 15-3l2 3M21 3v5h-5M20 16a9 9 0 0 1-15 3l-2-3M3 21v-5h5" /><path d="M10 10h4v4h-4z" /></>,
    refit: <><path d="M7 3H3v4m14-4h4v4M3 17v4h4m14-4v4h-4" /><circle cx="12" cy="12" r="4" /><path d="M12 6v3m0 6v3M6 12h3m6 0h3" /></>,
    photo: <><path d="M5 3h14v18H5zM8 16l3-4 3 2 2-3 3 5" /><circle cx="9" cy="8" r="1" /></>,
    hand: <path d="M8 13V6a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v6-3a1.5 1.5 0 0 1 3 0v7c0 4-2 6-6 6h-1c-2 0-3-1-4-2l-5-6a1.5 1.5 0 0 1 2-2l2 2Z" />,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
