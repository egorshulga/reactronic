// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { undef, F } from '../util/Utils'
import { Dbg, misuse, error } from '../util/Dbg'
import { Record } from './Data'
import { Snapshot, Hints } from './Snapshot'
import { Worker } from '../Status'
import { Action } from '../Action'
import { Trace } from '../Options'

export class Transaction extends Action {
  private static readonly none: Transaction = new Transaction('<none>')
  private static running: Transaction = Transaction.none
  private static inspection: boolean = false

  readonly trace?: Partial<Trace> // assigned in constructor
  readonly margin: number
  private readonly snapshot: Snapshot // assigned in constructor
  private readonly sidebyside: boolean
  private workers: number
  private sealed: boolean
  private error?: Error
  private after?: Transaction
  private promise?: Promise<void>
  private resolve: (value?: void) => void
  private reject: (reason: any) => void

  constructor(hint: string, sidebyside: boolean = false, trace?: Partial<Trace>, token?: any) {
    super()
    this.trace = trace
    this.margin = Transaction.running ? Transaction.running.margin + 1 : -1
    this.snapshot = new Snapshot(hint, token)
    this.sidebyside = sidebyside
    this.workers = 0
    this.sealed = false
    this.error = undefined
    this.after = undefined
    this.promise = undefined
    this.resolve = undef
    this.reject = undef
  }

  static get current(): Transaction { return Transaction.running }
  get id(): number { return this.snapshot.id }
  get hint(): string { return this.snapshot.hint }

  run<T>(func: F<T>, ...args: any[]): T {
    this.guard()
    return this.do(undefined, func, ...args)
  }

  inspect<T>(func: F<T>, ...args: any[]): T {
    const restore = Transaction.inspection
    try {
      Transaction.inspection = true
      if (Dbg.isOn && Dbg.trace.actions) Dbg.log('', '  ', `T${this.id} (${this.hint}) is being inspected by T${Transaction.running.id} (${Transaction.running.hint})`)
      return this.do(undefined, func, ...args)
    }
    finally {
      Transaction.inspection = restore
    }
  }

  apply(): void {
    if (this.workers > 0)
      throw misuse('cannot apply action having active actions')
    if (this.error)
      throw misuse(`cannot apply action that is already canceled: ${this.error}`)
    this.seal() // apply immediately, because pending === 0
  }

  seal(): this { // t1.seal().whenFinished().then(onfulfilled, onrejected)
    if (!this.sealed)
      this.run(Transaction.seal, this)
    return this
  }

  bind<T>(func: F<T>, secondary: boolean): F<T> {
    this.guard()
    const self = this
    const inspect = Transaction.inspection
    if (!inspect)
      self.run(Transaction.boundEnter, self, secondary)
    else
      self.inspect(Transaction.boundEnter, self, secondary)
    const transactionBoundDo: F<T> = (...args: any[]): T => {
      if (!inspect)
        return self.do<T>(undefined, Transaction.boundLeave, self, func, ...args)
      else
        return self.inspect<T>(Transaction.boundLeave, self, func, ...args)
    }
    return transactionBoundDo
  }

  private static boundEnter<T>(t: Transaction, secondary: boolean): void {
    if (!secondary)
      t.workers++
  }

  private static boundLeave<T>(t: Transaction, func: F<T>, ...args: any[]): T {
    t.workers--
    return func(...args)
  }

  cancel(error: Error, restartAfter?: Worker | null): this {
    this.do(undefined, Transaction.seal, this, error,
      restartAfter === null ? Transaction.none : restartAfter)
    return this
  }

  get isCanceled(): boolean {
    return this.error !== undefined
  }

  get isFinished(): boolean {
    return this.sealed && this.workers === 0
  }

  async whenFinished(): Promise<void> {
    if (!this.isFinished)
      await this.acquirePromise()
  }

  static run<T>(hint: string, func: F<T>, ...args: any[]): T {
    return Transaction.runEx<T>(hint, false, false, undefined, undefined, func, ...args)
  }

  static runEx<T>(hint: string, spawn: boolean, sidebyside: boolean, trace: Partial<Trace> | undefined, token: any, func: F<T>, ...args: any[]): T {
    const t: Transaction = Transaction.acquire(hint, spawn, sidebyside, trace, token)
    const root = t !== Transaction.running
    t.guard()
    let result: any = t.do<T>(trace, func, ...args)
    if (root) {
      if (result instanceof Promise)
        result = Transaction.outside(() => {
          return t.wrapToRetry(t.postponed(result), func, ...args)
        })
      t.seal()
    }
    return result
  }

