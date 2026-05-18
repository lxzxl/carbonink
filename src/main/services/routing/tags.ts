import type { Database } from 'better-sqlite3';
import { Context, Layer } from 'effect';

export class DbTag extends Context.Tag('routing/Db')<DbTag, Database>() {}
export class AmapKeyTag extends Context.Tag('routing/AmapKey')<AmapKeyTag, string>() {}

export type RoutingR = DbTag | AmapKeyTag;

export interface RoutingDeps {
  db: Database;
  amapKey: string;
}

export function buildRoutingLayer(deps: RoutingDeps): Layer.Layer<RoutingR> {
  return Layer.mergeAll(
    Layer.succeed(DbTag, deps.db),
    Layer.succeed(AmapKeyTag, deps.amapKey),
  );
}
