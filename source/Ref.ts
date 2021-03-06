// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Transaction } from './impl/Transaction'

export type BooleanOnly<T> = Pick<T, {[P in keyof T]: T[P] extends boolean ? P : never}[keyof T]>
export type GivenTypeOnly<T, V> = Pick<T, {[P in keyof T]: T[P] extends V ? P : never}[keyof T]>

export class Ref<T = any> {
  constructor(
    readonly owner: any,
    readonly name: string,
    readonly index: number = -1) {
  }

  get deref(): T {
    if (this.index < 0)
      return this.owner[this.name]
    else
      return this.owner[this.name][this.index]
  }

  set deref(value: T) {
    if (this.index < 0)
      this.owner[this.name] = value
    else
      this.owner[this.name][this.index] = value
  }

  static of<O = any>(owner: O): { readonly [P in keyof O]-?: Ref<O[P]> } {
    return new Proxy<{ readonly [P in keyof O]-?: Ref<O[P]> }>(owner as any, RefGettingProxy)
  }

  static togglesOf<O = any>(owner: O): { readonly [P in keyof BooleanOnly<O>]: BoolRef<O[P]> } {
    return new Proxy<{ readonly [P in keyof BooleanOnly<O>]: BoolRef<O[P]> }>(owner, BoolRefGettingProxy)
  }

  static customTogglesOf<T, O extends object = any>(owner: O, value1: T, value2: T): { readonly [P in keyof GivenTypeOnly<O, T | any>]: BoolRef<O[P]> } {
    const handler = new CustomBoolRefGettingProxy<T>(value1, value2)
    return new Proxy<O>(owner, handler)
  }

  static sameRefs(v1: Ref, v2: Ref): boolean {
    return v1.owner === v2.owner && v1.name === v2.name && v1.index === v2.index
  }

  static similarRefs(v1: Ref, v2: Ref): boolean {
    return v1.owner.constructor === v2.owner.constructor && v1.name === v2.name && v1.index === v2.index
  }
}

export class BoolRef<T = boolean> extends Ref<T> {
  constructor(
    owner: any,
    name: string,
    readonly value1: T,
    readonly value2: T) {
    super(owner, name)
  }

  toggle(): void {
    const o = this.owner
    const p = this.name
    Transaction.runAs({ hint: `toggle ${(o as any).constructor.name}.${p}` }, () => {
      const v = o[p]
      const isValue1 = v === this.value1 || (
        v instanceof Ref && this.value1 instanceof Ref &&
        Ref.sameRefs(v, this.value1))
      if (!isValue1)
        o[p] = this.value1
      else
        o[p] = this.value2
    })
  }
}

// Internal

const RefGettingProxy = {
  get: <T = any, O = any>(obj: O, prop: keyof {[P in keyof O]: O[P] extends T ? P : never}): Ref<T> => {
    return new Ref<T>(obj, prop as string)
  },
}

const BoolRefGettingProxy = {
  get: <T, O = any>(obj: O, prop: keyof {[P in keyof O]: O[P] extends T ? P : never}): BoolRef<T> => {
    return new BoolRef<any>(obj, prop as string, true, false)
  },
}

class CustomBoolRefGettingProxy<T> {
  constructor(
    readonly value1: T,
    readonly value2: T) {
  }

  get<O = any>(obj: O, prop: keyof {[P in keyof O]: O[P] extends T ? P : never}): BoolRef<T> {
    return new BoolRef<T>(obj, prop as string, this.value1, this.value2)
  }
}

// export function assign<T, P extends (keyof T)>(entity: T, prop: P, value: T[P]): void {
//   Transaction.run(`assign ${(entity as any).constructor.name}.${prop}`, () => {
//     const o: any = entity
//     o[prop] = value
//   })
// }
