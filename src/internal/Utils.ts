
export const RT_CACHE: unique symbol = Symbol("RT:CACHE");

export class Utils {
  static get(obj: any, sym: symbol): any {
    return obj[sym];
  }

  static set(obj: any, sym: symbol, value: any): any {
    Object.defineProperty(obj, sym, { value, configurable: false, enumerable: false });
    return obj;
  }

  static freezeSet<T>(obj?: Set<T>) {
    if (obj instanceof Set) {
      const pd = { configurable: false, enumerable: false, get: undef, set: undef };
      Object.defineProperty(obj, "add", pd);
      Object.defineProperty(obj, "delete", pd);
      Object.defineProperty(obj, "clear", pd);
      Object.freeze(obj);
    }
  }

  static freezeMap<K, V>(obj?: Map<K, V>) {
    if (obj instanceof Map) {
      const pd = { configurable: false, enumerable: false, get: undef, set: undef };
      Object.defineProperty(obj, "set", pd);
      Object.defineProperty(obj, "delete", pd);
      Object.defineProperty(obj, "clear", pd);
      Object.freeze(obj);
    }
  }

  static copyAllProps(source: any, target: any): any {
    for (const prop of Object.getOwnPropertyNames(source))
      Utils.copyProp(source, target, prop);
    for (const prop of Object.getOwnPropertySymbols(source))
      Utils.copyProp(source, target, prop);
    return target;
  }

  static copyProp(source: any, target: any, prop: PropertyKey): any {
    // let pd = Object.getOwnPropertyDescriptor(source, prop);
    // if (pd) {
    //   pd.writable = true;
    //   Object.defineProperty(target, prop, pd);
    // }
    return target[prop] = source[prop];
  }

  static equal(oldValue: any, newValue: any): boolean {
    let result: boolean;
    if (Array.isArray(oldValue)) {
      if (Array.isArray(newValue))
        result = newValue === oldValue; // TODO: compare array elements?
      else
        result = false;
    }
    else
      result = newValue === oldValue;
    return result;
  }

  /* istanbul ignore next */
  static different = function(oldValue: any, newValue: any): boolean {
    return !Utils.equal(oldValue, newValue); // to be redefined by Cache implementation
  };

  static valueHint(value: any): string {
    let result: string = "";
    if (Array.isArray(value))
      result = `Array(${value.length})`;
    else if (value instanceof Set)
      result = `Set(${value.size})`;
    else if (value instanceof Map)
      result = `Map(${value.size})`;
    else if (value === RT_CACHE)
      result = `<renew>`;
    else if (value !== undefined && value !== null)
      result = value.toString().slice(0, 20);
    else
      result = "◌";
    return result;
  }

  static hasAllFlags(flags: number, required: number): boolean {
    return (flags & required) === required;
  }
}

/* istanbul ignore next */
export function undef(...args: any[]): never {
  throw new Error("this method should never be called");
}

/* istanbul ignore next */
export function rethrow(error: any): never {
  throw error;
}

export async function all(promises: Array<Promise<any>>): Promise<any[]> {
  let error: any;
  const result = await Promise.all(promises.map(x => x.catch(e => { error = error || e; return e; })));
  if (error)
    throw error;
  return result;
}

/* istanbul ignore next */
export function sleep<T>(timeout: number): Promise<T> {
  return new Promise(function(resolve: any) {
    setTimeout(resolve.bind(null, () => resolve), timeout);
  });
}
