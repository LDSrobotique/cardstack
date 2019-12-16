import { Pool, Client, QueryResult, PoolClient } from 'pg';
import migrate from 'node-pg-migrate';
import logger from '@cardstack/logger';
import postgresConfig from './postgres-config';
import { join } from 'path';
import * as JSON from 'json-typescript';
import {
  upsert,
  param,
  safeName,
  every,
  CardExpression,
  Expression,
  any,
  isParam,
  addExplicitParens,
  PgPrimitive,
  fieldQuery,
  fieldArity,
  fieldValue,
  FieldQuery,
  FieldValue,
  FieldArity,
} from './util';
import { CardWithId, CardId } from '../card';
import CardstackError from '../error';
import { Query, baseType, Filter, EqFilter, RangeFilter } from '../query';
import { Sorts } from './sorts';
import snakeCase from 'lodash/snakeCase';
import flatten from 'lodash/flatten';
import assertNever from 'assert-never';
import { ScopedCardService } from '../cards-service';

const log = logger('cardstack/pgsearch');

function config() {
  return postgresConfig({
    database: `pgsearch_${process.env.PGSEARCH_NAMESPACE || 'dev'}`,
  });
}

export default class PgClient {
  private pool: Pool;

  constructor() {
    let c = config();
    this.pool = new Pool({
      user: c.user,
      host: c.host,
      database: c.database,
      password: c.password,
      port: c.port,
    });
  }

  async teardown() {
    if (this.pool) {
      await this.pool.end();
    }
  }

  async ready() {
    await this.migrateDb();
  }

  private async migrateDb() {
    const config = postgresConfig();
    let client = new Client(Object.assign({}, config, { database: 'postgres' }));
    try {
      await client.connect();
      let response = await client.query(`select count(*)=1 as has_database from pg_database where datname=$1`, [
        config.database,
      ]);
      if (!response.rows[0].has_database) {
        await client.query(`create database ${safeName(config.database)}`);
      }
    } finally {
      client.end();
    }

    await migrate({
      direction: 'up',
      migrationsTable: 'migrations',
      singleTransaction: true,
      checkOrder: false,
      databaseUrl: {
        user: config.user,
        host: config.host,
        database: config.database,
        password: config.password,
        port: config.port,
      },
      count: Infinity,
      ignorePattern: '.*\\.(?!js)[^.]+',
      dir: join(__dirname, 'migrations'),
      log: (...args) => log.debug(...args),
    });
  }

  static async deleteSearchIndexIHopeYouKnowWhatYouAreDoing() {
    let c = config();
    let client = new Client(Object.assign({}, c, { database: 'postgres' }));
    try {
      await client.connect();
      await client.query(`drop database if exists ${safeName(c.database)}`);
    } finally {
      client.end();
    }
  }

  async queryCards(cards: ScopedCardService, query: CardExpression): Promise<QueryResult> {
    let client = await this.pool.connect();
    let sql = await this.cardQueryToSQL(cards, query);
    log.trace('search: %s trace: %j', sql.text, sql.values);
    try {
      return await client.query(sql);
    } finally {
      client.release();
    }
  }

  async query(query: Expression): Promise<QueryResult> {
    let client = await this.pool.connect();
    let sql = await this.expressionToSql(query);
    log.trace('search: %s trace: %j', sql.text, sql.values);
    try {
      return await client.query(sql);
    } finally {
      client.release();
    }
  }

  async withConnection<T>(
    fn: (connection: { client: PoolClient; query: (e: Expression) => Promise<QueryResult> }) => Promise<T>
  ): Promise<T> {
    let client = await this.pool.connect();
    let query = async (expression: Expression) => {
      return await client.query(this.expressionToSql(expression));
    };
    try {
      return await fn({ query, client });
    } finally {
      client.release();
    }
  }

  private async cardQueryToSQL(cards: ScopedCardService, query: CardExpression) {
    return this.expressionToSql(await this.makeExpression(cards, query));
  }

