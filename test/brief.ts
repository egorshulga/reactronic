﻿// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Stateful, stateless, transaction, trigger, cached, sensitiveArgs, priority, TransactionJournal, journal, Reactronic as R, TraceOptions, Transaction } from 'api'

export const output: string[] = []

export class Demo extends Stateful {
  static UndoRedo = Transaction.run(() => TransactionJournal.create())
  @stateless shared: string = 'for testing purposes'
  title: string = 'Demo'
  users: Person[] = []
  collection1: Person[] = this.users
  collection2: Person[] = this.users
  usersWithoutLast: Person[] = this.users

  @transaction
  loadUsers(): void {
    this._loadUsers()
  }

  @transaction
  testCollectionSealing(): void {
    this.collection1 = this.collection2 = []
  }

  @transaction
  testImmutableCollection(): void {
    this.collection1.push(...this.users)
  }

  @transaction @journal(Demo.UndoRedo)
  testUndo(): void {
    this.title = 'Demo - undo/redo'
  }

  @trigger @priority(1)
  protected backup(): void {
    this.usersWithoutLast = this.users.slice()
    this.usersWithoutLast.pop()
  }

  private _loadUsers(): void {
    this.users.mutable.push(new Person({
      name: 'John', age: 38,
      emails: ['john@mail.com'],
      children: [
        new Person({ name: 'Billy' }), // William
        new Person({ name: 'Barry' }), // Barry
        new Person({ name: 'Steve' }), // Steven
      ],
    }))
    this.users.push(new Person({
      name: 'Kevin', age: 27,
      emails: ['kevin@mail.com'],
      children: [
        new Person({ name: 'Britney' }),
      ],
    }))
  }
}

export class DemoView extends Stateful {
  @stateless raw: string = 'stateless field'
  @stateless shared: string = 'for testing purposes'
  @stateless readonly model: Demo
  userFilter: string = 'Jo'

  constructor(model: Demo) {
    super()
    this.model = model
    // R.configureObject(this, { sensitivity: Sensitivity.TriggerOnFinalDifferenceOnly })
  }

  @trigger
  print(): void {
    const lines = this.render(0)
    lines.forEach(x => {
      output.push(x) /* istanbul ignore next */
      if (R.isTraceEnabled && !R.traceOptions.silent) console.log(x)
    })
    R.configureCurrentMethodCache({ priority: 123 })
  }

  // @transaction @trace(log.noisy)
  // subPrint(): void {
  //   this.render().forEach(x => output.push(x));
  // }

  @cached
  filteredUsers(): Person[] {
    const m = this.model
    let result: Person[] = m.users.slice()
    if (this.userFilter.length > 0) {
      result = []
      for (const x of m.users)
        if (x.name && x.name.indexOf(this.userFilter) === 0)
          result.push(x)
    }
    return result
  }

  @cached @sensitiveArgs(true)
  render(counter: number): string[] {
    // Print only those users who's name starts with filter string
    this.raw = R.why(true)
    const r: string[] = []
    r.push(`Filter: ${this.userFilter}`)
    const a = this.filteredUsers()
    for (const x of a) {
      const childNames = x.children.map(child => child.name)
      r.push(`${x.name}'s children: ${childNames.join(', ')}`)
    }
    return r
  }

  static test(): void {
    // do nothing
  }
}

// Person

/* istanbul ignore next */
export class Person extends Stateful {
  @stateless dummy: string | null = null
  id: string | null = null
  name: string | null = null
  age: number = 0
  emails: string[] | null = null
  attributes: Map<string, any> = new Map<string, any>()
  get parent(): Person | null { return this._parent } /* istanbul ignore next */
  set parent(value: Person | null) { this.setParent(value) }
  private _parent: Person | null = null
  get children(): ReadonlyArray<Person> { return this._children }
  set children(value: ReadonlyArray<Person>) { this.appendChildren(value) }
  private _children: Person[] = []

  constructor(init?: Partial<Person>) {
    super()
    if (init)
      Object.assign(this, init)
  }

  /* istanbul ignore next */
  setParent(value: Person | null): void {
    if (this.parent !== value) {
      if (this.parent) { // remove from children of old parent
        const a = this.parent._children
        const i = a.findIndex((x, i) => x === this)
        if (i >= 0)
          a.mutable.splice(i, 1)
        else
          throw new Error('invariant is broken, please restart the application')
      }
      if (value) { // add to children of a new parent
        value._children.mutable.push(this)
        this._parent = value
      }
      else
        this._parent = null
    }
  }

  appendChildren(children: ReadonlyArray<Person>): void {
    if (children)
      for (const x of children)
        x.setParent(this)
  }
}

export const TestingTraceLevel: TraceOptions = {
  silent: process.env.AVA_DEBUG === undefined,
  transactions: true,
  methods: true,
  steps: true,
  monitors: true,
  reads: true,
  writes: true,
  changes: true,
  invalidations: true,
  errors: true,
  warnings: true,
  gc: true,
  color: 37,
  prefix: '',
  margin1: 0,
  margin2: 0,
}
