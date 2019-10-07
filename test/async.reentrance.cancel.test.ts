﻿// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import test from 'ava'
import { Transaction, Cache, Reactronic as R, Reentrance, cacheof, all, sleep } from '../source/reactronic'
import { DemoModel, DemoView, mon, output, tracing } from './async'

const requests: Array<{ url: string, delay: number }> = [
  { url: "google.com", delay: 300 },
  { url: "microsoft.com", delay: 200 },
  { url: "nezaboodka.com", delay: 500 },
]

const expected: string[] = [
  "Url: reactronic",
  "Log: RTA",
  "[...] Url: reactronic",
  "[...] Log: RTA",
  "[...] Url: nezaboodka.com",
  "[...] Log: RTA, nezaboodka.com/500",
  "Url: nezaboodka.com",
  "Log: RTA, nezaboodka.com/500",
]

test("async", async t => {
  R.setTrace(tracing.noisy)
  const app = Transaction.run("app", () => new DemoView(new DemoModel()))
  cacheof(app.model.load).configure({reentrance: Reentrance.CancelPrevious})
  try {
    t.throws(() => { app.test = "testing @stateful for fields" },
      "stateful property #23 DemoView.test can only be modified inside transaction")
    await app.print() // trigger first run
    const responses = requests.map(x => app.model.load(x.url, x.delay))
    t.is(mon.count, 3)
    t.is(mon.tasks.size, 3)
    await all(responses)
  }
  catch (error) { /* istanbul ignore next */
    output.push(error.toString()) /* istanbul ignore next */
    if (R.isTraceOn && !R.trace.silent) console.log(error.toString())
  }
  finally {
    t.is(mon.count, 0)
    t.is(mon.tasks.size, 0)
    await sleep(400)
    await Cache.unmount(app, app.model).whenFinished(true)
  } /* istanbul ignore next */
  if (R.isTraceOn && !R.trace.silent) {
    console.log("\nResults:\n")
    for (const x of output)
      console.log(x)
    console.log("\n")
  }
  const n: number = Math.max(output.length, expected.length)
  for (let i = 0; i < n; i++) { /* istanbul ignore next */
    if (R.isTraceOn && !R.trace.silent) console.log(`actual[${i}] = ${output[i]},    expected[${i}] = ${expected[i]}`)
    t.is(output[i], expected[i])
  }
})