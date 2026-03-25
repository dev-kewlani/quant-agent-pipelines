const timestamp = () => new Date().toISOString().slice(11, 23);

export const log = {
  info: (msg: string, ...args: unknown[]) =>
    console.log(`[${timestamp()}] INFO  ${msg}`, ...args),
  warn: (msg: string, ...args: unknown[]) =>
    console.warn(`[${timestamp()}] WARN  ${msg}`, ...args),
  error: (msg: string, ...args: unknown[]) =>
    console.error(`[${timestamp()}] ERROR ${msg}`, ...args),
  debug: (msg: string, ...args: unknown[]) => {
    if (process.env.DEBUG) console.log(`[${timestamp()}] DEBUG ${msg}`, ...args);
  },
};