  static outside<T>(func: F<T>, ...args: any[]): T {
    const outer = Transaction.running
    try {
      Transaction.running = Transaction.none
      return func(...args)
    }
    finally {
      Transaction.running = outer
    }
  }

  // Internal

  private static acquire(hint: string, spawn: boolean, sidebyside: boolean, trace: Partial<Trace> | undefined, token: any): Transaction {
    return spawn || Transaction.running.isFinished
      ? new Transaction(hint, sidebyside, trace, token)
      : Transaction.running
  }

  private guard(): void {
    if (this.error) // prevent from continuing canceled action
      throw error(this.error.message, this.error)
    if (this.sealed && Transaction.running !== this)
      throw misuse('cannot run action that is already sealed')
  }

  private async wrapToRetry<T>(p: Promise<T>, func: F<T>, ...args: any[]): Promise<T | undefined> {
    try {
      const result = await p
      if (this.error)
        throw this.error
      return result
    }
    catch (error) {
      if (this.after !== Transaction.none) {
        if (this.after) {
          // if (Dbg.trace.actions) Dbg.log("", "  ", `T${this.id} (${this.hint}) is waiting for restart`)
          await this.after.whenFinished()
          // if (Dbg.trace.actions) Dbg.log("", "  ", `T${this.id} (${this.hint}) is ready for restart`)
          return Transaction.runEx<T>(this.hint, true, this.sidebyside, this.trace, this.snapshot.caching, func, ...args)
        }
        else
          throw error
      }
      else
        return undefined
    }
  }

  private async postponed<T>(p: Promise<T>): Promise<T> {
    const result = await p
    await this.whenFinished()
    return result
  }

  // Internal

  private do<T>(trace: Partial<Trace> | undefined, func: F<T>, ...args: any[]): T {
    let result: T
    const outer = Transaction.running
    try {
      Transaction.running = this
      this.workers++
      this.snapshot.acquire(outer.snapshot)
      result = func(...args)
      if (this.sealed && this.workers === 1) {
        if (!this.error)
          this.checkForConflicts() // merge with concurrent actions
        else if (!this.after)
          throw this.error
      }
    }
    catch (e) {
      if (!Transaction.inspection)
        this.cancel(e)
      throw e
    }
    finally { // it's critical to have no exceptions in this block
      this.workers--
      if (this.sealed && this.workers === 0) {
        this.finish()
        this.runTriggers()
      }
      Transaction.running = outer
    }
    return result
  }

  private runTriggers(): void {
    this.snapshot.triggers.map(t => t.trig(false, false))
  }

  private static seal(t: Transaction, error?: Error, after?: Transaction): void {
    if (!t.error && error) {
      t.error = error
      t.after = after
      if (Dbg.isOn && Dbg.trace.errors) {
        Dbg.log('║', ' [!]', `${error.message}`, undefined, ' *** CANCEL ***')
        if (after && after !== Transaction.none)
          Dbg.log('║', ' [!]', `will be restarted after T${after.id} (${after.hint})`)
      }
      Snapshot.discardChanges(t.snapshot)
    }
    t.sealed = true
  }

  private checkForConflicts(): void {
    const conflicts = this.snapshot.rebase()
    if (conflicts)
      this.tryResolveConflicts(conflicts)
  }

  private tryResolveConflicts(conflicts: Record[]): void {
    if (!this.sidebyside)
      throw error(`T${this.id} (${this.hint}) conflicts with: ${Hints.conflicts(conflicts)}`, undefined)
    else if (Dbg.isOn && Dbg.trace.warnings)
      Dbg.log('║', '  · ', `conflict is ignored - T${this.id} (${this.hint}) conflicts with: ${Hints.conflicts(conflicts)}`)
  }

  private finish(): void {
    // It's critical to have no exceptions in this block
    this.snapshot.apply(this.error)
    this.snapshot.collect()
    if (this.promise) {
      if (this.error && !this.after)
        this.reject(this.error)
      else
        this.resolve()
    }
    Object.freeze(this)
  }

  private acquirePromise(): Promise<void> {
    if (!this.promise) {
      this.promise = new Promise((resolve, reject): void => {
        this.resolve = resolve
        this.reject = reject
      })
    }
    return this.promise
  }

  private static readableSnapshot(): Snapshot {
    return Transaction.running.snapshot
  }

  private static writableSnapshot(): Snapshot {
    if (Transaction.inspection)
      throw misuse('cannot make changes during action inspection')
    return Transaction.running.snapshot
  }

  static _init(): void {
    Snapshot.readable = Transaction.readableSnapshot // override
    Snapshot.writable = Transaction.writableSnapshot // override
    Transaction.none.sealed = true
    Transaction.none.snapshot.apply()
    Snapshot._init()
  }
}

Transaction._init()