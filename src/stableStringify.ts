export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface StableStringifyOrders {
  top?: readonly string[];
  arrayObject?: readonly string[];
}

function orderedKeys(value: { [key: string]: unknown }, order: readonly string[] | undefined): string[] {
  const keys = Object.keys(value);
  const preferred = order ?? [];
  const inOrder = preferred.filter((key) => keys.includes(key));
  const remaining = keys.filter((key) => !inOrder.includes(key)).sort();
  return [...inOrder, ...remaining];
}

function stringifyInternal(value: unknown, orders: StableStringifyOrders, nested: boolean): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("stableStringify only accepts finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stringifyInternal(item, orders, true)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as { [key: string]: unknown };
    const order = nested ? orders.arrayObject : orders.top;
    const parts = orderedKeys(record, order).map((key) => {
      const child = record[key];
      if (child === undefined || typeof child === "function" || typeof child === "symbol" || typeof child === "bigint") {
        throw new TypeError(`unsupported value at ${key}`);
      }
      return `${JSON.stringify(key)}:${stringifyInternal(child, orders, nested)}`;
    });
    return `{${parts.join(",")}}`;
  }
  throw new TypeError("stableStringify received an unsupported value");
}

export function stableStringify(value: unknown, orders: StableStringifyOrders = {}): string {
  return stringifyInternal(value, orders, false);
}
