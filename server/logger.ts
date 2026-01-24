import { type DestinationStream, type LoggerOptions, pino } from "pino";
import { type HttpLogger, type Options, pinoHttp } from "pino-http";

const loggerOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "password",
      "token",
      "apiKey",
      "secret",
    ],
    censor: "[redacted]",
  },
};

export const logger = pino(loggerOptions);

type HttpFactory = (opts?: Options, stream?: DestinationStream) => HttpLogger;

const createHttpLogger = pinoHttp as unknown as HttpFactory;

export const httpLogger = createHttpLogger({
  ...loggerOptions,
  autoLogging: false,
});
