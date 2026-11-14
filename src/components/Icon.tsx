export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    map: "m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16",
    ranking: "M4 20V12h4v8m2 0V4h4v16m2 0V8h4v12",
    risks: "m12 3 10 18H2L12 3Zm0 6v5m0 3v1",
    economy: "M3 7h18v13H3V7Zm2 0V4h14v3m-3 5h5v4h-5v-4",
    arrow: "M5 12h14m-6-6 6 6-6 6",
    download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
    globe:
      "M3 12h18M12 2c6 5 6 15 0 20-6-5-6-15 0-20Zm10 10a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
    spark: "m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.map} />
    </svg>
  );
}
