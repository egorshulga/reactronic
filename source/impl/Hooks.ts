// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Utils, undef, F } from '../util/Utils'
import { misuse } from '../util/Dbg'
import { CopyOnWriteArray, CopyOnWrite } from '../util/CopyOnWriteArray'
import { CopyOnWriteSet } from '../util/CopyOnWriteSet'
import { CopyOnWriteMap } from '../util/CopyOnWriteMap'
import { Record, FieldKey, FieldValue, Handle, R_HANDLE, R_UNMOUNT, R_CACHE } from './Data'
import { Hint } from './Hint'
import { Snapshot, BLANK } from './Snapshot'
import { Options, Kind, Reentrance } from '../Options'
import { Indicator } from '../Indicator'
import { Cache } from '../Cache'
import { Trace } from '../Trace'

// Stateful

export class Stateful {
  constructor() {
    const h = Hooks.createHandle(true, this, undefined, new.target.name)
    if (!Hooks.triggersAutoStartDisabled) {
      const triggers: Map<FieldKey, OptionsImpl> | undefined = Hooks.getOptionsTable(new.target.prototype)[R_TRIGGERS]
      if (triggers)
        triggers.forEach((rx, field) =>
          (h.proxy[field][R_CACHE] as Cache<any>).invalidate())
    }
    return h.proxy
  }

  [Symbol.toStringTag](): string {
    const h = Utils.get<Handle>(this, R_HANDLE)
    return Hint.handle(h)
  }
}

export function options(options: Partial<Options>): F<any> {
  return function(proto: object, prop?: PropertyKey, pd?: TypedPropertyDescriptor<F<any>>): any {
    if (prop && pd)
      return Hooks.decorateMethod(false, options, proto, prop, pd) /* istanbul ignore next */
    else if (prop) /* istanbul ignore next */
      return Hooks.decorateField(false, options, proto, prop)
    else /* istanbul ignore next */
      return Hooks.decorateClass(false, options, proto)
  }
}

// Options

const R_TABLE: unique symbol = Symbol("R:TABLE")
const R_CLASS: unique symbol = Symbol("R:CLASS")
const R_TRIGGERS: unique symbol = Symbol("R:TRIGGERS")

const BLANK_TABLE = Object.freeze({})
const DEFAULT_STATELESS_OPTIONS: Options = Object.freeze({
  kind: Kind.Stateless,
  reentrance: Reentrance.PreventWithError,
  cachedArgs: false,
  indicator: null,
  trace: undefined,
})
const DEFAULT_STATEFUL_OPTIONS: Options = Object.freeze({
  kind: Kind.Stateful,
  reentrance: Reentrance.PreventWithError,
  cachedArgs: false,
  indicator: null,
  trace: undefined,
})

export class OptionsImpl implements Options {
  readonly body: Function
  readonly kind: Kind
  readonly reentrance: Reentrance
  readonly cachedArgs: boolean
  readonly indicator: Indicator | null
  readonly trace?: Partial<Trace>
  static readonly STATEFUL = Object.freeze(new OptionsImpl(undef, {body: undef, ...DEFAULT_STATEFUL_OPTIONS}, {}, false))
  static readonly STATELESS = Object.freeze(new OptionsImpl(undef, {body: undef, ...DEFAULT_STATELESS_OPTIONS}, {}, false))

  constructor(body: Function | undefined, existing: OptionsImpl, patch: Partial<OptionsImpl>, implicit: boolean) {
    this.body = body !== undefined ? body : existing.body
    this.kind = merge(DEFAULT_STATELESS_OPTIONS.kind, existing.kind, patch.kind, implicit)
    this.reentrance = merge(DEFAULT_STATELESS_OPTIONS.reentrance, existing.reentrance, patch.reentrance, implicit)
    this.cachedArgs = merge(DEFAULT_STATELESS_OPTIONS.cachedArgs, existing.cachedArgs, patch.cachedArgs, implicit)
    this.indicator = merge(DEFAULT_STATELESS_OPTIONS.indicator, existing.indicator, patch.indicator, implicit)
    this.trace = merge(DEFAULT_STATELESS_OPTIONS.trace, existing.trace, patch.trace, implicit)
    Object.freeze(this)
  }
}

