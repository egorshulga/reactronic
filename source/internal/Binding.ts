// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.

// Copyright (c) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>

import { Dbg } from './Dbg';

export const RT_BINDING: unique symbol = Symbol("RT:BINDING");

export class Binding<T> {
  constructor(
    readonly owner: any,
    readonly prop: PropertyKey,
    readonly value: T,
    readonly clone: (value: T) => T) {
  }

  readable(receiver: any): T {
    let v: T = this.owner[this.prop];
    if (v === receiver) // check if array is not yet cloned
      v = this.value;
    return v;
  }

  writable(receiver: any): T {
    let v: T = this.owner[this.prop];
    if (v === receiver) { // check if it's first write and clone then
      if (Dbg.trace.writes) Dbg.log("║", "  · ", `${this.owner.constructor.name}.${this.prop.toString()} - copy-on-write`);
      v = this.owner[this.prop] = this.clone(this.value);
    }
    return v;
  }

  static seal<T>(owner: any, prop: PropertyKey, value: T, proto: object, clone: (v: T) => T): Binding<T> {
    if (Object.isFrozen(value)) /* istanbul ignore next */
      throw new Error("copy-on-write collection cannot be referenced from multiple objects");
    const self: any = value;
    if (Dbg.trace.writes) Dbg.log("║", "·", `${owner.constructor.name}.${prop.toString()} - sealing for copy-on-write`);
    const binding = new Binding<T>(owner, prop, value, clone);
    self[RT_BINDING] = binding;
    Object.setPrototypeOf(value, proto);
    Object.freeze(value);
    return binding;
  }
}

export function R<T>(self: any): T {
  const binding: Binding<T> = self[RT_BINDING];
  return binding !== undefined ? binding.readable(self) : self;
}

export function W<T>(self: any): T {
  const binding: Binding<T> = self[RT_BINDING];
  return binding !== undefined ? binding.writable(self) : self;
}