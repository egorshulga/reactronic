﻿// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Stateful, transaction, trigger, cached, sensitiveArgs, throttling, monitor,
  reentrance, Transaction as Tran, Monitor, Reentrance, Reactronic as R, all, sleep } from 'api'

export const output: string[] = []
export const busy = Monitor.create('Busy', 0, 0)

export class AsyncDemo extends Stateful {
  url: string = 'reactronic'
  log: string[] = ['RTA']

  @transaction @monitor(busy) @reentrance(Reentrance.PreventWithError)
  async load(url: string, delay: number): Promise<void> {
    this.url = url
    await all([sleep(delay)])
    this.log.mutable.push(`${this.url}/${delay}`)
  }
}

export class AsyncDemoView {
  // @state statefulField: string = 'stateful field'

  constructor(readonly model: AsyncDemo) {
  }

  @trigger @throttling(-1)
  async print(): Promise<void> {
    const lines: string[] = await this.render()
    if (!Tran.current.isCanceled) {
      for (const x of lines) {
        output.push(x) /* istanbul ignore next */
        if (R.isTraceEnabled && !R.traceOptions.silent) console.log(x)
      }
    }
  }

  @cached @sensitiveArgs(false)
  async render(): Promise<string[]> {
    const result: string[] = []
    result.push(`${busy.isActive ? '[...] ' : ''}Url: ${this.model.url}`)
    await sleep(10)
    result.push(`${busy.isActive ? '[...] ' : ''}Log: ${this.model.log.join(', ')}`)
    return result
  }
}