function merge<T>(def: T | undefined, existing: T, patch: T | undefined, implicit: boolean): T {
  return patch !== undefined && (existing === def || !implicit) ? patch : existing
}

// Hooks

export class Hooks implements ProxyHandler<Handle> {
  static triggersAutoStartDisabled: boolean = false
  static performanceWarningThreshold: number = 10
  static readonly proxy: Hooks = new Hooks()

  getPrototypeOf(h: Handle): object | null {
    return Reflect.getPrototypeOf(h.stateless)
  }

  get(h: Handle, field: FieldKey, receiver: any): any {
    let result: any
    const options: OptionsImpl | undefined = Hooks.getOptions(h.stateless, field)
    if (!options || (options.body === decoratedfield && options.kind !== Kind.Stateless)) { // versioned state
      const ctx = Snapshot.readable()
      const r: Record = ctx.read(h)
      result = r.data[field]
      if (result instanceof FieldValue) {
        Snapshot.markViewed(r, field, result, false)
        result = result.value
      }
      else if (field === R_HANDLE) {
        // do nothing, just return handle
      }
      else {
        result = Reflect.get(h.stateless, field, receiver)
        if (result === undefined && field !== Symbol.toPrimitive)
          // Record.markViewed(r, field, false); // treat undefined fields as stateful
          throw misuse(`unassigned properties are not supported: ${Hint.record(r, field)} is used by T${ctx.id} (${ctx.hint})`)
      }
    }
    else
      result = Reflect.get(h.stateless, field, receiver)
    return result
  }

  set(h: Handle, field: FieldKey, value: any, receiver: any): boolean {
    const options: OptionsImpl | undefined = Hooks.getOptions(h.stateless, field)
    if (!options || (options.body === decoratedfield && options.kind !== Kind.Stateless)) { // versioned state
      const r: Record = Snapshot.writable().write(h, field, value)
      const curr = r.data[field] as FieldValue
      const prev = r.prev.record.data[field] as FieldValue
      const changed = prev === undefined || prev.value !== value
      if (changed) {
        if (prev === curr)
          r.data[field] = new FieldValue(value)
        else
          curr.value = value
      }
      else if (prev !== curr)
        r.data[field] = prev // restore previous value
      Snapshot.markChanged(r, field, value, changed)
    }
    else
      h.stateless[field] = value
    return true
  }

  getOwnPropertyDescriptor(h: Handle, field: FieldKey): PropertyDescriptor | undefined {
    const r: Record = Snapshot.readable().read(h)
    const pd = Reflect.getOwnPropertyDescriptor(r.data, field)
    if (pd)
      pd.configurable = pd.writable = true
    return pd
  }

  ownKeys(h: Handle): FieldKey[] {
    // TODO: Better implementation to avoid filtering
    const r: Record = Snapshot.readable().read(h)
    const result = []
    for (const field of Object.getOwnPropertyNames(r.data)) {
      const value = r.data[field]
      if (typeof(value) !== "object" || value.constructor.name !== "CacheResult")
        result.push(field)
    }
    return result
  }

  static decorateClass(implicit: boolean, options: Partial<Options>, origCtor: any): any {
    let ctor: any = origCtor
    const stateful = options.kind !== undefined && options.kind !== Kind.Stateless
    const triggers: Map<FieldKey, OptionsImpl> | undefined = Hooks.getOptionsTable(ctor.prototype)[R_TRIGGERS]
    if (stateful) {
      ctor = class extends origCtor {
        constructor(...args: any[]) {
          super(...args)
          const self: any = this
          const h: Handle = self[R_HANDLE] || Hooks.createHandleByDecoratedClass(stateful, self, undefined, origCtor.name)
          if (self.constructor === ctor)
            h.hint = origCtor.name
          if (triggers && !Hooks.triggersAutoStartDisabled)
            triggers.forEach((rx, field) =>
              (h.proxy[field][R_CACHE] as Cache<any>).invalidate())
          return h.proxy
        }
      }
      Hooks.setup(ctor.prototype, R_CLASS, decoratedclass, options, implicit)
    }
    return ctor
  }

