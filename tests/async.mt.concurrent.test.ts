﻿import test from "ava";
import { sleep } from "./common";
import { all } from "../src/internal/z.index";
import { ReactiveCache, Transaction, AsyncCalls, Debug } from "../src/z.index";
import { DemoModel, DemoView, actual } from "./async";

let etalon: string[] = [
  "Url: reactronic",
  "Log: RTA",
  "[...] Url: reactronic",
  "[...] Log: RTA",
  "[...] Url: nezaboodka.com",
  "[...] Log: RTA, nezaboodka.com/100",
  "Url: nezaboodka.com",
  "Log: RTA, nezaboodka.com/100",
];

test("async", async t => {
  Debug.verbosity = process.env.AVA_DEBUG === undefined ? 0 : 2;
  let app = Transaction.run(() => new DemoView(new DemoModel()));
  app.model.load.rcache.configure({asyncCalls: AsyncCalls.Concurrent});
  try {
    t.throws(() => { app.test = "testing @stateful for fields"; });
    await app.print(); // trigger first run
    let list: Array<{ url: string, delay: number }> = [
      { url: "nezaboodka.com", delay: 100 },
      { url: "google.com", delay: 300 },
      { url: "microsoft.com", delay: 200 },
    ];
    let downloads = list.map(x => app.model.load(x.url, x.delay));
    await all(downloads);
  }
  catch (error) {
    actual.push(error.toString());
    if (Debug.verbosity >= 5) console.log(error.toString());
  }
  finally {
    await sleep(400);
    await ReactiveCache.unmount(app, app.model).whenFinished(true);
  }
  if (Debug.verbosity >= 5)
    for (let x of actual)
      console.log(x);
  let n: number = Math.max(actual.length, etalon.length);
  for (let i = 0; i < n; i++) {
    if (Debug.verbosity >= 5) console.log(`actual[${i}] = ${actual[i]}, etalon[${i}] = ${etalon[i]}`);
    t.is(actual[i], etalon[i]);
  }
});
