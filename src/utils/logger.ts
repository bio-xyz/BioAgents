import pino from "pino";

const logger = pino({
  level: "info",
  transport: {
    options: {
      colorize: true,
      ignore: "pid,hostname",
      messageFormat: "{msg}",
      translateTime: "SYS:yyyy-mm-dd HH:MM:ss",
    },
    target: "pino-pretty",
  },
});

export default logger;
