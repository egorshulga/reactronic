// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import * as React from 'react'
import { Stateful, transaction, cached } from 'api' // from 'reactronic'
import { Component } from './Component'

class MyModel extends Stateful {
  url: string = 'https://nezaboodka.com'
  content: string = ''
  timestamp: number = Date.now()

  @transaction
  async goto(url: string): Promise<void> {
    this.url = url
    this.content = await (await fetch(url)).text()
    this.timestamp = Date.now()
  }
}

class MyView extends Component<{model: MyModel}> {
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

export const dummy = MyView
