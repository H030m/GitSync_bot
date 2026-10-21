const log = (level: "info" | "warn" | "error", source: string, message: string, extra?: unknown) => {
  const ts = new Date().toISOString();
  const entry = `[${ts}] [${level.toUpperCase()}] [${source}] ${message}`;
  if (level === "error") console.error(entry, extra ?? "");
  else if (level === "warn") console.warn(entry, extra ?? "");
  else console.log(entry, extra ?? "");
};

export const logger = {
  info: (source: string, message: string, extra?: unknown) => log("info", source, message, extra),
  warn: (source: string, message: string, extra?: unknown) => log("warn", source, message, extra),
  error: (source: string, message: string, extra?: unknown) => log("error", source, message, extra),
};
