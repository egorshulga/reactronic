// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import * as React from 'react'
import { State, action, cached } from '.index'
import { ReactiveComponent } from './React'

class Model extends State {
  url: string = 'https://nezaboodka.com'
  content: string = ''
  timestamp: number = Date.now()

  @action
  async goto(url: string): Promise<void> {
    this.url = url
    this.content = await (await fetch(url)).text()
    this.timestamp = Date.now()
  }
}

class View extends ReactiveComponent<{model: Model}> {
  @cached
  render(): JSX.Element {
    const m = this.props.model
    return (
      <div>
        <div>{m.url}</div>
        <div>{m.content}</div>
      </div>)
  }
}

export const dummy = View