  private async makeExpression(cards: ScopedCardService, query: CardExpression): Promise<Expression> {
    return flatten(
      await Promise.all(
        query.map(element => {
          if (isParam(element) || typeof element === 'string') {
            return Promise.resolve([element]);
          } else if (element.kind === 'field-query') {
            return this.handleFieldQuery(cards, element);
          } else if (element.kind === 'field-value') {
            return this.handleFieldValue(cards, element);
          } else if (element.kind === 'field-arity') {
            return this.handleFieldArity(cards, element);
          } else {
            throw assertNever(element);
          }
        })
      )
    );
  }

  private expressionToSql(query: Expression) {
    let values: PgPrimitive[] = [];
    let text = query
      .map(element => {
        if (isParam(element)) {
          values.push(element.param);
          return `$${values.length}`;
        } else if (typeof element === 'string') {
          return element;
        } else {
          assertNever(element);
        }
      })
      .join(' ');
    return {
      text,
      values,
    };
  }

  beginCardBatch(cards: ScopedCardService) {
    return new Batch(this, cards);
  }
  private async handleFieldQuery(_cards: ScopedCardService, fieldQuery: FieldQuery): Promise<Expression> {
    let { path, errorHint } = fieldQuery;
    if (path === 'realm' || path === 'original-realm' || path === 'local-id') {
      return [snakeCase(path)];
    }

    throw new Error(`unimplemented in buildQueryExpression for ${errorHint}`);
  }

  private async handleFieldValue(cards: ScopedCardService, fieldValue: FieldValue): Promise<Expression> {
    let { path, errorHint, value } = fieldValue;
    if (path === 'realm' || path === 'original-realm' || path === 'local-id') {
      return await this.makeExpression(cards, value);
    }

    throw new Error(`unimplemented in buildQueryExpression for ${errorHint}`);
  }

  private async handleFieldArity(cards: ScopedCardService, fieldArity: FieldArity): Promise<Expression> {
    let { path, singular, errorHint } = fieldArity;
    if (path === 'realm' || path === 'original-realm' || path === 'local-id') {
      return await this.makeExpression(cards, singular);
    }

    throw new Error(`unimplemented in buildQueryExpression for ${errorHint}`);
  }

  async get(cards: ScopedCardService, id: CardId): Promise<CardWithId> {
    let condition = every([
      [`realm = `, param(id.realm)],
      [`original_realm = `, param(id.originalRealm ?? id.realm)],
      [`local_id = `, param(id.localId)],
    ]);
    let result = await this.queryCards(cards, [`select pristine_doc from cards where`, ...condition]);
    if (result.rowCount !== 1) {
      throw new CardstackError(
        `Card not found with realm="${id.realm}", original-realm="${id.originalRealm ?? id.realm}", local-id="${
          id.localId
        }"`,
        { status: 404 }
      );
    }
    return new CardWithId(result.rows[0].pristine_doc);
  }

  async search(
    cards: ScopedCardService,
    { filter, queryString, sort, page }: Query
  ): Promise<{ cards: CardWithId[]; meta: ResponseMeta }> {
    let conditions = [] as CardExpression[];

    if (filter) {
      conditions.push(this.filterCondition(baseType(filter), filter));
    }

    if (queryString) {
      //conditions.push(this.queryCondition(queryString));
    }

    let totalResponsePromise = this.queryCards(cards, [`select count(*) from cards where`, ...every(conditions)]);

    let sorts = new Sorts(baseType(filter), sort);
    if (page && page.cursor) {
      conditions.push(sorts.afterExpression(page.cursor));
    }

    let query = [
      `select`,
      ...sorts.cursorColumns(),
      `, pristine_doc from cards where`,
      ...every(conditions),
      ...sorts.orderExpression(),
    ];

    let size = Number(page?.size ?? 10);
    query = [...query, 'limit', param(size + 1)];

    let response = await this.queryCards(cards, query);
    let totalResponse = await totalResponsePromise;
    return this.assembleResponse(response, totalResponse, size, sorts);
  }