  /* istanbul ignore next */
  static decorateClassOld(implicit: boolean, options: Partial<Options>, origCtor: any): any {
    let ctor: any = origCtor
    const stateful = options.kind !== undefined && options.kind !== Kind.Stateless
    const triggers: Map<FieldKey, OptionsImpl> | undefined = Hooks.getOptionsTable(ctor.prototype)[R_TRIGGERS]
    if (stateful) {
      ctor = function(this: any, ...args: any[]): any {
        const stateless = new origCtor(...args)
        const h: Handle = stateless instanceof Proxy
          ? stateless[R_HANDLE] || Hooks.createHandleByDecoratedClass(stateful, stateless, undefined, origCtor.name)
          : Hooks.createHandleByDecoratedClass(stateful, stateless, undefined, origCtor.name)
        if (triggers)
          triggers.forEach((fieldOptions, field) => {
            const cache: Cache<any> = h.proxy[field][R_CACHE]
            cache.invalidate()
          })
        return h.proxy
      }
      Object.setPrototypeOf(ctor, Object.getPrototypeOf(origCtor)) // preserve prototype
      Object.defineProperties(ctor, Object.getOwnPropertyDescriptors(origCtor)) // preserve static definitions
    }
    Hooks.setup(ctor.prototype, R_CLASS, decoratedclass, options, implicit)
    return ctor
  }

  static decorateField(implicit: boolean, options: Partial<Options>, proto: any, field: FieldKey): any {
    options = Hooks.setup(proto, field, decoratedfield, options, implicit)
    if (options.kind !== Kind.Stateless) {
      const get = function(this: any): any {
        const h: Handle = Hooks.acquireHandle(this)
        return Hooks.proxy.get(h, field, this)
      }
      const set = function(this: any, value: any): boolean {
        const h: Handle = Hooks.acquireHandle(this)
        return Hooks.proxy.set(h, field, value, this)
      }
      const enumerable = true
      const configurable = false
      return Object.defineProperty(proto, field, { get, set, enumerable, configurable })
    }
  }

  static decorateMethod(implicit: boolean, options: Partial<Options>, proto: any, method: FieldKey, pd: TypedPropertyDescriptor<F<any>>): any {
    const enumerable: boolean = pd ? pd.enumerable === true : /* istanbul ignore next */ true
    const configurable: boolean = true
    const methodOptions = Hooks.setup(proto, method, pd.value, options, implicit)
    const get = function(this: any): any {
      const p = Object.getPrototypeOf(this)
      const classOptions: OptionsImpl = Hooks.getOptions(p, R_CLASS) || (this instanceof Stateful ? OptionsImpl.STATEFUL : OptionsImpl.STATELESS)
      const h: Handle = classOptions.kind !== Kind.Stateless ? Utils.get<Handle>(this, R_HANDLE) : Hooks.acquireHandle(this)
      const value = Hooks.createCacheTrap(h, method, methodOptions)
      Object.defineProperty(h.stateless, method, { value, enumerable, configurable })
      return value
    }
    return Object.defineProperty(proto, method, { get, enumerable, configurable })
  }

  private static getOptions(proto: any, field: FieldKey): OptionsImpl | undefined {
    return Hooks.getOptionsTable(proto)[field]
  }

  private static setup(proto: any, field: FieldKey, body: Function | undefined, options: Partial<OptionsImpl>, implicit: boolean): OptionsImpl {
    const optionsTable: any = Hooks.acquireOptionsTable(proto)
    const existing: OptionsImpl = optionsTable[field] || OptionsImpl.STATELESS
    const result = optionsTable[field] = new OptionsImpl(body, existing, options, implicit)
    if (result.kind === Kind.Trigger) {
      let triggers: Map<FieldKey, OptionsImpl> | undefined = optionsTable[R_TRIGGERS]
      if (!triggers)
        triggers = optionsTable[R_TRIGGERS] = new Map<FieldKey, OptionsImpl>()
      triggers.set(field, result)
    }
    else if (existing.kind === Kind.Trigger) {
      const triggers: Map<FieldKey, OptionsImpl> | undefined = optionsTable[R_TRIGGERS]
      if (triggers)
        triggers.delete(field)
    }
    return result
  }

  private static acquireOptionsTable(proto: any): any {
    let optionsTable: any = proto[R_TABLE]
    if (!proto.hasOwnProperty(R_TABLE)) {
      optionsTable = Object.setPrototypeOf({}, optionsTable || {})
      Utils.set(proto, R_TABLE, optionsTable)
    }
    return optionsTable
  }

