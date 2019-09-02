﻿import test from "ava";
import { sleep } from "./common";
import { all } from "../src/internal/z.index";
import { ReactiveCache, Transaction, ReentrantCall, Debug } from "../src/z.index";
import { DemoModel, DemoView, actual } from "./async";

const etalon: string[] = [
  "Url: reactronic",
  "Log: RTA",
  "[...] Url: reactronic",
  "[...] Log: RTA",
  "Url: nezaboodka.com",
  "Log: RTA, nezaboodka.com/500",
];

test("async", async t => {
  Debug.verbosity = process.env.AVA_DEBUG === undefined ? 0 : 3;
  const app = Transaction.run(() => new DemoView(new DemoModel()));
  app.model.load.rcache.configure({reentrant: ReentrantCall.CancelPrevious});
  try {
    t.throws(() => { app.test = "testing @stateful for fields"; });
    await app.print(); // trigger first run
    const list: Array<{ url: string, delay: number }> = [
      { url: "google.com", delay: 300 },
      { url: "microsoft.com", delay: 200 },
      { url: "nezaboodka.com", delay: 500 },
    ];
    const downloads = list.map(x => app.model.load(x.url, x.delay));
    await all(downloads);
  }
  catch (error) {
    actual.push(error.toString());
    if (Debug.verbosity >= 1) console.log(error.toString());
  }
  finally {
    await sleep(400);
    await ReactiveCache.unmount(app, app.model).whenFinished(true);
  }
  if (Debug.verbosity >= 1) {
    console.log("\nResults:\n");
    for (const x of actual)
      console.log(x);
    console.log("\n");
  }
  const n: number = Math.max(actual.length, etalon.length);
  for (let i = 0; i < n; i++) {
    if (Debug.verbosity >= 1) console.log(`actual[${i}] = ${actual[i]}, etalon[${i}] = ${etalon[i]}`);
    t.is(actual[i], etalon[i]);
  }
});