  private assembleResponse(response: QueryResult, totalResponse: QueryResult, requestedSize: number, sorts: Sorts) {
    let page: ResponseMeta['page'] = {
      // nobody has more than 2^53-1 total docs right?
      total: parseInt(totalResponse.rows[0].count, 10),
    };
    let cards = response.rows;
    if (response.rowCount > requestedSize) {
      cards = cards.slice(0, requestedSize);
      let last = cards[cards.length - 1];
      page.cursor = sorts.getCursor(last);
    }

    return {
      cards: cards.map(row => new CardWithId(row.pristine_doc)),
      meta: { page },
    };
  }

  private filterCondition(typeContext: CardId, filter: Filter): CardExpression {
    if (filter.type) {
      typeContext = filter.type;
    }

    if ('any' in filter) {
      return any(filter.any.map(item => this.filterCondition(typeContext, item)));
    } else if ('every' in filter) {
      return every(filter.every.map(item => this.filterCondition(typeContext, item)));
    } else if ('not' in filter) {
      return ['NOT', ...addExplicitParens(this.filterCondition(typeContext, filter.not))];
    } else if ('eq' in filter) {
      return this.eqCondition(typeContext, filter);
    } else if ('range' in filter) {
      return this.rangeCondition(typeContext, filter);
    } else {
      assertNever(filter);
    }
  }

  private eqCondition(typeContext: CardId, filter: EqFilter): CardExpression {
    return every(
      Object.entries(filter.eq).map(([key, value]) => {
        return this.fieldFilter(typeContext, key, value);
      })
    );
  }

  private fieldFilter(typeContext: CardId, key: string, value: JSON.Value): CardExpression {
    let query = fieldQuery(typeContext, key, 'filter');
    let v = fieldValue(typeContext, key, [param(value)], 'filter');
    return [fieldArity(typeContext, key, [query, '=', v], [query, '&&', 'array[', v, ']'], 'filter')];
  }

  private rangeCondition(_typeContext: CardId, _filter: RangeFilter): CardExpression {
    throw new Error('unimplemented');
  }
}

export class Batch {
  private _touched: CardId[] = [];
  private generations: {
    [realm: string]: number | undefined;
  } = {};

  constructor(private client: PgClient, private cards: ScopedCardService) {}

  async save(card: CardWithId) {
    this._touched.push({ realm: card.realm, originalRealm: card.originalRealm, localId: card.localId });

    /* eslint-disable @typescript-eslint/camelcase */
    let row = {
      realm: param(card.realm),
      original_realm: param(card.originalRealm),
      local_id: param(card.localId),
      pristine_doc: param(((await card.asPristineDoc()).jsonapi as unknown) as JSON.Object),
      generation: param(this.generations[card.realm] || null),
    };
    /* eslint-enable @typescript-eslint/camelcase */

    await this.client.queryCards(this.cards, upsert('cards', 'cards_pkey', row));
    log.debug('save realm: %s original realm: %s local id: %s', card.realm, card.originalRealm, card.localId);
  }

  async delete(id: CardId) {
    this._touched.push(id);
    await this.client.query([
      'delete from cards where ',
      ...every([
        ['realm =', param(id.realm)],
        ['original_realm = ', param(id.originalRealm ?? id.realm)],
        ['local_id = ', param(id.localId)],
      ]),
    ]);
    log.debug('delete realm: %s original realm: %s local id: %s', id.realm, id.originalRealm ?? id.realm, id.localId);
  }

  createGeneration(realm: string) {
    this.generations[realm] = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
  }

  async deleteOlderGenerations(realm: string) {
    if (this.generations[realm] == null) {
      throw new CardstackError(
        `tried to remove older generation of cards before new generation was created for realm '${realm}'`
      );
    }
    await this.client.query([
      'delete from cards where ',
      ...addExplicitParens(['generation !=', param(this.generations[realm]!), 'or generation is null']),
      ' and realm =',
      param(realm),
    ]);
    log.debug(`deleted generations other than ${this.generations[realm]} for cards in realm '${realm}'`);
  }

  async done() {}

  get touched() {
    return this._touched;
  }
}

declare module '@cardstack/hub/dependency-injection' {
  interface KnownServices {
    pgclient: PgClient;
  }
}

export interface ResponseMeta {
  page: { total: number; cursor?: string };
}