  static getOptionsTable(proto: any): any {
    return proto[R_TABLE] || /* istanbul ignore next */ BLANK_TABLE
  }

  static acquireHandle(obj: any): Handle {
    if (obj !== Object(obj) || Array.isArray(obj)) /* istanbul ignore next */
      throw misuse("only objects can be reactive")
    let h = Utils.get<Handle>(obj, R_HANDLE)
    if (!h) {
      h = new Handle(obj, obj, Hooks.proxy, BLANK, obj.constructor.name)
      Utils.set(obj, R_HANDLE, h)
      Hooks.decorateField(false, {kind: Kind.Stateful}, obj, R_UNMOUNT)
    }
    return h
  }

  static createHandle(stateful: boolean, stateless: any, proxy: any, hint: string): Handle {
    const h = new Handle(stateless, proxy, Hooks.proxy, BLANK, hint)
    Snapshot.writable().write(h, "<RT:HANDLE>", R_HANDLE)
    return h
  }

  static createHandleByDecoratedClass(stateful: boolean, stateless: any, proxy: any, hint: string): Handle {
    const h = new Handle(stateless, proxy, Hooks.proxy, BLANK, hint)
    const r = Snapshot.writable().write(h, "<RT:HANDLE>", R_HANDLE)
    initRecordData(h, stateful, stateless, r)
    return h
  }

  /* istanbul ignore next */
  static createCacheTrap = function(h: Handle, field: FieldKey, options: OptionsImpl): F<any> {
    throw misuse("createCacheTrap should never be called")
  }
}

function initRecordData(h: Handle, stateful: boolean, stateless: any, record: Record): void {
  const optionsTable = Hooks.getOptionsTable(Object.getPrototypeOf(stateless))
  const r = Snapshot.writable().write(h, "<RT:HANDLE>", R_HANDLE)
  for (const field of Object.getOwnPropertyNames(stateless))
    initRecordField(stateful, optionsTable, field, r, stateless)
  for (const field of Object.getOwnPropertySymbols(stateless)) /* istanbul ignore next */
    initRecordField(stateful, optionsTable, field, r, stateless)
}

function initRecordField(stateful: boolean, optionsTable: any, field: FieldKey, r: Record, stateless: any): void {
  if (stateful && optionsTable[field] !== false) {
    const value = stateless[field]
    r.data[field] = new FieldValue(value)
    Snapshot.markChanged(r, field, value, true)
  }
}

/* istanbul ignore next */
function decoratedfield(...args: any[]): never {
  throw misuse("decoratedfield should never be called")
}

/* istanbul ignore next */
function decoratedclass(...args: any[]): never {
  throw misuse("decoratedclass should never be called")
}

export class CopyOnWriteProxy implements ProxyHandler<CopyOnWrite<any>> {
  static readonly global: CopyOnWriteProxy = new CopyOnWriteProxy()

  get(binding: CopyOnWrite<any>, field: FieldKey, receiver: any): any {
    const a: any = binding.readable(receiver)
    return a[field]
  }

  set(binding: CopyOnWrite<any>, field: FieldKey, value: any, receiver: any): boolean {
    const a: any = binding.writable(receiver)
    return a[field] = value
  }

  static seal(fv: FieldValue, proxy: any, field: FieldKey): void {
    const v = fv.value
    if (Array.isArray(v)) {
      if (!Object.isFrozen(v)) {
        if (fv.copyOnWriteMode)
          fv.value = new Proxy(CopyOnWriteArray.seal(proxy, field, v), CopyOnWriteProxy.global)
        else
          Object.freeze(v) // just freeze without copy-on-write hooks
      }
    }
    else if (v instanceof Set) {
      if (!Object.isFrozen(v)) {
        if (fv.copyOnWriteMode)
          fv.value = new Proxy(CopyOnWriteSet.seal(proxy, field, v), CopyOnWriteProxy.global)
        else
          Utils.freezeSet(v) // just freeze without copy-on-write hooks
      }
    }
    else if (v instanceof Map) {
      if (!Object.isFrozen(v)) {
        if (fv.copyOnWriteMode)
          fv.value = new Proxy(CopyOnWriteMap.seal(proxy, field, v), CopyOnWriteProxy.global)
        else
          Utils.freezeMap(v) // just freeze without copy-on-write hooks
      }
    }
  }
}
