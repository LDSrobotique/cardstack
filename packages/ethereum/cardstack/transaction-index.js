const { Client, types } = require('pg');
const postgresConfig = require('@cardstack/plugin-utils/postgres-config');
const TransactionIndexBase = require('./transaction-index-base');
const { declareInjections } = require('@cardstack/di');
const log = require('@cardstack/logger')('cardstack/ethereum/transaction-index');
const config = postgresConfig({ database: `ethereum_index` });

// This prevents pg from returning icky types, like 't' for boolean true or string integers.
// This comes from https://github.com/brianc/node-pg-types
// postgres OIDs are revealed by executing: select typname, oid, typarray from pg_type order by oid
const BOOL_OID = 16;
const INT8_OID = 20;
const INT4_OID = 23;
const INT2_OID = 21;
types.setTypeParser(BOOL_OID, function(val) {
  return ['true', 't'].includes(val);
});
types.setTypeParser(INT2_OID, function(val) {
  return parseInt(val, 10);
});
types.setTypeParser(INT4_OID, function(val) {
  return parseInt(val, 10);
});
types.setTypeParser(INT8_OID, function(val) {
  return parseInt(val, 10);
});

module.exports = declareInjections({
  jobQueue: 'hub:queues'
},

class TransactionIndex extends TransactionIndexBase {
  static create(...args) {
    return new this(...args);
  }

  constructor({ jobQueue }) {
    super();

    this.jobQueue = jobQueue;
    this._indexingPromise = null;
    this._blockHeight = 0;
  }

  async _setupMigrate() {
    await this.jobQueue.subscribe("ethereum/transaction-index/migrate-db", async () => {
      await this._migrateDb();
    });
    await this.jobQueue.publishAndWait('ethereum/transaction-index/migrate-db', {}, {
      singletonKey: 'ethereum/transaction-index/migrate-db',
      singletonNextSlot: true
    });
  }

  get blockHeight() {
    return this._blockHeight;
  }

  get currentJsonRpcUrl() {
    return this.jsonRpcUrls[this.urlIndex];
  }

  get canFailoverEthereumClient() {
    return true;
  }

  get numFailoverClients() {
    return this.jsonRpcUrls.length;
  }

  async _failoverEthereumClient() {
    log.warn(`Failing over ethereum client ${this.currentJsonRpcUrl}`);

    await this.ethereumClient.stopAll();
    if (this.urlIndex >= this.jsonRpcUrls.length - 1) {
      this.urlIndex = 0;
    } else {
      this.urlIndex++;
    }

    this.ethereumClient.connect(this.currentJsonRpcUrl);
    await this.ensureDatabaseSetup();
    await this.ethereumClient.startNewBlockListening(this);

    log.info(`Now using ethereum client ${this.currentJsonRpcUrl}`);
  }

  async start(ethereumClient, jsonRpcUrls) {
    this.urlIndex = 0;
    this.jsonRpcUrls = jsonRpcUrls;
    this.ethereumClient = ethereumClient;

    await this.ensureDatabaseSetup();
    this._index(); // dont await the block downloading as the first time index will block until all blocks downloaded (which may cause health checks to fail)
    await this.ethereumClient.startNewBlockListening(this);
  }

  async getTransaction(txnHash) {
    await this.ensureDatabaseSetup();
    await this._indexingPromise;

    let { rows } = await this.query(`select * from transactions where transaction_hash = '${txnHash}'`);
    let [ row ] = rows;
    return row;
  }

  async getTransactionsForAddress(address, { onlySuccessfulTransactions, sinceBlockNumber, toBlockNumber, limit }) {
    await this.ensureDatabaseSetup();
    await this._indexingPromise;

    let query = `select * from transactions where (lower(from_address) = lower('${address}') OR lower(to_address) = lower('${address}'))`;
    if (sinceBlockNumber != null) {
      query += ` and block_number >= ${sinceBlockNumber}`;
    }
    if (toBlockNumber != null) {
      query += ` and block_number <= ${toBlockNumber}`;
    }
    if (onlySuccessfulTransactions) {
      query += ` and transaction_successful = TRUE`;
    }
    query += ` order by block_number, transaction_index`;
    if (limit != null) {
      query += ` limit ${limit}`;
    }

    log.trace(`getting transactions for address '${address}' since block '${sinceBlockNumber || 0}' to block '${toBlockNumber || 'latest'}' with sql: ${query}`);
    let start = Date.now();
    let { rows } = await this.query(query);
    log.debug(`transaction query for address '${address}' since block '${sinceBlockNumber || 0}' to block '${toBlockNumber || 'latest'}' returned ${rows.length} transactions in ${Date.now() - start}ms`);

    return rows;
  }

  // This is an event listener which is only executed as a synchronous call
  onNewBlockReceived(blockNumber) {
    log.debug(`new block received from geth #${blockNumber}`);
    this._index();
  }

  async _index() {
    this._indexingPromise = Promise.resolve(this._indexingPromise)
      .then(() => this._loadNewBlocks());

    return this._indexingPromise;
  }

  async _loadNewBlocks() {
    let fromBlockHeight = await this._getHighestIndexedBlockNumber();
    log.info(`loading new blocks starting from block #${fromBlockHeight}`);
    let toBlockHeight = await this.buildIndex({ fromBlockHeight });
    log.info(`completed loading blocks from #${fromBlockHeight} to #${toBlockHeight}`);

    this._blockHeight = toBlockHeight;
    this.emit('blocks-indexed', { fromBlockHeight, toBlockHeight });
  }

  async _getHighestIndexedBlockNumber() {
    let { rows } = await this.query(`select block_number from transactions order by block_number desc limit 1`);

    if (!rows.length) { return 0; }

    let [ { block_number } ] = rows;
    return parseInt(block_number, 10);
  }

  // this is only ever to be used for the test cleanup
  async __deleteIndex() {
    await this.pool.end();
    let client = new Client(Object.assign({}, config, { database: 'postgres' }));
    try {
      await client.connect();
      await client.query(`drop database if exists ${config.database}`);
    } finally {
      client.end();
    }
  }
});