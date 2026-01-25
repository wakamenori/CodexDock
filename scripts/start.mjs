import process from "node:process";

process.env.NODE_ENV = process.env.NODE_ENV ?? "production";

await import("../dist/server/index.js");
